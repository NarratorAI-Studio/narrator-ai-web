import { NextRequest, NextResponse } from 'next/server';
import { BackendError, dbCreateTask, dbListTasks, dbUpsertTask } from '@/lib/master-task-db';

function backendErrorResponse(e: unknown): NextResponse | null {
  if (e instanceof BackendError) {
    return NextResponse.json(
      { success: false, error: e.message, code: e.code },
      { status: e.status }
    );
  }
  return null;
}

export async function GET(req: NextRequest) {
  const appKey = req.headers.get('x-app-key');
  if (!appKey) return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  try {
    const pageRaw = sp.has('page') ? Number(sp.get('page')) : 1;
    const limitRaw = sp.has('limit') ? Number(sp.get('limit')) : 20;
    if (!Number.isInteger(pageRaw) || pageRaw < 1) {
      return NextResponse.json({ success: false, error: 'Invalid page' }, { status: 400 });
    }
    if (!Number.isInteger(limitRaw) || limitRaw < 1 || limitRaw > 9999) {
      return NextResponse.json({ success: false, error: 'Invalid limit (1–9999)' }, { status: 400 });
    }
    const result = await dbListTasks({
      app_key: appKey,
      status: sp.get('status') ?? undefined,
      page: pageRaw,
      limit: limitRaw,
    });
    return NextResponse.json({ success: true, data: result });
  } catch (e) {
    return backendErrorResponse(e) ?? NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const appKey = req.headers.get('x-app-key');
  if (!appKey) return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 });

  try {
    const body = await req.json();
    // Body with narrator_task_id → migration upsert (preserves original ID/timestamps)
    if (body.narrator_task_id) {
      // Enforce header appKey — ignore whatever app_key the body claims
      body.app_key = appKey;
      // dbUpsertTask uses SELECT FOR UPDATE inside a transaction to atomically
      // reject cross-tenant overwrites; returns null if app_key mismatch.
      const task = await dbUpsertTask(body);
      if (!task) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
      return NextResponse.json({ success: true, data: task });
    }
    body.app_key = appKey;
    const task = await dbCreateTask(body);
    return NextResponse.json({ success: true, data: task });
  } catch (e) {
    return backendErrorResponse(e) ?? NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}
