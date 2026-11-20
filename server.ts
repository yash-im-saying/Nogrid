import dotenv from 'dotenv';
import express from 'express';
import http from 'http';
import path from 'path';
import {fileURLToPath} from 'url';
import {WebSocketServer, WebSocket} from 'ws';
import type {IncomingMessage} from 'http';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

interface ServerEnvelope {
  id: string;
  channelId: string;
  senderId: string;
  senderCallsign: string;
  type: 'text' | 'ptt' | 'beacon';
  ciphertextB64: string;
  ivB64: string;
  createdAt: number;
  ttlSeconds: number | null;
  expiresAt: number | null;
}

interface ConnectedPeer {
  id: string;
  callsign: string;
  fingerprint: string;
  channelId: string;
  lastSeen: number;
}

const packetStore = new Map<string, ServerEnvelope>();
const clientMeta = new Map<WebSocket, ConnectedPeer>();

function pruneExpiredPackets(): void {
  const now = Date.now();
  for (const [id, pkt] of packetStore.entries()) {
    if (pkt.expiresAt !== null && pkt.expiresAt <= now) {
      packetStore.delete(id);
    }
  }
  // Cap total buffered packets to keep memory bounded
  if (packetStore.size > 400) {
    const sorted = Array.from(packetStore.values()).sort((a, b) => a.createdAt - b.createdAt);
    const removeCount = packetStore.size - 400;
    for (let i = 0; i < removeCount; i++) {
      packetStore.delete(sorted[i].id);
    }
  }
}

setInterval(pruneExpiredPackets, 5000);

function getActivePeersForChannel(channelId: string): ConnectedPeer[] {
  const seen = new Map<string, ConnectedPeer>();
  for (const peer of clientMeta.values()) {
    if (peer.channelId === channelId) {
      seen.set(peer.id, peer);
    }
  }
  return Array.from(seen.values());
}

function broadcastToChannel(channelId: string, payload: unknown, excludeSocket?: WebSocket): void {
  const serialized = JSON.stringify(payload);
  for (const [ws, peer] of clientMeta.entries()) {
    if (ws !== excludeSocket && ws.readyState === WebSocket.OPEN && peer.channelId === channelId) {
      ws.send(serialized);
    }
  }
}

function acceptEnvelope(pkt: ServerEnvelope): boolean {
  if (!pkt || !pkt.id || !pkt.channelId || !pkt.ciphertextB64 || !pkt.ivB64) {
    return false;
  }
  if (pkt.expiresAt !== null && pkt.expiresAt <= Date.now()) {
    return false;
  }
  if (packetStore.has(pkt.id)) {
    return false;
  }
  packetStore.set(pkt.id, pkt);
  return true;
}

async function startServer(): Promise<void> {
  const app = express();
  app.use(express.json({limit: '2mb'}));

  app.get('/api/health', (_req, res) => {
    pruneExpiredPackets();
    res.json({
      ok: true,
      peers: clientMeta.size,
      packets: packetStore.size,
      uptimeSec: Math.floor(process.uptime()),
    });
  });

  app.get('/api/mesh/state', (req, res) => {
    pruneExpiredPackets();
    const channelId = typeof req.query.channelId === 'string' ? req.query.channelId : 'alpha-net';
    const packets = Array.from(packetStore.values())
      .filter((p) => p.channelId === channelId)
      .sort((a, b) => a.createdAt - b.createdAt);
    res.json({
      channelId,
      peers: getActivePeersForChannel(channelId),
      packets,
    });
  });

  app.post('/api/mesh/sync', (req, res) => {
    pruneExpiredPackets();
    const body = req.body as {channelId?: string; packets?: ServerEnvelope[]};
    const channelId = typeof body?.channelId === 'string' ? body.channelId : 'alpha-net';
    const incoming = Array.isArray(body?.packets) ? body.packets : [];
    const acceptedIds: string[] = [];

    for (const pkt of incoming) {
      if (acceptEnvelope(pkt)) {
        acceptedIds.push(pkt.id);
        broadcastToChannel(pkt.channelId, {type: 'packet', packet: pkt});
      }
    }

    const packets = Array.from(packetStore.values())
      .filter((p) => p.channelId === channelId)
      .sort((a, b) => a.createdAt - b.createdAt);

    res.json({
      acceptedIds,
      peers: getActivePeersForChannel(channelId),
      packets,
    });
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({server, path: '/ws'});

  wss.on('connection', (ws: WebSocket, _req: IncomingMessage) => {
    ws.on('message', (rawData) => {
      try {
        const msg = JSON.parse(rawData.toString()) as {
          type?: string;
          peer?: ConnectedPeer;
          packet?: ServerEnvelope;
          channelId?: string;
        };

        if (msg.type === 'join' && msg.peer?.id && msg.peer?.channelId) {
          const peerInfo: ConnectedPeer = {
            id: String(msg.peer.id),
            callsign: String(msg.peer.callsign || 'UNIT-01').slice(0, 24),
            fingerprint: String(msg.peer.fingerprint || '').slice(0, 32),
            channelId: String(msg.peer.channelId),
            lastSeen: Date.now(),
          };
          clientMeta.set(ws, peerInfo);

          pruneExpiredPackets();
          const channelPackets = Array.from(packetStore.values())
            .filter((p) => p.channelId === peerInfo.channelId)
            .sort((a, b) => a.createdAt - b.createdAt);

          ws.send(
            JSON.stringify({
              type: 'init',
              channelId: peerInfo.channelId,
              peers: getActivePeersForChannel(peerInfo.channelId),
              packets: channelPackets,
            }),
          );

          broadcastToChannel(
            peerInfo.channelId,
            {
              type: 'presence',
              peers: getActivePeersForChannel(peerInfo.channelId),
            },
            ws,
          );
          return;
        }

        if (msg.type === 'packet' && msg.packet) {
          const accepted = acceptEnvelope(msg.packet);
          const peer = clientMeta.get(ws);
          if (peer) {
            peer.lastSeen = Date.now();
          }
          if (accepted) {
            broadcastToChannel(msg.packet.channelId, {
              type: 'packet',
              packet: msg.packet,
            });
          } else {
            // Confirm idempotently to sender if already stored
            ws.send(JSON.stringify({type: 'ack', id: msg.packet.id}));
          }
          return;
        }

        if (msg.type === 'ping') {
          const peer = clientMeta.get(ws);
          if (peer) peer.lastSeen = Date.now();
          ws.send(JSON.stringify({type: 'pong', ts: Date.now()}));
        }
      } catch {
        // Ignore malformed packets
      }
    });

    ws.on('close', () => {
      const peer = clientMeta.get(ws);
      clientMeta.delete(ws);
      if (peer) {
        broadcastToChannel(peer.channelId, {
          type: 'presence',
          peers: getActivePeersForChannel(peer.channelId),
        });
      }
    });
  });

  if (!isProduction) {
    const {createServer: createViteServer} = await import('vite');
    const vite = await createViteServer({
      server: {middlewareMode: true},
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Vanguard Mesh server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start Vanguard Mesh server:', err);
  process.exit(1);
});
