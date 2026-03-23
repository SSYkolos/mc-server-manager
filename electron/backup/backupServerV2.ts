import fs from "fs"
import path from "path"

import { scanBackupFiles } from "./scanFiles"
import { buildSmallPacks } from "./buildSmallPack"
import { prepareLargeObjects } from "./largeObjectStore"
import { uploadLargeObjects } from "./uploadLargeObjects"
import { runUploadQueue } from "./uploadQueue"
import { getWorkerCount } from "./getWorkerCount"
import { createSnapshotManifest } from "./createSnapshotManifest"
import { loadObjectIndex } from "./loadObjectIndex"
import { saveObjectIndex } from "./saveObjectIndex"
import { ensureBackupStructure } from "./ensureBackupStructure"
import { uploadSmallPacks } from "./uploadSmallPacks"
import { uploadSnapshotManifest } from "./uploadSnapshotManifest"
import { loadPackIndex } from "./loadPackIndex"
import { savePackIndex } from "./savePackIndex"
import { loadHashCache } from "./loadHashCache"
import { saveHashCache } from "./saveHashCache"
import { loadFileState } from "./loadFileState"
import { saveFileState } from "./saveFileState"

async function safeRemove(p: string) {
  try {
    await fs.promises.rm(p, { recursive: true, force: true })
  } catch { }
}

function normalizeBackupPath(relPath: string) {
  return relPath.replace(/\\/g, "/")
}

function isWorldRootPath(relPath: string) {
  const p = normalizeBackupPath(relPath)
  return (
    p === "world" ||
    p.startsWith("world/") ||
    p === "world_nether" ||
    p.startsWith("world_nether/") ||
    p === "world_the_end" ||
    p.startsWith("world_the_end/")
  )
}

function canReuseSmallPackFile(args: {
  file: {
    path: string
    size: number
    hash: string
  }
  previousFileState: Record<string, any>
  packIndex: Record<
    string,
    {
      fileId: string
      name: string
      size: number
      entriesByPath?: Record<string, { size: number; hash: string }>
    }
  >
}) {
  const prev = args.previousFileState?.[args.file.path]

  if (!prev || prev.storage !== "small-pack" || !prev.packHash) {
    return false
  }

  const packMeta = args.packIndex?.[prev.packHash]
  if (!packMeta || !packMeta.fileId || !packMeta.entriesByPath) {
    return false
  }

  const entry = packMeta.entriesByPath[args.file.path]
  if (!entry) {
    return false
  }

  if (entry.size !== args.file.size) {
    return false
  }

  if (entry.hash !== args.file.hash) {
    return false
  }

  return true
}

function isWorldChunkLikePath(relPath: string) {
  const p = normalizeBackupPath(relPath)

  if (!isWorldRootPath(p)) return false

  return (
    p.includes("/region/") ||
    p.includes("/entities/") ||
    p.includes("/poi/")
  )
}

type BackupProgressPhase =
  | "scanning"
  | "packing"
  | "uploading"
  | "saving-indexes"
  | "snapshot"
  | "finalizing"
  | "done"
  | "error";

type BackupProgressPayload = {
  phase: BackupProgressPhase;
  percent: number;
  title?: string;
  message?: string;
  detail?: string;
  uploaded?: number;
  total?: number;
};

export async function backupServerV2({
  serverPath,
  serverId,
  accessToken,
  driveBackupFolderId,
  retention,
  onProgress,
}: {
  serverPath: string
  serverId: string
  accessToken: string
  driveBackupFolderId: string
  retention: number
  onProgress?: (progress: BackupProgressPayload) => void
}) {
  console.log("BACKUP V2 START")
  console.log("BACKUP V2 NEW OPTIMIZED BUILD ACTIVE")
  const emit = (progress: BackupProgressPayload) => {
    onProgress?.({
      title: "Backup",
      ...progress,
    });
  };

  emit({
    phase: "scanning",
    percent: 6,
    message: "Scanning files",
    detail: "Reading local files and backup state",
  });
  const structure = await ensureBackupStructure({
    accessToken,
    serverRootFolderId: driveBackupFolderId
  })

  const objectIndex = await loadObjectIndex({
    accessToken,
    fileId: structure.objectIndexFileId
  })

  const packIndex = await loadPackIndex({
    accessToken,
    fileId: structure.packIndexFileId
  })
  const previousFileState = await loadFileState({
    accessToken,
    fileId: structure.fileStateFileId
  })

  const hashCachePath = path.join(serverPath, ".backup-hash-cache.json")
  const previousHashCache = await loadHashCache(hashCachePath)

  let nextHashCache: Record<string, any> = {}

  const {
    files,
    nextHashCache: computedNextHashCache,
    stats
  } = await scanBackupFiles(serverPath, previousHashCache)

  nextHashCache = computedNextHashCache
  emit({
    phase: "packing",
    percent: 22,
    message: "Building small packs",
    detail: `${files.length} files scanned`,
  });

  console.log("FILES FOUND:", files.length)
  console.log("HASH REUSED EXACT:", stats.exactReuseCount)
  console.log("HASH REUSED FAST:", stats.fastReuseCount)
  console.log("HASH STRONG REHASHED:", stats.strongRehashCount)
  console.log(
    "HASH TOTAL REUSED:",
    stats.exactReuseCount + stats.fastReuseCount
  )
  console.log("OBJECT INDEX SIZE:", Object.keys(objectIndex).length)
  console.log("PACK INDEX SIZE:", Object.keys(packIndex).length)
  console.log("RETENTION TARGET:", retention)

  const worldChunkFiles = files.filter((f: any) => isWorldChunkLikePath(f.path))
  const nonChunkFiles = files.filter((f: any) => !isWorldChunkLikePath(f.path))

  const metadataPackFiles = nonChunkFiles.filter(
    (f: any) => f.size < 64 * 1024 * 1024
  )

  const otherLargeFiles = nonChunkFiles.filter(
    (f: any) => f.size >= 64 * 1024 * 1024
  )

  const largeObjectInputs = [...worldChunkFiles, ...otherLargeFiles]

  const unchangedSmallFiles = metadataPackFiles.filter((file: any) => {
    const prev = previousFileState?.[file.path]

    if (
      !prev ||
      prev.storage !== "small-pack" ||
      prev.hash !== file.hash ||
      prev.size !== file.size
    ) {
      return false
    }

    return canReuseSmallPackFile({
      file,
      previousFileState,
      packIndex
    })
  })

  const changedSmallFiles = metadataPackFiles.filter(
    (file: any) => !unchangedSmallFiles.some((f: any) => f.path === file.path)
  )

  const tempDir = path.join(serverPath, ".backup-temp")
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true })
  }

  try {
    emit({
      phase: "packing",
      percent: 32,
      message: "Building small packs",
      detail: `${changedSmallFiles.length} changed small files, ${unchangedSmallFiles.length} reused`,
    })
    const smallPacks = await buildSmallPacks(changedSmallFiles, tempDir)

    const uploadedSmallPacks = await uploadSmallPacks({
      packs: smallPacks,
      accessToken,
      packsFolderId: structure.packsSmall,
      packIndex
    })
    emit({
      phase: "uploading",
      percent: 52,
      message: "Uploading changed data",
      detail: `${smallPacks.length} pack(s), ${largeObjectInputs.length} large object candidate(s)`,
    })
    const largeObjects = await prepareLargeObjects(largeObjectInputs)

    const uploadJobs = await uploadLargeObjects({
      objects: largeObjects,
      accessToken,
      objectsFolderId: structure.objectsLarge,
      objectIndex
    })

    await runUploadQueue(uploadJobs, getWorkerCount(uploadJobs.length))
    emit({
      phase: "saving-indexes",
      percent: 74,
      message: "Saving indexes",
      detail: "Updating object and pack indexes",
    })
    await saveObjectIndex({
      accessToken,
      fileId: structure.objectIndexFileId,
      data: objectIndex
    })

    await savePackIndex({
      accessToken,
      fileId: structure.packIndexFileId,
      data: packIndex
    })
    emit({
      phase: "snapshot",
      percent: 86,
      message: "Writing snapshot",
      detail: "Preparing manifest",
    })
    const snapshotId = (() => {
      const now = new Date()
      return (
        `${now.getFullYear()}-` +
        `${String(now.getMonth() + 1).padStart(2, "0")}-` +
        `${String(now.getDate()).padStart(2, "0")}T` +
        `${String(now.getHours()).padStart(2, "0")}-` +
        `${String(now.getMinutes()).padStart(2, "0")}-` +
        `${String(now.getSeconds()).padStart(2, "0")}`
      )
    })()

    const snapshotDir = path.join(tempDir, snapshotId)
    fs.mkdirSync(snapshotDir, { recursive: true })

    const pathToPack: Record<
      string,
      { fileId: string; fileName: string; packHash: string }
    > = {}

    // 1) Reuse unchanged small files from previous file-state + current pack index
    for (const file of unchangedSmallFiles) {
      const prev = previousFileState?.[file.path]

      if (!prev || prev.storage !== "small-pack" || !prev.packHash) {
        throw new Error(`Missing reusable pack metadata for ${file.path}`)
      }

      const packMeta = packIndex[prev.packHash]

      if (!packMeta || !packMeta.fileId || !packMeta.entriesByPath) {
        throw new Error(`Missing packIndex entry for ${file.path}`)
      }

      const entry = packMeta.entriesByPath[file.path]
      if (!entry) {
        throw new Error(`Pack membership missing for ${file.path}`)
      }

      if (entry.size !== file.size || entry.hash !== file.hash) {
        throw new Error(`Pack membership mismatch for ${file.path}`)
      }

      pathToPack[file.path] = {
        fileId: packMeta.fileId,
        fileName: packMeta.name,
        packHash: prev.packHash
      }
    }

    // 2) Add newly uploaded/reused changed packs
    for (const pack of uploadedSmallPacks) {
      for (const entry of pack.entries) {
        pathToPack[entry.path] = {
          fileId: pack.fileId,
          fileName: pack.fileName,
          packHash: pack.packHash
        }
      }
    }

    const largeEntries = largeObjects.map((obj: any) => {
      const relPath =
        files.find((f: any) => f.absolute === obj.path)?.path || ""

      const objectMeta = objectIndex[obj.hash]

      if (!objectMeta?.fileId) {
        throw new Error(`Missing object index entry for hash ${obj.hash}`)
      }

      return {
        path: relPath,
        size: obj.size,
        hash: obj.hash,
        storage: "large-object" as const,
        objectFileId: objectMeta.fileId,
        objectName: objectMeta.name
      }
    })

    // ✅ FIX: add hash to small entries
    const smallEntries = metadataPackFiles.map((file: any) => {
      const packMeta = pathToPack[file.path]

      if (!packMeta?.fileId) {
        throw new Error(`Missing pack entry for ${file.path}`)
      }

      return {
        path: file.path,
        size: file.size,
        hash: file.hash,
        storage: "small-pack" as const,
        packHash: packMeta.packHash,
        packFileId: packMeta.fileId,
        packFileName: packMeta.fileName
      }
    })

    createSnapshotManifest({
      snapshotId,
      serverId,
      files: [...smallEntries, ...largeEntries],
      snapshotDir
    })

    const manifestPath = path.join(snapshotDir, "manifest.json")
    emit({
      phase: "snapshot",
      percent: 92,
      message: "Writing snapshot",
      detail: `Uploading snapshot ${snapshotId}`,
    })
    await uploadSnapshotManifest({
      accessToken,
      snapshotsFolderId: structure.snapshots,
      snapshotId,
      manifestPath
    })
    const nextFileState: Record<string, any> = {}

    for (const file of metadataPackFiles) {
      const packMeta = pathToPack[file.path]

      if (!packMeta) {
        throw new Error(`Missing final small-pack mapping for ${file.path}`)
      }

      nextFileState[file.path] = {
        path: file.path,
        size: file.size,
        mtimeMs: file.mtimeMs,
        hash: file.hash,
        storage: "small-pack",
        packHash: packMeta.packHash
      }
    }

    for (const file of largeObjectInputs) {
      nextFileState[file.path] = {
        path: file.path,
        size: file.size,
        mtimeMs: file.mtimeMs,
        hash: file.hash,
        storage: "large-object"
      }
    }
    emit({
      phase: "finalizing",
      percent: 97,
      message: "Finalizing backup",
      detail: "Saving file-state cache",
    })
    await saveFileState({
      accessToken,
      fileId: structure.fileStateFileId,
      data: nextFileState
    })

    console.log("SMALL PACK DEBUG", {
      totalSmall: metadataPackFiles.length,
      changedSmall: changedSmallFiles.length,
      reusedSmall: unchangedSmallFiles.length
    })
    console.log("BACKUP V2 DONE", {
      snapshotId,
      files: files.length,
      smallPackFiles: metadataPackFiles.length,
      largeObjectFiles: largeObjectInputs.length
    })
    emit({
      phase: "done",
      percent: 100,
      message: "Backup completed",
      detail: `Snapshot ${snapshotId} created`,
    })
  } finally {
    await saveHashCache(hashCachePath, nextHashCache)
    await safeRemove(tempDir)
  }
}