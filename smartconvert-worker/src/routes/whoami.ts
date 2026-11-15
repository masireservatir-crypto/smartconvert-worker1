import type { AuthContext } from '../auth/hmac.ts';

/** Diagnostic endpoint: proves that signing, key lookup and replay protection work end to end. */
export function whoamiData(auth: AuthContext) {
  return { site_id: auth.siteId, domain: auth.domain, key_id: auth.keyId };
}
