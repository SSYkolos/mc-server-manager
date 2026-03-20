import fs from "fs";
import path from "path";
import archiver from "archiver";
import fetch from "node-fetch";
import { ensureDriveFolderPath } from "./driveFolderManager";
import { PassThrough } from "stream";
import { ensureServerBackupFolder } from "./driveFolderManager";



/**
 * Generate timestamp string YYYYMMDD_HHMMSS
 */
function timestamp() {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return (
    now.getFullYear() +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    "_" +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    pad(now.getSeconds())
  );
}

/**
 * Start a resumable upload session
 */
async function startResumableUpload({
  accessToken,
  fileName,
  parentFolderId,
  mimeType = "application/zip",
}: {
  accessToken: string;
  fileName: string;
  parentFolderId: string;
  mimeType?: string;
}) {
  const url = `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": mimeType,
    },
    body: JSON.stringify({ name: fileName, parents: [parentFolderId] }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to start upload session: ${err}`);
  }

  const uploadUrl = res.headers.get("location");
  if (!uploadUrl) throw new Error("No upload URL returned by Drive");
  return uploadUrl;
}

/**
 * Stream folder directly to Google Drive via resumable upload
 */
export async function uploadFolderStream({
  folderPath,
  accessToken,
  fileName,
  parentFolderId,
  onProgress,
}: {
  folderPath: string;
  accessToken: string;
  fileName: string;
  parentFolderId: string;
  onProgress?: (uploadedBytes: number) => void;
}) {
  const archive = archiver("zip", { zlib: { level: 9 } });
  const passThrough = new PassThrough();

  // Pipe archive into passThrough
  archive.pipe(passThrough);

  // Add folder contents
  archive.directory(folderPath, false);
  archive.finalize();

  const uploadUrl = await startResumableUpload({ accessToken, fileName, parentFolderId });

  // Stream upload with fetch
  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "application/zip",
      "Content-Transfer-Encoding": "binary",
    },
    body: passThrough,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Upload failed: ${errText}`);
  }

  const data = await res.json();
  return data.id;
}

/**
 * Delete a file from Drive by ID
 */
export async function deleteDriveFile(fileId: string, accessToken: string) {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to delete file ${fileId}: ${errText}`);
  }
}

/**
 * Backup server folder directly to Drive
 */
export async function backupServer({
  serverPath,
  serverId,
  loader,
  accessToken,
  maxBackups = 2,
}: {
  serverPath: string;
  serverId: string;
  loader: string;
  accessToken: string;
  maxBackups?: number;
}) {
  if (!fs.existsSync(serverPath)) throw new Error("Server path does not exist");

  const ts = timestamp();
  const backupName = `${serverId}_backup_${ts}.zip`;

  // 1️⃣ Ensure Drive folder exists
  const serverFolderId = await ensureServerBackupFolder({ serverId, loader, accessToken });

  // 2️⃣ Upload folder stream
  const fileId = await uploadFolderStream({
    folderPath: serverPath,
    accessToken,
    fileName: backupName,
    parentFolderId: serverFolderId,
  });

  // 3️⃣ List all backups to enforce maxBackups
  const query = `'${serverFolderId}' in parents and name contains '${serverId}_backup_' and trashed = false`;
  const listRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const listData = await listRes.json();
  let files: { id: string; name: string }[] = listData.files || [];

  // Sort descending by name (timestamp)
  files.sort((a, b) => (a.name < b.name ? 1 : -1));

  // Delete older backups
  if (files.length > maxBackups) {
    const toDelete = files.slice(maxBackups);
    for (const f of toDelete) await deleteDriveFile(f.id, accessToken);
  }

  files = files.slice(0, maxBackups);
  return files.map(f => ({ name: f.name, id: f.id }));
}
