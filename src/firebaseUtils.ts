import { getAuth } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { db } from "./firebase"; // adjust path if needed

export async function getMyUidAndRole(serverId: string) {
  const user = getAuth().currentUser;
  if (!user) return null;

  const snap = await getDoc(doc(db, "servers", serverId));
  if (!snap.exists()) return null;

  return {
    uid: user.uid,
    role: snap.data()?.users?.[user.uid]?.role ?? null,
  };
}

export async function getZipFileId(serverId: string): Promise<string | null> {
  const serverDocRef = doc(db, "servers", serverId);
  const serverSnap = await getDoc(serverDocRef);
  if (serverSnap.exists()) {
    const data = serverSnap.data();
    return data.zipFileId ?? null;
  }
  return null;
}