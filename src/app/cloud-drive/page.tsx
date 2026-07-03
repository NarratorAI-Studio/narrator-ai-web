'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { AppNavLink } from '@/components/app-nav-link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  HardDrive,
  Upload,
  Download,
  Trash2,
  Settings,
  Search,
  RefreshCw,
  FileVideo,
  FileText,
  File,
  ArrowLeft,
  Eye,
  EyeOff,
  ChevronLeft,
  ChevronRight,
  Video,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Link2,
  Globe,
  Clock,
  XCircle,
  FolderOpen,
  Zap,
  User,
  ListChecks,
  Plus,
} from 'lucide-react';
import { sha256Hex, shouldHashForSrt } from '@/lib/file-hash';
import {
  ALL_SUPPORTED_ACCEPT_ATTR,
  checkExtensionAllowed,
} from '@/lib/cloud-drive-file-types';
import { useAppKey } from '@/hooks/use-app-key';
import { ThemeToggle } from '@/components/theme-toggle';

// ─── Types ──────────────────────────────────────────────────────────────────

interface CloudFile {
  file_id: string;
  file_name: string;
  file_size: number;
  suffix: string;
  category: number;
  completed_time: string;
  created_at: string;
}

interface FileListData {
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
  items: CloudFile[];
}

interface StorageData {
  used_size: number;
  max_size: number;
  file_count: number;
  usage_percentage: number;
}

interface TransferTask {
  file_id: string;
  original_name: string;
  file_name: string;
  progress: number;
  category: number;
  file_size: string;
  status: number; // 0=初始化 1=上传中 2=已完成 3=失败 4=已删除
  error_message?: string;
  error_code?: string;
  created_at: string;
  completed_time?: string;
  failed_time?: string;
}

const BATCH_DELETE_LIMIT = 50;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

const DATETIME_PARTS_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const parts = DATETIME_PARTS_FORMATTER.formatToParts(d).reduce<Record<string, string>>(
    (acc, p) => {
      if (p.type !== 'literal') acc[p.type] = p.value;
      return acc;
    },
    {}
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function getCategoryLabel(category: number, suffix: string): { label: string; color: string } {
  const ext = suffix.toLowerCase();
  if (['mp4', 'mov', 'avi', 'mkv', 'flv'].includes(ext)) {
    return { label: '视频', color: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300' };
  }
  if (['srt', 'vtt', 'ass'].includes(ext)) {
    return { label: '字幕', color: 'bg-green-100 text-green-700' };
  }
  if (['mp3', 'wav', 'aac'].includes(ext)) {
    return { label: '音频', color: 'bg-purple-100 text-purple-700' };
  }
  if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) {
    return { label: '图片', color: 'bg-orange-100 text-orange-700' };
  }
  return { label: '文件', color: 'bg-muted text-muted-foreground' };
}

function getFileIcon(suffix: string) {
  const ext = suffix.toLowerCase();
  if (['mp4', 'mov', 'avi', 'mkv'].includes(ext)) return <FileVideo className="h-4 w-4 text-primary" />;
  if (['srt', 'vtt', 'ass'].includes(ext)) return <FileText className="h-4 w-4 text-green-500" />;
  return <File className="h-4 w-4 text-muted-foreground" />;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CloudDrivePage() {
  const { appKey, setAppKey, loaded } = useAppKey();
  const [showKeyDialog, setShowKeyDialog] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [showContactQR, setShowContactQR] = useState(false);

  const [files, setFiles] = useState<CloudFile[]>([]);
  const [fileListData, setFileListData] = useState<FileListData | null>(null);
  const [storage, setStorage] = useState<StorageData | null>(null);

  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [orderBy, setOrderBy] = useState<'created_at' | 'file_size' | 'completed_time'>('created_at');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');

  const [loadingFiles, setLoadingFiles] = useState(false);
  const [loadingStorage, setLoadingStorage] = useState(false);

  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadingRef = useRef(false);
  const uploadXhrRef = useRef<XMLHttpRequest | null>(null);
  const uploadingFileIdRef = useRef<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Upload dialog
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [uploadTab, setUploadTab] = useState<'local' | 'transfer'>('local');

  // Transfer task
  const [transferLink, setTransferLink] = useState('');
  const [transferring, setTransferring] = useState(false);
  const [transferError, setTransferError] = useState('');
  const [transferTasks, setTransferTasks] = useState<TransferTask[]>([]);
  const [loadingTransfers, setLoadingTransfers] = useState(false);
  const [showTransferDialog, setShowTransferDialog] = useState(false);
  const [selectedTransferIds, setSelectedTransferIds] = useState<Set<string>>(new Set());
  const [deletingTransferIds, setDeletingTransferIds] = useState<Set<string>>(new Set());

  const [deleteTarget, setDeleteTarget] = useState<CloudFile | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  // Batch selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [batchDownloading, setBatchDownloading] = useState(false);
  const [batchDownloadProgress, setBatchDownloadProgress] = useState('');
  const [showBatchDeleteConfirm, setShowBatchDeleteConfirm] = useState(false);

  const toggleSelect = (id: string) => setSelectedIds(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const toggleSelectAll = () => {
    if (selectedIds.size === files.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(files.map(f => f.file_id)));
  };

  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const showToast = useCallback((type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3500);
  }, []);

  // ─── API helpers ────────────────────────────────────────────────────────────

  const apiHeaders = useCallback(
    () => ({ 'x-app-key': appKey, 'Content-Type': 'application/json' }),
    [appKey]
  );

  const fetchFiles = useCallback(async () => {
    if (!appKey || uploadingRef.current) return;
    setLoadingFiles(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        page_size: String(pageSize),
        order_by: orderBy,
        order,
        search,
      });
      const res = await fetch(`/api/cloud-drive/files?${params}`, {
        headers: apiHeaders(),
      });
      const json = await res.json();
      if (json.success) {
        setFileListData(json.data);
        setFiles(json.data.items || []);
        setSelectedIds(new Set());
      } else {
        showToast('error', json.error || '获取文件列表失败');
      }
    } catch {
      showToast('error', '网络错误，请重试');
    } finally {
      setLoadingFiles(false);
    }
  }, [appKey, page, pageSize, orderBy, order, search, apiHeaders, showToast]);

  const fetchStorage = useCallback(async () => {
    if (!appKey || uploadingRef.current) return;
    setLoadingStorage(true);
    try {
      const res = await fetch('/api/cloud-drive/storage', { headers: apiHeaders() });
      const json = await res.json();
      if (json.success) {
        setStorage(json.data);
      }
    } catch {
      // silent
    } finally {
      setLoadingStorage(false);
    }
  }, [appKey, apiHeaders]);

  // ─── Transfer tasks ──────────────────────────────────────────────────────────

  const fetchTransferTasks = useCallback(async (silent = false) => {
    if (!appKey) return;
    if (!silent) setLoadingTransfers(true);
    try {
      const res = await fetch('/api/cloud-drive/transfer?limit=20&order=desc&order_by=created_at', {
        headers: apiHeaders(),
      });
      const json = await res.json();
      if (json.success) {
        setTransferTasks(json.data?.data || []);
      }
    } catch {
      // silent
    } finally {
      if (!silent) setLoadingTransfers(false);
    }
  }, [appKey, apiHeaders]);

  const handleDeleteTransferTasks = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    setDeletingTransferIds(prev => { const s = new Set(prev); ids.forEach(id => s.add(id)); return s; });
    try {
      const res = await fetch('/api/cloud-drive/transfer', {
        method: 'DELETE',
        headers: apiHeaders(),
        body: JSON.stringify({ file_ids: ids }),
      });
      const json = await res.json();
      if (json.success) {
        setTransferTasks(prev => prev.filter(t => !ids.includes(t.file_id)));
        setSelectedTransferIds(prev => { const s = new Set(prev); ids.forEach(id => s.delete(id)); return s; });
        showToast('success', `已删除 ${ids.length} 条转存任务`);
        // 若删除的 ID 包含当前本地上传的文件，终止 XHR 并清除进度条
        if (uploadingFileIdRef.current && ids.includes(uploadingFileIdRef.current)) {
          uploadXhrRef.current?.abort();
          uploadXhrRef.current = null;
          uploadingFileIdRef.current = null;
          setUploading(false);
          uploadingRef.current = false;
          setUploadProgress(null);
        }
      } else {
        showToast('error', json.error || '删除失败');
      }
    } catch {
      showToast('error', '网络错误，请重试');
    } finally {
      setDeletingTransferIds(prev => { const s = new Set(prev); ids.forEach(id => s.delete(id)); return s; });
    }
  }, [apiHeaders, showToast]);

  const handleTransferSubmit = async () => {
    if (!transferLink.trim()) return;
    setTransferring(true);
    setTransferError('');
    try {
      const res = await fetch('/api/cloud-drive/transfer', {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify({
          link: transferLink.trim(),
        }),
      });
      const json = await res.json();
      if (json.success) {
        showToast('success', '转存任务已提交');
        setTransferLink('');
        fetchTransferTasks();
      } else {
        setTransferError(json.error || '创建转存任务失败');
      }
    } catch {
      setTransferError('网络错误，请重试');
    } finally {
      setTransferring(false);
    }
  };

  // 初始加载 & appKey 变化时拉取数据
  useEffect(() => {
    if (!loaded) return;
    if (!appKey) return;
    if (uploadingRef.current) return;
    fetchFiles();
    fetchStorage();
    fetchTransferTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, appKey, page, pageSize, orderBy, order, search, refreshKey]);

  // regression coverage: poll transfer tasks while any are non-terminal (status 0/1).
  // When a task transitions to terminal (2/3/4), refetch files + storage
  // so newly transferred files appear in the main list without the user
  // having to refresh manually or open the transfer dialog.
  const transferStatusesRef = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    if (!loaded || !appKey) return;
    const hasInflight = transferTasks.some(t => t.status === 0 || t.status === 1);
    // Detect status transitions to terminal so we can refresh once per
    // change rather than on every poll tick.
    const prev = transferStatusesRef.current;
    let didTransitionToTerminal = false;
    for (const t of transferTasks) {
      const prevStatus = prev.get(t.file_id);
      const isNowTerminal = t.status === 2 || t.status === 3 || t.status === 4;
      const wasInflight = prevStatus === 0 || prevStatus === 1;
      if (wasInflight && isNowTerminal) {
        didTransitionToTerminal = true;
        break;
      }
    }
    // Update the snapshot for the next tick.
    const next = new Map<string, number>();
    for (const t of transferTasks) next.set(t.file_id, t.status);
    transferStatusesRef.current = next;

    if (didTransitionToTerminal) {
      fetchFiles();
      fetchStorage();
    }
    if (!hasInflight) return;
    const id = setInterval(() => {
      if (!uploadingRef.current) fetchTransferTasks(true);
    }, 5000);
    return () => clearInterval(id);
  }, [loaded, appKey, transferTasks, fetchFiles, fetchStorage, fetchTransferTasks]);

  // ─── Upload (本地上传) ────────────────────────────────────────────────────────

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    const check = checkExtensionAllowed(file.name);
    if (!check.ok) {
      setUploadError(check.reason);
      showToast('error', check.reason);
      return;
    }

    setUploading(true);
    uploadingRef.current = true;
    setUploadError('');
    setUploadProgress(0);

    try {
      // Step 1: get presigned URL
      const res1 = await fetch('/api/cloud-drive/upload-url', {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify({
          file_name: file.name,
          file_size: file.size,
          content_type: file.type || 'application/octet-stream',
        }),
      });
      const json1 = await res1.json();
      if (!json1.success) throw new Error(json1.error || '获取上传链接失败');

      const presignedData = json1.data;
      const { upload_url, file_id, object_key, expires_in, upload_directory } = presignedData;
      const contentType = file.type || 'application/octet-stream';

      uploadingFileIdRef.current = file_id;

      // Step 2: PUT file directly to OSS
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        uploadXhrRef.current = xhr;
        xhr.open('PUT', upload_url, true);
        xhr.setRequestHeader('Content-Type', contentType);
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            setUploadProgress(Math.round((event.loaded / event.total) * 100));
          }
        };
        xhr.onload = () => {
          uploadXhrRef.current = null;
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error(`上传失败，状态码: ${xhr.status}`));
        };
        xhr.onerror = () => { uploadXhrRef.current = null; reject(new Error('上传网络错误')); };
        xhr.onabort = () => { uploadXhrRef.current = null; reject(new Error('上传已取消')); };
        xhr.send(file);
      });

      // Step 3: callback to confirm upload
      const res3 = await fetch('/api/cloud-drive/upload-callback', {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify({
          upload_status: 'success',
          file_size: file.size,
          file_name: file.name,
          file_id,
          object_key,
          upload_url,
          expires_in,
          upload_directory,
          ...(shouldHashForSrt(file) ? { srt_file_hash: await sha256Hex(file) } : {}),
        }),
      });
      const json3 = await res3.json();
      if (!json3.success) throw new Error(json3.error || '上传回调失败');

      showToast('success', `「${file.name}」上传成功`);
      setShowUploadDialog(false);
      setUploading(false);
      uploadingRef.current = false;
      setUploadProgress(null);
      setPage(1);
      setRefreshKey(k => k + 1);
    } catch (err: any) {
      setUploadError(err.message || '上传失败');
      showToast('error', err.message || '上传失败');
    } finally {
      setUploading(false);
      uploadingRef.current = false;
      setUploadProgress(null);
    }
  };

  // ─── Delete ──────────────────────────────────────────────────────────────────

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/cloud-drive/files/${deleteTarget.file_id}`, {
        method: 'DELETE',
        headers: apiHeaders(),
      });
      const json = await res.json();
      if (json.success) {
        showToast('success', `「${deleteTarget.file_name}」已删除`);
        // The implementation requirement: optimistically reflect the deletion in the storage
        // card so the user doesn't see "暂无文件" alongside a stale
        // "used_size + file_count" while the backend refetch is in
        // flight. fetchStorage() below still reconciles with the truth.
        const justDeletedSize = deleteTarget.file_size;
        setStorage((prev) =>
          prev
            ? {
                ...prev,
                used_size: Math.max(0, prev.used_size - justDeletedSize),
                file_count: Math.max(0, prev.file_count - 1),
                usage_percentage:
                  prev.max_size > 0
                    ? (Math.max(0, prev.used_size - justDeletedSize) / prev.max_size) * 100
                    : 0,
              }
            : prev,
        );
        setDeleteTarget(null);
        fetchFiles();
        fetchStorage();
      } else {
        showToast('error', json.error || '删除失败');
      }
    } catch {
      showToast('error', '网络错误，请重试');
    } finally {
      setDeleting(false);
    }
  };

  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    if (selectedIds.size > BATCH_DELETE_LIMIT) return;
    setBatchDeleting(true);
    try {
      const res = await fetch('/api/cloud-drive/files/batch-delete', {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify({ file_ids: Array.from(selectedIds) }),
      });
      const json = await res.json();
      if (json.success) {
        const data = json.data || {};
        const deleted = typeof data.deleted_count === 'number' ? data.deleted_count : selectedIds.size;
        const failed = typeof data.failed_count === 'number' ? data.failed_count : 0;
        const reasonLabel = (reason: string) => {
          if (reason === 'not_found') return '文件不存在';
          if (reason === 'forbidden') return '无权限';
          if (reason === 'already_deleted') return '已删除';
          return reason;
        };
        if (failed === 0) {
          showToast('success', `批量删除成功：${deleted} 个文件`);
        } else {
          const items: Array<{ file_id: string; reason: string }> = data.failed_items || [];
          const reasonSummary = items.length
            ? '：' + items.slice(0, 3).map((it) => reasonLabel(it.reason)).join('、')
              + (items.length > 3 ? '…' : '')
            : '';
          showToast('error', `成功 ${deleted} 个，失败 ${failed} 个${reasonSummary}`);
        }
        if (data.storage_usage) {
          setStorage(data.storage_usage as StorageData);
        } else {
          // The implementation requirement: backend didn't echo storage_usage. Optimistic
          // subtract by summing locally-known sizes — but ONLY for the
          // file_ids that actually succeeded. Filter out anything that
          // showed up in failed_items so a partial failure doesn't
          // leave used_size lower than reality. fetchStorage() below still reconciles to
          // ground truth.
          const failedIds = new Set(
            (data.failed_items as Array<{ file_id: string }> | undefined)?.map(
              (it) => it.file_id,
            ) ?? [],
          );
          const succeededSize = files
            .filter((f) => selectedIds.has(f.file_id) && !failedIds.has(f.file_id))
            .reduce((sum, f) => sum + (f.file_size || 0), 0);
          setStorage((prev) =>
            prev
              ? {
                  ...prev,
                  used_size: Math.max(0, prev.used_size - succeededSize),
                  file_count: Math.max(0, prev.file_count - deleted),
                  usage_percentage:
                    prev.max_size > 0
                      ? (Math.max(0, prev.used_size - succeededSize) / prev.max_size) * 100
                      : 0,
                }
              : prev,
          );
        }
        setSelectedIds(new Set());
        setShowBatchDeleteConfirm(false);
        fetchFiles();
        if (!data.storage_usage) fetchStorage();
      } else {
        showToast('error', json.error || '批量删除失败');
      }
    } catch {
      showToast('error', '网络错误，请重试');
    } finally {
      setBatchDeleting(false);
    }
  };

  const handleBatchDownload = async () => {
    if (selectedIds.size === 0) return;
    setBatchDownloading(true);
    const selected = files.filter(f => selectedIds.has(f.file_id));
    let successCount = 0;

    for (let i = 0; i < selected.length; i++) {
      const file = selected[i];
      setBatchDownloadProgress(`${i + 1}/${selected.length}`);
      try {
        const res = await fetch('/api/cloud-drive/download-url', {
          method: 'POST', headers: apiHeaders(), body: JSON.stringify({ file_id: file.file_id }),
        });
        const json = await res.json();
        if (json.success && json.data.download_url) {
          const downloadUrl = json.data.download_url;
          // Guard against loading huge files entirely into memory.
          // HEAD the URL first; if Content-Length exceeds 100 MB, skip blob
          // buffering and fall back to a direct anchor click (cross-origin,
          // may be blocked by popup blockers but avoids OOM for large files).
          const BLOB_LIMIT = 100 * 1024 * 1024; // 100 MB
          let useBlobFetch = true;
          try {
            const head = await fetch(downloadUrl, { method: 'HEAD' });
            const cl = parseInt(head.headers.get('content-length') ?? '0', 10);
            if (cl > BLOB_LIMIT) useBlobFetch = false;
          } catch { /* CORS may block HEAD — proceed with blob fetch */ }

          if (useBlobFetch) {
            // Fetch as blob so blob: URL is same-origin — avoids browser popup
            // blocking that occurs with programmatic cross-origin anchor clicks.
            const fileRes = await fetch(downloadUrl);
            const blob = await fileRes.blob();
            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = file.file_name;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
          } else {
            const a = document.createElement('a');
            a.href = downloadUrl;
            a.download = file.file_name;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
          }
          successCount++;
        }
      } catch { /* skip */ }
    }

    setBatchDownloading(false);
    setBatchDownloadProgress('');
    showToast('success', `已下载 ${successCount} 个文件`);
  };

  // ─── Download ────────────────────────────────────────────────────────────────

  const handleDownload = async (file: CloudFile) => {
    setDownloadingId(file.file_id);
    try {
      const res = await fetch('/api/cloud-drive/download-url', {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify({ file_id: file.file_id }),
      });
      const json = await res.json();
      if (json.success && json.data.download_url) {
        const a = document.createElement('a');
        a.href = json.data.download_url;
        a.download = file.file_name;
        a.target = '_blank';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } else {
        showToast('error', json.error || '获取下载链接失败');
      }
    } catch {
      showToast('error', '网络错误，请重试');
    } finally {
      setDownloadingId(null);
    }
  };

  // ─── App Key dialog ──────────────────────────────────────────────────────────

  const handleSaveKey = () => {
    if (!keyInput.trim()) return;
    setAppKey(keyInput.trim());
    setShowKeyDialog(false);
    setKeyInput('');
  };

  // ─── Search ──────────────────────────────────────────────────────────────────

  const handleSearch = () => {
    setSearch(searchInput);
    setPage(1);
  };

  // ─── Render ──────────────────────────────────────────────────────────────────

  const usagePercent = storage
    ? Math.min(storage.usage_percentage, 100)
    : 0;

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background flex flex-col">

        {/* Toast */}
        {toast && (
          <div
            className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium transition-all ${
              toast.type === 'success'
                ? 'bg-green-50 border border-green-200 text-green-800'
                : 'bg-red-50 border border-red-200 text-red-800'
            }`}
          >
            {toast.type === 'success' ? (
              <CheckCircle2 className="h-4 w-4 shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 shrink-0" />
            )}
            {toast.message}
          </div>
        )}

        {/* Header / Nav */}
        <header className="border-b bg-card/80 backdrop-blur-sm sticky top-0 z-40">
          <div className="container mx-auto px-4 py-2 flex flex-col gap-2 sm:h-14 sm:flex-row sm:items-center sm:justify-between sm:py-0">
            <AppNavLink href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
              <img src="/images/logo-light.png" alt="AI 解说大师" className="h-[1.6rem] w-auto dark:hidden" />
              <img src="/images/logo-dark.svg" alt="AI 解说大师" className="hidden h-[1.6rem] w-auto dark:block" />
            </AppNavLink>
            <nav className="grid w-full grid-cols-6 gap-1 sm:flex sm:w-auto sm:items-center max-[640px]:[&_button]:w-full max-[640px]:[&_button]:gap-0 max-[640px]:[&_button]:px-2 max-[640px]:[&_button]:text-[0px]">
              <AppNavLink href="/">
                <Button variant="ghost" size="sm" className="gap-1.5">
                  <Zap className="h-4 w-4" />
                  爆款解说
                </Button>
              </AppNavLink>
              <AppNavLink href="/narrator/tasks">
                <Button variant="ghost" size="sm" className="gap-1.5">
                  <ListChecks className="h-4 w-4" />
                  任务记录
                </Button>
              </AppNavLink>
              <Button variant="default" size="sm" className="gap-1.5">
                <HardDrive className="h-4 w-4" />
                个人云盘
              </Button>
              <AppNavLink href="/account">
                <Button variant="ghost" size="sm" className="gap-1.5">
                  <User className="h-4 w-4" />
                  个人中心
                </Button>
              </AppNavLink>
              <ThemeToggle className="ml-0 sm:ml-1" />
            </nav>
          </div>
        </header>

        <main className="container mx-auto max-w-6xl px-3 py-4 space-y-4 sm:px-4 sm:py-6 sm:space-y-5">

          <h1 className="text-lg font-semibold flex items-center gap-2"><HardDrive className="h-5 w-5 text-primary" />个人云盘</h1>

          {/* Storage Usage */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <HardDrive className="h-4 w-4 text-primary" />
                  存储空间
                </CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { fetchFiles(); fetchStorage(); }}
                  className="gap-1 text-muted-foreground"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  刷新
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {loadingStorage ? (
                <div className="space-y-2">
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-4 w-1/3" />
                </div>
              ) : storage ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      已使用 <span className="font-medium text-foreground">{formatBytes(storage.used_size)}</span>
                      {' / '}
                      <span className="font-medium text-foreground">{formatBytes(storage.max_size)}</span>
                    </span>
                    <span className={`font-medium text-sm ${storage.usage_percentage > 90 ? 'text-red-500' : 'text-primary'}`}>
                      {storage.usage_percentage.toFixed(1)}%
                    </span>
                  </div>
                  <Progress
                    value={usagePercent}
                    className={`h-2 ${storage.usage_percentage > 90 ? '[&>div]:bg-red-500' : '[&>div]:bg-primary'}`}
                  />
                  <p className="text-xs text-muted-foreground">共 {storage.file_count} 个文件</p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {appKey ? '加载中...' : '请先配置 App Key'}
                </p>
              )}
            </CardContent>
          </Card>

          {/* File List */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">文件列表</CardTitle>
              </div>
              <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
                  <div className="col-span-2 flex gap-1 sm:col-span-1">
                    <Input
                      placeholder="搜索文件名..."
                      value={searchInput}
                      onChange={(e) => setSearchInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                      className="h-8 w-full text-sm sm:w-40"
                    />
                    <Button size="sm" variant="outline" onClick={handleSearch} className="h-8 px-2">
                      <Search className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <Select value={orderBy} onValueChange={(v: any) => { setOrderBy(v); setPage(1); }}>
                    <SelectTrigger className="h-8 w-full text-xs sm:w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="created_at">按创建时间</SelectItem>
                      <SelectItem value="file_size">按文件大小</SelectItem>
                      <SelectItem value="completed_time">按完成时间</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={order} onValueChange={(v: any) => { setOrder(v); setPage(1); }}>
                    <SelectTrigger className="h-8 w-full text-xs sm:w-20">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="desc">降序</SelectItem>
                      <SelectItem value="asc">升序</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0 sm:items-center">
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    accept={ALL_SUPPORTED_ACCEPT_ATTR}
                    onChange={handleFileSelect}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 gap-1"
                    onClick={() => { setShowTransferDialog(true); fetchTransferTasks(); }}
                    disabled={!appKey}
                  >
                    <Globe className="h-3.5 w-3.5" />
                    转存任务
                  </Button>
                  <Button
                    size="sm"
                    className="h-8 gap-1"
                    onClick={() => { setShowUploadDialog(true); setUploadTab('local'); setUploadError(''); setTransferError(''); }}
                    disabled={!appKey}
                  >
                    <Upload className="h-3.5 w-3.5" />
                    上传文件
                  </Button>
                </div>
              </div>

              {/* Global upload progress indicator */}
              {uploading && uploadProgress !== null && (
                <div className="mt-2 space-y-1">
                  <div className="flex items-center gap-2 text-xs text-primary">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    本地上传中 {uploadProgress}%
                  </div>
                  <Progress value={uploadProgress} className="h-1.5" />
                </div>
              )}
            </CardHeader>

            <CardContent className="p-0">
              {!appKey ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
                  <Settings className="h-10 w-10 opacity-30" />
                  <p className="text-sm">请先配置 App Key</p>
                  <Button
                    size="sm"
                    onClick={() => setShowKeyDialog(true)}
                    className="gap-1"
                  >
                    <Settings className="h-3.5 w-3.5" />
                    配置 App Key
                  </Button>
                </div>
              ) : loadingFiles ? (
                <div className="p-4 space-y-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : files.length === 0 ? (
                /* The implementation requirement: distinguish "drive truly empty" from
                   "search filtered out everything". The storage card
                   above still shows global drive usage which is
                   correct, but pairing it with a generic "暂无文件"
                   misleads the operator into thinking deletion didn't
                   take effect. Only show the upload CTA on the truly-
                   empty path. */
                search.trim() !== '' ? (
                  <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
                    <Search className="h-10 w-10 opacity-30" />
                    <p className="text-sm">
                      没有匹配「<span className="text-foreground">{search}</span>」的文件
                    </p>
                    <p className="text-xs">顶部「存储空间」为整个云盘总览，不受当前搜索影响。</p>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => { setSearchInput(''); setSearch(''); setPage(1); }}
                      className="gap-1"
                    >
                      清除搜索
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
                    <HardDrive className="h-10 w-10 opacity-30" />
                    <p className="text-sm">暂无文件</p>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => fileInputRef.current?.click()}
                      className="gap-1"
                    >
                      <Upload className="h-3.5 w-3.5" />
                      上传第一个文件
                    </Button>
                  </div>
                )
              ) : (
                <>
                {selectedIds.size > 0 && (
                  <div className="flex flex-wrap items-center gap-2 px-4 py-2 bg-primary/5 border-b">
                    <span className="text-xs text-muted-foreground">已选 {selectedIds.size} 个文件</span>
                    <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={handleBatchDownload} disabled={batchDownloading}>
                      {batchDownloading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                      {batchDownloading ? `下载中 ${batchDownloadProgress}` : '批量下载'}
                    </Button>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 gap-1 text-xs text-red-600 border-red-200 hover:bg-red-50"
                            onClick={() => setShowBatchDeleteConfirm(true)}
                            disabled={batchDeleting || selectedIds.size > BATCH_DELETE_LIMIT}
                          >
                            <Trash2 className="h-3 w-3" />批量删除
                          </Button>
                        </span>
                      </TooltipTrigger>
                      {selectedIds.size > BATCH_DELETE_LIMIT && (
                        <TooltipContent>单次最多删除 {BATCH_DELETE_LIMIT} 个文件</TooltipContent>
                      )}
                    </Tooltip>
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSelectedIds(new Set())}>取消选择</Button>
                  </div>
                )}
                <div className="divide-y md:hidden">
                  {files.map((file) => {
                    const cat = getCategoryLabel(file.category, file.suffix);
                    const selected = selectedIds.has(file.file_id);
                    return (
                      <div
                        key={file.file_id}
                        data-testid="cloud-file-mobile-row"
                        className={`space-y-3 p-4 ${selected ? 'bg-primary/5' : ''}`}
                      >
                        <div className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            className="mt-1 shrink-0 rounded border-gray-300"
                            checked={selected}
                            onChange={() => toggleSelect(file.file_id)}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 items-center gap-2">
                              {getFileIcon(file.suffix)}
                              <p className="min-w-0 truncate text-sm font-medium" title={file.file_name}>
                                {file.file_name}
                              </p>
                            </div>
                            <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                              {file.file_id.slice(0, 8)}...
                            </p>
                          </div>
                          <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${cat.color}`}>
                            {cat.label}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div className="rounded-md bg-muted/40 px-2 py-1.5">
                            <p className="text-muted-foreground">大小</p>
                            <p className="mt-0.5 font-medium">{formatBytes(file.file_size)}</p>
                          </div>
                          <div className="rounded-md bg-muted/40 px-2 py-1.5">
                            <p className="text-muted-foreground">创建时间</p>
                            <p className="mt-0.5 truncate font-medium">{formatDateTime(file.created_at)}</p>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            data-testid={`cloud-file-download-${file.file_id}`}
                            className="h-8 gap-1"
                            onClick={() => handleDownload(file)}
                            disabled={downloadingId === file.file_id}
                          >
                            {downloadingId === file.file_id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Download className="h-3.5 w-3.5" />
                            )}
                            下载
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            data-testid={`cloud-file-delete-${file.file_id}`}
                            className="h-8 gap-1 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                            onClick={() => setDeleteTarget(file)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            删除
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="hidden overflow-x-auto md:block">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/30 hover:bg-muted/30">
                        <TableHead className="w-8 pl-4">
                          <input type="checkbox" className="rounded border-gray-300" checked={files.length > 0 && selectedIds.size === files.length} onChange={toggleSelectAll} />
                        </TableHead>
                        <TableHead>文件名</TableHead>
                        <TableHead className="w-24 text-right">大小</TableHead>
                        <TableHead className="w-16">类型</TableHead>
                        <TableHead className="w-40">创建时间</TableHead>
                        <TableHead className="w-24 text-right pr-4">操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {files.map((file) => {
                        const cat = getCategoryLabel(file.category, file.suffix);
                        return (
                          <TableRow key={file.file_id} className={`hover:bg-muted/20 ${selectedIds.has(file.file_id) ? 'bg-primary/5' : ''}`}>
                            <TableCell className="pl-4">
                              <input type="checkbox" className="rounded border-gray-300" checked={selectedIds.has(file.file_id)} onChange={() => toggleSelect(file.file_id)} />
                            </TableCell>
                            <TableCell>
                              <div className="max-w-xs">
                                <p className="text-sm font-medium truncate" title={file.file_name}>
                                  {file.file_name}
                                </p>
                                <p className="text-xs text-muted-foreground font-mono">
                                  {file.file_id.slice(0, 8)}…
                                </p>
                              </div>
                            </TableCell>
                            <TableCell className="text-right text-sm text-muted-foreground">
                              {formatBytes(file.file_size)}
                            </TableCell>
                            <TableCell>
                              <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${cat.color}`}>
                                {cat.label}
                              </span>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {formatDateTime(file.created_at)}
                            </TableCell>
                            <TableCell className="text-right pr-4">
                              <div className="flex items-center justify-end gap-1">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="h-7 w-7"
                                      onClick={() => handleDownload(file)}
                                      disabled={downloadingId === file.file_id}
                                    >
                                      {downloadingId === file.file_id ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      ) : (
                                        <Download className="h-3.5 w-3.5" />
                                      )}
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>下载</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="h-7 w-7 text-red-500 hover:text-red-600 hover:bg-red-50"
                                      onClick={() => setDeleteTarget(file)}
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>删除</TooltipContent>
                                </Tooltip>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                </>
              )}

              {/* Pagination */}
              {fileListData && fileListData.total_pages > 1 && (
                <div className="flex flex-col gap-2 px-4 py-3 border-t sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs text-muted-foreground">
                    共 {fileListData.total} 个文件，第 {fileListData.page} / {fileListData.total_pages} 页
                  </p>
                  <div className="flex flex-wrap items-center gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 w-7 p-0"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => p - 1)}
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </Button>
                    {Array.from({ length: Math.min(fileListData.total_pages, 7) }, (_, i) => {
                      const p = i + 1;
                      return (
                        <Button
                          key={p}
                          size="sm"
                          variant={p === page ? 'default' : 'outline'}
                          className="h-7 w-7 p-0 text-xs"
                          onClick={() => setPage(p)}
                        >
                          {p}
                        </Button>
                      );
                    })}
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 w-7 p-0"
                      disabled={page >= fileListData.total_pages}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </main>

        {/* Upload Dialog */}
        <Dialog
          open={showUploadDialog}
          onOpenChange={(open) => {
            if (!open) {
              setShowUploadDialog(false);
              setUploadError('');
              setTransferError('');
              setTransferLink('');
            }
          }}
        >
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Upload className="h-4 w-4" />
                上传文件
              </DialogTitle>
              <DialogDescription>选择上传方式将文件存入个人云盘</DialogDescription>
            </DialogHeader>

            <Tabs value={uploadTab} onValueChange={(v) => setUploadTab(v as any)}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="local" className="gap-1.5">
                  <FolderOpen className="h-3.5 w-3.5" />
                  本地上传
                </TabsTrigger>
                <TabsTrigger value="transfer" className="gap-1.5">
                  <Globe className="h-3.5 w-3.5" />
                  上传转存任务
                </TabsTrigger>
              </TabsList>

              {/* ─ Tab 1: 本地上传 ─ */}
              <TabsContent value="local" className="mt-4 space-y-4">
                <div
                  className="border-2 border-dashed border-muted-foreground/30 rounded-lg p-8 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50/50 transition-all"
                  onClick={() => !uploading && fileInputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const file = e.dataTransfer.files?.[0];
                    if (file && !uploading) {
                      const dt = new DataTransfer();
                      dt.items.add(file);
                      if (fileInputRef.current) {
                        fileInputRef.current.files = dt.files;
                        fileInputRef.current.dispatchEvent(new Event('change', { bubbles: true }));
                      }
                    }
                  }}
                >
                  {uploading ? (
                    <div className="space-y-3">
                      <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
                      <p className="text-sm text-primary font-medium">上传中... {uploadProgress ?? 0}%</p>
                      <Progress value={uploadProgress ?? 0} className="h-2" />
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Upload className="h-8 w-8 text-muted-foreground/50 mx-auto" />
                      <p className="text-sm font-medium">点击或拖拽文件到此处</p>
                      <p className="text-xs text-muted-foreground">支持的格式：{ALL_SUPPORTED_ACCEPT_ATTR}</p>
                    </div>
                  )}
                </div>
                {uploadError && (
                  <p className="text-xs text-red-500 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />{uploadError}
                  </p>
                )}
                <DialogFooter>
                  <Button variant="outline" onClick={() => setShowUploadDialog(false)} disabled={uploading}>取消</Button>
                  <Button onClick={() => fileInputRef.current?.click()} disabled={uploading} className="gap-1">
                    {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderOpen className="h-3.5 w-3.5" />}
                    选择文件
                  </Button>
                </DialogFooter>
              </TabsContent>

              {/* ─ Tab 2: 上传转存任务 ─ */}
              <TabsContent value="transfer" className="mt-4 space-y-4">
                <div className="space-y-2">
                  <Label>链接地址</Label>
                  <Textarea
                    placeholder={'支持可下载的 URL 链接，也支持百度网盘分享链接\n例：https://example.com/video.mp4'}
                    value={transferLink}
                    onChange={(e) => setTransferLink(e.target.value)}
                    className="min-h-[80px] resize-none text-sm"
                    disabled={transferring}
                  />
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Link2 className="h-3 w-3" />
                    支持直接下载链接（HTTP/HTTPS）或百度网盘分享文本
                  </p>
                </div>
                {transferError && (
                  <p className="text-xs text-red-500 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />{transferError}
                  </p>
                )}
                <DialogFooter>
                  <Button variant="outline" onClick={() => setShowUploadDialog(false)} disabled={transferring}>取消</Button>
                  <Button
                    onClick={handleTransferSubmit}
                    disabled={transferring || !transferLink.trim()}
                    className="gap-1"
                  >
                    {transferring ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Globe className="h-3.5 w-3.5" />}
                    {transferring ? '提交中...' : '创建转存任务'}
                  </Button>
                </DialogFooter>
              </TabsContent>
            </Tabs>
          </DialogContent>
        </Dialog>

        {/* Transfer Tasks Dialog */}
        <Dialog open={showTransferDialog} onOpenChange={setShowTransferDialog}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Globe className="h-4 w-4" />
                转存任务
              </DialogTitle>
              <DialogDescription>查看最近的转存任务状态</DialogDescription>
            </DialogHeader>
            <div className="min-w-0 space-y-2">
              {/* 工具栏 */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {transferTasks.length > 0 && (
                    <>
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 cursor-pointer"
                        checked={selectedTransferIds.size === transferTasks.length && transferTasks.length > 0}
                        onChange={e => setSelectedTransferIds(e.target.checked ? new Set(transferTasks.map(t => t.file_id)) : new Set())}
                      />
                      <span className="text-xs text-muted-foreground">全选</span>
                      {selectedTransferIds.size > 0 && (
                        <Button
                          variant="destructive" size="sm"
                          className="h-6 px-2 text-xs gap-1"
                          onClick={() => handleDeleteTransferTasks(Array.from(selectedTransferIds))}
                          disabled={deletingTransferIds.size > 0}
                        >
                          <Trash2 className="h-3 w-3" />
                          删除所选 ({selectedTransferIds.size})
                        </Button>
                      )}
                    </>
                  )}
                </div>
                <Button variant="ghost" size="sm" onClick={() => fetchTransferTasks()} className="gap-1 text-muted-foreground h-7 text-xs">
                  <RefreshCw className="h-3 w-3" />刷新
                </Button>
              </div>

              {loadingTransfers ? (
                <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
              ) : transferTasks.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 gap-2 text-muted-foreground">
                  <Globe className="h-8 w-8 opacity-30" />
                  <p className="text-sm">暂无转存任务</p>
                </div>
              ) : (
                <div className="max-h-[400px] overflow-y-auto space-y-1 rounded border bg-muted/20 p-2">
                  {transferTasks.map((t) => {
                    const statusMap: Record<number, { label: string; color: string; icon: React.ReactNode }> = {
                      0: { label: '初始化', color: 'text-gray-500',  icon: <Clock className="h-3 w-3" /> },
                      1: { label: '上传中', color: 'text-blue-500',  icon: <Loader2 className="h-3 w-3 animate-spin" /> },
                      2: { label: '已完成', color: 'text-green-600', icon: <CheckCircle2 className="h-3 w-3" /> },
                      3: { label: '失败',   color: 'text-red-500',   icon: <XCircle className="h-3 w-3" /> },
                      4: { label: '已删除', color: 'text-gray-400',  icon: <XCircle className="h-3 w-3" /> },
                    };
                    const s = statusMap[t.status] ?? statusMap[0];
                    const isDeleting = deletingTransferIds.has(t.file_id);
                    const isSelected = selectedTransferIds.has(t.file_id);
                    return (
                      <div key={t.file_id} className={`flex min-w-0 flex-col gap-1 py-1.5 px-2 rounded transition-colors ${isSelected ? 'bg-primary/10' : 'hover:bg-muted/40'}`}>
                        <div className="flex min-w-0 items-center gap-2 text-xs">
                          <input
                            type="checkbox"
                            className="h-3.5 w-3.5 shrink-0 cursor-pointer"
                            checked={isSelected}
                            onChange={e => setSelectedTransferIds(prev => {
                              const s = new Set(prev);
                              e.target.checked ? s.add(t.file_id) : s.delete(t.file_id);
                              return s;
                            })}
                          />
                          <span className={`shrink-0 ${s.color}`}>{s.icon}</span>
                          <div className="min-w-0 flex-1">
                            <span className="block truncate" title={t.file_name || t.original_name}>
                              {t.file_name || t.original_name}
                            </span>
                          </div>
                          {t.file_size && (
                            <span className="shrink-0 text-muted-foreground">
                              {formatBytes(Number(t.file_size)) /* regression coverage: reuse the file-list formatter so the transfer row reads "52.84 MB" instead of "55403403" */}
                            </span>
                          )}
                          <span className={`shrink-0 ${s.color}`}>{s.label}</span>
                          {t.status === 1 && t.progress > 0 && (
                            <span className="shrink-0 text-blue-500">{t.progress}%</span>
                          )}
                          <button
                            type="button"
                            onClick={() => handleDeleteTransferTasks([t.file_id])}
                            disabled={isDeleting}
                            className="shrink-0 text-muted-foreground hover:text-red-500 disabled:opacity-40 transition-colors ml-0.5"
                            title="删除"
                          >
                            {isDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                          </button>
                        </div>
                        {t.status === 3 && t.error_message && (
                          <p
                            className="pl-7 text-[11px] leading-tight text-red-500 truncate"
                            title={t.error_message}
                          >
                            {t.error_message}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>

        {/* App Key Dialog */}
        <Dialog open={showKeyDialog} onOpenChange={setShowKeyDialog}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Settings className="h-4 w-4" />
                配置 App Key
              </DialogTitle>
              <DialogDescription>
                请输入您的 NarratorAI App Key，安全存储在本地浏览器中，不会上传至任何服务器。
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <Label htmlFor="app-key-input">App Key</Label>
              <div className="relative">
                <Input
                  id="app-key-input"
                  type={showKey ? 'text' : 'password'}
                  placeholder="请输入您的 App Key"
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveKey()}
                  className="pr-10"
                />
                <Button variant="ghost" size="icon" className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                  onClick={() => setShowKey((v) => !v)} type="button">
                  {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              还没有 App Key？请<button type="button" className="text-primary hover:underline font-medium" onClick={() => { setShowKeyDialog(false); setShowContactQR(true); }}>联系部署管理员</button>获取。
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowKeyDialog(false)}>取消</Button>
              <Button onClick={handleSaveKey} disabled={!keyInput.trim()}>保存</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* App Key / Recharge instructions dialog */}
        <Dialog open={showContactQR} onOpenChange={setShowContactQR}>
          <DialogContent className="sm:max-w-xs text-center">
            <DialogHeader>
              <DialogTitle>获取 App Key</DialogTitle>
              <DialogDescription className="text-[11px] leading-tight">请联系当前部署的管理员获取 App Key 或补充点数</DialogDescription>
            </DialogHeader>
          </DialogContent>
        </Dialog>

        {/* Delete Confirm */}
        <AlertDialog
          open={!!deleteTarget}
          onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>确认删除</AlertDialogTitle>
              <AlertDialogDescription>
                确定要删除文件{' '}
                <span className="font-medium text-foreground">「{deleteTarget?.file_name}」</span>
                {' '}吗？此操作不可撤销，文件将被永久删除。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDelete}
                disabled={deleting}
                className="bg-red-500 hover:bg-red-600"
              >
                {deleting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                {deleting ? '删除中...' : '确认删除'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Batch Delete Confirm */}
        <AlertDialog
          open={showBatchDeleteConfirm}
          onOpenChange={(open) => { if (!open) setShowBatchDeleteConfirm(false); }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>批量删除确认</AlertDialogTitle>
              <AlertDialogDescription>
                确定要删除选中的 <span className="font-medium text-foreground">{selectedIds.size}</span> 个文件吗？此操作不可撤销，文件将被永久删除。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={batchDeleting}>取消</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleBatchDelete}
                disabled={batchDeleting}
                className="bg-red-500 hover:bg-red-600"
              >
                {batchDeleting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                {batchDeleting ? '删除中...' : '确认删除'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

      </div>
    </TooltipProvider>
  );
}
