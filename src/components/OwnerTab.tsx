import React, { useEffect, useMemo, useState } from "react";
import {
  Box,
  CircularProgress,
  IconButton,
  LinearProgress,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import LockIcon from "@mui/icons-material/Lock";
import LockOpenIcon from "@mui/icons-material/LockOpen";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
} from "firebase/firestore";
import { db } from "../firebase";

type InviteItem = {
  id: string;
  invited: string;
  status: string;
  role: string;
};

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let value = bytes;

  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }

  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[i]}`;
}

function getInviteBg(status: string) {
  const normalized = String(status || "").toLowerCase();

  if (normalized === "accepted") {
    return "rgba(57,217,138,0.14)";
  }

  if (normalized === "declined") {
    return "rgba(255,82,82,0.16)";
  }

  return "rgba(255,176,32,0.16)";
}

function getInviteBorder(status: string) {
  const normalized = String(status || "").toLowerCase();

  if (normalized === "accepted") {
    return "rgba(57,217,138,0.34)";
  }

  if (normalized === "declined") {
    return "rgba(255,82,82,0.34)";
  }

  return "rgba(255,176,32,0.34)";
}

function StatInline({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "baseline",
        gap: 0.65,
        minWidth: 0,
        whiteSpace: "nowrap",
      }}
    >
      <Typography
        sx={{
          fontSize: 10.5,
          textTransform: "uppercase",
          letterSpacing: 0.8,
          color: "rgba(210,220,235,0.42)",
        }}
      >
        {label}
      </Typography>
      <Typography
        sx={{
          fontSize: 12.5,
          fontWeight: 700,
          color: "#eaf2ff",
          fontFamily:
            '"IBM Plex Mono","JetBrains Mono","Fira Code","Consolas","monospace"',
        }}
      >
        {value}
      </Typography>
    </Box>
  );
}

export default function OwnerTab({
  serverId,
  accessToken,
}: {
  serverId: string;
  accessToken: string;
}) {
  const [loading, setLoading] = useState(true);
  const [savingRetention, setSavingRetention] = useState(false);
  const [deletingInviteId, setDeletingInviteId] = useState<string | null>(null);

  const [savedRetention, setSavedRetention] = useState<number>(5);
  const [retentionInput, setRetentionInput] = useState("5");
  const [retentionLocked, setRetentionLocked] = useState(true);
  const [serverLoader, setServerLoader] = useState("vanilla");

  const [storage, setStorage] = useState<{
    limit: number;
    usage: number;
    usageInDrive: number;
    free: number;
  } | null>(null);

  const [serverDriveUsage, setServerDriveUsage] = useState<number | null>(null);
  const [invites, setInvites] = useState<InviteItem[]>([]);
  const [error, setError] = useState("");

  const driveUsagePercent = useMemo(() => {
    if (!storage?.limit || storage.limit <= 0 || !storage.usage) return 0;
    return Math.max(0, Math.min(100, (storage.usage / storage.limit) * 100));
  }, [storage]);

  const serverDrivePercent = useMemo(() => {
    if (!storage?.limit || storage.limit <= 0 || !serverDriveUsage) return 0;
    return Math.max(0, Math.min(100, (serverDriveUsage / storage.limit) * 100));
  }, [storage, serverDriveUsage]);

  async function loadOwnerData() {
    setLoading(true);
    setError("");

    if (!serverId) {
      setError("Missing serverId in owner window.");
      setLoading(false);
      return;
    }

    try {
      const serverRef = doc(db, "servers", serverId);
      const serverSnap = await getDoc(serverRef);
const backupRetentionCount =
  serverSnap.exists() && typeof serverSnap.data()?.backupRetentionCount === "number"
    ? serverSnap.data()!.backupRetentionCount
    : 5;

const loader =
  serverSnap.exists() && typeof serverSnap.data()?.loader === "string"
    ? serverSnap.data()!.loader
    : "vanilla";

setSavedRetention(backupRetentionCount);
setRetentionInput(String(backupRetentionCount));
setServerLoader(loader);

const invitesRef = collection(db, "servers", serverId, "invites");
const invitesSnap = await getDocs(invitesRef);

const nextInvites: InviteItem[] = invitesSnap.docs.map((docSnap) => {
  const data = docSnap.data() || {};
  return {
    id: docSnap.id,
    invited: data.invited || docSnap.id,
    status: data.status || "pending",
    role: data.role || "member",
  };
});

nextInvites.sort((a, b) => a.invited.localeCompare(b.invited));
setInvites(nextInvites);

if (accessToken) {
  const [storageRes, serverUsageRes] = await Promise.all([
    window.electronAPI.getDriveStorageInfo({ accessToken }),
    window.electronAPI.getServerDriveUsage({ accessToken, serverId, loader }),
  ]);

  if (storageRes.success && storageRes.storage) {
    setStorage(storageRes.storage);
  } else {
    setStorage(null);
  }

  if (serverUsageRes.success && typeof serverUsageRes.usage === "number") {
    setServerDriveUsage(serverUsageRes.usage);
  } else {
    setServerDriveUsage(null);
  }
} else {
  setStorage(null);
  setServerDriveUsage(null);
}
    } catch (err: any) {
      setError(err?.message || "Failed to load owner data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadOwnerData();
  }, [serverId, accessToken]);


  async function handleSaveRetention() {
    const parsed = Number(retentionInput);

    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 999) {
      alert("Please enter a whole number between 1 and 999.");
      return;
    }

    const confirmed = window.confirm(
      `Do you really want to save ${parsed} backups for this server?`
    );
    if (!confirmed) return;

    setSavingRetention(true);

    try {
      const serverRef = doc(db, "servers", serverId);

      await setDoc(
        serverRef,
        { backupRetentionCount: parsed },
        { merge: true }
      );

      setSavedRetention(parsed);
      setRetentionInput(String(parsed));
      setRetentionLocked(true);
    } catch (err: any) {
      alert(err?.message || "Failed to save backup retention.");
    } finally {
      setSavingRetention(false);
    }
  }

  async function handleDeleteInvite(inviteId: string) {
    const confirmed = window.confirm("Delete this invite?");
    if (!confirmed) return;

    setDeletingInviteId(inviteId);

    try {
      await deleteDoc(doc(db, "servers", serverId, "invites", inviteId));
      setInvites((prev) => prev.filter((invite) => invite.id !== inviteId));
    } catch (err: any) {
      alert(err?.message || "Failed to delete invite.");
    } finally {
      setDeletingInviteId(null);
    }
  }

  if (!serverId) {
    return (
      <Box sx={{ p: 3, color: "#fff", backgroundColor: "#0b0b0b", minHeight: "100vh" }}>
        <Typography color="error">Missing serverId in owner window.</Typography>
      </Box>
    );
  }

  if (loading) {
    return (
      <Box
        sx={{
          minHeight: "100vh",
          backgroundColor: "#0b0b0b",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <CircularProgress size={30} />
      </Box>
    );
  }

  return (
    <Box
      sx={{
        minHeight: "100vh",
        background: "linear-gradient(180deg, #06090d 0%, #0b1016 100%)",
        color: "#fff",
        p: 1,
        fontFamily: '"Inter", "Segoe UI", sans-serif',
      }}
    >
      <Box
        sx={{
          mb: 0.8,
          px: 1.1,
          py: 0.7,
          borderRadius: 1.6,
          border: "1px solid rgba(150,170,200,0.10)",
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.018) 100%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 1,
        }}
      >
        <Stack direction="row" spacing={1} alignItems="center">
          <Box
            sx={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "#93c5fd",
              boxShadow: "0 0 8px rgba(147,197,253,0.45)",
            }}
          />
          <Typography
            sx={{
              fontSize: 13,
              fontWeight: 800,
              letterSpacing: 0.9,
              textTransform: "uppercase",
              color: "#eaf2ff",
            }}
          >
            Owner Panel
          </Typography>
        </Stack>

        <Stack direction="row" spacing={1.2} useFlexGap flexWrap="wrap">
          <StatInline label="server" value={serverId} />
          <StatInline label="retention" value={String(savedRetention)} />
          <StatInline label="invites" value={String(invites.length)} />
        </Stack>
      </Box>

      <Stack spacing={0.75}>
        {error && (
          <Paper
            sx={{
              p: 1.25,
              borderRadius: 1.8,
              border: "1px solid rgba(255,82,82,0.20)",
              background: "rgba(255,82,82,0.08)",
              color: "#ffd7d7",
            }}
          >
            <Typography sx={{ fontSize: 12.5 }}>{error}</Typography>
          </Paper>
        )}

        <Paper
          sx={{
            p: 1.25,
            borderRadius: 1.8,
            border: "1px solid rgba(150,170,200,0.10)",
            background: "rgba(255,255,255,0.018)",
            color: "#fff",
          }}
        >
          <Typography
            sx={{
              mb: 1,
              fontSize: 12,
              fontWeight: 800,
              letterSpacing: 0.8,
              textTransform: "uppercase",
              color: "#dbe6f7",
            }}
          >
            Backups
          </Typography>

          <Stack direction="row" spacing={1} alignItems="center">
            <TextField
              label="Stored backups"
              value={retentionInput}
              onChange={(e) => setRetentionInput(e.target.value)}
              disabled={retentionLocked || savingRetention}
              size="small"
              sx={{
                maxWidth: 180,
                "& .MuiInputBase-root": {
                  color: "#eaf2ff",
                  background: "rgba(255,255,255,0.02)",
                },
                "& .MuiInputLabel-root": {
                  color: "rgba(220,230,245,0.58)",
                },
                "& .MuiOutlinedInput-notchedOutline": {
                  borderColor: "rgba(150,170,200,0.14)",
                },
              }}
            />

            {retentionLocked ? (
              <IconButton
                onClick={() => setRetentionLocked(false)}
                title="Unlock"
                sx={{ color: "#eaf2ff" }}
              >
                <LockOpenIcon />
              </IconButton>
            ) : (
              <IconButton
                onClick={handleSaveRetention}
                title="Lock and save"
                disabled={savingRetention}
                sx={{ color: "#eaf2ff" }}
              >
                <LockIcon />
              </IconButton>
            )}
          </Stack>

          <Typography sx={{ mt: 1, fontSize: 11.5, color: "rgba(220,230,245,0.55)" }}>
            Current saved value: {savedRetention}
          </Typography>
        </Paper>

        <Paper
          sx={{
            p: 1.25,
            borderRadius: 1.8,
            border: "1px solid rgba(150,170,200,0.10)",
            background: "rgba(255,255,255,0.018)",
            color: "#fff",
          }}
        >
          <Typography
            sx={{
              mb: 1,
              fontSize: 12,
              fontWeight: 800,
              letterSpacing: 0.8,
              textTransform: "uppercase",
              color: "#dbe6f7",
            }}
          >
            Drive
          </Typography>

          {!storage ? (
            <Typography sx={{ fontSize: 11.5, color: "rgba(220,230,245,0.48)" }}>
              Could not load Drive storage info.
            </Typography>
          ) : (
            <Stack spacing={1.1}>
              <Box>
                <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
                  <Typography sx={{ fontSize: 11.5, color: "#eaf2ff" }}>
                    Whole Drive
                  </Typography>
                  <Typography sx={{ fontSize: 11.5, color: "rgba(220,230,245,0.62)" }}>
                    {formatBytes(storage.usage)} / {formatBytes(storage.limit)}
                  </Typography>
                </Stack>
                <LinearProgress
                  variant="determinate"
                  value={driveUsagePercent}
                  sx={{
                    height: 7,
                    borderRadius: 999,
                    backgroundColor: "rgba(255,255,255,0.06)",
                    "& .MuiLinearProgress-bar": {
                      borderRadius: 999,
                      background: "linear-gradient(90deg, #93c5fd 0%, #dbeafe 100%)",
                    },
                  }}
                />
                <Typography sx={{ mt: 0.45, fontSize: 11, color: "rgba(220,230,245,0.50)" }}>
                  Free: {formatBytes(storage.free)}
                </Typography>
              </Box>

              <Box>
                <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
                  <Typography sx={{ fontSize: 11.5, color: "#eaf2ff" }}>
                    This server on Drive
                  </Typography>
                  <Typography sx={{ fontSize: 11.5, color: "rgba(220,230,245,0.62)" }}>
                    {serverDriveUsage === null ? "—" : formatBytes(serverDriveUsage)}
                  </Typography>
                </Stack>
                <LinearProgress
                  variant="determinate"
                  value={serverDrivePercent}
                  sx={{
                    height: 7,
                    borderRadius: 999,
                    backgroundColor: "rgba(255,255,255,0.06)",
                    "& .MuiLinearProgress-bar": {
                      borderRadius: 999,
                      background: "linear-gradient(90deg, #39d98a 0%, #b9fbcf 100%)",
                    },
                  }}
                />
              </Box>
            </Stack>
          )}
        </Paper>

        <Paper
          sx={{
            p: 1.25,
            borderRadius: 1.8,
            border: "1px solid rgba(150,170,200,0.10)",
            background: "rgba(255,255,255,0.018)",
            color: "#fff",
          }}
        >
          <Typography
            sx={{
              mb: 1,
              fontSize: 12,
              fontWeight: 800,
              letterSpacing: 0.8,
              textTransform: "uppercase",
              color: "#dbe6f7",
            }}
          >
            Invites
          </Typography>

          {invites.length === 0 ? (
            <Typography sx={{ fontSize: 11.5, color: "rgba(220,230,245,0.48)" }}>
              No invites found.
            </Typography>
          ) : (
            <Stack spacing={0.8}>
              {invites.map((invite) => (
                <Box
                  key={invite.id}
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 1.2,
                    px: 1.2,
                    py: 0.95,
                    borderRadius: 1.5,
                    border: `1px solid ${getInviteBorder(invite.status)}`,
                    background: getInviteBg(invite.status),
                  }}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Typography
                      sx={{
                        fontSize: 12.5,
                        fontWeight: 700,
                        color: "#eaf2ff",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {invite.invited}
                    </Typography>
                    <Typography
                      sx={{
                        fontSize: 11,
                        color: "rgba(220,230,245,0.62)",
                        textTransform: "capitalize",
                      }}
                    >
                      {invite.role} • {invite.status}
                    </Typography>
                  </Box>

                  <IconButton
                    size="small"
                    color="error"
                    onClick={() => handleDeleteInvite(invite.id)}
                    disabled={deletingInviteId === invite.id}
                  >
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </Box>
              ))}
            </Stack>
          )}
        </Paper>
      </Stack>
    </Box>
  );
}