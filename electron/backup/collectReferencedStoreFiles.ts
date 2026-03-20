import { readSnapshotManifest } from "./readSnapshotManifest";
import type { SnapshotFolder } from "./listSnapshotFolders";

export async function collectReferencedStoreFiles({
  accessToken,
  snapshots,
}: {
  accessToken: string;
  snapshots: SnapshotFolder[];
}) {
  const referencedObjectFileIds = new Set<string>();
  const referencedPackFileIds = new Set<string>();

  for (const snapshot of snapshots) {
    const manifest = await readSnapshotManifest({
      accessToken,
      snapshotFolderId: snapshot.id,
    });

    if (!manifest?.files) continue;

    for (const file of manifest.files) {
      if (file.storage === "large-object" && file.objectFileId) {
        referencedObjectFileIds.add(file.objectFileId);
      }

      if (file.storage === "small-pack" && file.packFileId) {
        referencedPackFileIds.add(file.packFileId);
      }
    }
  }

  return {
    referencedObjectFileIds,
    referencedPackFileIds,
  };
}