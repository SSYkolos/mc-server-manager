import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { Box, Button, Paper, Typography, Modal } from "@mui/material";
import SettingsIcon from "@mui/icons-material/Settings";
import StopIcon from "@mui/icons-material/Stop";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import { doc, getDoc, updateDoc, deleteField } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { db } from "../firebase";
import ServerPropertiesEditor from "./ServerPropertiesEditor";
import AdminPanelSettingsIcon from "@mui/icons-material/AdminPanelSettings";
import WebRTCHost from './WebRTCHost';


type RouteParams = {
  serverId?: string;
  role?: string;
};

async function getFreshAccessToken(uid: string, driveId: string): Promise<string> {
  const response = await fetch(
    "https://europe-west1-mc-server-manager-6d2bc.cloudfunctions.net/refreshAccessToken",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ uid, driveId }),
    }
  );

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || "Failed to refresh access token");
  }

  const data = await response.json();
  if (!data.access_token) throw new Error("No access token returned");
  return data.access_token;
}

function formatUptime(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}h ${m}m ${s}s`;
}

export default function ServerConsoleWindow() {
  const { serverId } = useParams<RouteParams>();
  const location = useLocation();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const query = new URLSearchParams(location.search);
  const initialExtractPath = query.get("extractPath") || "";
  const initialRam = query.get("ram") || "4G";
  const initialMcVersion = query.get("mcVersion") || "";
  const initialIsAdmin = query.get("isAdmin") === "true";
  const initialAccessToken = query.get("accessToken") || "";
  const [runtimeState, setRuntimeState] = useState<string>("stopped");
  const [logs, setLogs] = useState<string[]>([]);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [serverRunning, setServerRunning] = useState(false);
  const [command, setCommand] = useState("");
  const [extractPath, setExtractPath] = useState(initialExtractPath);
  const [ram, setRam] = useState<string>(initialRam);
  const [mcVersion, setMcVersion] = useState<string>(initialMcVersion);
  const [port, setPort] = useState<number | null>(null);
  const [pid, setPid] = useState<number | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const logContainerRef = useRef<HTMLDivElement | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  const [restoreCheck, setRestoreCheck] = useState<{
    state: "idle" | "queued" | "running" | "passed" | "failed";
    message: string;
    percent: number;
    failedCount?: number;
    missingCount?: number;
  }>({
    state: "idle",
    message: "No restore check running",
    percent: 0,
  });

  const auth = getAuth();
  const currentUser = auth.currentUser;

  const uptimeSec = useMemo(() => {
    if (!startedAt) return 0;
    return Math.max(0, Math.floor((nowMs - startedAt) / 1000));
  }, [startedAt, nowMs]);

  useEffect(() => {
    if (!serverId) return;

    const currentServerId = serverId;
    let mounted = true;

    async function bootstrap() {
      try {
        const [runtimeInfo, savedLogs, verificationInfo] = await Promise.all([
          window.electronAPI.getRunningServerInfo({ serverId: currentServerId }),
          window.electronAPI.getServerLogs({ serverId: currentServerId, limit: 1000 }),
          window.electronAPI.getRestoreVerificationStatus({ serverId: currentServerId }),
        ]);

        if (!mounted) return;

        if (savedLogs.success) {
          setLogs(savedLogs.logs ?? []);
        }

        if (verificationInfo?.success && verificationInfo.status) {
          const status = verificationInfo.status;

          setRestoreCheck({
            state: status.state || "idle",
            message: status.message || "Restore check",
            percent: status.percent || 0,
            failedCount: Array.isArray(status.failedFiles)
              ? status.failedFiles.length
              : 0,
            missingCount: Array.isArray(status.missingFiles)
              ? status.missingFiles.length
              : 0,
          });
        }

        if (runtimeInfo.success && runtimeInfo.running && runtimeInfo.data) {
          setRuntimeState(runtimeInfo.data.state || "running");
          setServerRunning(runtimeInfo.data.state === "starting" || runtimeInfo.data.state === "running" || runtimeInfo.data.state === "stopping");
          setExtractPath(runtimeInfo.data.extractPath || initialExtractPath);
          setRam(runtimeInfo.data.ram || initialRam);
          setPort(runtimeInfo.data.port);
          setPid(runtimeInfo.data.pid);
          setStartedAt(runtimeInfo.data.startedAt);
        } else {

          setRuntimeState("stopped");
          setServerRunning(false);
          if (initialExtractPath) setExtractPath(initialExtractPath);
          if (initialRam) setRam(initialRam);
          if (initialMcVersion) setMcVersion(initialMcVersion);
        }
      } catch (err) {
        console.error("Failed to bootstrap detached console", err);
      }
    }

    bootstrap();

    const unsubscribeLogs = window.electronAPI.onServerLog((data) => {
      if (data.serverId !== currentServerId) return;
      setLogs((prev) => [...prev.slice(-999), data.log]);
    });

    const unsubscribeState = window.electronAPI.onServerState((data) => {
      if (data.serverId !== currentServerId) return;

      setRuntimeState(data.state);
      setServerRunning(
        data.state === "starting" ||
        data.state === "running" ||
        data.state === "stopping"
      );

      if (typeof data.port === "number") {
        setPort(data.port);
      } else if (data.port === null) {
        setPort(null);
      }

      if (typeof data.pid === "number") {
        setPid(data.pid);
      } else if (data.pid === null) {
        setPid(null);
      }

      if (typeof data.startedAt === "number") {
        setStartedAt(data.startedAt);
      } else if (data.startedAt === null) {
        setStartedAt(null);
      }
    });

    const unsubscribeRestoreCheck =
      window.electronAPI.onRestoreVerificationProgress((data) => {
        if (data.serverId !== currentServerId) return;

        setRestoreCheck({
          state: data.state || "idle",
          message: data.message || "Restore check",
          percent: data.percent || 0,
          failedCount: Array.isArray(data.failedFiles)
            ? data.failedFiles.length
            : 0,
          missingCount: Array.isArray(data.missingFiles)
            ? data.missingFiles.length
            : 0,
        });
      });

    const unsubscribeClosed = window.electronAPI.onServerClosed((data) => {
      if (data.serverId !== currentServerId) return;

      setServerRunning(false);
      setRuntimeState(data.state);
      setPid(null);
      setStartedAt(null);

      if (data.state === "crashed") {
        setLogs((prev) => [
          ...prev.slice(-999),
          `[mc-server-manager] Server process crashed or exited unexpectedly (code: ${data.code})\n`,
        ]);
      }

      (async () => {
        try {
          const serverRef = doc(db, "servers", currentServerId);
          await updateDoc(serverRef, {
            liveInfo: deleteField(),
          });
        } catch (err) {
          console.error("Failed to clear liveInfo from renderer:", err);
        }
      })();
    });

    const interval = window.setInterval(async () => {
      try {
        const runtimeInfo = await window.electronAPI.getRunningServerInfo({
          serverId: currentServerId,
        });

        if (runtimeInfo.success && runtimeInfo.running && runtimeInfo.data) {
          setRuntimeState(runtimeInfo.data.state || "running");
          setServerRunning(
            runtimeInfo.data.state === "starting" ||
            runtimeInfo.data.state === "running" ||
            runtimeInfo.data.state === "stopping"
          );
          setExtractPath(runtimeInfo.data.extractPath || initialExtractPath);
          setRam(runtimeInfo.data.ram || initialRam);
          setPort(runtimeInfo.data.port);
          setPid(runtimeInfo.data.pid);
          setStartedAt(runtimeInfo.data.startedAt);
        } else {
          setRuntimeState("stopped");
          setServerRunning(false);
        }

      } catch (err) {
        console.error("Failed to refresh runtime info", err);
      }
    }, 5000);

    return () => {
      mounted = false;
      unsubscribeLogs();
      unsubscribeState();
      unsubscribeRestoreCheck();
      unsubscribeClosed();
      window.clearInterval(interval);
    };
  }, [serverId, initialExtractPath, initialRam, initialMcVersion]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
  }, [logs]);



  const sendCommand = async () => {
    if (!serverId || !command.trim() || !serverRunning) return;

    const result = await window.electronAPI.sendServerCommand({
      serverId,
      command,
    });

    if (!result?.success) {
      console.error("Failed to send command");
      alert(result.error || "Failed to send command.");
      return;
    }

    setCommand("");
  };

  const handleBackup = async () => {
    if (!serverId) return;

    if (serverRunning) {
      alert("Stop the server before creating a backup.");
      return;
    }

    if (!currentUser) {
      alert("You must be logged in to backup the server.");
      return;
    }

    try {
      const serverRef = doc(db, "servers", serverId);
      const serverSnap = await getDoc(serverRef);
      if (!serverSnap.exists()) {
        alert("Server not found.");
        return;
      }

      const serverData = serverSnap.data();
      const linkedDriveId = serverData?.linkedDriveId;
      const ownerId = serverData?.createdBy;
      const loader = serverData?.loader;
      const driveFolderId = serverData?.driveFolderId;
      const isModpack = serverData?.isModpack;
      const retention =
        typeof serverData?.backupRetentionCount === "number"
          ? serverData.backupRetentionCount
          : 5;

      if (!linkedDriveId || !ownerId) {
        alert("Server is not linked to a Google Drive account.");
        return;
      }
      if (!loader) throw new Error("Server loader not found in Firestore");
      if (!extractPath) throw new Error("Missing local extract path");

      const accessToken = await getFreshAccessToken(ownerId, linkedDriveId);

      const result = await window.electronAPI.backupServer({
        serverPath: extractPath,
        serverId,
        loader,
        accessToken,
        retention,
        driveFolderId,
        isModpack,
      });

      if (!result.success) throw new Error(result.error);

      const backups = await window.electronAPI.listServerBackups({
        serverId,
        loader,
        accessToken,
        driveFolderId,
        isModpack,
      });

      const count = backups.length;
      const kept = typeof retention === "number" ? retention : 5;

      if (count < kept) {
        alert(`Backup complete. ${count} backup${count === 1 ? "" : "s"} on Drive.`);
      } else {
        alert(
          `Backup complete. Retention active (${kept}). ${count} backups kept.`
        );
      }
    } catch (err) {
      console.error(err);
      alert("Backup failed. Check logs.");
    }
  };

  const handleOpenLiveAdmin = async () => {
    if (!serverId) return;

    const result = await window.electronAPI.openServerLiveAdmin({
      serverId,
      accessToken: initialAccessToken,
    });

    if (!result?.success) {
      alert("Failed to open Live Admin window.");
    }
  };

  const handleStart = async () => {
    if (!serverId) return;

    if (!extractPath) {
      alert("Missing local extract path.");
      return;
    }

    const safeRam = ram ?? "4G";

    try {
      const serverRef = doc(db, "servers", serverId);
      const serverSnap = await getDoc(serverRef);

      if (!serverSnap.exists()) {
        throw new Error("Server document not found.");
      }

      const serverData = serverSnap.data();
      const loader = serverData?.loader || "vanilla";
      const loaderVersion = serverData?.loaderVersion || "";

      const runtimeInfo = await window.electronAPI.detectPreparedServerRuntime({
        loader,
        extractPath,
      });

      if (!runtimeInfo.success || !runtimeInfo.ready) {
        alert(
          runtimeInfo.error ||
          "Server runtime is not ready. Re-host/setup the server first."
        );
        return;
      }

      const result = await window.electronAPI.startServerProcess({
        serverId,
        launchMode: runtimeInfo.launchMode ?? "jar",
        pathToServerJar: runtimeInfo.launcherJar ?? null,
        forgeUserJvmArgsPath: runtimeInfo.userJvmArgsPath ?? null,
        forgeWinArgsPath: runtimeInfo.winArgsPath ?? null,
        forgeUnixArgsPath: runtimeInfo.unixArgsPath ?? null,
        serverFolder: extractPath,
        ram: safeRam,
        mcVersion: mcVersion,
      });

      if (!result.success) {
        alert(`Failed to start server: ${result.error}`);
        return;
      }

      setRuntimeState("starting");
      setServerRunning(true);
      setPort(result.port ?? 25565);

      const publicIp = await window.electronAPI.getPublicIp();

      await updateDoc(serverRef, {
        liveInfo: {
          hostUserId: serverData.createdBy || currentUser?.uid || null,
          ip: publicIp,
          port: result.port ?? 25565,
          status: "online",
          playerCount: 0,
        },
        lastHosted: new Date(),
      });
    } catch (err: any) {
      alert(err?.message || "Failed to start server.");
    }
  };


  const handleStop = async () => {
    if (!serverId) return;

    const result = await window.electronAPI.stopServerProcess({ serverId });

    if (!result.success) {
      alert(`Failed to stop server: ${result.error}`);
      return;
    }

    setRuntimeState("stopping");
  };



  if (!serverId) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography>Missing serverId.</Typography>
      </Box>
    );
  }

  return (
    <>
      <Box
        sx={{
          height: "100vh",
          backgroundColor: "#0b0b0b",
          color: "#d7ffd7",
          p: 0,
          m: 0,
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            p: 1.5,
            backgroundColor: "#0f0f0f",
            color: "#d7ffd7",
            boxSizing: "border-box",
            overflow: "hidden",
          }}
        >
          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2, gap: 2 }}>
            <Box>
              <Typography variant="h6">Server Console</Typography>
              <Typography variant="body2" sx={{ opacity: 0.8 }}>
                {serverId}
              </Typography>
              {mcVersion && (
                <Typography variant="body2" sx={{ opacity: 0.7 }}>
                  Version: {mcVersion}
                </Typography>
              )}
            </Box>

            <Box sx={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 0.5 }}>
              <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap", justifyContent: "flex-end" }}>
                <Typography variant="body2">Status: {runtimeState}</Typography>
                <Typography variant="body2">Port: {port ?? "-"}</Typography>
                <Typography variant="body2">PID: {pid ?? "-"}</Typography>
                <Typography variant="body2">RAM: {ram || "-"}</Typography>
                <Typography variant="body2">Uptime: {formatUptime(uptimeSec)}</Typography>

                {/* WebRTC host */}
                <WebRTCHost serverId={serverId} serverRunning={serverRunning} />
              </Box>

              <Typography
                variant="body2"
                sx={{
                  opacity: 0.85,
                  color:
                    restoreCheck.state === "failed"
                      ? "#ff8a80"
                      : restoreCheck.state === "passed"
                        ? "#7CFC90"
                        : "#bdbdbd",
                }}
              >
                Restore check: {restoreCheck.message}
                {(restoreCheck.state === "running" ||
                  restoreCheck.state === "queued") &&
                  ` (${restoreCheck.percent}%)`}
                {restoreCheck.state === "failed" &&
                  ` · missing: ${restoreCheck.missingCount ?? 0}, failed: ${restoreCheck.failedCount ?? 0
                  }`}
              </Typography>
            </Box>
          </Box>

          <Box
            ref={logContainerRef}
            sx={{
              flex: 1,
              minHeight: 0,
              backgroundColor: "#000",
              color: "#00ff66",
              fontFamily: "Consolas, Monaco, monospace",
              overflowY: "auto",
              overflowX: "hidden",
              p: 1.5,
              mb: 1.5,
              borderRadius: 0,
              border: "1px solid #1d1d1d",
              boxShadow: "inset 0 0 0 1px rgba(0,255,102,0.06)",
            }}
          >
            {logs.map((line, index) => (
              <Typography
                key={index}
                variant="body2"
                component="div"
                sx={{
                  whiteSpace: "pre-wrap",
                  fontFamily: "Consolas, Monaco, monospace",
                  color: "#00ff66",
                  lineHeight: 1.35,
                }}
              >
                {line}
              </Typography>
            ))}
            <div ref={logEndRef} />

          </Box>

          <Box sx={{ display: "flex", gap: 1, mb: 2 }}>
            <input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") sendCommand();
              }}
              disabled={!serverRunning}
              placeholder="Type a server command..."
              style={{
                flex: 1,
                backgroundColor: "#000",
                color: "#00ff66",
                border: "1px solid #1d1d1d",
                fontFamily: "Consolas, Monaco, monospace",
                padding: "10px 12px",
                outline: "none",
              }}
            />
            <Button variant="contained" onClick={sendCommand} disabled={!serverRunning}>
              Send
            </Button>
          </Box>

          <Box sx={{ display: "flex", justifyContent: "space-between", gap: 1, flexWrap: "wrap" }}>
            <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
              <Button
                variant="outlined"
                onClick={handleBackup}
                disabled={runtimeState !== "stopped" && runtimeState !== "crashed"}
              >
                Backup
              </Button>

              <Button
                variant="outlined"
                color="primary"
                startIcon={<SettingsIcon />}
                onClick={() => setSettingsOpen(true)}
                disabled={!extractPath}
              >
                Settings
              </Button>

              <Button
                variant="outlined"
                color="secondary"
                startIcon={<AdminPanelSettingsIcon />}
                onClick={handleOpenLiveAdmin}
                disabled={!serverRunning}
              >
                Live Admin
              </Button>
            </Box>

            <Box sx={{ display: "flex", gap: 1 }}>
              <Button
                variant="contained"
                color="success"
                startIcon={<PlayArrowIcon />}
                onClick={handleStart}
                disabled={runtimeState === "starting" || runtimeState === "running" || runtimeState === "stopping"}
              >
                Start
              </Button>

              <Button
                variant="contained"
                color="error"
                startIcon={<StopIcon />}
                onClick={handleStop}
                disabled={runtimeState !== "starting" && runtimeState !== "running"}
              >
                Stop
              </Button>

              <Button variant="outlined" onClick={() => window.close()}>
                Close Window
              </Button>
            </Box>
          </Box>
        </Box>
      </Box>

      <Modal open={settingsOpen} onClose={() => setSettingsOpen(false)}>
        <Box
          sx={{
            position: "fixed",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            p: 2,
          }}
        >
          <Box
            sx={{
              width: "80%",
              height: "85%",
              bgcolor: "background.paper",
              borderRadius: 2,
              boxShadow: 24,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            <ServerPropertiesEditor
              serverId={serverId}
              serverPropertiesPath={extractPath}
              serverRunning={serverRunning}
              ram={ram}
              onClose={() => setSettingsOpen(false)}
            />
          </Box>
        </Box>
      </Modal>
    </>
  );
}