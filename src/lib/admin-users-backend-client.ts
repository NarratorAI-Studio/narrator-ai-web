/**
 * Server-side HTTP client for narrator-ai-web-backend's
 * `POST /admin/users` route (operator-only user provisioning).
 *
 * Auth: `Authorization: Bearer <PRICING_BFF_AUTH_TOKEN>` — the same
 * service-identity Bearer used by other admin/BFF→backend calls.
 * The admin operator's identity is gated upstream by HTTP Basic Auth
 * at the Next.js middleware layer (`src/middleware.ts`); no additional
 * `X-Web-App-Key` is required here because admin user-creation has no
 * "acting user" semantics.
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

export interface AdminCreateUserBody {
  balance?: string | number | null;
  nickname?: string | null;
  mobile?: string | null;
  email?: string | null;
  company_name?: string | null;
}

// PATCH /admin/users/<app_key> partial-update body — `balance` is
// non-nullable on the table, so unlike Create we forbid null; profile
// fields explicitly accept null to clear the column.
export interface AdminUpdateUserBody {
  balance?: string | number;
  nickname?: string | null;
  mobile?: string | null;
  email?: string | null;
  company_name?: string | null;
}

export interface AdminUserRecord {
  app_key: string;
  balance: string;
  nickname: string | null;
  mobile: string | null;
  email: string | null;
  company_name: string | null;
  created_at: string;
}

export class AdminUsersClientError extends Error {
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
    this.name = 'AdminUsersClientError';
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
    throw new AdminUsersClientError(
      'PRICING_BFF_AUTH_TOKEN env not set — web cannot authenticate to backend.',
      503,
      'BFF_AUTH_TOKEN_MISSING'
    );
  }
  return bearer;
}

// Audit : when the BFF route can resolve the real operator IP
// from incoming headers, it passes it here. Backend records the value
// as `actor_ip` in its `admin.users.*` audit log. Empty / null is left
// unset so backend can record `"unknown"` rather than a forged value.
function operatorIpHeader(
  operatorIp: string | null | undefined
): Record<string, string> {
  if (!operatorIp) return {};
  return { 'X-Admin-Operator-IP': operatorIp };
}

export async function createAdminUser(
  body: AdminCreateUserBody,
  operatorIp?: string | null
): Promise<{ app_key: string }> {
  const bearer = requireBearer();
  const url = new URL('/admin/users', getPricingApiUrl());

  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  let status: number;
  let payload: unknown;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bearer}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...operatorIpHeader(operatorIp),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    status = res.status;
    payload = await res.json().catch(() => ({}));
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    throw new AdminUsersClientError(
      (err as Error).message ?? 'backend admin/users call failed',
      aborted ? 504 : 502,
      aborted ? 'BFF_UPSTREAM_TIMEOUT' : 'BFF_UPSTREAM_UNREACHABLE'
    );
  } finally {
    clearTimeout(tid);
  }

  if (status >= 200 && status < 300) {
    const data = (payload as { data?: { app_key?: unknown } }).data;
    const appKey = data?.app_key;
    if (typeof appKey !== 'string' || !appKey) {
      throw new AdminUsersClientError(
        'Backend returned success without an app_key.',
        502,
        'BFF_INVALID_RESPONSE'
      );
    }
    return { app_key: appKey };
  }

  if (isErrorEnvelope(payload)) {
    throw new AdminUsersClientError(
      payload.error.message || payload.error.code || `HTTP ${status}`,
      status,
      payload.error.code,
      payload.error.details ?? {}
    );
  }
  throw new AdminUsersClientError(
    `Backend returned HTTP ${status}`,
    status,
    'UNKNOWN'
  );
}

function throwFromPayload(status: number, payload: unknown): never {
  if (isErrorEnvelope(payload)) {
    throw new AdminUsersClientError(
      payload.error.message || payload.error.code || `HTTP ${status}`,
      status,
      payload.error.code,
      payload.error.details ?? {}
    );
  }
  throw new AdminUsersClientError(
    `Backend returned HTTP ${status}`,
    status,
    'UNKNOWN'
  );
}

function isAdminUserRecord(x: unknown): x is AdminUserRecord {
  if (typeof x !== 'object' || x === null) return false;
  const r = x as Record<string, unknown>;
  return (
    typeof r.app_key === 'string' &&
    typeof r.balance === 'string' &&
    (r.nickname === null || typeof r.nickname === 'string') &&
    (r.mobile === null || typeof r.mobile === 'string') &&
    (r.email === null || typeof r.email === 'string') &&
    (r.company_name === null || typeof r.company_name === 'string')
  );
}

async function callBackend(
  method: 'GET' | 'PATCH',
  appKey: string,
  body?: AdminUpdateUserBody,
  operatorIp?: string | null
): Promise<AdminUserRecord> {
  const bearer = requireBearer();
  const url = new URL(
    `/admin/users/${encodeURIComponent(appKey)}`,
    getPricingApiUrl()
  );

  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  let status: number;
  let payload: unknown;
  try {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${bearer}`,
        ...(method === 'PATCH'
          ? { 'Content-Type': 'application/json' }
          : {}),
        Accept: 'application/json',
        ...operatorIpHeader(operatorIp),
      },
      body: method === 'PATCH' ? JSON.stringify(body ?? {}) : undefined,
      signal: controller.signal,
    });
    status = res.status;
    payload = await res.json().catch(() => ({}));
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    throw new AdminUsersClientError(
      (err as Error).message ?? `backend admin/users ${method} call failed`,
      aborted ? 504 : 502,
      aborted ? 'BFF_UPSTREAM_TIMEOUT' : 'BFF_UPSTREAM_UNREACHABLE'
    );
  } finally {
    clearTimeout(tid);
  }

  if (status >= 200 && status < 300) {
    const data = (payload as { data?: unknown }).data;
    if (!isAdminUserRecord(data)) {
      throw new AdminUsersClientError(
        'Backend returned success without a valid user record.',
        502,
        'BFF_INVALID_RESPONSE'
      );
    }
    return data;
  }

  throwFromPayload(status, payload);
}

export function getAdminUserByAppKey(
  appKey: string,
  operatorIp?: string | null
): Promise<AdminUserRecord> {
  return callBackend('GET', appKey, undefined, operatorIp);
}

export function updateAdminUser(
  appKey: string,
  body: AdminUpdateUserBody,
  operatorIp?: string | null
): Promise<AdminUserRecord> {
  return callBackend('PATCH', appKey, body, operatorIp);
}
