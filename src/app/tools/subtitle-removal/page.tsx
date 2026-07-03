'use client';

import React, { useState, useCallback } from 'react';
import { AppNavLink } from '@/components/app-nav-link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  ArrowLeft, Eraser, Search, FolderSearch, Loader2, CheckCircle2,
  AlertCircle, Plus, X, Settings,
} from 'lucide-react';
import { useAppKey } from '@/hooks/use-app-key';
import { SUBTITLE_TOOLS_ENABLED, SubtitleToolsUnavailable } from '@/components/subtitle-tools-unavailable';

type CloudFileOption = {
  file_id: string;
  file_name: string;
};

type ToolResponse = {
  success?: boolean;
  data?: Record<string, unknown>;
  error?: string;
};

const MODES = [
  {
    value: 'standard',
    label: '标准版',
    desc: '速度快，适合大多数场景下的字幕擦除',
    badge: '推荐',
  },
  {
    value: 'advanced',
    label: '高级版',
    desc: '效果更好，耗时更长，适合复杂背景',
    badge: '高清',
  },
] as const;

export default function SubtitleRemovalPage() {
  const { appKey } = useAppKey();

  const [fileIds, setFileIds] = useState<string[]>(['']);
  const [mode, setMode] = useState<'standard' | 'advanced'>('standard');

  const [showPicker, setShowPicker] = useState(false);
  const [pickerIndex, setPickerIndex] = useState(0);
  const [cloudFiles, setCloudFiles] = useState<CloudFileOption[]>([]);
  const [loadingCF, setLoadingCF] = useState(false);
  const [fileSearch, setFileSearch] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState('');

  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const showToast = (type: 'success' | 'error', msg: string) => {
    setToast({ type, msg }); setTimeout(() => setToast(null), 3500);
  };

  const apiHeaders = useCallback(
    () => ({ 'Content-Type': 'application/json', 'x-app-key': appKey }),
    [appKey]
  );

  const fetchCloudFiles = useCallback(async () => {
    if (!appKey) return;
    setLoadingCF(true);
    try {
      const r = await fetch('/api/cloud-drive/files?page=1&page_size=100', { headers: apiHeaders() });
      const j = await r.json();
      if (j.success) setCloudFiles(j.data?.items || []);
    } catch {} finally { setLoadingCF(false); }
  }, [appKey, apiHeaders]);

  const openPicker = (idx: number) => {
    setPickerIndex(idx); setFileSearch(''); fetchCloudFiles(); setShowPicker(true);
  };

  const selectCloudFile = (f: CloudFileOption) => {
    const next = [...fileIds]; next[pickerIndex] = f.file_id;
    setFileIds(next); setShowPicker(false);
  };

  const addFileId = () => setFileIds(prev => [...prev, '']);
  const removeFileId = (idx: number) => setFileIds(prev => prev.filter((_, i) => i !== idx));
  const updateFileId = (idx: number, val: string) => {
    const next = [...fileIds]; next[idx] = val; setFileIds(next);
  };

  const filteredCF = cloudFiles.filter(f =>
    !fileSearch || f.file_name.toLowerCase().includes(fileSearch.toLowerCase())
  );

  const handleSubmit = async () => {
    const validIds = fileIds.filter(id => id.trim());
    if (!validIds.length) { showToast('error', '请至少输入一个文件 ID'); return; }
    if (!appKey) { showToast('error', '请先配置 App Key'); return; }
    setSubmitting(true); setError(''); setResult(null);
    try {
      const r = await fetch('/api/tools/subtitle-removal', {
        method: 'POST', headers: apiHeaders(),
        body: JSON.stringify({ file_ids: validIds, mode }),
      });
      const j = await r.json() as ToolResponse;
      if (j.success) { setResult(j.data ?? {}); showToast('success', '字幕擦除任务已创建！'); }
      else setError(j.error || '任务创建失败');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '请求失败');
    } finally { setSubmitting(false); }
  };

  if (!SUBTITLE_TOOLS_ENABLED) {
    return (
      <SubtitleToolsUnavailable
        title="字幕擦除"
        description="字幕擦除工具正在接入 Web 任务记录和扣费链路，当前不支持从独立工具页提交任务。"
      />
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium transition-all ${
          toast.type === 'success'
            ? 'bg-green-50 border border-green-200 text-green-800'
            : 'bg-red-50 border border-red-200 text-red-800'
        }`}>
          {toast.type === 'success' ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <header className="border-b bg-card/80 backdrop-blur-sm sticky top-0 z-40">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between h-14">
          <div className="flex items-center gap-3">
            <AppNavLink href="/">
              <Button variant="ghost" size="sm" className="gap-1"><ArrowLeft className="h-4 w-4" />返回首页</Button>
            </AppNavLink>
            <h1 className="text-lg font-semibold flex items-center gap-2">
              <Eraser className="h-5 w-5 text-primary" />字幕擦除
            </h1>
          </div>
          {!appKey && (
            <AppNavLink href="/">
              <Button variant="outline" size="sm" className="gap-1">
                <Settings className="h-3.5 w-3.5" />配置 App Key
              </Button>
            </AppNavLink>
          )}
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-2xl space-y-6">
        {/* Description */}
        <div>
          <h2 className="text-2xl font-bold mb-1">字幕擦除</h2>
          <p className="text-muted-foreground text-sm">从视频画面中擦除内嵌字幕，支持标准版和高级版两种处理模式。</p>
        </div>

        {/* Form */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">创建擦除任务</CardTitle>
            <CardDescription className="text-xs">所有带 * 的字段为必填项</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* File IDs */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">视频文件 <span className="text-red-500">*</span></Label>
              <p className="text-xs text-muted-foreground">支持批量提交多个视频文件</p>
              {fileIds.map((id, idx) => (
                <div key={idx} className="flex gap-2">
                  <Input
                    placeholder="文件 ID（如 8c45a4d2b8c42fc0003c00403dffa3...）"
                    value={id}
                    onChange={e => updateFileId(idx, e.target.value)}
                    className="flex-1 text-sm font-mono h-9"
                  />
                  <Button type="button" size="sm" variant="outline" className="h-9 gap-1 shrink-0"
                    onClick={() => openPicker(idx)}>
                    <FolderSearch className="h-3.5 w-3.5" />云盘
                  </Button>
                  {fileIds.length > 1 && (
                    <Button type="button" size="sm" variant="ghost" className="h-9 w-9 p-0 text-muted-foreground hover:text-red-500"
                      onClick={() => removeFileId(idx)}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              ))}
              <Button type="button" size="sm" variant="outline" className="gap-1 h-8 text-xs"
                onClick={addFileId}>
                <Plus className="h-3.5 w-3.5" />添加文件
              </Button>
            </div>

            {/* Mode */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">擦除模式 <span className="text-red-500">*</span></Label>
              <div className="grid grid-cols-2 gap-3">
                {MODES.map(m => (
                  <button key={m.value} type="button" onClick={() => setMode(m.value)}
                    className={`rounded-xl border p-4 text-left transition-all relative ${mode === m.value ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/40'}`}>
                    <div className="flex items-center justify-between mb-1">
                      <p className={`text-sm font-semibold ${mode === m.value ? 'text-primary' : ''}`}>{m.label}</p>
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${m.badge === '推荐' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                        {m.badge}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">{m.desc}</p>
                    {mode === m.value && (
                      <CheckCircle2 className="h-4 w-4 text-primary absolute top-2 right-2" />
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-start gap-2 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2.5">
                <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
              </div>
            )}

            {/* Info */}
            <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-3 py-2.5 text-xs text-amber-700 dark:text-amber-300">
              擦除任务耗时较长，提交后请稍后在任务记录中查询结果。高级版处理时间通常是标准版的 2~3 倍。
            </div>

            {/* Submit */}
            <Button className="w-full gap-2" disabled={submitting || !appKey} onClick={handleSubmit}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eraser className="h-4 w-4" />}
              {submitting ? '创建中…' : '创建字幕擦除任务'}
            </Button>
            {!appKey && (
              <p className="text-xs text-center text-muted-foreground">请先在首页配置 App Key</p>
            )}
          </CardContent>
        </Card>

        {/* Result */}
        {result && (
          <Card className="border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-950/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2 text-green-700 dark:text-green-400">
                <CheckCircle2 className="h-5 w-5" />任务已提交
              </CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="text-xs bg-white dark:bg-black/20 rounded-lg p-3 overflow-x-auto">
                {JSON.stringify(result, null, 2)}
              </pre>
            </CardContent>
          </Card>
        )}
      </main>

      {/* Cloud File Picker Dialog */}
      <Dialog open={showPicker} onOpenChange={setShowPicker}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FolderSearch className="h-4 w-4" />从云盘选择文件
            </DialogTitle>
            <DialogDescription className="text-xs">选择一个视频文件</DialogDescription>
          </DialogHeader>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input placeholder="搜索文件名…" value={fileSearch}
              onChange={e => setFileSearch(e.target.value)} className="pl-8 h-8 text-sm" />
          </div>
          {loadingCF ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
          ) : (
            <div className="space-y-1 max-h-72 overflow-y-auto">
              {filteredCF.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">暂无文件</p>
              ) : filteredCF.map(f => (
                <button key={f.file_id} type="button" onClick={() => selectCloudFile(f)}
                  className="w-full text-left px-3 py-2 rounded-lg hover:bg-muted text-sm flex items-center gap-2 transition-colors">
                  <Eraser className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="truncate flex-1">{f.file_name}</span>
                  <span className="text-xs text-muted-foreground font-mono shrink-0">{f.file_id?.slice(0,8)}…</span>
                </button>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPicker(false)}>取消</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
