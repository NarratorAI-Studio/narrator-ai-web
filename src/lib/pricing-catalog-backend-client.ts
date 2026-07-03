/**
 * Server-side HTTP client for narrator-ai-web-backend's hard-price v2
 * catalog endpoints (regression coverage / Backend API contract + regression coverage).
 *
 * Three calls cover the admin operator UX:
 *   - GET    /pricing/catalog/<id>/tiers       — current effective tier list
 *   - PUT    /pricing/catalog/<id>/tiers       — atomic batch upsert
 *   - GET    /pricing/catalog/<id>/history     — full per-tier version trail
 *
 * Auth (mirrors narrator-proxy-backend-client.ts; both layers mandatory):
 *   1. `Authorization: Bearer <PRICING_BFF_AUTH_TOKEN>` — service identity,
 *      server-only env, never exposed to the client bundle.
 *   2. `X-Web-App-Key: <users.app_key>` — operator identity; backend
 *      resolves to `users.id` for the `updated_by` column on PUT.
 *
 * Kept separate from narrator-proxy client because (a) admin paths must
 * not share import surface with C-end-facing routes, (b) PUT semantics
 * don't fit the proxy's GET/POST shape, and (c) the catalog response
 * envelope is bespoke (not the upstream-proxy `{code, message, data}`).
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

const DEFAULT_TIMEOUT_MS = 60_000;

export class CatalogClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;
  constructor(
    message: string,
    status: number,
    code: string,
    details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'CatalogClientError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

interface ErrorEnvelope {
  success: false;
  error: {
    code: string;
    message: string;
    retryable?: boolean;
    details?: Record<string, unknown>;
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

function requireBearer(): string {
  const bearer = process.env.PRICING_BFF_AUTH_TOKEN;
  if (!bearer) {
    throw new CatalogClientError(
      'PRICING_BFF_AUTH_TOKEN env not set — web cannot authenticate to backend.',
      503,
      'BFF_AUTH_TOKEN_MISSING'
    );
  }
  return bearer;
}

async function executeRequest(
  url: URL,
  init: RequestInit,
  timeoutMs: number
): Promise<unknown> {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), timeoutMs);

  let status: number;
  let body: unknown;
  let parsedOk = true;
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    status = res.status;
    body = await res.json().catch(() => {
      parsedOk = false;
      return {};
    });
    if (!parsedOk && status >= 200 && status < 300) {
      throw new CatalogClientError(
        'Backend returned a non-JSON 2xx response.',
        502,
        'BFF_INVALID_JSON'
      );
    }
  } catch (err) {
    if (err instanceof CatalogClientError) throw err;
    const aborted = err instanceof Error && err.name === 'AbortError';
    throw new CatalogClientError(
      (err as Error).message ?? 'backend catalog call failed',
      aborted ? 504 : 502,
      aborted ? 'BFF_UPSTREAM_TIMEOUT' : 'BFF_UPSTREAM_UNREACHABLE'
    );
  } finally {
    clearTimeout(tid);
  }

  if (status >= 200 && status < 300) return body;

  if (isErrorEnvelope(body)) {
    throw new CatalogClientError(
      body.error.message || body.error.code || `HTTP ${status}`,
      status,
      body.error.code,
      body.error.details ?? {}
    );
  }
  throw new CatalogClientError(`Backend returned HTTP ${status}`, status, 'UNKNOWN');
}

/**
 * GET /pricing/catalog/<templateId>/tiers — current effective tier list.
 */
export async function fetchCatalogTiers(
  appKey: string,
  templateId: string
): Promise<unknown> {
  const bearer = requireBearer();
  const url = new URL(
    `/pricing/catalog/${encodeURIComponent(templateId)}/tiers`,
    getPricingApiUrl()
  );
  return executeRequest(
    url,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${bearer}`,
        'X-Web-App-Key': appKey,
        Accept: 'application/json',
      },
    },
    DEFAULT_TIMEOUT_MS
  );
}

/**
 * PUT /pricing/catalog/<templateId>/tiers — atomic batch upsert.
 * `body` is forwarded verbatim; backend validates Pro≥Flash, §4.1
 * surcharge invariant, axis pairing, rounding-rule whitelist, etc.
 */
export async function upsertCatalogTiers(
  appKey: string,
  templateId: string,
  body: { tiers: unknown[] }
): Promise<unknown> {
  const bearer = requireBearer();
  const url = new URL(
    `/pricing/catalog/${encodeURIComponent(templateId)}/tiers`,
    getPricingApiUrl()
  );
  return executeRequest(
    url,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${bearer}`,
        'X-Web-App-Key': appKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    },
    DEFAULT_TIMEOUT_MS
  );
}

/**
 * GET /pricing/catalog/<templateId>/history — full per-tier version trail.
 */
export async function fetchCatalogHistory(
  appKey: string,
  templateId: string
): Promise<unknown> {
  const bearer = requireBearer();
  const url = new URL(
    `/pricing/catalog/${encodeURIComponent(templateId)}/history`,
    getPricingApiUrl()
  );
  return executeRequest(
    url,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${bearer}`,
        'X-Web-App-Key': appKey,
        Accept: 'application/json',
      },
    },
    DEFAULT_TIMEOUT_MS
  );
}
