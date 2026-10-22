export type ApiErrorKind = 'unreachable' | 'not_found' | 'rate_limited' | 'http';

/** Failure talking to the DevDigest HTTP API; mapped to an actionable text by the MCP adapter. */
export class ApiError extends Error {
  constructor(
    readonly kind: ApiErrorKind,
    readonly url: string,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
