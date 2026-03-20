import { createDriveClient } from "../googleAuth";
import { ensureDriveFolderPath } from "../driveFolderManager";

export type SnapshotFolder = {
  id: string;
  name: string;
  createdTime?: string | null;
};

async function findChildFolderByName(
  drive: any,
  parentId: string,
  folderName: string
) {
  const res = await drive.files.list({
    q: `'${parentId}' in parents and name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: "files(id, name)",
    pageSize: 1,
  });

  return res.data.files?.[0] ?? null;
}

export async function listSnapshotFolders({
  accessToken,
  serverId,
  loader,
}: {
  accessToken: string;
  serverId: string;
  loader: string;
}): Promise<SnapshotFolder[]> {
  const drive = createDriveClient(accessToken);

  const serverRootId = await ensureDriveFolderPath({
    accessToken,
    serverId,
    loader,
  });

  const backupStore = await findChildFolderByName(drive, serverRootId, "backup-store");
  if (!backupStore?.id) return [];

  const snapshotsFolder = await findChildFolderByName(drive, backupStore.id, "snapshots");
  if (!snapshotsFolder?.id) return [];

  const res = await drive.files.list({
    q: `'${snapshotsFolder.id}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: "files(id, name, createdTime)",
    orderBy: "createdTime desc",
    pageSize: 1000,
  });

  return (res.data.files ?? [])
    .filter((f) => !!f.id && !!f.name)
    .map((f) => ({
      id: f.id!,
      name: f.name!,
      createdTime: f.createdTime ?? null,
    }));
}