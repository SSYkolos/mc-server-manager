import React, { useState, useEffect } from "react";
import { Button, Input, Typography, Box, Paper, IconButton } from "@mui/material";
import CloseIcon from '@mui/icons-material/Close';
import { getZipFileId } from "../firebaseUtils";
//import { getValidAccessToken } from "../electronProxy";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase"; // hol definiálod a Firestore-t
import path from "path-browserify";
import type { User } from "firebase/auth";




type HostServerProps = {
  serverId: string;
  user: User;
  onClose: () => void;
  onExtractPathReady: (path: string, ram: string, mcVersion: string) => void;
};

export default function HostServer({ serverId, user, onClose, onExtractPathReady }: HostServerProps) {
  const [installPath, setInstallPath] = useState("");
  const [mcVersion, setMcVersion] = useState("");
  const [loader, setLoader] = useState("vanilla");
  const [loaderVersion, setLoaderVersion] = useState("");
  const [allocatedRam, setAllocatedRam] = useState("");
  const [loading, setLoading] = useState(false);
  const [backups, setBackups] = useState<any[]>([]);
  const [selectedBackup, setSelectedBackup] = useState<{
    id: string;
    name: string;
  } | null>(null);



  // Open folder picker dialog and update installPath
  const handleOpenFolderPicker = async () => {
    const folderPath = await window.electronAPI.selectFolder();
    if (folderPath) {
      setInstallPath(folderPath);
    }
  };

useEffect(() => {
  async function loadServerDataAndBackups() {
    try {
      const serverSnap = await getDoc(doc(db, "servers", serverId));
      if (!serverSnap.exists()) return;

      const data = serverSnap.data();

      const loaderFromDb = data.loader || "vanilla";
      const mcVersionFromDb = data.mcVersion || "";
      const loaderVersionFromDb = data.loaderVersion || "";
      const linkedDriveId = data.linkedDriveId;
      const createdBy = data.createdBy;

      setLoader(loaderFromDb);
      setMcVersion(mcVersionFromDb);
      setLoaderVersion(loaderVersionFromDb);

      if (!linkedDriveId || !createdBy) return;

      const accessToken = await window.electronAPI.getValidAccessToken({
        userId: createdBy,
        driveId: linkedDriveId,
      });

      const list = await window.electronAPI.listServerBackups({
        serverId,
        loader: loaderFromDb,
        accessToken,
      });

      console.log("BACKUPS FROM DRIVE:", list);

      if (list.length > 0) {
        console.log("SETTING DEFAULT BACKUP:", list[0]);
        setBackups(list);
        setSelectedBackup(list[0]);
      } else {
        setBackups([]);
        setSelectedBackup(null);
      }
    } catch (err) {
      console.error("Failed to load server data/backups:", err);
    }
  }

  loadServerDataAndBackups();
}, [serverId]);


const handleHostServer = async () => {

      const serverSnap = await getDoc(doc(db, "servers", serverId));
      if (!serverSnap.exists()) return;

const { loader, linkedDriveId, createdBy, driveFolderId } = serverSnap.data();
if (!loader || !linkedDriveId || !createdBy || !driveFolderId) return;

const accessToken = await window.electronAPI.getValidAccessToken({
  userId: createdBy,
  driveId: linkedDriveId,
});

const serverRootFolderId = await window.electronAPI.ensureDriveFolderPath({
  accessToken,
  serverId,
  loader,
});

  if (backups.length > 0 && !selectedBackup) {
    alert("Backup is available but none is selected yet. Please wait or select one.");
    return;
  }

  if (!installPath) {
    alert("Please select an install path");
    return;
  }
  if (!allocatedRam) {
    alert("Please specify allocated RAM");
    return;
  }

  setLoading(true);

  try {


// 1. Local server folder
const extractPath = path.join(installPath, `${serverId}`);

if (selectedBackup) {
  const restoreResult = await window.electronAPI.restoreSnapshot({
    snapshotId: selectedBackup.id,
    serverPath: extractPath,
    serverId,
    loader,
    accessToken,
  });

  if (!restoreResult.success) {
    alert(`Failed to restore snapshot: ${restoreResult.error}`);
    setLoading(false);
    return;
  }
} else {
  const zipFileId = await getZipFileId(serverId);
  if (!zipFileId) {
    alert("Could not find zip file ID for this server.");
    setLoading(false);
    return;
  }

  const zipLocalPath = path.join(installPath, `${serverId}.zip`);

  const downloadResult = await window.electronAPI.downloadFromDrive({
    fileId: zipFileId,
    destPath: zipLocalPath,
    accessToken,
  });

  if (!downloadResult.success) {
    alert(`Failed to download server zip: ${downloadResult.error}`);
    setLoading(false);
    return;
  }

  const extractResult = await window.electronAPI.extractZip(zipLocalPath, extractPath);
  if (!extractResult) {
    alert("Failed to extract the zip file.");
    setLoading(false);
    return;
  }
}


const modsPath = path.join(extractPath, "mods");
const configPath = path.join(extractPath, "config");
const pluginsPath = path.join(extractPath, "plugins");

const modsResult = await window.electronAPI.downloadDriveFolder({
  accessToken,
  serverRootFolderId,
  folderName: "mods",
  localDestination: modsPath,
});

if (!modsResult.success) {
  alert(`Failed to download mods folder: ${modsResult.error}`);
  setLoading(false);
  return;
}

const configResult = await window.electronAPI.downloadDriveFolder({
  accessToken,
  serverRootFolderId,
  folderName: "config",
  localDestination: configPath,
});

if (!configResult.success) {
  alert(`Failed to download config folder: ${configResult.error}`);
  setLoading(false);
  return;
}

const pluginsResult = await window.electronAPI.downloadDriveFolder({
  accessToken,
  serverRootFolderId,
  folderName: "plugins",
  localDestination: pluginsPath,
});

if (!pluginsResult.success) {
  alert(`Failed to download plugins folder: ${pluginsResult.error}`);
  setLoading(false);
  return;
}

    // 5. Minecraft server.jar
const runtimeResult = await window.electronAPI.prepareServerRuntime({
  loader,
  mcVersion,
  loaderVersion,
  extractPath,
});

if (!runtimeResult.success) {
  alert(`Failed to prepare server runtime: ${runtimeResult.error}`);
  setLoading(false);
  return;
}

    // 6. Eula.txt
    const eulaResult = await window.electronAPI.createEula(extractPath);
    if (!eulaResult) {
      alert("Failed to create eula.txt");
      setLoading(false);
      return;
    }

    onExtractPathReady(extractPath, allocatedRam, mcVersion);
    onClose();
  } catch (err: any) {
    alert(`Unexpected error: ${err.message || err.toString()}`);
    setLoading(false);
  } finally {
    setLoading(false);
  }
};


  return (
    <>
      {/* Overlay */}
      <Box
        onClick={onClose}
        sx={{
          position: "fixed",
          inset: 0,
          backgroundColor: "rgba(0, 0, 0, 0.5)",
          zIndex: 1000,
        }}
      />

      {/* Modal content */}
      <Paper
        sx={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: 400,
          p: 4,
          zIndex: 1100,
          borderRadius: 2,
          boxShadow: 24,
        }}
        onClick={e => e.stopPropagation()} // Prevent overlay click close when clicking inside modal
        elevation={3}
      >
        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2 }}>
          <Typography variant="h6">Host Minecraft Server</Typography>
          <IconButton onClick={onClose} size="small" disabled={loading}>
            <CloseIcon />
          </IconButton>
        </Box>

        <Input
          value={installPath}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setInstallPath(e.target.value)}
          placeholder="Install path"
          fullWidth
          sx={{ mb: 1 }}
          disabled={loading}
        />
        <Button variant="outlined" onClick={handleOpenFolderPicker} sx={{ mb: 2 }} disabled={loading}>
          Select Folder
        </Button>

<Input
  value={mcVersion}
  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMcVersion(e.target.value)}
  placeholder="Minecraft Version (e.g. 1.20.1)"
  fullWidth
  sx={{ mb: 1 }}
  disabled={loading || ["fabric", "forge", "neoforge"].includes(loader)}
/>

{["fabric", "forge", "neoforge"].includes(loader) && (
  <Typography variant="body2" sx={{ mb: 2, color: "text.secondary" }}>
    For modded servers, the Minecraft version comes from the saved server profile.
  </Typography>
)}

        <Input
          value={allocatedRam}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAllocatedRam(e.target.value)}
          placeholder="Allocated RAM (e.g. 2G)"
          fullWidth
          sx={{ mb: 3 }}
          disabled={loading}
        />

{backups.length > 0 && (
  <div className="mb-2">
    <label className="block text-sm font-medium">Restore from backup</label>
    <select
      value={selectedBackup?.id ?? ""}
      onChange={(e) => {
        const found = backups.find(b => b.id === e.target.value);
        setSelectedBackup(found ?? null);
      }}

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


        <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1 }}>
          <Button variant="text" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant="contained" onClick={handleHostServer} disabled={loading}>
            {loading ? "Hosting..." : "Host Server"}
          </Button>
        </Box>
      </Paper>
    </>
  );
}
