import axios from "axios";
import { createDriveClient } from "../googleAuth";

export type SnapshotManifestFile =
  | {
      path: string;
      size: number;
      hash: string;
      storage: "large-object";
      objectFileId: string;
      objectName: string;
    }
  | {
      path: string;
      size: number;
      hash: string;
      storage: "small-pack";
      packHash: string;
      packFileId: string;
      packFileName: string;
    };

export type SnapshotManifest = {
  snapshotId: string;
  serverId: string;
  createdAt: string;
  files: SnapshotManifestFile[];
};

export async function readSnapshotManifest({
  accessToken,
  snapshotFolderId,
}: {
  accessToken: string;
  snapshotFolderId: string;
}): Promise<SnapshotManifest | null> {
  const drive = createDriveClient(accessToken);

  const listRes = await drive.files.list({
    q: `'${snapshotFolderId}' in parents and name='manifest.json' and trashed=false`,
    fields: "files(id, name)",
    pageSize: 1,
  });

  const manifestFileId = listRes.data.files?.[0]?.id;
  if (!manifestFileId) return null;

  const res = await axios.get(
    `https://www.googleapis.com/drive/v3/files/${manifestFileId}?alt=media`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  return res.data as SnapshotManifest;
}