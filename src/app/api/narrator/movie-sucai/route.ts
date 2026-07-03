import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import {
  NarratorProxyError,
  callNarratorProxyGet,
} from '@/lib/narrator-proxy-backend-client';

const DEFAULT_PAGE_SIZE = 21;
const MAX_PAGE_SIZE = 50;
const CACHE_TTL_MS = 60_000;
const MAX_FILL_PAGES = 2;

type MovieSucaiItem = {
  video_file_id?: string;
  srt_file_id?: string;
  name?: string;
  [k: string]: unknown;
};

interface BackendMovieSucai {
  data?: {
    items?: MovieSucaiItem[];
    total?: number;
  };
}

interface MovieSucaiPayload {
  success: true;
  data: {
    items: MovieSucaiItem[];
    total: number;
  };
}

const responseCache = new Map<string, { expiresAt: number; payload: MovieSucaiPayload }>();
const inFlight = new Map<string, Promise<MovieSucaiPayload>>();

function hashAppKey(appKey: string) {
  return createHash('sha256').update(appKey).digest('hex').slice(0, 16);
}

function toPositiveInt(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

const CUSTOM_MOVIE_NAME = String.fromCharCode(33258, 23450, 20041);

const isValidMovie = (movie: MovieSucaiItem) =>
  !!movie.video_file_id &&
  !!movie.srt_file_id &&
  movie.name !== CUSTOM_MOVIE_NAME &&
  movie.video_file_id !== 'else' &&
  movie.srt_file_id !== 'else';

async function fetchMoviePage(
  appKey: string,
  page: number,
  pageSize: number,
  name: string
) {
  return (await callNarratorProxyGet(appKey, '/narrator/movie-sucai', {
    page,
    page_size: pageSize,
    name: name || undefined,
  })) as BackendMovieSucai;
}

async function loadMovieSucaiPayload(
  appKey: string,
  page: number,
  pageSize: number,
  name: string
): Promise<MovieSucaiPayload> {
  const collected: MovieSucaiItem[] = [];
  let rawTotal = 0;
  let totalFiltered = 0;

  for (let offset = 0; offset < MAX_FILL_PAGES && collected.length < pageSize; offset++) {
    const result = await fetchMoviePage(appKey, page + offset, pageSize, name);
    const items = result.data?.items || [];
    rawTotal = result.data?.total ?? rawTotal;
    if (items.length === 0) break;

    const validItems = items.filter(isValidMovie);
    totalFiltered += items.length - validItems.length;
    collected.push(...validItems);

    if (validItems.length === items.length || page * pageSize >= rawTotal) break;
  }

  return {
    success: true,
    data: {
      items: collected.slice(0, pageSize),
      total: Math.max(0, rawTotal - totalFiltered),
    },
  };
}

function json(payload: MovieSucaiPayload, cacheState: 'HIT' | 'MISS') {
  return NextResponse.json(payload, { headers: { 'X-BFF-Cache': cacheState } });
}

export async function GET(request: NextRequest) {
  const appKey = request.headers.get('x-app-key') || '';
  if (!appKey) {
    return NextResponse.json(
      { success: false, error: '\u8bf7\u5148\u914d\u7f6e App Key' },
      { status: 401 }
    );
  }

  const { searchParams } = new URL(request.url);
  const page = toPositiveInt(searchParams.get('page'), 1);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    toPositiveInt(searchParams.get('page_size'), DEFAULT_PAGE_SIZE)
  );
  const name = searchParams.get('name') || '';
  const cacheKey = JSON.stringify({ app: hashAppKey(appKey), page, pageSize, name });

  const cached = responseCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return json(cached.payload, 'HIT');
  }

  let promise = inFlight.get(cacheKey);
  if (!promise) {
    promise = loadMovieSucaiPayload(appKey, page, pageSize, name);
    inFlight.set(cacheKey, promise);
  }

  try {
    const payload = await promise;
    responseCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, payload });
    return json(payload, 'MISS');
  } catch (e) {
    if (e instanceof NarratorProxyError) {
      return NextResponse.json(
        { success: false, error: e.message, code: e.code },
        { status: e.status }
      );
    }
    return NextResponse.json(
      { success: false, error: (e as Error).message || '\u83b7\u53d6\u7d20\u6750\u5e93\u5931\u8d25' },
      { status: 500 }
    );
  } finally {
    inFlight.delete(cacheKey);
  }
}
