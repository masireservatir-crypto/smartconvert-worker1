import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.ts';
import { signRequest } from '../src/auth/sign.ts';
import { authenticate } from '../src/auth/hmac.ts';
import { decryptSecret, encryptSecret, randomKeyId, randomSecret, toBase64 } from '../src/util/crypto.ts';
import { createD1 } from './d1-shim.ts';

const MIGRATION = readFileSync(new URL('../migrations/0001_core.sql', import.meta.url), 'utf8');
const MASTER_KEY = toBase64(crypto.getRandomValues(new Uint8Array(32)));
const BASE = 'https://api.test';

function makeEnv(opts: { migrate?: boolean; masterKey?: string | null } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  if (opts.migrate !== false) sqlite.exec(MIGRATION);
  const masterKey = opts.masterKey === null ? undefined : (opts.masterKey ?? MASTER_KEY);
  return { sqlite, env: { DB: createD1(sqlite), MASTER_KEY: masterKey, APP_VERSION: 'test', ENVIRONMENT: 'test' } as any };
}

async function seedSite(
  sqlite: DatabaseSync,
  opts: { siteStatus?: string; credStatus?: string; masterKey?: string } = {},
) {
  const keyId = randomKeyId();
  const secret = randomSecret();
  const enc = await encryptSecret(opts.masterKey ?? MASTER_KEY, secret, keyId);
  sqlite.exec(`INSERT OR IGNORE INTO users (id, email, created_at) VALUES ('u1', 'a@b.c', 1)`);
  sqlite
    .prepare(`INSERT OR IGNORE INTO sites (id, user_id, domain, status, created_at) VALUES ('s1', 'u1', 'shop.test', ?, 1)`)
    .run(opts.siteStatus ?? 'active');
  sqlite
    .prepare(`INSERT INTO site_credentials (id, site_id, secret_enc, status, created_at) VALUES (?, 's1', ?, ?, 1)`)
    .run(keyId, enc, opts.credStatus ?? 'active');
  return { keyId, secret };
}

async function call(env: any, path: string, init: RequestInit = {}) {
  const res = await worker.fetch(new Request(BASE + path, init), env);
  return { res, json: (await res.json()) as any };
}

async function signedGet(env: any, cred: { keyId: string; secret: string }, path = '/api/v1/auth/whoami', over: any = {}) {
  const headers = await signRequest({ keyId: cred.keyId, secret: cred.secret, method: 'GET', pathAndQuery: path, ...over });
  return call(env, path, { headers });
}

// ---------- health ----------

test('health: standard success envelope', async () => {
  const { env } = makeEnv();
  const { res, json } = await call(env, '/api/v1/health');
  assert.equal(res.status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.data.status, 'ok');
  assert.equal(json.data.database.migrated, true);
  assert.equal(json.data.config.master_key_configured, true);
  assert.match(json.request_id, /^[0-9a-f-]{36}$/);
  assert.equal(res.headers.get('X-Request-Id'), json.request_id);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
});

test('health: reports needs_migration on an empty database', async () => {
  const { env } = makeEnv({ migrate: false });
  const { res, json } = await call(env, '/api/v1/health');
  assert.equal(res.status, 200);
  assert.equal(json.data.status, 'needs_migration');
  assert.equal(json.data.database.migrated, false);
});

test('health: database failure gives 503 without leaking details', async () => {
  const env = { DB: { prepare: () => { throw new Error('secret internal detail'); } }, MASTER_KEY };
  const { res, json } = await call(env, '/api/v1/health');
  assert.equal(res.status, 503);
  assert.equal(json.ok, false);
  assert.equal(json.error.code, 'INTERNAL');
  assert.ok(!JSON.stringify(json).includes('secret internal detail'));
});

// ---------- routing ----------

test('unknown path gives 404 envelope', async () => {
  const { env } = makeEnv();
  const { res, json } = await call(env, '/api/v1/nope');
  assert.equal(res.status, 404);
  assert.equal(json.error.code, 'NOT_FOUND');
});

test('wrong method gives 405 with Allow header', async () => {
  const { env } = makeEnv();
  const { res, json } = await call(env, '/api/v1/health', { method: 'POST' });
  assert.equal(res.status, 405);
  assert.equal(json.error.code, 'METHOD_NOT_ALLOWED');
  assert.equal(res.headers.get('Allow'), 'GET');
});

test('trailing slash is accepted', async () => {
  const { env } = makeEnv();
  const { res } = await call(env, '/api/v1/health/');
  assert.equal(res.status, 200);
});

// ---------- authentication ----------

test('auth: valid signed request succeeds', async () => {
  const { sqlite, env } = makeEnv();
  const cred = await seedSite(sqlite);
  const { res, json } = await signedGet(env, cred);
  assert.equal(res.status, 200);
  assert.equal(json.data.site_id, 's1');
  assert.equal(json.data.domain, 'shop.test');
  assert.equal(json.data.key_id, cred.keyId);
});

test('auth: missing headers -> AUTH_INVALID', async () => {
  const { env } = makeEnv();
  const { res, json } = await call(env, '/api/v1/auth/whoami');
  assert.equal(res.status, 401);
  assert.equal(json.error.code, 'AUTH_INVALID');
});

test('auth: wrong secret -> AUTH_INVALID', async () => {
  const { sqlite, env } = makeEnv();
  const cred = await seedSite(sqlite);
  const { res, json } = await signedGet(env, { keyId: cred.keyId, secret: 'wrong-secret' });
  assert.equal(res.status, 401);
  assert.equal(json.error.code, 'AUTH_INVALID');
});

test('auth: unknown key id -> AUTH_INVALID (same message as wrong secret)', async () => {
  const { sqlite, env } = makeEnv();
  const cred = await seedSite(sqlite);
  const a = await signedGet(env, { keyId: randomKeyId(), secret: cred.secret });
  const b = await signedGet(env, { keyId: cred.keyId, secret: 'x' });
  assert.equal(a.res.status, 401);
  assert.equal(a.json.error.message, b.json.error.message);
});

test('auth: old timestamp -> AUTH_EXPIRED', async () => {
  const { sqlite, env } = makeEnv();
  const cred = await seedSite(sqlite);
  const { res, json } = await signedGet(env, cred, '/api/v1/auth/whoami', { timestamp: Math.floor(Date.now() / 1000) - 1000 });
  assert.equal(res.status, 401);
  assert.equal(json.error.code, 'AUTH_EXPIRED');
});

test('auth: replayed request -> REPLAY (409)', async () => {
  const { sqlite, env } = makeEnv();
  const cred = await seedSite(sqlite);
  const headers = await signRequest({ keyId: cred.keyId, secret: cred.secret, method: 'GET', pathAndQuery: '/api/v1/auth/whoami' });
  const first = await call(env, '/api/v1/auth/whoami', { headers });
  const second = await call(env, '/api/v1/auth/whoami', { headers });
  assert.equal(first.res.status, 200);
  assert.equal(second.res.status, 409);
  assert.equal(second.json.error.code, 'REPLAY');
});

test('auth: signature is bound to the path and query', async () => {
  const { sqlite, env } = makeEnv();
  const cred = await seedSite(sqlite);
  const headers = await signRequest({ keyId: cred.keyId, secret: cred.secret, method: 'GET', pathAndQuery: '/api/v1/auth/whoami?a=1' });
  const { res, json } = await call(env, '/api/v1/auth/whoami?a=2', { headers });
  assert.equal(res.status, 401);
  assert.equal(json.error.code, 'AUTH_INVALID');
});

test('auth: signature is bound to the body', async () => {
  const { sqlite, env } = makeEnv();
  const cred = await seedSite(sqlite);
  const headers = await signRequest({
    keyId: cred.keyId, secret: cred.secret, method: 'GET', pathAndQuery: '/api/v1/auth/whoami',
    body: new TextEncoder().encode('original'),
  });
  const { res } = await call(env, '/api/v1/auth/whoami', { headers, method: 'GET' });
  assert.equal(res.status, 401); // signed with a body, sent without one
});

test('auth: revoked credential and revoked site are rejected', async () => {
  const a = makeEnv();
  const credA = await seedSite(a.sqlite, { credStatus: 'revoked' });
  assert.equal((await signedGet(a.env, credA)).res.status, 401);

  const b = makeEnv();
  const credB = await seedSite(b.sqlite, { siteStatus: 'revoked' });
  assert.equal((await signedGet(b.env, credB)).res.status, 401);

  const c = makeEnv();
  const credC = await seedSite(c.sqlite, { siteStatus: 'pending' });
  assert.equal((await signedGet(c.env, credC)).res.status, 401);
});

test('auth: missing MASTER_KEY -> 500 INTERNAL, generic message', async () => {
  const { sqlite, env } = makeEnv({ masterKey: null });
  const cred = await seedSite(sqlite);
  const { res, json } = await signedGet(env, cred);
  assert.equal(res.status, 500);
  assert.equal(json.error.code, 'INTERNAL');
});

test('auth: wrong MASTER_KEY cannot decrypt -> 500, no leak', async () => {
  const { sqlite, env } = makeEnv({ masterKey: toBase64(crypto.getRandomValues(new Uint8Array(32))) });
  const cred = await seedSite(sqlite); // encrypted with the other key
  const { res, json } = await signedGet(env, cred);
  assert.equal(res.status, 500);
  assert.equal(json.error.message, 'Server configuration error.');
});

test('auth: oversized body -> 413', async () => {
  const { sqlite, env } = makeEnv();
  const cred = await seedSite(sqlite);
  const big = new Uint8Array(300 * 1024);
  const headers = await signRequest({ keyId: cred.keyId, secret: cred.secret, method: 'POST', pathAndQuery: '/x', body: big });
  const request = new Request(BASE + '/x', { method: 'POST', headers, body: big });
  await assert.rejects(() => authenticate(request, env, 'test'), (e: any) => e.code === 'PAYLOAD_TOO_LARGE' && e.status === 413);
});

test('auth: nonce is stored once per request', async () => {
  const { sqlite, env } = makeEnv();
  const cred = await seedSite(sqlite);
  await signedGet(env, cred);
  const row = sqlite.prepare('SELECT COUNT(*) AS n FROM ai_requests').get() as any;
  assert.equal(row.n, 1);
});

// ---------- crypto ----------

test('crypto: secret round-trip and AAD binding', async () => {
  const enc = await encryptSecret(MASTER_KEY, 'hello', 'sck_a');
  assert.equal(await decryptSecret(MASTER_KEY, enc, 'sck_a'), 'hello');
  await assert.rejects(() => decryptSecret(MASTER_KEY, enc, 'sck_b'));
  await assert.rejects(() => encryptSecret('c2hvcnQ=', 'x', 'a')); // not 32 bytes
});

// ---------- schema ----------

test('schema: foreign keys and unique constraints are enforced', () => {
  const { sqlite } = makeEnv();
  assert.throws(() => sqlite.exec(`INSERT INTO sites (id, user_id, domain, created_at) VALUES ('x', 'missing', 'd', 1)`));
  sqlite.exec(`INSERT INTO users (id, email, created_at) VALUES ('u', 'e@e.e', 1)`);
  assert.throws(() => sqlite.exec(`INSERT INTO users (id, email, created_at) VALUES ('u2', 'e@e.e', 1)`));
  assert.throws(() => sqlite.exec(`INSERT INTO sites (id, user_id, domain, status, created_at) VALUES ('s', 'u', 'd', 'bogus', 1)`));
});
