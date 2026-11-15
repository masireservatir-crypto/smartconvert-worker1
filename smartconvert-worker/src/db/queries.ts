export interface CredentialRow {
  key_id: string;
  secret_enc: string;
  credential_status: string;
  site_id: string;
  domain: string;
  user_id: string;
  site_status: string;
}

export async function findCredential(db: D1Database, keyId: string): Promise<CredentialRow | null> {
  return db
    .prepare(
      `SELECT c.id AS key_id, c.secret_enc, c.status AS credential_status,
              s.id AS site_id, s.domain, s.user_id, s.status AS site_status
         FROM site_credentials c
         JOIN sites s ON s.id = c.site_id
        WHERE c.id = ?`,
    )
    .bind(keyId)
    .first<CredentialRow>();
}

/**
 * Records a nonce for a site. Returns false if it was already used (replay).
 * The UNIQUE(site_id, nonce) constraint makes this atomic.
 */
export async function claimNonce(db: D1Database, siteId: string, nonce: string, kind: string): Promise<boolean> {
  const res = await db
    .prepare(
      `INSERT INTO ai_requests (id, site_id, nonce, kind, status, created_at)
       VALUES (?, ?, ?, ?, 'received', ?)
       ON CONFLICT (site_id, nonce) DO NOTHING`,
    )
    .bind(crypto.randomUUID(), siteId, nonce, kind, Math.floor(Date.now() / 1000))
    .run();
  return (res.meta?.changes ?? 0) > 0;
}
