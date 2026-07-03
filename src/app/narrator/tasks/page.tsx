'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { AppNavLink } from '@/components/app-nav-link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Video,
  HardDrive,
  User,
  Settings,
  RefreshCw,
  Eye,
  EyeOff,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Clock,
  XCircle,
  Zap,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Info,
  ListChecks,
  Plus,
  Database,
  FileText,
  Copy,
  Upload,
} from 'lucide-react';
import { useAppKey } from '@/hooks/use-app-key';
import { ThemeToggle } from '@/components/theme-toggle';
import type { NarratorMasterTask, StepRecord } from '@/lib/master-task-types';
import type { WalletTransaction } from '@/lib/wallet-types';
import { isWritingDownstreamStarted } from '@/lib/master-task-writing-lock';
import {
  listMasterTasks,
  getMasterTask,
  replaceMasterTask,
  migrateLocalStorageToDb,
} from '@/lib/master-task-client-store';

const MASTER_STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  pending:   { label: '待处理', color: 'bg-yellow-100 text-yellow-700 border-yellow-200',  icon: <Clock className="h-3 w-3" /> },
  running:   { label: '进行中', color: 'bg-indigo-100 text-indigo-700 border-indigo-200 dark:bg-indigo-950 dark:text-indigo-300 dark:border-indigo-800', icon: <Loader2 className="h-3 w-3 animate-spin" /> },
  paused:    { label: '已暂停', color: 'bg-orange-100 text-orange-700 border-orange-200',  icon: <Clock className="h-3 w-3" /> },
  completed: { label: '已完成', color: 'bg-green-100 text-green-700 border-green-200',     icon: <CheckCircle2 className="h-3 w-3" /> },
  failed:    { label: '已失败', color: 'bg-red-100 text-red-700 border-red-200',            icon: <XCircle className="h-3 w-3" /> },
  cancelled: { label: '已取消', color: 'bg-gray-100 text-gray-600 border-gray-200',        icon: <XCircle className="h-3 w-3" /> },
};

const STEP_LABELS: Record<string, string> = {
  subtitle_extract: '字幕提取', subtitle_removal: '字幕擦除',
  subsync: '字幕对齐', popular_learning: '爆款学习',
  generate_writing: '二创文案', fast_generate_writing: '原创文案',
  generate_fast_writing_clip_data: '快速剪辑脚本',
  clip_data: '剪辑脚本', video_composing: '合成视频', completed: '全部完成',
};
const WRITING_TYPE_LABELS: Record<number, string> = { 0: '二创文案', 1: '原创（纯解说）', 2: '原创（原声混剪）' };
const NARRATOR_TYPE_OPTIONS = ['电影', '多语种电影', '第一人称电影', '第一人称多语种', '短剧'];

// Base URL of the CDN where the backend orchestrator publishes preview
// media (posters, generated videos). Override per deployment via
// `NEXT_PUBLIC_PREVIEW_DOMAIN`; falls back to a placeholder that
// self-hosters should replace before enabling deliverable previews.
const PREVIEW_DOMAIN =
  process.env.NEXT_PUBLIC_PREVIEW_DOMAIN ?? 'https://preview-media.example';

interface TaskResultPayload {
  raw_results?: {
    tasks?: TaskResultPayload[];
    file_ids?: string[];
  };
  tasks?: TaskResultPayload[];
  file_ids?: string[];
  order_info?: {
    learning_model_id?: string;
    result?: string;
  };
  learning_model_id?: string;
  file_id?: string;
  task_result?: string;
  video_url?: string;
  project_zip?: string;
}

function maskPreviewUrl(url: string): string {
  // Mask app key in paths like /user_data/{key}/...
  return url.replace(/(\/user_data\/)([^/]+)(\/)/g, '$1***$3');
}

function getStepDeliverables(key: string, step?: StepRecord | null): { label: string; url: string; fileId?: string }[] {
  if (!step?.result || step.status !== 'completed') return [];
  const r = step.result as TaskResultPayload;
  const deliverables: { label: string; url: string; fileId?: string }[] = [];

  if (key === 'popular_learning') {
    const modelId = r.learning_model_id;
    if (modelId) deliverables.push({ label: '爆款学习模型ID', url: modelId });
  }

  if (key === 'generate_writing') {
    const taskResult = r.raw_results?.tasks?.[0]?.task_result;
    if (taskResult) {
      const url = `${PREVIEW_DOMAIN}/${encodeURI(taskResult)}`;
      deliverables.push({ label: '二创文案地址', url });
    } else if (r.file_id) {
      deliverables.push({ label: '二创文案下载', url: '', fileId: r.file_id });
    }
  }

  if (key === 'clip_data' || key === 'generate_fast_writing_clip_data') {
    let clipPath: string | undefined;
    try {
      const taskResult = r.raw_results?.tasks?.[0]?.task_result;
      if (taskResult) clipPath = JSON.parse(taskResult)?.clip_data_file;
    } catch {}
    if (clipPath) {
      deliverables.push({ label: '剪辑脚本地址', url: `${PREVIEW_DOMAIN}/${encodeURI(clipPath)}` });
    }
  }

  if (key === 'video_composing') {
    const videoUrl = r.video_url ?? r.raw_results?.tasks?.[0]?.video_url;
    if (videoUrl) deliverables.push({ label: '成品视频地址', url: videoUrl.startsWith('http') ? videoUrl : `${PREVIEW_DOMAIN}/${encodeURI(videoUrl)}` });
    const projectZip = r.project_zip ?? r.raw_results?.tasks?.[0]?.project_zip;
    if (projectZip) deliverables.push({ label: '工程文件地址', url: projectZip.startsWith('http') ? projectZip : `${PREVIEW_DOMAIN}/${encodeURI(projectZip)}` });
  }

  return deliverables;
}

function getNextStepCost(task: NarratorMasterTask): string {
  const budget = task.budget_snapshot;
  if (!budget) return '—';
  switch (task.current_step) {
    case 'subtitle_extract': case 'subtitle_removal': return '按视频时长计费';
    case 'subsync': return '0（免费）';
    case 'popular_learning': return String(budget.learning_points ?? 0);
    case 'generate_writing': case 'fast_generate_writing': return String(budget.writing_points ?? 0);
    case 'generate_fast_writing_clip_data': case 'clip_data': case 'video_composing': return String(budget.composing_points ?? 0);
    default: return '—';
  }
}

const STEP_STATUS_COLOR: Record<string, string> = {
  pending: 'text-muted-foreground', running: 'text-primary', completed: 'text-green-600',
  failed: 'text-red-600', skipped: 'text-muted-foreground/30',
};
const STEP_STATUS_LABEL: Record<string, string> = {
  pending: '等待中', running: '进行中', completed: '已完成', failed: '已失败', skipped: '已跳过',
};

function StepDots({ steps }: { steps: NarratorMasterTask['steps'] }) {
  const order: (keyof typeof steps)[] = ['subtitle_extract', 'subtitle_removal', 'subsync', 'popular_learning', 'generate_writing', 'fast_generate_writing', 'generate_fast_writing_clip_data', 'clip_data', 'video_composing'];
  return (
    <div className="flex items-center gap-1">
      {order.map((k) => {
        const s = steps[k];
        if (!s) return <span key={k} className="w-2 h-2 rounded-full bg-border" title={STEP_LABELS[k]} />;
        const color = s.status === 'completed' ? 'bg-green-500' : s.status === 'running' ? 'bg-primary animate-pulse' : s.status === 'failed' ? 'bg-red-500' : s.status === 'skipped' ? 'bg-muted-foreground/20' : 'bg-yellow-400';
        return <span key={k} className={`w-2 h-2 rounded-full ${color}`} title={`${STEP_LABELS[k]}: ${s.status}`} />;
      })}
    </div>
  );
}

function DeliverableItem({ label, url, fileId, appKey }: { label: string; url: string; fileId?: string; appKey: string }) {
  const [downloading, setDownloading] = React.useState(false);
  const handleDownload = async () => {
    if (!fileId || !appKey) return;
    setDownloading(true);
    try {
      const res = await fetch('/api/cloud-drive/download-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-app-key': appKey },
        body: JSON.stringify({ file_id: fileId }),
      });
      const j = await res.json();
      if (j.success && j.data?.url) {
        window.open(j.data.url, '_blank');
      } else {
        alert(j.error || '获取下载链接失败');
      }
    } catch { alert('获取下载链接失败'); }
    finally { setDownloading(false); }
  };
  return (
    <div className="rounded bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 px-2 py-1">
      <p className="text-xs text-green-700 dark:text-green-400 font-medium mb-0.5">{label}</p>
      {fileId ? (
        <button type="button" onClick={handleDownload} disabled={downloading}
          className="text-xs text-primary hover:underline break-all disabled:opacity-50">
          {downloading ? '获取链接中…' : '点击下载文件'}
        </button>
      ) : url.startsWith('http') ? (
        <a href={url} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline break-all">{maskPreviewUrl(url)}</a>
      ) : (
        <p className="text-xs text-green-800 dark:text-green-300 break-all font-mono">{maskPreviewUrl(url)}</p>
      )}
    </div>
  );
}

function formatDate(str?: string) {
  if (!str) return '—';
  return new Date(str).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function NarratorTasksPage() {
  const { appKey, setAppKey, loaded } = useAppKey();

  const [showKeyDialog, setShowKeyDialog] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [showContactQR, setShowContactQR] = useState(false);

  // ── 总任务 ───────────────────────────────────────
  const [masterTasks, setMasterTasks] = useState<NarratorMasterTask[]>([]);
  const [masterPage, setMasterPage] = useState(1);
  const [loadingMaster, setLoadingMaster] = useState(false);
  const [masterDetail, setMasterDetail] = useState<NarratorMasterTask | null>(null);
  const [showMasterDetail, setShowMasterDetail] = useState(false);
  const [txDetail, setTxDetail] = useState<WalletTransaction | null>(null);
  const [loadingTxDetail, setLoadingTxDetail] = useState(false);
  const [showWritingDialog, setShowWritingDialog] = useState(false);
  const [writingLoading, setWritingLoading] = useState(false);
  const [writingSaving, setWritingSaving] = useState(false);
  const [writingEditMode, setWritingEditMode] = useState(false);
  // regression coverage: once any downstream stage (clip / video composing) has started,
  // the writing entry should expose 查看-only and hide the 编辑/导入 paths.
  const [writingViewOnly, setWritingViewOnly] = useState(false);
  const [writingTaskId, setWritingTaskId] = useState('');
  const [writingFileId, setWritingFileId] = useState('');
  const [writingContent, setWritingContent] = useState<Array<{ type: string; text: string }>>([]);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importText, setImportText] = useState('');
  const [writingImported, setWritingImported] = useState(false);
  const [continuingId, setContinuingId] = useState<string | null>(null);
  const [syncingIds, setSyncingIds] = useState<Set<string>>(new Set());
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [masterFilterType, setMasterFilterType] = useState('all');
  const [masterFilterStep, setMasterFilterStep] = useState('all');
  const [masterFilterStatus, setMasterFilterStatus] = useState('all');
  const [showContinueConfirm, setShowContinueConfirm] = useState(false);
  const [continueTarget, setContinueTarget] = useState<NarratorMasterTask | null>(null);

  const filteredMasterTasks = useMemo(() => {
    return masterTasks.filter(t => {
      if (masterFilterType !== 'all' && (t.narrator_type_label || t.narrator_type) !== masterFilterType) return false;
      if (masterFilterStep !== 'all' && t.current_step !== masterFilterStep) return false;
      if (masterFilterStatus !== 'all' && t.status !== masterFilterStatus) return false;
      return true;
    });
  }, [masterTasks, masterFilterType, masterFilterStep, masterFilterStatus]);

  const handleContinueNextStep = async (t: NarratorMasterTask) => {
    setContinuingId(t.narrator_task_id);
    try {
      const task = (await getMasterTask(t.narrator_task_id, appKey)) ?? t;
      const r = await fetch(`/api/narrator/master-tasks/${t.narrator_task_id}/next-step`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-app-key': appKey },
        body: JSON.stringify({ task }),
      });
      const j = await r.json();
      if (j.data) await replaceMasterTask(t.narrator_task_id, j.data, appKey);
      if (j.success) {
        if (j.all_done) showToast('success', '所有步骤已全部完成！');
        else showToast('success', `已提交下一步：${STEP_LABELS[j.next_step] ?? j.next_step}`);
        fetchMasterTasks();
      } else if (j.still_running) {
        showToast('success', '当前步骤仍在进行中，请稍后再试');
      } else {
        showToast('error', j.error || '继续失败');
      }
    } catch { showToast('error', '网络错误'); }
    finally { setContinuingId(null); }
  };

  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const showToast = useCallback((type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const LIMIT = 15;
  const masterTotalPages = Math.max(1, Math.ceil(filteredMasterTasks.length / LIMIT));
  const pagedMasterTasks = useMemo(() => {
    return filteredMasterTasks.slice((masterPage - 1) * LIMIT, masterPage * LIMIT);
  }, [filteredMasterTasks, masterPage]);

  const fetchMasterTasks = useCallback(async () => {
    if (!appKey) return;
    setLoadingMaster(true);
    try {
      const { items } = await listMasterTasks({ app_key: appKey, limit: 9999 });
      setMasterTasks(items);
      // 加载后立即对 running 状态任务触发一次静默同步（异步、不阻塞）
      const runningTasks = items.filter(t => t.status === 'running');
      if (runningTasks.length > 0) {
        setTimeout(() => runningTasks.forEach(t => {
          fetch(`/api/narrator/master-tasks/${t.narrator_task_id}/sync`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-app-key': appKey },
            body: JSON.stringify({ task: t }),
          }).then(r => r.json()).then(j => {
            if (j.success && j.synced && j.data) {
              replaceMasterTask(t.narrator_task_id, j.data, appKey);
              fetchMasterTasks();
            }
          }).catch(() => {});
        }), 200);
      }
    } catch {} finally { setLoadingMaster(false); }
  }, [appKey]);

  const syncMasterTask = useCallback(async (taskId: string, silent = true) => {
    if (!appKey) return;
    const task = await getMasterTask(taskId, appKey);
    if (!task) return;
    setSyncingIds(prev => new Set(prev).add(taskId));
    try {
      const r = await fetch(`/api/narrator/master-tasks/${taskId}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-app-key': appKey },
        body: JSON.stringify({ task }),
      });
      const j = await r.json();
      if (!j.success) { if (!silent) showToast('error', j.error || '同步失败'); return; }
      if (j.synced) {
        if (j.data) await replaceMasterTask(taskId, j.data, appKey);
        fetchMasterTasks();
        if (!silent) {
          if (j.all_done)          showToast('success', '所有步骤已全部完成!');
          else if (j.auto_advanced) showToast('success', `已自动推进→ ${STEP_LABELS[j.next_step] ?? j.next_step}`);
          else if (j.step_done)    showToast('success', `步骤已完成，可点「继续」推进: ${STEP_LABELS[j.next_step] ?? j.next_step}`);
          else if (j.failed)       showToast('error', '远程任务失败');
        } else if (j.auto_advanced) {
          showToast('success', `一站式自动推进 → ${STEP_LABELS[j.next_step] ?? j.next_step}`);
        }
      }
    } catch { if (!silent) showToast('error', '网络错误'); }
    finally { setSyncingIds(prev => { const s = new Set(prev); s.delete(taskId); return s; }); }
  }, [appKey, fetchMasterTasks, showToast]);

  // 自动轮询：对所有 running 状态的总任务每 15s 同步一次
  useEffect(() => {
    const runningTasks = masterTasks.filter(t => t.status === 'running');
    if (pollingRef.current) clearInterval(pollingRef.current);
    if (runningTasks.length === 0) return;
    pollingRef.current = setInterval(() => {
      runningTasks.forEach(t => syncMasterTask(t.narrator_task_id, true));
    }, 15000);
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, [masterTasks, syncMasterTask]);

  // 总任务：仅在 appKey 变化或首次加载时获取
  useEffect(() => {
    if (!loaded || !appKey) return;
    migrateLocalStorageToDb(appKey).catch(() => {}).then(() => fetchMasterTasks());
    setMasterPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, appKey]);

  // Fetch live wallet transaction (with billing_summary) when detail dialog opens
  useEffect(() => {
    const txId = masterDetail?.wallet_transaction?.transaction_id;
    if (!showMasterDetail || !txId || !appKey) { setTxDetail(null); return; }
    setLoadingTxDetail(true);
    fetch(`/api/narrator/wallet/transactions/${txId}`, { headers: { 'x-app-key': appKey } })
      .then(r => r.json())
      .then(json => { if (json.success && json.data) setTxDetail(json.data as WalletTransaction); })
      .catch(() => {})
      .finally(() => setLoadingTxDetail(false));
  }, [showMasterDetail, masterDetail?.wallet_transaction?.transaction_id, appKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const serializeWriting = (content: Array<{ type: string; text: string }>) =>
    content.map(i => `[${i.type}]${i.text}`).join('\n');

  const parseWriting = (text: string): Array<{ type: string; text: string }> | null => {
    const lines = text.split('\n');
    const result: Array<{ type: string; text: string }> = [];
    const pattern = /^\[(解说|原片)\](.*)$/;
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      const m = line.match(pattern);
      if (!m) return null;
      result.push({ type: m[1], text: m[2] });
    }
    return result.length > 0 ? result : null;
  };

  const openWritingDialog = (taskId: string, fileId?: string, viewOnly = false) => {
    setWritingTaskId(taskId);
    setWritingFileId(fileId || '');
    setWritingContent([]);
    setWritingEditMode(false);
    setWritingViewOnly(viewOnly);
    setWritingLoading(true);
    setShowWritingDialog(true);
    const qs = new URLSearchParams({ task_id: taskId });
    if (fileId) qs.set('file_id', fileId);
    fetch(`/api/narrator/commentary/writing?${qs}`, { headers: { 'x-app-key': appKey || '' } })
      .then(r => r.json())
      .then(json => {
        if (json.success && json.data) {
          setWritingContent(json.data.content || []);
          setWritingFileId(json.data.file_id || fileId || '');
        } else {
          showToast('error', json.error || '获取文案失败');
          setShowWritingDialog(false);
        }
      })
      .catch(() => { showToast('error', '获取文案失败'); setShowWritingDialog(false); })
      .finally(() => setWritingLoading(false));
  };

  const saveWritingContent = async () => {
    if (!writingTaskId || !writingFileId) return;
    setWritingSaving(true);
    try {
      const res = await fetch('/api/narrator/commentary/writing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-app-key': appKey || '' },
        body: JSON.stringify({ task_id: writingTaskId, file_id: writingFileId, content: writingContent }),
      });
      const json = await res.json();
      if (json.success) {
        showToast('success', '文案已保存');
        setWritingEditMode(false);
        setWritingImported(false);
      } else {
        showToast('error', json.error || '保存失败');
      }
    } catch {
      showToast('error', '保存失败');
    } finally {
      setWritingSaving(false);
    }
  };

  const handleSaveKey = () => {
    const trimmed = keyInput.trim();
    if (!trimmed) return;
    setAppKey(trimmed);
    setShowKeyDialog(false);
    setKeyInput('');
    showToast('success', 'App Key 已保存');
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header / Nav */}
      <header className="border-b bg-card/80 backdrop-blur-sm sticky top-0 z-30">
        <div className="container mx-auto px-4 py-0 flex items-center justify-between h-14">
          <AppNavLink href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <img src="/images/logo-light.png" alt="AI 解说大师" className="h-[1.6rem] w-auto dark:hidden" />
            <img src="/images/logo-dark.svg" alt="AI 解说大师" className="hidden h-[1.6rem] w-auto dark:block" />
          </AppNavLink>
          <nav className="flex items-center gap-1">
            <AppNavLink href="/"><Button variant="ghost" size="sm" className="gap-1.5"><Zap className="h-4 w-4" />爆款解说</Button></AppNavLink>
            <Button variant="default" size="sm" className="gap-1.5"><ListChecks className="h-4 w-4" />任务记录</Button>
            <AppNavLink href="/cloud-drive"><Button variant="ghost" size="sm" className="gap-1.5"><HardDrive className="h-4 w-4" />个人云盘</Button></AppNavLink>
            <AppNavLink href="/account"><Button variant="ghost" size="sm" className="gap-1.5"><User className="h-4 w-4" />个人中心</Button></AppNavLink>
            <ThemeToggle className="ml-1" />
          </nav>
        </div>
      </header>

      <main className="flex-1 container mx-auto px-4 py-6 max-w-6xl">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-lg font-semibold flex items-center gap-2"><ListChecks className="h-5 w-5 text-primary" />任务记录</h1>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => fetchMasterTasks()} disabled={loadingMaster || !appKey} className="gap-1.5">
              <RefreshCw className={`h-3.5 w-3.5 ${loadingMaster ? 'animate-spin' : ''}`} />刷新
            </Button>
          </div>
        </div>

        {/* ── 总任务表格 ── (regression coverage: 子任务对用户不开放，去掉了 tab 切换) */}
          <Card className="mb-4">
            <CardContent className="py-3 px-4">
              <div className="flex flex-wrap gap-3 items-center">
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground whitespace-nowrap">解说类型</Label>
                  <Select value={masterFilterType} onValueChange={v => { setMasterFilterType(v); setMasterPage(1); }}>
                    <SelectTrigger className="h-8 w-[120px] text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">全部</SelectItem>
                      {NARRATOR_TYPE_OPTIONS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground whitespace-nowrap">当前步骤</Label>
                  <Select value={masterFilterStep} onValueChange={v => { setMasterFilterStep(v); setMasterPage(1); }}>
                    <SelectTrigger className="h-8 w-[120px] text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">全部</SelectItem>
                      {Object.entries(STEP_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground whitespace-nowrap">状态</Label>
                  <Select value={masterFilterStatus} onValueChange={v => { setMasterFilterStatus(v); setMasterPage(1); }}>
                    <SelectTrigger className="h-8 w-[120px] text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">全部</SelectItem>
                      {Object.entries(MASTER_STATUS_CONFIG)
                        .filter(([k]) => k !== 'pending' && k !== 'cancelled')
                        .map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-0">
              {!appKey ? (
                <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
                  <Settings className="h-10 w-10 opacity-30" /><p className="text-sm">请先配置 App Key</p>
                  <Button size="sm" onClick={() => setShowKeyDialog(true)}>配置 App Key</Button>
                </div>
              ) : loadingMaster ? (
                <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
              ) : pagedMasterTasks.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
                  <Database className="h-10 w-10 opacity-20" />
                  <p className="text-sm">暂无总任务记录</p>
                  <p className="text-sm">前往爆款解说页面创建任务</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>电影/短剧</TableHead>
                      <TableHead>类型</TableHead>
                      <TableHead>当前步骤</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>预估点数</TableHead>
                      <TableHead>创建时间</TableHead>
                      <TableHead className="w-[60px]">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pagedMasterTasks.map((t) => {
                      const sc = MASTER_STATUS_CONFIG[t.status] ?? MASTER_STATUS_CONFIG['pending'];
                      return (
                        <TableRow key={t.narrator_task_id} className="hover:bg-muted/50">
                          <TableCell className="text-xs truncate max-w-[140px]" title={t.playlet_name || '—'}>{t.playlet_name || '—'}</TableCell>
                          <TableCell><span className="text-xs">{t.narrator_type_label || t.narrator_type}</span></TableCell>
                          <TableCell><span className="text-xs text-muted-foreground">{t.current_step ? (STEP_LABELS[t.current_step] ?? t.current_step) : '—'}</span></TableCell>
                          <TableCell>
                            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${sc.color}`}>{sc.icon}{sc.label}</span>
                          </TableCell>
                          <TableCell className="text-sm tabular-nums">{t.budget_snapshot?.total_points ?? '—'}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{formatDate(t.created_at)}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-0.5">
                              {/* 🔄 同步按钒：running 状态才需要查远程 */}
                              {t.status === 'running' && (
                                <Button
                                  variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                  disabled={syncingIds.has(t.narrator_task_id)}
                                  onClick={() => syncMasterTask(t.narrator_task_id, false)}
                                  title="同步远程任务状态"
                                >
                                  <RefreshCw className={`h-3.5 w-3.5 ${syncingIds.has(t.narrator_task_id) ? 'animate-spin' : ''}`} />
                                </Button>
                              )}
                              {/* 继续按钒：paused 状态（当前步骤已完成，等待用户手动推进） */}
                              {(t.status === 'paused' && t.run_auto === 0) && (
                                <Button
                                  variant="outline" size="sm"
                                  className="h-7 px-2 text-xs gap-1 text-orange-600 border-orange-300 hover:bg-orange-50"
                                  disabled={continuingId === t.narrator_task_id}
                                  onClick={() => handleContinueNextStep(t)}
                                >
                                  {continuingId === t.narrator_task_id
                                    ? <><Loader2 className="h-3 w-3 animate-spin" />继续中</>
                                    : <><ArrowRight className="h-3 w-3" />继续{t.current_step ? STEP_LABELS[t.current_step] ?? '' : ''}</>}
                                </Button>
                              )}
                              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-primary hover:text-primary hover:bg-primary/10" onClick={() => { setMasterDetail(t); setShowMasterDetail(true); }}>
                                详情
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
            {filteredMasterTasks.length > LIMIT && (
              <div className="flex items-center justify-between px-4 py-3 border-t">
                <span className="text-xs text-muted-foreground">第 {masterPage} / {masterTotalPages} 页</span>
                <div className="flex gap-1">
                  <Button variant="outline" size="icon" className="h-7 w-7" disabled={masterPage <= 1} onClick={() => setMasterPage(p => p - 1)}><ChevronLeft className="h-3.5 w-3.5" /></Button>
                  <Button variant="outline" size="icon" className="h-7 w-7" disabled={masterPage >= masterTotalPages} onClick={() => setMasterPage(p => p + 1)}><ChevronRight className="h-3.5 w-3.5" /></Button>
                </div>
              </div>
            )}
          </Card>

      </main>

      {/* Master Task Detail Dialog */}
      <Dialog open={showMasterDetail} onOpenChange={setShowMasterDetail}>
        <DialogContent className="sm:max-w-xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Database className="h-4 w-4" />总任务详情</DialogTitle>
          </DialogHeader>
          {masterDetail && (
            <div className="space-y-4">
              {/* 基本信息 */}
              <div>
                <p className="text-xs font-medium mb-2">基本信息</p>
                <div className="space-y-1.5">
                  {([
                    ['总任务 ID', masterDetail.narrator_task_id],
                    [masterDetail.narrator_type_label === '短剧' ? '短剧名称' : '电影名称', masterDetail.playlet_name || '—'],
                    ['解说类型', `${masterDetail.narrator_type_label} (${masterDetail.narrator_type})`],
                    ['文案类型', WRITING_TYPE_LABELS[masterDetail.writing_type ?? 2] ?? '—'],
                    ['目标平台', masterDetail.target_platform || '—'],
                    ...(masterDetail.writing_type && masterDetail.writing_type > 0 ? [
                      ['文案语言', masterDetail.writing_language || '—'],
                      ['文案模型', masterDetail.writing_model === 'flash' ? '极速版' : masterDetail.writing_model === 'pro' ? '旗舰版' : '—'],
                    ] as [string, string][] : []),
                    ['创建时间', formatDate(masterDetail.created_at)],
                    ['更新时间', formatDate(masterDetail.updated_at)],
                  ] as [string, string][]).map(([label, value]) => (
                    <div key={label} className="flex gap-2 text-xs">
                      <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
                      <span className="font-medium break-all">{value}</span>
                    </div>
                  ))}
                </div>
              </div>
              {/* 素材文件 */}
              <div>
                <p className="text-xs font-medium mb-2">素材文件</p>
                <div className="space-y-1.5">
                  {([
                    ['素材视频', masterDetail.native_video_name],
                    ['素材字幕', masterDetail.native_srt_name],
                    ['学习字幕', masterDetail.learning_srt_name || '—'],
                  ] as [string, string][]).map(([label, value]) => (
                    <div key={label} className="flex gap-2 text-xs">
                      <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
                      <span className="font-medium break-all">{value}</span>
                    </div>
                  ))}
                </div>
              </div>
              {/* 定价钱包 */}
              {masterDetail.wallet_transaction && (
                <div className="space-y-3">
                  <p className="text-xs font-medium">定价钱包</p>
                  <div className="space-y-1.5">
                    {([
                      ['冻结金额', `${masterDetail.wallet_transaction.amount.toFixed(2)} 点`],
                      ['状态', masterDetail.wallet_transaction.status === 'confirmed' ? '已扣费' : masterDetail.wallet_transaction.status === 'refunded' ? '已退款' : masterDetail.wallet_transaction.status === 'frozen' ? '冻结中' : masterDetail.wallet_transaction.status],
                      ['定价版本', masterDetail.wallet_transaction.pricing_rule_version],
                      ['交易ID', masterDetail.wallet_transaction.transaction_id.slice(-12)],
                    ] as [string, string][]).map(([label, value]) => (
                      <div key={label} className="flex gap-2 text-xs">
                        <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
                        <span className={`font-medium tabular-nums ${masterDetail.wallet_transaction?.status === 'confirmed' ? 'text-green-600' : masterDetail.wallet_transaction?.status === 'refunded' ? 'text-amber-600' : ''}`}>{value}</span>
                      </div>
                    ))}
                  </div>
                  {/* 消耗明细（billing_summary，来自 backend review） */}
                  {loadingTxDetail ? (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" /><span>加载明细…</span>
                    </div>
                  ) : txDetail?.billing_summary && (
                    <div className="rounded-md border p-2.5 space-y-1.5 bg-muted/30">
                      <p className="text-xs font-medium text-muted-foreground">消耗明细</p>
                      {([
                        ['标准定价', `${txDetail.billing_summary.hard_price} 点`],
                        ['折扣抵扣', `${txDetail.billing_summary.discount_amount} 点`],
                        ['已退回', `${txDetail.billing_summary.refunded_amount} 点`],
                        ['最终净消耗', txDetail.billing_summary.net_consumption !== null ? `${txDetail.billing_summary.net_consumption} 点` : '待结算'],
                      ] as [string, string][]).map(([label, value]) => (
                        <div key={label} className="flex justify-between text-xs">
                          <span className="text-muted-foreground">{label}</span>
                          <span className={`font-semibold tabular-nums ${label === '最终净消耗' && txDetail.billing_summary?.net_consumption !== null ? 'text-green-600 dark:text-green-400' : label === '已退回' && txDetail.billing_summary?.refunded_amount !== '0.00' ? 'text-amber-600 dark:text-amber-400' : ''}`}>{value}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {/* 预算快照 */}
              {masterDetail.budget_snapshot && !masterDetail.wallet_transaction && (
                <div>
                  <p className="text-xs font-medium mb-2">点数预算</p>
                  <div className="space-y-1.5">
                    {([
                      ['总点数', String(masterDetail.budget_snapshot.total_points)],
                      ['学习点数', String(masterDetail.budget_snapshot.learning_points ?? '—')],
                      ['文案点数', String(masterDetail.budget_snapshot.writing_points ?? '—')],
                      ['合成点数', String(masterDetail.budget_snapshot.composing_points ?? '—')],
                    ] as [string, string][]).map(([label, value]) => (
                      <div key={label} className="flex gap-2 text-xs">
                        <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
                        <span className="font-medium tabular-nums">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {/* 子步骤记录 */}
              <div>
                <p className="text-xs font-medium mb-2">子步骤记录</p>
                <div className="space-y-2">
                  {(() => {
                    const wt = masterDetail.writing_type;
                    const isOriginal = wt === 1 || wt === 2;
                    const allKeys: (keyof typeof masterDetail.steps)[] = [
                      'subsync', 'popular_learning',
                      ...(isOriginal ? ['fast_generate_writing' as const, 'generate_fast_writing_clip_data' as const] : ['generate_writing' as const, 'clip_data' as const]),
                      'video_composing',
                    ];
                    return allKeys.filter(key => {
                      if (key === 'subsync' || key === 'popular_learning') {
                        return !!masterDetail.steps?.[key];
                      }
                      return true;
                    });
                  })().map((key) => {
                    const step = masterDetail.steps?.[key];
                    return (
                      <div key={key} className="flex items-start gap-3 rounded-md border px-3 py-2">
                        <span className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${step ? (step.status === 'completed' ? 'bg-green-500' : step.status === 'running' ? 'bg-primary' : step.status === 'failed' ? 'bg-red-500' : 'bg-yellow-400') : 'bg-border'}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-xs">{STEP_LABELS[key]}</span>
                            <span className={`text-xs ${STEP_STATUS_COLOR[step?.status ?? 'pending']}`}>{step ? (STEP_STATUS_LABEL[step.status] ?? step.status) : '未开始'}</span>
                          </div>
                          {step?.task_id && <p className="font-mono text-xs text-muted-foreground mt-0.5 truncate" title={step.task_id}>任务 ID: {step.task_id.slice(0, 20)}…</p>}
                          {step?.error && <p className="text-xs text-red-500 mt-0.5">{step.error}</p>}
                          {(step?.started_at || step?.completed_at) && (
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {step.started_at ? `开始: ${formatDate(step.started_at)}` : ''}
                              {step.completed_at ? ` · 完成: ${formatDate(step.completed_at)}` : ''}
                            </p>
                          )}
                          {/* 文案查看/编辑入口 — regression coverage: read-only once downstream stage started */}
                          {(key === 'generate_writing' || key === 'fast_generate_writing') && step?.status === 'completed' && step?.task_id && (() => {
                            const lockEdit = isWritingDownstreamStarted(masterDetail.steps);
                            return (
                              <button
                                type="button"
                                onClick={() => openWritingDialog(step.task_id!, (step.result as TaskResultPayload | undefined)?.file_id, lockEdit)}
                                className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary border border-primary/40 bg-primary/5 hover:bg-primary/10 rounded px-2 py-0.5 transition-colors"
                              >
                                <FileText className="h-3 w-3" />{lockEdit ? '查看文案' : '查看 / 编辑文案'}
                              </button>
                            );
                          })()}
                          {/* 交付物 */}
                          {getStepDeliverables(key, step).map((d) => (
                            <div key={d.label} className="mt-1.5">
                              <DeliverableItem label={d.label} url={d.url} fileId={d.fileId} appKey={appKey || ''} />
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              {masterDetail.error_message && (
                <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-600">{masterDetail.error_message}</div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowMasterDetail(false)}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 文案查看/编辑 Dialog */}
      <Dialog open={showWritingDialog} onOpenChange={open => { if (!open) { setShowWritingDialog(false); setWritingEditMode(false); setWritingViewOnly(false); setShowImportDialog(false); setImportText(''); setWritingImported(false); } }}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-5 pt-5 pb-3 border-b shrink-0">
            <DialogTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4 text-primary" />解说文案
            </DialogTitle>
            <DialogDescription className="text-xs">
              {writingEditMode
                ? '编辑模式 — 修改后点击保存'
                : writingViewOnly
                  ? '只读视图 — 任务已进入后续阶段，文案不再支持编辑或导入'
                  : '文案内容，支持编辑，复制（复制到本地修改），导入（上传本地修改）'}
            </DialogDescription>
            {/* ④ 自定义模板提示：修改文案后后续步骤按实际行数重算 */}
            {!masterDetail?.wallet_transaction && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400 flex items-center gap-1 mt-1">
                <Info className="h-3 w-3 shrink-0" />
                自定义模板：修改文案后，剪辑脚本和视频合成将按实际行数重新计算，费用可能与原估算有差异。
              </p>
            )}
          </DialogHeader>
          <div className="flex-1 overflow-y-auto min-h-0 px-5 py-3 space-y-1.5">
            {writingLoading ? (
              <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
            ) : writingContent.map((item, idx) => (
              <div key={idx} className={`flex gap-2.5 items-start rounded-md px-3 py-2 ${item.type === '解说' ? 'bg-primary/5 border border-primary/10' : 'bg-green-50 border border-green-200 dark:bg-green-950/20 dark:border-green-800'}`}>
                {/* 类型标签：编辑模式下可点击切换 */}
                <button
                  type="button"
                  disabled={!writingEditMode}
                  onClick={() => {
                    if (!writingEditMode) return;
                    const updated = [...writingContent];
                    updated[idx] = { ...item, type: item.type === '解说' ? '原片' : '解说' };
                    setWritingContent(updated);
                  }}
                  className={`shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded mt-0.5 transition-colors ${item.type === '解说' ? 'bg-primary/15 text-primary' : 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400'} ${writingEditMode ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
                  title={writingEditMode ? '点击切换类型' : undefined}
                >
                  {item.type}
                </button>
                {writingEditMode ? (
                  <textarea
                    className="flex-1 text-xs bg-transparent resize-none outline-none border-none leading-relaxed min-h-[2rem]"
                    value={item.text}
                    rows={Math.max(1, Math.ceil(item.text.length / 44))}
                    onChange={e => {
                      const updated = [...writingContent];
                      updated[idx] = { ...item, text: e.target.value };
                      setWritingContent(updated);
                    }}
                  />
                ) : (
                  <p className="flex-1 text-xs leading-relaxed">{item.text}</p>
                )}
                {/* 编辑模式：新增 / 删除 */}
                {writingEditMode && (
                  <div className="shrink-0 flex gap-2 mt-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        const updated = [...writingContent];
                        updated.splice(idx + 1, 0, { type: item.type, text: '' });
                        setWritingContent(updated);
                      }}
                      className="text-[11px] text-primary hover:text-primary/70 font-medium"
                    >新增</button>
                    <button
                      type="button"
                      onClick={() => {
                        if (writingContent.length <= 1) return;
                        setWritingContent(writingContent.filter((_, i) => i !== idx));
                      }}
                      className="text-[11px] text-red-500 hover:text-red-400 font-medium"
                    >删除</button>
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="shrink-0 border-t px-5 py-3 flex justify-between items-center bg-background">
            <span className="text-xs text-muted-foreground">{writingContent.length} 条 · {writingContent.filter(i => i.type === '解说').length} 解说 / {writingContent.filter(i => i.type === '原片').length} 原片</span>
            <div className="flex gap-2">
              {writingEditMode ? (
                <>
                  <Button variant="outline" size="sm" onClick={() => setWritingEditMode(false)} disabled={writingSaving}>取消</Button>
                  <Button size="sm" onClick={saveWritingContent} disabled={writingSaving}>
                    {writingSaving ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />保存中…</> : '保存'}
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={async () => {
                    await navigator.clipboard.writeText(serializeWriting(writingContent));
                    showToast('success', '已复制到剪贴板');
                  }}>
                    <Copy className="h-3.5 w-3.5" />复制
                  </Button>
                  {!writingViewOnly && (
                    <Button variant="outline" size="sm" className="gap-1.5" onClick={() => {
                      setImportText('');
                      setShowImportDialog(true);
                    }}>
                      <Upload className="h-3.5 w-3.5" />导入
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={() => setShowWritingDialog(false)}>关闭</Button>
                  {!writingViewOnly && (writingImported ? (
                    <Button size="sm" onClick={saveWritingContent} disabled={writingSaving}>
                      {writingSaving ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />保存中…</> : '保存'}
                    </Button>
                  ) : (
                    <Button size="sm" onClick={() => setWritingEditMode(true)}>编辑</Button>
                  ))}
                </>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 导入文案 Dialog */}
      <Dialog open={showImportDialog} onOpenChange={open => { if (!open) { setShowImportDialog(false); setImportText(''); } }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base"><Upload className="h-4 w-4 text-primary" />导入文案</DialogTitle>
            <DialogDescription className="text-xs">粘贴修改后的文案，每行格式：<code className="bg-muted px-1 rounded">[解说]文本</code> 或 <code className="bg-muted px-1 rounded">[原片]文本</code></DialogDescription>
          </DialogHeader>
          <textarea
            className="w-full h-48 text-xs rounded-md border bg-background px-3 py-2 resize-none outline-none focus:ring-1 focus:ring-primary font-mono leading-relaxed"
            placeholder=""
            value={importText}
            onChange={e => setImportText(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => { setShowImportDialog(false); setImportText(''); }}>取消</Button>
            <Button size="sm" onClick={() => {
              const parsed = parseWriting(importText);
              if (!parsed) {
                showToast('error', '格式解析失败，请确认每行为 [解说]text 或 [原片]text');
                return;
              }
              setWritingContent(parsed);
              setWritingImported(true);
              setShowImportDialog(false);
              setImportText('');
              showToast('success', `导入成功，共 ${parsed.length} 条`);
            }}>确认导入</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* App Key Dialog */}
      <Dialog open={showKeyDialog} onOpenChange={setShowKeyDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Settings className="h-4 w-4" />配置 App Key</DialogTitle>
            <DialogDescription>请输入您的 NarratorAI App Key，安全存储在本地浏览器中，不会上传至任何服务器。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Label htmlFor="tasks-appkey">App Key</Label>
            <div className="relative">
              <Input id="tasks-appkey" type={showKey ? 'text' : 'password'} placeholder="请输入您的 App Key"
                value={keyInput} onChange={(e) => setKeyInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSaveKey()} className="pr-10" />
              <Button variant="ghost" size="icon" className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                onClick={() => setShowKey(v => !v)} type="button">
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

      {/* Continue Step Confirmation Dialog */}
      <Dialog open={showContinueConfirm} onOpenChange={setShowContinueConfirm}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>确认继续</DialogTitle>
            <DialogDescription className="sr-only">确认继续</DialogDescription>
          </DialogHeader>
          {continueTarget && (
            <div className="space-y-2 text-sm">
              <div className="flex gap-2">
                <span className="w-20 shrink-0 text-muted-foreground">下一步</span>
                <span className="font-medium">{STEP_LABELS[continueTarget.current_step || ''] || continueTarget.current_step || '—'}</span>
              </div>
              <div className="flex gap-2">
                <span className="w-20 shrink-0 text-muted-foreground">预估点数</span>
                <span className="font-medium tabular-nums">{getNextStepCost(continueTarget)} 点</span>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowContinueConfirm(false)}>取消</Button>
            <Button onClick={() => { setShowContinueConfirm(false); if (continueTarget) handleContinueNextStep(continueTarget); }}>
              确认继续
            </Button>
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

      {toast && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-[300] flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium shadow-lg transition-all ${
          toast.type === 'success' ? 'bg-green-50 border border-green-200 text-green-800' : 'bg-red-50 border border-red-200 text-red-800'
        }`}>
          {toast.type === 'success' ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          {toast.message}
        </div>
      )}

      <footer className="border-t bg-card py-4 text-center text-xs text-muted-foreground">
        © 2011 - {new Date().getFullYear()} NarratorAI · AI 视频解说大师
      </footer>
    </div>
  );
}
