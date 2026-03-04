'use client';

import { useState } from 'react';
import { Trash2 } from 'lucide-react';

export const TaskCleanup = () => {
  const [maxAgeDays, setMaxAgeDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const handleCleanup = async () => {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch(`/api/tasks/cleanup?maxAgeDays=${maxAgeDays}`, { method: 'DELETE' });
      const json = await res.json() as { ok?: boolean; deleted?: number; error?: string };
      if (json.ok) {
        setResult(`Deleted ${json.deleted} result file${json.deleted === 1 ? '' : 's'}.`);
      } else {
        setResult(json.error || 'Cleanup failed.');
      }
    } catch {
      setResult('Request failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-xs font-medium">Clean up old task results</span>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Removes task result JSON files older than the selected age from{' '}
        <code className="font-mono text-[10px]">~/.openclaw/workspace/task-results/</code>.
      </p>
      <div className="flex items-center gap-2">
        <label className="text-xs text-muted-foreground">Older than</label>
        <select
          className="ui-input rounded-md px-2 py-1 text-xs"
          value={maxAgeDays}
          onChange={(e) => setMaxAgeDays(Number(e.target.value))}
        >
          <option value={7}>7 days</option>
          <option value={30}>30 days</option>
          <option value={90}>90 days</option>
          <option value={9999}>All time</option>
        </select>
        <button
          type="button"
          className="ui-btn px-3 py-1.5 text-xs flex items-center gap-1.5"
          onClick={handleCleanup}
          disabled={busy}
        >
          <Trash2 className="w-3 h-3" />
          {busy ? 'Cleaning…' : 'Clean up'}
        </button>
      </div>
      {result && (
        <p className="text-xs text-muted-foreground">{result}</p>
      )}
    </div>
  );
};
