/**
 * NarratorAI API 配置
 */

export const NARRATORAI_CONFIG = {
  baseURL: process.env.NARRATORAI_BASE_URL || 'http://localhost:8000',
  apiKey: process.env.NARRATORAI_API_KEY || '',
  timeout: 60000, // 60秒超时
} as const;

/**
 * API 端点
 */
export const API_ENDPOINTS = {
  // 项目管理
  projects: '/v1/projects',
  
  // 文件管理 (v1 - 项目文件)
  uploadFile: '/v1/files/upload',
  uploadFileByUrl: '/v1/files/upload-url',
  files: (projectId: string) => `/v1/projects/${projectId}/files`,
  fileDetail: (projectId: string, fileId: string) => `/v1/projects/${projectId}/files/${fileId}`,
  
  // 文件管理 (v2 - 个人云盘)
  v2FileList: '/v2/files/list',
  v2UploadPresignedUrl: '/v2/files/upload/presigned-url',
  v2DownloadPresignedUrl: '/v2/files/download/presigned-url',
  v2DeleteFile: (fileId: string) => `/v2/files/user/files/${fileId}`,
  v2StorageUsage: '/v2/files/storage-usage',
  
  // 视频解说 - 短剧解说（六脉神剑）
  createTask: '/v1/narrator/tasks/create',
  taskList: '/v1/narrator/tasks',
  taskDetail: (taskId: string) => `/v1/narrator/tasks/${taskId}`,
  
  // 视频解说 - 通用爆款解说
  createUniversalDrama: '/v1/narrator/universal/drama',
  queryUniversalDrama: (taskId: string) => `/v1/narrator/universal/drama/${taskId}`,
  
  // 解说类型查询
  narratorTypes: '/v1/narrator/types',
  narratorModels: '/v1/narrator/models',
  
  // 素材模板
  templates: '/v1/narrator/templates',
  bgmList: '/v1/narrator/bgm',
} as const;

/**
 * 任务状态枚举
 */
export enum TaskStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

/**
 * 文件类型枚举
 */
export enum FileType {
  VIDEO = 'video',
  SUBTITLE = 'subtitle',
  IMAGE = 'image',
  AUDIO = 'audio',
}
