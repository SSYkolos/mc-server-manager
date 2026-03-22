import axios from "axios"

export type PackIndexEntry = {
  fileId: string
  name: string
  size: number
  entriesByPath?: Record<
    string,
    {
      size: number
      hash: string
    }
  >
}

export async function loadPackIndex({
  accessToken,
  fileId
}: {
  accessToken: string
  fileId: string
}): Promise<Record<string, PackIndexEntry>> {
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