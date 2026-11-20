import type {
  ChannelKeyState,
  EncryptedEnvelope,
  IdentityProfile,
  TacticalMessage,
  WaypointPin,
} from '../types/tactical';

const DB_NAME = 'vanguard_mesh_db';
const DB_VERSION = 1;

const STORE_META = 'meta';
const STORE_MESSAGES = 'messages';
const STORE_OUTBOX = 'outbox';
const STORE_WAYPOINTS = 'waypoints';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META);
      }
      if (!db.objectStoreNames.contains(STORE_MESSAGES)) {
        db.createObjectStore(STORE_MESSAGES, {keyPath: 'id'});
      }
      if (!db.objectStoreNames.contains(STORE_OUTBOX)) {
        db.createObjectStore(STORE_OUTBOX, {keyPath: 'id'});
      }
      if (!db.objectStoreNames.contains(STORE_WAYPOINTS)) {
        db.createObjectStore(STORE_WAYPOINTS, {keyPath: 'id'});
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getMeta<T>(key: string): Promise<T | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_META, 'readonly');
    const req = tx.objectStore(STORE_META).get(key);
    req.onsuccess = () => resolve((req.result as T) ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function setMeta<T>(key: string, value: T): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_META, 'readwrite');
    tx.objectStore(STORE_META).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadIdentity(): Promise<IdentityProfile | null> {
  return getMeta<IdentityProfile>('identity_profile');
}

export async function saveIdentity(profile: IdentityProfile): Promise<void> {
  return setMeta('identity_profile', profile);
}

export async function loadChannelKey(): Promise<ChannelKeyState | null> {
  return getMeta<ChannelKeyState>('channel_key_state');
}

export async function saveChannelKey(channel: ChannelKeyState): Promise<void> {
  return setMeta('channel_key_state', channel);
}

export async function loadMessages(): Promise<TacticalMessage[]> {
  const db = await openDb();
  const now = Date.now();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_MESSAGES, 'readwrite');
    const store = tx.objectStore(STORE_MESSAGES);
    const req = store.getAll();
    req.onsuccess = () => {
      const items = (req.result as TacticalMessage[]) || [];
      const active: TacticalMessage[] = [];
      for (const item of items) {
        if (item.expiresAt !== null && item.expiresAt <= now) {
          store.delete(item.id);
        } else {
          active.push(item);
        }
      }
      active.sort((a, b) => a.createdAt - b.createdAt);
      resolve(active);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function putMessage(msg: TacticalMessage): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_MESSAGES, 'readwrite');
    tx.objectStore(STORE_MESSAGES).put(msg);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteMessage(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_MESSAGES, 'readwrite');
    tx.objectStore(STORE_MESSAGES).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearAllMessages(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_MESSAGES, STORE_OUTBOX], 'readwrite');
    tx.objectStore(STORE_MESSAGES).clear();
    tx.objectStore(STORE_OUTBOX).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function queueOutboxEnvelope(envelope: EncryptedEnvelope): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_OUTBOX, 'readwrite');
    tx.objectStore(STORE_OUTBOX).put(envelope);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadOutboxEnvelopes(): Promise<EncryptedEnvelope[]> {
  const db = await openDb();
  const now = Date.now();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_OUTBOX, 'readwrite');
    const store = tx.objectStore(STORE_OUTBOX);
    const req = store.getAll();
    req.onsuccess = () => {
      const all = (req.result as EncryptedEnvelope[]) || [];
      const valid: EncryptedEnvelope[] = [];
      for (const env of all) {
        if (env.expiresAt !== null && env.expiresAt <= now) {
          store.delete(env.id);
        } else {
          valid.push(env);
        }
      }
      valid.sort((a, b) => a.createdAt - b.createdAt);
      resolve(valid);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function removeOutboxEnvelope(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_OUTBOX, 'readwrite');
    tx.objectStore(STORE_OUTBOX).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadWaypoints(): Promise<WaypointPin[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_WAYPOINTS, 'readonly');
    const req = tx.objectStore(STORE_WAYPOINTS).getAll();
    req.onsuccess = () => {
      const items = (req.result as WaypointPin[]) || [];
      items.sort((a, b) => b.createdAt - a.createdAt);
      resolve(items);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function saveWaypoint(pin: WaypointPin): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_WAYPOINTS, 'readwrite');
    tx.objectStore(STORE_WAYPOINTS).put(pin);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function removeWaypoint(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_WAYPOINTS, 'readwrite');
    tx.objectStore(STORE_WAYPOINTS).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
