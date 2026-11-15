// End-to-end: seed script -> real SQLite -> real HTTP server -> signed-request script.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.ts';
import { toBase64 } from '../src/util/crypto.ts';
import { createD1 } from './d1-shim.ts';

const root = new URL('..', import.meta.url).pathname;
const nodeArgs = ['--experimental-strip-types', '--disable-warning=ExperimentalWarning'];

test('e2e: migrations + seed script + signed request over HTTP', async () => {
  const masterKey = toBase64(crypto.getRandomValues(new Uint8Array(32)));
  const sqlite = new DatabaseSync(':memory:');
  for (const f of readdirSync(join(root, 'migrations')).sort()) sqlite.exec(readFileSync(join(root, 'migrations', f), 'utf8'));

  const work = mkdtempSync(join(tmpdir(), 'sc-e2e-'));
  const seedOut = execFileSync('node', [...nodeArgs, join(root, 'scripts/make-test-site.ts')], {
    cwd: work, env: { ...process.env, MASTER_KEY: masterKey }, encoding: 'utf8',
  });
  const keyId = seedOut.match(/KEY_ID=(\S+)/)![1];
  const secret = seedOut.match(/SECRET=(\S+)/)![1];
  sqlite.exec(readFileSync(join(work, '.seed.sql'), 'utf8'));

  const env = { DB: createD1(sqlite), MASTER_KEY: masterKey, APP_VERSION: 'e2e', ENVIRONMENT: 'test' } as any;
  const server = createServer(async (req, res) => {
    const r = await worker.fetch(new Request('http://127.0.0.1' + req.url, { method: req.method, headers: req.headers as any }), env);
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(await r.text());
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;

  try {
    const run = (path: string, key = keyId) =>
      new Promise<string>((resolve) => {
        import('node:child_process').then(({ execFile }) =>
          execFile('node', [...nodeArgs, join(root, 'scripts/signed-request.ts'), 'GET', path, base],
            { env: { ...process.env, KEY_ID: key, SECRET: secret } }, (_e, out) => resolve(out)));
      });

    const ok = await run('/api/v1/auth/whoami');
    assert.match(ok, /HTTP 200/);
    assert.match(ok, /"site_id":"site_test"/);

    const health = await run('/api/v1/health');
    assert.match(health, /HTTP 200/);
    assert.match(health, /"status":"ok"/);

    const bad = await run('/api/v1/auth/whoami', 'sck_' + '0'.repeat(24));
    assert.match(bad, /HTTP 401/);
    assert.match(bad, /AUTH_INVALID/);
  } finally {
    server.close();
  }
});
