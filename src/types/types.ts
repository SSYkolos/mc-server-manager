// src/types/types.ts
import type { Timestamp } from "firebase/firestore";
import type { User } from "firebase/auth";

export interface ProfileProps {
  user: User;
}

export type ServerDetailsProps = {
  serverId: string;
  user: User;
};



export interface HostServerProps {
  serverId: string;
  user: any;
  onClose: () => void;
  onExtractPathReady: (path: string, ram: string, mcVersion: string) => void;
}

export interface ServerPropertiesEditorProps {
  serverPropertiesPath: string;
  onClose: () => void;
}

export type LoaderType =
  | "vanilla"
  | "paper"
  | "purpur"
  | "fabric"
  | "forge"
  | "neoforge";

export type Role = "owner" | "admin" | "member";

export interface Props {
  user: any
  onSelect?: (serverId: string) => void
  onCreated?: () => void
}

export interface Server {
  id: string
  name: string
  createdBy: string
  createdByName: string
  createdAt: Timestamp 
  lastJoined?: Timestamp
  lastHostedAt?: Timestamp
  role?: Role
}

export interface ServerUser {
  id: string
  mcUsername: string
  role: 'owner' | 'admin' | 'member'
  lastJoined?: Timestamp;
}

export interface Invite {
  id: string
  name: string;
  createdByName: string
}

export interface DriveInfo {
  id: string
  displayName: string
}

export interface ReadableUser {
  uid: string
  mcUsername: string
}

export interface CreateServerFormProps {
  onCreated?: () => void;
}


export interface CreateServerSettingsProps {
  value: {
    serverName: string;
    motd: string;
    levelName: string;
    gamemode: string;
    difficulty: string;
    pvp: boolean;
    hardcore: boolean;
    loader: LoaderType;
    loaderVersion: string;
    mcVersion: string;
    seed: string;
    levelType: string;
    generateStructures: boolean;
    allowNether: boolean;
    viewDistance: number;
    maxWorldSize: number;
    spawnProtection: number;
    enableCommandBlock: boolean;
    allowFlight: boolean;
    syncChunkWrites: boolean;
    maxPlayers: number;
    onlineMode: boolean;
    whiteList: boolean;
    enforceWhitelist: boolean;
    enableRcon: boolean;
    rconPassword: string;
    resourcePack: string;
    enableStatus: boolean;
    enableArchiveOnShutdown: boolean;
    isModpack?: boolean;
    modpackId?: string;
    modpackProvider?: string;
  };
  update: (field: keyof CreateServerSettingsProps["value"], value: any) => void;
}