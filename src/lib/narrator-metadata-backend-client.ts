/**
 * Server-side HTTP client for narrator-ai-web-backend `/narrator/*` metadata
 * wrappers (the implementation requirement / Backend API contract).
 *
 * Architecture: browser → Web SSR/API → narrator-ai-web-backend → upstream
 * OpenAPI provider. Closes the second-largest direct-upstream surface
 * in narrator-ai-web after the narrator-tasks migration; covers 8 of the
 * 9 read-only metadata routes (`template-list` separately calls the
 * existing `/pricing/movie-baokuan` endpoint).
 *
 * Auth (two layers, both mandatory per backend's `_serve_narrator_metadata`):
 *   1. `Authorization: Bearer <PRICING_BFF_AUTH_TOKEN>` — service identity;
 *      only the web tier holds this token. Protects upstream quota at the
 *      network layer.
 *   2. `X-Web-App-Key: <users.app_key>` — end-user identity; ties the
 *      request to a reseller `users` row. Without this, the Bearer token
 *      would be a free pass for any internet caller to consume upstream
 *      quota.
 *
 * Mirrors `master-task-backend-client.ts` shape: typed `NarratorMetadataError`
 * with `.status` + `.code` so the BFF route's catch block can forward the
 * right HTTP status instead of defaulting to 500.
 */

function getPricingApiUrl(): string {
  const url = process.env.NARRATOR_PRICING_API_URL;
  if (!url) {
    throw new Error(
      'NARRATOR_PRICING_API_URL environment variable is required. Set it in .env.local (local dev) or fly secrets (deploy).'
    );
  }
  return url;
}

const TIMEOUT_MS = 60_000;

export class NarratorMetadataError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = 'NarratorMetadataError';
    this.status = status;
    this.code = code;
  }
}

interface ErrorEnvelope {
  success: false;
  error: {
    code: string;
    message: string;
    retryable?: boolean;
    details?: unknown;
  };
}

function isErrorEnvelope(x: unknown): x is ErrorEnvelope {
  return (
    typeof x === 'object' &&
    x !== null &&
    (x as { success?: unknown }).success === false &&
    typeof (x as { error?: unknown }).error === 'object'
  );
}

/**
 * GET <backendPath> on the backend with Bearer + X-Web-App-Key headers.
 * Returns the upstream-style response body parsed as-is (typically
 * `{code, data}` for v1 routes or `{code, message, data: {...}}` for v2).
 *
 * The caller (route handler) is responsible for unwrapping `data` and
 * rewrapping into the `{success: true, data: ...}` envelope that the
 * UI already knows how to parse — keeps the UI shape stable across
 * the migration.
 *
 * Throws `NarratorMetadataError` with the right HTTP status on:
 *   - 401 (auth — Bearer / X-Web-App-Key issues)
 *   - 502 / 503 / 504 (upstream failure modes)
 *   - network failures (502 BFF_UPSTREAM_UNREACHABLE / 504 BFF_UPSTREAM_TIMEOUT)
 */
export async function fetchNarratorMetadata(
  appKey: string,
  backendPath: string,
  queryParams?: Record<string, string | number | undefined>
): Promise<unknown> {
  const url = new URL(backendPath, getPricingApiUrl());
  if (queryParams) {
    for (const [k, v] of Object.entries(queryParams)) {
      if (v !== undefined && v !== null && v !== '') {
        url.searchParams.set(k, String(v));
      }
    }
  }

  // Fail fast when PRICING_BFF_AUTH_TOKEN is missing. Sending an empty
  // Bearer makes every backend call return 401 even for valid app-keys
  // (review security-sensitive). Failing here is louder than letting
  // backend reject — the operator sees a config error immediately instead
  // of "401 from backend" in the toast (which looks like the user's
  // app-key is wrong).
  const bearer = process.env.PRICING_BFF_AUTH_TOKEN;
  if (!bearer) {
    throw new NarratorMetadataError(
      'PRICING_BFF_AUTH_TOKEN env not set — web cannot authenticate to backend. ' +
        'Set this on the web fly app (matching the backend secret of the same name) ' +
        'before serving traffic.',
      503,
      'BFF_AUTH_TOKEN_MISSING'
    );
  }

  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let status: number;
  let body: unknown;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${bearer}`,
        'X-Web-App-Key': appKey,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    status = res.status;
    body = await res.json().catch(() => ({}));
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    throw new NarratorMetadataError(
      (err as Error).message ?? 'backend narrator-metadata call failed',
      aborted ? 504 : 502,
      aborted ? 'BFF_UPSTREAM_TIMEOUT' : 'BFF_UPSTREAM_UNREACHABLE'
    );
  } finally {
    clearTimeout(tid);
  }

  if (status >= 200 && status < 300) return body;

  // Backend error envelope: {success: false, error: {code, message, ...}}.
  if (isErrorEnvelope(body)) {
    throw new NarratorMetadataError(
      body.error.message || body.error.code || `HTTP ${status}`,
      status,
      body.error.code
    );
  }
  throw new NarratorMetadataError(
    `Backend returned HTTP ${status}`,
    status,
    'UNKNOWN'
  );
}
