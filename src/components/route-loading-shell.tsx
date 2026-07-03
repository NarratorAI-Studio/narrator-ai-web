import { Loader2 } from 'lucide-react';

interface RouteLoadingShellProps {
  label?: string;
}

export function RouteLoadingShell({ label = 'Loading...' }: RouteLoadingShellProps) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b bg-card/80">
        <div className="container mx-auto flex h-14 items-center justify-between px-4">
          <div className="h-6 w-36 rounded bg-muted animate-pulse" />
          <div className="hidden gap-2 sm:flex">
            <div className="h-8 w-20 rounded bg-muted animate-pulse" />
            <div className="h-8 w-20 rounded bg-muted animate-pulse" />
            <div className="h-8 w-20 rounded bg-muted animate-pulse" />
          </div>
        </div>
      </header>
      <main className="container mx-auto flex min-h-[60vh] items-center justify-center px-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>{label}</span>
        </div>
      </main>
    </div>
  );
}
