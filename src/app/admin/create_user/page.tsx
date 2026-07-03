'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { CheckCircle2, Copy, Loader2, Search } from 'lucide-react';

interface FormState {
  balance: string;
  nickname: string;
  mobile: string;
  email: string;
  company_name: string;
}

const INITIAL_CREATE_FORM: FormState = {
  balance: '1000',
  nickname: '',
  mobile: '',
  email: '',
  company_name: '',
};

interface CreateResult {
  app_key: string;
  balance: string;
  nickname: string;
  mobile: string;
  email: string;
  company_name: string;
}

interface UserApiRecord {
  app_key: string;
  balance: string;
  nickname: string | null;
  mobile: string | null;
  email: string | null;
  company_name: string | null;
  created_at: string;
}

function recordToForm(user: UserApiRecord): FormState {
  return {
    balance: user.balance,
    nickname: user.nickname ?? '',
    mobile: user.mobile ?? '',
    email: user.email ?? '',
    company_name: user.company_name ?? '',
  };
}

export default function AdminCreateUserPage() {
  return (
    <div className="container mx-auto max-w-2xl py-10 space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">用户管理</h1>
        <p className="text-sm text-muted-foreground">
          管理员工具：新建 <code>grid_xxx</code> app_key，或按 app_key
          检索后编辑用户余额 / 资料。
        </p>
      </header>

      <Tabs defaultValue="create" className="space-y-4">
        <TabsList>
          <TabsTrigger value="create">新建用户</TabsTrigger>
          <TabsTrigger value="edit">编辑用户</TabsTrigger>
        </TabsList>
        <TabsContent value="create">
          <CreateUserPanel />
        </TabsContent>
        <TabsContent value="edit">
          <EditUserPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function CreateUserPanel() {
  const [form, setForm] = useState<FormState>(INITIAL_CREATE_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateResult | null>(null);
  const [copied, setCopied] = useState(false);

  const update = (field: keyof FormState) => (
    e: React.ChangeEvent<HTMLInputElement>
  ) => setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResult(null);
    setCopied(false);

    const balanceTrimmed = form.balance.trim() || '1000';
    const balanceNum = Number(balanceTrimmed);
    if (!Number.isFinite(balanceNum) || balanceNum < 0) {
      setError('初始积分必须是非负数字。');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          balance: balanceTrimmed,
          nickname: form.nickname.trim() || null,
          mobile: form.mobile.trim() || null,
          email: form.email.trim() || null,
          company_name: form.company_name.trim() || null,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) {
        setError(json?.error || `创建失败 (HTTP ${res.status})`);
        return;
      }
      setResult({
        app_key: json.data.app_key,
        balance: balanceTrimmed,
        nickname: form.nickname.trim(),
        mobile: form.mobile.trim(),
        email: form.email.trim(),
        company_name: form.company_name.trim(),
      });
      setForm(INITIAL_CREATE_FORM);
    } catch (err) {
      setError((err as Error).message || '网络异常');
    } finally {
      setSubmitting(false);
    }
  };

  const copyKey = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.app_key);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may be unavailable (insecure context, etc.) — operator
      // can fall back to manual select-copy from the displayed key.
    }
  };

  return (
    <div className="space-y-6">
      {result && (
        <Alert>
          <CheckCircle2 className="h-4 w-4" />
          <AlertTitle>创建成功</AlertTitle>
          <AlertDescription>
            <div className="mt-2 space-y-2">
              <div className="flex items-center gap-2">
                <code className="rounded bg-muted px-2 py-1 font-mono text-sm break-all">
                  {result.app_key}
                </code>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={copyKey}
                >
                  <Copy className="mr-1 h-3 w-3" />
                  {copied ? '已复制' : '复制'}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                初始积分 {result.balance}
                {result.nickname && ` · ${result.nickname}`}
                {result.company_name && ` · ${result.company_name}`}
              </p>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertTitle>创建失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>用户信息</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <ProfileFields
              form={form}
              update={update}
              balanceLabel="初始积分"
              balanceHint="留空或填 1000 为默认值。"
            />
            <Button type="submit" disabled={submitting} className="w-full">
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {submitting ? '创建中…' : '创建用户'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function EditUserPanel() {
  const [appKeyInput, setAppKeyInput] = useState('');
  const [loadedAppKey, setLoadedAppKey] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const update = (field: keyof FormState) => (
    e: React.ChangeEvent<HTMLInputElement>
  ) => setForm((prev) => (prev ? { ...prev, [field]: e.target.value } : prev));

  const lookup = async () => {
    const key = appKeyInput.trim();
    setLookupError(null);
    setSaveError(null);
    setSaved(false);
    setLoadedAppKey(null);
    setForm(null);
    if (!key) {
      setLookupError('请填写 app_key。');
      return;
    }
    setLookingUp(true);
    try {
      const res = await fetch(
        `/api/admin/users/${encodeURIComponent(key)}`,
        { method: 'GET' }
      );
      const json = await res.json().catch(() => ({}));
      if (res.status === 404) {
        setLookupError('该 app_key 不存在。');
        return;
      }
      if (!res.ok || !json?.success) {
        setLookupError(json?.error || `检测失败 (HTTP ${res.status})`);
        return;
      }
      const user = json.data as UserApiRecord;
      setLoadedAppKey(user.app_key);
      setForm(recordToForm(user));
    } catch (err) {
      setLookupError((err as Error).message || '网络异常');
    } finally {
      setLookingUp(false);
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loadedAppKey || !form) return;
    setSaveError(null);
    setSaved(false);

    const balanceTrimmed = form.balance.trim();
    if (!balanceTrimmed) {
      setSaveError('余额不能为空。');
      return;
    }
    const balanceNum = Number(balanceTrimmed);
    if (!Number.isFinite(balanceNum) || balanceNum < 0) {
      setSaveError('余额必须是非负数字。');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(
        `/api/admin/users/${encodeURIComponent(loadedAppKey)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            balance: balanceTrimmed,
            nickname: form.nickname.trim() || null,
            mobile: form.mobile.trim() || null,
            email: form.email.trim() || null,
            company_name: form.company_name.trim() || null,
          }),
        }
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) {
        setSaveError(json?.error || `保存失败 (HTTP ${res.status})`);
        return;
      }
      setForm(recordToForm(json.data as UserApiRecord));
      setSaved(true);
    } catch (err) {
      setSaveError((err as Error).message || '网络异常');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>检测 app_key</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-2">
              <Label htmlFor="edit-app-key">app_key</Label>
              <Input
                id="edit-app-key"
                placeholder="grid_xxxxxxxxxxxxxxxxxxxxxx"
                value={appKeyInput}
                onChange={(e) => setAppKeyInput(e.target.value)}
                disabled={lookingUp}
              />
            </div>
            <Button type="button" onClick={lookup} disabled={lookingUp}>
              {lookingUp ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Search className="mr-1 h-4 w-4" />
              )}
              {lookingUp ? '检测中…' : '检测'}
            </Button>
          </div>
          {lookupError && (
            <Alert variant="destructive" className="mt-4">
              <AlertTitle>检测失败</AlertTitle>
              <AlertDescription>{lookupError}</AlertDescription>
            </Alert>
          )}
          {loadedAppKey && (
            <Alert className="mt-4">
              <CheckCircle2 className="h-4 w-4" />
              <AlertTitle>已加载</AlertTitle>
              <AlertDescription>
                <code className="font-mono text-sm break-all">
                  {loadedAppKey}
                </code>
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {loadedAppKey && form && (
        <Card>
          <CardHeader>
            <CardTitle>编辑用户信息</CardTitle>
          </CardHeader>
          <CardContent>
            {saved && (
              <Alert className="mb-4">
                <CheckCircle2 className="h-4 w-4" />
                <AlertTitle>保存成功</AlertTitle>
              </Alert>
            )}
            {saveError && (
              <Alert variant="destructive" className="mb-4">
                <AlertTitle>保存失败</AlertTitle>
                <AlertDescription>{saveError}</AlertDescription>
              </Alert>
            )}
            <form onSubmit={save} className="space-y-4">
              <ProfileFields
                form={form}
                update={update}
                balanceLabel="余额（积分）"
                balanceHint="非负数字；留空将被拒绝。"
              />
              <Button type="submit" disabled={saving} className="w-full">
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {saving ? '保存中…' : '保存修改'}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

interface ProfileFieldsProps {
  form: FormState;
  update: (
    field: keyof FormState
  ) => (e: React.ChangeEvent<HTMLInputElement>) => void;
  balanceLabel: string;
  balanceHint: string;
}

function ProfileFields({
  form,
  update,
  balanceLabel,
  balanceHint,
}: ProfileFieldsProps) {
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="balance">{balanceLabel}</Label>
        <Input
          id="balance"
          inputMode="decimal"
          placeholder="1000"
          value={form.balance}
          onChange={update('balance')}
        />
        <p className="text-xs text-muted-foreground">{balanceHint}</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="nickname">昵称（可选）</Label>
        <Input
          id="nickname"
          placeholder="Demo User"
          value={form.nickname}
          onChange={update('nickname')}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="mobile">手机号（可选）</Label>
        <Input
          id="mobile"
          placeholder="13912345678"
          value={form.mobile}
          onChange={update('mobile')}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="email">邮箱（可选）</Label>
        <Input
          id="email"
          type="email"
          placeholder="demo@example.com"
          value={form.email}
          onChange={update('email')}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="company_name">公司名（可选）</Label>
        <Input
          id="company_name"
          placeholder="Example Studio"
          value={form.company_name}
          onChange={update('company_name')}
        />
      </div>
    </>
  );
}
