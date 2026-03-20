import React, { useEffect, useState } from "react";
import { Dialog } from "@headlessui/react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";
import { getValidAccessToken } from "../../electron/getValidAccessToken";


type Props = {
  serverId: string;
  user: any;
  onClose: () => void;
};

export default function HostServerModal({ serverId, user, onClose }: Props) {
  const [version, setVersion] = useState("");
  const [ram, setRam] = useState("2G");
  const [installPath, setInstallPath] = useState("");
  const [loading, setLoading] = useState(false);
  const [driveZipId, setDriveZipId] = useState("");
  const [serverMeta, setServerMeta] = useState<any>(null);
  const [backups, setBackups] = useState<any[]>([]);
  const [selectedBackupId, setSelectedBackupId] = useState<string | null>(null);

  // Fetch Firestore metadata
  useEffect(() => {
    async function fetchMeta() {
      try {
        const docRef = doc(db, "servers", serverId);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
          const data = docSnap.data();
          setServerMeta(data);
          setDriveZipId(data.zipFileId);
        } else {
          console.warn("Server not found");
        }
      } catch (err) {
        console.error("Error fetching Firestore metadata:", err);
      }
    }

    fetchMeta();
  }, [serverId]);

  // Load server preset ZIP
  useEffect(() => {
    async function loadPreset() {
      if (!serverMeta || !driveZipId) return;
	try {
	  const preset = await window.electronAPI.loadServerPreset(serverId, driveZipId);
	  console.log("Loaded preset:", preset);
	  if (preset.version) setVersion(preset.version);
	  if (preset.ram) setRam(preset.ram);
	  if (preset.defaultPath) setInstallPath(preset.defaultPath);
	} catch (err) {
	  console.error("Error loading server preset:", err);
	}
    }

    loadPreset();
  }, [serverMeta, driveZipId]);

useEffect(() => {
  async function loadBackups() {
    try {
      // 1. Firestore-ból lekérjük a szerver adatait
console.log("ServerId:", serverId);
const serverSnap = await getDoc(doc(db, "servers", serverId));
console.log("Server snapshot exists:", serverSnap.exists());
console.log("Server data:", serverSnap.data());

      if (!serverSnap.exists()) {
        console.warn("Server not found");
        return;
      }

      const { loader, linkedDriveId, createdBy } = serverSnap.data();

      if (!loader || !linkedDriveId || !createdBy) {
        console.error("Server metadata incomplete");
        return;
      }

      // 2. Kérünk egy access tokent a Google Drive-hoz
      const accessToken = await getValidAccessToken(createdBy, linkedDriveId);
      console.log("AccessToken:", accessToken);

      // 3. Meghívjuk az Electron API-t a backupok listázására
      const list = await window.electronAPI.listServerBackups({
        serverId,
        loader,
        accessToken,
      });

      console.log("Backups fetched:", list);

      if (list.length > 0) {
        setBackups(list);
        setSelectedBackupId(list[0].id); // default: latest
      }
    } catch (err) {
      console.error("Failed to load backups:", err);
    }
  }

  loadBackups();
}, [serverId]);



  // Handle server host action
  async function handleHost() {
    if (!installPath) {
      alert("Please select an install path.");
      return;
    }

    setLoading(true);

    try {
      console.log("Launching server with:", {
        serverId,
        driveZipId,
        installPath,
        ram,
        version,
      });

const zipToUse =
  selectedBackupId !== null
    ? selectedBackupId
    : driveZipId;

await window.electronAPI.hostServer({
  serverId,
  driveZipId: zipToUse,
  installPath,
  ram,
  version,
});

console.log("Using ZIP:", {
  selectedBackupId,
  fallbackSetupZip: driveZipId,
});



      alert("Server launched successfully.");
      onClose();
    } catch (err) {
      console.error("Host failed:", err);
      alert("Failed to host server.");
    }

    setLoading(false);
  }

  return (
    <Dialog open={true} onClose={onClose} className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <Dialog.Panel className="bg-white rounded-xl shadow-lg p-6 w-[500px]">
        <Dialog.Title className="text-xl font-bold mb-4">Host Server</Dialog.Title>

        <div className="mb-4">
          <label className="block text-sm font-medium">Version</label>
          <input
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            className="border rounded px-2 py-1 w-full"
          />
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium">RAM</label>
          <input
            value={ram}
            onChange={(e) => setRam(e.target.value)}
            className="border rounded px-2 py-1 w-full"
            placeholder="Example: 4G"
          />
        </div>

{backups.length > 0 && (
  <div className="mb-4">
    <label className="block text-sm font-medium">
      Restore from backup
    </label>

    <select
      value={selectedBackupId ?? ""}
      onChange={(e) => setSelectedBackupId(e.target.value)}
      className="border rounded px-2 py-1 w-full"
    >
      {backups.map((backup) => (
        <option key={backup.id} value={backup.id}>
          {backup.name}
        </option>
      ))}
    </select>
  </div>
)}


        <div className="mb-4">
          <label className="block text-sm font-medium">Install Path</label>
          <div className="flex gap-2">
            <input
              value={installPath}
              readOnly
              className="border rounded px-2 py-1 w-full"
            />
            <button
              onClick={async () => {
                const selected = await window.electronAPI.selectFolder();
                if (selected) setInstallPath(selected);
              }}
              className="bg-gray-200 hover:bg-gray-300 px-2 rounded"
            >
              Browse...
            </button>
          </div>
        </div>

        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="text-gray-600 hover:underline">Cancel</button>
          <button
            onClick={handleHost}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            {loading ? "Launching..." : "Host Server"}
          </button>
        </div>
      </Dialog.Panel>
    </Dialog>
  );
}
