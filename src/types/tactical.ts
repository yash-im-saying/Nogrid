export enum TacticalTab {
  Comms = 'comms',
  PTT = 'ptt',
  Radar = 'radar',
  Light = 'light',
  Mesh = 'mesh',
}

export enum BurnTimerOption {
  TenSeconds = 10,
  ThirtySeconds = 30,
  FiveMinutes = 300,
  BurnOnRead = -1,
  Persistent = 0,
}

export enum PacketType {
  Text = 'text',
  PTT = 'ptt',
  Beacon = 'beacon',
}

export enum SyncState {
  Synced = 'synced',
  Queued = 'queued',
  LocalMesh = 'local_mesh',
}

export interface IdentityProfile {
  id: string;
  callsign: string;
  publicKeyJwk: JsonWebKey;
  privateKeyJwk: JsonWebKey;
  fingerprint: string;
  batterySaver: boolean;
  wakeLockEnabled: boolean;
}

export interface ChannelKeyState {
  channelId: string;
  label: string;
  keyHash: string;
  keyBase64: string;
  passphraseHint: string;
  updatedAt: number;
}

export interface GeoFix {
  lat: number;
  lon: number;
  mgrs: string;
  accuracy: number;
  heading: number | null;
  updatedAt: number;
}

export interface DecryptedPayload {
  kind: PacketType;
  body?: string;
  audioB64?: string;
  mimeType?: string;
  durationMs?: number;
  coords?: GeoFix;
  burnOnRead?: boolean;
  sentAt: number;
}

export interface EncryptedEnvelope {
  id: string;
  channelId: string;
  senderId: string;
  senderCallsign: string;
  type: PacketType;
  ciphertextB64: string;
  ivB64: string;
  createdAt: number;
  ttlSeconds: number | null;
  expiresAt: number | null;
}

export interface TacticalMessage {
  id: string;
  channelId: string;
  senderId: string;
  senderCallsign: string;
  type: PacketType;
  body?: string;
  audioB64?: string;
  mimeType?: string;
  durationMs?: number;
  coords?: GeoFix;
  createdAt: number;
  ttlSeconds: number | null;
  expiresAt: number | null;
  burnOnRead: boolean;
  readAt: number | null;
  syncState: SyncState;
  transportTag: 'mesh-ws' | 'local-tab' | 'optical-rx' | 'offline-outbox';
  decryptionError?: boolean;
}

export interface PeerNode {
  id: string;
  callsign: string;
  fingerprint: string;
  channelId: string;
  lastSeen: number;
  transport: 'ws' | 'local' | 'ble' | 'optical';
  coords?: GeoFix;
}

export interface WaypointPin {
  id: string;
  label: string;
  lat: number;
  lon: number;
  mgrs: string;
  createdAt: number;
}
