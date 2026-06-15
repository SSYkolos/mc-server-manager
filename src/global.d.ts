declare global {
  interface Window {
    electronAPI: {
      linkDrive: (args: { uid: string; serverId?: string }) => Promise<{ success: boolean; error?: string }>;
      hostServer: (args: {
        serverId: string;
        driveZipId: string;
        installPath: string;
        ram: string;
        version: string;
      }) => Promise<void>;

      selectModFiles: () => Promise<string[]>;

      onRestoreProgress: (
        callback: (data: {
          phase:
          | "starting"
          | "manifest"
          | "large-files"
          | "small-packs"
          | "cleanup"
          | "finalizing"
          | "done"
          | "error";
          message: string;
          current: number;
          total: number;
          percent: number;
        }) => void
      ) => () => void;

      getForgeLoaderVersions: (mcVersion: string) => Promise<{
        success: boolean;
        versions: string[];
        error?: string;
      }>;


      installModpack: (args: {
        serverId: string;
        modpackId: string;
        provider: string;
        accessToken: string;
        loader: string;
      }) => Promise<{ success: boolean; error?: string }>;

      provisionModpack: (args: {
        serverId: string;
        modpackId: string;
        provider: string;
        accessToken: string;
        driveFolderId: string;
      }) => Promise<{ success: boolean; error?: string }>;

      searchMods: (args: {
        provider: "modrinth" | "curseforge";
        query: string;
        loader?: string;
        mcVersion?: string;
        isModpack?: boolean;
      }) => Promise<{
        success: boolean;
        results: Array<{
          id: string;
          provider: "modrinth" | "curseforge";
          projectId: string;
          slug?: string;
          title: string;
          description: string;
          iconUrl?: string;
          downloads?: number;
          loaders: string[];
          gameVersions: string[];
          clientSide?: "required" | "optional" | "unsupported" | "unknown";
          serverSide?: "required" | "optional" | "unsupported" | "unknown";
          sideSupport?: "server" | "client" | "both" | "optional" | "unknown";
        }>;
        error?: string;
      }>;

      previewModInstall: (args: {
        provider: "modrinth" | "curseforge";
        projectId: string;
        loader: string;
        mcVersion: string;
        installedProjectIds?: string[];
      }) => Promise<{
        success: boolean;
        project?: {
          provider: "modrinth";
          projectId: string;
          title: string;
          versionId: string;
          versionNumber?: string;
          fileName: string;
          clientSide?: "required" | "optional" | "unsupported" | "unknown";
          serverSide?: "required" | "optional" | "unsupported" | "unknown";
          sideSupport?: "server" | "client" | "both" | "optional" | "unknown";
        };
        dependencies?: Array<{
          projectId: string;
          dependencyType: "required" | "optional" | "incompatible" | "embedded" | "unknown";
          title: string;
          clientSide?: "required" | "optional" | "unsupported" | "unknown";
          serverSide?: "required" | "optional" | "unsupported" | "unknown";
          sideSupport?: "server" | "client" | "both" | "optional" | "unknown";
          alreadyInstalled: boolean;
        }>;
        warnings?: Array<{
          code:
          | "client-only"
          | "unknown-side"
          | "duplicate-project"
          | "missing-required-dependencies";
          message: string;
        }>;
        error?: string;
      }>;

      installDiscoveredMod: (args: {
        provider: "modrinth" | "curseforge";
        projectId: string;
        serverId: string;
        loader: string;
        mcVersion: string;
        accessToken: string;
        installedProjectIds?: string[];
        installDependencyProjectIds?: string[];
        replaceExistingProjectIds?: string[];
      }) => Promise<{
        success: boolean;
        project?: {
          provider: "modrinth" | "curseforge";
          projectId: string;
          title: string;
          versionId?: string;
          versionNumber?: string;
          clientSide?: "required" | "optional" | "unsupported" | "unknown";
          serverSide?: "required" | "optional" | "unsupported" | "unknown";
          sideSupport?: "server" | "client" | "both" | "optional" | "unknown";
        };
        file?: {
          id: string;
          name: string;
          size?: string | null;
          createdTime?: string | null;
        };
        installed?: Array<{
          provider: "modrinth" | "curseforge";
          projectId: string;
          title: string;
          versionId?: string;
          versionNumber?: string;
          clientSide?: "required" | "optional" | "unsupported" | "unknown";
          serverSide?: "required" | "optional" | "unsupported" | "unknown";
          sideSupport?: "server" | "client" | "both" | "optional" | "unknown";
          isDependency?: boolean;
          file: {
            id: string;
            name: string;
            size?: string | null;
            createdTime?: string | null;
          };
        }>;
        error?: string;
      }>;


      getOnlinePlayers: (args: {
        serverId: string;
      }) => Promise<{
        success: boolean;
        players: string[];
      }>;

      getModpackMetadata: (args: { modpackId: string; provider: string }) => Promise<{
        success: boolean;
        mcVersion?: string;
        loader?: string;
        loaderVersion?: string; 
        error?: string;
      }>;

      timeoutPlayers: (args: {
        serverId: string;
        players: string[];
        minutes: number;
        reason?: string;
      }) => Promise<{
        success: boolean;
        error?: string;
      }>;

      onOnlinePlayersChanged: (
        callback: (data: {
          serverId: string;
          players: string[];
          count: number;
        }) => void
      ) => () => void;


      readImportableServerProperties: (args: {
        sourceServerPath: string;
      }) => Promise<{
        success: boolean;
        found?: boolean;
        data?: {
          motd: string;
          levelName: string;
          gamemode: string;
          difficulty: string;
          pvp: boolean;
          hardcore: boolean;
          allowFlight: boolean;
          maxPlayers: number;
          onlineMode: boolean;
          whiteList: boolean;
          enforceWhitelist: boolean;
          enableCommandBlock: boolean;
          allowNether: boolean;
          enableStatus: boolean;
          enableRcon: boolean;
          rconPassword: string;
          resourcePack: string;
          viewDistance: number;
          maxWorldSize: number;
          spawnProtection: number;
          syncChunkWrites: boolean;
        } | null;
        error?: string;
      }>;

      openServerLiveAdmin(args: { serverId: string; accessToken: string }): Promise<{ success: boolean }>;

      importExistingServer: (args: {
        accessToken: string;
        serverId: string;
        loader: string;
        mcVersion: string;
        loaderVersion?: string;
        sourceServerPath: string;
        extractPath: string;
        serverSettingsOverride?: Record<string, any>;
        retention?: number;
        port?: number;
      }) => Promise<{
        success: boolean;
        error?: string;
        serverId?: string;
        extractPath?: string;
        importedServerName?: string;
        loader?: string;
        mcVersion?: string;
      }>;

      uploadModsToDrive: (args: {
        accessToken: string;
        serverId: string;
        loader: string;
        filePaths: string[];
      }) => Promise<{
        success: boolean;
        uploaded?: { id: string; name: string }[];
        error?: string;
      }>;

      selectWorldFolder: () => Promise<string | null>;
      importExistingWorld: (args: {
        accessToken: string;
        serverId: string;
        loader: string;
        mcVersion: string;
        loaderVersion?: string;
        sourceWorldPath: string;
        extractPath: string;
        retention?: number;
        port?: number;
      }) => Promise<{
        success: boolean;
        error?: string;
        serverId?: string;
        extractPath?: string;
        importedWorldName?: string;
        loader?: string;
        mcVersion?: string;
      }>;

      listDriveFolderFiles: (args: {
        accessToken: string;
        serverId: string;
        loader: string;
        folderName: "mods" | "mods-disabled" | "config" | "plugins";
      }) => Promise<{
        success: boolean;
        files?: {
          id: string;
          name: string;
          size?: string | null;
          createdTime?: string | null;
        }[];
        error?: string;
      }>;

      getServerOwnerSettings: (args: { serverId: string }) => Promise<{
        success: boolean;
        settings?: {
          backupRetentionCount: number;
        };
        error?: string;
      }>;

      setServerBackupRetention: (args: {
        serverId: string;
        backupRetentionCount: number;
      }) => Promise<{
        success: boolean;
        backupRetentionCount?: number;
        error?: string;
      }>;

      getDriveStorageInfo: (args: { accessToken: string }) => Promise<{
        success: boolean;
        storage?: {
          limit: number;
          usage: number;
          usageInDrive: number;
          free: number;
        };
        error?: string;
      }>;

      listServerInvites: (args: { serverId: string }) => Promise<{
        success: boolean;
        invites?: Array<{
          id: string;
          code: string;
          email: string;
          role: string;
          status: string;
          createdAt: any;
          createdBy: string | null;
        }>;
        error?: string;
      }>;

      deleteServerInvite: (args: { inviteId: string }) => Promise<{
        success: boolean;
        error?: string;
      }>;

      restoreSnapshot: (args: {
        snapshotId: string;
        serverPath: string;
        serverId: string;
        loader: string;
        accessToken: string;
      }) => Promise<{ success: boolean; error?: string }>;

      moveDriveFileBetweenServerFolders: (args: {
        accessToken: string;
        serverId: string;
        loader: string;
        fileId: string;
        fromFolderName: "mods" | "mods-disabled";
        toFolderName: "mods" | "mods-disabled";
      }) => Promise<{
        success: boolean;
        error?: string;
      }>;

      deleteDriveFile: (args: {
        accessToken: string;
        fileId: string;
      }) => Promise<{
        success: boolean;
        error?: string;
      }>;

      downloadModsToFolder: (args: {
        accessToken: string;
        serverId: string;
        loader: string;
        localDestination: string;
      }) => Promise<{
        success: boolean;
        downloadedCount?: number;
        error?: string;
      }>;

      openServerConsole: (params: {
        serverId: string;
        role?: string;
        extractPath?: string;
        ram?: string | null;
        mcVersion?: string | null;
        isAdmin?: boolean;
        accessToken?: string | null;
      }) => Promise<{ success: boolean; error?: string }>;

      openServerMetrics: () => Promise<{ success: boolean; error?: string }>;

      openServerOwner: (args: {
        serverId: string;
        accessToken: string;
      }) => Promise<{
        success: boolean;
        error?: string;
      }>;

      getRunningServerMetrics: () => Promise<{
        success: boolean;
        servers: Array<{
          serverId: string;
          pid: number | null;
          cpu: number;
          memoryMb: number;
          ram: string;
          port: number;
          startedAt: number;
          uptimeSec: number;
          status: string;
        }>;
        history: Record<
          string,
          Array<{
            t: number;
            cpu: number;
            memoryMb: number;
          }>
        >;
        historyWindowMinutes: 3 | 6 | 9;
        maxSamples: number;
        sampleIntervalMs: number;
        error?: string;
      }>;

      setMetricsHistoryWindow: (
        minutes: 3 | 6 | 9
      ) => Promise<{
        success: boolean;
        historyWindowMinutes?: 3 | 6 | 9;
        maxSamples?: number;
        sampleIntervalMs?: number;
        error?: string;
      }>;


      loadServerPreset: (serverId: string, zipId: string) => Promise<{
        version: string;
        ram: string;
        defaultPath: string;
      }>;

      softDeleteServer: (
        serverPath: string,
        serverId: string
      ) => Promise<{ success: boolean }>;

      downloadFromDrive: (args: { fileId: string; destPath: string; accessToken: string }) =>
        Promise<{ success: boolean; error?: string }>;

      downloadBackupFromDrive: (
        fileId: string,
        destPath: string,
        accessToken: string
      ) => Promise<any>;

      shellOpenExternal: (url: string) => void;
      startGoogleOAuth: () => Promise<{ code: string }>;

      extractZip: (zipPath: string, extractTo: string) => Promise<boolean>;
      selectFolder: () => Promise<string | null>;
      createEula: (folderPath: string) => Promise<boolean>;
      downloadMinecraftJar: (version: string, destFolder: string) => Promise<{ success: boolean; error?: string }>;

      backupServer: (args: {
        serverPath: string;
        serverId: string;
        loader: string;
        accessToken: string;
        retention?: number;
      }) => Promise<{ success: boolean; backups?: { name: string; id: string }[]; error?: string }>;

      getServerDriveUsage: (args: {
        accessToken: string;
        serverId: string;
        loader: string;
      }) => Promise<{
        success: boolean;
        usage?: number;
        error?: string;
      }>;

      prepareServerRuntime: (args: {
        loader: string;
        mcVersion: string;
        loaderVersion?: string;
        extractPath: string;
      }) => Promise<{
        success: boolean;
        launchMode?: "jar" | "forge-args";
        launcherJar?: string | null;
        detectedLaunchJar?: string;
        userJvmArgsPath?: string | null;
        winArgsPath?: string | null;
        unixArgsPath?: string | null;
        error?: string;
      }>;

      downloadDriveFolder: (args: {
        accessToken: string;
        serverRootFolderId: string;
        folderName: "mods" | "config" | "plugins";
        localDestination: string;
      }) => Promise<{
        success: boolean;
        error?: string;
      }>;

      getValidAccessToken: (args: {
        userId: string;
        driveId: string;
      }) => Promise<string>;

      ensureDriveFolderPath: (args: {
        accessToken: string;
        serverId: string;
        loader: string;
      }) => Promise<string>;

      createServerZip: (args: {
        accessToken: string;
        driveFolderId: string;
        serverId: string;
        settings: Record<string, string>;
        loader: string;
        mcVersion: string;
      }) => Promise<{
        success: boolean;
        zipFileId?: string;
        error?: string;
      }>;



      onBackupProgress: (
        callback: (data: {
          uploaded: number;
          total: number;
          percent: number;
        }) => void
      ) => () => void;


      listServerBackups: (args: {
        serverId: string;
        loader: string;
        accessToken: string;
      }) => Promise<{ name: string; id: string }[]>;


      readServerProperties: (
        folderPath: string
      ) => Promise<{ success: boolean; data?: Record<string, string>; error?: string }>;

      writeServerProperties: (
        folderPath: string,
        updates: Record<string, string>
      ) => Promise<{ success: boolean; error?: string }>;

      startServerProcess: (params: {
        serverId: string;
        pathToServerJar?: string | null;
        launchMode?: "jar" | "forge-args";
        forgeUserJvmArgsPath?: string | null;
        forgeWinArgsPath?: string | null;
        forgeUnixArgsPath?: string | null;
        serverFolder?: string | null;
        ram: string;
        preferredPort?: number;
      }) => Promise<{ success: boolean; error?: string; port?: number }>;


      startRestoreVerification: (args: {
        snapshotId: string;
        serverPath: string;
        serverId: string;
        loader: string;
        accessToken: string;
      }) => Promise<{
        success: boolean;
        alreadyRunning?: boolean;
        error?: string;
      }>;

      getRestoreVerificationStatus: (args: { serverId: string }) => Promise<{
        success: boolean;
        status?: {
          serverId: string;
          state: "idle" | "queued" | "running" | "passed" | "failed";
          snapshotId: string | null;
          message: string;
          current: number;
          total: number;
          percent: number;
          checkedFiles?: number;
          verifiedFiles?: number;
          missingFiles?: string[];
          failedFiles?: Array<{
            path: string;
            reason: "size-mismatch" | "hash-mismatch";
            expectedSize?: number;
            actualSize?: number;
            expectedHash?: string;
            actualHash?: string;
          }>;
          startedAt?: number | null;
          finishedAt?: number | null;
        };
      }>;

      onRestoreVerificationProgress: (
        callback: (data: {
          serverId: string;
          state: "idle" | "queued" | "running" | "passed" | "failed";
          snapshotId: string | null;
          message: string;
          current: number;
          total: number;
          percent: number;
          checkedFiles?: number;
          verifiedFiles?: number;
          missingFiles?: string[];
          failedFiles?: Array<{
            path: string;
            reason: "size-mismatch" | "hash-mismatch";
            expectedSize?: number;
            actualSize?: number;
            expectedHash?: string;
            actualHash?: string;
          }>;
          startedAt?: number | null;
          finishedAt?: number | null;
        }) => void
      ) => () => void;
      getServerLogs: (params: {
        serverId: string;
        limit?: number;
      }) => Promise<{
        success: boolean;
        logs: string[];
        error?: string;
      }>;

      detectPreparedServerRuntime: (args: {
        loader: string;
        extractPath: string;
      }) => Promise<{
        success: boolean;
        ready: boolean;
        launchMode?: "jar" | "forge-args";
        launcherJar?: string | null;
        userJvmArgsPath?: string | null;
        winArgsPath?: string | null;
        unixArgsPath?: string | null;
        error?: string;
      }>;

      checkServerRuntime: (args: {
        loader: string;
        extractPath: string;
      }) => Promise<{
        success: boolean;
        ready: boolean;
        launchMode?: "jar" | "forge-args";
        launcherJar?: string | null;
        userJvmArgsPath?: string | null;
        winArgsPath?: string | null;
        unixArgsPath?: string | null;
        error?: string;
      }>;

      getRunningServerInfo: (params: {
        serverId: string;
      }) => Promise<{
        success: boolean;
        running: boolean;
        data?: {
          serverId: string;
          extractPath: string;
          pathToServerJar?: string | null;
          launchMode?: "jar" | "forge-args";
          forgeUserJvmArgsPath?: string | null;
          forgeWinArgsPath?: string | null;
          forgeUnixArgsPath?: string | null;
          ram: string;
          port: number;
          startedAt: number;
          pid: number | null;
          state: string;
          upnpStatus?: "idle" | "opening" | "mapped" | "failed" | "closing";
          upnpError?: string | null;
        };
        error?: string;
      }>;

      stopServerProcess: (params: {
        serverId: string;
      }) => Promise<{ success: boolean; error?: string }>;

      getPublicIp: () => Promise<string>;

      checkPortReachability: (args: {
        ip: string;
        port: number;
      }) => Promise<{
        success: boolean;
        reachable: boolean;
        latency?: number | null;
      }>;

      // ✅ Now returns unsubscribe function
      onServerLog: (callback: (data: { serverId: string; log: string }) => void) => () => void;

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
      ) => () => void;

      onServerClosed: (
        callback: (data: {
          serverId: string;
          code: number;
          expected: boolean;
          state: "stopped" | "crashed";
        }) => void
      ) => () => void;

      send: (channel: string, data: any) => void;
      receive: (channel: string, func: (...args: any[]) => void) => void;
      sendServerCommand: (params: {
        serverId: string;
        command: string;
      }) => Promise<{ success: boolean; error?: string }>;
    };
  }
}

export { };