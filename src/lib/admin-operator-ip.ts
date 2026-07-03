/**
 * Resolve the real admin operator's IP from an incoming Next.js
 * request, ahead of calling backend `/admin/*` endpoints.
 *
 * Why a helper: backend  records `actor_ip` in its audit log
 * from a single header — `X-Admin-Operator-IP` — that this BFF
 * populates. The audit value is only as trustworthy as the source
 * this function picks.
 *
 * Trust model (the implementation requirement, security hardening):
 *
 *  - `Fly-Client-IP` is the **only** header we read. fly's edge
 *    proxy unconditionally overwrites this on every request with
 *    the IP that opened the TLS connection, so an authenticated
 *    admin caller cannot spoof it from the browser side.
 *
 *  - We deliberately do NOT read `X-Forwarded-For`. fly appends to
 *    XFF rather than clearing it, so the first token is whatever
 *    the client sent. Taking that value lets a malicious operator
 *    write an arbitrary IP into the audit log — defeating the
 *    point of recording it.
 *
 *  - We deliberately do NOT read `X-Real-IP` either. fly does not
 *    set or overwrite it, so it is fully client-controlled.
 *
 *  - When `Fly-Client-IP` is absent (e.g. local dev outside fly,
 *    or upstream proxy stripped it) we return `null`. Backend
 *    then records `actor_ip="unknown"` rather than a spoofable
 *    forwarded value — explicit gap is better than silent forgery.
 */
import type { NextRequest } from 'next/server';

export function resolveAdminOperatorIp(request: NextRequest): string | null {
  const flyClientIp = request.headers.get('fly-client-ip');
  if (flyClientIp && flyClientIp.trim()) {
    return flyClientIp.trim();
  }
  return null;
}
