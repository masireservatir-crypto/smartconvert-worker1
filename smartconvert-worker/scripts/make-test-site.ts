// Creates SQL that inserts a TEST user, site and credential into the local database.
// Usage:  npm run seed:test-site
// Then:   npx wrangler d1 execute smartconvert-db --local --file=.seed.sql
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { encryptSecret, randomKeyId, randomSecret } from '../src/util/crypto.ts';

function loadMasterKey(): string {
  if (process.env.MASTER_KEY) return process.env.MASTER_KEY;
  if (existsSync('.dev.vars')) {
    const m = readFileSync('.dev.vars', 'utf8').match(/^MASTER_KEY=(.+)$/m);
    if (m) return m[1].trim();
  }
  console.error('MASTER_KEY not found. Create .dev.vars first (copy .dev.vars.example and run: npm run gen-key).');
  process.exit(1);
}

const masterKey = loadMasterKey();
const keyId = randomKeyId();
const secret = randomSecret();
const secretEnc = await encryptSecret(masterKey, secret, keyId);
const now = Math.floor(Date.now() / 1000);

const sql = `
INSERT OR IGNORE INTO users (id, email, status, created_at) VALUES ('usr_test', 'test@example.com', 'active', ${now});
INSERT OR IGNORE INTO sites (id, user_id, domain, platform, status, created_at) VALUES ('site_test', 'usr_test', 'test.local', 'wordpress', 'active', ${now});
INSERT INTO site_credentials (id, site_id, secret_enc, status, created_at) VALUES ('${keyId}', 'site_test', '${secretEnc}', 'active', ${now});
`;

writeFileSync('.seed.sql', sql);
console.log('Wrote .seed.sql');
console.log('');
console.log('KEY_ID=' + keyId);
console.log('SECRET=' + secret);
console.log('');
console.log('Keep these two values: they are used by "npm run signed-request". This is a TEST credential only.');
