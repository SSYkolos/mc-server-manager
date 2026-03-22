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
  const [cachedAccessToken, setCachedAccessToken] = useState<string>("");

  const [restoreProgressOpen, setRestoreProgressOpen] = useState(false);
  const [restoreProgress, setRestoreProgress] = useState<{
    phase:
    | "starting"
    | "manifest"
    | "large-files"
    | "small-packs"
    | "cleanup"
    | "finalizing"
    | "done"
    | "error";
    message: string;
    current: number;
    total: number;
    percent: number;
  }>({
    phase: "starting",
    message: "",
    current: 0,
    total: 0,
    percent: 0,
  });

  const [setupProgressOpen, setSetupProgressOpen] = useState(false);
  const [setupProgress, setSetupProgress] = useState<{
    phase:
    | "idle"
    | "restore"
    | "download-zip"
    | "extract-zip"
    | "mods"
    | "config"
    | "plugins"
    | "runtime"
    | "eula"
    | "done"
    | "error";
    message: string;
    current: number;
    total: number;
    percent: number;
  }>({
    phase: "idle",
    message: "",
    current: 0,
    total: 0,
    percent: 0,
  });

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

        let accessToken = cachedAccessToken;

        if (!accessToken) {
          accessToken = await window.electronAPI.getValidAccessToken({
            userId: createdBy,
            driveId: linkedDriveId,
          });
          setCachedAccessToken(accessToken);
        }

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

  useEffect(() => {
    const unsubscribe = window.electronAPI.onRestoreProgress((data) => {
      setRestoreProgress(data);

      if (data.phase === "starting") {
        setRestoreProgressOpen(true);
      }

      if (data.phase === "done" || data.phase === "error") {
        window.setTimeout(() => {
          setRestoreProgressOpen(false);
        }, 1200);
      }
    });

    return unsubscribe;
  }, []);

  const updateSetupProgress = (
    phase:
      | "idle"
      | "restore"
      | "download-zip"
      | "extract-zip"
      | "mods"
      | "config"
      | "plugins"
      | "runtime"
      | "eula"
      | "done"
      | "error",
    message: string,
    current: number,
    total: number
  ) => {
    const percent =
      total > 0 ? Math.max(0, Math.min(100, Math.round((current / total) * 100))) : 0;

    setSetupProgress({
      phase,
      message,
      current,
      total,
      percent,
    });
  };

  const handleHostServer = async () => {
    const serverSnap = await getDoc(doc(db, "servers", serverId));
    if (!serverSnap.exists()) return;

    const { loader, linkedDriveId, createdBy, driveFolderId } = serverSnap.data();
    if (!loader || !linkedDriveId || !createdBy || !driveFolderId) return;

    let accessToken = cachedAccessToken;

    if (!accessToken) {
      accessToken = await window.electronAPI.getValidAccessToken({
        userId: createdBy,
        driveId: linkedDriveId,
      });
      setCachedAccessToken(accessToken);
    }

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

    setRestoreProgress({
      phase: "starting",
      message: "Preparing restore",
      current: 0,
      total: 1,
      percent: 0,
    });

    setSetupProgressOpen(true);
    const totalSteps = selectedBackup ? 5 : 7;
    updateSetupProgress("idle", "Preparing host setup", 0, totalSteps);
    setLoading(true);

    if (selectedBackup) {
      setRestoreProgressOpen(true);
    }

    try {


      // 1. Local server folder
      const extractPath = path.join(installPath, `${serverId}`);

      if (selectedBackup) {
        updateSetupProgress("restore", "Restoring selected backup", 0, 1);
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
        updateSetupProgress("restore", "Backup restored", 1, 1);

        void window.electronAPI.startRestoreVerification({
          snapshotId: selectedBackup.id,
          serverPath: extractPath,
          serverId,
          loader,
          accessToken,
        });

      } else {
        const zipFileId = await getZipFileId(serverId);
        if (!zipFileId) {
          alert("Could not find zip file ID for this server.");
          setLoading(false);
          return;
        }

        const zipLocalPath = path.join(installPath, `${serverId}.zip`);
        updateSetupProgress("download-zip", "Downloading server archive", 1, 7);
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
        updateSetupProgress("extract-zip", "Extracting server archive", 2, 7);
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

      if (!selectedBackup) {
        updateSetupProgress("mods", "Syncing mods folder", 3, 7);
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

        updateSetupProgress("config", "Syncing config folder", 4, 7);
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

        updateSetupProgress("plugins", "Syncing plugins folder", 5, 7);
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
      } else {
        updateSetupProgress("plugins", "Using mods/config/plugins from restored backup", 5, 7);
      }

      // 5. Minecraft server.jar
      updateSetupProgress("runtime", "Preparing server runtime", 6, 7);
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
      updateSetupProgress("eula", "Creating eula.txt", 7, 7);
      const eulaResult = await window.electronAPI.createEula(extractPath);
      if (!eulaResult) {
        alert("Failed to create eula.txt");
        setLoading(false);
        return;
      }

      updateSetupProgress("done", "Server setup completed", 7, 7);

      window.setTimeout(() => {
        onExtractPathReady(extractPath, allocatedRam, mcVersion);
        onClose();
      }, 700);

    } catch (err: any) {
      updateSetupProgress("error", err.message || err.toString(), 0, 1);
      setRestoreProgress({
        phase: "error",
        message: err.message || err.toString(),
        current: 0,
        total: 1,
        percent: 0,
      });

      alert(`Unexpected error: ${err.message || err.toString()}`);
      setLoading(false);
    } finally {
      window.setTimeout(() => {
        setSetupProgressOpen(false);
      }, 1200);
      setLoading(false);
    }
  };


  return (
    <>
      {/* Overlay */}
      <Box
        onClick={() => {
          if (!loading) onClose();
        }}
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
            {loading ? "Preparing..." : "Host Server"}
          </Button>
        </Box>
      </Paper>
      {restoreProgressOpen && (
        <Box
          sx={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0, 0, 0, 0.6)",
            zIndex: 1200,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            p: 2,
          }}
        >
          <Paper
            sx={{
              width: 420,
              maxWidth: "92vw",
              p: 3,
              borderRadius: 2,
              boxShadow: 24,
            }}
            elevation={6}
          >
            <Typography variant="h6" sx={{ mb: 1 }}>
              Restoring backup
            </Typography>

            <Typography variant="body2" sx={{ mb: 2, color: "text.secondary" }}>
              {restoreProgress.message || "Working..."}
            </Typography>

            <Box
              sx={{
                width: "100%",
                height: 10,
                borderRadius: 999,
                overflow: "hidden",
                backgroundColor: "rgba(0,0,0,0.08)",
                mb: 1,
              }}
            >
              <Box
                sx={{
                  width: `${restoreProgress.percent}%`,
                  height: "100%",
                  backgroundColor: "#2e7d32",
                  transition: "width 180ms ease",
                }}
              />
            </Box>

            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              {restoreProgress.percent}% · {restoreProgress.phase}
              {restoreProgress.total > 0
                ? ` · ${restoreProgress.current}/${restoreProgress.total}`
                : ""}
            </Typography>
          </Paper>
        </Box>
      )}


      {setupProgressOpen && !restoreProgressOpen && (
        <Box
          sx={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0, 0, 0, 0.6)",
            zIndex: 1300,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            p: 2,
          }}
        >
          <Paper
            sx={{
              width: 430,
              maxWidth: "92vw",
              p: 3,
              borderRadius: 2,
              boxShadow: 24,
            }}
            elevation={6}
          >
            <Typography variant="h6" sx={{ mb: 1 }}>
              Preparing server
            </Typography>

            <Typography variant="body2" sx={{ mb: 2, color: "text.secondary" }}>
              {setupProgress.message || "Working..."}
            </Typography>

            <Box
              sx={{
                width: "100%",
                height: 10,
                borderRadius: 999,
                overflow: "hidden",
                backgroundColor: "rgba(0,0,0,0.08)",
                mb: 1,
              }}
            >
              <Box
                sx={{
                  width: `${setupProgress.percent}%`,
                  height: "100%",
                  backgroundColor: "#1976d2",
                  transition: "width 180ms ease",
                }}
              />
            </Box>

            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              {setupProgress.percent}% · {setupProgress.phase}
              {setupProgress.total > 0
                ? ` · ${setupProgress.current}/${setupProgress.total}`
                : ""}
            </Typography>
          </Paper>
        </Box>
      )}
    </>

  );
}
