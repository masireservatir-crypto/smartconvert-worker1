import { ApiError } from './errors.ts';

const BASE_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

export function okResponse(data: unknown, requestId: string, status = 200): Response {
  return new Response(JSON.stringify({ ok: true, data, request_id: requestId }), {
    status,
    headers: { ...BASE_HEADERS, 'X-Request-Id': requestId },
  });
}

export function errorResponse(err: ApiError, requestId: string): Response {
  return new Response(
    JSON.stringify({ ok: false, error: { code: err.code, message: err.message }, request_id: requestId }),
    { status: err.status, headers: { ...BASE_HEADERS, ...err.headers, 'X-Request-Id': requestId } },
  );
}
