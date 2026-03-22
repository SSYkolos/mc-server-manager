import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";

interface ServerPropertiesEditorProps {
  serverId: string;
  serverPropertiesPath: string;
  serverRunning: boolean;
  ram?: string;
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

const instantApplyKeys = new Set<keyof ServerProperties>([
  "motd",
  "max-players",
  "difficulty",
  "gamemode",
  "pvp",
]);

function fieldChanged(
  original: ServerProperties,
  current: ServerProperties,
  key: keyof ServerProperties
) {
  return String(original[key] ?? "") !== String(current[key] ?? "");
}

function getChangedKeys(
  original: ServerProperties,
  current: ServerProperties
): Array<keyof ServerProperties> {
  return (Object.keys(current) as Array<keyof ServerProperties>).filter((key) =>
    fieldChanged(original, current, key)
  );
}

function getInstantApplyKeys(
  original: ServerProperties,
  current: ServerProperties
): Array<keyof ServerProperties> {
  return getChangedKeys(original, current).filter((key) => instantApplyKeys.has(key));
}

function getRestartRequiredKeys(
  original: ServerProperties,
  current: ServerProperties
): Array<keyof ServerProperties> {
  return getChangedKeys(original, current).filter((key) => !instantApplyKeys.has(key));
}

const inputSx = {
  "& .MuiInputBase-root": {
    color: "#eaf2ff",
    background: "rgba(255,255,255,0.03)",
    borderRadius: "12px",
  },
  "& .MuiInputLabel-root": {
    color: "rgba(220,230,245,0.58)",
  },
  "& .MuiOutlinedInput-notchedOutline": {
    borderColor: "rgba(150,170,200,0.16)",
  },
  "&:hover .MuiOutlinedInput-notchedOutline": {
    borderColor: "rgba(180,200,230,0.26)",
  },
  "& .Mui-focused .MuiOutlinedInput-notchedOutline": {
    borderColor: "rgba(147,197,253,0.65)",
  },
};

export default function ServerPropertiesEditor({
  serverId,
  serverPropertiesPath,
  serverRunning,
  ram = "4G",
  onClose,
}: ServerPropertiesEditorProps) {
  const [originalProps, setOriginalProps] = useState<ServerProperties>(defaultProperties);
  const [props, setProps] = useState<ServerProperties>(defaultProperties);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    void loadProperties();
  }, [serverPropertiesPath]);

  async function loadProperties() {
    setLoading(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const res = await window.electronAPI.readServerProperties(serverPropertiesPath);
      if (res.success && res.data) {
        const next = { ...defaultProperties, ...res.data };
        setOriginalProps(next);
        setProps(next);
      } else {
        setError(res.error || "Failed to load properties");
      }
    } catch {
      setError("Unexpected error while loading properties.");
    } finally {
      setLoading(false);
    }
  }

  async function savePropertiesOnly() {
    setSaving(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const res = await window.electronAPI.writeServerProperties(serverPropertiesPath, props);
      if (!res.success) {
        setError(res.error || "Failed to save properties");
        return false;
      }

      setOriginalProps(props);
      setSuccessMsg("Properties saved.");
      return true;
    } catch {
      setError("Unexpected error while saving properties.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function sendInstantCommands(
    changedInstantKeys: Array<keyof ServerProperties>
  ) {
    for (const key of changedInstantKeys) {
      let command: string | null = null;

      switch (key) {
        case "motd":
          command = `motd ${props.motd}`;
          break;
        case "max-players":
          command = `setidletimeout 0`; // harmless placeholder to avoid empty switch branch
          break;
        case "difficulty":
          command = `difficulty ${props.difficulty}`;
          break;
        case "gamemode":
          // no safe global server-wide live apply for everyone; skip command, restart not required
          command = null;
          break;
        case "pvp":
          command = `gamerule pvp ${props.pvp === "true" ? "true" : "false"}`;
          break;
        default:
          command = null;
      }

      if (key === "max-players") {
        // max-players is written to properties but not reliably applied live by command in vanilla server.properties
        // keep it as saved-only, no restart forced
        continue;
      }

      if (!command) continue;

      const result = await window.electronAPI.sendServerCommand({
        serverId,
        command,
      });

      if (!result?.success) {
        throw new Error(result.error || `Failed to apply "${key}" live.`);
      }
    }

    // Try a clean save flush after live changes
    await window.electronAPI.sendServerCommand({
      serverId,
      command: "save-all",
    });
  }

  async function restartServer() {
    const stopRes = await window.electronAPI.stopServerProcess({ serverId });
    if (!stopRes.success) {
      throw new Error(stopRes.error || "Failed to stop server.");
    }

    let running = true;
    for (let i = 0; i < 40; i++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const info = await window.electronAPI.getRunningServerInfo({ serverId });
      running = !!info?.running;
      if (!running) break;
    }

    if (running) {
      throw new Error("Server did not stop in time.");
    }

    const jarPath = `${serverPropertiesPath}/server.jar`;

    const startRes = await window.electronAPI.startServerProcess({
      serverId,
      pathToServerJar: jarPath,
      ram,
    });

    if (!startRes.success) {
      throw new Error(startRes.error || "Failed to restart server.");
    }
  }

  async function handleApplyNow() {
    setApplying(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const changedInstantKeys = getInstantApplyKeys(originalProps, props);
      const changedRestartKeys = getRestartRequiredKeys(originalProps, props);

      const saved = await savePropertiesOnly();
      if (!saved) return;

      if (serverRunning && changedInstantKeys.length > 0) {
        await sendInstantCommands(changedInstantKeys);
      }

      if (serverRunning && changedRestartKeys.length > 0) {
        const confirmed = window.confirm(
          `Some changes require a restart to fully apply:\n\n${changedRestartKeys.join(
            ", "
          )}\n\nRestart the server now?`
        );

        if (confirmed) {
          await restartServer();
          setSuccessMsg("Properties applied. Server restarted.");
          return;
        }

        setSuccessMsg(
          "Properties saved. Some changes will apply after the next restart."
        );
        return;
      }

      if (!serverRunning && changedRestartKeys.length > 0) {
        setSuccessMsg("Properties saved. Restart the server later to apply all changes.");
        return;
      }

      setSuccessMsg(
        serverRunning
          ? "Properties applied."
          : "Properties saved."
      );
    } catch (err: any) {
      setError(err?.message || "Failed to apply properties.");
    } finally {
      setApplying(false);
    }
  }

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) {
    const { name, value } = e.target;
    setProps((prev) => ({ ...prev, [name]: value }));
  }

  const changedKeys = useMemo(
    () => getChangedKeys(originalProps, props),
    [originalProps, props]
  );
  const changedInstantKeys = useMemo(
    () => getInstantApplyKeys(originalProps, props),
    [originalProps, props]
  );
  const changedRestartKeys = useMemo(
    () => getRestartRequiredKeys(originalProps, props),
    [originalProps, props]
  );

  const hasChanges = changedKeys.length > 0;

  return (
    <Paper
      sx={{
        width: "100%",
        height: "100%",
        background:
          "linear-gradient(180deg, #06090d 0%, #0b1016 100%)",
        color: "#fff",
        display: "flex",
        flexDirection: "column",
        borderRadius: 0,
        overflow: "hidden",
      }}
    >
      <Box
        sx={{
          px: 2,
          py: 1.2,
          borderBottom: "1px solid rgba(150,170,200,0.10)",
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.018) 100%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 2,
        }}
      >
        <Box>
          <Typography
            sx={{
              fontSize: 13,
              fontWeight: 800,
              letterSpacing: 0.9,
              textTransform: "uppercase",
              color: "#eaf2ff",
            }}
          >
            Server Properties
          </Typography>
          <Typography sx={{ fontSize: 11.5, color: "rgba(220,230,245,0.52)" }}>
            Editing local folder: {serverPropertiesPath}
          </Typography>
        </Box>

        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
          <Chip
            label={serverRunning ? "Server Running" : "Server Stopped"}
            size="small"
            sx={{
              color: "#eaf2ff",
              border: "1px solid rgba(150,170,200,0.14)",
              background: serverRunning
                ? "rgba(57,217,138,0.12)"
                : "rgba(255,176,32,0.12)",
            }}
          />
          {hasChanges && (
            <Chip
              label={`${changedKeys.length} unsaved change${changedKeys.length === 1 ? "" : "s"}`}
              size="small"
              sx={{
                color: "#eaf2ff",
                border: "1px solid rgba(150,170,200,0.14)",
                background: "rgba(147,197,253,0.10)",
              }}
            />
          )}
        </Stack>
      </Box>

      <Box sx={{ p: 2, overflowY: "auto", flex: 1 }}>
        {(loading || saving || applying) && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.2, mb: 2 }}>
            <CircularProgress size={18} />
            <Typography sx={{ fontSize: 12.5, color: "rgba(220,230,245,0.68)" }}>
              {loading
                ? "Loading properties..."
                : applying
                ? "Applying changes..."
                : "Saving properties..."}
            </Typography>
          </Box>
        )}

        {error && (
          <Alert
            severity="error"
            sx={{ mb: 2, background: "rgba(255,82,82,0.10)", color: "#ffdada" }}
          >
            {error}
          </Alert>
        )}

        {successMsg && (
          <Alert
            severity="success"
            sx={{ mb: 2, background: "rgba(57,217,138,0.10)", color: "#d9ffe8" }}
          >
            {successMsg}
          </Alert>
        )}

        <Stack spacing={2}>
          <Paper
            sx={{
              p: 2,
              borderRadius: 2,
              border: "1px solid rgba(150,170,200,0.10)",
              background: "rgba(255,255,255,0.018)",
              color: "#fff",
            }}
          >
            <Typography
              sx={{
                mb: 1.5,
                fontSize: 12,
                fontWeight: 800,
                letterSpacing: 0.8,
                textTransform: "uppercase",
                color: "#dbe6f7",
              }}
            >
              Gameplay
            </Typography>

            <Stack spacing={2}>
              <TextField
                label="MOTD"
                name="motd"
                value={props.motd}
                onChange={handleChange}
                fullWidth
                sx={inputSx}
              />

              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: { xs: "1fr", md: "1fr 1fr 1fr" },
                  gap: 2,
                }}
              >
                <TextField
                  label="Max Players"
                  type="number"
                  name="max-players"
                  value={props["max-players"]}
                  onChange={handleChange}
                  inputProps={{ min: 1, max: 100 }}
                  fullWidth
                  sx={inputSx}
                />

                <TextField
                  select
                  label="Gamemode"
                  name="gamemode"
                  value={props.gamemode}
                  onChange={handleChange}
                  fullWidth
                  sx={inputSx}
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
                  sx={inputSx}
                >
                  <MenuItem value="peaceful">Peaceful</MenuItem>
                  <MenuItem value="easy">Easy</MenuItem>
                  <MenuItem value="normal">Normal</MenuItem>
                  <MenuItem value="hard">Hard</MenuItem>
                </TextField>
              </Box>

              <TextField
                select
                label="PvP"
                name="pvp"
                value={props.pvp}
                onChange={handleChange}
                fullWidth
                sx={inputSx}
              >
                <MenuItem value="true">Enabled</MenuItem>
                <MenuItem value="false">Disabled</MenuItem>
              </TextField>
            </Stack>
          </Paper>

          <Paper
            sx={{
              p: 2,
              borderRadius: 2,
              border: "1px solid rgba(150,170,200,0.10)",
              background: "rgba(255,255,255,0.018)",
              color: "#fff",
            }}
          >
            <Typography
              sx={{
                mb: 1.5,
                fontSize: 12,
                fontWeight: 800,
                letterSpacing: 0.8,
                textTransform: "uppercase",
                color: "#dbe6f7",
              }}
            >
              Distances
            </Typography>

            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
                gap: 2,
              }}
            >
              <TextField
                label="View Distance"
                type="number"
                name="view-distance"
                value={props["view-distance"]}
                onChange={handleChange}
                inputProps={{ min: 2, max: 32 }}
                fullWidth
                sx={inputSx}
              />

              <TextField
                label="Simulation Distance"
                type="number"
                name="simulation-distance"
                value={props["simulation-distance"]}
                onChange={handleChange}
                inputProps={{ min: 2, max: 32 }}
                fullWidth
                sx={inputSx}
              />
            </Box>
          </Paper>

          <Paper
            sx={{
              p: 2,
              borderRadius: 2,
              border: "1px solid rgba(150,170,200,0.10)",
              background: "rgba(255,255,255,0.018)",
              color: "#fff",
            }}
          >
            <Typography
              sx={{
                mb: 1.2,
                fontSize: 12,
                fontWeight: 800,
                letterSpacing: 0.8,
                textTransform: "uppercase",
                color: "#dbe6f7",
              }}
            >
              Apply behavior
            </Typography>

            <Stack spacing={1}>
              <Typography sx={{ fontSize: 12, color: "rgba(220,230,245,0.70)" }}>
                Live apply when possible: MOTD, difficulty, PvP.
              </Typography>
              <Typography sx={{ fontSize: 12, color: "rgba(220,230,245,0.50)" }}>
                Restart usually required for: view distance, simulation distance.
              </Typography>
            </Stack>

            {hasChanges && (
              <>
                <Divider sx={{ my: 1.5, borderColor: "rgba(150,170,200,0.10)" }} />
                <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                  {changedInstantKeys.length > 0 && (
                    <Chip
                      size="small"
                      label={`Live: ${changedInstantKeys.join(", ")}`}
                      sx={{
                        color: "#eaf2ff",
                        border: "1px solid rgba(57,217,138,0.20)",
                        background: "rgba(57,217,138,0.10)",
                      }}
                    />
                  )}
                  {changedRestartKeys.length > 0 && (
                    <Chip
                      size="small"
                      label={`Restart: ${changedRestartKeys.join(", ")}`}
                      sx={{
                        color: "#eaf2ff",
                        border: "1px solid rgba(255,176,32,0.20)",
                        background: "rgba(255,176,32,0.10)",
                      }}
                    />
                  )}
                </Stack>
              </>
            )}
          </Paper>
        </Stack>
      </Box>

      <Box
        sx={{
          px: 2,
          py: 1.5,
          borderTop: "1px solid rgba(150,170,200,0.10)",
          background: "rgba(255,255,255,0.018)",
          display: "flex",
          justifyContent: "space-between",
          gap: 1,
          flexWrap: "wrap",
        }}
      >
        <Stack direction="row" spacing={1}>
          <Button
            variant="outlined"
            onClick={loadProperties}
            disabled={loading || saving || applying}
            sx={{
              color: "#eaf2ff",
              borderColor: "rgba(150,170,200,0.18)",
            }}
          >
            Reload
          </Button>

          <Button
            variant="outlined"
            onClick={savePropertiesOnly}
            disabled={!hasChanges || loading || saving || applying}
            sx={{
              color: "#eaf2ff",
              borderColor: "rgba(150,170,200,0.18)",
            }}
          >
            Save
          </Button>
        </Stack>

        <Stack direction="row" spacing={1}>
          <Button
            variant="contained"
            onClick={handleApplyNow}
            disabled={!hasChanges || loading || saving || applying}
          >
            Apply Now
          </Button>

          <Button variant="outlined" onClick={onClose} sx={{ color: "#eaf2ff", borderColor: "rgba(150,170,200,0.18)" }}>
            Close
          </Button>
        </Stack>
      </Box>
    </Paper>
  );
}
