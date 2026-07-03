import { NextRequest, NextResponse } from 'next/server';
import { resolveAdminOperatorIp } from '@/lib/admin-operator-ip';
import {
  AdminUsersClientError,
  createAdminUser,
  type AdminCreateUserBody,
} from '@/lib/admin-users-backend-client';

/**
 * POST /api/admin/users
 * Operator-only user provisioning. Forwards to backend's
 * `POST /admin/users`. The `/admin/*` and `/api/admin/*` namespaces are
 * gated by HTTP Basic Auth at `src/middleware.ts`, so by the time this
 * handler runs the caller is already authenticated as an operator.
 */
export async function POST(request: NextRequest) {
  let body: AdminCreateUserBody;
  try {
    body = (await request.json()) as AdminCreateUserBody;
  } catch {
    return NextResponse.json(
      { success: false, error: 'Request body must be valid JSON.' },
      { status: 400 }
    );
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json(
      { success: false, error: 'Request body must be a JSON object.' },
      { status: 400 }
    );
  }

  try {
    const result = await createAdminUser(body, resolveAdminOperatorIp(request));
    return NextResponse.json({ success: true, data: result }, { status: 201 });
  } catch (e) {
    if (e instanceof AdminUsersClientError) {
      return NextResponse.json(
        { success: false, error: e.message, code: e.code, details: e.details },
        { status: e.status }
      );
    }
    return NextResponse.json(
      { success: false, error: (e as Error).message || '创建用户失败' },
      { status: 500 }
    );
  }
}
