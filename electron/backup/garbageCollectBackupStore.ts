import { createDriveClient } from "../googleAuth";
import { ensureBackupStructure } from "./ensureBackupStructure";
import { loadObjectIndex } from "./loadObjectIndex";
import { saveObjectIndex } from "./saveObjectIndex";
import { loadPackIndex } from "./loadPackIndex";
import { savePackIndex } from "./savePackIndex";

export async function garbageCollectBackupStore({
  accessToken,
  serverRootFolderId,
  referencedObjectFileIds,
  referencedPackFileIds,
}: {
  accessToken: string;
  serverRootFolderId: string;
  referencedObjectFileIds: Set<string>;
  referencedPackFileIds: Set<string>;
}) {
  const drive = createDriveClient(accessToken);

  const structure = await ensureBackupStructure({
    accessToken,
    serverRootFolderId,
  });

  const objectIndex = await loadObjectIndex({
    accessToken,
    fileId: structure.objectIndexFileId,
  });

  const packIndex = await loadPackIndex({
    accessToken,
    fileId: structure.packIndexFileId,
  });

  let deletedObjects = 0;
  let deletedPacks = 0;

  // 15 Minutes in milliseconds
  const GRACE_PERIOD_MS = 15 * 60 * 1000;
  const now = Date.now();

  for (const [hash, entry] of Object.entries(objectIndex)) {
    const fileId = (entry as any)?.fileId;
    if (!fileId) continue;

    // --- ADDED: Skip if the file is newer than 15 minutes ---
    const timestamp = (entry as any)?.timestamp;
    if (timestamp && (now - timestamp < GRACE_PERIOD_MS)) {
      continue;
    }

    if (!referencedObjectFileIds.has(fileId)) {
      try {
        await drive.files.delete({ fileId });
      } catch {
        // ignore if already gone
      }
      delete (objectIndex as any)[hash];
      deletedObjects++;
    }
  }

  for (const [packHash, entry] of Object.entries(packIndex)) {
    const fileId = (entry as any)?.fileId;
    if (!fileId) continue;

    // --- ADDED: Skip if the file is newer than 15 minutes ---
    const timestamp = (entry as any)?.timestamp;
    if (timestamp && (now - timestamp < GRACE_PERIOD_MS)) {
      continue;
    }

    if (!referencedPackFileIds.has(fileId)) {
      try {
        await drive.files.delete({ fileId });
      } catch {
        // ignore if already gone
      }
      delete (packIndex as any)[packHash];
      deletedPacks++;
    }
  }

  await saveObjectIndex({
    accessToken,
    fileId: structure.objectIndexFileId,
    data: objectIndex,
  });

  await savePackIndex({
    accessToken,
    fileId: structure.packIndexFileId,
    data: packIndex,
  });

  return {
    deletedObjects,
    deletedPacks,
  };
}