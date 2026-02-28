'use client';

import { useState } from 'react';
import { GitCommitHorizontal, GitPullRequest, ExternalLink, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import type { SessionCommitsResponse, SessionCommit } from '@/app/api/sessions/commits/route';

interface Props {
  project: string;
  startTime: string;    // "YYYY-MM-DD HH:MM:SS" — fallback for old sessions
  endTime?: string;     // "YYYY-MM-DD HH:MM:SS" — fallback for old sessions
  startHash?: string;   // git HEAD at session start (preferred)
  endHash?: string;     // git HEAD at session end (preferred)
}

type LoadState = 'idle' | 'loading' | 'done' | 'empty' | 'error';

// PR state → badge color
function prStateClass(state: string): string {
  if (state === 'OPEN' || state === 'open') return 'text-green-600 dark:text-green-400 bg-green-500/10 border-green-500/20';
  if (state === 'MERGED' || state === 'merged') return 'text-purple-600 dark:text-purple-400 bg-purple-500/10 border-purple-500/20';
  return 'text-muted-foreground bg-muted/50 border-border';
}

function CommitRow({ commit }: { commit: SessionCommit }) {
  return (
    <div className="flex items-start gap-1.5 py-0.5 group/commit">
      <GitCommitHorizontal className="w-3 h-3 mt-0.5 shrink-0 text-muted-foreground/60" />

      {/* Hash — links to GitHub commit */}
      {commit.githubUrl ? (
        <a
          href={commit.githubUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-[10px] text-primary/70 hover:text-primary hover:underline shrink-0 flex items-center gap-0.5"
          title={`Open commit ${commit.hash} on GitHub`}
        >
          {commit.shortHash}
          <ExternalLink className="w-2 h-2 opacity-0 group-hover/commit:opacity-100 transition-opacity" />
        </a>
      ) : (
        <code className="font-mono text-[10px] text-muted-foreground shrink-0">{commit.shortHash}</code>
      )}

      {/* Message */}
      <span className="text-[10px] text-muted-foreground truncate flex-1 min-w-0">{commit.message}</span>

      {/* PR badge */}
      {commit.pr && (
        <a
          href={commit.pr.url}
          target="_blank"
          rel="noopener noreferrer"
          className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border text-[9px] font-medium shrink-0 hover:opacity-80 transition-opacity ${prStateClass(commit.pr.state)}`}
          title={`${commit.pr.title} (${commit.pr.state})`}
        >
          <GitPullRequest className="w-2.5 h-2.5" />
          #{commit.pr.number}
        </a>
      )}
    </div>
  );
}

export function SessionCommits({ project, startTime, endTime, startHash, endHash }: Props) {
  const [state, setState] = useState<LoadState>('idle');
  const [data, setData] = useState<SessionCommitsResponse | null>(null);
  const [open, setOpen] = useState(false);

  const load = async () => {
    if (state === 'loading') return;
    setState('loading');

    const params = new URLSearchParams({ project, from: startTime });
    if (endTime) params.set('to', endTime);
    if (startHash) params.set('startHash', startHash);
    if (endHash) params.set('endHash', endHash);

    try {
      const res = await fetch(`/api/sessions/commits?${params}`);
      const json: SessionCommitsResponse = await res.json();
      setData(json);
      setState(json.commits.length === 0 ? 'empty' : 'done');
      setOpen(true);
    } catch {
      setState('error');
    }
  };

  const toggle = () => {
    if (state === 'idle') {
      load();
    } else {
      setOpen((o) => !o);
    }
  };

  // Don't render anything until the first click — avoids cluttering cards with a button on every session
  // when there might be no commits. Show a subtle "commits" button only after render.
  // If we already know the state, render accordingly.

  const commitCount = data?.commits.length ?? 0;

  return (
    <div className="mt-1.5">
      {/* Trigger button */}
      <button
        type="button"
        onClick={toggle}
        disabled={state === 'loading' || state === 'empty' || state === 'error'}
        className={`flex items-center gap-1 text-[10px] transition-colors ${
          state === 'empty' || state === 'error'
            ? 'text-muted-foreground/40 cursor-default'
            : 'text-muted-foreground hover:text-foreground'
        }`}
        title={
          state === 'idle' ? 'Load commits for this session' :
          state === 'empty' ? 'No commits found in this session\'s timeframe' :
          state === 'error' ? 'Failed to load commits' : undefined
        }
      >
        {state === 'loading' ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : (
          <GitCommitHorizontal className="w-3 h-3" />
        )}

        <span>
          {state === 'idle'   && 'View commits'}
          {state === 'loading' && 'Loading…'}
          {state === 'empty'  && 'No commits'}
          {state === 'error'  && 'Failed to load'}
          {state === 'done'   && `${commitCount} commit${commitCount !== 1 ? 's' : ''}`}
        </span>

        {state === 'done' && (
          open
            ? <ChevronUp className="w-3 h-3" />
            : <ChevronDown className="w-3 h-3" />
        )}
      </button>

      {/* Commit list */}
      {state === 'done' && open && data && (
        <div className="mt-1.5 pl-1 border-l border-border/50 space-y-0.5">
          {data.commits.map((c) => (
            <CommitRow key={c.hash} commit={c} />
          ))}
          {/* Link to compare view on GitHub if we have the base URL */}
          {data.githubBaseUrl && (
            <a
              href={`${data.githubBaseUrl}/commits`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-[10px] text-muted-foreground/50 hover:text-muted-foreground mt-1 pl-4 transition-colors"
            >
              <ExternalLink className="w-2.5 h-2.5" />
              View on GitHub
            </a>
          )}
        </div>
      )}
    </div>
  );
}
