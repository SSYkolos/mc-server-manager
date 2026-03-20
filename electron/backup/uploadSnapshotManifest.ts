import axios from "axios"
import fs from "fs"

async function findFolderByName(
  accessToken: string,
  parentId: string,
  name: string
): Promise<string | null> {
  const res = await axios.get(
    "https://www.googleapis.com/drive/v3/files",
    {
      params: {
        q: `name='${name}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        fields: "files(id,name)",
        pageSize: 10,
      },
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  )

  return res.data.files?.[0]?.id ?? null
}

async function createFolder(
  accessToken: string,
  parentId: string,
  name: string
): Promise<string> {
  const res = await axios.post(
    "https://www.googleapis.com/drive/v3/files",
    {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    }
  )

  if (!res.data?.id) {
    throw new Error(`Failed to create snapshot folder: ${name}`)
  }

  return res.data.id
}

async function ensureSnapshotFolder(
  accessToken: string,
  snapshotsFolderId: string,
  snapshotId: string
): Promise<string> {
  const existing = await findFolderByName(accessToken, snapshotsFolderId, snapshotId)
  if (existing) return existing
  return await createFolder(accessToken, snapshotsFolderId, snapshotId)
}

export async function uploadSnapshotManifest({
  accessToken,
  snapshotsFolderId,
  snapshotId,
  manifestPath
}:{
  accessToken: string
  snapshotsFolderId: string
  snapshotId: string
  manifestPath: string
}) {
  const snapshotFolderId = await ensureSnapshotFolder(
    accessToken,
    snapshotsFolderId,
    snapshotId
  )

  const manifestContent = fs.readFileSync(manifestPath, "utf8")

  const metadata = {
    name: "manifest.json",
    parents: [snapshotFolderId],
  }

  const boundary = "foo_bar_baz"
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: application/json\r\n\r\n` +
    `${manifestContent}\r\n` +
    `--${boundary}--`

  await axios.post(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
    body,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    }
  )
}