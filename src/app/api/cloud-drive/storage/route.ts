import { NextRequest, NextResponse } from 'next/server';
import { CloudDriveBackendError, getCloudDriveStorage } from '@/lib/cloud-drive-backend-client';

function finiteNumber(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeStorage(data: unknown) {
  const raw = data && typeof data === 'object' ? data as Record<string, unknown> : {};
  const usedSize = finiteNumber(raw.used_size ?? raw.used_bytes ?? raw.usage);
  const maxSize = finiteNumber(raw.max_size ?? raw.quota_bytes ?? raw.quota);
  const fileCount = finiteNumber(raw.file_count ?? raw.files_count);
  const rawPercent = raw.usage_percentage;
  const usagePercentage = Number.isFinite(Number(rawPercent))
    ? Number(rawPercent)
    : maxSize > 0
      ? (usedSize / maxSize) * 100
      : 0;

  return {
    ...raw,
    used_size: usedSize,
    max_size: maxSize,
    file_count: fileCount,
    usage_percentage: usagePercentage,
  };
}

export async function GET(request: NextRequest) {
  const appKey = request.headers.get('x-app-key') || '';
  if (!appKey) {
    return NextResponse.json({ success: false, error: '请先配置 App Key' }, { status: 401 });
  }

  try {
    const data = await getCloudDriveStorage(appKey);
    return NextResponse.json({ success: true, data: normalizeStorage(data) });
  } catch (error) {
    const status = error instanceof CloudDriveBackendError ? error.status : 500;
    const code = error instanceof CloudDriveBackendError ? error.code : undefined;
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '获取存储信息失败', code },
      { status }
    );
  }
}
