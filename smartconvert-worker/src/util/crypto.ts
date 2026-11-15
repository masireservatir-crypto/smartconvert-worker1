const enc = new TextEncoder();
const dec = new TextDecoder();

export function toHex(input: ArrayBuffer | Uint8Array): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

export function fromHex(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function fromBase64(text: string): Uint8Array {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', data));
}

async function hmacKey(secret: string, usage: 'sign' | 'verify'): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}

export async function hmacSignHex(secret: string, message: string): Promise<string> {
  const key = await hmacKey(secret, 'sign');
  return toHex(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}

/** Constant-time verification (done by WebCrypto). */
export async function hmacVerifyHex(secret: string, message: string, signatureHex: string): Promise<boolean> {
  const sig = fromHex(signatureHex);
  if (!sig || sig.length !== 32) return false;
  const key = await hmacKey(secret, 'verify');
  return crypto.subtle.verify('HMAC', key, sig, enc.encode(message));
}

async function aesKey(masterKeyB64: string, usage: 'encrypt' | 'decrypt'): Promise<CryptoKey> {
  let raw: Uint8Array;
  try {
    raw = fromBase64(masterKeyB64.trim());
  } catch {
    throw new Error('MASTER_KEY is not valid base64');
  }
  if (raw.length !== 32) throw new Error('MASTER_KEY must decode to exactly 32 bytes');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, [usage]);
}

/** Returns "v1.<iv>.<ciphertext>" (base64). `aad` binds the ciphertext to its owner (e.g. the key id). */
export async function encryptSecret(masterKeyB64: string, plaintext: string, aad: string): Promise<string> {
  const key = await aesKey(masterKeyB64, 'encrypt');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, key, enc.encode(plaintext));
  return `v1.${toBase64(iv)}.${toBase64(new Uint8Array(ct))}`;
}

export async function decryptSecret(masterKeyB64: string, stored: string, aad: string): Promise<string> {
  const parts = stored.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') throw new Error('Unsupported secret format');
  const key = await aesKey(masterKeyB64, 'decrypt');
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(parts[1]), additionalData: enc.encode(aad) },
    key,
    fromBase64(parts[2]),
  );
  return dec.decode(pt);
}

/** 32 random bytes as base64url (43 chars). */
export function randomSecret(): string {
  return toBase64(crypto.getRandomValues(new Uint8Array(32))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** "sck_" + 24 hex chars. */
export function randomKeyId(): string {
  return 'sck_' + toHex(crypto.getRandomValues(new Uint8Array(12)));
}

export function randomNonce(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(16)));
}
