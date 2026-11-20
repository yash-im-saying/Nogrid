import {useCallback, useEffect, useRef, useState} from 'react';
import {
  decryptPayload,
  deriveChannelKeyFromPassphrase,
  encryptPayload,
  generateIdentityKeyPair,
  importChannelKeyFromBase64,
} from '../lib/crypto';
import {playEncryptedAudioClip, playRadioTone} from '../lib/audioCodec';
import {
  clearAllMessages,
  deleteMessage,
  loadChannelKey,
  loadIdentity,
  loadMessages,
  loadOutboxEnvelopes,
  loadWaypoints,
  putMessage,
  queueOutboxEnvelope,
  removeOutboxEnvelope,
  removeWaypoint,
  saveChannelKey,
  saveIdentity,
  saveWaypoint,
} from '../lib/storage';
import {
  BurnTimerOption,
  type ChannelKeyState,
  type DecryptedPayload,
  type EncryptedEnvelope,
  type GeoFix,
  type IdentityProfile,
  PacketType,
  type PeerNode,
  SyncState,
  type TacticalMessage,
  type WaypointPin,
} from '../types/tactical';
import {useOnlineStatus} from './useOnlineStatus';

const DEFAULT_CHANNEL_ID = 'alpha-net';
const DEFAULT_PASSPHRASE = 'VANGUARD-ALPHA-GRID-01';
const LOCAL_CHANNEL_NAME = 'vanguard-mesh-local-v1';

export function useMeshSync() {
  const isOnline = useOnlineStatus();
  const [ready, setReady] = useState(false);
  const [identity, setIdentity] = useState<IdentityProfile | null>(null);
  const [channelKey, setChannelKey] = useState<ChannelKeyState | null>(null);
  const [messages, setMessages] = useState<TacticalMessage[]>([]);
  const [peers, setPeers] = useState<PeerNode[]>([]);
  const [waypoints, setWaypoints] = useState<WaypointPin[]>([]);
  const [outboxCount, setOutboxCount] = useState(0);
  const [wsConnected, setWsConnected] = useState(false);
  const [pttAutoMonitor, setPttAutoMonitor] = useState(true);
  const [wakeLockActive, setWakeLockActive] = useState(false);

  const aesKeyRef = useRef<CryptoKey | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const bcRef = useRef<BroadcastChannel | null>(null);
  const identityRef = useRef<IdentityProfile | null>(null);
  const channelRef = useRef<ChannelKeyState | null>(null);
  const pttMonitorRef = useRef(pttAutoMonitor);
  const seenIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    pttMonitorRef.current = pttAutoMonitor;
  }, [pttAutoMonitor]);

  // Process incoming encrypted envelope from WS, BroadcastChannel, HTTP sync, or Optical RX
  const ingestEncryptedEnvelope = useCallback(
    async (
      env: EncryptedEnvelope,
      transportTag: TacticalMessage['transportTag'],
      syncState: SyncState,
    ) => {
      if (!env || !env.id) return;
      if (env.expiresAt !== null && env.expiresAt <= Date.now()) return;
      if (seenIdsRef.current.has(env.id)) {
        // Update sync badge if our own queued message came back confirmed
        setMessages((prev) =>
          prev.map((m) =>
            m.id === env.id && m.syncState !== SyncState.Synced ? {...m, syncState} : m,
          ),
        );
        return;
      }

      const activeChannel = channelRef.current;
      const aesKey = aesKeyRef.current;
      if (!activeChannel || !aesKey || env.channelId !== activeChannel.channelId) {
        return;
      }

      seenIdsRef.current.add(env.id);

      let decrypted: DecryptedPayload | null = null;
      let decryptionError = false;

      try {
        decrypted = await decryptPayload<DecryptedPayload>(aesKey, env.ciphertextB64, env.ivB64);
      } catch {
        decryptionError = true;
      }

      const msg: TacticalMessage = {
        id: env.id,
        channelId: env.channelId,
        senderId: env.senderId,
        senderCallsign: env.senderCallsign,
        type: env.type,
        body: decrypted?.body,
        audioB64: decrypted?.audioB64,
        mimeType: decrypted?.mimeType,
        durationMs: decrypted?.durationMs,
        coords: decrypted?.coords,
        createdAt: env.createdAt,
        ttlSeconds: env.ttlSeconds,
        expiresAt: env.expiresAt,
        burnOnRead: Boolean(decrypted?.burnOnRead),
        readAt: null,
        syncState,
        transportTag,
        decryptionError,
      };

      await putMessage(msg);
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg].sort((a, b) => a.createdAt - b.createdAt);
      });

      // Update peer beacon coords if decrypted
      if (decrypted?.coords && env.senderId !== identityRef.current?.id) {
        setPeers((prev) => {
          const existing = prev.find((p) => p.id === env.senderId);
          if (existing) {
            return prev.map((p) =>
              p.id === env.senderId ? {...p, coords: decrypted?.coords, lastSeen: Date.now()} : p,
            );
          }
          return [
            ...prev,
            {
              id: env.senderId,
              callsign: env.senderCallsign,
              fingerprint: 'E2EE-BEACON',
              channelId: env.channelId,
              lastSeen: Date.now(),
              transport: transportTag === 'optical-rx' ? 'optical' : 'ws',
              coords: decrypted?.coords,
            },
          ];
        });
      }

      // Auto-play incoming PTT burst when radio monitor is armed
      if (
        !decryptionError &&
        msg.type === PacketType.PTT &&
        msg.audioB64 &&
        env.senderId !== identityRef.current?.id &&
        pttMonitorRef.current
      ) {
        playRadioTone('rx_beep');
        void playEncryptedAudioClip(msg.audioB64, msg.mimeType).catch(() => {});
      }
    },
    [],
  );

  // Flush IndexedDB outbox when WebSocket or HTTP connectivity returns
  const flushOutbox = useCallback(async () => {
    const queued = await loadOutboxEnvelopes();
    setOutboxCount(queued.length);
    if (queued.length === 0) return;

    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      for (const env of queued) {
        ws.send(JSON.stringify({type: 'packet', packet: env}));
        await removeOutboxEnvelope(env.id);
        setMessages((prev) =>
          prev.map((m) => (m.id === env.id ? {...m, syncState: SyncState.Synced} : m)),
        );
      }
      setOutboxCount(0);
      return;
    }

    if (navigator.onLine && channelRef.current) {
      try {
        const resp = await fetch('/api/mesh/sync', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            channelId: channelRef.current.channelId,
            packets: queued,
          }),
        });
        if (resp.ok) {
          for (const env of queued) {
            await removeOutboxEnvelope(env.id);
            setMessages((prev) =>
              prev.map((m) => (m.id === env.id ? {...m, syncState: SyncState.Synced} : m)),
            );
          }
          setOutboxCount(0);
        }
      } catch {
        // Remain queued offline
      }
    }
  }, []);

  // Boot local-first state from IndexedDB
  useEffect(() => {
    let active = true;
    async function boot() {
      let profile = await loadIdentity();
      if (!profile) {
        const kp = await generateIdentityKeyPair();
        const suffix = kp.fingerprint.slice(0, 4);
        profile = {
          id: crypto.randomUUID(),
          callsign: `OP-${suffix}`,
          publicKeyJwk: kp.publicKeyJwk,
          privateKeyJwk: kp.privateKeyJwk,
          fingerprint: kp.fingerprint,
          batterySaver: false,
          wakeLockEnabled: false,
        };
        await saveIdentity(profile);
      }

      let chState = await loadChannelKey();
      if (!chState) {
        const derived = await deriveChannelKeyFromPassphrase(
          DEFAULT_PASSPHRASE,
          DEFAULT_CHANNEL_ID,
        );
        aesKeyRef.current = derived.aesKey;
        chState = {
          channelId: DEFAULT_CHANNEL_ID,
          label: 'ALPHA-NET',
          keyHash: derived.keyHash,
          keyBase64: derived.keyBase64,
          passphraseHint: 'Default Tactical Net',
          updatedAt: Date.now(),
        };
        await saveChannelKey(chState);
      } else {
        const imported = await importChannelKeyFromBase64(chState.keyBase64);
        aesKeyRef.current = imported.aesKey;
      }

      const [storedMessages, storedOutbox, storedWaypoints] = await Promise.all([
        loadMessages(),
        loadOutboxEnvelopes(),
        loadWaypoints(),
      ]);

      if (!active) return;
      for (const m of storedMessages) {
        seenIdsRef.current.add(m.id);
      }
      identityRef.current = profile;
      channelRef.current = chState;
      setIdentity(profile);
      setChannelKey(chState);
      setMessages(storedMessages);
      setOutboxCount(storedOutbox.length);
      setWaypoints(storedWaypoints);
      setReady(true);
    }

    void boot();
    return () => {
      active = false;
    };
  }, []);

  // BroadcastChannel for zero-grid same-device tab-to-tab mesh sync
  useEffect(() => {
    if (!ready || typeof BroadcastChannel === 'undefined') return;
    const bc = new BroadcastChannel(LOCAL_CHANNEL_NAME);
    bcRef.current = bc;

    bc.onmessage = (ev) => {
      const data = ev.data as {type?: string; packet?: EncryptedEnvelope};
      if (data?.type === 'packet' && data.packet) {
        void ingestEncryptedEnvelope(data.packet, 'local-tab', SyncState.LocalMesh);
      }
    };

    return () => {
      bc.close();
      bcRef.current = null;
    };
  }, [ready, ingestEncryptedEnvelope]);

  // WebSocket mesh relay connection with auto-reconnect
  useEffect(() => {
    if (!ready || !identity || !channelKey) return;
    let closedByEffect = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (closedByEffect || !navigator.onLine) {
        setWsConnected(false);
        return;
      }

      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        setWsConnected(true);
        ws.send(
          JSON.stringify({
            type: 'join',
            peer: {
              id: identity.id,
              callsign: identity.callsign,
              fingerprint: identity.fingerprint,
              channelId: channelKey.channelId,
              lastSeen: Date.now(),
            },
          }),
        );
        void flushOutbox();
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as {
            type?: string;
            peers?: Array<{
              id: string;
              callsign: string;
              fingerprint: string;
              channelId: string;
              lastSeen: number;
            }>;
            packets?: EncryptedEnvelope[];
            packet?: EncryptedEnvelope;
          };

          if (msg.type === 'init') {
            if (Array.isArray(msg.peers)) {
              setPeers((prev) => {
                const coordMap = new Map(prev.map((p) => [p.id, p.coords]));
                return msg.peers!.map((p) => ({
                  ...p,
                  transport: 'ws' as const,
                  coords: coordMap.get(p.id),
                }));
              });
            }
            if (Array.isArray(msg.packets)) {
              for (const pkt of msg.packets) {
                void ingestEncryptedEnvelope(pkt, 'mesh-ws', SyncState.Synced);
              }
            }
          } else if (msg.type === 'presence' && Array.isArray(msg.peers)) {
            setPeers((prev) => {
              const coordMap = new Map(prev.map((p) => [p.id, p.coords]));
              return msg.peers!.map((p) => ({
                ...p,
                transport: 'ws' as const,
                coords: coordMap.get(p.id),
              }));
            });
          } else if (msg.type === 'packet' && msg.packet) {
            void ingestEncryptedEnvelope(msg.packet, 'mesh-ws', SyncState.Synced);
          }
        } catch {
          // Ignore malformed WS message
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        wsRef.current = null;
        if (!closedByEffect) {
          reconnectTimer = setTimeout(connect, identity.batterySaver ? 7000 : 3000);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connect();
    return () => {
      closedByEffect = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [ready, identity, channelKey, isOnline, flushOutbox, ingestEncryptedEnvelope]);

  // Trigger outbox flush when network comes back
  useEffect(() => {
    if (isOnline && ready) {
      void flushOutbox();
    }
  }, [isOnline, ready, flushOutbox]);

  // Self-destruct timer sweep every 1 second
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      setMessages((prev) => {
        const expired = prev.filter((m) => m.expiresAt !== null && m.expiresAt <= now);
        if (expired.length === 0) return prev;
        for (const exp of expired) {
          void deleteMessage(exp.id);
        }
        return prev.filter((m) => m.expiresAt === null || m.expiresAt > now);
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Wake Lock management for active field operation
  useEffect(() => {
    if (!identity?.wakeLockEnabled) {
      setWakeLockActive(false);
      return;
    }
    let sentinel: WakeLockSentinel | null = null;
    const nav = navigator as Navigator & {
      wakeLock?: {request: (type: 'screen') => Promise<WakeLockSentinel>};
    };
    if (nav.wakeLock) {
      nav.wakeLock
        .request('screen')
        .then((s) => {
          sentinel = s;
          setWakeLockActive(true);
        })
        .catch(() => setWakeLockActive(false));
    }
    return () => {
      if (sentinel) {
        void sentinel.release().catch(() => {});
      }
      setWakeLockActive(false);
    };
  }, [identity?.wakeLockEnabled]);

  const sendEncryptedPacket = useCallback(
    async (
      type: PacketType,
      payload: Omit<DecryptedPayload, 'kind' | 'sentAt'>,
      burnOption: BurnTimerOption,
    ): Promise<EncryptedEnvelope | null> => {
      const idProfile = identityRef.current;
      const ch = channelRef.current;
      const aesKey = aesKeyRef.current;
      if (!idProfile || !ch || !aesKey) return null;

      const now = Date.now();
      const isBurnOnRead = burnOption === BurnTimerOption.BurnOnRead;
      const ttlSeconds = burnOption > 0 ? burnOption : null;
      const expiresAt = ttlSeconds !== null ? now + ttlSeconds * 1000 : null;

      const fullPayload: DecryptedPayload = {
        kind: type,
        ...payload,
        burnOnRead: isBurnOnRead,
        sentAt: now,
      };

      const {ciphertextB64, ivB64} = await encryptPayload(aesKey, fullPayload);
      const envelope: EncryptedEnvelope = {
        id: crypto.randomUUID(),
        channelId: ch.channelId,
        senderId: idProfile.id,
        senderCallsign: idProfile.callsign,
        type,
        ciphertextB64,
        ivB64,
        createdAt: now,
        ttlSeconds,
        expiresAt,
      };

      seenIdsRef.current.add(envelope.id);

      const ws = wsRef.current;
      const isWsOpen = ws && ws.readyState === WebSocket.OPEN;

      const localMsg: TacticalMessage = {
        id: envelope.id,
        channelId: envelope.channelId,
        senderId: envelope.senderId,
        senderCallsign: envelope.senderCallsign,
        type,
        body: payload.body,
        audioB64: payload.audioB64,
        mimeType: payload.mimeType,
        durationMs: payload.durationMs,
        coords: payload.coords,
        createdAt: now,
        ttlSeconds,
        expiresAt,
        burnOnRead: isBurnOnRead,
        readAt: null,
        syncState: isWsOpen ? SyncState.Synced : SyncState.Queued,
        transportTag: isWsOpen ? 'mesh-ws' : 'offline-outbox',
      };

      await putMessage(localMsg);
      setMessages((prev) => [...prev, localMsg]);

      // Always send on BroadcastChannel for offline local-tab mesh
      bcRef.current?.postMessage({type: 'packet', packet: envelope});

      if (isWsOpen) {
        ws.send(JSON.stringify({type: 'packet', packet: envelope}));
      } else {
        await queueOutboxEnvelope(envelope);
        const q = await loadOutboxEnvelopes();
        setOutboxCount(q.length);
      }

      return envelope;
    },
    [],
  );

  const triggerBurnOnRead = useCallback(async (messageId: string) => {
    const now = Date.now();
    const burnAt = now + 5000;
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id === messageId && m.burnOnRead && m.readAt === null) {
          const updated = {...m, readAt: now, expiresAt: burnAt, ttlSeconds: 5};
          void putMessage(updated);
          return updated;
        }
        return m;
      }),
    );
  }, []);

  const updateIdentitySettings = useCallback(
    async (patch: Partial<Pick<IdentityProfile, 'callsign' | 'batterySaver' | 'wakeLockEnabled'>>) => {
      if (!identityRef.current) return;
      const updated = {...identityRef.current, ...patch};
      identityRef.current = updated;
      setIdentity(updated);
      await saveIdentity(updated);
    },
    [],
  );

  const rotateChannelPassphrase = useCallback(
    async (channelLabel: string, passphrase: string) => {
      const normalizedId = channelLabel
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-') || DEFAULT_CHANNEL_ID;
      const derived = await deriveChannelKeyFromPassphrase(passphrase, normalizedId);
      aesKeyRef.current = derived.aesKey;
      const nextState: ChannelKeyState = {
        channelId: normalizedId,
        label: channelLabel.trim().toUpperCase() || 'ALPHA-NET',
        keyHash: derived.keyHash,
        keyBase64: derived.keyBase64,
        passphraseHint: `Custom (${passphrase.length} chars)`,
        updatedAt: Date.now(),
      };
      channelRef.current = nextState;
      setChannelKey(nextState);
      await saveChannelKey(nextState);
    },
    [],
  );

  const importSharedChannelKey = useCallback(async (keyBase64: string, label = 'OPTICAL-NET') => {
    const imported = await importChannelKeyFromBase64(keyBase64);
    aesKeyRef.current = imported.aesKey;
    const nextState: ChannelKeyState = {
      channelId: channelRef.current?.channelId || DEFAULT_CHANNEL_ID,
      label,
      keyHash: imported.keyHash,
      keyBase64,
      passphraseHint: 'Synced via Light-Link',
      updatedAt: Date.now(),
    };
    channelRef.current = nextState;
    setChannelKey(nextState);
    await saveChannelKey(nextState);
  }, []);

  const encryptForOpticalTx = useCallback(async (text: string): Promise<Uint8Array | null> => {
    const aesKey = aesKeyRef.current;
    const idProfile = identityRef.current;
    if (!aesKey || !idProfile) return null;
    const {ciphertextB64, ivB64} = await encryptPayload(aesKey, {
      c: idProfile.callsign,
      b: text,
      t: Date.now(),
    });
    const compact = JSON.stringify({c: ciphertextB64, i: ivB64});
    return new TextEncoder().encode(compact);
  }, []);

  const decryptFromOpticalRx = useCallback(
    async (rawBytes: Uint8Array): Promise<{callsign: string; body: string} | null> => {
      const aesKey = aesKeyRef.current;
      const ch = channelRef.current;
      if (!aesKey || !ch) return null;
      const decodedStr = new TextDecoder().decode(rawBytes);
      const parsed = JSON.parse(decodedStr) as {c: string; i: string};
      const plain = await decryptPayload<{c: string; b: string; t: number}>(
        aesKey,
        parsed.c,
        parsed.i,
      );

      const msg: TacticalMessage = {
        id: crypto.randomUUID(),
        channelId: ch.channelId,
        senderId: `optical-${plain.c}`,
        senderCallsign: plain.c,
        type: PacketType.Text,
        body: plain.b,
        createdAt: Date.now(),
        ttlSeconds: 300,
        expiresAt: Date.now() + 300000,
        burnOnRead: false,
        readAt: null,
        syncState: SyncState.LocalMesh,
        transportTag: 'optical-rx',
      };
      seenIdsRef.current.add(msg.id);
      await putMessage(msg);
      setMessages((prev) => [...prev, msg]);
      return {callsign: plain.c, body: plain.b};
    },
    [],
  );

  const addWaypoint = useCallback(async (label: string, fix: GeoFix) => {
    const pin: WaypointPin = {
      id: crypto.randomUUID(),
      label: label.trim() || 'WPT',
      lat: fix.lat,
      lon: fix.lon,
      mgrs: fix.mgrs,
      createdAt: Date.now(),
    };
    await saveWaypoint(pin);
    setWaypoints((prev) => [pin, ...prev]);
  }, []);

  const deleteWaypointPin = useCallback(async (id: string) => {
    await removeWaypoint(id);
    setWaypoints((prev) => prev.filter((w) => w.id !== id));
  }, []);

  const wipeLocalHistory = useCallback(async () => {
    await clearAllMessages();
    seenIdsRef.current.clear();
    setMessages([]);
    setOutboxCount(0);
  }, []);

  return {
    ready,
    isOnline,
    wsConnected,
    identity,
    channelKey,
    messages,
    peers,
    waypoints,
    outboxCount,
    pttAutoMonitor,
    setPttAutoMonitor,
    wakeLockActive,
    sendEncryptedPacket,
    triggerBurnOnRead,
    updateIdentitySettings,
    rotateChannelPassphrase,
    importSharedChannelKey,
    encryptForOpticalTx,
    decryptFromOpticalRx,
    addWaypoint,
    deleteWaypointPin,
    flushOutbox,
    wipeLocalHistory,
  };
}
