import React, { useEffect, useState } from "react";
import { Paper, Box, IconButton, Typography, Button, TextField, MenuItem } from "@mui/material";
import CloseIcon from '@mui/icons-material/Close';

interface ServerPropertiesEditorProps {
  serverPropertiesPath: string;
  onClose: () => void;
}

type ServerProperties = {
  "view-distance": string;
  "simulation-distance": string;
  "max-players": string;
  gamemode: string;
  difficulty: string;
  pvp: string;
  motd: string;
};

const defaultProperties: ServerProperties = {
  "view-distance": "10",
  "simulation-distance": "10",
  "max-players": "20",
  gamemode: "survival",
  difficulty: "easy",
  pvp: "true",
  motd: "A Minecraft Server",
};

export default function ServerPropertiesEditor({ serverPropertiesPath, onClose }: ServerPropertiesEditorProps) {
  const [props, setProps] = useState<ServerProperties>(defaultProperties);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Drag state
  const [position, setPosition] = useState({ x: 100, y: 100 });
  const [dragging, setDragging] = useState(false);
  const [rel, setRel] = useState({ x: 0, y: 0 });

  useEffect(() => { loadProperties(); }, [serverPropertiesPath]);

  async function loadProperties() {
    setLoading(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await window.electronAPI.readServerProperties(serverPropertiesPath);
      if (res.success && res.data) setProps({ ...defaultProperties, ...res.data });
      else setError(res.error || "Failed to load properties");
    } catch { setError("Unexpected error"); }
    finally { setLoading(false); }
  }

  async function saveProperties() {
    setSaving(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await window.electronAPI.writeServerProperties(serverPropertiesPath, props);
      if (res.success) setSuccessMsg("Properties saved successfully!");
      else setError(res.error || "Failed to save properties");
    } catch { setError("Unexpected error"); }
    finally { setSaving(false); }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) {
    const { name, value } = e.target;
    setProps((prev) => ({ ...prev, [name]: value }));
  }

  // --- Drag handlers ---
  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const rect = (e.target as HTMLElement).closest(".draggable")?.getBoundingClientRect();
    if (!rect) return;
    setDragging(true);
    setRel({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    e.stopPropagation();
    e.preventDefault();
  };

  const onMouseMove = (e: MouseEvent) => {
    if (!dragging) return;
    setPosition({ x: e.clientX - rel.x, y: e.clientY - rel.y });
  };

  const onMouseUp = () => { setDragging(false); };

  useEffect(() => {
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  });

  return (
    <Paper
      className="draggable"
      sx={{
        position: "fixed",
        left: position.x,
        top: position.y,
        width: 500,
        maxHeight: "85vh",
        p: 3,
        zIndex: 2000,
        borderRadius: 2,
        boxShadow: 12,
        backgroundColor: "#f9f9f9",
        border: "1px solid #ccc",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        fontFamily: "Roboto, sans-serif",
      }}
    >
      {/* Title bar */}
      <Box
        sx={{
          cursor: "move",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          mb: 2,
          backgroundColor: "#1976d2",
          color: "#fff",
          p: 1,
          borderRadius: "8px 8px 0 0",
          userSelect: "none",
        }}
        onMouseDown={onMouseDown}
      >
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Server Properties Editor</Typography>
        <IconButton onClick={onClose} sx={{ color: "#fff", p: 0.5 }}>
          <CloseIcon />
        </IconButton>
      </Box>

      {/* Info messages */}
      <Box sx={{ mb: 2 }}>
        <Typography variant="body2"><strong>Editing:</strong> {serverPropertiesPath}</Typography>
        {loading && <Typography color="text.secondary">Loading properties...</Typography>}
        {error && <Typography color="error">{error}</Typography>}
        {successMsg && <Typography color="success.main">{successMsg}</Typography>}
      </Box>

      {/* Form */}
      {!loading && (
        <Box
          component="form"
          onSubmit={(e) => { e.preventDefault(); saveProperties(); }}
          sx={{ flex: 1, display: "flex", flexDirection: "column", gap: 2, overflowY: "auto" }}
        >
          <TextField
            label="View Distance"
            type="number"
            name="view-distance"
            value={props["view-distance"]}
            onChange={handleChange}
            inputProps={{ min: 2, max: 32 }}
            fullWidth
            variant="outlined"
          />
          <TextField
            label="Simulation Distance"
            type="number"
            name="simulation-distance"
            value={props["simulation-distance"]}
            onChange={handleChange}
            inputProps={{ min: 2, max: 32 }}
            fullWidth
            variant="outlined"
          />
          <TextField
            label="Max Players"
            type="number"
            name="max-players"
            value={props["max-players"]}
            onChange={handleChange}
            inputProps={{ min: 1, max: 100 }}
            fullWidth
            variant="outlined"
          />
          <TextField
            select
            label="Gamemode"
            name="gamemode"
            value={props.gamemode}
            onChange={handleChange}
            fullWidth
            variant="outlined"
          >
            <MenuItem value="survival">Survival</MenuItem>
            <MenuItem value="creative">Creative</MenuItem>
            <MenuItem value="adventure">Adventure</MenuItem>
            <MenuItem value="spectator">Spectator</MenuItem>
          </TextField>
          <TextField
            select
            label="Difficulty"
            name="difficulty"
            value={props.difficulty}
            onChange={handleChange}
            fullWidth
            variant="outlined"
          >
            <MenuItem value="peaceful">Peaceful</MenuItem>
            <MenuItem value="easy">Easy</MenuItem>
            <MenuItem value="normal">Normal</MenuItem>
            <MenuItem value="hard">Hard</MenuItem>
          </TextField>
          <TextField
            select
            label="PvP"
            name="pvp"
            value={props.pvp}
            onChange={handleChange}
            fullWidth
            variant="outlined"
          >
            <MenuItem value="true">Enabled</MenuItem>
            <MenuItem value="false">Disabled</MenuItem>
          </TextField>
          <TextField
            label="MOTD"
            name="motd"
            value={props.motd}
            onChange={handleChange}
            fullWidth
            variant="outlined"
          />

          <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1, mt: 1 }}>
            <Button variant="contained" type="submit" disabled={saving}>
              {saving ? "Saving..." : "Save Properties"}
            </Button>
            <Button variant="outlined" onClick={onClose}>Close</Button>
          </Box>
        </Box>
      )}
    </Paper>
  );
}

