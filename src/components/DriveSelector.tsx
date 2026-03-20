import React, { useEffect, useState, useCallback } from "react";
import { db, auth } from "../firebase";
import { useAuthState } from "react-firebase-hooks/auth";
import { doc, getDoc } from "firebase/firestore";
import type { DriveInfo } from "../types/types";


export default function DriveSelector({
  onSelect,
  initialDriveId,
}: {
  onSelect: (driveId: string) => void;
  initialDriveId?: string;
}) {
  const [user] = useAuthState(auth);
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDrive, setSelectedDrive] = useState<string | undefined>(
    initialDriveId
  );

  const loadDrives = useCallback(async () => {
    if (!user) return;

    try {
      const userRef = doc(db, "users", user.uid);
      const userSnap = await getDoc(userRef);

      if (userSnap.exists()) {
        const data = userSnap.data();

        const driveList: DriveInfo[] = (data.drives || []).map((drive: any, index: number) => ({
          id: drive.driveId || String(index),
          displayName: drive.driveEmail || `Drive ${index + 1}`,
        }));

        setDrives(driveList);
      }
    } catch (err) {
      console.error("Error loading drives:", err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadDrives();
  }, [loadDrives]);

  const handleSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setSelectedDrive(val);
    onSelect(val);
  };

const handleLinkNewDrive = async () => {
  if (!user) return;

  try {
    // ✅ call the NEW ipcMain handler you created: "link-drive"
    // it should do OAuth in main and send tokens to backend itself
    const result = await window.electronAPI.linkDrive({
      uid: user.uid,
      serverId: undefined, // or your selected server id if you have it
    });

    if (!result?.success) throw new Error(result?.error || "Link failed");

    alert("Drive linked successfully!");
    loadDrives();
  } catch (err: any) {
    alert("OAuth failed: " + err.message);
  }
};

  return (
    <div className="space-y-2">
      <label className="block font-medium">Select Drive:</label>

      {loading ? (
        <p>🔄 Loading drives...</p>
      ) : drives.length === 0 ? (
        <p className="text-sm text-gray-500">
          ⚠️ No linked drives yet. Please link a new Google Drive.
        </p>
      ) : (
        <select
          value={selectedDrive || ""}
          onChange={handleSelectChange}
          className="border px-2 py-1 rounded w-full"
          disabled={loading}
        >
          <option value="">Select a drive</option>
          {drives.map((d) => (
            <option key={d.id} value={d.id}>
              {d.displayName}
            </option>
          ))}
        </select>
      )}

      <button
        type="button"
        onClick={handleLinkNewDrive}
        className="text-sm text-blue-600 underline hover:text-blue-800"
      >
        + Link new Google Drive
      </button>
    </div>
  );
}
