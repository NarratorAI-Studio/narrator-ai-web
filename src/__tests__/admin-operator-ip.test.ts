import { describe, it, expect } from 'vitest';
import { resolveAdminOperatorIp } from '@/lib/admin-operator-ip';
import type { NextRequest } from 'next/server';

function reqWith(headers: Record<string, string>): NextRequest {
  return {
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? null,
    },
  } as unknown as NextRequest;
}

describe('resolveAdminOperatorIp', () => {
  it('returns the fly-client-ip header when set', () => {
    expect(
      resolveAdminOperatorIp(reqWith({ 'fly-client-ip': '198.51.100.42' }))
    ).toBe('198.51.100.42');
  });

  it('trims whitespace from the fly-client-ip value', () => {
    expect(
      resolveAdminOperatorIp(reqWith({ 'fly-client-ip': '  198.51.100.42  ' }))
    ).toBe('198.51.100.42');
  });

  it('returns null when no fly-client-ip is present', () => {
    expect(resolveAdminOperatorIp(reqWith({}))).toBeNull();
  });

  it('returns null when fly-client-ip is whitespace-only', () => {
    expect(
      resolveAdminOperatorIp(reqWith({ 'fly-client-ip': '   ' }))
    ).toBeNull();
  });

  // Security regression coverage (security hardening, security-sensitive): even when
  // `x-forwarded-for` / `x-real-ip` are present, we must NOT fall
  // back to them — they are client-supplied and would let an
  // authenticated admin write a spoofed IP into the backend audit
  // log. The only trusted source is `Fly-Client-IP`.
  it('does not fall back to x-forwarded-for', () => {
    expect(
      resolveAdminOperatorIp(
        reqWith({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' })
      )
    ).toBeNull();
  });

  it('does not fall back to x-real-ip', () => {
    expect(
      resolveAdminOperatorIp(reqWith({ 'x-real-ip': '192.0.2.55' }))
    ).toBeNull();
  });

  it('ignores spoofed XFF / x-real-ip when fly-client-ip is also set', () => {
    // Confirms fly-client-ip wins over the spoofable sources. The
    // value used is fly-client-ip, never the attacker-controlled
    // headers, even if they were present.
    const ip = resolveAdminOperatorIp(
      reqWith({
        'fly-client-ip': '198.51.100.42',
        'x-forwarded-for': '203.0.113.7, 10.0.0.1',
        'x-real-ip': '192.0.2.55',
      })
    );
    expect(ip).toBe('198.51.100.42');
  });
});
