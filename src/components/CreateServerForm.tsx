import { CreateServerSettingsProps } from "../types/types";
import { useState } from "react";
import {
  collection,
  serverTimestamp,
  updateDoc,
  arrayUnion,
  doc,
  getDoc,
  setDoc,
} from "firebase/firestore";
import { db, auth } from "../firebase.js";
import { useAuthState } from "react-firebase-hooks/auth";
import DriveSelector from "./DriveSelector";
import { CreateServerSettings } from "./CreateServerSettings";
import { getGoogleOAuthUrl } from "../getGoogleOAuthUrl";

export default function CreateServerForm({ onCreated }: { onCreated?: () => void }) {
  const [settings, setSettings] = useState<CreateServerSettingsProps["value"]>({
    serverName: "",
    motd: "",
    levelName: "",
    gamemode: "survival",
    difficulty: "easy",
    pvp: true,
    hardcore: false,
    loader: "vanilla",
    mcVersion: "",
    loaderVersion: "",
    seed: "",
    levelType: "default",
    generateStructures: true,
    allowNether: true,
    viewDistance: 10,
    maxWorldSize: 10000,
    spawnProtection: 16,
    enableCommandBlock: false,
    allowFlight: false,
    syncChunkWrites: true,
    maxPlayers: 20,
    onlineMode: true,
    whiteList: false,
    enforceWhitelist: false,
    enableRcon: false,
    rconPassword: "",
    resourcePack: "",
    enableStatus: true,
    enableArchiveOnShutdown: false,
  });

  const [selectedDriveId, setSelectedDriveId] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [user] = useAuthState(auth);

const updateSetting = (
  key: keyof CreateServerSettingsProps["value"],
  value: any
) => {
  setSettings(prev => ({ ...prev, [key]: value }));
};

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    if (isCreating) return;

    if (!user) {
      setError("You must be logged in to create a server.");
      return;
    }

    const trimmedName = settings.serverName.trim();
    if (!trimmedName || trimmedName.length < 3) {
      setError("Server name must be at least 3 characters long.");
      return;
    }

    if (!user.displayName) {
      setError("Your profile is missing a Minecraft username.");
      return;
    }

    if (!selectedDriveId) {
      setError("Please select a linked Google Drive.");
      return;
    }

    try {
      setIsCreating(true);

      const accessToken = await window.electronAPI.getValidAccessToken({
	  userId: user.uid,
	  driveId: selectedDriveId,
	});

      if (!accessToken) {
        console.error("❌ No access token found for Drive ID:", selectedDriveId);
        throw new Error("Missing Google Drive access token");
      }

      const newServerRef = doc(collection(db, "servers"));
      const driveFolderId = await window.electronAPI.ensureDriveFolderPath({
	  accessToken,
	  serverId: newServerRef.id,
	  loader: settings.loader,
	});


      if (!driveFolderId) {
        console.error("❌ ensureDriveFolderPath returned no folder ID");
        throw new Error("Failed to create folder in Google Drive");
      }

      await setDoc(newServerRef, {
        name: trimmedName,
        createdBy: user.uid,
        createdByUsername: user.displayName,
        createdAt: serverTimestamp(),
        lastHosted: serverTimestamp(),
        loader: settings.loader,
        mcVersion: settings.mcVersion?.trim() || "1.20.4",
        loaderVersion: settings.loaderVersion?.trim() || null,
        linkedDriveId: selectedDriveId,
        driveFolderId,
        users: {
          [user.uid]: {
            role: "owner",
            lastLogin: new Date().toISOString(),
          },
        },
      });

      // Convert all settings values to strings
      const stringSettings = Object.fromEntries(
        Object.entries(settings).map(([key, value]) => [key, String(value)])
      );

const zipRes = await window.electronAPI.createServerZip({
  accessToken,
  driveFolderId,
  serverId: newServerRef.id,
  settings: stringSettings,
  loader: settings.loader,
  mcVersion: settings.mcVersion?.trim() || "1.20.4",
});

if (!zipRes?.success || !zipRes.zipFileId) {
  throw new Error("Failed to create server zip");
}

await updateDoc(newServerRef, {
  zipFileId: zipRes.zipFileId, // ← CSAK STRING
});


      const inviteRef = doc(db, "servers", newServerRef.id, "invites", user.uid);
      await setDoc(inviteRef, {
        invitedAt: serverTimestamp(),
        status: "accepted",
        role: "owner",
      });

      const userRef = doc(db, "users", user.uid);
      const userSnap = await getDoc(userRef);

      if (!userSnap.exists()) {
        await setDoc(userRef, {
          email: user.email || "",
          mcUsername: user.displayName.toLowerCase(),
          servers: [],
        });
      }

      await updateDoc(userRef, {
        servers: arrayUnion(newServerRef.id),
      });

      setSuccess("Server created successfully!");
      setSettings(prev => ({ ...prev, serverName: "" }));
      setSelectedDriveId("");
      onCreated?.();

    } catch (err) {
      console.error("Failed to create server", err);

      if (err instanceof Error) {
        if (err.message === "REFRESH_TOKEN_EXPIRED") {
	  alert("Your Google Drive session expired. Please login again.");
	  window.location.href = getGoogleOAuthUrl(user!.uid);
	  return;
	}
        setError(err.message);
      } else {
        setError("Unexpected error");
      }
    } finally {
      setIsCreating(false);
    }
  };

  const canCreate =
    settings.serverName.trim().length >= 3 && !!selectedDriveId && !isCreating;

  return (
    <form
      onSubmit={handleCreate}
      className="space-y-6 max-w-4xl w-full bg-gray-100 p-6 rounded shadow-md"
    >
      {error && <div className="text-red-600">{error}</div>}
      {success && <div className="text-green-600">{success}</div>}

      <input
        type="text"
        placeholder="Server name"
        value={settings.serverName}
        onChange={(e) => updateSetting("serverName", e.target.value)}
        className="border rounded px-3 py-2 w-full"
        required
        disabled={isCreating}
      />

      <DriveSelector
        onSelect={(driveId) => setSelectedDriveId(driveId)}
        initialDriveId={selectedDriveId}
      />

      <CreateServerSettings
        value={settings}
        update={updateSetting}
      />

      <button
        type="submit"
        className={`px-4 py-2 rounded text-white ${
          canCreate ? "bg-blue-500" : "bg-gray-400 cursor-not-allowed"
        }`}
        disabled={!canCreate}
      >
        {isCreating ? "Creating..." : "Create Server"}
      </button>
    </form>
  );
}


