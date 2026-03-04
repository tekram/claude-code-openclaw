import Link from 'next/link';
import { NotificationSettings } from '@/components/NotificationSettings';
import { ProjectSettings } from '@/components/ProjectSettings';
import { TaskCleanup } from '@/components/TaskCleanup';

export default function SettingsPage() {
  return (
    <main className="h-screen flex flex-col overflow-hidden">
      <div className="flex-shrink-0 px-5 py-3 border-b border-border bg-card/50 flex items-center gap-4">
        <Link href="/" className="text-muted-foreground hover:text-foreground transition-colors text-sm">
          ← Back
        </Link>
        <h1 className="text-sm font-semibold tracking-tight">Settings</h1>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="px-2 py-4 space-y-6">
          <div>
            <div className="mb-1 px-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Notifications
            </div>
            <NotificationSettings />
          </div>

          <div>
            <div className="mb-1 px-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Project Paths
            </div>
            <ProjectSettings />
          </div>

          <div>
            <div className="mb-1 px-4 text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Task Results
            </div>
            <div className="px-4">
              <TaskCleanup />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
