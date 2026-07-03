/**
 * Server-side HTTP client for narrator-ai-web-backend `/narrator/*` proxy
 * routes (the implementation requirement / Backend API contract). Covers group G (subtitle tools) +
 * group E (commentary) — 12 routes that previously called the upstream
 * provider directly.
 *
 * Architecture: browser → Web SSR/API → narrator-ai-web-backend → upstream
 * OpenAPI provider. Sibling module to `narrator-metadata-backend-client.ts`
 * (read-only metadata wrappers from review). Kept separate because:
 *   - This client supports POST as well as GET (task creation lifecycle).
 *   - Per-call timeout override (search-media needs 95s vs the 60s default).
 *   - The metadata client's API shape is GET-only — extending it would mean
 *     reshaping its signature and reverbing 9 existing call sites.
 *
 * Auth (two layers, both mandatory per backend's `_serve_narrator_proxy`):
 *   1. `Authorization: Bearer <PRICING_BFF_AUTH_TOKEN>` — service identity;
 *      only the web tier holds this token. Server-only env, never exposed
 *      to the client bundle.
 *   2. `X-Web-App-Key: <users.app_key>` — end-user identity, forwarded
 *      upstream by the backend as `app-key`. Task operations run under the
 *      caller's account identity (unlike metadata routes which use a
 *      master key).
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

export class NarratorProxyError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = 'NarratorProxyError';
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

function requireBearer(): string {
  const bearer = process.env.PRICING_BFF_AUTH_TOKEN;
  if (!bearer) {
    throw new NarratorProxyError(
      'PRICING_BFF_AUTH_TOKEN env not set — web cannot authenticate to backend. ' +
        'Set this on the web fly app (matching the backend secret of the same name) ' +
        'before serving traffic.',
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
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    status = res.status;
    let parsedOk = true;
    body = await res.json().catch(() => {
      parsedOk = false;
      return {};
    });
    // Non-JSON 2xx (proxy maintenance page, HTML error, 204) must NOT be
    // returned as silent `{success:true, data:{}}` — surface as a system-
    // boundary error. For non-2xx, fall
    // through with body={} and let the status-based mapping below handle it.
    if (!parsedOk && status >= 200 && status < 300) {
      throw new NarratorProxyError(
        'Backend returned a non-JSON 2xx response.',
        502,
        'BFF_INVALID_JSON'
      );
    }
  } catch (err) {
    if (err instanceof NarratorProxyError) throw err;
    const aborted = err instanceof Error && err.name === 'AbortError';
    throw new NarratorProxyError(
      (err as Error).message ?? 'backend narrator-proxy call failed',
      aborted ? 504 : 502,
      aborted ? 'BFF_UPSTREAM_TIMEOUT' : 'BFF_UPSTREAM_UNREACHABLE'
    );
  } finally {
    clearTimeout(tid);
  }

  if (status >= 200 && status < 300) {
    // Upstream sometimes returns HTTP 200 with a business-error envelope
    // (`{code: <non-success>, message: ..., data: ...}`). The legacy
    // `requestV2` path in narrator-client.ts treated `code !== 10000 && code
    // !== 0` as a thrown error — preserve that contract so callers don't
    // misread business failures as success.
    // Skip detection when `code` is absent (some routes return `{data: ...}`
    // without the envelope) or non-numeric.
    if (typeof body === 'object' && body !== null && 'code' in body) {
      const codeRaw = (body as { code: unknown }).code;
      const codeNum =
        typeof codeRaw === 'number' ? codeRaw : parseInt(String(codeRaw), 10);
      if (!Number.isNaN(codeNum) && codeNum !== 10000 && codeNum !== 0) {
        const msg =
          (body as { message?: string }).message || `Upstream code ${codeNum}`;
        throw new NarratorProxyError(msg, status, String(codeNum));
      }
    }
    return body;
  }

  if (isErrorEnvelope(body)) {
    throw new NarratorProxyError(
      body.error.message || body.error.code || `HTTP ${status}`,
      status,
      body.error.code
    );
  }
  throw new NarratorProxyError(`Backend returned HTTP ${status}`, status, 'UNKNOWN');
}

/**
 * GET <backendPath> with optional query string. Returns the raw backend
 * response body — callers unwrap `.data` and re-wrap into `{success,data}`
 * to keep UI shape stable.
 */
export async function callNarratorProxyGet(
  appKey: string,
  backendPath: string,
  queryParams?: Record<string, string | number | undefined | null>,
  options?: { timeoutMs?: number }
): Promise<unknown> {
  const bearer = requireBearer();
  const url = new URL(backendPath, getPricingApiUrl());
  if (queryParams) {
    for (const [k, v] of Object.entries(queryParams)) {
      if (v !== undefined && v !== null && v !== '') {
        url.searchParams.set(k, String(v));
      }
    }
  }
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
    options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  );
}

/**
 * POST <backendPath> with JSON body. Body is forwarded verbatim to the
 * backend (which then forwards it verbatim to upstream).
 */
export async function callNarratorProxyPost(
  appKey: string,
  backendPath: string,
  body: Record<string, unknown>,
  options?: { timeoutMs?: number }
): Promise<unknown> {
  const bearer = requireBearer();
  const url = new URL(backendPath, getPricingApiUrl());
  return executeRequest(
    url,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bearer}`,
        'X-Web-App-Key': appKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    },
    options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  );
}
