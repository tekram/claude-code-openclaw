import Link from 'next/link';
import { SessionsPanel } from '@/components/SessionsPanel';
import { CapturesPanel } from '@/components/CapturesPanel';
import { ThemeToggle } from '@/components/ThemeToggle';

export default function Home() {
  return (
    <main className="h-screen flex overflow-hidden">
      {/* Sessions Panel — 60% width */}
      <div className="flex-1 min-w-0 border-r border-border overflow-hidden">
        <div className="h-full flex flex-col">
          <div className="flex-shrink-0 px-5 py-3 border-b border-border bg-card/50 flex items-center justify-between">
            <h1 className="text-sm font-semibold tracking-tight">Claude Code Sessions</h1>
            <div className="flex items-center gap-3">
              <Link href="/insights" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                Insights
              </Link>
              <Link href="/history" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                History
              </Link>
              <Link href="/settings" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                Settings
              </Link>
              <ThemeToggle />
            </div>
          </div>
          <div className="flex-1 overflow-hidden">
            <SessionsPanel />
          </div>
        </div>
      </div>

      {/* Captures Panel — 40% width */}
      <div className="w-[380px] flex-shrink-0 overflow-hidden">
        <div className="h-full flex flex-col">
          <div className="flex-shrink-0 px-5 py-3 border-b border-border bg-card/50">
            <h1 className="text-sm font-semibold tracking-tight">Captures</h1>
          </div>
          <div className="flex-1 overflow-hidden">
            <CapturesPanel />
          </div>
        </div>
      </div>
    </main>
  );
}
