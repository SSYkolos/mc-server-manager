import fs from "fs"
import path from "path"

import { scanBackupFiles } from "./scanFiles"
import { buildSmallPacks } from "./buildSmallPack"
import { prepareLargeObjects } from "./largeObjectStore"
import { uploadLargeObjects } from "./uploadLargeObjects"
import { runUploadQueue } from "./uploadQueue"
import { getWorkerCount } from "./getWorkerCount"
import { createSnapshotManifest } from "./createSnapshotManifest"
import { applyRetention } from "./applyRetention"
import { loadObjectIndex } from "./loadObjectIndex"
import { saveObjectIndex } from "./saveObjectIndex"
import { ensureBackupStructure } from "./ensureBackupStructure"
import { uploadSmallPacks } from "./uploadSmallPacks"
import { uploadSnapshotManifest } from "./uploadSnapshotManifest"
import { loadPackIndex } from "./loadPackIndex"
import { savePackIndex } from "./savePackIndex"
import { loadFileState } from "./loadFileState"
import { saveFileState } from "./saveFileState"

async function safeRemove(p: string) {
  try {
    await fs.promises.rm(p, { recursive: true, force: true })
  } catch {
    // ignore cleanup errors
  }
}

function isWorldObjectPath(relPath: string) {
  const p = relPath.replace(/\\/g, "/")
  return (
    p === "world" ||
    p.startsWith("world/") ||
    p === "world_nether" ||
    p.startsWith("world_nether/") ||
    p === "world_the_end" ||
    p.startsWith("world_the_end/")
  )
}

export async function backupServerV2({
  serverPath,
  serverId,
  accessToken,
  driveBackupFolderId,
  retention
}: {
  serverPath: string
  serverId: string
  accessToken: string
  driveBackupFolderId: string
  retention: number
}) {
  console.log("BACKUP V2 START")

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

  const files = await scanBackupFiles(serverPath, previousFileState)

  const reusedHashes = files.filter((f) => f.hashReused).length
  const rehashedFiles = files.length - reusedHashes

  console.log("FILES FOUND:", files.length)
  console.log("HASH REUSED:", reusedHashes)
  console.log("HASH RECOMPUTED:", rehashedFiles)
  console.log("OBJECT INDEX SIZE:", Object.keys(objectIndex).length)
  console.log("PACK INDEX SIZE:", Object.keys(packIndex).length)

  const worldObjectFiles = files.filter((f) => isWorldObjectPath(f.path))
  const nonWorldFiles = files.filter((f) => !isWorldObjectPath(f.path))

  const metadataPackFiles = nonWorldFiles.filter((f) => f.size < 64 * 1024 * 1024)
  const otherLargeFiles = nonWorldFiles.filter((f) => f.size >= 64 * 1024 * 1024)

  const largeObjectInputs = [...worldObjectFiles, ...otherLargeFiles]

  const tempDir = path.join(serverPath, ".backup-temp")
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true })
  }

  try {
    const smallPacks = await buildSmallPacks(metadataPackFiles, tempDir)

    const uploadedSmallPacks = await uploadSmallPacks({
      packs: smallPacks,
      accessToken,
      packsFolderId: structure.packsSmall,
      packIndex
    })

    const largeObjects = await prepareLargeObjects(largeObjectInputs)

    const uploadJobs = await uploadLargeObjects({
      objects: largeObjects,
      accessToken,
      objectsFolderId: structure.objectsLarge,
      objectIndex
    })

    await runUploadQueue(uploadJobs, getWorkerCount(uploadJobs.length))

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

    const nextFileState: Record<string, any> = {}
    for (const file of files) {
      nextFileState[file.path] = {
        path: file.path,
        size: file.size,
        mtimeMs: file.mtimeMs,
        hash: file.hash,
        storage: isWorldObjectPath(file.path) || file.size >= 64 * 1024 * 1024
          ? "large-object"
          : "small-pack"
      }
    }

    await saveFileState({
      accessToken,
      fileId: structure.fileStateFileId,
      data: nextFileState
    })

    const now = new Date()
    const snapshotId =
      `${now.getFullYear()}-` +
      `${String(now.getMonth() + 1).padStart(2, "0")}-` +
      `${String(now.getDate()).padStart(2, "0")}T` +
      `${String(now.getHours()).padStart(2, "0")}-` +
      `${String(now.getMinutes()).padStart(2, "0")}-` +
      `${String(now.getSeconds()).padStart(2, "0")}`

    const snapshotDir = path.join(tempDir, snapshotId)
    fs.mkdirSync(snapshotDir, { recursive: true })

    const pathToPack: Record<string, { fileId: string; fileName: string; packHash: string }> = {}
    for (const pack of uploadedSmallPacks) {
      for (const entry of pack.entries) {
        pathToPack[entry.path] = {
          fileId: pack.fileId,
          fileName: pack.fileName,
          packHash: pack.packHash
        }
      }
    }

    const largeEntries = largeObjects.map((obj) => {
      const relPath = files.find((f) => f.absolute === obj.path)?.path || ""
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

    const smallEntries = metadataPackFiles.map((file) => {
      const packMeta = pathToPack[file.path]
      if (!packMeta?.fileId) {
        throw new Error(`Missing pack entry for ${file.path}`)
      }

      return {
        path: file.path,
        size: file.size,
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

    await uploadSnapshotManifest({
      accessToken,
      snapshotsFolderId: structure.snapshots,
      snapshotId,
      manifestPath
    })

    console.log("BACKUP V2 DONE")
  } finally {
    await safeRemove(tempDir)
  }
}