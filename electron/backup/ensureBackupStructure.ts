import axios from "axios"

async function ensureFolder(
  accessToken: string,
  parentId: string,
  name: string
): Promise<string> {
  const findRes = await axios.get(
    "https://www.googleapis.com/drive/v3/files",
    {
      params: {
        q: `name='${name}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        fields: "files(id,name)",
        pageSize: 10
      },
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    }
  )

  const found = findRes.data.files?.[0]?.id
  if (found) return found

  const createRes = await axios.post(
    "https://www.googleapis.com/drive/v3/files",
    {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId]
    },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      }
    }
  )

  if (!createRes.data?.id) {
    throw new Error(`Failed to create folder: ${name}`)
  }

  return createRes.data.id
}

async function ensureJsonFile(
  accessToken: string,
  parentId: string,
  name: string,
  initialData: any
): Promise<string> {
  const findRes = await axios.get(
    "https://www.googleapis.com/drive/v3/files",
    {
      params: {
        q: `name='${name}' and '${parentId}' in parents and trashed=false`,
        fields: "files(id,name)",
        pageSize: 10
      },
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    }
  )

  const found = findRes.data.files?.[0]?.id
  if (found) return found

  const createRes = await axios.post(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
    createMultipartBody(name, parentId, initialData),
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "multipart/related; boundary=foo_bar_baz"
      }
    }
  )

  if (!createRes.data?.id) {
    throw new Error(`Failed to create json file: ${name}`)
  }

  return createRes.data.id
}

function createMultipartBody(name: string, parentId: string, json: any) {
  return [
    "--foo_bar_baz",
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify({
      name,
      parents: [parentId]
    }),
    "--foo_bar_baz",
    "Content-Type: application/json",
    "",
    JSON.stringify(json, null, 2),
    "--foo_bar_baz--"
  ].join("\r\n")
}

export async function ensureBackupStructure({
  accessToken,
  serverRootFolderId
}: {
  accessToken: string
  serverRootFolderId: string
}) {
  const backupStore = await ensureFolder(accessToken, serverRootFolderId, "backup-store")
  const snapshots = await ensureFolder(accessToken, backupStore, "snapshots")
  const objectsLarge = await ensureFolder(accessToken, backupStore, "objects-large")
  const packsSmall = await ensureFolder(accessToken, backupStore, "packs-small")
  const indexes = await ensureFolder(accessToken, backupStore, "indexes")

  const objectIndexFileId = await ensureJsonFile(
    accessToken,
    indexes,
    "objects.json",
    {}
  )

  const packIndexFileId = await ensureJsonFile(
    accessToken,
    indexes,
    "packs.json",
    {}
  )

  const fileStateFileId = await ensureJsonFile(
    accessToken,
    indexes,
    "file-state.json",
    {}
  )

  return {
    backupStore,
    snapshots,
    objectsLarge,
    packsSmall,
    indexes,
    objectIndexFileId,
    packIndexFileId,
    fileStateFileId
  }
}