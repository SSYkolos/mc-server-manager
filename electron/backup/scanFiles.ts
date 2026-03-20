import fs from "fs"
import path from "path"
import { hashFile } from "./hashFile"
import { buildScanCacheKey } from "./buildScanCacheKey"
import type { FileStateEntry } from "./loadFileState"

export type ScannedFile = {
  path: string
  absolute: string
  size: number
  mtimeMs: number
  hash: string
  hashReused: boolean
}

const INCLUDE = [
  "world",
  "world_nether",
  "world_the_end",
  "server.properties",
  "ops.json",
  "whitelist.json",
  "banned-ips.json",
  "banned-players.json",
  "usercache.json",
  "eula.txt",
  "server-icon.png"
]

export async function scanBackupFiles(
  serverPath: string,
  previousState: Record<string, FileStateEntry>
): Promise<ScannedFile[]> {
  const files: ScannedFile[] = []

  for (const item of INCLUDE) {
    const full = path.join(serverPath, item)
    if (!fs.existsSync(full)) continue
    await walk(full, item)
  }

  async function walk(abs: string, rel: string) {
    const stat = fs.statSync(abs)
    const normalizedRel = rel.replace(/\\/g, "/")

    if (
      normalizedRel.endsWith("/session.lock") ||
      normalizedRel.endsWith("session.lock") ||
      normalizedRel.endsWith("/level.dat_old") ||
      normalizedRel.endsWith("level.dat_old")
    ) {
      return
    }

    if (stat.isDirectory()) {
      for (const f of fs.readdirSync(abs)) {
        await walk(path.join(abs, f), path.join(rel, f))
      }
      return
    }

    const size = stat.size
    const mtimeMs = stat.mtimeMs
    const previous = previousState[normalizedRel]

    let hash: string
    let hashReused = false

    const prevKey = previous
      ? buildScanCacheKey(previous.size, previous.mtimeMs)
      : null

    const currentKey = buildScanCacheKey(size, mtimeMs)

    if (previous && prevKey === currentKey && previous.hash) {
      hash = previous.hash
      hashReused = true
    } else {
      hash = await hashFile(abs)
    }

    files.push({
      absolute: abs,
      path: normalizedRel,
      size,
      mtimeMs,
      hash,
      hashReused
    })
  }

  return files
}