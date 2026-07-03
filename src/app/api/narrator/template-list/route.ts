import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import {
  NarratorMetadataError,
  fetchNarratorMetadata,
} from '@/lib/narrator-metadata-backend-client';

const CACHE_TTL_MS = 120_000;

type TemplateListPayload = {
  success: true;
  data: unknown;
};

const responseCache = new Map<string, { expiresAt: number; payload: TemplateListPayload }>();
const inFlight = new Map<string, Promise<TemplateListPayload>>();

function hashAppKey(appKey: string) {
  return createHash('sha256').update(appKey).digest('hex').slice(0, 16);
}

function json(payload: TemplateListPayload, cacheState: 'HIT' | 'MISS') {
  return NextResponse.json(payload, { headers: { 'X-BFF-Cache': cacheState } });
}

async function loadTemplateList(
  appKey: string,
  params: {
    platform_id?: string;
    category_id?: string;
    name?: string;
    page: string;
    size: string;
  }
): Promise<TemplateListPayload> {
  const upstream = (await fetchNarratorMetadata(
    appKey,
    '/pricing/movie-baokuan',
    params
  )) as { data?: unknown };

  return { success: true, data: upstream.data ?? upstream };
}

export async function GET(request: NextRequest) {
  const appKey = request.headers.get('x-app-key') || '';
  if (!appKey) {
    return NextResponse.json(
      { success: false, error: '\u8bf7\u5148\u914d\u7f6e App Key' },
      { status: 401 }
    );
  }

  const sp = request.nextUrl.searchParams;
  const params = {
    platform_id: sp.get('platform_id') ?? undefined,
    category_id: sp.get('category_id') ?? undefined,
    name: sp.get('name') ?? undefined,
    page: sp.get('page') ?? '1',
    size: sp.get('size') ?? '21',
  };
  const cacheKey = JSON.stringify({ app: hashAppKey(appKey), ...params });

  const cached = responseCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return json(cached.payload, 'HIT');
  }

  let promise = inFlight.get(cacheKey);
  if (!promise) {
    promise = loadTemplateList(appKey, params);
    inFlight.set(cacheKey, promise);
  }

  try {
    const payload = await promise;
    responseCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, payload });
    return json(payload, 'MISS');
  } catch (e) {
    if (e instanceof NarratorMetadataError) {
      return NextResponse.json(
        { success: false, error: e.message, code: e.code },
        { status: e.status }
      );
    }
    return NextResponse.json(
      { success: false, error: (e as Error).message || '\u83b7\u53d6\u6a21\u677f\u5217\u8868\u5931\u8d25' },
      { status: 500 }
    );
  } finally {
    inFlight.delete(cacheKey);
  }
}
