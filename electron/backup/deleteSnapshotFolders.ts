import { createDriveClient } from "../googleAuth";

export async function deleteSnapshotFolders({
  accessToken,
  snapshotFolderIds,
}: {
  accessToken: string;
  snapshotFolderIds: string[];
}) {
  if (snapshotFolderIds.length === 0) return;

  const drive = createDriveClient(accessToken);

  for (const fileId of snapshotFolderIds) {
    await drive.files.delete({ fileId });
  }
}