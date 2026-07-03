import { NextResponse, type NextRequest } from 'next/server';

const REALM = 'Admin';

// Methods with no state-change semantics — no CSRF check needed. Other
// methods MUST carry an `Origin` matching the app origin (see below).
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function unauthorized(message: string): NextResponse {
  return new NextResponse(message, {
    status: 401,
    headers: {
      'WWW-Authenticate': `Basic realm="${REALM}", charset="UTF-8"`,
    },
  });
}

function decodeBasicCredentials(header: string | null): { user: string; pass: string } | null {
  if (!header) return null;
  const [scheme, encoded] = header.split(' ');
  if (scheme !== 'Basic' || !encoded) return null;
  let decoded: string;
  try {
    decoded = atob(encoded);
  } catch {
    return null;
  }
  const idx = decoded.indexOf(':');
  if (idx < 0) return null;
  return { user: decoded.slice(0, idx), pass: decoded.slice(idx + 1) };
}

export function middleware(request: NextRequest): NextResponse {
  const expectedUser = process.env.ADMIN_BASIC_USER;
  const expectedPass = process.env.ADMIN_BASIC_PASS;

  if (!expectedUser || !expectedPass) {
    return new NextResponse('Admin auth not configured', { status: 503 });
  }

  const creds = decodeBasicCredentials(request.headers.get('authorization'));
  if (!creds || creds.user !== expectedUser || creds.pass !== expectedPass) {
    return unauthorized('Authentication required');
  }

  // CSRF defense for mutating admin requests.
  //
  // Browsers cache Basic Auth credentials for the entire origin once
  // entered, so a logged-in operator visiting a malicious page can be
  // tricked into POSTing to /api/admin/* with credentials silently
  // attached. Comparing the browser-supplied `Origin` host against the
  // `Host` request header rejects every such cross-site submission —
  // including the `text/plain` form trick that bypasses CORS preflight
  // including the `text/plain` form trick that bypasses CORS preflight.
  //
  // We compare host portions (not full origins) because behind a custom
  // domain + reverse proxy `request.nextUrl.origin` does not always
  // resolve to the public-facing origin, so a strict origin equality
  // check rejects legitimate same-origin requests.
  if (!SAFE_METHODS.has(request.method)) {
    const originHeader = request.headers.get('origin');
    const host = request.headers.get('host');
    let originHost: string | null = null;
    try {
      originHost = originHeader ? new URL(originHeader).host : null;
    } catch {
      originHost = null;
    }
    if (!originHost || !host || originHost !== host) {
      return new NextResponse('Cross-origin admin request rejected', {
        status: 403,
      });
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*', '/api/admin/:path*'],
};
