const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function generateIdentityKeyPair(): Promise<{
  publicKeyJwk: JsonWebKey;
  privateKeyJwk: JsonWebKey;
  fingerprint: string;
}> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'ECDH',
      namedCurve: 'P-256',
    },
    true,
    ['deriveKey', 'deriveBits'],
  );

  const publicKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  const privateKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);

  const canonical = JSON.stringify({x: publicKeyJwk.x, y: publicKeyJwk.y, crv: publicKeyJwk.crv});
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(canonical));
  const hex = Array.from(new Uint8Array(digest))
    .slice(0, 6)
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join(':');

  return {
    publicKeyJwk,
    privateKeyJwk,
    fingerprint: hex,
  };
}

export async function deriveChannelKeyFromPassphrase(
  passphrase: string,
  channelId: string,
): Promise<{aesKey: CryptoKey; keyBase64: string; keyHash: string}> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey'],
  );

  const salt = textEncoder.encode(`vanguard-mesh::${channelId}`);
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256',
    },
    baseKey,
    256,
  );

  const rawBytes = new Uint8Array(bits);
  const aesKey = await crypto.subtle.importKey(
    'raw',
    rawBytes,
    {name: 'AES-GCM', length: 256},
    true,
    ['encrypt', 'decrypt'],
  );

  const hashBuf = await crypto.subtle.digest('SHA-256', rawBytes);
  const keyHash = Array.from(new Uint8Array(hashBuf))
    .slice(0, 4)
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join('');

  return {
    aesKey,
    keyBase64: arrayBufferToBase64(rawBytes),
    keyHash,
  };
}

export async function importChannelKeyFromBase64(keyBase64: string): Promise<{
  aesKey: CryptoKey;
  keyHash: string;
}> {
  const rawBytes = base64ToUint8Array(keyBase64);
  const copy = new Uint8Array(rawBytes.length);
  copy.set(rawBytes);

  const aesKey = await crypto.subtle.importKey(
    'raw',
    copy.buffer,
    {name: 'AES-GCM', length: 256},
    true,
    ['encrypt', 'decrypt'],
  );

  const hashBuf = await crypto.subtle.digest('SHA-256', copy.buffer);
  const keyHash = Array.from(new Uint8Array(hashBuf))
    .slice(0, 4)
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join('');

  return {aesKey, keyHash};
}

export async function encryptPayload<T>(
  aesKey: CryptoKey,
  payload: T,
): Promise<{ciphertextB64: string; ivB64: string}> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = textEncoder.encode(JSON.stringify(payload));
  const cipherBuffer = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
    },
    aesKey,
    encoded,
  );

  return {
    ciphertextB64: arrayBufferToBase64(cipherBuffer),
    ivB64: arrayBufferToBase64(iv),
  };
}

export async function decryptPayload<T>(
  aesKey: CryptoKey,
  ciphertextB64: string,
  ivB64: string,
): Promise<T> {
  const ivRaw = base64ToUint8Array(ivB64);
  const cipherRaw = base64ToUint8Array(ciphertextB64);

  const ivCopy = new Uint8Array(ivRaw.length);
  ivCopy.set(ivRaw);
  const cipherCopy = new Uint8Array(cipherRaw.length);
  cipherCopy.set(cipherRaw);

  const plainBuffer = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: ivCopy.buffer,
    },
    aesKey,
    cipherCopy.buffer,
  );

  return JSON.parse(textDecoder.decode(plainBuffer)) as T;
}
