'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAppKey } from '@/hooks/use-app-key';

const RECENT_KEY = 'admin_pricing_catalog_recent';
const MAX_RECENT = 6;

function loadRecent(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function saveRecent(templateId: string) {
  if (typeof window === 'undefined') return;
  const recent = loadRecent().filter((x) => x !== templateId);
  recent.unshift(templateId);
  localStorage.setItem(
    RECENT_KEY,
    JSON.stringify(recent.slice(0, MAX_RECENT))
  );
}

export default function PricingCatalogHub() {
  const router = useRouter();
  const { appKey, loaded } = useAppKey();
  const [templateId, setTemplateId] = useState('');
  // Read once at mount time via lazy initializer so we don't trip the
  // react-hooks/set-state-in-effect rule. `loadRecent()` already guards
  // against SSR (returns [] when window is undefined).
  const [recent, setRecent] = useState<string[]>(() => loadRecent());

  const open = useCallback(
    (id: string) => {
      const trimmed = id.trim();
      if (!trimmed) return;
      saveRecent(trimmed);
      setRecent(loadRecent());
      router.push(`/admin/pricing-catalog/${encodeURIComponent(trimmed)}`);
    },
    [router]
  );

  if (loaded && !appKey) {
    return (
      <div className="container mx-auto max-w-2xl py-12">
        <Card>
          <CardHeader>
            <CardTitle>需要登录</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              请先在主站登录配置 App Key 后再访问 admin 页面。
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-3xl py-10 space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">定价目录 — 模板商品价配置</h1>
        <p className="text-sm text-muted-foreground">
          输入模板 ID 打开配置页。价格档位会原子保存，并校验
          Pro ≥ Flash 和 Pro = Flash + upgrade delta invariant。
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>打开模板</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="template-id">模板 ID</Label>
            <div className="flex gap-2">
              <Input
                id="template-id"
                placeholder="T-001"
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && open(templateId)}
              />
              <Button onClick={() => open(templateId)} disabled={!templateId.trim()}>
                打开
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              请输入后端已登记的模板 ID。本页面暂不提供下拉列表。
            </p>
          </div>
        </CardContent>
      </Card>

      {recent.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>最近打开</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-wrap gap-2">
              {recent.map((id) => (
                <li key={id}>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => open(id)}
                    className="font-mono"
                  >
                    {id}
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
