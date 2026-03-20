import { contextBridge, ipcRenderer, shell } from 'electron';



const validSendChannels = [
  'open-file-dialog',
  'launch-server',
  'save-server-config',
  'select-folder',
  'log-message',
];

const validReceiveChannels = [
  'selected-folder',
  'server-started',
  'server-error',
];

contextBridge.exposeInMainWorld('electronAPI', {
  // Removed fetchFirestore since Firestore is now handled by Firebase JS SDK in React
  // Removed send-user-token and host-server if those relied on admin SDK



selectModFiles: () => ipcRenderer.invoke("select-mod-files"),

uploadModsToDrive: (args: {
  accessToken: string;
  serverId: string;
  loader: string;
  filePaths: string[];
}) => ipcRenderer.invoke("upload-mods-to-drive", args),

getServerOwnerSettings: (args: { serverId: string }) =>
  ipcRenderer.invoke("get-server-owner-settings", args),

setServerBackupRetention: (args: {
  serverId: string;
  backupRetentionCount: number;
}) =>
  ipcRenderer.invoke("set-server-backup-retention", args),

getDriveStorageInfo: (args: { accessToken: string }) =>
  ipcRenderer.invoke("get-drive-storage-info", args),

listServerInvites: (args: { serverId: string }) =>
  ipcRenderer.invoke("list-server-invites", args),

deleteServerInvite: (args: { inviteId: string }) =>
  ipcRenderer.invoke("delete-server-invite", args),


listDriveFolderFiles: (args: {
  accessToken: string;
  serverId: string;
  loader: string;
  folderName: "mods" | "mods-disabled" | "config" | "plugins";
}) => ipcRenderer.invoke("list-drive-folder-files", args),

moveDriveFileBetweenServerFolders: (args: {
  accessToken: string;
  serverId: string;
  loader: string;
  fileId: string;
  fromFolderName: "mods" | "mods-disabled";
  toFolderName: "mods" | "mods-disabled";
}) => ipcRenderer.invoke("move-drive-file-between-server-folders", args),

deleteDriveFile: (args: {
  accessToken: string;
  fileId: string;
}) => ipcRenderer.invoke("delete-drive-file", args),

downloadModsToFolder: (args: {
  accessToken: string;
  serverId: string;
  loader: string;
  localDestination: string;
}) => ipcRenderer.invoke("download-mods-to-folder", args),

restoreSnapshot: (args: {
  snapshotId: string;
  serverPath: string;
  serverId: string;
  loader: string;
  accessToken: string;
}) => ipcRenderer.invoke("restore-snapshot", args),

  linkDrive: (args: { uid: string; serverId?: string }) =>
    ipcRenderer.invoke("link-drive", args),
  shellOpenExternal: (url: string) => shell.openExternal(url),
  selectFolder: () => ipcRenderer.invoke("select-folder"),
  downloadFromDrive: (args: { fileId: string; destPath: string; accessToken: string }) =>
  	ipcRenderer.invoke("downloadFromDrive", args),
  extractZip: (zipPath: string, extractTo: string): Promise<boolean> => ipcRenderer.invoke("extractZip", zipPath, extractTo),
  hostServer: (params: any) => ipcRenderer.invoke("host-server", params),
  loadServerPreset: (serverId: string, zipId: string) => ipcRenderer.invoke("load-server-preset", serverId, zipId),
  createEula: (folderPath: string) => ipcRenderer.invoke("createEula", folderPath),
  downloadMinecraftJar: (version: string, destFolder: string) => ipcRenderer.invoke("downloadMinecraftJar", version, destFolder),
  prepareServerRuntime: (args: {
    loader: string;
    mcVersion: string;
    loaderVersion?: string;
    extractPath: string;
  }) => ipcRenderer.invoke("prepare-server-runtime", args),
  downloadDriveFolder: (args: {
    accessToken: string;
    serverRootFolderId: string;
    folderName: "mods" | "config" | "plugins";
    localDestination: string;
  }) => ipcRenderer.invoke("download-drive-folder", args),
  getServerLogs: (params: { serverId: string; limit?: number }) =>
    ipcRenderer.invoke("getServerLogs", params),

  openServerConsole: (params: {
    serverId: string;
    role?: string;
    extractPath?: string;
    ram?: string | null;
    mcVersion?: string | null;
    isAdmin?: boolean;
  }) => ipcRenderer.invoke("open-server-console", params),

getServerDriveUsage: (args: { accessToken: string; serverId: string; loader: string }) =>
  ipcRenderer.invoke("get-server-drive-usage", args),

  openServerMetrics: () =>
    ipcRenderer.invoke("open-server-metrics"),

openServerOwner: (args: { serverId: string; accessToken: string }) =>
  ipcRenderer.invoke("open-server-owner", args),

  getRunningServerMetrics: () =>
    ipcRenderer.invoke("get-running-server-metrics"),

  setMetricsHistoryWindow: (minutes: 3 | 6 | 9) =>
    ipcRenderer.invoke("set-metrics-history-window", minutes),

startServerProcess: (params: {
  serverId: string;
  pathToServerJar: string;
  ram: string;
  preferredPort?: number;
}) => ipcRenderer.invoke("startServerProcess", params),
  stopServerProcess: (params: { serverId: string }) =>
    ipcRenderer.invoke("stopServerProcess", params),
  sendServerCommand: (params: { serverId: string; command: string }) =>
    ipcRenderer.invoke("sendServerCommand", params),
  getRunningServerInfo: (params: { serverId: string }) =>
    ipcRenderer.invoke("getRunningServerInfo", params),
  readServerProperties: (folderPath: string) => ipcRenderer.invoke("readServerProperties", folderPath),
  writeServerProperties: (folderPath: string, updates: Record<string, string>) => ipcRenderer.invoke("writeServerProperties", folderPath, updates),
  getPublicIp: () => ipcRenderer.invoke("get-public-ip"),

checkPortReachability: (args: { ip: string; port: number }) =>
  ipcRenderer.invoke("check-port-reachability", args),

backupServer: (args: {
  serverPath: string;
  serverId: string;
  loader: string;
  accessToken: string;
  retention?: number;
}) => ipcRenderer.invoke("backup-server", args),

  softDeleteServer: (serverPath: string, serverId: string) =>
    ipcRenderer.invoke("soft-delete-server", serverPath, serverId),

listServerBackups: ({ serverId, loader, accessToken }: { serverId: string; loader: string; accessToken: string }) =>
  ipcRenderer.invoke("list-server-backups", { serverId, loader, accessToken }),

downloadBackupFromDrive: (
  fileId: string,
  destPath: string,
  accessToken: string
) =>
  ipcRenderer.invoke("downloadBackupFromDrive", {
    fileId,
    destPath,
    accessToken,
  }),




createServerZip: (args: {
  accessToken: string;
  driveFolderId: string;
  serverId: string;
  settings: Record<string, string>;
  loader: string;
  mcVersion: string;
}) => ipcRenderer.invoke("create-server-zip", args),

startGoogleOAuth: () =>
  ipcRenderer.invoke("start-google-oauth"),

ensureDriveFolderPath: (args: {
  accessToken: string;
  serverId: string;
  loader: string;
}) => ipcRenderer.invoke("ensure-drive-folder-path", args),

getValidAccessToken: (args: {
  userId: string;
  driveId: string;
}) => ipcRenderer.invoke("get-valid-access-token", args),


onBackupProgress: (callback: (data: any) => void) => {
    const listener = (_: any, data: any) => callback(data);
    ipcRenderer.on("backup-progress", listener);

    // unsubscribe
    return () => {
      ipcRenderer.removeListener("backup-progress", listener);
    };
  },


  send: (channel: string, data?: any) => {
    if (validSendChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    } else {
      console.warn(`Channel "${channel}" is not allowed to send.`);
    }
  },

  receive: (channel: string, func: (...args: any[]) => void) => {
    if (validReceiveChannels.includes(channel)) {
      ipcRenderer.on(channel, (_event, ...args) => func(...args));
    } else {
      console.warn(`Channel "${channel}" is not allowed to receive.`);
    }
  },
  
  onServerLog: (callback: (data: { serverId: string; log: string }) => void) => {
    const listener = (_event: any, data: { serverId: string; log: string }) => callback(data);
    ipcRenderer.on("server-log", listener);
    return () => ipcRenderer.removeListener("server-log", listener);
  },



onServerState: (
  callback: (data: {
    serverId: string;
    state: "starting" | "running" | "stopping" | "stopped" | "crashed";
    port?: number | null;
    pid?: number | null;
    startedAt?: number | null;
    upnpStatus?: "idle" | "opening" | "mapped" | "failed" | "closing";
    upnpError?: string | null;
  }) => void
) => {
  const listener = (
    _event: any,
    data: {
      serverId: string;
      state: "starting" | "running" | "stopping" | "stopped" | "crashed";
      port?: number | null;
      pid?: number | null;
      startedAt?: number | null;
      upnpStatus?: "idle" | "opening" | "mapped" | "failed" | "closing";
      upnpError?: string | null;
    }
  ) => callback(data);

  ipcRenderer.on("server-state", listener);
  return () => ipcRenderer.removeListener("server-state", listener);
},

onServerClosed: (
  callback: (data: {
    serverId: string;
    code: number;
    expected: boolean;
    state: "stopped" | "crashed";
  }) => void
) => {
  const listener = (
    _event: any,
    data: {
      serverId: string;
      code: number;
      expected: boolean;
      state: "stopped" | "crashed";
    }
  ) => callback(data);

  ipcRenderer.on("server-closed", listener);
  return () => ipcRenderer.removeListener("server-closed", listener);
},

  once: (channel: string, func: (...args: any[]) => void) => {
    if (validReceiveChannels.includes(channel)) {
      ipcRenderer.once(channel, (_event, ...args) => func(...args));
    } else {
      console.warn(`Channel "${channel}" is not allowed to receive once.`);
    }
  },
});

