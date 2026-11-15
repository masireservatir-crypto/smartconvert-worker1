export interface Env {
  DB: D1Database;
  /** 32 random bytes, base64. Secret. Encrypts site credentials at rest. */
  MASTER_KEY?: string;
  APP_VERSION?: string;
  ENVIRONMENT?: string;
}
