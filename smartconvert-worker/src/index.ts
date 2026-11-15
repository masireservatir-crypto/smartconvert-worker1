import type { Env } from './env.ts';
import { ApiError } from './errors.ts';
import { okResponse, errorResponse } from './response.ts';
import { authenticate } from './auth/hmac.ts';
import { healthData } from './routes/health.ts';
import { whoamiData } from './routes/whoami.ts';

interface Ctx {
  request: Request;
  env: Env;
  requestId: string;
}

interface Route {
  method: string;
  path: string;
  handler: (c: Ctx) => Promise<Response>;
}

const routes: Route[] = [
  {
    method: 'GET',
    path: '/api/v1/health',
    handler: async (c) => okResponse(await healthData(c.env), c.requestId),
  },
  {
    method: 'GET',
    path: '/api/v1/auth/whoami',
    handler: async (c) => {
      const auth = await authenticate(c.request, c.env, 'whoami');
      return okResponse(whoamiData(auth), c.requestId);
    },
  },
];

async function route(request: Request, env: Env, requestId: string): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/$/, '') : url.pathname;

  const samePath = routes.filter((r) => r.path === path);
  if (samePath.length === 0) throw new ApiError('NOT_FOUND', 404, 'Endpoint not found.');

  const match = samePath.find((r) => r.method === request.method);
  if (!match) {
    throw new ApiError('METHOD_NOT_ALLOWED', 405, 'Method not allowed.', {
      Allow: samePath.map((r) => r.method).join(', '),
    });
  }

  return match.handler({ request, env, requestId });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const requestId = crypto.randomUUID();
    try {
      return await route(request, env, requestId);
    } catch (e) {
      if (e instanceof ApiError) return errorResponse(e, requestId);
      // Unexpected error: log details server-side, never leak them to the client.
      console.error('unhandled error', requestId, e instanceof Error ? e.stack : e);
      return errorResponse(new ApiError('INTERNAL', 500, 'Internal server error.'), requestId);
    }
  },
};
