'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { use } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  AlertCircle,
  CheckCircle2,
  HelpCircle,
  History,
  Loader2,
  Save,
} from 'lucide-react';
import { useAppKey } from '@/hooks/use-app-key';
import {
  checkInvariants,
  tierCompleteness,
  toServerTier,
  type TierDraft,
} from '@/lib/pricing-catalog-tier-payload';

interface HistoryEntry {
  effective_version: number;
  manual_price: number;
  pro_surcharge_display: number | null;
  system_reference_price: number;
  raw_rate: string;
  final_rate: string;
  rounding_rule_version: string;
  manual_override_warning: boolean;
  enabled: boolean;
  created_at: string;
  updated_by: string;
}

// Five canonical tiers, matching the backend catalog contract.
const TIER_TEMPLATE: TierDraft[] = [
  {
    tier_code: 'original_narration_flash',
    product_line: 'original',
    mode: 'narration',
    quality: 'flash',
    flash_pro_axis: 'required',
    manual_price: '',
    pro_surcharge_display: '',
    system_reference_price: '',
    raw_rate: '',
    final_rate: '',
    rounding_rule_version: 'v2.0-round-half-up',
  },
  {
    tier_code: 'original_narration_pro',
    product_line: 'original',
    mode: 'narration',
    quality: 'pro',
    flash_pro_axis: 'required',
    manual_price: '',
    pro_surcharge_display: '',
    system_reference_price: '',
    raw_rate: '',
    final_rate: '',
    rounding_rule_version: 'v2.0-round-half-up',
  },
  {
    tier_code: 'original_mix_flash',
    product_line: 'original',
    mode: 'mix',
    quality: 'flash',
    flash_pro_axis: 'required',
    manual_price: '',
    pro_surcharge_display: '',
    system_reference_price: '',
    raw_rate: '',
    final_rate: '',
    rounding_rule_version: 'v2.0-round-half-up',
  },
  {
    tier_code: 'original_mix_pro',
    product_line: 'original',
    mode: 'mix',
    quality: 'pro',
    flash_pro_axis: 'required',
    manual_price: '',
    pro_surcharge_display: '',
    system_reference_price: '',
    raw_rate: '',
    final_rate: '',
    rounding_rule_version: 'v2.0-round-half-up',
  },
  {
    tier_code: 'derivative',
    product_line: 'derivative',
    mode: null,
    quality: null,
    flash_pro_axis: 'optional',
    manual_price: '',
    pro_surcharge_display: '',
    system_reference_price: '',
    raw_rate: '',
    final_rate: '',
    rounding_rule_version: 'v2.0-round-half-up',
  },
];

const TIER_LABELS: Record<string, string> = {
  original_narration_flash: '原创纯解说 · Flash',
  original_narration_pro: '原创纯解说 · Pro',
  original_mix_flash: '原声混剪 / 短剧 · Flash',
  original_mix_pro: '原声混剪 / 短剧 · Pro',
  derivative: '二创',
};

function fromServerTier(raw: Record<string, unknown>): TierDraft {
  return {
    tier_code: String(raw.tier_code),
    product_line: String(raw.product_line),
    mode: (raw.mode as string | null) ?? null,
    quality: (raw.quality as string | null) ?? null,
    flash_pro_axis: raw.flash_pro_axis as 'required' | 'optional',
    manual_price: raw.manual_price == null ? '' : String(raw.manual_price),
    pro_surcharge_display:
      raw.pro_surcharge_display == null
        ? ''
        : String(raw.pro_surcharge_display),
    system_reference_price:
      raw.system_reference_price == null
        ? ''
        : String(raw.system_reference_price),
    raw_rate: raw.raw_rate == null ? '' : String(raw.raw_rate),
    final_rate: raw.final_rate == null ? '' : String(raw.final_rate),
    rounding_rule_version:
      (raw.rounding_rule_version as string) || 'v2.0-round-half-up',
    effective_version: raw.effective_version as number | undefined,
    manual_override_warning: raw.manual_override_warning as boolean | undefined,
  };
}


export default function PricingCatalogEditor({
  params,
}: {
  params: Promise<{ templateId: string }>;
}) {
  const { templateId } = use(params);
  const { appKey, loaded } = useAppKey();
  const [tiers, setTiers] = useState<TierDraft[]>(TIER_TEMPLATE.map((t) => ({ ...t })));
  // regression coverage: template identity surfaced from backend so operators don't
  // have to leave the page to figure out which template `46` is.
  // All three may be null when the seeder hasn't backfilled this
  // template yet (renders as `-`).
  const [identity, setIdentity] = useState<{
    code: string | null;
    name: string | null;
    learning_model_id: string | null;
  }>({ code: null, name: null, learning_model_id: null });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveErrorDetails, setSaveErrorDetails] = useState<
    Record<string, unknown> | null
  >(null);
  const [saveOk, setSaveOk] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<Record<string, HistoryEntry[]>>({});
  const [historyLoading, setHistoryLoading] = useState(false);

  const apiHeaders = useCallback(
    () => ({ 'Content-Type': 'application/json', 'x-app-key': appKey }),
    [appKey]
  );

  const loadTiers = useCallback(async () => {
    if (!appKey) return;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(
        `/api/admin/pricing-catalog/${encodeURIComponent(templateId)}/tiers`,
        { headers: apiHeaders() }
      );
      const j = await res.json();
      if (j.success) {
        const serverTiers = (j.data?.tiers || []) as Record<string, unknown>[];
        // Merge server values into the canonical 5-tier template; missing
        // ones stay blank so the operator can fill them.
        const byCode = new Map(serverTiers.map((t) => [t.tier_code as string, t]));
        setTiers(
          TIER_TEMPLATE.map((t) => {
            const server = byCode.get(t.tier_code);
            return server ? fromServerTier(server) : { ...t };
          })
        );
        setIdentity({
          code: (j.data?.code as string | null | undefined) ?? null,
          name: (j.data?.name as string | null | undefined) ?? null,
          learning_model_id:
            (j.data?.learning_model_id as string | null | undefined) ?? null,
        });
      } else if (j.code === 'CATALOG_TIER_MISSING') {
        // Empty catalog — start blank with the template. Identity
        // also stays null; backend's 404 envelope doesn't carry it.
        setTiers(TIER_TEMPLATE.map((t) => ({ ...t })));
        setIdentity({ code: null, name: null, learning_model_id: null });
      } else {
        setLoadError(j.error || '加载失败');
      }
    } catch (e) {
      setLoadError((e as Error).message || '加载请求失败');
    } finally {
      setLoading(false);
    }
  }, [appKey, templateId, apiHeaders]);

  useEffect(() => {
    if (loaded && appKey) loadTiers();
  }, [loaded, appKey, loadTiers]);

  const updateTier = useCallback(
    (tierCode: string, field: keyof TierDraft, value: string) => {
      setTiers((prev) =>
        prev.map((t) => (t.tier_code === tierCode ? { ...t, [field]: value } : t))
      );
      setSaveOk(false);
      setSaveError(null);
    },
    []
  );

  const invariantErrors = useMemo(
    () => checkInvariants(tiers, TIER_LABELS),
    [tiers],
  );

  // Per-tier completeness for the pre-save guard. Partial tiers are
  // tiers the operator started filling but didn't finish — they would
  // be silently dropped by toServerTier without explicit awareness
  // without explicit awareness.
  const completeness = useMemo(
    () => tiers.map((t) => ({ tier: t, status: tierCompleteness(t, tiers) })),
    [tiers]
  );
  const completeTierCodes = completeness
    .filter((c) => c.status === 'complete')
    .map((c) => c.tier.tier_code);
  const partialTierCodes = completeness
    .filter((c) => c.status === 'partial')
    .map((c) => c.tier.tier_code);

  const save = useCallback(async () => {
    if (invariantErrors.length > 0) return;
    const payload = tiers
      .map((t) => toServerTier(t, tiers))
      .filter(Boolean) as Record<string, unknown>[];
    if (payload.length === 0) {
      setSaveError('请至少填写一档商品价。');
      return;
    }
    setSaving(true);
    setSaveError(null);
    setSaveErrorDetails(null);
    setSaveOk(false);
    try {
      const res = await fetch(
        `/api/admin/pricing-catalog/${encodeURIComponent(templateId)}/tiers`,
        {
          method: 'PUT',
          headers: apiHeaders(),
          body: JSON.stringify({ tiers: payload }),
        }
      );
      const j = await res.json();
      if (j.success) {
        setSaveOk(true);
        // Refresh from server to pick up new effective_version + warning.
        loadTiers();
      } else {
        setSaveError(j.error || '保存失败');
        setSaveErrorDetails(j.details ?? null);
      }
    } catch (e) {
      setSaveError((e as Error).message || '保存请求失败');
    } finally {
      setSaving(false);
    }
  }, [tiers, invariantErrors, templateId, apiHeaders, loadTiers]);

  const loadHistory = useCallback(async () => {
    if (!appKey) return;
    setHistoryLoading(true);
    try {
      const res = await fetch(
        `/api/admin/pricing-catalog/${encodeURIComponent(templateId)}/history`,
        { headers: apiHeaders() }
      );
      const j = await res.json();
      if (j.success) {
        setHistory(j.data?.tiers ?? {});
      } else {
        setHistory({});
      }
    } catch {
      setHistory({});
    } finally {
      setHistoryLoading(false);
    }
  }, [appKey, templateId, apiHeaders]);

  if (loaded && !appKey) {
    return (
      <div className="container mx-auto max-w-2xl py-12">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>需要登录</AlertTitle>
          <AlertDescription>
            请先在主站登录配置 App Key 后再访问 admin 页面。
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="container mx-auto max-w-5xl py-8 space-y-6">
        <header className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link href="/admin/pricing-catalog" className="hover:underline">
              ← 返回模板选择
            </Link>
          </div>
          <h1 className="text-2xl font-semibold">
            定价目录 · 模板{' '}
            <span className="font-mono">{templateId}</span>
          </h1>
          {/* regression coverage: surface upstream identity so operators don't have
              to leave the page to figure out what "46" is. Each field
              degrades to `-` when the seeder hasn't populated it. */}
          <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <div className="flex items-baseline gap-2">
              <dt className="text-muted-foreground">模板名称</dt>
              <dd className="font-medium">{identity.name || '-'}</dd>
            </div>
            <div className="flex items-baseline gap-2">
              <dt className="text-muted-foreground">code</dt>
              <dd className="font-mono">{identity.code || '-'}</dd>
            </div>
            <div className="flex items-baseline gap-2">
              <dt className="text-muted-foreground">learning_model_id</dt>
              <dd className="font-mono">{identity.learning_model_id || '-'}</dd>
            </div>
          </dl>
          <p className="text-sm text-muted-foreground">
            5 档商品价原子保存。校验 Pro ≥ Flash invariant；Pro 升级加价
            由 Pro − Flash 自动派生。
          </p>
        </header>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> 加载中…
          </div>
        )}

        {loadError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>加载失败</AlertTitle>
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
        )}

        {invariantErrors.length > 0 && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>表单校验未通过</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-5 space-y-1">
                {invariantErrors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {partialTierCodes.length > 0 && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>有部分填写的档位将被跳过</AlertTitle>
            <AlertDescription>
              <p className="mb-2">
                以下档位填了一部分但缺字段，保存时将<b>不</b>提交。完全
                没填的档位会被忽略，但填了一半的通常是手滑，建议补齐或清空：
              </p>
              <ul className="list-disc pl-5 space-y-1">
                {partialTierCodes.map((code) => (
                  <li key={code}>{TIER_LABELS[code] || code}</li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted-foreground">
                本次将提交 {completeTierCodes.length} 档：
                {completeTierCodes.map((c) => TIER_LABELS[c] || c).join(' / ') || '（无）'}。
              </p>
            </AlertDescription>
          </Alert>
        )}

        {saveError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>保存失败</AlertTitle>
            <AlertDescription>
              <p>{saveError}</p>
              {saveErrorDetails && (
                <pre className="mt-2 text-xs bg-black/5 p-2 rounded overflow-x-auto">
                  {JSON.stringify(saveErrorDetails, null, 2)}
                </pre>
              )}
            </AlertDescription>
          </Alert>
        )}

        {saveOk && (
          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertTitle>已保存</AlertTitle>
            <AlertDescription>新版本已写入；可重新编辑或查看历史。</AlertDescription>
          </Alert>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          {tiers.map((tier) => (
            <Card key={tier.tier_code}>
              <CardHeader className="space-y-1">
                <CardTitle className="flex items-center gap-2 text-base">
                  {TIER_LABELS[tier.tier_code] || tier.tier_code}
                  {tier.effective_version !== undefined && (
                    <Badge variant="outline" className="font-mono">
                      v{tier.effective_version}
                    </Badge>
                  )}
                  {tier.manual_override_warning && (
                    <Badge variant="destructive">≥30% 偏离</Badge>
                  )}
                </CardTitle>
                <CardDescription className="font-mono text-xs">
                  {tier.tier_code}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-1">
                    <Label htmlFor={`mp-${tier.tier_code}`}>
                      manual_price (积分)
                    </Label>
                    <Tooltip>
                      <TooltipTrigger>
                        <HelpCircle className="h-3 w-3 text-muted-foreground" />
                      </TooltipTrigger>
                      <TooltipContent>
                        Manual catalog price used for end-user charging.
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <Input
                    id={`mp-${tier.tier_code}`}
                    inputMode="numeric"
                    placeholder="800"
                    value={tier.manual_price}
                    onChange={(e) =>
                      updateTier(tier.tier_code, 'manual_price', e.target.value)
                    }
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex items-center gap-1">
                    <Label htmlFor={`srp-${tier.tier_code}`}>
                      system_reference_price
                    </Label>
                    <Tooltip>
                      <TooltipTrigger>
                        <HelpCircle className="h-3 w-3 text-muted-foreground" />
                      </TooltipTrigger>
                      <TooltipContent>
                        Backend-provided reference value for validation.
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <Input
                    id={`srp-${tier.tier_code}`}
                    inputMode="numeric"
                    placeholder="750"
                    value={tier.system_reference_price}
                    onChange={(e) =>
                      updateTier(
                        tier.tier_code,
                        'system_reference_price',
                        e.target.value
                      )
                    }
                  />
                </div>

              </CardContent>
            </Card>
          ))}
        </div>

        <div className="flex gap-3">
          <Button
            onClick={save}
            disabled={
              saving ||
              invariantErrors.length > 0 ||
              completeTierCodes.length === 0
            }
            className="gap-2"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            保存 {completeTierCodes.length} 档
          </Button>
          <Button variant="outline" onClick={loadTiers} disabled={loading}>
            重新加载
          </Button>
        </div>

        <Accordion
          type="single"
          collapsible
          value={historyOpen ? 'history' : ''}
          onValueChange={(v) => {
            const open = v === 'history';
            setHistoryOpen(open);
            if (open && Object.keys(history).length === 0) loadHistory();
          }}
        >
          <AccordionItem value="history">
            <AccordionTrigger className="gap-2">
              <History className="h-4 w-4" /> 价格修改历史
            </AccordionTrigger>
            <AccordionContent>
              {historyLoading && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> 加载历史…
                </div>
              )}
              {!historyLoading && Object.keys(history).length === 0 && (
                <p className="text-sm text-muted-foreground">该模板暂无历史记录。</p>
              )}
              {Object.entries(history).map(([tierCode, entries]) => (
                <div key={tierCode} className="mt-4">
                  <h3 className="text-sm font-medium mb-2">
                    {TIER_LABELS[tierCode] || tierCode}{' '}
                    <span className="text-xs font-mono text-muted-foreground">
                      {tierCode}
                    </span>
                  </h3>
                  <div className="space-y-1 text-xs">
                    {entries.map((e) => (
                      <div
                        key={`${tierCode}-${e.effective_version}`}
                        className="flex flex-wrap items-center gap-2 border-l-2 pl-3 py-1"
                      >
                        <Badge variant="outline" className="font-mono">
                          v{e.effective_version}
                        </Badge>
                        {!e.enabled && (
                          <Badge variant="secondary">disabled</Badge>
                        )}
                        {e.manual_override_warning && (
                          <Badge variant="destructive">≥30% 偏离</Badge>
                        )}
                        <span>manual: {e.manual_price}</span>
                        {e.pro_surcharge_display !== null && (
                          <span>+{e.pro_surcharge_display}</span>
                        )}
                        <span>ref: {e.system_reference_price}</span>
                        <span className="text-muted-foreground">
                          by user_id {e.updated_by}
                        </span>
                        <span className="text-muted-foreground">{e.created_at}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
    </TooltipProvider>
  );
}
