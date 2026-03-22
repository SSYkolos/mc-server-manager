import fs from "fs"
import path from "path"
import os from "os"
import { hashFileFast, hashFileStrong } from "./hashFile"

export type ScannedFile = {
  path: string
  absolute: string
  size: number
  mtimeMs: number
  hash: string
}

export type HashCacheEntry = {
  size: number
  mtimeMs: number
  fastHash: string
  hash: string
}

export type HashCache = Record<string, HashCacheEntry>

const INCLUDE = [
  "world",
  "world_nether",
  "world_the_end",
  "ops.json",
  "whitelist.json",
  "banned-ips.json",
  "banned-players.json",
  "usercache.json",
]

function normalizeRel(rel: string) {
  return rel.replace(/\\/g, "/")
}

function shouldSkip(rel: string) {
  const p = normalizeRel(rel)

  return (
    p.endsWith("/session.lock") ||
    p.endsWith("session.lock") ||
    p.endsWith("/level.dat_old") ||
    p.endsWith("level.dat_old")
  )
}

function getHashWorkerCount() {
  const cpuCount = Math.max(1, os.cpus().length)
  return Math.max(2, Math.min(6, Math.floor(cpuCount / 2)))
}

type PendingHashJob = {
  index: number
  absolute: string
  rel: string
  size: number
  mtimeMs: number
  mode: "strong" | "mtime-only-check"
  cached?: HashCacheEntry
}

export async function scanBackupFiles(
  serverPath: string,
  hashCache: HashCache = {}
): Promise<{
  files: ScannedFile[]
  nextHashCache: HashCache
  stats: {
    exactReuseCount: number
    fastReuseCount: number
    strongRehashCount: number
  }
}> {
  const orderedFiles: Array<ScannedFile | undefined> = []
  const nextHashCache: HashCache = {}
  const pendingJobs: PendingHashJob[] = []

  const fastHashReused: string[] = []
  const strongRehashed: string[] = []

  let exactReuseCount = 0

  for (const item of INCLUDE) {
    const full = path.join(serverPath, item)

    if (!fs.existsSync(full)) continue

    await walk(full, item)
  }

  async function walk(abs: string, rel: string): Promise<void> {
    const stat = fs.statSync(abs)

    if (stat.isDirectory()) {
      for (const f of fs.readdirSync(abs)) {
        await walk(path.join(abs, f), path.join(rel, f))
      }
      return
    }

    const normalizedRel = normalizeRel(rel)

    if (shouldSkip(normalizedRel)) return

    const size = stat.size
    const mtimeMs = stat.mtimeMs
    const index = orderedFiles.length

    orderedFiles.push(undefined)

    const cached = hashCache[normalizedRel]

    // exact reuse
    if (cached && cached.size === size && cached.mtimeMs === mtimeMs) {
      nextHashCache[normalizedRel] = {
        size,
        mtimeMs,
        fastHash: cached.fastHash,
        hash: cached.hash
      }

      orderedFiles[index] = {
        absolute: abs,
        path: normalizedRel,
        size,
        mtimeMs,
        hash: cached.hash
      }
      exactReuseCount++
      return
    }

    // no cache or size changed => strong hash required
    if (!cached || cached.size !== size) {
      pendingJobs.push({
        index,
        absolute: abs,
        rel: normalizedRel,
        size,
        mtimeMs,
        mode: "strong",
        cached
      })
      return
    }

    // same size, different mtime => quick content check first
    pendingJobs.push({
      index,
      absolute: abs,
      rel: normalizedRel,
      size,
      mtimeMs,
      mode: "mtime-only-check",
      cached
    })
  }

  const queue = [...pendingJobs]
  const workers = Array.from(
    { length: Math.min(getHashWorkerCount(), queue.length || 1) },
    async () => {
      while (queue.length > 0) {
        const job = queue.shift()
        if (!job) return

        if (job.mode === "mtime-only-check" && job.cached) {
          const fastHash = await hashFileFast(job.absolute)

          if (fastHash === job.cached.fastHash) {
            nextHashCache[job.rel] = {
              size: job.size,
              mtimeMs: job.mtimeMs,
              fastHash,
              hash: job.cached.hash
            }

            orderedFiles[job.index] = {
              absolute: job.absolute,
              path: job.rel,
              size: job.size,
              mtimeMs: job.mtimeMs,
              hash: job.cached.hash
            }

            fastHashReused.push(job.rel)
            continue
          }
        }

        const [fastHash, hash] = await Promise.all([
          hashFileFast(job.absolute),
          hashFileStrong(job.absolute)
        ])

        nextHashCache[job.rel] = {
          size: job.size,
          mtimeMs: job.mtimeMs,
          fastHash,
          hash
        }

        orderedFiles[job.index] = {
          absolute: job.absolute,
          path: job.rel,
          size: job.size,
          mtimeMs: job.mtimeMs,
          hash
        }

        strongRehashed.push(job.rel)
      }
    }
  )

  await Promise.all(workers)

  console.log("[scan] fast-hash reused paths:", fastHashReused)
  console.log("[scan] strong rehashed paths:", strongRehashed)

  return {
    files: orderedFiles.filter((f): f is ScannedFile => !!f),
    nextHashCache,
    stats: {
      exactReuseCount,
      fastReuseCount: fastHashReused.length,
      strongRehashCount: strongRehashed.length
    }
  }
}