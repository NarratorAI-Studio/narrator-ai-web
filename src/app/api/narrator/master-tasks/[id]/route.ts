import { NextRequest, NextResponse } from 'next/server';
import { BackendError, dbGetTask, dbReplaceTask } from '@/lib/master-task-db';

function backendErrorResponse(e: unknown): NextResponse | null {
  if (e instanceof BackendError) {
    return NextResponse.json(
      { success: false, error: e.message, code: e.code },
      { status: e.status }
    );
  }
  return null;
}

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Ctx) {
  const appKey = req.headers.get('x-app-key');
  if (!appKey) return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 });

  const { id } = await params;
  try {
    const task = await dbGetTask(id, appKey);
    if (!task) return NextResponse.json({ success: false, error: 'NOT_FOUND' }, { status: 404 });
    return NextResponse.json({ success: true, data: task });
  } catch (e) {
    return backendErrorResponse(e) ?? NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: Ctx) {
  const appKey = req.headers.get('x-app-key');
  if (!appKey) return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 });

  const { id } = await params;
  try {
    const body = await req.json();
    if (body.narrator_task_id !== id) {
      return NextResponse.json({ success: false, error: 'narrator_task_id mismatch' }, { status: 400 });
    }
    body.app_key = appKey;
    const task = await dbReplaceTask(id, body, appKey);
    if (!task) return NextResponse.json({ success: false, error: 'NOT_FOUND' }, { status: 404 });
    return NextResponse.json({ success: true, data: task });
  } catch (e) {
    return backendErrorResponse(e) ?? NextResponse.json({ success: false, error: String(e) }, { status: 500 });
  }
}
