import React, { useState } from "react";
import { auth } from "../firebase";
import { useAuthState } from "react-firebase-hooks/auth";
import { useServerData } from "../ServerDataContext"; // <--- Az Agy importálása

export default function DriveSelector({
  onSelect,
  initialDriveId,
}: {
  onSelect: (driveId: string) => void;
  initialDriveId?: string;
}) {
  const [user] = useAuthState(auth);
  
  // KÉRJÜK KI AZ ADATOT A RAM-BÓL (0 extra olvasás)
  const { drives: rawDrives, loading } = useServerData();

  const [selectedDrive, setSelectedDrive] = useState<string | undefined>(
    initialDriveId
  );

  // Formázzuk a memóriából kapott adatot a dropdown számára
  const formattedDrives = rawDrives.map((drive: any, index: number) => ({
    id: drive.driveId || String(index),
    displayName: drive.driveEmail || `Drive ${index + 1}`,
  }));

  const handleSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setSelectedDrive(val);
    onSelect(val);
  };

  const handleLinkNewDrive = async () => {
    if (!user) return;

    try {
      const result = await window.electronAPI.linkDrive({
        uid: user.uid,
        serverId: undefined, 
      });

      if (!result?.success) throw new Error(result?.error || "Link failed");

      alert("Drive linked successfully!");
      // NINCS loadDrives() hívás! A Firebase frissül, az Agy észreveszi, a dropdown azonnal megjeleníti!
    } catch (err: any) {
      alert("OAuth failed: " + err.message);
    }
  };

  return (
    <div className="space-y-2">
      <label className="block font-medium">Select Drive:</label>

      {loading ? (
        <p>🔄 Loading drives...</p>
      ) : formattedDrives.length === 0 ? (
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
          {formattedDrives.map((d) => (
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