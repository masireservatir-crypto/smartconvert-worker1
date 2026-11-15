# SmartConvert API (Phase 2)

Cloudflare Worker + D1. Public endpoint: `GET /api/v1/health`. Authenticated test endpoint: `GET /api/v1/auth/whoami`.

## Quick start (local)

```
npm install
npx wrangler login
npx wrangler d1 create smartconvert-db      # paste the printed database_id into wrangler.jsonc
cp .dev.vars.example .dev.vars              # Windows: copy .dev.vars.example .dev.vars
npm run gen-key                             # paste the output as MASTER_KEY in .dev.vars
npm run db:migrate:local
npm run dev                                 # http://127.0.0.1:8787/api/v1/health
```

## Authenticated test

```
npm run seed:test-site                      # prints KEY_ID and SECRET, writes .seed.sql
npx wrangler d1 execute smartconvert-db --local --file=.seed.sql
KEY_ID=... SECRET=... npm run signed-request -- GET /api/v1/auth/whoami
```

## Deploy

```
npm run db:migrate:remote
npx wrangler secret put MASTER_KEY          # paste a NEW key (npm run gen-key); never reuse the local one
npm run deploy
```

## Tests (no Cloudflare account needed)

```
npm test
```

## Request signing (SC1)

Headers: `X-SC-Key-Id`, `X-SC-Timestamp` (unix seconds, +-300 s), `X-SC-Nonce` (16-64 chars `[A-Za-z0-9_-]`), `X-SC-Signature`.

```
canonical = "SC1\n" + METHOD + "\n" + pathAndQuery + "\n" + timestamp + "\n" + nonce + "\n" + sha256hex(body)
signature = hex(HMAC-SHA256(secret, canonical))
```

Responses: `{ "ok": true, "data": ..., "request_id": "..." }` or `{ "ok": false, "error": { "code", "message" }, "request_id": "..." }`.
Error codes: AUTH_INVALID, AUTH_EXPIRED, REPLAY, QUOTA_EXCEEDED, RATE_LIMITED, VALIDATION_FAILED, AI_UNAVAILABLE, AI_BAD_OUTPUT, NOT_FOUND, METHOD_NOT_ALLOWED, PAYLOAD_TOO_LARGE, INTERNAL.
