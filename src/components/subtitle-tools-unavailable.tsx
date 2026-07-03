'use client';

import { AppNavLink } from '@/components/app-nav-link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { AlertCircle, ArrowLeft, Wrench } from 'lucide-react';

export const SUBTITLE_TOOLS_ENABLED = false;

type SubtitleToolsUnavailableProps = {
  title: string;
  description: string;
};

export function SubtitleToolsUnavailable({ title, description }: SubtitleToolsUnavailableProps) {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-40">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between h-14">
          <div className="flex items-center gap-3">
            <AppNavLink href="/">
              <Button variant="ghost" size="sm" className="gap-1">
                <ArrowLeft className="h-4 w-4" />
                返回首页
              </Button>
            </AppNavLink>
            <h1 className="text-lg font-semibold flex items-center gap-2">
              <Wrench className="h-5 w-5 text-muted-foreground" />
              {title}
            </h1>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-10 max-w-2xl">
        <Card>
          <CardContent className="p-6 sm:p-8 space-y-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-full bg-amber-100 p-2 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                <AlertCircle className="h-5 w-5" />
              </div>
              <div className="space-y-2">
                <h2 className="text-xl font-semibold">暂未开放</h2>
                <p className="text-sm text-muted-foreground leading-6">{description}</p>
                <p className="text-sm text-muted-foreground leading-6">
                  字幕提取和字幕擦除会在任务记录、扣费、退款和配额调整链路补齐后重新开放。
                </p>
              </div>
            </div>
            <AppNavLink href="/">
              <Button className="gap-2">
                <ArrowLeft className="h-4 w-4" />
                返回首页
              </Button>
            </AppNavLink>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
