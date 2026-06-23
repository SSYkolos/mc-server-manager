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
import { zipDirectory } from "./zipHelper";
import { applyRetention } from "./applyRetention";
import axios from "axios";

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

// Helper to construct Google Drive multipart requests
function createMultipartBody(name: string, parentId: string, json: any = {}) {
  return [
    "--foo_bar_baz",
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify({ name, parents: [parentId] }),
    "--foo_bar_baz",
    "Content-Type: application/json",
    "",
    JSON.stringify(json, null, 2),
    "--foo_bar_baz--"
  ].join("\r\n");
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
  console.log("BACKUP V2 NEW OPTIMIZED BUILD ACTIVE")
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
    const smallPacks = await buildSmallPacks(changedSmallFiles, tempDir)

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

    // ==========================================
    // 0. CREATE SNAPSHOT FOLDER IN DRIVE FIRST
    // ==========================================
    console.log("[Backup] Creating Drive Snapshot Folder...");
    const driveSnapshotFolderRes = await axios.post(
      "https://www.googleapis.com/drive/v3/files",
      {
        name: snapshotId,
        mimeType: "application/vnd.google-apps.folder",
        parents: [structure.snapshots]
      },
      { headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" } }
    );
    const targetSnapshotFolderId = driveSnapshotFolderRes.data.id;

    const pathToPack: Record<
      string,
      { fileId: string; fileName: string; packHash: string }
    > = {}

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

    // ==========================================
    // 1. THE CONFIG & PLUGIN DUAL-UPLOAD
    // ==========================================
    console.log("[Backup] Zipping Configs and Plugins...");
    const tempConfigsZip = path.join(serverPath, ".temp-configs.zip");
    const tempPluginsZip = path.join(serverPath, ".temp-plugins.zip");

    const hasConfigs = await zipDirectory(path.join(serverPath, "config"), tempConfigsZip);
    const hasPlugins = await zipDirectory(path.join(serverPath, "plugins"), tempPluginsZip);

    const uploadDualStateZip = async (filePath: string, fileName: string) => {
      const fileStat = fs.statSync(filePath);

      // A. Upload to Snapshot Folder (For the Backup) - HASZNÁLJUK AZ ÚJ ID-T!
      let res = await axios.post(
        "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
        createMultipartBody(fileName, targetSnapshotFolderId, {}),
        { headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "multipart/related; boundary=foo_bar_baz" } }
      );
      await axios.patch(`https://www.googleapis.com/upload/drive/v3/files/${res.data.id}?uploadType=media`, fs.createReadStream(filePath), {
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Length": fileStat.size }
      });

      // B. Upload/Overwrite to Server Root (The "Live Head" for your UI Editor)
      const searchRes = await axios.get("https://www.googleapis.com/drive/v3/files", {
        params: { q: `'${driveBackupFolderId}' in parents and name='live-${fileName}' and trashed=false` },
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const existingLiveId = searchRes.data.files?.[0]?.id;

      if (existingLiveId) {
        await axios.patch(`https://www.googleapis.com/upload/drive/v3/files/${existingLiveId}?uploadType=media`, fs.createReadStream(filePath), {
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Length": fileStat.size }
        });
      } else {
        res = await axios.post(
          "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
          createMultipartBody(`live-${fileName}`, driveBackupFolderId, {}),
          { headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "multipart/related; boundary=foo_bar_baz" } }
        );
        await axios.patch(`https://www.googleapis.com/upload/drive/v3/files/${res.data.id}?uploadType=media`, fs.createReadStream(filePath), {
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Length": fileStat.size }
        });
      }
    };

    if (hasConfigs) {
      await uploadDualStateZip(tempConfigsZip, "configs.zip");
      fs.rmSync(tempConfigsZip, { force: true });
    }
    if (hasPlugins) {
      await uploadDualStateZip(tempPluginsZip, "plugins.zip");
      fs.rmSync(tempPluginsZip, { force: true });
    }
    console.log("[Backup] Live Head and Snapshot Configs Secured.");

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

    // ==========================================
    // 2. THE RETENTION LOGIC
    // ==========================================
    if (retention > 0) {
      console.log(`[Backup] Enforcing retention limit of ${retention}...`);
      const snapshotsRes = await axios.get("https://www.googleapis.com/drive/v3/files", {
        params: { 
          q: `'${structure.snapshots}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`, 
          fields: "files(id, name)" 
        },
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      
      const allSnapshots = snapshotsRes.data.files || [];
      
      const snapshotNames = allSnapshots.map((s: any) => s.name);
      const namesToDelete = applyRetention(snapshotNames, retention);
      
      const idsToDelete = allSnapshots
        .filter((s: any) => namesToDelete.includes(s.name))
        .map((s: any) => s.id);
      
      for (const idToDelete of idsToDelete) {
        console.log(`[Backup] Deleting old snapshot folder: ${idToDelete}`);
        await axios.delete(`https://www.googleapis.com/drive/v3/files/${idToDelete}`, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
      }
    }
    
  } finally {
    await saveHashCache(hashCachePath, nextHashCache)
    await safeRemove(tempDir)
  }
}