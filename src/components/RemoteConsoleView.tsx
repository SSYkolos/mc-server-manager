import React, { useEffect, useRef, useState } from 'react';
import Peer from 'simple-peer';
import { doc, setDoc, onSnapshot, deleteDoc } from 'firebase/firestore';
import { db, auth } from '../firebase'; 
import { Box, Typography, Button } from '@mui/material';

// Icons to match the Host exactly
import SettingsIcon from "@mui/icons-material/Settings";
import StopIcon from "@mui/icons-material/Stop";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import AdminPanelSettingsIcon from "@mui/icons-material/AdminPanelSettings";

interface RemoteConsoleProps {
  serverId: string;
  onClose: () => void; // Added so the "Close Window" button works
}

export default function RemoteConsoleView({ serverId, onClose }: RemoteConsoleProps) {
  const [logs, setLogs] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);
  const [command, setCommand] = useState("");
  
  const peerRef = useRef<Peer.Instance | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
  }, [logs]);

  useEffect(() => {
    const viewerId = auth?.currentUser?.uid || `viewer-${Math.random().toString(36).substring(7)}`;
    const signalDocRef = doc(db, 'servers', serverId, 'console-signals', viewerId);

    const peer = new Peer({ initiator: true, trickle: false });
    peerRef.current = peer;

    peer.on('signal', async (offer) => {
      await setDoc(signalDocRef, { offer });
    });

    const unsubscribe = onSnapshot(signalDocRef, (snapshot) => {
      const data = snapshot.data();
      if (data?.answer && !peer.connected) {
        peer.signal(data.answer);
      }
    });

    peer.on('connect', () => {
      setConnected(true);
      setLogs(prev => [...prev, "\n[SYSTEM] P2P Connection Established. You are live.\n"]);
    });

    peer.on('data', (raw) => {
      try {
        const message = JSON.parse(raw.toString());
        if (message.type === 'log' || message.type === 'system') {
          setLogs(prev => [...prev.slice(-999), message.text]); // Keep max 1000 logs like host
        }
      } catch (e) {
        console.error("Failed to parse incoming stream", e);
      }
    });

    peer.on('close', () => {
      setConnected(false);
      setLogs(prev => [...prev, "\n[SYSTEM] Connection to Host lost.\n"]);
    });

    return () => {
      unsubscribe();
      peer.destroy();
      deleteDoc(signalDocRef).catch(console.error);
    };
  }, [serverId]);

  const sendCommand = () => {
    if (command.trim() && peerRef.current?.connected) {
      setLogs(prev => [...prev, `> ${command}\n`]);
      peerRef.current.send(JSON.stringify({ type: 'command', command }));
      setCommand(""); 
    }
  };

  return (
    <Box
      sx={{
        height: "100%", // Takes the height of whatever container you put it in
        backgroundColor: "#0f0f0f", // Match Host
        color: "#d7ffd7",
        p: 1.5,
        display: "flex",
        flexDirection: "column",
        boxSizing: "border-box",
        overflow: "hidden",
      }}
    >
      {/* Header - Mimicking Host */}
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2, gap: 2 }}>
        <Box>
          <Typography variant="h6">Remote Console</Typography>
          <Typography variant="body2" sx={{ opacity: 0.8 }}>
            {serverId}
          </Typography>
        </Box>

        <Box sx={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 0.5 }}>
          <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <Typography variant="body2" color={connected ? "#00ff66" : "error"}>
              {connected ? "🟢 P2P Connected" : "🔴 Connecting to Host..."}
            </Typography>
          </Box>
        </Box>
      </Box>

      {/* Log Terminal - Exact match of Host CSS */}
      <Box
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

      {/* Command Input - Exact match of Host */}
      <Box sx={{ display: "flex", gap: 1, mb: 2 }}>
        <input
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") sendCommand();
          }}
          disabled={!connected}
          placeholder={connected ? "Type a server command..." : "Waiting for connection..."}
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
        <Button variant="contained" onClick={sendCommand} disabled={!connected}>
          Send
        </Button>
      </Box>

      {/* Bottom Action Bar - Mimicking Host exactly, but disabled */}
      <Box sx={{ display: "flex", justifyContent: "space-between", gap: 1, flexWrap: "wrap" }}>
        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
          <Button variant="outlined" disabled>
            Backup
          </Button>
          <Button variant="outlined" color="primary" startIcon={<SettingsIcon />} disabled>
            Settings
          </Button>
          <Button variant="outlined" color="secondary" startIcon={<AdminPanelSettingsIcon />} disabled>
            Live Admin
          </Button>
        </Box>

        <Box sx={{ display: "flex", gap: 1 }}>
          <Button variant="contained" color="success" startIcon={<PlayArrowIcon />} disabled>
            Start
          </Button>
          <Button variant="contained" color="error" startIcon={<StopIcon />} disabled>
            Stop
          </Button>
          
          {/* This button actually works to close the remote view! */}
          <Button variant="outlined" onClick={onClose}>
            Close Window
          </Button>
        </Box>
      </Box>
    </Box>
  );
}