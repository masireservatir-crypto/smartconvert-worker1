export type ErrorCode =
  | 'AUTH_INVALID'
  | 'AUTH_EXPIRED'
  | 'REPLAY'
  | 'QUOTA_EXCEEDED'
  | 'RATE_LIMITED'
  | 'VALIDATION_FAILED'
  | 'AI_UNAVAILABLE'
  | 'AI_BAD_OUTPUT'
  | 'NOT_FOUND'
  | 'METHOD_NOT_ALLOWED'
  | 'PAYLOAD_TOO_LARGE'
  | 'INTERNAL';

/** An error whose message is safe to show to API clients. */
export class ApiError extends Error {
  code: ErrorCode;
  status: number;
  headers: Record<string, string>;

  constructor(code: ErrorCode, status: number, message: string, headers: Record<string, string> = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.headers = headers;
  }
}
