import fs from "fs"
import axios from "axios"
import { uploadResumableToDrive } from "../driveResumableUpload"
import { BuiltSmallPack } from "./buildSmallPack"
import { runUploadQueue } from "./uploadQueue"
import { getWorkerCount } from "./getWorkerCount"

export type PackIndexEntry = {
  fileId: string
  name: string
  size: number
}

export type UploadedSmallPack = {
  localPath: string
  fileName: string
  fileId: string
  fileSize: number
  packHash: string
  entries: {
    path: string
    size: number
  }[]
}

export async function uploadSmallPacks({
  packs,
  accessToken,
  packsFolderId,
  packIndex
}: {
  packs: BuiltSmallPack[]
  accessToken: string
  packsFolderId: string
  packIndex: Record<string, PackIndexEntry>
}): Promise<UploadedSmallPack[]> {
  const uploaded: UploadedSmallPack[] = new Array(packs.length)

  const jobs = packs.map((pack, index) => async () => {
    const stat = fs.statSync(pack.packPath)

    if (packIndex[pack.packHash]) {
      uploaded[index] = {
        localPath: pack.packPath,
        fileName: packIndex[pack.packHash].name,
        fileId: packIndex[pack.packHash].fileId,
        fileSize: stat.size,
        packHash: pack.packHash,
        entries: pack.entries
      }
      return
    }

    const res = await uploadResumableToDrive({
      accessToken,
      filePath: pack.packPath,
      fileName: pack.fileName,
      parentId: packsFolderId,
      onProgress: () => {}
    })

    const fileId = res?.id
    if (!fileId) {
      throw new Error(`Small pack upload returned no fileId for ${pack.fileName}`)
    }

    packIndex[pack.packHash] = {
      fileId,
      name: pack.fileName,
      size: stat.size
    }

    uploaded[index] = {
      localPath: pack.packPath,
      fileName: pack.fileName,
      fileId,
      fileSize: stat.size,
      packHash: pack.packHash,
      entries: pack.entries
    }
  })

  await runUploadQueue(jobs, getWorkerCount(jobs.length))
  return uploaded.filter(Boolean)
}