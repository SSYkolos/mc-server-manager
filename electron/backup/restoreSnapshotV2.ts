import fs from "fs"
import path from "path"
import axios from "axios"
import { createWriteStream } from "fs"
import { pipeline } from "stream/promises"
import unzipper from "unzipper"
import type { HashCache } from "./scanFiles"
import { loadHashCache } from "./loadHashCache"
import { saveHashCache } from "./saveHashCache"
import { buildScanCacheKey } from "./buildScanCacheKey"
import { cleanupLocalManagedFiles } from "./cleanupLocalManagedFiles"
import { hashFileFast } from "./hashFile"

export type ManifestFile =
  | {
    path: string
    size: number
    hash: string
    storage: "large-object"
    objectFileId: string
    objectName: string
  }
  | {
    path: string
    size: number
    hash: string
    storage: "small-pack"
    packHash: string
    packFileId: string
    packFileName: string
  }

export type RestoreProgress = {
  phase:
  | "starting"
  | "manifest"
  | "large-files"
  | "small-packs"
  | "cleanup"
  | "verify"
  | "finalizing"
  | "done"
  | "error"
  message: string
  current: number
  total: number
  percent: number
}

export type RestoreVerificationResult = {
  verifiedFiles: number
  missingFiles: string[]
  failedFiles: Array<{
    path: string
    reason: "size-mismatch" | "hash-mismatch"
    expectedSize?: number
    actualSize?: number
    expectedHash?: string
    actualHash?: string
  }>
}

function makePercent(current: number, total: number) {
  if (!total || total <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((current / total) * 100)))
}

async function downloadFile(
  accessToken: string,
  fileId: string,
  dest: string
) {
  await fs.promises.mkdir(path.dirname(dest), { recursive: true })

  const res = await axios.get(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    {
      responseType: "stream",
      headers: { Authorization: `Bearer ${accessToken}` }
    }
  )

  await pipeline(res.data, createWriteStream(dest))
}

async function findFileByName(
  drive: any,
  parentId: string,
  name: string
) {
  const res = await drive.files.list({
    q: `'${parentId}' in parents and name='${name}' and trashed=false`,
    fields: "files(id,name)",
    pageSize: 10
  })

  return res.data.files?.[0] ?? null
}

async function safeRemove(p: string) {
  try {
    await fs.promises.rm(p, { recursive: true, force: true })
  } catch {
    // ignore cleanup errors
  }
}

async function getLocalFileState(filePath: string) {
  try {
    const stat = await fs.promises.stat(filePath)
    return {
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      cacheKey: buildScanCacheKey(stat.size, stat.mtimeMs)
    }
  } catch {
    return null
  }
}

async function shouldSkipRestoreFile(
  targetPath: string,
  manifestFile: ManifestFile,
  localHashCache: HashCache
): Promise<boolean> {
  const local = await getLocalFileState(targetPath)
  if (!local) return false

  const cacheEntry = localHashCache[manifestFile.path]
  if (!cacheEntry) return false

  const localCacheKey = buildScanCacheKey(local.size, local.mtimeMs)
  const cachedKey = buildScanCacheKey(cacheEntry.size, cacheEntry.mtimeMs)

  if (localCacheKey !== cachedKey) return false
  if (cacheEntry.hash !== manifestFile.hash) return false
  if (local.size !== manifestFile.size) return false

  return true
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>
) {
  const queue = items.map((item, index) => ({ item, index }))

  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, queue.length || 1)) },
    async () => {
      while (queue.length > 0) {
        const next = queue.shift()
        if (!next) return
        await worker(next.item, next.index)
      }
    }
  )

  await Promise.all(workers)
}

async function verifyRestoredFiles({
  serverPath,
  files,
  onProgress
}: {
  serverPath: string
  files: ManifestFile[]
  onProgress?: (progress: RestoreProgress) => void
}): Promise<RestoreVerificationResult> {
  const result: RestoreVerificationResult = {
    verifiedFiles: 0,
    missingFiles: [],
    failedFiles: []
  }

  let done = 0
  const total = Math.max(1, files.length)

  await runWithConcurrency(files, 4, async (file) => {
    const targetPath = path.join(serverPath, file.path)

    try {
      const stat = await fs.promises.stat(targetPath)

      if (stat.size !== file.size) {
        result.failedFiles.push({
          path: file.path,
          reason: "size-mismatch",
          expectedSize: file.size,
          actualSize: stat.size
        })
      } else {
        const actualHash = await hashFileFast(targetPath)

        if (actualHash !== file.hash) {
          result.failedFiles.push({
            path: file.path,
            reason: "hash-mismatch",
            expectedHash: file.hash,
            actualHash
          })
        } else {
          result.verifiedFiles++
        }
      }
    } catch {
      result.missingFiles.push(file.path)
    } finally {
      done++
      onProgress?.({
        phase: "verify",
        message: `Verifying restored files (${done}/${files.length})`,
        current: done,
        total: files.length,
        percent: makePercent(done, total)
      })
    }
  })

  return result
}

export async function restoreSnapshotV2({
  drive,
  snapshotFolderId,
  serverPath,
  accessToken,
  onProgress
}: {
  drive: any
  snapshotFolderId: string
  serverPath: string
  accessToken: string
  onProgress?: (progress: RestoreProgress) => void
}) {
  const emit = (progress: RestoreProgress) => {
    onProgress?.(progress)
  }

  await fs.promises.mkdir(serverPath, { recursive: true })

  const tmpManifest = path.join(serverPath, ".restore-manifest.json")
  const restorePackCacheDir = path.join(serverPath, ".restore-pack-cache")
  const hashCachePath = path.join(serverPath, ".backup-hash-cache.json")
  const downloadedPackPaths: string[] = []

  try {
    emit({
      phase: "starting",
      message: "Preparing restore",
      current: 0,
      total: 1,
      percent: 0
    })

    const manifestFile = await findFileByName(
      drive,
      snapshotFolderId,
      "manifest.json"
    )

    if (!manifestFile) {
      throw new Error("manifest.json not found in snapshot")
    }

    emit({
      phase: "manifest",
      message: "Downloading manifest",
      current: 0,
      total: 1,
      percent: 0
    })

    await downloadFile(accessToken, manifestFile.id, tmpManifest)

    const manifest = JSON.parse(fs.readFileSync(tmpManifest, "utf8"))
    const files: ManifestFile[] = Array.isArray(manifest.files) ? manifest.files : []

    const localHashCache = await loadHashCache(hashCachePath)
    const rebuiltHashCache: HashCache = {}
    const packCache: Record<string, string> = {}
    const expectedPaths = new Set(files.map((file) => file.path))

    const largeFiles = files.filter(
      (file): file is Extract<ManifestFile, { storage: "large-object" }> =>
        file.storage === "large-object"
    )

    const smallPackGroups = new Map<
      string,
      Extract<ManifestFile, { storage: "small-pack" }>[]
    >()

    for (const file of files) {
      if (file.storage === "small-pack") {
        const key = file.packFileId
        const arr = smallPackGroups.get(key) ?? []
        arr.push(file)
        smallPackGroups.set(key, arr)
      }
    }

    let largeDone = 0
    const largeTotal = Math.max(1, largeFiles.length)

    emit({
      phase: "large-files",
      message: "Restoring large files",
      current: 0,
      total: largeFiles.length,
      percent: 0
    })

    await runWithConcurrency(largeFiles, 4, async (file) => {
      const targetPath = path.join(serverPath, file.path)
      await fs.promises.mkdir(path.dirname(targetPath), { recursive: true })

      const canSkip = await shouldSkipRestoreFile(
        targetPath,
        file,
        localHashCache
      )

      if (!canSkip) {
        await downloadFile(accessToken, file.objectFileId, targetPath)
      }

      const stat = await fs.promises.stat(targetPath)

      const fastHash = await hashFileFast(targetPath)

      rebuiltHashCache[file.path] = {
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        fastHash,
        hash: file.hash
      }

      largeDone++

      emit({
        phase: "large-files",
        message: `Restoring large files (${largeDone}/${largeFiles.length})`,
        current: largeDone,
        total: largeFiles.length,
        percent: makePercent(largeDone, largeTotal)
      })
    })

    const packEntries = Array.from(smallPackGroups.entries())
    let packDone = 0
    const packTotal = Math.max(1, packEntries.length)

    emit({
      phase: "small-packs",
      message: "Restoring packed files",
      current: 0,
      total: packEntries.length,
      percent: 0
    })

    for (const [packFileId, packFiles] of packEntries) {
      const neededFiles: Extract<ManifestFile, { storage: "small-pack" }>[] = []

      for (const file of packFiles) {
        const targetPath = path.join(serverPath, file.path)
        await fs.promises.mkdir(path.dirname(targetPath), { recursive: true })

        const canSkip = await shouldSkipRestoreFile(
          targetPath,
          file,
          localHashCache
        )

        if (canSkip) {
          const stat = await fs.promises.stat(targetPath)
          const fastHash = await hashFileFast(targetPath)

          rebuiltHashCache[file.path] = {
            size: stat.size,
            mtimeMs: stat.mtimeMs,
            fastHash,
            hash: file.hash
          }
        } else {
          neededFiles.push(file)
        }
      }

      if (neededFiles.length > 0) {
        const first = neededFiles[0]
        const localPackPath = path.join(serverPath, `.restore-${first.packFileName}`)
        downloadedPackPaths.push(localPackPath)

        await downloadFile(accessToken, packFileId, localPackPath)

        const extractDir = path.join(restorePackCacheDir, first.packHash)
        await fs.promises.mkdir(extractDir, { recursive: true })

        await fs
          .createReadStream(localPackPath)
          .pipe(unzipper.Extract({ path: extractDir }))
          .promise()

        packCache[packFileId] = extractDir

        for (const smallFile of neededFiles) {
          const targetPath = path.join(serverPath, smallFile.path)
          const restoredFilePath = path.join(packCache[packFileId], smallFile.path)

          if (!fs.existsSync(restoredFilePath)) {
            throw new Error(`Missing entry in pack: ${smallFile.path}`)
          }

          await fs.promises.copyFile(restoredFilePath, targetPath)

          const stat = await fs.promises.stat(targetPath)
          const fastHash = await hashFileFast(targetPath)

          rebuiltHashCache[smallFile.path] = {
            size: stat.size,
            mtimeMs: stat.mtimeMs,
            fastHash,
            hash: smallFile.hash
          }
        }
      }

      packDone++

      emit({
        phase: "small-packs",
        message: `Restoring packed files (${packDone}/${packEntries.length})`,
        current: packDone,
        total: packEntries.length,
        percent: makePercent(packDone, packTotal)
      })
    }

    emit({
      phase: "cleanup",
      message: "Cleaning obsolete local files",
      current: 0,
      total: 1,
      percent: 0
    })

    const cleanupResult = await cleanupLocalManagedFiles({
      serverPath,
      expectedPaths
    })

    console.log("[restore] local cleanup", cleanupResult)

    emit({
      phase: "finalizing",
      message: "Saving local cache",
      current: 0,
      total: 1,
      percent: 0
    })

    await saveHashCache(hashCachePath, rebuiltHashCache)

    emit({
      phase: "done",
      message: "Restore completed",
      current: 1,
      total: 1,
      percent: 100
    })

    return {
      success: true,
      restoredFiles: files.length,
      deletedFiles: cleanupResult.deletedFiles,
      deletedDirs: cleanupResult.deletedDirs
    }
  } catch (err) {
    emit({
      phase: "error",
      message: err instanceof Error ? err.message : String(err),
      current: 0,
      total: 1,
      percent: 0
    })
    throw err
  } finally {
    await safeRemove(tmpManifest)

    for (const p of downloadedPackPaths) {
      await safeRemove(p)
    }

    await safeRemove(restorePackCacheDir)
  }
}

function shouldVerifyInBackground(filePath: string) {
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();

  if (
    normalized.startsWith("world/") ||
    normalized.startsWith("world_nether/") ||
    normalized.startsWith("world_the_end/") ||
    normalized.startsWith("logs/") ||
    normalized.startsWith("crash-reports/") ||
    normalized.startsWith(".restore-pack-cache/") ||
    normalized === ".backup-hash-cache.json"
  ) {
    return false;
  }

  if (
    normalized.startsWith("mods/") ||
    normalized.startsWith("config/") ||
    normalized.startsWith("plugins/") ||
    normalized.startsWith("libraries/")
  ) {
    return true;
  }

  return /\.(jar|json|toml|ya?ml|properties|txt|png)$/i.test(normalized);
}

export async function verifySnapshotRestoreV2({
  drive,
  snapshotFolderId,
  serverPath,
  accessToken,
  onProgress
}: {
  drive: any
  snapshotFolderId: string
  serverPath: string
  accessToken: string
  onProgress?: (progress: RestoreProgress) => void
}): Promise<RestoreVerificationResult & { checkedFiles: number }> {
  const tmpManifest = path.join(serverPath, ".verify-manifest.json")

  try {
    const manifestFile = await findFileByName(drive, snapshotFolderId, "manifest.json")
    if (!manifestFile) {
      throw new Error("manifest.json not found in snapshot")
    }

    onProgress?.({
      phase: "manifest",
      message: "Loading verification manifest",
      current: 0,
      total: 1,
      percent: 0
    })

    await downloadFile(accessToken, manifestFile.id, tmpManifest)

    const manifest = JSON.parse(fs.readFileSync(tmpManifest, "utf8"))
    const allFiles: ManifestFile[] = Array.isArray(manifest.files) ? manifest.files : []
    const files = allFiles.filter((file) => shouldVerifyInBackground(file.path))

    const verification = await verifyRestoredFiles({
      serverPath,
      files,
      onProgress
    })

    return {
      ...verification,
      checkedFiles: files.length
    }
  } finally {
    await safeRemove(tmpManifest)
  }
}