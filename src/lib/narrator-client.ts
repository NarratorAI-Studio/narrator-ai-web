/**
 * NarratorAI direct-upstream client — retains only the cloud-drive v2
 * surface (`cloudDriveAPI`) used by the cloud-drive BFF routes and
 * `narrator/srt-realtime-quote` (presigned download URL fetch).
 *
 * All other clients (projectAPI / fileAPI / narratorAPI / commentaryAPI /
 * templateAPI / userAPI) were retired in regression coverage along with the v1 page
 * cluster and orphan exports; their successors live behind the
 * narrator-ai-web-backend proxy (contract migration) and are imported via
 * `@/lib/narrator-proxy-backend-client` / `@/lib/narrator-metadata-backend-client`.
 *
 * The cloud-drive migration to backend lives separately under regression coverage; this
 * module shrinks again when that lands.
 */

import { NARRATORAI_CONFIG } from './narrator-config';

export class NarratorError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public code?: string
  ) {
    super(message);
    this.name = 'NarratorError';
  }
}

async function requestV2<T>(
  endpoint: string,
  appKey: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${NARRATORAI_CONFIG.baseURL}${endpoint}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'app-key': appKey,
    ...(options.headers as Record<string, string>),
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), NARRATORAI_CONFIG.timeout);

  try {
    const response = await fetch(url, {
      ...options,
      headers,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const data = await response.json();

    if (!response.ok || (data.code && data.code !== 10000)) {
      throw new NarratorError(
        data.message || 'API request failed',
        response.status,
        String(data.code)
      );
    }

    return data;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof NarratorError) throw error;
    if (error instanceof Error) {
      if (error.name === 'AbortError') throw new NarratorError('Request timeout');
      throw new NarratorError(error.message);
    }
    throw new NarratorError('Unknown error occurred');
  }
}

export const cloudDriveAPI = {
  /**
   * 获取文件列表
   */
  async getFileList(
    appKey: string,
    params: {
      page?: number;
      page_size?: number;
      order_by?: 'file_size' | 'completed_time' | 'created_at';
      order?: 'asc' | 'desc';
      search?: string;
    } = {}
  ) {
    const query = new URLSearchParams({
      page: String(params.page ?? 1),
      page_size: String(params.page_size ?? 20),
      order_by: params.order_by ?? 'created_at',
      order: params.order ?? 'desc',
      search: params.search ?? '',
    }).toString();
    return requestV2<any>(`/v2/files/list?${query}`, appKey);
  },

  /**
   * 获取存储空间使用信息
   */
  async getStorageUsage(appKey: string) {
    return requestV2<any>('/v2/files/storage-usage', appKey);
  },

  /**
   * 获取预签名上传 URL（两步上传第一步）
   */
  async getUploadPresignedUrl(
    appKey: string,
    params: { file_name: string; file_size: number; content_type: string }
  ) {
    return requestV2<any>('/v2/files/upload/presigned-url', appKey, {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  /**
   * 预签名上传结果回调（上传第三步）
   */
  async uploadCallback(
    appKey: string,
    params: {
      upload_status: string;
      file_size: number;
      file_name: string;
      file_id: string;
      object_key: string;
      upload_url: string;
      expires_in: number;
      upload_directory: string;
    }
  ) {
    return requestV2<any>('/v2/files/upload/callback', appKey, {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  /**
   * 获取预签名下载 URL
   */
  async getDownloadPresignedUrl(appKey: string, fileId: string) {
    return requestV2<any>('/v2/files/download/presigned-url', appKey, {
      method: 'POST',
      body: JSON.stringify({ file_id: fileId }),
    });
  },

  /**
   * 删除文件
   */
  async deleteFile(appKey: string, fileId: string) {
    return requestV2<any>(`/v2/files/user/files/${fileId}`, appKey, {
      method: 'DELETE',
    });
  },

  /**
   * 创建上传转存任务
   * @param link 百度网盘链接 或 可下载的 URL 链接
   */
  async createTransferTask(appKey: string, link: string) {
    return requestV2<any>('/v2/files/upload', appKey, {
      method: 'POST',
      body: JSON.stringify({ link }),
    });
  },

  /**
   * 删除转存任务（单个或批量）
   */
  async deleteTransferTasks(appKey: string, fileIds: string[]) {
    return requestV2<any>('/v2/files/user/files/batch-delete', appKey, {
      method: 'POST',
      body: JSON.stringify({ file_ids: fileIds }),
    });
  },

  /**
   * 获取转存任务列表
   * status: 0=初始化 1=上传中 2=已完成 3=上传失败 4=已删除
   */
  async getTransferList(
    appKey: string,
    params: { page?: number; limit?: number; status?: number; order?: string; order_by?: string } = {}
  ) {
    const query = new URLSearchParams();
    if (params.page)     query.set('page',     String(params.page));
    if (params.limit)    query.set('limit',    String(params.limit));
    if (params.status !== undefined) query.set('status', String(params.status));
    if (params.order)    query.set('order',    params.order);
    if (params.order_by) query.set('order_by', params.order_by);
    return requestV2<any>(`/v2/files/user/filelist?${query.toString()}`, appKey);
  },
};
