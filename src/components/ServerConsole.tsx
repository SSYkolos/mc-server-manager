import React, { useEffect, useRef, useState } from "react";
import { Button, Box, Typography, Paper, IconButton, Modal } from "@mui/material";
import SettingsIcon from "@mui/icons-material/Settings";
import StopIcon from "@mui/icons-material/Stop";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import CloseIcon from "@mui/icons-material/Close";
import ServerPropertiesEditor from "./ServerPropertiesEditor";
import { doc, getDoc, updateDoc, deleteField } from "firebase/firestore";
import { db } from "../firebase";
import { getAuth } from "firebase/auth";
import Draggable from "react-draggable";



interface ServerConsoleProps {
  serverId: string;
  extractPath: string;
  ram: string | null;
  mcVersion: string | null;
  onClose: () => void;
  isAdmin: boolean;
}

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


export default function ServerConsole({
  extractPath,
  ram,
  mcVersion,
  serverId,
  onClose,
}: ServerConsoleProps) {
  const [logs, setLogs] = useState<string[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [serverRunning, setServerRunning] = useState(false);
  const [command, setCommand] = useState("");
  const [draggable, setDraggable] = useState(false);

  const auth = getAuth();
  const currentUser = auth.currentUser;
  const logContainerRef = useRef<HTMLDivElement | null>(null);


  useEffect(() => {
    let isMounted = true;

    async function loadExistingLogs() {
      try {
        const result = await window.electronAPI.getServerLogs({
          serverId,
          limit: 1000,
        });

        if (isMounted && result.success) {
          setLogs(result.logs ?? []);
        }
      } catch (err) {
        console.error("Failed to load existing logs", err);
      }
    }

    loadExistingLogs();

    const unsubscribeLogs = window.electronAPI.onServerLog((data) => {
      if (data.serverId !== serverId) return;
      setLogs((prev) => [...prev.slice(-999), data.log]);
    });

    const unsubscribeClosed = window.electronAPI.onServerClosed((data) => {
      if (data.serverId !== serverId) return;
      setServerRunning(false);
    });

    return () => {
      isMounted = false;
      unsubscribeLogs();
      unsubscribeClosed();
    };
  }, [serverId]);

useEffect(() => {
  async function syncRunningState() {
    try {
      const result = await window.electronAPI.getRunningServerInfo({ serverId });
      setServerRunning(!!result.running);
    } catch (err) {
      console.error("Failed to sync running state", err);
    }
  }

  syncRunningState();
}, [serverId]);

  useEffect(() => {
    const el = logContainerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [logs]);

  const sendCommand = async () => {
    if (!command.trim() || !serverRunning) return;

    const result = await window.electronAPI.sendServerCommand({
      serverId,
      command,
    });

    if (!result?.success) {
      console.error("Failed to send command");
    }

    setCommand("");
  };



const handleBackup = async () => {
  if (serverRunning) {
    alert("Stop the server before creating a backup.");
    return;
  }

  const auth = getAuth();
  const currentUser = auth.currentUser;

  if (!currentUser) {
    alert("You must be logged in to backup the server.");
    return;
  }

  try {
    // 1. Get server document
// 1. Get server document
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

if (!linkedDriveId || !ownerId) {
  alert("Server is not linked to a Google Drive account.");
  return;
}
if (!loader) throw new Error("Server loader not found in Firestore");

// 2. Get a fresh access token
const accessToken = await getFreshAccessToken(ownerId, linkedDriveId);

// 3. Call the Electron backup API
const result = await window.electronAPI.backupServer({
  serverPath: extractPath,
  serverId,
  loader,       // FIRESTORE-ból vett érték
  accessToken,
});

if (!result.success) throw new Error(result.error);
alert(`Backup complete. ${result.backups?.length ?? 0} backups now on Drive.`);

  } catch (err) {
    console.error(err);
    alert("Backup failed. Check logs.");
  }

};

  const handleStart = async () => {
    const jarPath = `${extractPath}/server.jar`;
    const safeRam = ram ?? "4G";

const result = await window.electronAPI.startServerProcess({
  serverId,
  pathToServerJar: jarPath,
  ram: safeRam,
});

    if (result.success) {
      setServerRunning(true);
      try {
        const publicIp = await window.electronAPI.getPublicIp();
        const serverRef = doc(db, "servers", serverId);

	await updateDoc(serverRef, {
	  liveInfo: {
	    hostUserId: currentUser?.uid,
	    ip: publicIp,
	    port: result.port ?? 25565,
	    status: "online",
	    playerCount: 0,
	  },
	  lastHosted: new Date(),
	});
      } catch (err) {
        console.error("Failed to update liveInfo:", err);
      }
    } else {
      alert(`Failed to start server: ${result.error}`);
    }
  };

  const handleStop = async () => {
    const result = await window.electronAPI.stopServerProcess({ serverId });
    if (!result.success) {
      alert(`Failed to stop server: ${result.error}`);
    } else {
      setServerRunning(false);
      try {
        const serverRef = doc(db, "servers", serverId);
        await updateDoc(serverRef, {
          liveInfo: deleteField(),
        });
      } catch (err) {
        console.error("Failed to remove liveInfo:", err);
      }
    }
  };

const consoleWidth = 0.8 * window.innerWidth;
const consoleHeight = 0.7 * window.innerHeight;

const defaultX = (window.innerWidth - consoleWidth) / 2;
const defaultY = (window.innerHeight - consoleHeight) / 2;


  return (
    <>
      <Box
	ref={logContainerRef}
        onClick={onClose}
        sx={{
          position: "fixed",
          inset: 0,
          backgroundColor: "rgba(0,0,0,0.5)",
          zIndex: 1000,
        }}
      />

      {!settingsOpen && (
        <Draggable disabled={!draggable} defaultPosition={{ x: defaultX, y: defaultY }}>
          <Paper
            sx={{
              width: "80%",
              height: "70%",
              p: 3,
              zIndex: 1100,
              display: "flex",
              flexDirection: "column",
              borderRadius: 2,
              cursor: draggable ? "grab" : "default",
              position: "fixed",
            }}
            onClick={e => e.stopPropagation()}
            elevation={4}
          >
            <Box sx={{ display: "flex", justifyContent: "space-between", mb: 2 }}>
              <Typography variant="h6">Server Console</Typography>
              <IconButton onClick={onClose}>
                <CloseIcon />
              </IconButton>
            </Box>

            <Box
              sx={{
                position: "absolute",
                top: 10,
                right: 10,
                width: 20,
                height: 20,
                borderRadius: "50%",
                border: "2px solid #0f0",
                backgroundColor: draggable ? "#0f0" : "transparent",
                cursor: "pointer",
                zIndex: 2000,
              }}
              onClick={() => setDraggable(!draggable)}
            />

            <Box
              sx={{
                flex: 1,
                backgroundColor: "#000",
                color: "#0f0",
                fontFamily: "monospace",
                overflowY: "auto",
                p: 2,
                mb: 2,
                borderRadius: 1,
              }}
            >
              {logs.map((line, index) => (
                <Typography key={index} variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                  {line}
                </Typography>
              ))}
            </Box>

            <Box sx={{ display: "flex", gap: 1, mb: 2 }}>
              <input
                value={command}
                onChange={e => setCommand(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") sendCommand();
                }}
                disabled={!serverRunning}
                placeholder="Type a server command..."
                style={{
                  flex: 1,
                  backgroundColor: "black",
                  color: "#0f0",
                  border: "1px solid #333",
                  fontFamily: "monospace",
                  padding: "8px",
                  outline: "none",
                }}
              />
              <Button variant="contained" onClick={sendCommand} disabled={!serverRunning}>
                Send
              </Button>
            </Box>

            <Box sx={{ display: "flex", justifyContent: "space-between", gap: 1 }}>
              <Box sx={{ display: "flex", gap: 1 }}>
                <Button variant="outlined" onClick={handleBackup} disabled={serverRunning}>
                  Backup
                </Button>
                <Button
                  variant="outlined"
                  color="primary"
                  startIcon={<SettingsIcon />}
                  onClick={() => setSettingsOpen(true)}
                >
                  Settings
                </Button>
              </Box>

              <Box sx={{ display: "flex", gap: 1 }}>
                <Button
                  variant="contained"
                  color="success"
                  startIcon={<PlayArrowIcon />}
                  onClick={handleStart}
                  disabled={serverRunning}
                >
                  Start
                </Button>

                <Button
                  variant="contained"
                  color="error"
                  startIcon={<StopIcon />}
                  onClick={handleStop}
                  disabled={!serverRunning}
                >
                  Stop
                </Button>
              </Box>
            </Box>
          </Paper>
        </Draggable>
      )}

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
              serverPropertiesPath={extractPath}
              onClose={() => setSettingsOpen(false)}
            />
          </Box>
        </Box>
      </Modal>
    </>
  );
}
