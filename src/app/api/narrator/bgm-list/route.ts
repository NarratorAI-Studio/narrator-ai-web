import { NextRequest, NextResponse } from 'next/server';
import {
  NarratorMetadataError,
  fetchNarratorMetadata,
} from '@/lib/narrator-metadata-backend-client';
import {
  filterMetadataPlaceholderItems,
  NarratorMetadataListPayload,
  parsePositiveInt,
  unwrapMetadataListPayload,
} from '@/lib/narrator-metadata-list';

const DEFAULT_PAGE = 1;
const DEFAULT_SIZE = 50;
const MAX_AUTO_PAGES = 20;

async function fetchBgmPage(
  appKey: string,
  page: number,
  size: number
): Promise<NarratorMetadataListPayload> {
  const payload = unwrapMetadataListPayload(
    await fetchNarratorMetadata(appKey, '/narrator/bgm-list', {
      page: String(page),
      size: String(size),
    })
  );
  return {
    ...payload,
    items: Array.isArray(payload.items)
      ? filterMetadataPlaceholderItems(payload.items, 'bgm_file_id')
      : [],
  };
}

export async function GET(request: NextRequest) {
  const appKey = request.headers.get('x-app-key') || '';
  if (!appKey) {
    return NextResponse.json(
      { success: false, error: '请先配置 App Key' },
      { status: 401 }
    );
  }
  try {
    const sp = request.nextUrl.searchParams;
    const page = parsePositiveInt(sp.get('page')) ?? DEFAULT_PAGE;
    const size = parsePositiveInt(sp.get('size')) ?? DEFAULT_SIZE;

    if (sp.has('page') || sp.has('size')) {
      return NextResponse.json({
        success: true,
        data: await fetchBgmPage(appKey, page, size),
      });
    }

    const first = await fetchBgmPage(appKey, DEFAULT_PAGE, DEFAULT_SIZE);
    const mergedItems = Array.isArray(first.items) ? [...first.items] : [];
    const total = parsePositiveInt(first.total);

    if (total && mergedItems.length < total) {
      for (let nextPage = DEFAULT_PAGE + 1; nextPage <= MAX_AUTO_PAGES; nextPage += 1) {
        const next = await fetchBgmPage(appKey, nextPage, DEFAULT_SIZE);
        const nextItems = Array.isArray(next.items) ? next.items : [];
        if (nextItems.length === 0) break;
        mergedItems.push(...nextItems);
        if (mergedItems.length >= total) break;
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        ...first,
        items: mergedItems,
        total: mergedItems.length,
      },
    });
  } catch (e) {
    if (e instanceof NarratorMetadataError) {
      return NextResponse.json(
        { success: false, error: e.message, code: e.code },
        { status: e.status }
      );
    }
    return NextResponse.json(
      { success: false, error: (e as Error).message || '获取 BGM 列表失败' },
      { status: 500 }
    );
  }
}
