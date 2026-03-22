import axios from "axios"

export type FileStateEntry =
  | {
      path: string
      size: number
      mtimeMs: number
      hash: string
      storage: "large-object"
    }
  | {
      path: string
      size: number
      mtimeMs: number
      hash: string
      storage: "small-pack"
      packHash: string
    }

export async function loadFileState({
  accessToken,
  fileId
}: {
  accessToken: string
  fileId: string
}): Promise<Record<string, FileStateEntry>> {
  try {
    const meta = await axios.get(
      `https://www.googleapis.com/drive/v3/files/${fileId}`,
      {
        params: { fields: "id,name,size" },
        headers: { Authorization: `Bearer ${accessToken}` }
      }
    )

    const size = Number(meta.data?.size ?? 0)
    if (!size) return {}

    const res = await axios.get(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      {
        headers: { Authorization: `Bearer ${accessToken}` }
      }
    )

    return res.data || {}
  } catch {
    return {}
  }
}