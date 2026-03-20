import axios from "axios"

export async function saveObjectIndex({
  accessToken,
  fileId,
  data
}:{
  accessToken: string
  fileId: string
  data: any
}) {
  const safeData =
    data && typeof data === "object" && !Array.isArray(data)
      ? data
      : {}

  await axios.patch(
    `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
    JSON.stringify(safeData, null, 2),
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      }
    }
  )
}