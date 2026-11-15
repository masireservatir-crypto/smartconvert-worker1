// Sends one signed request to the API and prints the response.
// Usage (macOS/Linux):  KEY_ID=sck_... SECRET=... npm run signed-request -- GET /api/v1/auth/whoami [baseUrl]
// Usage (PowerShell):   $env:KEY_ID="sck_..."; $env:SECRET="..."; npm run signed-request -- GET /api/v1/auth/whoami
import { signRequest } from '../src/auth/sign.ts';

const [method = 'GET', path = '/api/v1/auth/whoami', base = 'http://127.0.0.1:8787'] = process.argv.slice(2);
const keyId = process.env.KEY_ID;
const secret = process.env.SECRET;

if (!keyId || !secret) {
  console.error('Set KEY_ID and SECRET environment variables first (see npm run seed:test-site).');
  process.exit(1);
}

const headers = await signRequest({ keyId, secret, method, pathAndQuery: path });
const res = await fetch(base + path, { method, headers });
console.log('HTTP', res.status);
console.log(await res.text());
