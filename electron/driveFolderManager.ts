// src/driveFolderManager.ts
import { addServiceAccountToFolder } from "./addServiceAccount";


/**
 * Checks if a folder exists by name in a given parent folder, or creates it if missing.
 * Returns the folder ID.
 */
export async function getOrCreateFolder(
  name: string,
  parentId: string | null,
  accessToken: string,
): Promise<string> {
  const query = `'${parentId || "root"}' in parents and name = '${name}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;

  const searchUrl = new URL("https://www.googleapis.com/drive/v3/files");
  searchUrl.searchParams.append("q", query);
  searchUrl.searchParams.append("fields", "files(id,name)");

  const res = await fetch(searchUrl.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google Drive API error during folder search: ${errText}`);
  }

  const data = await res.json();

  if (data.files?.length > 0) {
    return data.files[0].id;
  }

  // Folder not found → create it
  const body: any = {
    name,
    mimeType: "application/vnd.google-apps.folder",
    parents: parentId ? [parentId] : [],
  };

  const createUrl = new URL("https://www.googleapis.com/drive/v3/files");

  const createRes = await fetch(createUrl.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!createRes.ok) {
    const errText = await createRes.text();
    console.error("❌ Failed to create folder:", errText);
    throw new Error(`Failed to create folder '${name}': ${errText}`);
  }

  const created = await createRes.json();

  if (!created.id) {
    throw new Error(`Failed to create folder '${name}': No ID returned`);
  }

  return created.id;
}

/**
 * Ensures the full folder path exists:
 * mc-server-manager / loader / serverId
 * Returns the final server folder ID.
 */
export async function ensureDriveFolderPath({
  accessToken,
  serverId,
  loader,
}: {
  accessToken: string;
  serverId: string;
  loader: string;
}): Promise<string> {
  const managerFolderId = await getOrCreateFolder("mc-server-manager", null, accessToken);
  const loaderFolderId = await getOrCreateFolder(loader, managerFolderId, accessToken);
  const serverFolderId = await getOrCreateFolder(serverId, loaderFolderId, accessToken);
  return serverFolderId;
}

/**
 * Ensures backup folder structure:
 * mc-server-manager / {loader} / {serverId} / backups
 * Returns the backups folder ID.
 */
export async function ensureServerBackupFolder({
  accessToken,
  loader,
  serverId,
}: {
  accessToken: string;
  loader: string;
  serverId: string;
}): Promise<string> {
  const managerFolderId = await getOrCreateFolder(
    "mc-server-manager",
    null,
    accessToken
  );

  const loaderFolderId = await getOrCreateFolder(
    loader,
    managerFolderId,
    accessToken
  );

  const serverFolderId = await getOrCreateFolder(
    serverId,
    loaderFolderId,
    accessToken
  );

  const backupsFolderId = await getOrCreateFolder(
    "backups",
    serverFolderId,
    accessToken
  );

await addServiceAccountToFolder(
  backupsFolderId,
  "firebase-adminsdk-fbsvc@mc-server-manager-6d2bc.iam.gserviceaccount.com",
  accessToken
);

  return backupsFolderId;
}


