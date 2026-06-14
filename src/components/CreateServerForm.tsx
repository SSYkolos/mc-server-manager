import { CreateServerSettingsProps } from "../types/types";
import { useMemo, useState, useEffect } from "react";
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

type CreateMode = "create" | "import-world" | "import-server";

function joinLocalPath(basePath: string, child: string) {
  if (!basePath) return child;

  if (basePath.includes("\\")) {
    return `${basePath.replace(/[\\/]+$/, "")}\\${child}`;
  }

  return `${basePath.replace(/[\\/]+$/, "")}/${child}`;
}

export default function CreateServerForm({ onCreated }: { onCreated?: () => void }) {
  const [mode, setMode] = useState<CreateMode>("create");
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
    isModpack: false,
    modpackId: "",
  });

  const [selectedDriveId, setSelectedDriveId] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [selectedWorldPath, setSelectedWorldPath] = useState("");
  const [selectedServerPath, setSelectedServerPath] = useState("");
  const [selectedImportParentPath, setSelectedImportParentPath] = useState("");
  const [user] = useAuthState(auth);
  const [forgeVersions, setForgeVersions] = useState<string[]>([]);
  const [loadingForgeVersions, setLoadingForgeVersions] = useState(false);

  const updateSetting = (
    key: keyof CreateServerSettingsProps["value"],
    value: any
  ) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: value };

      if (key === "loader") {
        if (value !== "forge") {
          next.loaderVersion = "";
        }
      }

      if (key === "mcVersion" && prev.loader === "forge") {
        next.loaderVersion = "";
      }

      return next;
    });
  };

  const importSupported = useMemo(
    () => settings.loader === "vanilla" || settings.loader === "fabric",
    [settings.loader]
  );

  const resetImportState = () => {
    setSelectedWorldPath("");
    setSelectedServerPath("");
    setSelectedImportParentPath("");
  };

  const handlePickWorldFolder = async () => {
    setError("");

    try {
      const worldPath = await window.electronAPI.selectWorldFolder();
      if (worldPath) {
        setSelectedWorldPath(worldPath);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to select world folder.");
    }
  };

  const handlePickServerFolder = async () => {
    setError("");

    try {
      const serverPath = await window.electronAPI.selectFolder();
      if (!serverPath) return;

      setSelectedServerPath(serverPath);

      const res = await window.electronAPI.readImportableServerProperties({
        sourceServerPath: serverPath,
      });

      if (!res?.success) {
        throw new Error(res?.error || "Failed to read server.properties from the selected server.");
      }

      if (res.found && res.data) {
        const importedData = res.data;

        setSettings((prev) => ({
          ...prev,
          motd: importedData.motd ?? prev.motd,
          levelName: importedData.levelName ?? prev.levelName,
          gamemode: importedData.gamemode ?? prev.gamemode,
          difficulty: importedData.difficulty ?? prev.difficulty,
          pvp: typeof importedData.pvp === "boolean" ? importedData.pvp : prev.pvp,
          hardcore: typeof importedData.hardcore === "boolean" ? importedData.hardcore : prev.hardcore,
          allowFlight:
            typeof importedData.allowFlight === "boolean"
              ? importedData.allowFlight
              : prev.allowFlight,
          maxPlayers:
            typeof importedData.maxPlayers === "number"
              ? importedData.maxPlayers
              : prev.maxPlayers,
          onlineMode:
            typeof importedData.onlineMode === "boolean"
              ? importedData.onlineMode
              : prev.onlineMode,
          whiteList:
            typeof importedData.whiteList === "boolean"
              ? importedData.whiteList
              : prev.whiteList,
          enforceWhitelist:
            typeof importedData.enforceWhitelist === "boolean"
              ? importedData.enforceWhitelist
              : prev.enforceWhitelist,
          enableCommandBlock:
            typeof importedData.enableCommandBlock === "boolean"
              ? importedData.enableCommandBlock
              : prev.enableCommandBlock,
          allowNether:
            typeof importedData.allowNether === "boolean"
              ? importedData.allowNether
              : prev.allowNether,
          enableStatus:
            typeof importedData.enableStatus === "boolean"
              ? importedData.enableStatus
              : prev.enableStatus,
          enableRcon:
            typeof importedData.enableRcon === "boolean"
              ? importedData.enableRcon
              : prev.enableRcon,
          rconPassword: importedData.rconPassword ?? prev.rconPassword,
          resourcePack: importedData.resourcePack ?? prev.resourcePack,
          viewDistance:
            typeof importedData.viewDistance === "number"
              ? importedData.viewDistance
              : prev.viewDistance,
          maxWorldSize:
            typeof importedData.maxWorldSize === "number"
              ? importedData.maxWorldSize
              : prev.maxWorldSize,
          spawnProtection:
            typeof importedData.spawnProtection === "number"
              ? importedData.spawnProtection
              : prev.spawnProtection,
          syncChunkWrites:
            typeof importedData.syncChunkWrites === "boolean"
              ? importedData.syncChunkWrites
              : prev.syncChunkWrites,
        }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to select server folder.");
    }
  };

  useEffect(() => {
    let cancelled = false;

    async function loadForgeVersions() {
      if (settings.loader !== "forge") {
        setForgeVersions([]);
        setLoadingForgeVersions(false);
        return;
      }

      const mcVersion = settings.mcVersion.trim();

      if (!mcVersion) {
        setForgeVersions([]);
        setLoadingForgeVersions(false);
        setSettings((prev) => ({ ...prev, loaderVersion: "" }));
        return;
      }

      try {
        setLoadingForgeVersions(true);

        const res = await window.electronAPI.getForgeLoaderVersions(mcVersion);

        if (cancelled) return;

        if (!res?.success) {
          setForgeVersions([]);
          setSettings((prev) => ({ ...prev, loaderVersion: "" }));
          setError(res?.error || `Failed to load Forge versions for ${mcVersion}`);
          return;
        }

        const versions = Array.isArray(res.versions) ? res.versions : [];
        setForgeVersions(versions);

        setSettings((prev) => {
          if (prev.loader !== "forge") return prev;

          const current = prev.loaderVersion ?? "";
          if (versions.includes(current)) return prev;

          return {
            ...prev,
            loaderVersion: versions[0] ?? "",
          };
        });
      } catch (err) {
        if (cancelled) return;
        setForgeVersions([]);
        setSettings((prev) => ({ ...prev, loaderVersion: "" }));
        setError(err instanceof Error ? err.message : "Failed to load Forge versions");
      } finally {
        if (!cancelled) {
          setLoadingForgeVersions(false);
        }
      }
    }

    loadForgeVersions();

    return () => {
      cancelled = true;
    };
  }, [settings.loader, settings.mcVersion]);

  const handlePickImportParentFolder = async () => {
    setError("");

    try {
      const parentPath = await window.electronAPI.selectFolder();
      if (parentPath) {
        setSelectedImportParentPath(parentPath);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to select destination folder.");
    }
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

    if (!settings.mcVersion?.trim()) {
      setError("Please choose a Minecraft version.");
      return;
    }

    if (settings.loader === "forge") {
      const forgeVersion = settings.loaderVersion?.trim();

      if (!forgeVersion) {
        setError("Please choose a Forge version.");
        return;
      }

      if (!forgeVersions.includes(forgeVersion)) {
        setError("Selected Forge version does not belong to the selected Minecraft version.");
        return;
      }
    }

    if (mode === "import-world" || mode === "import-server") {
      if (!importSupported) {
        setError("Import currently supports only Vanilla and Fabric.");
        return;
      }

      if (settings.loader === "fabric" && !settings.loaderVersion?.trim()) {
        setError("Fabric loader version is required for Fabric import.");
        return;
      }

      if (mode === "import-world" && !selectedWorldPath) {
        setError("Please choose an existing world folder to import.");
        return;
      }

      if (mode === "import-server" && !selectedServerPath) {
        setError("Please choose an existing server folder to import.");
        return;
      }

      if (!selectedImportParentPath) {
        setError("Please choose a local destination folder for the managed server.");
        return;
      }
    }

    try {
      setIsCreating(true);

      const accessToken = await window.electronAPI.getValidAccessToken({
        userId: user.uid,
        driveId: selectedDriveId,
      });

      if (!accessToken) {
        throw new Error("Missing Google Drive access token");
      }

      const newServerRef = doc(collection(db, "servers"));

      const driveFolderId = await window.electronAPI.ensureDriveFolderPath({
        accessToken,
        serverId: newServerRef.id,
        loader: settings.loader,
      });

      if (!driveFolderId) {
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

      if (mode === "create") {
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
          zipFileId: zipRes.zipFileId,
        });
      } else if (mode === "import-world") {
        const extractPath = joinLocalPath(selectedImportParentPath, newServerRef.id);

        const importRes = await window.electronAPI.importExistingWorld({
          accessToken,
          serverId: newServerRef.id,
          loader: settings.loader,
          mcVersion: settings.mcVersion?.trim() || "1.20.4",
          loaderVersion: settings.loaderVersion?.trim() || "",
          sourceWorldPath: selectedWorldPath,
          extractPath,
          retention: 10,
          port: 25565,
        });

        if (!importRes?.success) {
          throw new Error(importRes?.error || "Failed to import existing world");
        }

        await updateDoc(newServerRef, {
          importType: "world",
          localPath: extractPath,
          importedWorldName: importRes.importedWorldName || null,
        });
      } else {
        const extractPath = joinLocalPath(selectedImportParentPath, newServerRef.id);

        const importRes = await window.electronAPI.importExistingServer({
          accessToken,
          serverId: newServerRef.id,
          loader: settings.loader,
          mcVersion: settings.mcVersion?.trim() || "1.20.4",
          loaderVersion: settings.loaderVersion?.trim() || "",
          sourceServerPath: selectedServerPath,
          extractPath,
          serverSettingsOverride: {
            motd: settings.motd,
            levelName: settings.levelName,
            gamemode: settings.gamemode,
            difficulty: settings.difficulty,
            pvp: settings.pvp,
            hardcore: settings.hardcore,
            allowFlight: settings.allowFlight,
            maxPlayers: settings.maxPlayers,
            onlineMode: settings.onlineMode,
            whiteList: settings.whiteList,
            enforceWhitelist: settings.enforceWhitelist,
            enableCommandBlock: settings.enableCommandBlock,
            allowNether: settings.allowNether,
            enableStatus: settings.enableStatus,
            enableRcon: settings.enableRcon,
            rconPassword: settings.rconPassword,
            resourcePack: settings.resourcePack,
            viewDistance: settings.viewDistance,
            maxWorldSize: settings.maxWorldSize,
            spawnProtection: settings.spawnProtection,
            syncChunkWrites: settings.syncChunkWrites,
          },
          retention: 10,
          port: 25565,
        });

        if (!importRes?.success) {
          throw new Error(importRes?.error || "Failed to import existing server");
        }

        await updateDoc(newServerRef, {
          importType: "server",
          localPath: extractPath,
          importedServerName: importRes.importedServerName || null,
        });
      }

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

      setSuccess(
        mode === "create"
          ? "Server created successfully!"
          : mode === "import-world"
          ? "World imported successfully!"
          : "Server imported successfully!"
      );

      setSettings((prev) => ({
        ...prev,
        serverName: "",
      }));
      setSelectedDriveId("");
      resetImportState();
      onCreated?.();
    } catch (err) {
      console.error(
        mode === "create"
          ? "Failed to create server"
          : mode === "import-world"
          ? "Failed to import world"
          : "Failed to import server",
        err
      );

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

  const forgeReady =
    settings.loader !== "forge" ||
    (!!settings.mcVersion?.trim() &&
      !!settings.loaderVersion?.trim() &&
      forgeVersions.includes(settings.loaderVersion.trim()));

  const canCreate =
    settings.serverName.trim().length >= 3 &&
    !!selectedDriveId &&
    !isCreating &&
    !!settings.mcVersion?.trim() &&
    forgeReady &&
    (
      mode === "create" ||
      (
        mode === "import-world" &&
        !!selectedWorldPath &&
        !!selectedImportParentPath &&
        importSupported &&
        (settings.loader !== "fabric" || !!settings.loaderVersion?.trim())
      ) ||
      (
        mode === "import-server" &&
        !!selectedServerPath &&
        !!selectedImportParentPath &&
        importSupported &&
        (settings.loader !== "fabric" || !!settings.loaderVersion?.trim())
      )
    );

  return (
    <form
      onSubmit={handleCreate}
      className="space-y-6 max-w-4xl w-full bg-gray-100 p-6 rounded shadow-md"
    >
      {error && <div className="text-red-600">{error}</div>}
      {success && <div className="text-green-600">{success}</div>}

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => setMode("create")}
          className={`px-4 py-2 rounded border ${
            mode === "create"
              ? "bg-blue-500 text-white border-blue-500"
              : "bg-white text-gray-800 border-gray-300"
          }`}
          disabled={isCreating}
        >
          Fresh Server
        </button>

        <button
          type="button"
          onClick={() => setMode("import-world")}
          className={`px-4 py-2 rounded border ${
            mode === "import-world"
              ? "bg-blue-500 text-white border-blue-500"
              : "bg-white text-gray-800 border-gray-300"
          }`}
          disabled={isCreating}
        >
          Import Existing World
        </button>

        <button
          type="button"
          onClick={() => setMode("import-server")}
          className={`px-4 py-2 rounded border ${
            mode === "import-server"
              ? "bg-blue-500 text-white border-blue-500"
              : "bg-white text-gray-800 border-gray-300"
          }`}
          disabled={isCreating}
        >
          Import Full Server
        </button>
      </div>

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

      {mode === "import-world" && (
        <div className="space-y-4 rounded border border-gray-300 bg-white p-4">
          <div>
            <div className="font-semibold text-gray-900">Import existing world</div>
            <div className="text-sm text-gray-600 mt-1">
              This creates a managed server from a real world folder and pushes the first snapshot into the backup store.
            </div>
          </div>

          {!importSupported && (
            <div className="text-amber-700 text-sm">
              Import is currently available only for Vanilla and Fabric loaders.
            </div>
          )}

          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={handlePickWorldFolder}
              className="px-4 py-2 rounded border border-gray-300 bg-gray-50 text-left"
              disabled={isCreating}
            >
              {selectedWorldPath ? "Change world folder" : "Choose world folder"}
            </button>
            {selectedWorldPath && (
              <div className="text-sm text-gray-700 break-all">{selectedWorldPath}</div>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={handlePickImportParentFolder}
              className="px-4 py-2 rounded border border-gray-300 bg-gray-50 text-left"
              disabled={isCreating}
            >
              {selectedImportParentPath ? "Change local destination" : "Choose local destination folder"}
            </button>
            {selectedImportParentPath && (
              <div className="text-sm text-gray-700 break-all">
                Managed server folder will be created here: {joinLocalPath(selectedImportParentPath, "<serverId>")}
              </div>
            )}
          </div>
        </div>
      )}

      {mode === "import-server" && (
        <div className="space-y-4 rounded border border-gray-300 bg-white p-4">
          <div>
            <div className="font-semibold text-gray-900">Import full server</div>
            <div className="text-sm text-gray-600 mt-1">
              Smart import of world, configs, mods and plugins without carrying over junk like logs or old runtime files.
            </div>
          </div>

          {!importSupported && (
            <div className="text-amber-700 text-sm">
              Import is currently available only for Vanilla and Fabric loaders.
            </div>
          )}

          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={handlePickServerFolder}
              className="px-4 py-2 rounded border border-gray-300 bg-gray-50 text-left"
              disabled={isCreating}
            >
              {selectedServerPath ? "Change server folder" : "Choose server folder"}
            </button>

            {selectedServerPath && (
              <div className="text-sm text-gray-700 break-all">
                {selectedServerPath}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={handlePickImportParentFolder}
              className="px-4 py-2 rounded border border-gray-300 bg-gray-50 text-left"
              disabled={isCreating}
            >
              {selectedImportParentPath
                ? "Change local destination"
                : "Choose local destination folder"}
            </button>

            {selectedImportParentPath && (
              <div className="text-sm text-gray-700 break-all">
                Managed server folder will be created here: {joinLocalPath(selectedImportParentPath, "<serverId>")}
              </div>
            )}
          </div>
        </div>
      )}

      <CreateServerSettings
        value={settings}
        update={updateSetting}
        mode={mode}
        forgeVersions={forgeVersions}
        loadingForgeVersions={loadingForgeVersions}
      />

      <button
        type="submit"
        className={`px-4 py-2 rounded text-white ${
          canCreate ? "bg-blue-500" : "bg-gray-400 cursor-not-allowed"
        }`}
        disabled={!canCreate}
      >
        {isCreating
          ? mode === "create"
            ? "Creating..."
            : "Importing..."
          : mode === "create"
          ? "Create Server"
          : mode === "import-world"
          ? "Import World"
          : "Import Server"}
      </button>
    </form>
  );
}