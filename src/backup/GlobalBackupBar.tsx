import { LinearProgress, Box, Typography, IconButton } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { useBackup } from "../backup/BackupContext";

export function GlobalBackupBar() {
  const { active, percent, label } = useBackup();

  if (!active) return null;

  return (
    <Box sx={{ px: 2, py: 1, background: "#111", color: "#fff" }}>
      <Typography variant="body2">
        Backup running – {percent}%
      </Typography>

      <LinearProgress variant="determinate" value={percent} />

      <Typography variant="caption">{label}</Typography>
    </Box>
  );
}
