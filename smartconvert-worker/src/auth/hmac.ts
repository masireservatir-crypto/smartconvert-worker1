import type { Env } from '../env.ts';
import { ApiError } from '../errors.ts';
import { claimNonce, findCredential } from '../db/queries.ts';
import { decryptSecret, hmacVerifyHex, sha256Hex } from '../util/crypto.ts';
import { canonicalString } from './sign.ts';

export const MAX_SKEW_SECONDS = 300;
export const MAX_BODY_BYTES = 256 * 1024;

export interface AuthContext {
  siteId: string;
  userId: string;
  domain: string;
  keyId: string;
  nonce: string;
  body: Uint8Array;
}

const INVALID = 'Missing or invalid authentication.';

async function readBody(request: Request): Promise<Uint8Array> {
  const declared = Number(request.headers.get('Content-Length') ?? '0');
  if (declared > MAX_BODY_BYTES) throw new ApiError('PAYLOAD_TOO_LARGE', 413, 'Request body is too large.');
  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength > MAX_BODY_BYTES) throw new ApiError('PAYLOAD_TOO_LARGE', 413, 'Request body is too large.');
  return body;
}

/**
 * Verifies the signed request and records its nonce (replay protection).
 * `kind` labels the request in ai_requests (for usage tracking).
 */
export async function authenticate(request: Request, env: Env, kind: string): Promise<AuthContext> {
  const keyId = request.headers.get('X-SC-Key-Id') ?? '';
  const timestamp = request.headers.get('X-SC-Timestamp') ?? '';
  const nonce = request.headers.get('X-SC-Nonce') ?? '';
  const signature = request.headers.get('X-SC-Signature') ?? '';

  if (
    !/^sck_[0-9a-f]{24}$/.test(keyId) ||
    !/^\d{10}$/.test(timestamp) ||
    !/^[A-Za-z0-9_-]{16,64}$/.test(nonce) ||
    !/^[0-9a-f]{64}$/.test(signature)
  ) {
    throw new ApiError('AUTH_INVALID', 401, INVALID);
  }

  const skew = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (skew > MAX_SKEW_SECONDS) {
    throw new ApiError('AUTH_EXPIRED', 401, 'Request timestamp is outside the allowed window. Check the server clock.');
  }

  if (!env.MASTER_KEY) {
    console.error('MASTER_KEY secret is not configured');
    throw new ApiError('INTERNAL', 500, 'Server configuration error.');
  }

  const body = await readBody(request);
  const bodyHash = await sha256Hex(body);

  const row = await findCredential(env.DB, keyId);
  // Same message for unknown key, revoked key and revoked site: do not reveal which.
  if (!row || row.credential_status !== 'active' || row.site_status !== 'active') {
    throw new ApiError('AUTH_INVALID', 401, INVALID);
  }

  let secret: string;
  try {
    secret = await decryptSecret(env.MASTER_KEY, row.secret_enc, row.key_id);
  } catch (e) {
    console.error('credential decryption failed', row.key_id, e instanceof Error ? e.message : e);
    throw new ApiError('INTERNAL', 500, 'Server configuration error.');
  }

  const url = new URL(request.url);
  const canonical = canonicalString(request.method, url.pathname + url.search, timestamp, nonce, bodyHash);
  if (!(await hmacVerifyHex(secret, canonical, signature))) {
    throw new ApiError('AUTH_INVALID', 401, INVALID);
  }

  if (!(await claimNonce(env.DB, row.site_id, nonce, kind))) {
    throw new ApiError('REPLAY', 409, 'This request was already processed.');
  }

  return { siteId: row.site_id, userId: row.user_id, domain: row.domain, keyId: row.key_id, nonce, body };
}
