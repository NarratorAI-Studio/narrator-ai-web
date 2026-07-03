'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { AppNavLink } from '@/components/app-nav-link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Video, HardDrive, User, Settings, RefreshCw, Eye, EyeOff,
  Loader2, AlertCircle, CheckCircle2, Clock, XCircle, Zap,
  Info, ListChecks, Plus, ArrowRight, FolderSearch, Film, FileText, Music, Search, Mic2,
  ThumbsUp, Share2, MessageCircle, Bookmark, LayoutTemplate, ExternalLink, PlayCircle,
  ChevronDown, Upload, FolderOpen, Globe, Link2, PauseCircle,
} from 'lucide-react';
import { useAppKey } from '@/hooks/use-app-key';
import { ThemeToggle } from '@/components/theme-toggle';
import { isStep4ConfirmDisabled } from '@/lib/step4-confirm-gate';
import {
  listMasterTasks,
  getMasterTask,
  createMasterTask,
  updateMasterTaskStep,
  replaceMasterTask,
  migrateLocalStorageToDb,
} from '@/lib/master-task-client-store';
import type { StepName, BudgetSnapshot } from '@/lib/master-task-types';
import type { SrtRealtimeQuoteResponse, HardPriceDetail } from '@/lib/hard-price-utils';
import type { PricingQuoteData } from '@/lib/pricing-quote-types';
import { fetchAllHardPrices, COMBO_KEY_LABELS, formatHardPrice, resolveComboKey, tiersToHardPriceDetails, toCatalogTierCode, relevantComboKeysForWritingType } from '@/lib/hard-price-utils';
import { buildTemplateSummaryRows, shouldShowTemplateCard } from '@/lib/master-task-step3-template-summary';
import { buildTemplateQuoteIdentity, buildMasterTaskIdentity, buildV2MasterBudgetSnapshot } from '@/lib/pricing-alias-contract';
import { markRemoteCallUncertain } from '@/lib/master-task-remote-uncertain';
import { shouldQuotePresetTemplateOnStep4 } from '@/lib/step4-pricing-path';
import type { V2CatalogTier } from '@/lib/hard-price-utils';
import { useHardPriceOrder } from '@/hooks/use-hard-price-order';
import { useHardPriceQuoteV2 } from '@/hooks/use-hard-price-quote-v2';
import { sha256Hex, shouldHashForSrt } from '@/lib/file-hash';
import {
  ALL_SUPPORTED_ACCEPT_ATTR,
  ROLE_TYPE_HINT,
  checkExtensionAllowed,
  fileMatchesRole,
} from '@/lib/cloud-drive-file-types';

// ─── Types ───────────────────────────────────────────────────────────────────

interface RecentMasterTask {
  narrator_task_id: string;
  narrator_type_label: string;
  narrator_type: string;
  model_version: string;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  current_step?: string;
  budget_snapshot?: BudgetSnapshot;
  created_at: string;
  steps: Record<string, { status: string; task_id?: string }>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const MASTER_STATUS_MAP: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
  pending:   { label: '待处理', cls: 'bg-yellow-100 text-yellow-700 border-yellow-200',  icon: <Clock className="h-3 w-3" /> },
  running:   { label: '进行中', cls: 'bg-indigo-100 text-indigo-700 border-indigo-200 dark:bg-indigo-950 dark:text-indigo-300 dark:border-indigo-800',        icon: <Loader2 className="h-3 w-3 animate-spin" /> },
  paused:    { label: '已暂停', cls: 'bg-orange-100 text-orange-700 border-orange-200',  icon: <Clock className="h-3 w-3" /> },
  completed: { label: '已完成', cls: 'bg-green-100 text-green-700 border-green-200',     icon: <CheckCircle2 className="h-3 w-3" /> },
  failed:    { label: '已失败', cls: 'bg-red-100 text-red-700 border-red-200',            icon: <XCircle className="h-3 w-3" /> },
  cancelled: { label: '已取消', cls: 'bg-gray-100 text-gray-500 border-gray-200',        icon: <XCircle className="h-3 w-3" /> },
};

const STEP_LABELS: Record<string, string> = {
  subsync: '字幕对齐', popular_learning: '爆款学习',
  generate_writing: '二创文案', fast_generate_writing: '原创文案',
  generate_fast_writing_clip_data: '快速剪辑数据',
  clip_data: '剪辑数据', video_composing: '合成视频', completed: '完成',
};

function formatDate(str?: string) {
  if (!str) return '—';
  return new Date(str).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// ─── Constants ───────────────────────────────────────────────────────────────

const NARRATOR_TYPES_FALLBACK = ['电影', '多语种电影', '第一人称电影', '第一人称多语种', '短剧'];
const FILM_TYPES = new Set(['电影', '多语种电影', '第一人称电影', '第一人称多语种']);
const NARRATOR_TYPE_ORDER = ['电影', '多语种电影', '第一人称电影', '第一人称多语种', '短剧'];
const WRITING_LANGUAGES = ['中文', '英语', '日语', '韩语', '泰语', '印尼语', '葡萄牙语', '西班牙语', '法语', '德语', '阿拉伯语'];
const WRITING_TYPES = [
  { value: 1 as const, label: '原创文案（纯解说）' },
  { value: 2 as const, label: '原创文案（原声混剪）' },
  { value: 0 as const, label: '二创文案' },
] as const;
const MODEL_VERSIONS = [
  { key: 'advanced', label: '高级版', desc: 'advanced' },
  { key: 'standard', label: '标准版', desc: 'standard' },
  { key: 'strict',   label: '结构严格版', desc: 'strict' },
];
const PLATFORMS = ['抖音', '小红书', '快手', 'YouTube', 'B站', '其他'];
const WORKFLOW_STEPS = [
  { label: '素材准备', desc: '从云盘选择素材' },
  { label: '类型配置', desc: '选择解说类型' },
  { label: '素材处理', desc: '字幕提取与擦除' },
  { label: '素材验证', desc: '自动验证文件' },
  { label: '确认创建', desc: '确认点数后创建' },
  { label: '爆款学习', desc: '学习爆款模式' },
  { label: '解说文案', desc: '生成解说内容' },
  { label: '剪辑脚本', desc: '创建剪辑数据' },
  { label: '合成视频', desc: '输出最终视频' },
];
const FILE_ROLE_LABELS: Record<string, string> = {
  native_video: '素材视频', native_srt: '素材字幕 SRT',
  learning_srt: '爆款学习 SRT', bgm: 'BGM 音频',
  episode_video: '集视频', episode_srt: '集字幕 SRT', raw_video: '原始视频', raw_video_add: '原始视频',
};
const CUSTOM_SRT_TEMPLATE_PREFIX = 'custom_srt:';
type FileRole = 'native_video' | 'native_srt' | 'learning_srt' | 'bgm' | 'raw_video' | 'raw_video_add' | 'episode_video' | 'episode_srt';
interface PickedFile { id: string; name: string; }

function customSrtTemplateId(fileId: string): string {
  return `${CUSTOM_SRT_TEMPLATE_PREFIX}${fileId}`;
}

function customSrtFileIdFromTemplateId(customTemplateId?: string | null): string | undefined {
  if (!customTemplateId?.startsWith(CUSTOM_SRT_TEMPLATE_PREFIX)) return undefined;
  return customTemplateId.slice(CUSTOM_SRT_TEMPLATE_PREFIX.length) || undefined;
}

function pricingRuleVersionNumber(version: string): number {
  const parsed = Number(version);
  if (Number.isFinite(parsed)) return parsed;
  const withoutPrefix = Number(version.replace(/^v/i, ''));
  return Number.isFinite(withoutPrefix) ? withoutPrefix : 0;
}

function quoteToSrtRealtimeQuote(quote: PricingQuoteData): SrtRealtimeQuoteResponse {
  return {
    quote_id: quote.quote_id,
    combo_key: quote.combo_key,
    estimated_points: quote.final_charge_price,
    pricing_rule_version: pricingRuleVersionNumber(quote.pricing_rule_version),
    srt_metrics: {
      text_chars: 0,
      text_lines: quote.valid_line_count ?? 0,
      billing_minutes: quote.pricing_minutes,
    },
    breakdown: quote.breakdown.map(item => ({
      item: item.subflow_key,
      points: item.subtotal,
      label: item.display_label,
    })),
  };
}

interface DubbingItem { id: number; name: string; dubbing_demo_url: string; dubbing_id: string; }
interface BgmItem { id: number; name: string; tag: string; bgm_demo_url: string; bgm_file_id: string; }
interface TemplateItem {
  id: number;
  /**
   * Canonical upstream xy-code (e.g. `"xy0178"`). Always returned by
   * `/pricing/movie-baokuan` but declared optional to stay
   * compatible with narrower call sites. The v2 quote / master-task
   * code path  reads this — see Backend API contract for why
   * `code` and not `id` is the cross-system identifier.
   */
  code?: string;
  name: string; learning_model_id: string;
  narrator_type: { id: number; name: string };
  time: string; language: string;
  platform: { id: number; name: string };
  img: string; like: number; share: number; messages: number; stars: number;
  profit: string; slug_img: string; link: string; collection_time: string;
  categories: { id: number; name: string }[];
  // Hard-price fields (populated when backend enforces fixed pricing)
  hard_price?: number;
  combo_key?: string;
  // v2 catalog tiers map (post Backend API contract) — when
  // present, the list-page derives templatePricesCache from this
  // instead of falling back to per-template fetchAllHardPrices. Map
  // key is the v2 tier_code; see TIER_CODE_TO_COMBO_KEY for the
  // tier_code ↔ combo_key translation.
  tiers?: Record<string, V2CatalogTier>;
  pricing_rule_version?: string;
}
interface TemplateMeta {
  platforms: { id: number; name: string }[];
  categories: { id: number; name: string }[];
}
interface MovieSucaiItem {
  id: number;
  name: string;
  video_file_id: string;
  srt_file_id: string;
  type: string;
  story_info: string;
  cover: string;
  character_name: string;
  title: string;
  year: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function Home() {
  const router = useRouter();
  const { appKey, setAppKey, loaded } = useAppKey();
  const [showKeyDialog, setShowKeyDialog] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [showContactQR, setShowContactQR] = useState(false);

  const [recentTasks, setRecentTasks] = useState<RecentMasterTask[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(false);
  const [homeContinuingId, setHomeContinuingId] = useState<string | null>(null);
  const homePollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [wizardStep, setWizardStep] = useState(1);
  const [showTaskListDialog, setShowTaskListDialog] = useState(false);

  const [narratorTypes, setNarratorTypes] = useState<string[]>([]);
  const [narratorTypeMap, setNarratorTypeMap] = useState<Record<string, string>>({});
  const [loadingTypes, setLoadingTypes] = useState(false);
  const [selectedType, setSelectedType] = useState('');
  const [selectedVersion, setSelectedVersion] = useState('standard');

  const [showFilePicker, setShowFilePicker] = useState(false);
  const [filePickerRole, setFilePickerRole] = useState<FileRole>('native_video');
  const [cloudFiles, setCloudFiles] = useState<any[]>([]);
  const [loadingCF, setLoadingCF] = useState(false);
  const [fileSearch, setFileSearch] = useState('');
  // File picker upload
  const [showPickerUpload, setShowPickerUpload] = useState(false);
  const [pickerUploadTab, setPickerUploadTab] = useState<'local' | 'transfer'>('local');
  const [pickerUploading, setPickerUploading] = useState(false);
  const [pickerUploadProgress, setPickerUploadProgress] = useState<number | null>(null);
  const [pickerUploadError, setPickerUploadError] = useState('');
  const [pickerTransferLink, setPickerTransferLink] = useState('');
  const [pickerTransferring, setPickerTransferring] = useState(false);
  const [pickerTransferError, setPickerTransferError] = useState('');
  const pickerFileInputRef = useRef<HTMLInputElement>(null);
  const [nativeVideo, setNativeVideo] = useState<PickedFile | null>(null);
  const [nativeSrt,   setNativeSrt]   = useState<PickedFile | null>(null);
  const [learningSrt, setLearningSrt] = useState<PickedFile | null>(null);
  const [bgmFile,     setBgmFile]     = useState<PickedFile | null>(null);

  const [dubbingList, setDubbingList] = useState<DubbingItem[]>([]);
  const [loadingDubbing, setLoadingDubbing] = useState(false);
  const [useCustomDubing, setUseCustomDubing] = useState(false);
  const [useCustomTemplate, setUseCustomTemplate] = useState(false);

  const [bgmList, setBgmList] = useState<BgmItem[]>([]);
  const [loadingBgm, setLoadingBgm] = useState(false);
  const [useNoBgm, setUseNoBgm] = useState(false);
  const [useCustomBgm, setUseCustomBgm] = useState(false);
  const [selectedBgmId, setSelectedBgmId] = useState('NO_BGM');
  const [bgmPopOpen, setBgmPopOpen] = useState(false);
  const [dubPopOpen, setDubPopOpen] = useState(false);

  // Audio preview for BGM / Dubbing
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const togglePreview = useCallback((url: string, id: string) => {
    if (previewingId === id) {
      audioRef.current?.pause();
      setPreviewingId(null);
      return;
    }
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    const a = new Audio(url);
    a.onended = () => setPreviewingId(null);
    a.play();
    audioRef.current = a;
    setPreviewingId(id);
  }, [previewingId]);
  const stopPreview = useCallback(() => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    setPreviewingId(null);
  }, []);

  const [showTemplateDialog, setShowTemplateDialog] = useState(false);
  const [showTemplateDetail, setShowTemplateDetail] = useState(false);
  const [templateMeta, setTemplateMeta] = useState<TemplateMeta | null>(null);
  const [templateList, setTemplateList] = useState<TemplateItem[]>([]);
  const [templateTotal, setTemplateTotal] = useState(0);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [templatePlatformId, setTemplatePlatformId] = useState(0);
  const [templateCategoryId, setTemplateCategoryId] = useState(0);
  const [templateSearch, setTemplateSearch] = useState('');
  const [templatePage, setTemplatePage] = useState(1);
  const [hoveredTemplate, setHoveredTemplate] = useState<TemplateItem | null>(null);
  const [detailTemplate, setDetailTemplate] = useState<TemplateItem | null>(null);
  const [confirmedTemplate, setConfirmedTemplate] = useState<TemplateItem | null>(null);
  const [templatePricesCache, setTemplatePricesCache] = useState<Record<number, HardPriceDetail[]>>({});
  const [loadingTemplatePrices, setLoadingTemplatePrices] = useState(false);

  const [existingModelId, setExistingModelId] = useState('');
  const [dubingId, setDubingId] = useState('mercury_yunxi_24k');
  const [useExistingModel, setUseExistingModel] = useState(false);

  const [playletName, setPlayletName] = useState('');
  const [targetPlatform, setTargetPlatform] = useState('抖音');
  const [enableSubsync, setEnableSubsync] = useState(false);
  const [targetCharacterName, setTargetCharacterName] = useState('');
  const [taskCount, setTaskCount] = useState(1);
  const [refineGaps, setRefineGaps] = useState(false);
  const [storyInfo, setStoryInfo] = useState('');
  const [runAuto, setRunAuto] = useState<0 | 1>(0);

  const [writingType, setWritingType] = useState<0 | 1 | 2>(2);
  const [writingLanguage, setWritingLanguage] = useState('中文');
  const [writingModel, setWritingModel] = useState<'flash' | 'pro'>('flash');
  const [confirmedMovieJson, setConfirmedMovieJson] = useState('');
  const [movieSearchQuery, setMovieSearchQuery] = useState('');
  const [movieSearchResults, setMovieSearchResults] = useState<any[]>([]);
  const [loadingMovieSearch, setLoadingMovieSearch] = useState(false);
  const [selectedMovieIdx, setSelectedMovieIdx] = useState<number | null>(null);
  const [showMovieSearch, setShowMovieSearch] = useState(false);

  const [episodes, setEpisodes] = useState<Array<{video: PickedFile|null; srt: PickedFile|null}>>([{video: null, srt: null}]);
  const [pickerEpisodeIdx, setPickerEpisodeIdx] = useState(0);
  const [movieFromLib, setMovieFromLib] = useState(false);
  const [materialProcessed, setMaterialProcessed] = useState(true);
  const [rawVideoFileId, setRawVideoFileId] = useState('');
  const [rawVideoFileName, setRawVideoFileName] = useState('');
  const [rawVideoFiles, setRawVideoFiles] = useState<Array<{id: string; name: string}>>([]);
  const [removalMode, setRemovalMode] = useState<'standard' | 'advanced'>('standard');
  const [rawVideoQueued, setRawVideoQueued] = useState(false);
  const [rawVideoSubmitting, setRawVideoSubmitting] = useState(false);
  const [rawVideoTaskId, setRawVideoTaskId] = useState('');
  const [rawVideoError, setRawVideoError] = useState('');
  const [showMovieLib, setShowMovieLib] = useState(false);
  const [useMaterialLib, setUseMaterialLib] = useState(true);
  const [movieLibList, setMovieLibList] = useState<MovieSucaiItem[]>([]);
  const [movieLibTotal, setMovieLibTotal] = useState(0);
  const [loadingMovieLib, setLoadingMovieLib] = useState(false);
  const [movieLibSearch, setMovieLibSearch] = useState('');
  const [movieLibPage, setMovieLibPage] = useState(1);
  const [movieLibDetail, setMovieLibDetail] = useState<MovieSucaiItem | null>(null);
  const [confirmedMovieLib, setConfirmedMovieLib] = useState<MovieSucaiItem | null>(null);

  const [verifying, setVerifying] = useState(false);
  const [verifyOk, setVerifyOk] = useState<boolean | null>(null);
  const [verifyMsg, setVerifyMsg] = useState('');
  const [loadingBudget, setLoadingBudget] = useState(false);
  const [budgetResult, setBudgetResult] = useState<any>(null);
  const [hardPriceResult, setHardPriceResult] = useState<any>(null);
  const [srtQuoteResult, setSrtQuoteResult] = useState<SrtRealtimeQuoteResponse | null>(null);
  const [srtQuoteError, setSrtQuoteError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const hardPriceOrder = useHardPriceOrder();
  const hardPriceQuoteV2 = useHardPriceQuoteV2();
  const isHardPrice = !!(confirmedTemplate?.hard_price && confirmedTemplate?.combo_key);

  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const showToast = useCallback((type: 'success' | 'error', message: string) => {
    setToast({ type, message }); setTimeout(() => setToast(null), 3500);
  }, []);

  const apiHeaders = useCallback(() => ({ 'Content-Type': 'application/json', 'x-app-key': appKey }), [appKey]);

  const submitRawVideoProcess = useCallback(async (playlet = false) => {
    const fileIds = playlet ? rawVideoFiles.map(v => v.id) : [rawVideoFileId];
    if (fileIds.length === 0) return;
    setRawVideoSubmitting(true); setRawVideoError(''); setRawVideoTaskId('');
    const taskIds: string[] = [];
    try {
      // 字幕擦除
      const rr = await fetch('/api/tools/subtitle-removal', {
        method: 'POST', headers: { ...apiHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_ids: fileIds, mode: removalMode }),
      });
      const rj = await rr.json();
      if (!rj.success) { setRawVideoError(rj.error || '字幕擦除提交失败'); setRawVideoSubmitting(false); return; }
      taskIds.push('擦除:' + (rj.data?.task_id || rj.data?.order_num || '✓'));
      // 字幕提取
      const er = await fetch('/api/tools/subtitle-extract', {
        method: 'POST', headers: { ...apiHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_id: fileIds, mode: 2, language: 'Auto-Detect', subtitle_position: 'auto' }),
      });
      const ej = await er.json();
      if (!ej.success) { setRawVideoError(ej.error || '字幕提取提交失败'); setRawVideoSubmitting(false); return; }
      taskIds.push('提取:' + (ej.data?.task_id || ej.data?.order_num || '✓'));
      setRawVideoTaskId(taskIds.join(' · '));
    } catch (e: any) {
      setRawVideoError(e.message || '网络错误');
    } finally {
      setRawVideoSubmitting(false);
    }
  }, [rawVideoFileId, rawVideoFiles, removalMode, apiHeaders]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchRecentTasks = useCallback(async () => {
    if (!appKey) return;
    if (false) return;  // 向导打开时完全跳过，避免任何 DOM 变化触发 Radix onOpenChange
    setLoadingRecent(true);
    try {
      const { items } = await listMasterTasks({ app_key: appKey, limit: 5 });
      setRecentTasks(items as unknown as RecentMasterTask[]);
      // 加载后立即对 running 任务静默同步
      const runningIds = items.filter(t => t.status === 'running').map(t => t.narrator_task_id);
      if (runningIds.length > 0) {
        setTimeout(() => runningIds.forEach(async id => {
          if (false) return;
          const task = await getMasterTask(id, appKey);
          if (!task) return;
          fetch(`/api/narrator/master-tasks/${id}/sync`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'x-app-key': appKey },
            body: JSON.stringify({ task }),
          }).then(rr => rr.json()).then(jj => {
            if (jj.success && jj.data) replaceMasterTask(id, jj.data, appKey);
            if (jj.success && jj.synced && !false) fetchRecentTasks();
          }).catch(() => {});
        }), 300);
      }
    } catch {} finally { setLoadingRecent(false); }
  }, [appKey]);

  const homeContinueTask = useCallback(async (t: RecentMasterTask) => {
    if (!appKey) return;
    setHomeContinuingId(t.narrator_task_id);
    try {
      const task = await getMasterTask(t.narrator_task_id, appKey);
      if (!task) { showToast('error', '任务数据未找到'); setHomeContinuingId(null); return; }
      const r = await fetch(`/api/narrator/master-tasks/${t.narrator_task_id}/next-step`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-app-key': appKey },
        body: JSON.stringify({ task }),
      });
      const j = await r.json();
      if (j.success) {
        if (j.data) await replaceMasterTask(t.narrator_task_id, j.data, appKey);
        showToast('success', j.all_done ? '所有步骤已完成!' : `已开始: ${STEP_LABELS[j.next_step] ?? j.next_step}`);
        fetchRecentTasks();
      } else {
        showToast('error', j.error || '操作失败');
      }
    } catch { showToast('error', '网络错误'); }
    finally { setHomeContinuingId(null); }
  }, [appKey, fetchRecentTasks, showToast]);

  const fetchNarratorTypes = useCallback(async () => {
    setLoadingTypes(true);
    try {
      const r = await fetch('/api/narrator/narrator-types', { headers: apiHeaders() });
      const j = await r.json();
      if (j.success && j.data) {
        const raw = j.data;
        let types: string[];
        let typeMap: Record<string, string> = {};
        if (raw.narrator_type_list) {
          types = raw.narrator_type_list;
          typeMap = raw.narrator_types || {};
        } else if (Array.isArray(raw)) {
          types = raw.map((t: any) => typeof t === 'string' ? t : t.name || String(t));
        } else if (raw.types) {
          types = raw.types;
        } else {
          types = NARRATOR_TYPES_FALLBACK;
        }
        types.sort((a, b) => {
          const ia = NARRATOR_TYPE_ORDER.indexOf(a); const ib = NARRATOR_TYPE_ORDER.indexOf(b);
          if (ia === -1 && ib === -1) return 0; if (ia === -1) return 1; if (ib === -1) return -1;
          return ia - ib;
        });
        setNarratorTypes(types);
        setNarratorTypeMap(typeMap);
        setSelectedType(t => t || (types.includes('电影') ? '电影' : types[0] || ''));
      } else {
        setNarratorTypes(NARRATOR_TYPES_FALLBACK);
        setSelectedType(t => t || '电影');
      }
    } catch {
      setNarratorTypes(NARRATOR_TYPES_FALLBACK);
      setSelectedType(t => t || '电影');
    } finally { setLoadingTypes(false); }
  }, [apiHeaders]);

  const fetchCloudFiles = useCallback(async () => {
    if (!appKey) return;
    setLoadingCF(true);
    try {
      const PAGE_SIZE = 100;
      const first = await fetch(`/api/cloud-drive/files?page=1&page_size=${PAGE_SIZE}`, { headers: apiHeaders() });
      const fj = await first.json();
      if (!fj.success) return;
      const all: any[] = [...(fj.data?.items || [])];
      const totalPages: number = fj.data?.total_pages ?? 1;
      for (let p = 2; p <= totalPages; p++) {
        const r = await fetch(`/api/cloud-drive/files?page=${p}&page_size=${PAGE_SIZE}`, { headers: apiHeaders() });
        const j = await r.json();
        if (j.success) all.push(...(j.data?.items || []));
      }
      setCloudFiles(all);
    } catch {} finally { setLoadingCF(false); }
  }, [appKey, apiHeaders]);

  useEffect(() => {
    if (!loaded) return;
    if (!appKey) return;
    migrateLocalStorageToDb(appKey).catch(() => {});
    fetchRecentTasks();
    fetchNarratorTypes();
    fetchDubbingList();
    fetchBgmList();
    // Auto-load movie library for step 1
    fetchMovieLib(1, '');
  }, [loaded, appKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-fetch template list when entering step 2
  useEffect(() => {
    if (wizardStep !== 2 || !appKey || useCustomTemplate) return;
    fetchTemplateMeta();
    if (templateList.length === 0) fetchTemplates(1);
  }, [wizardStep, appKey, useCustomTemplate]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch hard price tiers when template detail dialog opens (cached per template)
  useEffect(() => {
    if (!showTemplateDetail || !detailTemplate || !appKey) return;
    if (templatePricesCache[detailTemplate.id]) return;
    setLoadingTemplatePrices(true);
    fetchAllHardPrices(detailTemplate.id, apiHeaders())
      .then(result => {
        if (result) setTemplatePricesCache(prev => ({ ...prev, [detailTemplate.id]: result.prices }));
      })
      .finally(() => setLoadingTemplatePrices(false));
  }, [showTemplateDetail, detailTemplate?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const openWizard = () => {
    setWizardStep(1); setSelectedType(''); setSelectedVersion('standard'); setRunAuto(0);
    setNativeVideo(null); setNativeSrt(null); setLearningSrt(null); setBgmFile(null);
    setExistingModelId(''); setUseExistingModel(false);
    const preferred = dubbingList.find(d => d.name === '利落男声');
    setDubingId(preferred ? preferred.dubbing_id : dubbingList[0]?.dubbing_id || 'mercury_yunxi_24k');
    setPlayletName(''); setTargetPlatform('抖音'); setEnableSubsync(false);
    setTargetCharacterName(''); setTaskCount(1); setRefineGaps(false); setStoryInfo('');
    setWritingType(2); setWritingLanguage('中文'); setWritingModel('flash');
    setConfirmedMovieJson(''); setMovieSearchQuery(''); setMovieSearchResults([]); setSelectedMovieIdx(null);
    setUseCustomDubing(false); setUseNoBgm(false); setUseCustomBgm(false); setBgmFile(null);
    setConfirmedTemplate(null); setDetailTemplate(null); setHoveredTemplate(null);
    setTemplatePlatformId(0); setTemplateCategoryId(0); setTemplateSearch(''); setTemplatePage(1);
    setVerifyOk(null); setVerifyMsg(''); setBudgetResult(null);
    fetchNarratorTypes(); fetchDubbingList(); fetchBgmList();
  };

  const fetchDubbingList = useCallback(async () => {
    if (!appKey) return;
    setLoadingDubbing(true);
    try {
      const r = await fetch('/api/narrator/dubbing-list', { headers: apiHeaders() });
      const j = await r.json();
      if (j.success) {
        const raw: DubbingItem[] = j.data?.items || [];
        // 将"利落男声"排到第一位
        const items = raw.slice().sort((a, b) => {
          if (a.name === '利落男声') return -1;
          if (b.name === '利落男声') return 1;
          return 0;
        });
        setDubbingList(items);
        if (items.length > 0) {
          const preferred = items.find(d => d.name === '利落男声');
          setDubingId(preferred ? preferred.dubbing_id : items[0].dubbing_id);
        }
      }
    } catch {} finally { setLoadingDubbing(false); }
  }, [appKey, apiHeaders]);

  const fetchBgmList = useCallback(async () => {
    if (!appKey) return;
    setLoadingBgm(true);
    try {
      const r = await fetch('/api/narrator/bgm-list', { headers: apiHeaders() });
      const j = await r.json();
      if (j.success) {
        const items: BgmItem[] = j.data?.items || [];
        setBgmList(items);
      }
    } catch {} finally { setLoadingBgm(false); }
  }, [appKey, apiHeaders]);

  const fetchTemplateMeta = useCallback(async () => {
    if (!appKey || templateMeta) return;
    try {
      const r = await fetch('/api/narrator/template-meta', { headers: apiHeaders() });
      const j = await r.json();
      if (j.success) setTemplateMeta(j.data);
    } catch {}
  }, [appKey, apiHeaders, templateMeta]);

  const fetchTemplates = useCallback(async (page = 1) => {
    if (!appKey) return;
    setLoadingTemplates(true);
    try {
      const params = new URLSearchParams({ page: String(page), size: '21' });
      if (templatePlatformId) params.set('platform_id', String(templatePlatformId));
      if (templateCategoryId) params.set('category_id', String(templateCategoryId));
      if (templateSearch.trim()) params.set('name', templateSearch.trim());
      const r = await fetch(`/api/narrator/template-list?${params}`, { headers: apiHeaders() });
      const j = await r.json();
      if (j.success) {
        const items: TemplateItem[] = j.data?.items || [];
        setTemplateList(items);
        setTemplateTotal(j.data?.total || 0);
        setTemplatePage(page);
        // Batch-populate price cache from v2 tiers in the list
        // response — saves the N+1 per-template fetchAllHardPrices
        // round-trips that the detail-dialog effect would otherwise
        // make on every card open. Items without `tiers` (still in
        // upstream `code`-field rollout — see
        // [[project_movie_baokuan_upstream_code_field]]) get the
        // legacy fallback on detail open.
        const derived: Record<number, HardPriceDetail[]> = {};
        for (const item of items) {
          if (item.tiers && Object.keys(item.tiers).length > 0) {
            derived[item.id] = tiersToHardPriceDetails(item.id, item.tiers);
          }
        }
        if (Object.keys(derived).length > 0) {
          setTemplatePricesCache(prev => ({ ...prev, ...derived }));
        }
      }
    } catch {} finally { setLoadingTemplates(false); }
  }, [appKey, apiHeaders, templatePlatformId, templateCategoryId, templateSearch]);

  // Auto-fetch templates when platform or category filter changes
  useEffect(() => {
    if (appKey) fetchTemplates(1);
  }, [templatePlatformId, templateCategoryId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleMovieSearch = useCallback(async () => {
    const q = movieSearchQuery.trim();
    if (!q) return;
    setLoadingMovieSearch(true); setMovieSearchResults([]); setSelectedMovieIdx(null);
    try {
      const r = await fetch(`/api/narrator/search-media?query=${encodeURIComponent(q)}`, { headers: apiHeaders() });
      const j = await r.json();
      if (j.success) setMovieSearchResults(Array.isArray(j.data) ? j.data : j.data?.data || []);
      else showToast('error', j.error || '搜索失败');
    } catch { showToast('error', '搜索请求失败'); }
    finally { setLoadingMovieSearch(false); }
  }, [movieSearchQuery, apiHeaders, showToast]);

  const handleConfirmMovie = useCallback(() => {
    if (selectedMovieIdx === null || !movieSearchResults[selectedMovieIdx]) return;
    const m = movieSearchResults[selectedMovieIdx];
    setConfirmedMovieJson(JSON.stringify(m));
    setShowMovieSearch(false);
  }, [selectedMovieIdx, movieSearchResults]);

  // regression coverage: 3 rows × 3 cols (`lg:grid-cols-3`) on first screen so the Step 1
  // material library fits a desktop viewport without scrolling and the
  // first API hit stays small.
  const MOVIE_LIB_PAGE_SIZE = 9;
  const fetchMovieLib = useCallback(async (page = 1, search = movieLibSearch) => {
    if (!appKey) return;
    setLoadingMovieLib(true);
    try {
      const qs = new URLSearchParams({ page: String(page), page_size: String(MOVIE_LIB_PAGE_SIZE) });
      if (search.trim()) qs.set('name', search.trim());
      const r = await fetch(`/api/narrator/movie-sucai?${qs}`, { headers: { 'x-app-key': appKey } });
      const j = await r.json();
      if (j.success) {
        setMovieLibList(j.data?.items || []);
        setMovieLibTotal(j.data?.total || 0);
        setMovieLibPage(page);
      }
      else showToast('error', j.error || '获取素材库失败');
    } catch { showToast('error', '素材库请求失败'); }
    finally { setLoadingMovieLib(false); }
  }, [appKey, movieLibSearch, showToast]);

  const openFilePicker = (role: FileRole) => {
    setFilePickerRole(role); setFileSearch(''); fetchCloudFiles(); setShowFilePicker(true);
  };
  const openEpisodePicker = (role: 'episode_video' | 'episode_srt', idx: number) => {
    setPickerEpisodeIdx(idx); setFilePickerRole(role); setFileSearch(''); fetchCloudFiles(); setShowFilePicker(true);
  };

  const selectFile = (f: any) => {
    const p: PickedFile = { id: f.file_id, name: f.file_name };
    if (filePickerRole === 'native_video') setNativeVideo(p);
    else if (filePickerRole === 'native_srt') setNativeSrt(p);
    else if (filePickerRole === 'learning_srt') setLearningSrt(p);
    else if (filePickerRole === 'raw_video') { setRawVideoFileId(p.id); setRawVideoFileName(p.name); setRawVideoTaskId(''); setRawVideoError(''); }
    else if (filePickerRole === 'raw_video_add') { setRawVideoFiles(prev => [...prev, p]); setRawVideoQueued(false); return; }
    else if (filePickerRole === 'episode_video') setEpisodes(eps => eps.map((ep, i) => i === pickerEpisodeIdx ? { ...ep, video: p } : ep));
    else if (filePickerRole === 'episode_srt')   setEpisodes(eps => eps.map((ep, i) => i === pickerEpisodeIdx ? { ...ep, srt: p }   : ep));
    else setBgmFile(p);
    setShowFilePicker(false);
  };

  // File picker: local upload
  const handlePickerLocalUpload = useCallback(async (file: File) => {
    if (!appKey || pickerUploading) return;
    const check = checkExtensionAllowed(file.name);
    if (!check.ok) {
      setPickerUploadError(check.reason);
      return;
    }
    setPickerUploading(true); setPickerUploadProgress(0); setPickerUploadError('');
    try {
      const res1 = await fetch('/api/cloud-drive/upload-url', {
        method: 'POST', headers: apiHeaders(),
        body: JSON.stringify({ file_name: file.name, file_size: file.size, content_type: file.type || 'application/octet-stream' }),
      });
      const json1 = await res1.json();
      if (!json1.success) throw new Error(json1.error || '获取上传链接失败');
      const { upload_url, file_id, object_key, expires_in, upload_directory } = json1.data;
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', upload_url, true);
        xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
        xhr.upload.onprogress = (e) => { if (e.lengthComputable) setPickerUploadProgress(Math.round(e.loaded / e.total * 100)); };
        xhr.onload = () => { if (xhr.status >= 200 && xhr.status < 300) resolve(); else reject(new Error(`上传失败，状态码: ${xhr.status}`)); };
        xhr.onerror = () => reject(new Error('上传网络错误'));
        xhr.send(file);
      });
      const res3 = await fetch('/api/cloud-drive/upload-callback', {
        method: 'POST', headers: apiHeaders(),
        body: JSON.stringify({
          file_id,
          object_key,
          upload_status: 'success',
          file_name: file.name,
          file_size: file.size,
          content_type: file.type || 'application/octet-stream',
          upload_url,
          expires_in,
          upload_directory,
          ...(shouldHashForSrt(file) ? { srt_file_hash: await sha256Hex(file) } : {}),
        }),
      });
      const json3 = await res3.json();
      if (!json3.success) throw new Error(json3.error || '上传回调失败');
      showToast('success', `「${file.name}」上传成功`);
      setShowPickerUpload(false);
      fetchCloudFiles();
    } catch (err: any) {
      setPickerUploadError(err.message || '上传失败');
    } finally { setPickerUploading(false); setPickerUploadProgress(null); }
  }, [appKey, apiHeaders, showToast, fetchCloudFiles, pickerUploading]);

  // File picker: transfer link upload
  const handlePickerTransfer = useCallback(async () => {
    if (!appKey || !pickerTransferLink.trim() || pickerTransferring) return;
    setPickerTransferring(true); setPickerTransferError('');
    try {
      const res = await fetch('/api/cloud-drive/transfer', {
        method: 'POST', headers: apiHeaders(),
        body: JSON.stringify({
          link: pickerTransferLink.trim(),
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || '转存失败');
      showToast('success', '转存任务已提交');
      setPickerTransferLink('');
      setShowPickerUpload(false);
      fetchCloudFiles();
    } catch (err: any) {
      setPickerTransferError(err.message || '转存失败');
    } finally { setPickerTransferring(false); }
  }, [appKey, apiHeaders, pickerTransferLink, pickerTransferring, showToast, fetchCloudFiles]);

  const bgmValue = useCustomBgm ? (bgmFile?.id || 'NO_BGM') : (selectedBgmId || 'NO_BGM');

  const handleStep4Enter = useCallback(async () => {
    if (!appKey) return;
    setVerifying(true); setVerifyOk(null); setVerifyMsg(''); setBudgetResult(null);

    // 素材未处理模式：自动标记 rawVideoQueued，跳过素材校验与预算计算（无 SRT 文件无法计算点数）
    const hasRawVideo = !!(rawVideoFileId || rawVideoFiles.length > 0);
    if (hasRawVideo && !nativeVideo && !nativeSrt) {
      if (!rawVideoQueued) setRawVideoQueued(true);
      setVerifyOk(true); setVerifyMsg('素材待预处理，创建时将先执行擦除与提取');
      setVerifying(false);
      return;
    }

    const ep0 = isPlaylet ? validEpisodes[0] : null;
    if (isPlaylet ? !ep0 : (!nativeVideo || !nativeSrt)) { setVerifying(false); return; }
    const verifyVideo = isPlaylet ? ep0!.video! : nativeVideo!;
    const verifySrt   = isPlaylet ? ep0!.srt!   : nativeSrt!;
    try {
      const vBody: any = { native_video: verifyVideo.id, native_srt: verifySrt.id, dubing_id: dubingId };
      // Short-drama multi-episode: send every episode so the server can sum
      // srt line counts across all episodes (route picks this up when
      // episodes_data.length > 1). The flat native_video/native_srt above is
      // kept for the single-episode fallback path.
      if (isPlaylet && validEpisodes.length > 1) {
        vBody.episodes_data = validEpisodes.map(ep => ({ native_video: ep.video!.id, native_srt: ep.srt!.id }));
      }
      if (useExistingModel) vBody.learning_model_id = existingModelId;
      else if (learningSrt) vBody.learning_srt = learningSrt.id;
      vBody.bgm = bgmValue;
      const vr = await fetch('/api/narrator/material-verification', { method: 'POST', headers: apiHeaders(), body: JSON.stringify(vBody) });
      const vj = await vr.json();
      if (vj.success) { setVerifyOk(true); setVerifyMsg(vj.data?.message || '素材校验通过'); }
      else { setVerifyOk(false); setVerifyMsg(vj.error || '素材验证失败'); setVerifying(false); return; }
    } catch { setVerifyOk(false); setVerifyMsg('验证请求失败'); setVerifying(false); return; }
    setVerifying(false);
    setLoadingBudget(true);
    setHardPriceResult(null);
    setSrtQuoteResult(null);
    setSrtQuoteError(null);
    try {
      // Track pricing path outcome with local variables to avoid React state
      // closure stale-read bug (React 19 batches setState in async functions,
      // so reading state within the same callback always returns the old value).
      let hardPriceResolved = false;

      // Fetch server-side feature flags (runtime values, not build-time)
      const { fetchFeatureFlags, shouldUseHardPrice, shouldUseHardPriceV2 } = await import('@/lib/feature-flags');
      await fetchFeatureFlags(); // populate cache from server
      const { resolveComboKey, fetchHardPrice, createHardPriceBudgetSnapshot } = await import('@/lib/hard-price-utils');
      const isOriginal = writingType === 1 || writingType === 2;
      const useHardPriceV2 = shouldUseHardPriceV2(appKey);
      const useHardPrice = shouldQuotePresetTemplateOnStep4({
        useCustomTemplate,
        hasConfirmedTemplate: !!confirmedTemplate,
        hardPriceFlagEnabled: shouldUseHardPrice(appKey),
      });

      // Custom-template SRT realtime quote (product requirement Plan ③ / ④)
      if (useCustomTemplate && learningSrt) {
        const comboKey = resolveComboKey(writingType as 0 | 1 | 2, writingModel);
        if (useHardPriceV2) {
          const quote = await hardPriceQuoteV2.quoteOnOpen({
            appKey,
            custom_template_id: customSrtTemplateId(learningSrt.id),
            custom_srt_file_id: learningSrt.id,
            combo_key: comboKey,
            pro_upgrade: comboKey.endsWith('_pro'),
          });
          if (quote) {
            setSrtQuoteResult(quoteToSrtRealtimeQuote(quote));
            setBudgetResult({
              _hardPrice: true,
              _srtQuote: true,
              total_consume_points: quote.final_charge_price,
              total_points: quote.final_charge_price,
              hard_price: quote.final_charge_price,
              combo_key: quote.combo_key,
              pricing_rule_version: quote.pricing_rule_version,
              quote_id: quote.quote_id,
              price_source: quote.price_source,
            });
            hardPriceResolved = true;
          } else {
            setSrtQuoteError(hardPriceQuoteV2.error?.message ?? 'SRT 定价估算失败');
          }
        } else {
          try {
            const sqr = await fetch('/api/narrator/srt-realtime-quote', {
              method: 'POST',
              headers: { ...apiHeaders(), 'Content-Type': 'application/json' },
              body: JSON.stringify({ srt_file_id: learningSrt.id, combo_key: comboKey }),
            });
            const sqj = await sqr.json();
            if (sqj.success) {
              setSrtQuoteResult(sqj.data);
              setBudgetResult({ total_consume_points: sqj.data.estimated_points, pricing_rule_version: sqj.data.pricing_rule_version, _srtQuote: true });
              hardPriceResolved = true;
            } else if (sqr.status === 503) {
              setSrtQuoteError('定价服务暂不可用，请稍后重试');
            } else {
              setSrtQuoteError(sqj.error?.message ?? sqj.error ?? 'SRT 定价估算失败');
            }
          } catch { setSrtQuoteError('定价服务请求失败，请重试'); }
        }
      }

      const useHardPriceV2ForTemplate = shouldQuotePresetTemplateOnStep4({
        useCustomTemplate,
        hasConfirmedTemplate: !!confirmedTemplate,
        hardPriceFlagEnabled: useHardPriceV2,
      });
      if ((useHardPriceV2ForTemplate || useHardPrice) && confirmedTemplate) {
        const comboKey = resolveComboKey(writingType as 0 | 1 | 2, writingModel);
        if (useHardPriceV2ForTemplate) {
          const catalogComboKey = toCatalogTierCode(comboKey);
          // regression coverage: `code` is the canonical cross-system identifier; the
          // legacy `template_id` carries the narrator 主 ID for
          // backwards compat / debugging only and is ignored by the
          // backend (Backend API contract) whenever `code` is present.
          const quote = await hardPriceQuoteV2.quoteOnOpen({
            appKey,
            ...buildTemplateQuoteIdentity(confirmedTemplate),
            combo_key: catalogComboKey,
            pro_upgrade: catalogComboKey.endsWith('_pro'),
          });
          if (quote) {
            setBudgetResult({
              _hardPrice: true,
              total_consume_points: quote.final_charge_price,
              total_points: quote.final_charge_price,
              hard_price: quote.final_charge_price,
              combo_key: quote.combo_key,
              pricing_rule_version: quote.pricing_rule_version,
              quote_id: quote.quote_id,
              price_source: quote.price_source,
            });
            setConfirmedTemplate(prev => prev ? { ...prev, hard_price: quote.final_charge_price, combo_key: comboKey } : prev);
            hardPriceResolved = true;
          }
          // V2 failure: hardPriceQuoteV2 hook holds the error state.
          // Do NOT fall back to V1 hard-price — V2 is the unified pricing
          // path for templates per the v2 rollout.
        } else {
          const hp = await fetchHardPrice(confirmedTemplate.id, comboKey, apiHeaders());
          if (hp) {
            hardPriceResolved = true;
            setHardPriceResult(hp);
            const snap = createHardPriceBudgetSnapshot(hp);
            setBudgetResult({ _hardPrice: true, total_consume_points: hp.hard_price, ...snap });
            setConfirmedTemplate(prev => prev ? { ...prev, hard_price: hp.hard_price, combo_key: hp.combo_key } : prev);
          } else {
            console.warn('[hard-price] not found; no fallback (consume-budget deprecated)');
          }
        }
      }
    } catch (e) { console.warn('[budget] budget calc error:', e); } finally { setLoadingBudget(false); }
  }, [appKey, apiHeaders, nativeVideo, nativeSrt, learningSrt, bgmValue, dubingId, useExistingModel, existingModelId, selectedType, selectedVersion, narratorTypeMap, rawVideoQueued, rawVideoFileId, rawVideoFiles, episodes, writingType, writingModel, useCustomTemplate, hardPriceQuoteV2, confirmedTemplate]);

  const handleCreate = async () => {
    if (!appKey) return;
    // 素材未处理模式：需要原始视频文件 ID
    const isRawMode = !materialProcessed && !!rawVideoFileId;
    if (!isRawMode) {
      if (!isPlaylet && (!nativeSrt || !nativeVideo)) return;
      if (isPlaylet && validEpisodes.length === 0) return;
    }
    setCreating(true);

    // ── Hard-price v2 : quote at submit, pass quote_id to backend ──
    // Backend writes the pricing snapshot atomically inside POST
    // /narrator/tasks when `quote_id` is present, so the web side
    // doesn't separately freeze / confirm / refund the wallet.
    // Gated by the independent v2 rollout flag — v1 stays primary
    // until v2 rollout reaches 100%.
    let v2QuoteId: string | undefined;
    let v2Quote: PricingQuoteData | null = null;
    let useHardPriceV2 = false;
    const customSrtTemplate = useCustomTemplate && learningSrt
      ? customSrtTemplateId(learningSrt.id)
      : undefined;
    if (
      (isHardPrice && confirmedTemplate?.combo_key && confirmedTemplate?.id != null) ||
      customSrtTemplate
    ) {
      const { fetchFeatureFlags, shouldUseHardPriceV2 } = await import('@/lib/feature-flags');
      await fetchFeatureFlags();
      useHardPriceV2 = shouldUseHardPriceV2(appKey);
    }
    if (useHardPriceV2 && (
      (confirmedTemplate?.combo_key && confirmedTemplate?.id != null) ||
      (customSrtTemplate && learningSrt)
    )) {
      const customComboKey = customSrtTemplate
        ? resolveComboKey(writingType as 0 | 1 | 2, writingModel)
        : undefined;
      const catalogComboKey = !customSrtTemplate && confirmedTemplate?.combo_key
        ? toCatalogTierCode(confirmedTemplate.combo_key)
        : undefined;
      const quoteParams = customSrtTemplate && learningSrt
        ? {
            appKey,
            custom_template_id: customSrtTemplate,
            custom_srt_file_id: learningSrt.id,
            combo_key: customComboKey!,
            pro_upgrade: customComboKey!.endsWith('_pro'),
          }
        : {
            appKey,
            // regression coverage: `code` is the canonical identifier; `template_id`
            // is sent alongside as a legacy advisory value only.
            ...buildTemplateQuoteIdentity(confirmedTemplate!),
            combo_key: catalogComboKey!,
            pro_upgrade: catalogComboKey!.endsWith('_pro'),
          };
      const quote = await hardPriceQuoteV2.quoteOnOpen(quoteParams);
      if (!quote) {
        const err = hardPriceQuoteV2.error;
        const msg =
          err?.code === 'WALLET_INSUFFICIENT_BALANCE'
            ? `余额不足（需 ${err.details?.required ?? '-'} 点，余 ${err.details?.available ?? '-'} 点），任务未创建`
            : err?.message || '报价失败，任务未创建';
        showToast('error', msg);
        setCreating(false);
        return;
      }
      v2Quote = quote;
      v2QuoteId = quote.quote_id;
      showToast('success', `已锁定本次任务总价 ${quote.final_charge_price} 点`);
    }

    // ── Hard-price v1: freeze wallet before creating task (legacy path) ──
    let walletSnapshot = null;
    if (!useHardPriceV2 && isHardPrice && confirmedTemplate?.hard_price && confirmedTemplate?.combo_key) {
      walletSnapshot = await hardPriceOrder.freeze({
        appKey,
        templateId: confirmedTemplate.id,
        comboKey: confirmedTemplate.combo_key,
        clientPrice: confirmedTemplate.hard_price,
      });
      if (!walletSnapshot) {
        showToast('error', hardPriceOrder.error || '余额冻结失败，任务未创建');
        setCreating(false);
        return;
      }
    }
    const typeValue = narratorTypeMap[selectedType] || selectedType;
    const now = new Date().toISOString();

    // ── 确定第一步 ──────────────────────────────────────────
    const isOriginalWriting = writingType === 1 || writingType === 2;
    let confirmedMovieName = '';
    if (isOriginalWriting && confirmedMovieJson) {
      try {
        const parsed = JSON.parse(confirmedMovieJson);
        confirmedMovieName = String(parsed?.local_title || parsed?.title || parsed?.original_title || '').trim();
      } catch {
        confirmedMovieName = '';
      }
    }
    const resolvedPlayletName = (isOriginalWriting ? confirmedMovieName : '').trim() || playletName.trim();
    const firstStep: string =
      isRawMode ? 'subtitle_extract'                  // 素材未处理：先提取字幕
      : enableSubsync ? 'subsync'
      : isOriginalWriting ? 'fast_generate_writing'   // 原创文案跳过爆款学习
      : useExistingModel ? 'generate_writing'
      : 'popular_learning';

    const masterBudgetSnapshot: BudgetSnapshot | undefined = v2Quote && isHardPrice
      ? buildV2MasterBudgetSnapshot(v2Quote)
      : !isHardPrice && budgetResult ? {
          total_points: parseFloat(((budgetResult.total_consume_points ?? 0) - (isOriginalWriting ? (budgetResult.commentary_generation_points ?? 0) + (budgetResult.viral_learning_points ?? 0) : (budgetResult.text_model_points ?? 0))).toFixed(2)),
          learning_points: isOriginalWriting ? 0 : (budgetResult.viral_learning_points ?? budgetResult.learning_points),
          writing_points: isOriginalWriting ? (budgetResult.text_model_points ?? 0) : (budgetResult.commentary_generation_points ?? budgetResult.writing_points),
          composing_points: budgetResult.video_synthesis_points ?? budgetResult.composing_points,
          pricing_rule_version: budgetResult.pricing_rule_version,
        }
      : undefined;

    // ── Step 1: 创建本地总任务记录 ─────────────────────────────
    // Hard dependency: failure propagates to the outer catch which handles wallet refund
    const mtBody = {
        app_key: appKey,
        narrator_type: typeValue,
        narrator_type_label: selectedType,
        model_version: selectedVersion,
        dubing_id: dubingId,
        run_auto: runAuto,
        use_existing_model: useExistingModel,
        existing_model_id: existingModelId || undefined,
        native_video_id: isRawMode ? undefined : (isPlaylet ? validEpisodes[0]?.video?.id : nativeVideo!.id),
        native_video_name: isRawMode ? undefined : (isPlaylet ? validEpisodes[0]?.video?.name : nativeVideo!.name),
        native_srt_id: isRawMode ? undefined : (isPlaylet ? validEpisodes[0]?.srt?.id : nativeSrt!.id),
        native_srt_name: isRawMode ? undefined : (isPlaylet ? validEpisodes[0]?.srt?.name : nativeSrt!.name),
        // regression coverage: persist every playlet episode so downstream steps
        // (writing / clip / compose) can address all of them. The
        // native_* fields above still mirror episode 0 for backward
        // compatibility with legacy consumers / single-episode display.
        episodes_data: (!isRawMode && isPlaylet && validEpisodes.length > 0)
          ? validEpisodes.map(ep => ({
              video_id: ep.video!.id,
              video_name: ep.video!.name,
              srt_id: ep.srt!.id,
              srt_name: ep.srt!.name,
            }))
          : undefined,
        raw_video_id: isRawMode ? rawVideoFileId : undefined,
        raw_video_name: isRawMode ? rawVideoFileName : undefined,
        removal_mode: isRawMode ? removalMode : undefined,
        learning_srt_id: learningSrt?.id,
        learning_srt_name: learningSrt?.name,
        bgm_id: bgmValue,
        bgm_name: useCustomBgm ? bgmFile?.name : (bgmList.find(b => b.bgm_file_id === selectedBgmId)?.name || undefined),
        playlet_name: resolvedPlayletName || undefined,
        target_platform: targetPlatform,
        task_count: taskCount,
        enable_subsync: enableSubsync,
        target_character_name: targetCharacterName || undefined,
        refine_gaps: refineGaps,
        story_info: storyInfo || undefined,
        writing_type: writingType,
        writing_language: isOriginalWriting ? writingLanguage : undefined,
        writing_model: isOriginalWriting ? writingModel : undefined,
        confirmed_movie_json: isOriginalWriting ? confirmedMovieJson : undefined,
        budget_snapshot: masterBudgetSnapshot,
        // regression coverage: `template_id` keeps the narrator 主 ID (`CSV.id`) so any
        // downstream consumer that still reads it sees the historical
        // value. The canonical cross-system identifier rides on `code`
        // below — backend snapshot binding prefers `code` when both
        // sides have it, so the snapshot still binds correctly.
        // NB: we deliberately do NOT use `v2Quote.template_id` here:
        // for a code-driven quote the backend echoes the derived
        // catalog id (e.g. `"178"`), and storing that under
        // `master_task.template_id` would silently shift the field's
        // meaning from narrator 主 ID to catalog id.
        ...buildMasterTaskIdentity({ confirmedTemplate, v2Quote, isCustomSrtTemplate: !!customSrtTemplate }),
        combo_key: v2Quote?.combo_key ?? (customSrtTemplate ? resolveComboKey(writingType as 0 | 1 | 2, writingModel) : confirmedTemplate?.combo_key),
        custom_template_id: v2Quote?.custom_template_id ?? customSrtTemplate ?? undefined,
        custom_srt_file_id: customSrtTemplate
          ? learningSrt?.id ?? customSrtFileIdFromTemplateId(v2Quote?.custom_template_id)
          : undefined,
        wallet_transaction: walletSnapshot ?? undefined,
        // v2 (regression coverage manual / regression coverage custom): backend writes
        // pricing_snapshots_v2 atomically when quote_id is set and the
        // body's (combo_key, template_id, custom_template_id,
        // custom_srt_file_id) tuple matches the bound quote.
        // snapshot_id flows back in the create response.
        quote_id: v2QuoteId,
        status: 'running' as const,
        current_step: firstStep as StepName,
        steps: { [firstStep]: { status: 'pending' as const } },
      };
    // ── Step 2: 调用第一步远程 API ────────────────────────────
    let masterTaskId = '';
    const updateStep = async (step: string, patch: Record<string, unknown>, masterPatch?: Record<string, unknown>) => {
      if (!masterTaskId) return;
      const saved = await updateMasterTaskStep(
        masterTaskId,
        step as StepName,
        patch,
        masterPatch as any,
        appKey,
      );
      if (!saved) throw new Error(`任务状态持久化失败（step: ${step}）`);
    };

    const markFirstStepUncertain = async () => {
      if (!masterTaskId) return;
      const latest = await getMasterTask(masterTaskId, appKey);
      if (!latest) return;
      const protectedTask = markRemoteCallUncertain(
        latest,
        firstStep as StepName,
      );
      const saved = await replaceMasterTask(masterTaskId, protectedTask, appKey);
      if (!saved) throw new Error(`Failed to protect uncertain remote call state (step: ${firstStep})`);
    };

    try {
      masterTaskId = (await createMasterTask(mtBody as any)).narrator_task_id;
      await updateStep(firstStep, { status: 'running', started_at: now });

      let ep = '';
      let body: Record<string, unknown> = {};

      if (firstStep === 'subtitle_extract') {
        ep = '/api/tools/subtitle-extract';
        body = { file_id: [rawVideoFileId], mode: 2, language: 'Auto-Detect', subtitle_position: 'auto' };
      } else if (firstStep === 'subsync') {
        ep = '/api/narrator/create-subsync';
        body = { episodes_data: isPlaylet
          ? validEpisodes.map((ep, i) => ({ video_oss_key: ep.video!.id, srt_oss_key: ep.srt!.id, num: String(i + 1) }))
          : [{ video_oss_key: nativeVideo!.id, srt_oss_key: nativeSrt!.id, num: '1' }] };
      } else if (firstStep === 'popular_learning') {
        ep = '/api/narrator/create-popular-learning';
        body = { video_srt_path: learningSrt?.id || (isPlaylet ? validEpisodes[0]?.srt?.id : nativeSrt!.id), narrator_type: typeValue, model_version: selectedVersion };
      } else if (firstStep === 'fast_generate_writing') {
        ep = '/api/narrator/create-fast-writing';
        const isFirstPerson = selectedType.includes('第一人称') || typeValue.includes('first_person');
        body = {
          ...(useExistingModel && existingModelId ? { learning_model_id: existingModelId } : learningSrt ? { learning_srt: learningSrt.id } : {}),
          target_mode: isPlaylet ? 3 : writingType,
          playlet_name: resolvedPlayletName,
          episodes_data: isPlaylet
            ? validEpisodes.map((ep, i) => ({ video_oss_key: ep.video!.id, srt_oss_key: ep.srt!.id, negative_oss_key: ep.video!.id, num: i + 1 }))
            : [{ video_oss_key: nativeVideo!.id, srt_oss_key: nativeSrt!.id, negative_oss_key: nativeVideo!.id, num: 1 }],
          confirmed_movie_json: isPlaylet ? '' : confirmedMovieJson,
          model: writingModel,
          language: writingLanguage,
          perspective: isFirstPerson ? 'first_person' : 'third_person',
          target_character_name: targetCharacterName || '',
          vendor_requirements: '投放在短视频平台，吸引 18 - 35 岁的年轻用户观看',
        };
      } else {
        ep = '/api/narrator/create-generate-writing';
        body = {
          learning_model_id: existingModelId,
          episodes_data: isPlaylet
            ? validEpisodes.map((ep, i) => ({ video_oss_key: ep.video!.id, srt_oss_key: ep.srt!.id, negative_oss_key: ep.video!.id, num: i + 1 }))
            : [{ video_oss_key: nativeVideo!.id, srt_oss_key: nativeSrt!.id, negative_oss_key: nativeVideo!.id, num: 1 }],
          playlet_name: resolvedPlayletName, playlet_num: '1', target_platform: targetPlatform,
          task_count: taskCount, target_character_name: targetCharacterName,
          refine_srt_gaps: refineGaps ? '1' : '0', story_info: storyInfo,
          vendor_requirements: '投放在短视频平台，吸引 18 - 35 岁的年轻用户观看',
        };
      }

      const r = await fetch(ep, { method: 'POST', headers: apiHeaders(), body: JSON.stringify(body) });
      const j = await r.json();

      if (j.success) {
        const remoteTaskId = j.data?.task_id;
        let taskIdPersisted = false;
        for (let attempt = 0; attempt < 3 && !taskIdPersisted; attempt++) {
          try { await updateStep(firstStep, { status: 'running', task_id: remoteTaskId }); taskIdPersisted = true; } catch { /* retry */ }
        }
        // Wallet must be settled whenever the remote task was created — frozen
        // funds must not be stranded if local persistence below fails. confirm()
        // carries remoteTaskId so support can reconcile orphan wallet records.
        if (walletSnapshot && remoteTaskId) {
          const confirmed = await hardPriceOrder.confirm(walletSnapshot.transaction_id, remoteTaskId, appKey);
          if (!confirmed) {
            showToast('error', `任务已创建，但扣费确认失败（${hardPriceOrder.error ?? ''}）。请联系部署管理员处理，任务 ID: ${masterTaskId?.slice(-8) ?? remoteTaskId}`);
            return;
          }
        }
        if (!taskIdPersisted) {
          showToast('error', `任务已启动但状态保存失败，请联系部署管理员。任务 ID: ${masterTaskId.slice(-8)}，远端 ID: ${remoteTaskId ?? '未知'}`);
          return;
        }
        const modeLabel = runAuto === 1 ? '一站式' : '阶段式';
        showToast('success', `第一步已提交（${modeLabel}）${masterTaskId ? ` ID:${masterTaskId.slice(-8)}` : ''}，请在任务列表查看进度`);
        router.push('/narrator/tasks');
      } else {
        try { await updateStep(firstStep, { status: 'failed', error: j.error }, { status: 'failed', error_message: j.error }); } catch { /* best-effort */ }
        // Hard-price: refund the frozen amount on task creation failure.
        // If refund also fails, warn user that balance is still frozen.
        if (walletSnapshot) {
          const refunded = await hardPriceOrder.refund(walletSnapshot.transaction_id, appKey, j.error ?? 'task creation failed');
          if (!refunded) {
            showToast('error', `创建任务失败，且退款未成功，余额仍处于冻结状态。请联系部署管理员（交易 ID: ${walletSnapshot.transaction_id.slice(-12)}）`);
            return;
          }
        }
        showToast('error', j.error || '创建任务失败');
      }
    } catch {
      try { await markFirstStepUncertain(); } catch { /* best-effort */ }
      showToast('error', '任务创建结果不确定，请联系部署管理员核对后再继续，系统已暂停该订单以避免重复创建');
    } finally { setCreating(false); }
  };

  const handleSaveKey = () => {
    const t = keyInput.trim(); if (!t) return;
    setAppKey(t); setShowKeyDialog(false); setKeyInput('');
    showToast('success', 'App Key 已保存');
  };

  const filteredCF = cloudFiles.filter(f =>
    fileMatchesRole(f, filePickerRole) &&
    (!fileSearch || f.file_name.toLowerCase().includes(fileSearch.toLowerCase()))
  );
  // Step 3 template-config summary . Memoized so the row array
  // identity is stable across unrelated re-renders — see security hardening.
  // `writingType` is already typed as `0 | 1 | 2` at the useState
  // declaration, so no runtime cast is needed at this boundary.
  const templateSummary = useMemo(() => {
    const input = {
      useCustomTemplate,
      confirmedTemplate,
      learningSrt,
      writingType,
      writingModel,
    };
    return {
      show: shouldShowTemplateCard(input),
      rows: buildTemplateSummaryRows(input),
    };
  }, [useCustomTemplate, confirmedTemplate, learningSrt, writingType, writingModel]);
  const templateSummaryCard = templateSummary.show ? (
    <div className="rounded-lg border p-4 space-y-2.5">
      <div className="font-medium text-sm flex items-center gap-2">
        <FileText className="h-4 w-4 text-primary" />模板配置
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        {templateSummary.rows.map(row => (
          <div key={row.label} className="flex justify-between gap-2">
            <span className="text-muted-foreground shrink-0">{row.label}</span>
            <span className="font-medium text-right truncate max-w-[160px]" title={row.value}>{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  ) : null;
  // regression coverage: insufficient-balance UX must render on all three Step4 budget
  // branches (existing-template / custom-srt / classic), not just the
  // custom-srt branch the regression coverage fix originally wired.
  const isInsufficientBalance =
    hardPriceQuoteV2.state === 'insufficient' && !!hardPriceQuoteV2.error;
  const insufficientPanel = isInsufficientBalance && hardPriceQuoteV2.error ? (
    <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs space-y-1">
      <p className="font-medium text-destructive">余额不足，无法创建订单</p>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground">
        <span>预计扣费 <span className="font-medium text-foreground tabular-nums">{Number(hardPriceQuoteV2.error.details.required) || 0} 点</span></span>
        <span>账户余额 <span className="font-medium text-foreground tabular-nums">{Number(hardPriceQuoteV2.error.details.available) || 0} 点</span></span>
        <span>还差 <span className="font-medium text-destructive tabular-nums">{Number(hardPriceQuoteV2.error.details.shortfall) || 0} 点</span></span>
      </div>
      <p className="text-[10px] text-muted-foreground">请处理账户余额后再试</p>
    </div>
  ) : null;
  const isOriginalWriting = writingType === 1 || writingType === 2;
  const isFirstPerson = selectedType.includes('第一人称');
  const isFilmType = FILM_TYPES.has(selectedType);
  const isPlaylet = selectedType === '短剧';
  const validEpisodes = episodes.filter(ep => ep.video && ep.srt);
  // 短剧不支持「原创文案（纯解说）」，自动重置
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (isPlaylet && writingType === 1) setWritingType(2); }, [isPlaylet]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!isPlaylet) setRawVideoFiles([]); }, [isPlaylet]); // eslint-disable-line react-hooks/exhaustive-deps
  // regression coverage: 短剧模式不支持字幕对齐 — 切到短剧时强制关闭，避免之前在
  // 电影模式勾选过的状态把 enable_subsync=true 带进 payload。
  useEffect(() => { if (isPlaylet) setEnableSubsync(false); }, [isPlaylet]); // eslint-disable-line react-hooks/exhaustive-deps
  const step1Valid = (
    (!!selectedType && !isPlaylet && !useMaterialLib && materialProcessed && !!nativeVideo && !!nativeSrt) ||
    (!!selectedType && !isPlaylet && useMaterialLib && !!nativeVideo && !!nativeSrt) ||
    (!!selectedType && !isPlaylet && !useMaterialLib && !materialProcessed && !!rawVideoFileId) ||
    (!!selectedType && isPlaylet && materialProcessed && validEpisodes.length > 0) ||
    (!!selectedType && isPlaylet && !materialProcessed && rawVideoFiles.length > 0)
  ) && (!isFirstPerson || !!targetCharacterName.trim());
  const step2Valid = useCustomTemplate ? !!learningSrt : !!confirmedTemplate;
  const customNameValid = (useMaterialLib && !isPlaylet) || (isOriginalWriting && !isPlaylet) || !!playletName.trim();
  const step3Valid = customNameValid && (!isOriginalWriting || (isPlaylet ? (!!playletName || !!confirmedMovieJson) : !!confirmedMovieJson));

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Nav */}
      <header className="border-b bg-card/80 backdrop-blur-sm sticky top-0 z-30">
        <div className="container mx-auto px-4 py-2 flex flex-col gap-2 sm:h-14 sm:flex-row sm:items-center sm:justify-between sm:py-0">
          <div className="flex items-center gap-2">
            <img src="/images/logo-light.png" alt="AI 解说大师" className="h-[1.6rem] w-auto dark:hidden" />
            <img src="/images/logo-dark.svg" alt="AI 解说大师" className="hidden h-[1.6rem] w-auto dark:block" />
          </div>
          <nav className="grid w-full grid-cols-5 gap-1 sm:flex sm:w-auto sm:items-center max-[640px]:[&_button]:w-full max-[640px]:[&_button]:gap-0 max-[640px]:[&_button]:px-2 max-[640px]:[&_button]:text-[0px]">
            <Button variant="default" size="sm" className="gap-1.5"><Zap className="h-4 w-4" />爆款解说</Button>
            <AppNavLink href="/narrator/tasks"><Button variant="ghost" size="sm" className="gap-1.5"><ListChecks className="h-4 w-4" />任务记录</Button></AppNavLink>
            <AppNavLink href="/cloud-drive"><Button variant="ghost" size="sm" className="gap-1.5"><HardDrive className="h-4 w-4" />个人云盘</Button></AppNavLink>
            <AppNavLink href="/account"><Button variant="ghost" size="sm" className="gap-1.5"><User className="h-4 w-4" />个人中心</Button></AppNavLink>
            <ThemeToggle className="ml-0 sm:ml-1" />
          </nav>
        </div>
      </header>

      {/* ── Main page content ── */}
      <div className="flex-1 container mx-auto max-w-6xl px-3 py-4 flex flex-col gap-4 sm:px-4 sm:py-6 sm:gap-6">

        {/* Inline wizard */}
        <div className="bg-card rounded-xl overflow-hidden sm:rounded-2xl">

          {/* Card header */}
          <div className="px-3 pt-4 pb-4 border-b bg-muted/30 sm:px-6 sm:pt-6 sm:pb-5">
            <div className="flex items-center justify-between mb-4">
              <h1 className="text-base font-semibold flex items-center gap-2">
                <Zap className="h-4 w-4 text-primary" />创建任务
              </h1>

            </div>

            {/* Tab bar */}
            <div className="flex items-stretch w-full rounded-xl border bg-background overflow-hidden">
              {([
                { n: 1, label: '选择素材' },
                { n: 2, label: '选择模板' },
                { n: 3, label: '任务参数' },
                { n: 4, label: '确认创建' },
              ] as const).map(({ n, label }, idx) => (
                <div key={n} className="flex items-stretch flex-1 min-w-0">
                  {idx > 0 && (
                    <div className="w-px bg-border shrink-0" />
                  )}
                  <button
                    type="button"
                    onClick={() => { if (n <= wizardStep || (n === wizardStep + 1 && (wizardStep === 1 ? step1Valid : wizardStep === 2 ? step2Valid : step3Valid))) { if (n === 4 && wizardStep < 4) handleStep4Enter(); setWizardStep(n); } }}
                    className={`flex items-center justify-center gap-1 flex-1 px-2 py-2.5 text-xs font-medium transition-colors sm:gap-2 sm:px-4 sm:py-3 sm:text-sm
                      ${n === wizardStep
                        ? 'bg-primary text-primary-foreground'
                        : n < wizardStep
                          ? 'bg-primary/10 text-primary hover:bg-primary/20'
                          : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                      }`}
                  >
                    <span className={`flex items-center justify-center rounded-full w-5 h-5 text-xs font-bold shrink-0
                      ${n === wizardStep ? 'bg-white/30' : n < wizardStep ? 'bg-primary/20' : 'bg-muted'}`}>{n}</span>
                    <span className="hidden sm:inline">{label}</span>
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Step content */}
          <div className="px-3 py-5 sm:px-6 sm:py-8">
      {!appKey ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
              <Settings className="h-10 w-10 opacity-30" />
              <p className="text-sm">请先配置 App Key</p>
              <Button size="sm" onClick={() => setShowKeyDialog(true)}>配置 App Key</Button>
            </div>
          ) : (<>
      {/* Step 1 */}
          {wizardStep === 1 && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

              {/* 左侧：类型配置（占 1/3） */}
              <div className="lg:col-span-1 space-y-10 lg:border-r lg:pr-6">

                {/* ① 解说类型 */}
                <div className="space-y-4">
                  <Label className="text-sm font-medium block flex items-center gap-1.5">
                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-bold shrink-0">①</span>
                    解说类型
                  </Label>
                  {loadingTypes ? (
                    <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin" /></div>
                  ) : (
                    <div className="grid grid-cols-2 gap-3">
                      {narratorTypes.map(t => (
                        <button key={t} type="button" onClick={() => setSelectedType(t)}
                          className={`rounded-md border px-3 py-2.5 text-xs font-medium transition-colors ${selectedType === t ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/50'}`}>
                          {t}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* 第一人称主角名称 */}
                {isFirstPerson && (
                  <div className="space-y-1.5">
                    <Label className="text-sm font-medium block">主角名称 <span className="text-red-500">*</span> <span className="text-muted-foreground font-normal text-xs">（第一人称解说）</span></Label>
                    <Input placeholder="输入主角名称" value={targetCharacterName}
                      onChange={e => setTargetCharacterName(e.target.value)} className="h-9 text-sm" />
                  </div>
                )}

                {/* ② 文案类型 */}
                <div className="space-y-4">
                  <Label className="text-sm font-medium block flex items-center gap-1.5">
                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-bold shrink-0">②</span>
                    文案类型
                  </Label>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {WRITING_TYPES.filter(opt => !isPlaylet || opt.value !== 1).map(opt => (
                      <button key={opt.value} type="button" onClick={() => setWritingType(opt.value)}
                        className={`rounded-md border px-3 py-2.5 text-xs font-medium transition-colors ${writingType === opt.value ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/50'}`}>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

              </div>

              {/* 右侧：选择素材（占 2/3） */}
              <div className="lg:col-span-2 space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                  <Label className="text-sm font-medium flex items-center gap-1.5 shrink-0">
                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-bold shrink-0">③</span>
                    选择素材
                  </Label>
                  {!isPlaylet && (
                    <div className="inline-flex rounded-md border overflow-hidden">
                      <button
                        type="button"
                        onClick={() => {
                          if (useMaterialLib) return;
                          setUseMaterialLib(true);
                          setNativeVideo(null); setNativeSrt(null); setConfirmedMovieJson(''); setMovieFromLib(false); setConfirmedMovieLib(null);
                          setEnableSubsync(false);
                          if (movieLibList.length === 0) fetchMovieLib(1, '');
                        }}
                        className={`px-3 py-1 text-xs font-medium transition-colors ${useMaterialLib ? 'bg-primary text-primary-foreground' : 'bg-transparent hover:bg-muted'}`}
                      >
                        素材库
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (!useMaterialLib) return;
                          setUseMaterialLib(false);
                          setNativeVideo(null); setNativeSrt(null); setConfirmedMovieJson(''); setMovieFromLib(false); setConfirmedMovieLib(null);
                        }}
                        className={`px-3 py-1 text-xs font-medium transition-colors border-l ${!useMaterialLib ? 'bg-primary text-primary-foreground' : 'bg-transparent hover:bg-muted'}`}
                      >
                        自定义
                      </button>
                    </div>
                  )}
                </div>

                {isPlaylet ? (
                  /* ── 短剧 ── */
                  <div className="space-y-4">
                    {episodes.map((ep, idx) => (
                      <div key={idx} className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-muted-foreground">第 {idx + 1} 集</span>
                          {episodes.length > 1 && (
                            <button type="button" onClick={() => setEpisodes(eps => eps.filter((_, i) => i !== idx))}
                              className="text-xs text-red-500 hover:text-red-700">移除</button>
                          )}
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {(['video', 'srt'] as const).map(kind => {
                            const isVideo = kind === 'video';
                            const val = ep[kind];
                            const role = isVideo ? 'episode_video' : 'episode_srt';
                            const label = isVideo ? '素材视频' : '素材字幕 SRT';
                            const icon = isVideo ? <Film className="h-4 w-4 text-primary" /> : <FileText className="h-4 w-4 text-primary" />;
                            return (
                              <div key={kind} className={`rounded-lg border p-3 space-y-2 transition-colors ${val ? 'border-green-300 bg-green-50/40 dark:bg-green-950/20' : 'border-dashed bg-muted/20'}`}>
                                <div className="flex items-center gap-1.5 text-sm font-medium">
                                  {icon}<span>{label}</span><span className="text-red-500 text-xs">*</span>
                                </div>
                                {val ? (
                                  <div className="flex items-center gap-1.5 text-xs">
                                    <CheckCircle2 className="h-3.5 w-3.5 text-green-600 shrink-0" />
                                    <span className="truncate text-green-700 dark:text-green-400 flex-1">{val.name}</span>
                                    <button onClick={() => setEpisodes(eps => eps.map((e, i) => i === idx ? { ...e, [kind]: null } : e))} className="text-muted-foreground hover:text-foreground shrink-0">✕</button>
                                  </div>
                                ) : (
                                  <div className="text-xs text-muted-foreground">未选择</div>
                                )}
                                <Button type="button" size="sm" variant="outline" className="h-7 w-full gap-1 text-xs"
                                  onClick={() => openEpisodePicker(role as 'episode_video' | 'episode_srt', idx)}>
                                  <FolderSearch className="h-3.5 w-3.5" />{val ? '更换' : '从云盘选择'}
                                </Button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                    <Button type="button" size="sm" variant="outline" className="h-7 gap-1 text-xs"
                      onClick={() => setEpisodes(eps => [...eps, { video: null, srt: null }])}>
                      <Plus className="h-3.5 w-3.5" />添加集数
                    </Button>
                    <p className="text-[10px] text-muted-foreground">素材视频请使用已擦除字幕的视频，素材字幕请使用已提取好的 SRT 文件。</p>
                  </div>
                ) : useMaterialLib ? (
                  /* ── 素材库模式 ── */
                  <div className="space-y-2">
                    {/* 已选中提示 */}
                    {confirmedMovieLib && (
                      <div className="flex items-center gap-3 bg-primary/5 border border-primary/20 rounded-lg px-3 py-2.5">
                        <div className="h-8 w-12 rounded overflow-hidden bg-muted shrink-0">
                          <img src={confirmedMovieLib.cover} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" onError={e => { (e.target as HTMLImageElement).style.display='none'; }} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">{confirmedMovieLib.name}</p>
                          <p className="text-xs text-muted-foreground">{confirmedMovieLib.type}</p>
                        </div>
                        <button onClick={() => { setConfirmedMovieLib(null); setNativeVideo(null); setNativeSrt(null); setConfirmedMovieJson(''); setMovieFromLib(false); }}
                          className="text-muted-foreground hover:text-foreground shrink-0 text-sm">✕</button>
                      </div>
                    )}
                    {/* 列表 */}
                    <div className="max-h-[680px] overflow-y-auto rounded-lg border">
                      {loadingMovieLib ? (
                        <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
                      ) : movieLibList.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-8 gap-2 text-muted-foreground">
                          <Film className="h-6 w-6 opacity-30" /><p className="text-xs">暂无素材，请稍后刷新</p>
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3">
                          {movieLibList.map(m => (
                            <button key={m.id} type="button"
                              onClick={() => setMovieLibDetail(m)}
                              className="text-left flex flex-col rounded-lg border overflow-hidden hover:border-primary/50 hover:shadow-md transition-all group bg-card">
                              <div className="relative w-full aspect-video overflow-hidden bg-muted">
                                <img src={m.cover} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover scale-110 blur-lg opacity-60"
                                  referrerPolicy="no-referrer" />
                                <img src={m.cover} alt={m.name} className="relative w-full h-full object-contain group-hover:scale-105 transition-transform duration-300"
                                  referrerPolicy="no-referrer"
                                  onError={e => { (e.target as HTMLImageElement).style.display='none'; }} />
                              </div>
                              <div className="p-2 flex-1 flex flex-col gap-1">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <p className="text-xs font-medium truncate group-hover:text-primary transition-colors flex-1 min-w-0">{m.name}</p>
                                  <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded shrink-0">{m.type}</span>
                                </div>
                                {m.story_info && (
                                  <p className="text-[11px] text-muted-foreground leading-snug line-clamp-2">{m.story_info}</p>
                                )}
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    {/* 分页 + 下一步 */}
                    {!loadingMovieLib && (
                      <div className="flex flex-col gap-2 sm:grid sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                        <div />
                        <div className="flex items-center gap-2">
                          {movieLibTotal > MOVIE_LIB_PAGE_SIZE && (
                            <>
                              <Button size="sm" variant="outline" disabled={movieLibPage <= 1}
                                onClick={() => fetchMovieLib(movieLibPage - 1)} className="h-7 text-xs">上一页</Button>
                              <span className="text-xs text-muted-foreground">{movieLibPage} / {Math.ceil(movieLibTotal / MOVIE_LIB_PAGE_SIZE)}</span>
                              <Button size="sm" variant="outline" disabled={movieLibPage >= Math.ceil(movieLibTotal / MOVIE_LIB_PAGE_SIZE)}
                                onClick={() => fetchMovieLib(movieLibPage + 1)} className="h-7 text-xs">下一页</Button>
                            </>
                          )}
                        </div>
                        <div className="flex justify-end">
                          <Button size="sm" disabled={!step1Valid}
                            onClick={() => setWizardStep(2)} className="gap-1">
                            下一步 <ArrowRight className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  /* ── 自定义模式 ── */
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {([
                        { role: 'native_video' as FileRole, label: '素材视频', icon: <Film className="h-4 w-4 text-primary" />, val: nativeVideo, set: (v: PickedFile | null) => setNativeVideo(v) },
                        { role: 'native_srt' as FileRole,   label: '素材字幕 SRT', icon: <FileText className="h-4 w-4 text-primary" />, val: nativeSrt,  set: (v: PickedFile | null) => setNativeSrt(v) },
                      ] as const).map(({ role, label, icon, val, set }) => (
                        <div key={role} className={`rounded-lg border p-3 space-y-2 transition-colors ${val ? 'border-green-300 bg-green-50/40 dark:bg-green-950/20' : 'border-dashed bg-muted/20'}`}>
                          <div className="flex items-center gap-1.5 text-sm font-medium">
                            {icon}<span>{label}</span><span className="text-red-500 text-xs">*</span>
                          </div>
                          {val ? (
                            <div className="flex items-center gap-1.5 text-xs">
                              <CheckCircle2 className="h-3.5 w-3.5 text-green-600 shrink-0" />
                              <span className="truncate text-green-700 dark:text-green-400 flex-1">{val.name}</span>
                              <button onClick={() => set(null)} className="text-muted-foreground hover:text-foreground shrink-0">✕</button>
                            </div>
                          ) : (
                            <div className="text-xs text-muted-foreground">未选择</div>
                          )}
                          <Button type="button" size="sm" variant="outline" className="h-7 w-full gap-1 text-xs"
                            onClick={() => openFilePicker(role)}>
                            <FolderSearch className="h-3.5 w-3.5" />{val ? '更换' : '从云盘选择'}
                          </Button>
                        </div>
                      ))}
                    </div>
                    <p className="text-[10px] text-muted-foreground">素材视频请使用已擦除字幕的视频，素材字幕请使用已提取好的 SRT 文件。</p>
                  </div>
                )}
              </div>

            </div>
          )}

          {/* Step 2 */}
          {wizardStep === 2 && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

              {/* 左侧：筛选条件（占 1/3） */}
              <div className="lg:col-span-1 space-y-10 lg:border-r lg:pr-6">
                {templateMeta && (
                  <>
                    <div className="space-y-4">
                      <Label className="text-sm font-medium block flex items-center gap-1.5">
                        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-bold shrink-0">①</span>
                        平台筛选
                      </Label>
                      <div className="grid grid-cols-2 gap-3">
                        {[{ id: 0, name: '全部平台' }, ...(templateMeta.platforms || []).filter((p, i, a) => a.findIndex(x => x.name === p.name) === i)].map(p => (
                          <button key={p.id} type="button"
                            onClick={() => { setTemplatePlatformId(p.id); }}
                            className={`rounded-md border px-3 py-2.5 text-xs font-medium transition-colors ${templatePlatformId === p.id ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/50'}`}>
                            {p.name}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-4">
                      <Label className="text-sm font-medium block flex items-center gap-1.5">
                        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-bold shrink-0">②</span>
                        分类筛选
                      </Label>
                      <div className="grid grid-cols-2 gap-3">
                        {[{ id: 0, name: '全部分类' }, ...(templateMeta.categories || []).filter((c, i, a) => a.findIndex(x => x.name === c.name) === i)].map(c => (
                          <button key={c.id} type="button"
                            onClick={() => { setTemplateCategoryId(c.id); }}
                            className={`rounded-md border px-3 py-2.5 text-xs font-medium transition-colors ${templateCategoryId === c.id ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/50'}`}>
                            {c.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* 右侧：模板选择（占 2/3） */}
              <div className="lg:col-span-2 space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                  <Label className="text-sm font-medium flex items-center gap-1.5 shrink-0">
                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-bold shrink-0">③</span>
                    解说模板
                  </Label>
                  <div className="inline-flex rounded-md border overflow-hidden">
                    <button
                      type="button"
                      onClick={() => {
                        if (!useCustomTemplate) return;
                        setUseCustomTemplate(false);
                        setLearningSrt(null);
                      }}
                      className={`px-3 py-1 text-xs font-medium transition-colors ${!useCustomTemplate ? 'bg-primary text-primary-foreground' : 'bg-transparent hover:bg-muted'}`}
                    >
                      模板库
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (useCustomTemplate) return;
                        setUseCustomTemplate(true);
                        setConfirmedTemplate(null); setExistingModelId(''); setUseExistingModel(false);
                      }}
                      className={`px-3 py-1 text-xs font-medium transition-colors border-l ${useCustomTemplate ? 'bg-primary text-primary-foreground' : 'bg-transparent hover:bg-muted'}`}
                    >
                      自定义
                    </button>
                  </div>
                  {!useCustomTemplate && (
                    <div className="flex w-full items-center gap-2 sm:ml-auto sm:max-w-sm sm:flex-1">
                      <div className="relative flex-1">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                        <Input placeholder="搜索模板标题…" value={templateSearch}
                          onChange={e => setTemplateSearch(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && fetchTemplates(1)}
                          className="pl-8 h-8 text-sm" />
                      </div>
                      <Button size="sm" variant="outline" className="h-8 gap-1 text-xs shrink-0"
                        onClick={() => fetchTemplates(1)} disabled={loadingTemplates}>
                        {loadingTemplates ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                        搜索
                      </Button>
                    </div>
                  )}
                </div>

                {/* 当前已选模板提示条 */}
                {confirmedTemplate && (
                  <div className="flex items-center gap-3 bg-primary/5 border border-primary/20 rounded-lg px-3 py-2.5">
                    <div className="h-8 w-12 rounded overflow-hidden bg-muted shrink-0">
                      <img src={confirmedTemplate.img} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" onError={e => { (e.target as HTMLImageElement).style.display='none'; }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{confirmedTemplate.name}</p>
                      <p className="text-xs text-muted-foreground">{confirmedTemplate.platform.name} · {confirmedTemplate.narrator_type.name}</p>
                    </div>
                    <button onClick={() => { setConfirmedTemplate(null); setExistingModelId(''); setUseExistingModel(false); }}
                      className="text-muted-foreground hover:text-foreground shrink-0 text-sm">✕</button>
                  </div>
                )}

                {useCustomTemplate ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className={`rounded-lg border p-3 space-y-2 transition-colors ${learningSrt ? 'border-green-300 bg-green-50/40 dark:bg-green-950/20' : 'border-dashed bg-muted/20'}`}>
                        <div className="flex items-center gap-1.5 text-sm font-medium">
                          <FileText className="h-4 w-4 text-primary" /><span>爆款 SRT 文件</span><span className="text-red-500 text-xs">*</span>
                        </div>
                        {learningSrt ? (
                          <div className="flex items-center gap-1.5 text-xs">
                            <CheckCircle2 className="h-3.5 w-3.5 text-green-600 shrink-0" />
                            <span className="truncate text-green-700 dark:text-green-400 flex-1">{learningSrt.name}</span>
                            <button onClick={() => setLearningSrt(null)} className="text-muted-foreground hover:text-foreground shrink-0">✕</button>
                          </div>
                        ) : (
                          <div className="text-xs text-muted-foreground">未选择</div>
                        )}
                        <Button type="button" size="sm" variant="outline" className="h-7 w-full gap-1 text-xs"
                          onClick={() => openFilePicker('learning_srt')}>
                          <FolderSearch className="h-3.5 w-3.5" />{learningSrt ? '更换' : '从云盘选择'}
                        </Button>
                      </div>
                    </div>
                    <p className="text-[10px] text-muted-foreground">自定义 SRT 将直接作为爆款学习样本，跳过模板库。</p>
                  </div>
                ) : (
                  <>
                    <div className="max-h-[680px] overflow-y-auto rounded-lg border">
                      {loadingTemplates ? (
                        <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
                      ) : templateList.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
                          <LayoutTemplate className="h-8 w-8 opacity-30" />
                          <p className="text-sm">暂无模板，请尝试其他筛选条件</p>
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3">
                          {templateList.map(t => (
                            <button key={t.id} type="button"
                              onClick={() => { setDetailTemplate(t); setShowTemplateDetail(true); }}
                              className={`text-left flex flex-col rounded-lg border overflow-hidden transition-all hover:shadow-md group bg-card ${confirmedTemplate?.id === t.id ? 'border-primary ring-1 ring-primary' : 'border-border hover:border-primary/40'}`}>
                              <div className="relative w-full aspect-video overflow-hidden bg-muted">
                                <img src={t.img} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover scale-110 blur-lg opacity-60"
                                  referrerPolicy="no-referrer" />
                                <img src={t.img} alt={t.name}
                                  className="relative w-full h-full object-contain group-hover:scale-105 transition-transform duration-300"
                                  referrerPolicy="no-referrer"
                                  onError={e => { (e.target as HTMLImageElement).style.display='none'; }} />
                                {confirmedTemplate?.id === t.id && (
                                  <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                                    <CheckCircle2 className="h-5 w-5 text-primary drop-shadow" />
                                  </div>
                                )}
                                <div className="absolute top-1 right-1 bg-black/60 text-white text-[10px] px-1 py-0.5 rounded">{t.time}</div>
                                {(() => {
                                  const all = templatePricesCache[t.id];
                                  if (!all?.length) return null;
                                  const relevant = relevantComboKeysForWritingType(writingType);
                                  const filtered = all.filter(p => relevant.includes(p.combo_key));
                                  if (!filtered.length) return null;
                                  return (
                                    <div className="absolute bottom-1 right-1 bg-amber-500/90 text-white text-[10px] px-1.5 py-0.5 rounded font-medium">
                                      {Math.min(...filtered.map(p => p.hard_price)).toFixed(0)} 点
                                    </div>
                                  );
                                })()}
                              </div>
                              <div className="p-2 flex-1 flex flex-col gap-1">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <p className="text-xs font-medium truncate group-hover:text-primary transition-colors flex-1 min-w-0">{t.name}</p>
                                  <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded shrink-0">{t.platform.name}</span>
                                </div>
                                {t.categories.length > 0 && (
                                  <div className="flex flex-wrap gap-1">
                                    {t.categories.slice(0, 2).map(c => (
                                      <span key={c.id} className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded">{c.name}</span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    {!loadingTemplates && (
                      <div className="flex flex-col gap-2 sm:grid sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                        <div />
                        <div className="flex items-center gap-2">
                          {templateTotal > 21 && (
                            <>
                              <Button size="sm" variant="outline" disabled={templatePage <= 1}
                                onClick={() => fetchTemplates(templatePage - 1)} className="h-7 text-xs">上一页</Button>
                              <span className="text-xs text-muted-foreground">{templatePage} / {Math.ceil(templateTotal / 21)}</span>
                              <Button size="sm" variant="outline" disabled={templatePage >= Math.ceil(templateTotal / 21)}
                                onClick={() => fetchTemplates(templatePage + 1)} className="h-7 text-xs">下一页</Button>
                            </>
                          )}
                        </div>
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="outline" onClick={() => setWizardStep(1)}>上一步</Button>
                          <Button size="sm" disabled={!step2Valid}
                            onClick={() => setWizardStep(3)} className="gap-1">
                            下一步 <ArrowRight className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>

            </div>
          )}

          {/* Step 3 */}
          {wizardStep === 3 && (() => {
            const C = ['①','②','③','④','⑤','⑥','⑦','⑧','⑨','⑩'];
            let _n = 0;
            const n = () => C[_n++];
            const nOriginal = isOriginalWriting ? n() : null;
            const nName = (!isOriginalWriting && (isPlaylet || !useMaterialLib)) ? n() : null;
            const nBgm = n();
            const nDub = n();
            const nPlat = n();
            const nSwitch = !useMaterialLib ? n() : null;
            const nDeliver = n();
            return (
            <div className="space-y-7">

              {/* 原创文案配置 */}
              {isOriginalWriting && (
                <div className="rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-950/20 p-4 space-y-4">
                  <p className="text-sm font-medium text-indigo-700 dark:text-indigo-300 flex items-center gap-1.5">
                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-indigo-200/60 dark:bg-indigo-800/60 text-indigo-700 dark:text-indigo-300 text-xs font-bold shrink-0">{nOriginal}</span>
                    原创文案配置
                  </p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label className="text-sm">文案语言</Label>
                      <Select value={writingLanguage} onValueChange={setWritingLanguage}>
                        <SelectTrigger className="h-9 w-full text-sm sm:w-48"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {WRITING_LANGUAGES.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-sm">文案模型</Label>
                      <Select value={writingModel} onValueChange={v => setWritingModel(v as 'flash' | 'pro')}>
                        <SelectTrigger className="h-9 w-full text-sm sm:w-48"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="flash">极速版</SelectItem>
                          <SelectItem value="pro">旗舰版</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-sm">{isPlaylet ? '短剧名称' : '电影信息'} <span className="text-red-500">*</span></Label>
                    {isPlaylet ? (
                      <div className="space-y-2">
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <Input placeholder="请输入或搜索短剧名称" value={playletName}
                            onChange={e => setPlayletName(e.target.value)}
                            className="h-9 w-full text-sm sm:w-48" />
                          <Button type="button" size="sm" variant="outline" className="h-9 gap-1.5 shrink-0"
                            onClick={() => { setMovieSearchQuery(playletName); setShowMovieSearch(true); }}>
                            <Search className="h-3.5 w-3.5" />搜索
                          </Button>
                        </div>
                        {confirmedMovieJson && (
                          <div className="flex items-center gap-2 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg px-3 py-1.5 text-xs">
                            <CheckCircle2 className="h-3 w-3 text-green-600 shrink-0" />
                            <span className="truncate text-green-700 dark:text-green-400 flex-1">
                              {(() => { try { const m = JSON.parse(confirmedMovieJson); return m.local_title || m.title || '已找到匹配信息'; } catch { return '已找到匹配信息'; } })()}
                            </span>
                            <span className="text-muted-foreground shrink-0">已匹配</span>
                            <button onClick={() => { setConfirmedMovieJson(''); setMovieFromLib(false); }} className="text-muted-foreground hover:text-foreground">✕</button>
                          </div>
                        )}
                      </div>
                    ) : confirmedMovieJson ? (
                      <div className="flex items-center gap-2 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg px-3 py-2">
                        <CheckCircle2 className="h-3.5 w-3.5 text-green-600 shrink-0" />
                        <span className="text-sm text-green-700 dark:text-green-400 truncate flex-1">
                          {(() => { try { const m = JSON.parse(confirmedMovieJson); return m.local_title || m.title || '已确认'; } catch { return '已确认'; } })()}
                        </span>
                        {movieFromLib && (
                          <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded shrink-0">素材库</span>
                        )}
                        <button onClick={() => { setConfirmedMovieJson(''); setMovieFromLib(false); }} className="text-muted-foreground hover:text-foreground text-xs">✕</button>
                      </div>
                    ) : (
                      <Button type="button" size="sm" variant="outline" className="h-9 gap-1.5 w-full text-sm"
                        onClick={() => { setMovieSearchQuery(playletName); setShowMovieSearch(true); }}>
                        <Search className="h-3.5 w-3.5" />搜索电影信息（必填）
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {/* 剧名/电影名 */}
              {(!isOriginalWriting && (isPlaylet || !useMaterialLib)) && (
                <div className="space-y-2">
                  <Label className="text-sm font-medium flex items-center gap-1.5">
                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-bold shrink-0">{nName}</span>
                    {isPlaylet ? '短剧名称' : '电影名称'} <span className="text-red-500">*</span>
                  </Label>
                  <Input placeholder={isPlaylet ? '请输入短剧名称' : '请输入电影名称'} value={playletName}
                    onChange={e => setPlayletName(e.target.value)}
                    className="h-9 w-full text-sm sm:w-48" />
                </div>
              )}

              {templateSummaryCard}

              {/* BGM */}
              <div className="space-y-3">
                <Label className="text-sm font-medium flex items-center gap-1.5">
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-bold shrink-0">{nBgm}</span>
                  选择BGM
                </Label>
                {loadingBgm ? (
                  <div className="flex h-9 w-full items-center gap-2 rounded-md border px-3 text-xs text-muted-foreground sm:w-48">
                    <Loader2 className="h-3 w-3 animate-spin" />加载 BGM 库…
                  </div>
                ) : (
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-[30px]">
                    <Popover open={bgmPopOpen} onOpenChange={setBgmPopOpen}>
                      <PopoverTrigger asChild>
                        <button type="button" className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 text-sm hover:bg-accent hover:text-accent-foreground sm:w-48">
                          <span className="truncate">
                            {useCustomBgm ? '自定义BGM' : selectedBgmId === 'NO_BGM' ? '不使用BGM' : (bgmList.find(b => b.bgm_file_id === selectedBgmId)?.name || '选择BGM')}
                          </span>
                          <ChevronDown className="h-3.5 w-3.5 opacity-50 shrink-0 ml-1" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent align="start" className="w-72 p-1 max-h-72 overflow-y-auto">
                        <button type="button" onClick={() => { stopPreview(); setUseCustomBgm(true); setBgmPopOpen(false); }}
                          className={`w-full text-left rounded px-2.5 py-2 text-sm hover:bg-accent transition-colors ${useCustomBgm ? 'bg-primary/10 text-primary font-medium' : ''}`}>自定义BGM</button>
                        <button type="button" onClick={() => { stopPreview(); setUseCustomBgm(false); setSelectedBgmId('NO_BGM'); setBgmPopOpen(false); }}
                          className={`w-full text-left rounded px-2.5 py-2 text-sm hover:bg-accent transition-colors ${!useCustomBgm && selectedBgmId === 'NO_BGM' ? 'bg-primary/10 text-primary font-medium' : ''}`}>不使用BGM</button>
                        {bgmList.map(b => (
                          <div key={b.id} className={`flex items-center gap-2 rounded px-2.5 py-2 hover:bg-accent transition-colors ${
                            !useCustomBgm && selectedBgmId === b.bgm_file_id ? 'bg-primary/10 text-primary font-medium' : ''}`}>
                            <button type="button" className="flex-1 text-left text-sm"
                              onClick={() => { stopPreview(); setUseCustomBgm(false); setSelectedBgmId(b.bgm_file_id); setBgmPopOpen(false); }}>
                              {b.name}{b.tag ? ' · ' + b.tag : ''}
                            </button>
                            {b.bgm_demo_url && (
                              <button type="button" onClick={() => togglePreview(b.bgm_demo_url, `bgm_${b.bgm_file_id}`)}
                                className="shrink-0 text-primary/70 hover:text-primary transition-colors p-0.5" title="试听">
                                {previewingId === `bgm_${b.bgm_file_id}` ? <PauseCircle className="h-4 w-4" /> : <PlayCircle className="h-4 w-4" />}
                              </button>
                            )}
                          </div>
                        ))}
                      </PopoverContent>
                    </Popover>
                    {useCustomBgm && (
                      bgmFile ? (
                        <div className="flex items-center gap-1.5 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg px-3 py-2 text-xs min-w-0">
                          <CheckCircle2 className="h-3.5 w-3.5 text-green-600 shrink-0" />
                          <span className="truncate text-green-700 dark:text-green-400">{bgmFile.name}</span>
                          <button onClick={() => setBgmFile(null)} className="ml-auto text-muted-foreground hover:text-foreground shrink-0">✕</button>
                        </div>
                      ) : (
                        <Button type="button" size="sm" variant="outline" className="h-9 gap-1 text-xs shrink-0"
                          onClick={() => openFilePicker('bgm')}>
                          <FolderSearch className="h-3.5 w-3.5" />从云盘选择
                        </Button>
                      )
                    )}
                  </div>
                )}
              </div>

              {/* 配音 */}
              <div className="space-y-3">
                <Label className="text-sm font-medium flex items-center gap-1.5">
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-bold shrink-0">{nDub}</span>
                  选择配音
                </Label>
                {loadingDubbing ? (
                  <div className="flex h-9 w-full items-center gap-2 rounded-md border px-3 text-xs text-muted-foreground sm:w-48">
                    <Loader2 className="h-3 w-3 animate-spin" />加载配音库…
                  </div>
                ) : (
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-[30px]">
                    <Popover open={dubPopOpen} onOpenChange={setDubPopOpen}>
                      <PopoverTrigger asChild>
                        <button type="button" className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 text-sm hover:bg-accent hover:text-accent-foreground sm:w-48">
                          <span className="truncate">
                            {useCustomDubing ? '自定义配音' : (dubbingList.find(d => d.dubbing_id === dubingId)?.name || '选择配音')}
                          </span>
                          <ChevronDown className="h-3.5 w-3.5 opacity-50 shrink-0 ml-1" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent align="start" className="w-72 p-1 max-h-72 overflow-y-auto">
                        <button type="button" onClick={() => { stopPreview(); setUseCustomDubing(true); setDubingId(''); setDubPopOpen(false); }}
                          className={`w-full text-left rounded px-2.5 py-2 text-sm hover:bg-accent transition-colors ${useCustomDubing ? 'bg-primary/10 text-primary font-medium' : ''}`}>自定义配音</button>
                        {dubbingList.map(d => (
                          <div key={d.id} className={`flex items-center gap-2 rounded px-2.5 py-2 hover:bg-accent transition-colors ${
                            !useCustomDubing && dubingId === d.dubbing_id ? 'bg-primary/10 text-primary font-medium' : ''}`}>
                            <button type="button" className="flex-1 text-left text-sm"
                              onClick={() => { stopPreview(); setUseCustomDubing(false); setDubingId(d.dubbing_id); setDubPopOpen(false); }}>
                              {d.name}
                            </button>
                            {d.dubbing_demo_url && (
                              <button type="button" onClick={() => togglePreview(d.dubbing_demo_url, `dub_${d.dubbing_id}`)}
                                className="shrink-0 text-primary/70 hover:text-primary transition-colors p-0.5" title="试听">
                                {previewingId === `dub_${d.dubbing_id}` ? <PauseCircle className="h-4 w-4" /> : <PlayCircle className="h-4 w-4" />}
                              </button>
                            )}
                          </div>
                        ))}
                      </PopoverContent>
                    </Popover>
                    {useCustomDubing && (
                      <Input placeholder="输入配音ID，如 mercury_yunxi_24k" value={dubingId}
                        onChange={e => setDubingId(e.target.value)} className="h-9 w-full text-sm sm:w-64" />
                    )}
                  </div>
                )}
              </div>

              {/* 目标平台 */}
              <div className="space-y-2">
                <Label className="text-sm font-medium block flex items-center gap-1.5">
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-bold shrink-0">{nPlat}</span>
                  目标平台
                </Label>
                <Select value={targetPlatform} onValueChange={setTargetPlatform}>
                  <SelectTrigger className="h-9 w-full text-sm sm:w-48"><SelectValue /></SelectTrigger>
                  <SelectContent>{PLATFORMS.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                </Select>
              </div>

              {/* 功能开关 — regression coverage: 短剧模式不支持字幕对齐（subsync 子流程
                  仅对电影/单视频路径有效），所以整个开关在 isPlaylet 时
                  不展示，并通过下面的 useEffect 把 enableSubsync 强制清零，
                  避免用户先在电影模式勾选后切换到短剧时把 enable_subsync=true
                  带进 payload。 */}
              {!useMaterialLib && !isPlaylet && (
              <div className="space-y-3">
                <Label className="text-sm font-medium block flex items-center gap-1.5">
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-bold shrink-0">{nSwitch}</span>
                  功能开关
                </Label>
                <div className="flex flex-wrap gap-2">
                  <label className="flex items-center gap-2 rounded-md border px-3 py-1.5 cursor-pointer hover:bg-muted/50 transition-colors select-none">
                    <input type="checkbox" checked={enableSubsync}
                      onChange={e => setEnableSubsync(e.target.checked)} className="h-3.5 w-3.5 rounded" />
                    <span className="text-xs font-medium">开启字幕对齐</span>
                    <span className="text-[10px] text-green-600 font-normal">免费</span>
                  </label>
                </div>
              </div>
              )}

              {/* 交付方式 */}
              <div className="space-y-3">
                <Label className="text-sm font-medium block flex items-center gap-1.5">
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-bold shrink-0">{nDeliver}</span>
                  交付方式
                </Label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button type="button" onClick={() => setRunAuto(0)}
                    className={`flex items-center gap-1.5 rounded-md border px-4 py-2 text-xs font-medium transition-colors ${runAuto === 0 ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/50'}`}>
                    🎛️ 阶段式<span className="text-muted-foreground font-normal hidden sm:inline">（手动确认）</span>
                  </button>
                  <button type="button" onClick={() => setRunAuto(1)}
                    className={`flex items-center gap-1.5 rounded-md border px-4 py-2 text-xs font-medium transition-colors ${runAuto === 1 ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/50'}`}>
                    🚀 一站式<span className="text-muted-foreground font-normal hidden sm:inline">（自动流转）</span>
                  </button>
                </div>
              </div>

            </div>
          );})()}

          {/* Step 4 */}
      {wizardStep === 4 && (
        <div className="space-y-5">
          <div className={`rounded-lg border p-4 space-y-1.5 ${verifyOk === true ? 'border-green-300 bg-green-50/40 dark:bg-green-950/20' : verifyOk === false ? 'border-red-300 bg-red-50/40 dark:bg-red-950/20' : ''}`}>
            <div className="flex items-center gap-2 font-medium text-sm">
              {verifying ? <><Loader2 className="h-4 w-4 animate-spin text-primary" />正在验证素材…</>
                : verifyOk === true ? <><CheckCircle2 className="h-4 w-4 text-green-600" />素材验证通过</>
                : verifyOk === false ? <><XCircle className="h-4 w-4 text-red-600" />素材验证失败</>
                : null}
            </div>
            {verifyMsg && <p className="text-xs text-muted-foreground">{verifyMsg}</p>}
          </div>
          {!verifying && verifyOk && (
            <>
            <div className="rounded-lg border p-4 space-y-2.5">
              <div className="font-medium text-sm flex items-center gap-2">
                <ListChecks className="h-4 w-4 text-primary" />任务参数汇总
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                <div className="flex justify-between gap-2"><span className="text-muted-foreground shrink-0">{isPlaylet ? '短剧名称' : '电影名称'}</span><span className="font-medium text-right truncate max-w-[160px]">{playletName || '—'}</span></div>
                <div className="flex justify-between gap-2"><span className="text-muted-foreground shrink-0">解说类型</span><span className="font-medium text-right">{selectedType}</span></div>
                <div className="flex justify-between gap-2"><span className="text-muted-foreground shrink-0">文案类型</span><span className="font-medium text-right">{WRITING_TYPES.find(w => w.value === writingType)?.label.replace(/（.*）/, '') || '-'}</span></div>
                <div className="flex justify-between gap-2"><span className="text-muted-foreground shrink-0">素材</span><span className="font-medium text-right truncate max-w-[160px]">{rawVideoQueued ? rawVideoFileName + '（待预处理）' : isPlaylet ? `${validEpisodes.length} 集（${validEpisodes[0]?.video?.name || '-'}…）` : (nativeVideo?.name || '-')}</span></div>
                <div className="flex justify-between gap-2"><span className="text-muted-foreground shrink-0">模板</span><span className="font-medium text-right truncate max-w-[160px]">{useCustomTemplate ? '自定义 SRT' : (confirmedTemplate?.name || '-')}</span></div>
                <div className="flex justify-between gap-2"><span className="text-muted-foreground shrink-0">BGM</span><span className="font-medium text-right truncate max-w-[160px]">{useCustomBgm ? (bgmFile?.name || '自定义') : (selectedBgmId === 'NO_BGM' ? '不使用BGM' : (bgmList.find(b => b.bgm_file_id === selectedBgmId)?.name || selectedBgmId))}</span></div>
                <div className="flex justify-between gap-2"><span className="text-muted-foreground shrink-0">配音</span><span className="font-medium text-right truncate max-w-[160px]">{dubingId || '-'}</span></div>
                <div className="flex justify-between gap-2"><span className="text-muted-foreground shrink-0">目标平台</span><span className="font-medium text-right">{targetPlatform}</span></div>
                <div className="flex justify-between gap-2"><span className="text-muted-foreground shrink-0">交付方式</span><span className="font-medium text-right">{runAuto === 0 ? '阶段式' : '一站式'}</span></div>
                {!useMaterialLib && !isPlaylet && <div className="flex justify-between gap-2"><span className="text-muted-foreground shrink-0">字幕对齐</span><span className="font-medium text-right">{enableSubsync ? '已开启（免费）' : '未开启'}</span></div>}
                {rawVideoQueued && <>
                  <div className="flex justify-between gap-2"><span className="text-muted-foreground shrink-0">字幕擦除</span><span className="font-medium text-right">{removalMode === 'standard' ? '标准版' : '高级版'}</span></div>
                  <div className="flex justify-between gap-2"><span className="text-muted-foreground shrink-0">字幕提取</span><span className="font-medium text-right">视觉模式</span></div>
                </>}
              </div>
            </div>
            {isHardPrice ? (
              <div className="rounded-lg border p-4 space-y-2">
                <div className="font-medium text-sm flex items-center gap-2">
                  <Info className="h-4 w-4 text-primary" />本次任务总价
                  {(hardPriceOrder.state === 'quoting' || hardPriceOrder.state === 'freezing') && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  )}
                </div>
                {insufficientPanel}
                {!isInsufficientBalance && (
                <div className="space-y-1.5 text-xs">
                  {budgetResult?._hardPrice ? (
                    <>
                      <div className="flex justify-between">
                        <span className="font-medium">总价</span>
                        <span className="font-bold text-primary tabular-nums">{Number(budgetResult.total_consume_points ?? confirmedTemplate!.hard_price).toFixed(2)} 点</span>
                      </div>
                    </>
                  ) : (
                    <>
                      {/* ⑥ 三级结算展示：标准目录价 / 优惠抵扣 / 最终扣费 */}
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">标准目录价</span>
                        <span className="font-bold text-primary tabular-nums">{confirmedTemplate!.hard_price!.toFixed(2)} 点</span>
                      </div>
                      {hardPriceOrder.transaction && (() => {
                        const listPrice = confirmedTemplate!.hard_price!;
                        const actual = hardPriceOrder.transaction!.amount;
                        const discount = parseFloat((listPrice - actual).toFixed(2));
                        return (
                          <>
                            {discount > 0 && (
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">优惠抵扣</span>
                                <span className="font-medium tabular-nums text-green-600 dark:text-green-400">− {discount.toFixed(2)} 点</span>
                              </div>
                            )}
                            <div className="flex justify-between border-t pt-1.5">
                              <span className="font-medium">{hardPriceOrder.state === 'confirmed' ? '实际扣费' : '待扣费'}</span>
                              <span className={`font-bold tabular-nums ${hardPriceOrder.state === 'confirmed' ? 'text-green-600' : 'text-primary'}`}>{actual.toFixed(2)} 点</span>
                            </div>
                          </>
                        );
                      })()}
                    </>
                  )}
                  {hardPriceOrder.state === 'refunded' && (
                    <p className="text-xs text-amber-600">冻结金额已退回</p>
                  )}
                  {hardPriceOrder.state === 'error' && hardPriceOrder.error && (
                    <p className="text-xs text-destructive">{hardPriceOrder.error}</p>
                  )}
                  {/* ⑤ 附加计费项（当前免费），与模板价格独立展示 */}
                  {(bgmValue !== 'NO_BGM' || enableSubsync) && (
                    <div className="border-t pt-1.5 space-y-1">
                      {bgmValue !== 'NO_BGM' && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">BGM 配乐</span>
                          <span className="font-medium text-green-600 dark:text-green-400">免费</span>
                        </div>
                      )}
                      {enableSubsync && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">字幕对齐</span>
                          <span className="font-medium text-green-600 dark:text-green-400">免费</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                )}
              </div>
            ) : useCustomTemplate ? (
              /* ── 自定义 SRT 实时报价 (product requirement Plan ③/④) ── */
              <div className="rounded-lg border p-4 space-y-2">
                <div className="font-medium text-sm flex items-center gap-2">
                  <Info className="h-4 w-4 text-primary" />本次任务总价
                  {loadingBudget && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                </div>
                {insufficientPanel}
                {!isInsufficientBalance && srtQuoteError && !srtQuoteResult ? (
                  <p className="text-xs text-destructive">{srtQuoteError}</p>
                ) : null}
                {srtQuoteResult ? (
                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between">
                      <span className="font-medium">总价</span>
                      <span className="font-bold text-primary tabular-nums">{srtQuoteResult.estimated_points.toFixed(2)} 点</span>
                    </div>
                    {/* ⑤ 附加计费项 */}
                    {(bgmValue !== 'NO_BGM' || enableSubsync) && (
                      <div className="border-t pt-1.5 space-y-1">
                        {bgmValue !== 'NO_BGM' && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">BGM 配乐</span>
                            <span className="font-medium text-green-600 dark:text-green-400">免费</span>
                          </div>
                        )}
                        {enableSubsync && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">字幕对齐</span>
                            <span className="font-medium text-green-600 dark:text-green-400">免费</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : !loadingBudget && !srtQuoteError ? (
                  <p className="text-xs text-muted-foreground">点数计算失败，仍可继续创建</p>
                ) : null}
              </div>
            ) : (
              <div className="rounded-lg border p-4 space-y-2">
                <div className="font-medium text-sm flex items-center gap-2">
                  <Info className="h-4 w-4 text-primary" />{budgetResult?._hardPrice ? '本次任务总价' : '预计消耗点数'}
                  {loadingBudget && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                </div>
                {insufficientPanel}
                {!isInsufficientBalance && (budgetResult ? (
                  <div className="space-y-1.5 text-xs">
                    {budgetResult._hardPrice ? (
                      <>
                        <div className="flex justify-between">
                          <span className="font-medium">总价</span>
                          <span className="font-bold text-primary tabular-nums">{Number(budgetResult.total_consume_points ?? budgetResult.total_points ?? 0).toFixed(2)} 点</span>
                        </div>
                      </>
                    ) : (
                      <>
                        {rawVideoQueued && (
                          <div className="flex justify-between pb-1 border-b">
                            <span className="text-muted-foreground">字幕擦除和提取</span>
                            <span className="font-medium text-right text-muted-foreground">预处理费用由后端按视频时长返回</span>
                          </div>
                        )}
                        {!isOriginalWriting && <div className="flex justify-between"><span className="text-muted-foreground">爆款学习</span><span className="font-medium tabular-nums">{budgetResult.viral_learning_points}</span></div>}
                        {isOriginalWriting
                          ? <div className="flex justify-between"><span className="text-muted-foreground">原创文案（{writingModel === 'flash' ? '极速版' : '旗舰版'}）</span><span className="font-medium tabular-nums">{budgetResult.text_model_points ?? 0}</span></div>
                          : <div className="flex justify-between"><span className="text-muted-foreground">解说文案</span><span className="font-medium tabular-nums">{budgetResult.commentary_generation_points}</span></div>
                        }
                        <div className="flex justify-between"><span className="text-muted-foreground">合成视频</span><span className="font-medium tabular-nums">{budgetResult.video_synthesis_points}</span></div>
                        <div className="flex justify-between border-t pt-1.5">
                          <span className="font-medium">总计</span>
                          <span className="font-bold text-primary tabular-nums">{parseFloat((budgetResult.total_consume_points - (isOriginalWriting ? (budgetResult.commentary_generation_points ?? 0) + (budgetResult.viral_learning_points ?? 0) : (budgetResult.text_model_points ?? 0))).toFixed(2))} 点{rawVideoQueued ? '（不含预处理）' : ''}</span>
                        </div>
                      </>
                    )}
                    {/* ⑤ 附加计费项 */}
                    {(bgmValue !== 'NO_BGM' || enableSubsync) && (
                      <div className="border-t pt-1.5 space-y-1">
                        {bgmValue !== 'NO_BGM' && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">BGM 配乐</span>
                            <span className="font-medium text-green-600 dark:text-green-400">免费</span>
                          </div>
                        )}
                        {enableSubsync && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">字幕对齐</span>
                            <span className="font-medium text-green-600 dark:text-green-400">免费</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : !loadingBudget ? (
                  rawVideoQueued ? (
                    <p className="text-xs text-muted-foreground">素材未处理，点数将在处理完成后按实际时长计算扣除</p>
                  ) : hardPriceQuoteV2.state === 'error' && hardPriceQuoteV2.error ? (
                    /* The implementation requirement: surface the real V2 quote error instead of the
                       generic "点数计算失败，仍可继续创建" fallback. The Confirm
                       button below is also disabled in this state so the user
                       can't push a half-priced order to the backend. */
                    <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs space-y-1">
                      <p className="font-medium text-destructive">无法计算点数，请先解决以下问题再创建：</p>
                      <p className="text-destructive">{hardPriceQuoteV2.error.message || hardPriceQuoteV2.error.code}</p>
                      <p className="text-muted-foreground">错误码：<code>{hardPriceQuoteV2.error.code}</code></p>
                    </div>
                  ) : (
                    /* Quote never ran (state === 'idle'). Hard-price flow expected
                       it but it didn't fire — usually means an earlier exception
                       in the budget pipeline. Don't pretend the order is priced. */
                    <p className="text-xs text-destructive">点数计算未完成，请回到上一步重新进入"确认创建"以重试。</p>
                  )
                ) : null)}
              </div>
            )}
            </>
          )}
          {!verifying && verifyOk === false && (
            <div className="text-center">
              <Button variant="outline" size="sm" onClick={handleStep4Enter}>重新验证</Button>
            </div>
          )}
        </div>
      )}

      {(() => {
        const inlineNextActive =
          (wizardStep === 1 && !isPlaylet && useMaterialLib) ||
          (wizardStep === 2 && !useCustomTemplate);
        const showBack = wizardStep > 1 && !inlineNextActive;
        const showForward = wizardStep === 4 || !inlineNextActive;
        if (!showBack && !showForward) return null;
        return (
          <div className="flex flex-col gap-2 pt-5 border-t mt-4 sm:flex-row sm:items-center sm:justify-end sm:gap-[30px]">
            {showBack && (
              <Button variant="outline" onClick={() => setWizardStep(s => s - 1)}>上一步</Button>
            )}
            {showForward && (wizardStep < 4 ? (
              <Button
                disabled={wizardStep === 1 ? !step1Valid : wizardStep === 2 ? !step2Valid : !step3Valid}
                onClick={() => { const n = wizardStep + 1; setWizardStep(n); if (n === 4) handleStep4Enter(); }}>
                下一步 <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            ) : (
              // Backend integration — single source of truth lives in
              // `src/lib/step4-confirm-gate.ts` so the invariant is unit-
              // tested without rendering this 2k-line component.
              <Button disabled={isStep4ConfirmDisabled({
                verifyOk,
                creating,
                verifying,
                loadingBudget,
                hardPriceQuoteV2State: hardPriceQuoteV2.state,
                isHardPrice,
                useCustomTemplate,
                hasConfirmedTemplate: !!confirmedTemplate,
                rawVideoQueued,
                hasBudgetResult: !!budgetResult,
              })} onClick={handleCreate} className="gap-1.5">
                {creating ? <><Loader2 className="h-4 w-4 animate-spin" />创建中…</> : <><Zap className="h-4 w-4" />确认创建</>}
              </Button>
            ))}
          </div>
        );
      })()}
          </>)}
          </div>
        </div>

      </div>

      {/* ── Nested dialogs (inside wizard DialogContent so Radix stacks them correctly) ── */}
      {/* File Picker Dialog */}
      <Dialog open={showFilePicker} onOpenChange={setShowFilePicker}>
        <DialogContent className="sm:max-w-lg flex flex-col max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FolderSearch className="h-4 w-4" />选择{FILE_ROLE_LABELS[filePickerRole]}
            </DialogTitle>
            <DialogDescription>{ROLE_TYPE_HINT[filePickerRole]}</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Input placeholder="搜索文件名…" value={fileSearch}
              onChange={e => setFileSearch(e.target.value)} className="h-8 text-sm flex-1" />
            <Button size="sm" variant="outline" className="h-8 gap-1.5 shrink-0"
              onClick={() => { setPickerUploadError(''); setPickerTransferError(''); setPickerTransferLink(''); setPickerUploadTab('local'); setShowPickerUpload(true); }}>
              <Upload className="h-3.5 w-3.5" />上传文件
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto border rounded-lg max-h-[300px]">
            {loadingCF ? (
              <div className="flex justify-center py-8"><Loader2 className="h-4 w-4 animate-spin" /></div>
            ) : filteredCF.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 gap-2 text-muted-foreground text-sm">
                <FolderSearch className="h-6 w-6 opacity-30" /><span>暂无文件，请先上传至云盘</span>
              </div>
            ) : (
              <div className="divide-y">
                {filteredCF.map((f: any) => (
                  <button key={f.file_id} type="button" onClick={() => selectFile(f)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/60 transition-colors">
                    <div className="h-6 w-6 rounded bg-muted flex items-center justify-center shrink-0">
                      {f.category === 1 ? <Film className="h-3.5 w-3.5 text-blue-500" />
                        : f.suffix?.toLowerCase() === '.srt' ? <FileText className="h-3.5 w-3.5 text-green-500" />
                        : f.category === 2 ? <Music className="h-3.5 w-3.5 text-purple-500" />
                        : <FileText className="h-3.5 w-3.5 text-gray-400" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{f.file_name}</div>
                      <div className="text-xs text-muted-foreground font-mono">{String(f.file_id).slice(0, 16)}…</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowFilePicker(false)}>取消</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── File Picker Upload Dialog ── */}
      <Dialog open={showPickerUpload} onOpenChange={v => { if (!v && !pickerUploading && !pickerTransferring) setShowPickerUpload(false); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Upload className="h-4 w-4" />上传文件</DialogTitle>
            <DialogDescription>选择上传方式将文件存入个人云盘</DialogDescription>
          </DialogHeader>
          <Tabs value={pickerUploadTab} onValueChange={v => setPickerUploadTab(v as any)}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="local" className="gap-1.5"><FolderOpen className="h-3.5 w-3.5" />本地上传</TabsTrigger>
              <TabsTrigger value="transfer" className="gap-1.5"><Globe className="h-3.5 w-3.5" />网盘链接上传</TabsTrigger>
            </TabsList>
            <TabsContent value="local" className="mt-4 space-y-4">
              <input ref={pickerFileInputRef} type="file" className="hidden"
                accept={ALL_SUPPORTED_ACCEPT_ATTR}
                onChange={e => { const f = e.target.files?.[0]; if (f) handlePickerLocalUpload(f); e.target.value = ''; }} />
              <div className="border-2 border-dashed border-muted-foreground/30 rounded-lg p-8 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50/50 dark:hover:bg-blue-950/20 transition-all"
                onClick={() => !pickerUploading && pickerFileInputRef.current?.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f && !pickerUploading) handlePickerLocalUpload(f); }}>
                {pickerUploading ? (
                  <div className="space-y-3">
                    <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
                    <p className="text-sm text-primary font-medium">上传中... {pickerUploadProgress ?? 0}%</p>
                    <Progress value={pickerUploadProgress ?? 0} className="h-2" />
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Upload className="h-8 w-8 text-muted-foreground/50 mx-auto" />
                    <p className="text-sm font-medium">点击或拖拽文件到此处</p>
                    <p className="text-xs text-muted-foreground">支持的格式：{ALL_SUPPORTED_ACCEPT_ATTR}</p>
                  </div>
                )}
              </div>
              {pickerUploadError && <p className="text-xs text-red-500 flex items-center gap-1"><AlertCircle className="h-3 w-3" />{pickerUploadError}</p>}
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowPickerUpload(false)} disabled={pickerUploading}>取消</Button>
                <Button onClick={() => pickerFileInputRef.current?.click()} disabled={pickerUploading} className="gap-1">
                  {pickerUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderOpen className="h-3.5 w-3.5" />}选择文件
                </Button>
              </DialogFooter>
            </TabsContent>
            <TabsContent value="transfer" className="mt-4 space-y-4">
              <div className="space-y-2">
                <Label>链接地址</Label>
                <Textarea placeholder="支持可下载的 URL 链接，也支持百度网盘分享链接&#10;例：https://example.com/video.mp4"
                  value={pickerTransferLink} onChange={e => setPickerTransferLink(e.target.value)}
                  className="min-h-[80px] resize-none text-sm" disabled={pickerTransferring} />
                <p className="text-xs text-muted-foreground flex items-center gap-1"><Link2 className="h-3 w-3" />支持直接下载链接（HTTP/HTTPS）或百度网盘分享文本</p>
              </div>
              {pickerTransferError && <p className="text-xs text-red-500 flex items-center gap-1"><AlertCircle className="h-3 w-3" />{pickerTransferError}</p>}
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowPickerUpload(false)} disabled={pickerTransferring}>取消</Button>
                <Button onClick={handlePickerTransfer} disabled={!pickerTransferLink.trim() || pickerTransferring} className="gap-1">
                  {pickerTransferring ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Globe className="h-3.5 w-3.5" />}开始转存
                </Button>
              </DialogFooter>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Movie Search Dialog */}
      <Dialog open={showMovieSearch} onOpenChange={v => { setShowMovieSearch(v); if (!v) { setMovieSearchResults([]); setSelectedMovieIdx(null); } }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Search className="h-4 w-4" />搜索电影信息
            </DialogTitle>
            <DialogDescription>输入电影/剧名后点击搜索，搜索通常需要 40-60 秒，请耐心等待。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex gap-2">
              <Input placeholder="输入电影/剧名..." value={movieSearchQuery}
                onChange={e => setMovieSearchQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !loadingMovieSearch && handleMovieSearch()}
                className="flex-1" />
              <Button onClick={handleMovieSearch} disabled={!movieSearchQuery.trim() || loadingMovieSearch} className="gap-1.5 shrink-0">
                {loadingMovieSearch ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                搜索
              </Button>
            </div>

            {loadingMovieSearch && (
              <div className="flex flex-col items-center justify-center py-8 gap-3 text-muted-foreground">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm">搜索电影需要约 40-60 秒，请耐心等待搜索完成…</p>
              </div>
            )}

            {!loadingMovieSearch && movieSearchResults.length > 0 && (
              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                {movieSearchResults.map((movie: any, idx: number) => (
                  <button key={idx} type="button" onClick={() => setSelectedMovieIdx(idx)}
                    className={`w-full text-left rounded-lg border p-3 space-y-1 transition-colors ${selectedMovieIdx === idx ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50'}`}>
                    <div className="flex items-center gap-2">
                      <div className={`w-3.5 h-3.5 rounded-full border-2 shrink-0 ${selectedMovieIdx === idx ? 'border-primary bg-primary' : 'border-muted-foreground/40'}`} />
                      <p className="text-sm font-medium leading-snug">{movie.local_title || movie.title || '—'}</p>
                    </div>
                    {movie.title && movie.local_title && <p className="text-xs text-muted-foreground pl-5">英文名：{movie.title}</p>}
                    {movie.year && <p className="text-xs text-muted-foreground pl-5">年份：{movie.year}{movie.director ? `  导演：${movie.director}` : ''}</p>}
                    {movie.summary && <p className="text-xs text-muted-foreground pl-5 line-clamp-2">简介：{movie.summary}</p>}
                    {movie.stars?.length > 0 && <p className="text-xs text-muted-foreground pl-5">演员：{(movie.stars as string[]).slice(0, 4).join('、')}</p>}
                  </button>
                ))}
              </div>
            )}

            {!loadingMovieSearch && movieSearchResults.length === 0 && movieSearchQuery && (
              <p className="text-sm text-muted-foreground text-center py-4">暂无搜索结果，请尝试更换关键词</p>
            )}

            <div className="rounded-lg bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800 px-3 py-2 text-xs text-yellow-700 dark:text-yellow-300">
              请仔细查看相关信息，并正确选择您想要解说的电影。如搜索不到，请更换电影名称后重新搜索，否则将无法保证文案生成和解说质量，请知悉！
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowMovieSearch(false)}>取消</Button>
            <Button disabled={selectedMovieIdx === null} onClick={handleConfirmMovie}>确认选择</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Template List Dialog removed — template selection is now inline in Step 2 */}

      {/* ── Template Detail Dialog ─────────────────────────────────── */}
      <Dialog open={showTemplateDetail} onOpenChange={setShowTemplateDetail}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">
          {detailTemplate && (<>
            {/* Scrollable area: header + image */}
            <div className="flex-1 overflow-y-auto min-h-0 px-6 pt-6 space-y-4">
              <DialogHeader>
                <DialogTitle className="text-base leading-snug pr-6">{detailTemplate.name}</DialogTitle>
                <DialogDescription className="flex items-center gap-1.5 flex-wrap">
                  <span className="bg-primary/10 text-primary text-xs px-2 py-0.5 rounded">{detailTemplate.platform.name}</span>
                  {detailTemplate.categories.map(c => (
                    <span key={c.id} className="bg-muted text-muted-foreground text-xs px-2 py-0.5 rounded">{c.name}</span>
                  ))}
                </DialogDescription>
              </DialogHeader>
              {/* Hero image */}
              <div className="relative rounded-xl overflow-hidden bg-muted -mx-1">
                <img src={detailTemplate.slug_img || detailTemplate.img} alt={detailTemplate.name}
                  className="w-full object-contain"
                  onError={e => { (e.target as HTMLImageElement).src = detailTemplate.img; }} />
              </div>
            </div>
            {/* Fixed bottom area */}
            <div className="shrink-0 border-t px-6 py-4 space-y-3 bg-background">
              {/* Meta row */}
              <div className="grid grid-cols-3 gap-3 text-center text-sm">
                <div className="rounded-lg border py-2">
                  <p className="font-medium">{detailTemplate.language}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">语言</p>
                </div>
                <div className="rounded-lg border py-2">
                  <p className="font-medium">{detailTemplate.time}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">时长</p>
                </div>
                <div className="rounded-lg border py-2 bg-orange-50 dark:bg-orange-950/20 border-orange-200 dark:border-orange-800">
                  <p className="font-semibold text-orange-600 dark:text-orange-400">¥{detailTemplate.profit}</p>
                  <p className="text-xs text-orange-500 mt-0.5">案例收益</p>
                </div>
              </div>
              {/* Stats */}
              <div className="grid grid-cols-4 gap-2 text-center">
                {[
                  { icon: <ThumbsUp className="h-4 w-4" />, label: '点赞', val: detailTemplate.like },
                  { icon: <MessageCircle className="h-4 w-4" />, label: '评论', val: detailTemplate.messages },
                  { icon: <Bookmark className="h-4 w-4" />, label: '收藏', val: detailTemplate.stars },
                  { icon: <Share2 className="h-4 w-4" />, label: '转发', val: detailTemplate.share },
                ].map(({ icon, label, val }) => (
                  <div key={label} className="rounded-lg border py-2.5">
                    <div className="flex justify-center text-muted-foreground mb-1">{icon}</div>
                    <p className="font-semibold text-sm">{val >= 10000 ? `${(val/10000).toFixed(1)}w` : val}</p>
                    <p className="text-xs text-muted-foreground">{label}</p>
                  </div>
                ))}
              </div>
              {/* Collection time */}
              <div className="text-xs text-muted-foreground">
                <span>收录时间：{detailTemplate.collection_time}</span>
              </div>
              {/* Hard price tiers */}
              {loadingTemplatePrices ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>加载价格中…</span>
                </div>
              ) : (() => {
                const all = templatePricesCache[detailTemplate.id];
                if (!all?.length) return null;
                const relevant = relevantComboKeysForWritingType(writingType);
                const filtered = all.filter(p => relevant.includes(p.combo_key));
                if (!filtered.length) return null;
                return (
                  <div className="rounded-lg border p-3 space-y-2 bg-muted/30">
                    <p className="text-xs font-medium text-muted-foreground">价格档位</p>
                    <div className="space-y-1.5">
                      {filtered.map(p => (
                        <div key={p.combo_key} className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">{COMBO_KEY_LABELS[p.combo_key] ?? p.combo_key}</span>
                          <span className="font-semibold tabular-nums text-amber-600 dark:text-amber-400">{formatHardPrice(p.hard_price)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
              <div className="flex gap-2 pt-1">
                {detailTemplate.link && (
                  <Button variant="outline" asChild>
                    <a href={detailTemplate.link} target="_blank" rel="noreferrer" className="gap-1.5">
                      <ExternalLink className="h-3.5 w-3.5" />查看原视频
                    </a>
                  </Button>
                )}
                <Button className="flex-1" onClick={() => {
                  setConfirmedTemplate(detailTemplate);
                  setExistingModelId(detailTemplate.learning_model_id);
                  setUseExistingModel(true);
                  setShowTemplateDetail(false);
                  setShowTemplateDialog(false);
                  showToast('success', `已选择模板：${detailTemplate.name}`);
                  if (wizardStep === 2) setWizardStep(3);
                }}>
                  确认使用该模板
                </Button>
              </div>
            </div>
          </>)}
        </DialogContent>
      </Dialog>

      {/* ── Movie Library List Dialog ─────────────────────────────── */}
      <Dialog open={showMovieLib} onOpenChange={v => { setShowMovieLib(v); if (!v) setMovieLibDetail(null); }}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-5 pt-5 pb-3 border-b shrink-0">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Film className="h-4 w-4 text-primary" />选择标准素材库
            </DialogTitle>
            <DialogDescription className="text-xs">选中后将同时填充素材视频和素材字幕 SRT</DialogDescription>
          </DialogHeader>
          {/* List */}
          <div className="flex-1 overflow-y-auto min-h-0 px-5 py-3">
            {loadingMovieLib ? (
              <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
            ) : movieLibList.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
                <Film className="h-8 w-8 opacity-30" /><p className="text-sm">暂无素材</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {movieLibList.map(m => (
                  <button key={m.id} type="button"
                    onClick={() => setMovieLibDetail(m)}
                    className="text-left flex gap-3 rounded-xl border p-3 hover:border-primary/50 hover:shadow-sm transition-all group">
                    <div className="w-16 h-20 rounded-lg overflow-hidden bg-muted shrink-0">
                      <img src={m.cover} alt={m.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                        referrerPolicy="no-referrer"
                        onError={e => { (e.target as HTMLImageElement).style.display='none'; }} />
                    </div>
                    <div className="flex-1 min-w-0 space-y-1">
                      <p className="text-sm font-medium leading-snug">{m.name}</p>
                      <div className="flex flex-wrap gap-1">
                        <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">{m.type}</span>
                        {m.year && <span className="text-xs text-muted-foreground">{m.year}</span>}
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">{m.story_info}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
            {/* Pagination */}
            {movieLibTotal > MOVIE_LIB_PAGE_SIZE && !loadingMovieLib && (
              <div className="flex items-center justify-center gap-2 mt-4">
                <Button size="sm" variant="outline" disabled={movieLibPage <= 1}
                  onClick={() => fetchMovieLib(movieLibPage - 1)} className="h-7 text-xs">上一页</Button>
                <span className="text-xs text-muted-foreground">第 {movieLibPage} 页 / 共 {Math.ceil(movieLibTotal / MOVIE_LIB_PAGE_SIZE)} 页</span>
                <Button size="sm" variant="outline" disabled={movieLibPage >= Math.ceil(movieLibTotal / MOVIE_LIB_PAGE_SIZE)}
                  onClick={() => fetchMovieLib(movieLibPage + 1)} className="h-7 text-xs">下一页</Button>
              </div>
            )}
          </div>
          <div className="px-5 py-3 border-t shrink-0 flex justify-end">
            <Button variant="outline" onClick={() => setShowMovieLib(false)}>关闭</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Movie Library Detail Dialog ───────────────────────────── */}
      <Dialog open={!!movieLibDetail} onOpenChange={v => { if (!v) setMovieLibDetail(null); }}>
        <DialogContent className="sm:max-w-md max-h-[90vh] flex flex-col p-0 gap-0">
          {movieLibDetail && (<>
            <DialogHeader className="px-6 pt-6 pb-3 shrink-0">
              <DialogTitle className="text-base pr-6">{movieLibDetail.name}</DialogTitle>
              <DialogDescription className="flex items-center gap-1.5 flex-wrap">
                <span className="bg-primary/10 text-primary text-xs px-2 py-0.5 rounded">{movieLibDetail.type}</span>
                {movieLibDetail.year && <span className="text-xs text-muted-foreground">{movieLibDetail.year}</span>}
                {movieLibDetail.title && <span className="text-xs text-muted-foreground italic">{movieLibDetail.title}</span>}
              </DialogDescription>
            </DialogHeader>
            <div className="flex-1 overflow-y-auto px-6 space-y-4 pb-4">
              {/* Cover */}
              <div className="rounded-xl overflow-hidden bg-muted -mx-1">
                <img src={movieLibDetail.cover} alt={movieLibDetail.name}
                  className="w-full object-contain" referrerPolicy="no-referrer"
                  onError={e => { (e.target as HTMLImageElement).style.display='none'; }} />
              </div>
              {/* Cast */}
              {movieLibDetail.character_name && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">主要演员</p>
                  <p className="text-xs text-foreground leading-relaxed">
                    {(() => { try { const arr = JSON.parse(movieLibDetail.character_name); return Array.isArray(arr) ? arr.join('、') : movieLibDetail.character_name; } catch { return movieLibDetail.character_name; } })()}
                  </p>
                </div>
              )}
              {/* Story */}
              {movieLibDetail.story_info && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">剧情简介</p>
                  <p className="text-xs text-foreground leading-relaxed">{movieLibDetail.story_info}</p>
                </div>
              )}
            </div>
            <DialogFooter className="gap-2 px-6 py-4 border-t shrink-0">
              <Button variant="outline" onClick={() => setMovieLibDetail(null)}>返回列表</Button>
              <Button className="flex-1" onClick={() => {
                setNativeVideo({ id: movieLibDetail.video_file_id, name: `${movieLibDetail.name} - 素材视频` });
                setNativeSrt({ id: movieLibDetail.srt_file_id, name: `${movieLibDetail.name} - 素材字幕` });
                // 自动填充影片名称
                setPlayletName(movieLibDetail.name);
                // 从素材库字段拼接 confirmedMovieJson
                const parseStars = (cn: string): string[] => {
                  try { const a = JSON.parse(cn); if (Array.isArray(a)) return a.map(String); } catch {}
                  const m2 = cn.match(/^\[([\s\S]+)\]$/);
                  if (m2) return m2[1].split(',').map(s => s.trim()).filter(Boolean);
                  return cn ? [cn] : [];
                };
                const libMovieJson = JSON.stringify({
                  title: movieLibDetail.title || movieLibDetail.name,
                  local_title: movieLibDetail.name,
                  original_title: movieLibDetail.name,
                  year: movieLibDetail.year || '',
                  director: '',
                  stars: parseStars(movieLibDetail.character_name),
                  genre: movieLibDetail.type || '',
                  summary: movieLibDetail.story_info || '',
                  poster_url: movieLibDetail.cover || '',
                  is_partial: false,
                });
                setConfirmedMovieJson(libMovieJson);
                setMovieFromLib(true);
                setConfirmedMovieLib(movieLibDetail);
                setMovieLibDetail(null);
                setShowMovieLib(false);
                showToast('success', `已选择素材：${movieLibDetail.name}`);
                if (wizardStep === 1 && !!selectedType && (!isFirstPerson || !!targetCharacterName.trim())) {
                  setWizardStep(2);
                }
              }}>
                <CheckCircle2 className="h-4 w-4 mr-1" />确认使用此素材
              </Button>
            </DialogFooter>
          </>)}
        </DialogContent>
      </Dialog>

      {/* App Key Dialog */}
      <Dialog open={showKeyDialog} onOpenChange={setShowKeyDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings className="h-4 w-4" />配置 App Key
            </DialogTitle>
            <DialogDescription>
              请输入您的 NarratorAI App Key，安全存储在本地浏览器中，不会上传至任何服务器。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Label htmlFor="appkey-input">App Key</Label>
            <div className="relative">
              <Input id="appkey-input" type={showKey ? 'text' : 'password'} placeholder="请输入您的 App Key"
                value={keyInput} onChange={e => setKeyInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSaveKey()} className="pr-10" />
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
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium shadow-lg transition-all ${
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
