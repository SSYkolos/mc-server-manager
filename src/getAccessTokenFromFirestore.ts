import { doc, getDoc } from "firebase/firestore";
import { db } from "./firebase.js";

export async function getAccessTokenFromFirestore(userId: string, driveId: string): Promise<string | null> {
  const userRef = doc(db, "users", userId);
  const userSnap = await getDoc(userRef);

  if (!userSnap.exists()) return null;

  const drives = userSnap.data().drives;
  if (!Array.isArray(drives)) return null;

  const drive = drives.find((d) => d.driveId === driveId);
  if (!drive) return null;

  return drive.tokens?.access_token || null;
}
