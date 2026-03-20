import axios from "axios"

export async function saveFileState({
  accessToken,
  fileId,
  data
}: {
  accessToken: string
  fileId: string
  data: any
}) {
  await axios.patch(
    `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
    JSON.stringify(data, null, 2),
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      }
    }
  )
}