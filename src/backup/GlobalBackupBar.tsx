import { LinearProgress, Box, Typography } from "@mui/material";
import { useBackup } from "../backup/BackupContext";

function phaseLabel(phase: string) {
  switch (phase) {
    case "scanning":
      return "Scanning files";
    case "packing":
      return "Building small packs";
    case "uploading":
      return "Uploading changed data";
    case "saving-indexes":
      return "Saving indexes";
    case "snapshot":
      return "Writing snapshot";
    case "finalizing":
      return "Finalizing";
    case "done":
      return "Backup completed";
    case "error":
      return "Backup failed";
    default:
      return "Backup running";
  }
}

export function GlobalBackupBar() {
  const { active, status, phase, percent, title, detail } = useBackup();

  if (!active) return null;

  return (
    <Box
      sx={{
        px: 2,
        py: 1.25,
        background: "#0f1115",
        color: "#fff",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {title} — {phaseLabel(phase)}
      </Typography>

      <Box sx={{ mt: 0.75 }}>
        <LinearProgress variant="determinate" value={percent} />
      </Box>

      <Box
        sx={{
          mt: 0.5,
          display: "flex",
          justifyContent: "space-between",
          gap: 2,
          opacity: 0.9,
        }}
      >
        <Typography variant="caption">
          {detail || phaseLabel(phase)}
        </Typography>
        <Typography variant="caption">
          {status === "done" ? "Done" : status === "error" ? "Error" : `${percent}%`}
        </Typography>
      </Box>
    </Box>
  );
}