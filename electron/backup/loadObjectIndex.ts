import axios from "axios"

export async function loadObjectIndex({
  accessToken,
  fileId
}:{
  accessToken: string
  fileId: string
}) {
  const res = await axios.get(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`
      },
      responseType: "text"
    }
  )

  const raw = typeof res.data === "string" ? res.data.trim() : ""

  if (!raw) {
    return {}
  }

  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}