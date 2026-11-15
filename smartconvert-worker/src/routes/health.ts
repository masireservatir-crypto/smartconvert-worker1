import type { Env } from '../env.ts';
import { ApiError } from '../errors.ts';

export async function healthData(env: Env) {
  let migrated = false;
  try {
    const row = await env.DB
      .prepare(
        `SELECT COUNT(*) AS n FROM sqlite_master
          WHERE type = 'table' AND name IN ('users', 'sites', 'site_credentials', 'ai_requests')`,
      )
      .first<{ n: number }>();
    migrated = row?.n === 4;
  } catch (e) {
    console.error('health: database error', e instanceof Error ? e.message : e);
    throw new ApiError('INTERNAL', 503, 'Database is not reachable.');
  }

  return {
    status: migrated ? 'ok' : 'needs_migration',
    service: 'smartconvert-api',
    version: env.APP_VERSION ?? 'dev',
    environment: env.ENVIRONMENT ?? 'unknown',
    time: new Date().toISOString(),
    database: { connected: true, migrated },
    config: { master_key_configured: Boolean(env.MASTER_KEY) },
  };
}
