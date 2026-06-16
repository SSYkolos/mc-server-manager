import { uploadResumableToDrive } from "../driveResumableUpload"

export type ObjectIndexEntry = {
  fileId: string
  name: string
  size: number
  timestamp?: number // <-- ADDED
}

export async function uploadLargeObjects({
  objects,
  accessToken,
  objectsFolderId,
  objectIndex
}: {
  objects: any[]
  accessToken: string
  objectsFolderId: string
  objectIndex: Record<string, ObjectIndexEntry>
}) {
  const jobs = []
  const seenHashes = new Set<string>()

  for (const obj of objects) {
    if (objectIndex[obj.hash]) continue
    if (seenHashes.has(obj.hash)) continue

    seenHashes.add(obj.hash)

    jobs.push(async () => {
      const fileName = `${obj.hash}.bin`

      const uploaded = await uploadResumableToDrive({
        accessToken,
        filePath: obj.path,
        fileName,
        parentId: objectsFolderId,
        onProgress: () => {}
      })

      const fileId = uploaded?.id
      if (!fileId) {
        throw new Error(`Large object upload returned no fileId for ${fileName}`)
      }

      objectIndex[obj.hash] = {
        fileId,
        name: fileName,
        size: obj.size,
        timestamp: Date.now() // <-- ADDED
      }
    })
  }

  return jobs
}