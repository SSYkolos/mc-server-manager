import fs from "fs"
import path from "path"
import axios from "axios"
import { createWriteStream } from "fs"
import { pipeline } from "stream/promises"
import unzipper from "unzipper"
import { hashFile } from "./hashFile"
import { ensureBackupStructure } from "./ensureBackupStructure"
import { saveFileState } from "./saveFileState"

type RestoredFileStateEntry = {
  path: string
  size: number
  mtimeMs: number
  hash: string
  storage: "large-object" | "small-pack"
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

export async function restoreSnapshotV2({
  drive,
  snapshotFolderId,
  serverPath,
  accessToken,
  structure
}: {
  drive: any
  snapshotFolderId: string
  serverPath: string
  accessToken: string
  structure: any
}) {
  await fs.promises.mkdir(serverPath, { recursive: true })

  const tmpManifest = path.join(serverPath, ".restore-manifest.json")
  const restorePackCacheDir = path.join(serverPath, ".restore-pack-cache")
  const downloadedPackPaths: string[] = []

  try {
    const manifestFile = await findFileByName(
      drive,
      snapshotFolderId,
      "manifest.json"
    )

    if (!manifestFile) {
      throw new Error("manifest.json not found in snapshot")
    }

    await downloadFile(accessToken, manifestFile.id, tmpManifest)

    const manifest = JSON.parse(fs.readFileSync(tmpManifest, "utf8"))
    const files = manifest.files
    const packCache: Record<string, string> = {}
    const rebuiltFileState: Record<string, RestoredFileStateEntry> = {}

    for (const file of files) {
      const targetPath = path.join(serverPath, file.path)
      fs.mkdirSync(path.dirname(targetPath), { recursive: true })

      if (file.storage === "large-object") {
        await downloadFile(accessToken, file.objectFileId, targetPath)

        const stat = fs.statSync(targetPath)

        rebuiltFileState[file.path] = {
          path: file.path,
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          hash: file.hash,
          storage: "large-object"
        }
      }

      if (file.storage === "small-pack") {
        const cacheKey = file.packFileId

        if (!packCache[cacheKey]) {
          const localPackPath = path.join(serverPath, `.restore-${file.packFileName}`)
          downloadedPackPaths.push(localPackPath)

          await downloadFile(accessToken, file.packFileId, localPackPath)

          const extractDir = path.join(restorePackCacheDir, file.packHash)
          await fs.promises.mkdir(extractDir, { recursive: true })

          await fs
            .createReadStream(localPackPath)
            .pipe(unzipper.Extract({ path: extractDir }))
            .promise()

          packCache[cacheKey] = extractDir
        }

        const restoredFilePath = path.join(packCache[cacheKey], file.path)

        if (!fs.existsSync(restoredFilePath)) {
          throw new Error(`Missing entry in pack: ${file.path}`)
        }

        await fs.promises.copyFile(restoredFilePath, targetPath)

        const stat = fs.statSync(targetPath)
        const restoredHash = await hashFile(targetPath)

        rebuiltFileState[file.path] = {
          path: file.path,
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          hash: restoredHash,
          storage: "small-pack"
        }
      }
    }

    const ensuredStructure = structure ?? await ensureBackupStructure({
      accessToken,
      serverRootFolderId: snapshotFolderId
    })

    await saveFileState({
      accessToken,
      fileId: ensuredStructure.fileStateFileId,
      data: rebuiltFileState
    })
  } finally {
    await safeRemove(tmpManifest)

    for (const p of downloadedPackPaths) {
      await safeRemove(p)
    }

    await safeRemove(restorePackCacheDir)
  }
}