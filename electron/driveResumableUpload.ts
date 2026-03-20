import fs from "fs";
import axios from "axios";

const CHUNK_SIZE = 16 * 1024 * 1024; // 16 MB

export type DriveUploadedFile = {
  id: string;
  name?: string;
};

export async function uploadResumableToDrive({
  accessToken,
  filePath,
  fileName,
  parentId,
  onProgress,
}: {
  accessToken: string;
  filePath: string;
  fileName: string;
  parentId: string;
  onProgress: (uploaded: number, total: number) => void;
}): Promise<DriveUploadedFile> {
  const fileSize = fs.statSync(filePath).size;

  const initRes = await axios.post(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable",
    {
      name: fileName,
      parents: [parentId],
    },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": "application/octet-stream",
        "X-Upload-Content-Length": fileSize,
      },
    }
  );

  const uploadUrl = initRes.headers.location;
  if (!uploadUrl) {
    throw new Error("No resumable upload URL");
  }

  // special case: empty file
  if (fileSize === 0) {
    const res = await axios.put(uploadUrl, "", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Length": 0,
        "Content-Range": "bytes */0",
      },
      validateStatus: (status) => status >= 200 && status < 300,
    });

    if (!res.data?.id) {
      throw new Error(`Zero-byte upload finished but Drive did not return file metadata for ${fileName}`);
    }

    onProgress(0, 0);

    return {
      id: res.data.id,
      name: res.data.name ?? fileName,
    };
  }

  const stream = fs.createReadStream(filePath, { highWaterMark: CHUNK_SIZE });
  let offset = 0;
  let finalResponseData: any = null;

  for await (const chunk of stream) {
    const start = offset;
    const end = offset + chunk.length - 1;
    const isLastChunk = end + 1 === fileSize;

    const res = await axios.put(uploadUrl, chunk, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Length": chunk.length,
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      validateStatus: (status) =>
        (status >= 200 && status < 300) || status === 308,
    });

    if (isLastChunk && res.status >= 200 && res.status < 300) {
      finalResponseData = res.data;
    }

    offset += chunk.length;
    onProgress(offset, fileSize);
  }

  if (!finalResponseData?.id) {
    throw new Error(`Upload finished but Drive did not return file metadata for ${fileName}`);
  }

  return {
    id: finalResponseData.id,
    name: finalResponseData.name ?? fileName,
  };
}