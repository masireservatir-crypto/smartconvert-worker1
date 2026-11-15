import { hmacSignHex, randomNonce, sha256Hex } from '../util/crypto.ts';

/**
 * Request signing, version SC1. The WordPress plugin (Phase 3) must produce the same bytes.
 *
 * canonical = "SC1\n" + METHOD + "\n" + pathAndQuery + "\n" + timestamp + "\n" + nonce + "\n" + sha256hex(body)
 * signature = hex(HMAC-SHA256(secret, canonical))
 */
export const SIGNATURE_VERSION = 'SC1';

export function canonicalString(method: string, pathAndQuery: string, timestamp: string, nonce: string, bodyHashHex: string): string {
  return [SIGNATURE_VERSION, method.toUpperCase(), pathAndQuery, timestamp, nonce, bodyHashHex].join('\n');
}

export interface SignOptions {
  keyId: string;
  secret: string;
  method: string;
  pathAndQuery: string;
  body?: Uint8Array;
  timestamp?: number;
  nonce?: string;
}

export async function signRequest(o: SignOptions): Promise<Record<string, string>> {
  const timestamp = String(o.timestamp ?? Math.floor(Date.now() / 1000));
  const nonce = o.nonce ?? randomNonce();
  const bodyHash = await sha256Hex(o.body ?? new Uint8Array(0));
  const signature = await hmacSignHex(o.secret, canonicalString(o.method, o.pathAndQuery, timestamp, nonce, bodyHash));
  return {
    'X-SC-Key-Id': o.keyId,
    'X-SC-Timestamp': timestamp,
    'X-SC-Nonce': nonce,
    'X-SC-Signature': signature,
  };
}
