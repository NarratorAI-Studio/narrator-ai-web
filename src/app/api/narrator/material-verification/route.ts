import { NextRequest, NextResponse } from 'next/server';
import {
  NarratorProxyError,
  callNarratorProxyPost,
} from '@/lib/narrator-proxy-backend-client';

// 从错误消息中提取模板行数和素材行数
// 格式：爆款模板字幕行数(67)必须小于等于素材字幕行数(37)
function parseLineCountError(msg: string): { templateLines: number; srtLines: number } | null {
  const m = msg.match(/字幕行数\((\d+)\).*?字幕行数\((\d+)\)/);
  if (!m) return null;
  return { templateLines: parseInt(m[1]), srtLines: parseInt(m[2]) };
}

function verify(appKey: string, params: Record<string, unknown>) {
  return callNarratorProxyPost(
    appKey,
    '/narrator/commentary/material-verification',
    params
  );
}

export async function POST(request: NextRequest) {
  const appKey = request.headers.get('x-app-key') || '';
  if (!appKey) return NextResponse.json({ success: false, error: '请先配置 App Key' }, { status: 401 });
  try {
    const body = await request.json();
    const { episodes_data, ...sharedParams } = body as {
      episodes_data?: Array<{ native_video: string; native_srt: string }>;
      [k: string]: unknown;
    };

    // 短剧多集模式：汇总所有集的字幕行数
    if (episodes_data && episodes_data.length > 1) {
      const results = await Promise.allSettled(
        episodes_data.map(ep =>
          verify(appKey, {
            ...sharedParams,
            native_video: ep.native_video,
            native_srt: ep.native_srt,
          })
        )
      );

      let templateLines = 0;
      let totalSrtLines = 0;
      let lineCountFailCount = 0;

      for (const r of results) {
        if (r.status === 'fulfilled') {
          // 该集单独通过，整体必然通过
          return NextResponse.json({ success: true, data: r.value });
        }
        const reason = r.reason;
        const msg: string = (reason as Error)?.message || '';
        const parsed = parseLineCountError(msg);
        if (parsed) {
          templateLines = Math.max(templateLines, parsed.templateLines);
          totalSrtLines += parsed.srtLines;
          lineCountFailCount++;
          continue;
        }
        // Non-line-count rejection — auth (401), config (503), unreachable
        // (502/504), or an upstream business error with a different shape.
        // Preserve the original failure status + code rather than flattening
        // everything into a hardcoded 422 "素材验证失败" (otherwise auth/infra failures look identical to
        // a real material validation failure to clients and monitoring).
        if (reason instanceof NarratorProxyError) {
          return NextResponse.json(
            { success: false, error: reason.message, code: reason.code },
            { status: reason.status }
          );
        }
        return NextResponse.json(
          { success: false, error: msg || '素材验证失败' },
          { status: 500 }
        );
      }

      // 所有集均为行数不足错误：判断汇总行数是否达标
      if (lineCountFailCount > 0 && totalSrtLines >= templateLines) {
        return NextResponse.json({
          success: true,
          data: { message: `素材校验通过（${lineCountFailCount} 集字幕共 ${totalSrtLines} 行，满足模板 ${templateLines} 行要求）` },
        });
      }

      return NextResponse.json({
        success: false,
        error: `素材字幕总行数(${totalSrtLines})不满足模板要求(${templateLines}行)，请选择字幕更长的素材或更换模板`,
      }, { status: 422 });
    }

    // 单集 / 非短剧模式
    const result = await verify(appKey, sharedParams as Record<string, unknown>);
    return NextResponse.json({ success: true, data: result });
  } catch (e) {
    if (e instanceof NarratorProxyError) {
      return NextResponse.json(
        { success: false, error: e.message, code: e.code },
        { status: e.status }
      );
    }
    return NextResponse.json(
      { success: false, error: (e as Error).message || '素材验证失败' },
      { status: 500 }
    );
  }
}
