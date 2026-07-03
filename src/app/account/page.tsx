'use client';

import { useState, useEffect, useCallback } from 'react';
import { AppNavLink } from '@/components/app-nav-link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
  Zap,
  ListChecks,
  Coins,
  Key,
  CreditCard,
  LogOut,
  Pencil,
} from 'lucide-react';
import { useAppKey } from '@/hooks/use-app-key';
import { ThemeToggle } from '@/components/theme-toggle';

// ─── Types ───────────────────────────────────────────────────────────────────

interface UserBalance {
  id?: number;
  nickname?: string;
  mobile?: string;
  balance: string;
  company_name?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function maskKey(key: string) {
  if (!key || key.length <= 8) return key;
  return key.slice(0, 6) + '••••••' + key.slice(-4);
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function AccountPage() {
  const { appKey, setAppKey, clearAppKey, loaded } = useAppKey();

  // App Key Dialog
  const [showKeyDialog, setShowKeyDialog] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);

  // Balance
  const [balance, setBalance] = useState<UserBalance | null>(null);
  const [loadingBalance, setLoadingBalance] = useState(false);
  const [balanceError, setBalanceError] = useState('');

  // Logout
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const handleLogout = () => {
    clearAppKey();
    setBalance(null);
    setShowLogoutConfirm(false);
    showToast('success', '已退出，App Key 已清除');
  };

  // Recharge / App Key instructions dialog
  const [showRechargeQR, setShowRechargeQR] = useState(false);

  // Toast
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const showToast = useCallback((type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const apiHeaders = useCallback(() => ({
    'Content-Type': 'application/json',
    'x-app-key': appKey,
  }), [appKey]);

  const fetchBalance = useCallback(async () => {
    if (!appKey) return;
    setLoadingBalance(true);
    setBalanceError('');
    try {
      // Reseller-mediated: /api/account/profile → narrator-ai-web-backend
      // /account/me. We deliberately don't fall back to the legacy
      // direct-to-upstream /api/account/balance — if the configured key
      // isn't in the reseller users table, the user should see the real
      // reason (e.g. "用户不存在") instead of being silently routed
      // around the new backend.
      const res = await fetch('/api/account/profile', { headers: apiHeaders() });
      const json = await res.json();
      if (json.success) setBalance(json.data);
      else setBalanceError(json.error || '获取用户信息失败');
    } catch {
      setBalanceError('网络错误，请重试');
    } finally {
      setLoadingBalance(false);
    }
  }, [appKey, apiHeaders]);

  useEffect(() => {
    if (!loaded) return;
    if (!appKey) return;
    fetchBalance();
  }, [loaded, appKey, fetchBalance]);

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
      {/* ─── Header / Nav ─── */}
      <header className="border-b bg-card/80 backdrop-blur-sm sticky top-0 z-30">
        <div className="container mx-auto px-4 py-0 flex items-center justify-between h-14">
          <AppNavLink href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <img src="/images/logo-light.png" alt="AI 解说大师" className="h-[1.6rem] w-auto dark:hidden" />
            <img src="/images/logo-dark.svg" alt="AI 解说大师" className="hidden h-[1.6rem] w-auto dark:block" />
          </AppNavLink>
          <nav className="flex items-center gap-1">
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
            <AppNavLink href="/cloud-drive">
              <Button variant="ghost" size="sm" className="gap-1.5">
                <HardDrive className="h-4 w-4" />
                个人云盘
              </Button>
            </AppNavLink>
            <Button variant="default" size="sm" className="gap-1.5">
              <User className="h-4 w-4" />
              个人中心
            </Button>
            <ThemeToggle className="ml-1" />
          </nav>
        </div>
      </header>

      {/* ─── Main Content ─── */}
      <main className="flex-1 container mx-auto px-4 py-6 max-w-6xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold flex items-center gap-2"><User className="h-5 w-5 text-primary" />个人中心</h1>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm" variant="outline"
              onClick={() => fetchBalance()}
              disabled={loadingBalance || !appKey}
              className="gap-1.5"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loadingBalance ? 'animate-spin' : ''}`} />
              刷新
            </Button>
            {appKey && (
              <Button
                size="sm" variant="outline"
                onClick={() => setShowLogoutConfirm(true)}
                className="gap-1.5 text-red-600 hover:text-red-700 hover:bg-red-50"
              >
                <LogOut className="h-3.5 w-3.5" />
                退出
              </Button>
            )}
          </div>
        </div>

        {/* Balance Card */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Coins className="h-4 w-4 text-yellow-500" />
              点数余额
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!appKey ? (
              <p className="text-sm text-muted-foreground">请先配置 App Key</p>
            ) : loadingBalance ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">加载中...</span>
              </div>
            ) : balanceError ? (
              <p className="text-sm text-red-500 flex items-center gap-1">
                <AlertCircle className="h-3.5 w-3.5" />{balanceError}
              </p>
            ) : balance ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-baseline gap-2">
                    <p className="text-3xl font-bold text-yellow-600 tabular-nums">{balance.balance}</p>
                    <span className="text-sm text-muted-foreground">点</span>
                  </div>
                  <Button size="sm" className="gap-1.5" onClick={() => setShowRechargeQR(true)}>
                    <CreditCard className="h-3.5 w-3.5" />充值
                  </Button>
                </div>
                <div className="grid grid-cols-3 gap-4 pt-2 border-t">
                  {balance.nickname && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">昵称</p>
                      <p className="text-sm font-medium">{balance.nickname}</p>
                    </div>
                  )}
                  {balance.company_name && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">公司</p>
                      <p className="text-sm font-medium">{balance.company_name}</p>
                    </div>
                  )}
                  {balance.mobile && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-0.5">手机</p>
                      <p className="text-sm font-medium">{balance.mobile}</p>
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        {/* App Key Config Card */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Settings className="h-4 w-4 text-primary" />
              App Key 配置
            </CardTitle>
          </CardHeader>
          <CardContent>
            {appKey ? (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <Key className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="font-mono text-sm text-foreground truncate">
                    {showKey ? appKey : maskKey(appKey)}
                  </span>
                  <Button
                    variant="ghost" size="icon"
                    className="h-7 w-7 shrink-0"
                    onClick={() => setShowKey(v => !v)}
                    type="button"
                  >
                    {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </Button>
                  <Button
                    variant="ghost" size="icon"
                    className="h-7 w-7 shrink-0 ml-[30px]"
                    onClick={() => { setKeyInput(appKey); setShowKeyDialog(true); }}
                    type="button"
                    title="修改 App Key"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground/60 pl-6">安全存储在本地浏览器中，不会上传至任何服务器</p>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground flex-1">未配置 App Key</span>
                <Button size="sm" variant="outline" onClick={() => setShowKeyDialog(true)}>配置</Button>
              </div>
            )}
          </CardContent>
        </Card>

      </main>

      {/* ─── App Key Dialog ─── */}
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
            <Label htmlFor="account-appkey-input">App Key</Label>
            <div className="relative">
              <Input
                id="account-appkey-input"
                type={showKey ? 'text' : 'password'}
                placeholder="请输入您的 App Key"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSaveKey()}
                className="pr-10"
              />
              <Button
                variant="ghost" size="icon"
                className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                onClick={() => setShowKey(v => !v)}
                type="button"
              >
                {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            还没有 App Key？请<button type="button" className="text-primary hover:underline font-medium" onClick={() => { setShowKeyDialog(false); setShowRechargeQR(true); }}>联系部署管理员</button>获取。
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowKeyDialog(false)}>取消</Button>
            <Button onClick={handleSaveKey} disabled={!keyInput.trim()}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── App Key / Recharge instructions dialog ─── */}
      <Dialog open={showRechargeQR} onOpenChange={setShowRechargeQR}>
        <DialogContent className="sm:max-w-xs text-center">
          <DialogHeader>
            <DialogTitle>获取 App Key</DialogTitle>
            <DialogDescription className="text-[11px] leading-tight">请联系当前部署的管理员获取 App Key 或补充点数</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>

      {/* ─── Logout Confirm Dialog ─── */}
      <Dialog open={showLogoutConfirm} onOpenChange={setShowLogoutConfirm}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LogOut className="h-4 w-4" />
              确认退出
            </DialogTitle>
            <DialogDescription>
              退出后将清除本地保存的 App Key，需要重新配置才能使用。确定要退出吗？
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowLogoutConfirm(false)}>取消</Button>
            <Button variant="destructive" onClick={handleLogout}>确认退出</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Toast ─── */}
      {toast && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium shadow-lg transition-all ${
          toast.type === 'success' ? 'bg-green-50 border border-green-200 text-green-800' : 'bg-red-50 border border-red-200 text-red-800'
        }`}>
          {toast.type === 'success' ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          {toast.message}
        </div>
      )}

      {/* Footer */}
      <footer className="border-t bg-card py-4 text-center text-xs text-muted-foreground">
        © 2011 - {new Date().getFullYear()} NarratorAI · AI 视频解说大师
      </footer>
    </div>
  );
}
