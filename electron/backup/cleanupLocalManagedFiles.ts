import fs from "fs"
import path from "path"

const MANAGED_ROOTS = [
  "world",
  "world_nether",
  "world_the_end",
  "ops.json",
  "whitelist.json",
  "banned-ips.json",
  "banned-players.json",
  "usercache.json",
  "eula.txt"
]

function normalizeRel(rel: string) {
  return rel.replace(/\\/g, "/")
}

function shouldIgnore(rel: string) {
  const p = normalizeRel(rel)

  return (
    p.endsWith("/session.lock") ||
    p.endsWith("session.lock") ||
    p.endsWith("/level.dat_old") ||
    p.endsWith("level.dat_old")
  )
}

async function pathExists(p: string) {
  try {
    await fs.promises.access(p)
    return true
  } catch {
    return false
  }
}

async function collectManagedLocalFiles(serverPath: string): Promise<string[]> {
  const found: string[] = []

  for (const root of MANAGED_ROOTS) {
    const abs = path.join(serverPath, root)
    if (!(await pathExists(abs))) continue

    await walk(abs, root)
  }

  return found

  async function walk(abs: string, rel: string): Promise<void> {
    const stat = await fs.promises.stat(abs)

    if (stat.isDirectory()) {
      const entries = await fs.promises.readdir(abs)
      for (const entry of entries) {
        await walk(path.join(abs, entry), path.join(rel, entry))
      }
      return
    }

    const normalized = normalizeRel(rel)
    if (shouldIgnore(normalized)) return

    found.push(normalized)
  }
}

async function removeEmptyDirsUnder(absRoot: string): Promise<boolean> {
  if (!(await pathExists(absRoot))) return true

  const stat = await fs.promises.stat(absRoot)
  if (!stat.isDirectory()) return false

  const entries = await fs.promises.readdir(absRoot)

  for (const entry of entries) {
    await removeEmptyDirsUnder(path.join(absRoot, entry))
  }

  const after = await fs.promises.readdir(absRoot)
  if (after.length === 0) {
    await fs.promises.rmdir(absRoot)
    return true
  }

  return false
}

export async function cleanupLocalManagedFiles({
  serverPath,
  expectedPaths
}: {
  serverPath: string
  expectedPaths: Set<string>
}) {
  const existingPaths = await collectManagedLocalFiles(serverPath)

  const toDelete = existingPaths.filter((rel) => !expectedPaths.has(rel))

  let deletedFiles = 0
  let deletedDirs = 0

  for (const rel of toDelete) {
    const abs = path.join(serverPath, rel)

    try {
      await fs.promises.rm(abs, { force: true })
      deletedFiles++
    } catch {
      // ignore individual delete errors
    }
  }

  for (const root of MANAGED_ROOTS) {
    const abs = path.join(serverPath, root)
    const existedBefore = await pathExists(abs)

    if (!existedBefore) continue

    const removed = await removeEmptyDirsUnder(abs)
    if (removed) deletedDirs++
  }

  return {
    deletedFiles,
    deletedDirs,
    deletedPaths: toDelete
  }
}