import type { ServerDetailsProps, ServerUser, Role } from "../types/types";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  doc,
  getDoc,
  updateDoc,
  serverTimestamp,
  arrayRemove,
  arrayUnion,
  deleteField,
  collection,
  onSnapshot,
  orderBy,
  query,
  writeBatch,
  deleteDoc,
  getDocs,
} from "firebase/firestore";
import { db } from "../firebase";
import { User } from "firebase/auth";
import InviteUser from "./InviteUser";
import { MoreVertical } from "lucide-react";
import HostServer from "./HostServer";





type ServerMod = {
  id: string;
  driveFileId: string;
  name: string;
  size?: string;
  createdTime?: string;
  enabled: boolean;
  source?: "manual" | "modrinth";
  updatedAt?: any;
};

export default function ServerDetails({ serverId, user }: ServerDetailsProps) {
  const [users, setUsers] = useState<ServerUser[]>([]);
  const [serverName, setServerName] = useState<string>("");
  const [serverOwnerId, setServerOwnerId] = useState<string>("");
  const [userRole, setUserRole] = useState<Role | "">("");
  const [error, setError] = useState<string>("");
  const [joining, setJoining] = useState(false);
  const [invited, setInvited] = useState(false);
  const [inviteActionLoading, setInviteActionLoading] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [showHostModal, setShowHostModal] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const modsDropdownRef = useRef<HTMLDivElement | null>(null);
  const [showRoleWarning, setShowRoleWarning] = useState(false);
  const [showConsole, setShowConsole] = useState(false);
  const [ram, setRam] = useState<string | null>(null);
  const [mcVersion, setMcVersion] = useState<string | null>(null);
  const [extractPath, setExtractPath] = useState("");
  const [serverHosted, setServerHosted] = useState(false);
  const [serverLoader, setServerLoader] = useState<string>("vanilla");



const [showModsDropdown, setShowModsDropdown] = useState(false);
const [mods, setMods] = useState<ServerMod[]>([]);
const [modsLoading, setModsLoading] = useState(false);
const [modsUploading, setModsUploading] = useState(false);
const [modsDownloading, setModsDownloading] = useState(false);
const [modsSyncing, setModsSyncing] = useState(false);
const [modsTogglingId, setModsTogglingId] = useState<string | null>(null);
const [modsError, setModsError] = useState("");
const [modsNotice, setModsNotice] = useState("");
const isAdmin = userRole === "owner" || userRole === "admin";

  const [runtimeState, setRuntimeState] = useState<string>("stopped");
  const [runtimePort, setRuntimePort] = useState<number | null>(null);
  const [publicIp, setPublicIp] = useState<string>("");
  const [upnpStatus, setUpnpStatus] = useState<string>("idle");
  const [upnpError, setUpnpError] = useState<string>("");
  const [reachability, setReachability] = useState<
    "idle" | "checking" | "reachable" | "blocked"
  >("idle");

  const enabledModsCount = useMemo(
    () => mods.filter((mod) => mod.enabled).length,
    [mods]
  );



  // Close open menus on outside click
// Close role menu / mods dropdown on outside click
useEffect(() => {
  const handleClickOutside = (event: MouseEvent) => {
    const target = event.target as Node;

    if (menuRef.current && !menuRef.current.contains(target)) {
      setOpenMenuId(null);
    }

    if (modsDropdownRef.current && !modsDropdownRef.current.contains(target)) {
      setShowModsDropdown(false);
    }
  };

  document.addEventListener("mousedown", handleClickOutside);
  return () => {
    document.removeEventListener("mousedown", handleClickOutside);
  };
}, [openMenuId, showModsDropdown]);

async function handleOpenDetachedConsole() {
  try {
    const runtimeInfo = await window.electronAPI.getRunningServerInfo({ serverId });

    const result = await window.electronAPI.openServerConsole({
      serverId,
      role: isAdmin ? "admin" : "viewer",
      extractPath: runtimeInfo.success && runtimeInfo.running && runtimeInfo.data
        ? runtimeInfo.data.extractPath
        : extractPath || undefined,
      ram: runtimeInfo.success && runtimeInfo.running && runtimeInfo.data
        ? runtimeInfo.data.ram
        : ram,
      mcVersion,
      isAdmin,
    });

    if (!result.success) {
      alert(result.error || "Failed to open console window.");
    }
  } catch (err) {
    console.error("Failed to open detached console", err);
    alert("Failed to open detached console.");
  }
}

async function handleJoinServer() {
  if (!user) {
    alert("You must be logged in to join.");
    return;
  }

  setJoining(true);

  try {
    const serverDoc = await getDoc(doc(db, "servers", serverId));
    if (!serverDoc.exists()) {
      setError("Server not found");
      setJoining(false);
      return;
    }

    const serverData = serverDoc.data();

    if (!serverData?.liveInfo) {
      alert("Server is not currently online.");
      setJoining(false);
      return;
    }

const { ip, port } = serverData.liveInfo;
const loader = serverData.loader || "vanilla";
const version = serverData.mcVersion || "1.20.1";

    // 1️⃣ Try opening the Minecraft link
    const mcLink = `minecraft://${ip}:${port}`;
    window.open(mcLink);

    // 2️⃣ Always copy server info to clipboard
    const clipboardText = `Server IP: ${ip}\nPort: ${port}\nLoader: ${loader || "vanilla"}\nVersion: ${version}`;
    await navigator.clipboard.writeText(clipboardText);

    alert("Server info copied to clipboard! You can paste it into any client (MultiMC, Vanilla, etc).");



    await fetchServerUsers();
  } catch (err) {
    console.error(err);
    setError("Failed to join server.");
  }

  setJoining(false);
}


function handleToggleModsDropdown() {
  setShowModsDropdown((prev) => !prev);
}

async function getServerDriveContext() {
  const serverDoc = await getDoc(doc(db, "servers", serverId));
  if (!serverDoc.exists()) {
    throw new Error("Server not found");
  }

  const serverData = serverDoc.data();
  const linkedDriveId = serverData.linkedDriveId;
  const createdBy = serverData.createdBy;
  const loader = serverData.loader || "vanilla";

  if (!linkedDriveId || !createdBy) {
    throw new Error("Drive is not linked for this server.");
  }

  const accessToken = await window.electronAPI.getValidAccessToken({
    userId: createdBy,
    driveId: linkedDriveId,
  });

  return {
    serverData,
    linkedDriveId,
    createdBy,
    loader,
    accessToken,
  };
}

async function handleOpenOwnerWindow() {
  try {
    const { accessToken } = await getServerDriveContext();

    const result = await window.electronAPI.openServerOwner({
      serverId,
      accessToken,
    });

    if (!result.success) {
      alert(result.error || "Failed to open owner window.");
    }
  } catch (err: any) {
    alert(err?.message || "Failed to open owner window.");
  }
}

async function upsertModsInFirestore(
  incomingMods: Array<{
    id: string;
    name: string;
    size?: string;
    createdTime?: string;
    source?: "manual" | "modrinth";
    enabled?: boolean;
  }>
) {
  const modsCollectionRef = collection(db, "servers", serverId, "mods");
  const existingSnapshot = await getDocs(modsCollectionRef);

  const existingByName = new Map<
    string,
    { id: string; ref: any; data: any }
  >();

  existingSnapshot.docs.forEach((docSnap) => {
    const data = docSnap.data();
    const name = typeof data.name === "string" ? data.name : "";
    if (name) {
      existingByName.set(name, {
        id: docSnap.id,
        ref: docSnap.ref,
        data,
      });
    }
  });

  const batch = writeBatch(db);

  for (const mod of incomingMods) {
    const duplicate = existingByName.get(mod.name);

    if (duplicate && duplicate.id !== mod.id) {
      batch.delete(duplicate.ref);
    }

    const modRef = doc(db, "servers", serverId, "mods", mod.id);

    batch.set(
      modRef,
      {
        driveFileId: mod.id,
        name: mod.name,
        size: mod.size ?? null,
        createdTime: mod.createdTime ?? null,
        enabled: mod.enabled ?? true,
        source: mod.source ?? "manual",
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  }

  await batch.commit();
}

async function handleUploadMods() {
  try {
    setModsUploading(true);
    setModsError("");
    setModsNotice("");

    const { loader, accessToken } = await getServerDriveContext();

    const filePaths = await window.electronAPI.selectModFiles();
    if (!filePaths || filePaths.length === 0) {
      return;
    }

    const result = await window.electronAPI.uploadModsToDrive({
      accessToken,
      serverId,
      loader,
      filePaths,
    });

    if (!result.success) {
      throw new Error(result.error || "Failed to upload mods");
    }

    const uploadedMods = (result.uploaded ?? []).map((mod: any) => ({
      id: mod.id,
      name: mod.name,
      size: mod.size,
      createdTime: mod.createdTime,
      enabled: true,
      source: "manual" as const,
    }));

    if (uploadedMods.length > 0) {
      await upsertModsInFirestore(uploadedMods);
    }

    setModsNotice(
      `Uploaded ${uploadedMods.length} mod${uploadedMods.length === 1 ? "" : "s"}.`
    );
  } catch (err: any) {
    setModsError(err.message || String(err));
  } finally {
    setModsUploading(false);
  }
}

async function handleDeleteMod(fileId: string) {
  try {
    setModsError("");
    setModsNotice("");

    const { accessToken } = await getServerDriveContext();

    const result = await window.electronAPI.deleteDriveFile({
      accessToken,
      fileId,
    });

    if (!result.success) {
      throw new Error(result.error || "Failed to delete mod");
    }

    await deleteDoc(doc(db, "servers", serverId, "mods", fileId));
    setModsNotice("Mod deleted.");
  } catch (err: any) {
    setModsError(err.message || String(err));
  }
}


async function handleDownloadMods() {
  try {
    setModsDownloading(true);
    setModsError("");
    setModsNotice("");

    const { loader, accessToken } = await getServerDriveContext();

    const localDestination = await window.electronAPI.selectFolder();
    if (!localDestination) {
      return;
    }

    const result = await window.electronAPI.downloadModsToFolder({
      accessToken,
      serverId,
      loader,
      localDestination,
    });

    if (!result.success) {
      throw new Error(result.error || "Failed to download mods");
    }

    setModsNotice(
      `Downloaded ${result.downloadedCount ?? 0} mod${
        result.downloadedCount === 1 ? "" : "s"
      } to ${localDestination}`
    );
  } catch (err: any) {
    setModsError(err.message || String(err));
  } finally {
    setModsDownloading(false);
  }
}

async function handleSyncModsFromDrive() {
  try {
    setModsSyncing(true);
    setModsError("");
    setModsNotice("");

    const { accessToken, loader } = await getServerDriveContext();

    const [enabledResult, disabledResult] = await Promise.all([
      window.electronAPI.listDriveFolderFiles({
        accessToken,
        serverId,
        loader,
        folderName: "mods",
      }),
      window.electronAPI.listDriveFolderFiles({
        accessToken,
        serverId,
        loader,
        folderName: "mods-disabled",
      }),
    ]);

    if (!enabledResult.success) {
      throw new Error(enabledResult.error || 'Failed to list "mods" from Drive.');
    }

    if (!disabledResult.success) {
      throw new Error(disabledResult.error || 'Failed to list "mods-disabled" from Drive.');
    }

    const enabledMods = (enabledResult.files ?? []).map((mod: any) => ({
      id: mod.id,
      name: mod.name,
      size: mod.size,
      createdTime: mod.createdTime,
      enabled: true,
      source: "manual" as const,
    }));

    const disabledMods = (disabledResult.files ?? []).map((mod: any) => ({
      id: mod.id,
      name: mod.name,
      size: mod.size,
      createdTime: mod.createdTime,
      enabled: false,
      source: "manual" as const,
    }));

    const allDriveMods = [...enabledMods, ...disabledMods];

    if (allDriveMods.length > 0) {
      await upsertModsInFirestore(allDriveMods);
    }

    setModsNotice(
      allDriveMods.length === 0
        ? "No mods found in Drive."
        : `Synced ${allDriveMods.length} mod${allDriveMods.length === 1 ? "" : "s"} from Drive.`
    );
  } catch (err: any) {
    setModsError(err.message || String(err));
  } finally {
    setModsSyncing(false);
  }
}

async function handleToggleModEnabled(mod: ServerMod) {
  try {
    setModsTogglingId(mod.id);
    setModsError("");
    setModsNotice("");

    const { accessToken, loader } = await getServerDriveContext();

    const fromFolderName = mod.enabled ? "mods" : "mods-disabled";
    const toFolderName = mod.enabled ? "mods-disabled" : "mods";

    const result = await window.electronAPI.moveDriveFileBetweenServerFolders({
      accessToken,
      serverId,
      loader,
      fileId: mod.driveFileId,
      fromFolderName,
      toFolderName,
    });

    if (!result.success) {
      throw new Error(result.error || "Failed to move mod between Drive folders.");
    }

    await updateDoc(doc(db, "servers", serverId, "mods", mod.id), {
      enabled: !mod.enabled,
      updatedAt: serverTimestamp(),
    });

    setModsNotice(`${mod.enabled ? "Disabled" : "Enabled"} ${mod.name}`);
  } catch (err: any) {
    setModsError(err.message || String(err));
  } finally {
    setModsTogglingId(null);
  }
}

function formatFileSize(size?: string) {
  const bytes = Number(size);
  if (!size || Number.isNaN(bytes)) return "";

  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}


function formatSourceLabel(source?: "manual" | "modrinth") {
  if (source === "modrinth") return "Modrinth";
  return "Manual";
}

function formatRelativeTimestamp(value?: any) {
  if (!value) return "";

  try {
    const date =
      typeof value?.toDate === "function"
        ? value.toDate()
        : new Date(value);

    if (Number.isNaN(date.getTime())) return "";

    return date.toLocaleString();
  } catch {
    return "";
  }
}

function titleCaseWords(value: string) {
  return value
    .split(/[\s-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function parseModDisplayInfo(fileName: string) {
  const withoutJar = fileName.replace(/\.jar$/i, "");
  const normalized = withoutJar.replace(/\(\d+\)$/, "").trim();

  const loaderMatches = Array.from(
    new Set(
      (normalized.match(/\b(fabric|forge|neoforge|quilt)\b/gi) || []).map((x) =>
        x.toLowerCase()
      )
    )
  );

  const mcVersionMatch =
    normalized.match(/\bmc([0-9]+\.[0-9]+(?:\.[0-9]+)?)\b/i) ||
    normalized.match(/\b([0-9]+\.[0-9]+(?:\.[0-9]+)?)\b/);

  const versionMatch =
    normalized.match(/\b(v?\d+\.\d+(?:\.\d+)?(?:[-+._]?[a-z0-9]+)*)\b/i);

  let workingName = normalized;

  workingName = workingName.replace(/\bmc[0-9]+\.[0-9]+(?:\.[0-9]+)?\b/gi, "");
  workingName = workingName.replace(/\b(?:fabric|forge|neoforge|quilt)\b/gi, "");
  if (versionMatch) {
    workingName = workingName.replace(versionMatch[0], "");
  }

  workingName = workingName
    .replace(/[_+]+/g, " ")
    .replace(/-{2,}/g, "-")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s.-]+|[\s.-]+$/g, "");

  const displayName = workingName
    ? titleCaseWords(workingName)
    : titleCaseWords(normalized);

  return {
    displayName,
    version: versionMatch ? versionMatch[1].replace(/^v/i, "") : "",
    mcVersion: mcVersionMatch ? mcVersionMatch[1] : "",
    loader: loaderMatches.length
      ? loaderMatches.map((x) => x.charAt(0).toUpperCase() + x.slice(1)).join(" / ")
      : "",
  };
}

function formatUploadedShort(value?: string) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleDateString() + " " + new Date(value).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

  async function fetchServerUsers() {
    try {
      const serverDoc = await getDoc(doc(db, "servers", serverId));
      if (!serverDoc.exists()) {
        setError("Server not found");
        return;
      }

      const serverData = serverDoc.data();
	if (!serverData || !serverData.users || !serverData.users[user.uid]) {
	  setError("You are not a member of this server.");
	  setJoining(false);
	  return;
	}
      
      setServerName(serverData.name);
      setServerOwnerId(serverData.createdBy);
   setServerLoader(serverData.loader || "vanilla");

      const userEntries = Object.entries(serverData.users || {}) as [string, { role: string; lastJoined?: any }][];
      const usersList: ServerUser[] = [];

      for (const [uid, userInfo] of userEntries) {
        const userDoc = await getDoc(doc(db, "readableUsers", uid)); 
        const mcUsername = userDoc.exists() ? userDoc.data()?.mcUsername || "Unknown" : "Unknown";

	const role = userInfo.role as Role;
        if (uid === user.uid) {
          setUserRole(role);
        }

        usersList.push({
          id: uid,
          mcUsername,
          role,
          lastJoined: userInfo.lastJoined,
        });
      }

      setUsers(usersList);
    } catch (err) {
      setError("Failed to load server users");
    }
  }

  async function checkInvite() {
    const readableUserDoc = await getDoc(doc(db, "readableUsers", user.uid));
    const invites = readableUserDoc.data()?.invites || [];
    setInvited(invites.includes(serverId));
  }

  useEffect(() => {
    fetchServerUsers();
    checkInvite();
  }, [serverId, user.uid]);

useEffect(() => {
  if (!modsNotice) return;

  const timeout = window.setTimeout(() => {
    setModsNotice("");
  }, 2500);

  return () => window.clearTimeout(timeout);
}, [modsNotice]);

  async function handleJoin() {
    if (!user) {
      alert("You must be logged in to join.");
      return;
    }

    setJoining(true);

    try {
      const serverDoc = await getDoc(doc(db, "servers", serverId));
      const serverData = serverDoc.data();
	if (!serverData) {
	  setError("Server data not found.");
	  setJoining(false);
	  return;
	}
	

      if (!serverData.users || !serverData.users[user.uid]) {
        setError("You are not a member of this server.");
        setJoining(false);
        return;
      }

      await updateDoc(doc(db, "servers", serverId), {
        [`users.${user.uid}.lastJoined`]: serverTimestamp(),
      });

      await fetchServerUsers();
    } catch (error) {
      setError("Failed to join server");
    }

    setJoining(false);
  }

  async function handleAcceptInvite() {
    setInviteActionLoading(true);
    try {
      const userRef = doc(db, "users", user.uid);
      const serverRef = doc(db, "servers", serverId);
      const readableRef = doc(db, "readableUsers", user.uid);

      await updateDoc(serverRef, {
        [`users.${user.uid}`]: {
          role: "member",
          lastJoined: serverTimestamp(),
        },
      });

      await updateDoc(userRef, {
        servers: arrayUnion(serverId),
      });

      await updateDoc(readableRef, {
        invites: arrayRemove(serverId),
      });

      await fetchServerUsers();
      setInvited(false);
    } catch (err) {
      setError("Failed to accept invite");
    }
    setInviteActionLoading(false);
  }


async function fetchServerHostStatus() {
  try {
    const [runtimeInfo, serverDoc] = await Promise.all([
      window.electronAPI.getRunningServerInfo({ serverId }),
      getDoc(doc(db, "servers", serverId)),
    ]);

    const serverData = serverDoc.exists() ? serverDoc.data() : null;
    const liveInfo = serverData?.liveInfo ?? null;

    if (runtimeInfo.success && runtimeInfo.running && runtimeInfo.data) {
      setServerHosted(true);
      setExtractPath(runtimeInfo.data.extractPath);
      setRam(runtimeInfo.data.ram);
      setRuntimeState(runtimeInfo.data.state || "running");
      setRuntimePort(runtimeInfo.data.port ?? null);
      setUpnpStatus(runtimeInfo.data.upnpStatus || "idle");
      setUpnpError(runtimeInfo.data.upnpError || "");
      return;
    }

    if (liveInfo) {
      setServerHosted(true);
      setRuntimeState("running");
      setRuntimePort(typeof liveInfo.port === "number" ? liveInfo.port : null);
      setUpnpStatus("idle");
      setUpnpError("");
      return;
    }

    setServerHosted(false);
    setRuntimeState("stopped");
    setRuntimePort(null);
    setUpnpStatus("idle");
    setUpnpError("");
    setReachability("idle");
  } catch (err) {
    console.error("Failed to fetch host status", err);
  }
}

useEffect(() => {
  let cancelled = false;

  const run = async () => {
    if (cancelled) return;
    await fetchServerHostStatus();
  };

  void run();

  const id = window.setInterval(() => {
    void run();
  }, 3000);

  return () => {
    cancelled = true;
    window.clearInterval(id);
  };
}, [serverId]);

useEffect(() => {
  setModsLoading(true);
  setModsError("");

  const modsRef = collection(db, "servers", serverId, "mods");
  const modsQuery = query(modsRef, orderBy("name", "asc"));

  const unsubscribe = onSnapshot(
    modsQuery,
    (snapshot) => {
      const nextMods: ServerMod[] = snapshot.docs.map((docSnap) => {
        const data = docSnap.data();

	return {
	  id: docSnap.id,
	  driveFileId: data.driveFileId || docSnap.id,
	  name: data.name || "Unnamed mod",
	  size: data.size || undefined,
	  createdTime: data.createdTime || undefined,
	  enabled: data.enabled ?? true,
	  source: data.source,
	  updatedAt: data.updatedAt,
	};
      });

      setMods(nextMods);
      setModsLoading(false);
    },
    (err) => {
      console.error("Failed to subscribe to mods:", err);
      setModsError(err.message || String(err));
      setMods([]);
      setModsLoading(false);
    }
  );

  return () => unsubscribe();
}, [serverId]);

useEffect(() => {
  if (!serverId) return;

  const unsubscribe = window.electronAPI.onServerState((data) => {
    if (data.serverId !== serverId) return;

    const hosted =
      data.state === "starting" ||
      data.state === "running" ||
      data.state === "stopping";

    setServerHosted(hosted);
    setRuntimeState(data.state);
    setUpnpStatus(data.upnpStatus || "idle");
    setUpnpError(data.upnpError || "");

    if (typeof data.port === "number") {
      setRuntimePort(data.port);
    } else if (data.port === null) {
      setRuntimePort(null);
    }

    if (!hosted) {
      setRuntimePort(null);
      setUpnpStatus("idle");
      setUpnpError("");
      setReachability("idle");
    }
  });

  return () => {
    unsubscribe();
  };
}, [serverId]);


useEffect(() => {
  if (!serverHosted) {
    setPublicIp("");
    return;
  }

  let cancelled = false;

  (async () => {
    try {
      const ip = await window.electronAPI.getPublicIp();
      if (!cancelled) {
        setPublicIp(ip);
      }
    } catch (err) {
      console.error("Failed to fetch public IP:", err);
    }
  })();

  return () => {
    cancelled = true;
  };
}, [serverHosted]);

useEffect(() => {
  if (runtimeState !== "running") {
    setReachability("idle");
    return;
  }

  if (!runtimePort || !publicIp) {
    setReachability("idle");
    return;
  }

  let cancelled = false;

  setReachability("checking");

  window.electronAPI
    .checkPortReachability({ ip: publicIp, port: runtimePort })
    .then((res) => {
      if (cancelled) return;

      if (!res.success) {
        setReachability("blocked");
        return;
      }

      setReachability(res.reachable ? "reachable" : "blocked");
    })
    .catch((err) => {
      console.error("Failed to check port reachability:", err);
      if (!cancelled) {
        setReachability("blocked");
      }
    });

  return () => {
    cancelled = true;
  };
}, [runtimeState, runtimePort, publicIp]);

  async function handleDeclineInvite() {
    setInviteActionLoading(true);
    try {
      const readableRef = doc(db, "readableUsers", user.uid);
      await updateDoc(readableRef, {
        invites: arrayRemove(serverId),
      });
      setInvited(false);
    } catch (err) {
      setError("Failed to decline invite");
    }
    setInviteActionLoading(false);
  }

  async function promoteToAdmin(userId: string) {
    await updateDoc(doc(db, "servers", serverId), {
      [`users.${userId}.role`]: "admin",
    });
    setOpenMenuId(null);
    await fetchServerUsers();
  }

  async function demoteToMember(userId: string) {
    await updateDoc(doc(db, "servers", serverId), {
      [`users.${userId}.role`]: "member",
    });
    setOpenMenuId(null);
    await fetchServerUsers();
  }


const handleExtractPathReady = async (path: string, ramValue: string, mcVersionValue: string) => {
  setExtractPath(path);
  setRam(ramValue);
  setMcVersion(mcVersionValue);
  setServerHosted(true);

  try {
    const result = await window.electronAPI.openServerConsole({
      serverId,
      role: isAdmin ? "admin" : "viewer",
      extractPath: path,
      ram: ramValue,
      mcVersion: mcVersionValue,
      isAdmin,
    });

    if (!result.success) {
      alert(result.error || "Failed to open detached console window.");
    }
  } catch (err) {
    console.error("Failed to open detached console after host", err);
    alert("Failed to open detached console after host.");
  }
};

  async function kickUser(userId: string) {
    // Use Firestore's deleteField for nested field deletion
    await updateDoc(doc(db, "servers", serverId), {
      [`users.${userId}`]: deleteField(),
    });
    await updateDoc(doc(db, "users", userId), {
      servers: arrayRemove(serverId),
    });
    setOpenMenuId(null);
    await fetchServerUsers();
  }

  function canManageUsers() {
    return user.uid === serverOwnerId || userRole === "admin";
  }

  function onUserInvited() {
    fetchServerUsers();
  }

  if (error) return <p className="text-red-600">{error}</p>;
  if (!serverName) return <p>Loading...</p>;
  const isModServer = ["fabric", "forge", "neoforge"].includes(serverLoader);
const joinAddress =
  publicIp && runtimePort ? `${publicIp}:${runtimePort}` : "";


async function handleCopyJoinAddress() {
  if (!joinAddress) return;

  try {
    await navigator.clipboard.writeText(joinAddress);
    alert(`Copied join address: ${joinAddress}`);
  } catch (err) {
    console.error("Failed to copy join address", err);
    alert("Failed to copy join address.");
  }
}

  return (
    <div>
      <h2 className="text-xl font-bold mb-4">Server: {serverName}</h2>

      {invited && (
        <div className="mb-4 p-3 border border-yellow-400 bg-yellow-100 rounded">
          <p className="mb-2">You have been invited to this server.</p>
          <div className="flex gap-2">
            <button
              onClick={handleAcceptInvite}
              disabled={inviteActionLoading}
              className="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded"
            >
              {inviteActionLoading ? "Accepting..." : "Accept"}
            </button>
            <button
              onClick={handleDeclineInvite}
              disabled={inviteActionLoading}
              className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded"
            >
              {inviteActionLoading ? "Declining..." : "Decline"}
            </button>
          </div>
        </div>
      )}
	
<div className="mb-3 flex items-start justify-between gap-4 flex-wrap">
  <div className="flex items-center gap-3 flex-wrap">
    <button
      onClick={handleJoinServer}
      disabled={joining}
      className="px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
    >
      {joining ? "Joining..." : "Join Server"}
    </button>

    <button
      onClick={() => {
        if (userRole === "owner" || userRole === "admin") {
          setShowHostModal(true);
        } else {
          setShowRoleWarning(true);
          setTimeout(() => setShowRoleWarning(false), 4000);
        }
      }}
      className="px-3 py-2 bg-green-600 text-white rounded hover:bg-green-700"
    >
      Host Server
    </button>

    <button
      disabled={!serverHosted}
      onClick={() => {
        if (!serverHosted) return;
        handleOpenDetachedConsole();
      }}
      className={`px-3 py-2 rounded text-white ${
        serverHosted
          ? "bg-purple-600 hover:bg-purple-700"
          : "bg-gray-400 cursor-not-allowed"
      }`}
    >
      Server Console
    </button>

    <button
      onClick={async () => {
        const result = await window.electronAPI.openServerMetrics();
        if (!result.success) {
          alert(result.error || "Failed to open metrics window.");
        }
      }}
      style={{
        padding: "8px 14px",
        borderRadius: "10px",
        border: "1px solid #444",
        background: "#1c1c1c",
        color: "white",
        cursor: "pointer",
      }}
    >
      Metrics
    </button>
  </div>

  <div className="flex items-center gap-3 shrink-0">
    {user.uid === serverOwnerId && (
      <button
        onClick={handleOpenOwnerWindow}
        className="px-3 py-2 bg-slate-900 text-white border border-slate-700 rounded hover:bg-slate-800"
      >
        Owner
      </button>
    )}

    {isModServer && (
      <div ref={modsDropdownRef} className="relative shrink-0">
        <button
          onClick={handleToggleModsDropdown}
          className={`px-4 py-2 text-white rounded ${
            showModsDropdown
              ? "bg-slate-800"
              : "bg-slate-700 hover:bg-slate-800"
          }`}
        >
          Mods
        </button>

        {showModsDropdown && (
          <div
            className="absolute right-0 top-0 mr-[calc(100%+12px)] w-[min(520px,calc(100vw-32px))] max-w-[calc(100vw-32px)] rounded-xl border border-gray-300 bg-white shadow-2xl z-30 overflow-hidden"
            style={{ maxHeight: "min(72vh, 620px)" }}
          >
            <div className="px-4 py-3 border-b bg-gray-50">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold text-lg">Mods</div>
                  <div className="text-sm text-gray-500">
                    {modsLoading
                      ? "Loading..."
                      : `${mods.length} mod${mods.length === 1 ? "" : "s"} • ${enabledModsCount} active`}
                  </div>
                </div>

                <div className="text-right text-xs text-gray-400">
                  Source of truth:
                  <div className="font-medium text-gray-600">Firestore</div>
                </div>
              </div>
            </div>

            {modsNotice && (
              <div className="px-4 py-2 text-sm text-green-700 border-b bg-green-50 break-words">
                {modsNotice}
              </div>
            )}

            <div className="max-h-[min(46vh,320px)] overflow-y-auto bg-white">
              {modsLoading ? (
                <div className="px-4 py-4 text-sm text-gray-500">
                  Loading mods...
                </div>
              ) : mods.length === 0 ? (
                <div className="px-4 py-4 text-sm text-gray-500">
                  No mods indexed yet.
                  {isAdmin && (
                    <div className="mt-2">
                      If this server already has mods in Drive, use{" "}
                      <span className="font-medium">Sync from Drive</span>.
                    </div>
                  )}
                </div>
              ) : (
                <ul className="divide-y divide-gray-200">
                  {mods.map((mod) => (
                    <li
                      key={mod.id}
                      className="px-4 py-2.5 flex items-start justify-between gap-3"
                    >
                      {(() => {
                        const parsed = parseModDisplayInfo(mod.name);

                        return (
                          <>
                            <div className="min-w-0 flex-1">
                              <div className="font-semibold text-gray-900 leading-tight break-words">
                                {parsed.displayName}
                              </div>

                              <div className="mt-1 text-xs text-gray-600 flex flex-wrap gap-x-3 gap-y-1">
                                {parsed.version && <span>v{parsed.version}</span>}
                                {parsed.loader && <span>{parsed.loader}</span>}
                                {mod.size && <span>{formatFileSize(mod.size)}</span>}
                                {mod.createdTime && (
                                  <span>Uploaded {formatUploadedShort(mod.createdTime)}</span>
                                )}
                              </div>
                            </div>

                            {isAdmin && (
                              <div className="shrink-0 flex flex-col gap-2">
                                <button
                                  onClick={() => handleToggleModEnabled(mod)}
                                  disabled={modsTogglingId === mod.id}
                                  className={`min-w-[92px] px-3 py-1.5 text-sm text-white rounded disabled:opacity-50 ${
                                    mod.enabled
                                      ? "bg-amber-600 hover:bg-amber-700"
                                      : "bg-emerald-600 hover:bg-emerald-700"
                                  }`}
                                >
                                  {modsTogglingId === mod.id
                                    ? "Working..."
                                    : mod.enabled
                                    ? "Disable"
                                    : "Enable"}
                                </button>

                                <button
                                  onClick={() => handleDeleteMod(mod.id)}
                                  className="min-w-[92px] px-3 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700"
                                >
                                  Delete
                                </button>
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="px-4 py-3 border-t bg-gray-50 flex flex-wrap items-center justify-between gap-2 sticky bottom-0">
              <div className="text-xs text-gray-500">
                Live synced across devices
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {isAdmin && (
                  <>
                    <button
                      onClick={handleSyncModsFromDrive}
                      disabled={modsSyncing || modsUploading || modsTogglingId !== null}
                      className="px-3 py-2 bg-slate-600 text-white rounded hover:bg-slate-700 disabled:opacity-50"
                    >
                      {modsSyncing ? "Syncing..." : "Sync from Drive"}
                    </button>

                    <button
                      onClick={handleUploadMods}
                      disabled={modsUploading || modsSyncing || modsTogglingId !== null}
                      className="px-3 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {modsUploading ? "Uploading..." : "Upload Mods"}
                    </button>
                  </>
                )}

                <button
                  onClick={handleDownloadMods}
                  disabled={modsDownloading || modsTogglingId !== null}
                  className="px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                >
                  {modsDownloading ? "Downloading..." : "Download Mods"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    )}
  </div>
</div>


<div className="mb-4 rounded-xl border border-gray-300 bg-white px-4 py-3 shadow-sm">
  <div className="flex flex-wrap items-center gap-2 text-sm">
    <span className="font-semibold text-gray-900 mr-1">Networking</span>

    <span className="rounded-full bg-gray-100 px-3 py-1 text-gray-800">
      State: <span className="font-medium capitalize">{runtimeState}</span>
    </span>

    <span className="rounded-full bg-gray-100 px-3 py-1 text-gray-800">
      Port: <span className="font-medium">{runtimePort ?? "—"}</span>
    </span>

    <span className="rounded-full bg-gray-100 px-3 py-1 text-gray-800">
      IP: <span className="font-medium">{publicIp || "—"}</span>
    </span>

<span className="rounded-full bg-gray-100 px-3 py-1 text-gray-800">
  UPnP: <span className="font-medium capitalize">{upnpStatus}</span>
</span>

<span className="rounded-full bg-gray-100 px-3 py-1 text-gray-800">
  Reachability:{" "}
  <span className="font-medium capitalize">
    {reachability === "checking" ? "checking..." : reachability}
  </span>
</span>

    <span className="rounded-full bg-gray-100 px-3 py-1 text-gray-800 break-all">
      Join: <span className="font-medium">{joinAddress || "—"}</span>
    </span>

    <button
      onClick={handleCopyJoinAddress}
      disabled={!joinAddress}
      className={`ml-auto px-3 py-1.5 rounded text-white text-sm ${
        joinAddress
          ? "bg-slate-700 hover:bg-slate-800"
          : "bg-gray-400 cursor-not-allowed"
      }`}
    >
      Copy
    </button>
  </div>
{upnpStatus === "failed" && upnpError && (
  <div className="mt-2 text-xs text-red-600">
    UPnP error: {upnpError}
  </div>
)}
</div>

      {showRoleWarning && (
        <div className="mb-4 px-4 py-2 bg-yellow-100 border border-yellow-400 text-yellow-800 rounded text-sm animate-fade-out delay-[3000ms]">
          Only the <strong>server owner</strong> or <strong>admins</strong> can host the server.
          Ask for admin rights if you need to host.
        </div>
      )}

      {showHostModal && (
        <HostServer
          serverId={serverId}
          user={user}
          onClose={() => setShowHostModal(false)}
          onExtractPathReady={handleExtractPathReady}
        />
      )}



      <InviteUser serverId={serverId} onUserInvited={onUserInvited} />

      <div ref={menuRef}>
        <h3 className="font-semibold mb-3">Users</h3>
        <ul className="divide-y divide-gray-300 border border-gray-300 rounded-md">
        {users.map((u) => (
          <li
            key={u.id}
            className="flex justify-between items-center px-4 py-3 hover:bg-gray-50 relative"
          >
            <div>
              <span className="font-medium text-gray-900">{u.mcUsername}</span>{" "}
              <span className="text-sm text-gray-600">— Role: {u.role}</span>{" "}
              {u.id === serverOwnerId && (
                <span className="ml-2 px-2 py-0.5 text-xs font-semibold text-white bg-green-600 rounded">
                  Owner
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <div className="text-xs italic text-gray-500 min-w-[180px] text-left">
                {u.lastJoined
                  ? "Last joined: " + u.lastJoined.toDate().toLocaleString()
                  : "Never joined"}
              </div>

		

              {canManageUsers() && u.id !== serverOwnerId && (
                <div className="relative">
                  <button
                    onClick={() => setOpenMenuId(openMenuId === u.id ? null : u.id)}
                    className="hover:bg-gray-200 p-1 rounded-full"
                  >
                    <MoreVertical size={18} />
                  </button>

                  {openMenuId === u.id && (
                    <div className="absolute right-0 mt-1 w-44 bg-white border border-gray-300 rounded shadow-md z-10">
                      {u.role === "member" && (
                        <button
                          onClick={() => promoteToAdmin(u.id)}
                          className="block w-full text-left px-4 py-2 hover:bg-gray-100 text-sm"
                        >
                          Promote to Admin
                        </button>
                      )}
                      {u.role === "admin" && (
                        <button
                          onClick={() => demoteToMember(u.id)}
                          className="block w-full text-left px-4 py-2 hover:bg-gray-100 text-sm"
                        >
                          Demote to Member
                        </button>
                      )}
                      <button
                        onClick={() => kickUser(u.id)}
                        className="block w-full text-left px-4 py-2 hover:bg-gray-100 text-sm text-red-600"
                      >
                        Kick User
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
     </div>
    </div>
  );
}


