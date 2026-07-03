import { NextRequest, NextResponse } from 'next/server';

import { createCloudDriveDownloadUrl } from '@/lib/cloud-drive-backend-client';
import { querySrtRealtimeQuoteFromAPI } from '@/lib/hard-price-client';

const SRT_DOWNLOAD_TIMEOUT_MS = 60_000;

function readDownloadUrl(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.url === 'string') return record.url;
    if (typeof record.presigned_url === 'string') return record.presigned_url;
  }
  return undefined;
}

/**
 * POST /api/narrator/srt-realtime-quote
 * BFF proxy for POST /pricing/srt-realtime-quote.
 *
 * Body: { srt_file_id: string, combo_key: string }
 * Downloads the SRT file from cloud drive and forwards its content to the
 * pricing service as srt_payload. Returns the quote response verbatim.
 *
 * Error codes forwarded from the pricing service:
 *   400 SRT_INVALID           — malformed/empty SRT
 *   400 SRT_UNSUPPORTED_MODE  — combo_key not in allowlist
 *   503 PRICING_SERVICE_UNAVAILABLE — transient; client should retry
 */
export async function POST(request: NextRequest) {
  const appKey = request.headers.get('x-app-key') || '';
  if (!appKey) {
    return NextResponse.json({ success: false, error: '请先配置 App Key' }, { status: 401 });
  }

  let body: { srt_file_id?: string; combo_key?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const { srt_file_id, combo_key } = body;
  if (!srt_file_id || !combo_key) {
    return NextResponse.json(
      { success: false, error: 'srt_file_id and combo_key are required' },
      { status: 400 },
    );
  }

  // 1. Get presigned download URL for the SRT file
  let downloadUrl: string;
  try {
    const urlResult = await createCloudDriveDownloadUrl(appKey, srt_file_id);
    downloadUrl = readDownloadUrl(urlResult) || '';
    if (!downloadUrl || typeof downloadUrl !== 'string') {
      throw new Error('No download URL returned');
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '获取下载链接失败';
    return NextResponse.json({ success: false, error: msg }, { status: 502 });
  }

  // 2. Fetch SRT file content (max 1 MB — SRT files are plain text, never larger)
  const SRT_MAX_BYTES = 1 * 1024 * 1024;
  let srtPayload: string;
  let srtDownloadTimeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const controller = new AbortController();
    srtDownloadTimeout = setTimeout(() => controller.abort(), SRT_DOWNLOAD_TIMEOUT_MS);
    const fileRes = await fetch(downloadUrl, { signal: controller.signal });
    if (!fileRes.ok) throw new Error(`Download failed: ${fileRes.status}`);
    const contentLength = Number(fileRes.headers.get('content-length') ?? 0);
    if (contentLength > SRT_MAX_BYTES) {
      return NextResponse.json({ success: false, error: 'SRT 文件超过 1 MB 大小限制' }, { status: 413 });
    }
    // Stream with byte counter to guard against missing/wrong Content-Length
    const reader = fileRes.body?.getReader();
    if (!reader) throw new Error('No response body');
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > SRT_MAX_BYTES) {
        await reader.cancel();
        return NextResponse.json({ success: false, error: 'SRT 文件超过 1 MB 大小限制' }, { status: 413 });
      }
      chunks.push(value);
    }
    srtPayload = new TextDecoder().decode(
      chunks.reduce((acc, chunk) => {
        const merged = new Uint8Array(acc.byteLength + chunk.byteLength);
        merged.set(acc);
        merged.set(chunk, acc.byteLength);
        return merged;
      }, new Uint8Array(0)),
    );
    if (!srtPayload.trim()) throw new Error('SRT file is empty');
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'BFF_UPSTREAM_TIMEOUT',
            message: 'SRT 文件下载超时，请稍后重试',
            retryable: true,
          },
        },
        { status: 504 },
      );
    }
    const msg = err instanceof Error ? err.message : 'SRT 文件下载失败';
    return NextResponse.json({ success: false, error: msg }, { status: 502 });
  } finally {
    if (srtDownloadTimeout) clearTimeout(srtDownloadTimeout);
  }

  // 3. Call pricing service
  try {
    const data = await querySrtRealtimeQuoteFromAPI(combo_key, srtPayload);
    return NextResponse.json({ success: true, data });
  } catch (err: unknown) {
    const e = err as Error & { code?: string; retryable?: boolean; status?: number };
    const status = e.status ?? (e.retryable ? 503 : 400);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: e.code ?? 'PRICING_ERROR',
          message: e.message,
          retryable: Boolean(e.retryable),
        },
      },
      { status },
    );
  }
}
