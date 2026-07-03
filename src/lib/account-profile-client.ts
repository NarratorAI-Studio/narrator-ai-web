/**
 * Server-side HTTP client for narrator-ai-web-backend `GET /account/me`
 * (issue Backend API contract).
 *
 * Architecture invariant: browser → Web SSR/API → narrator-ai-web-backend →
 * reseller `users` table. This is the first BFF route on the new reseller
 * architecture for end-user identity; legacy direct-to-upstream
 * `/api/account/balance` calls the configured upstream provider and stays
 * untouched in this round (incremental migration).
 *
 * Auth: forwards the caller's `x-app-key` header verbatim as
 * `X-Web-App-Key` — no Bearer token; `/account/me` is a per-user read
 * against the reseller's own users table, not an upstream-quota proxy.
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

export interface AccountProfileData {
  user_id: number;
  nickname: string | null;
  mobile: string | null;
  email: string | null;
  balance: string;
  company_name: string | null;
}

export interface AccountProfileResponse {
  success: true;
  data: AccountProfileData;
}

export interface AccountProfileErrorBody {
  success: false;
  error: {
    code: string;
    message: string;
    retryable?: boolean;
    details?: unknown;
  };
}

export interface AccountProfileFetchResult {
  status: number;
  body: AccountProfileResponse | AccountProfileErrorBody;
}

export async function fetchAccountProfile(
  webAppKey: string
): Promise<AccountProfileFetchResult> {
  const url = `${getPricingApiUrl()}/account/me`;
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Web-App-Key': webAppKey,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    const body = (await res.json().catch(() => ({}))) as
      | AccountProfileResponse
      | AccountProfileErrorBody;
    return { status: res.status, body };
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    return {
      status: aborted ? 504 : 502,
      body: {
        success: false,
        error: {
          code: aborted ? 'BFF_UPSTREAM_TIMEOUT' : 'BFF_UPSTREAM_UNREACHABLE',
          message: (err as Error).message ?? 'backend account call failed',
          retryable: true,
        },
      },
    };
  } finally {
    clearTimeout(tid);
  }
}
