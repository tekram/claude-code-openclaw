import { exec } from 'child_process';
import { promisify } from 'util';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import os from 'os';

const execAsync = promisify(exec);
const EXEC_TIMEOUT = 6000;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CommitPR {
  number: number;
  title: string;
  url: string;
  state: string; // 'OPEN' | 'CLOSED' | 'MERGED'
}

export interface SessionCommit {
  hash: string;
  shortHash: string;
  message: string;
  authorDate: string; // ISO 8601
  githubUrl: string | null;
  pushed: boolean;    // false = local-only commit, not yet on any remote
  pr: CommitPR | null;
}

export interface SessionCommitsResponse {
  commits: SessionCommit[];
  githubBaseUrl: string | null;
  repoSlug: string | null; // "owner/repo"
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readProjectPaths(): Record<string, string> {
  try {
    const settingsPath =
      process.env.CLAUDE_DASH_SETTINGS ||
      path.join(os.homedir(), '.openclaw', 'workspace', 'claude-dash-settings.json');
    const raw = readFileSync(settingsPath, 'utf-8');
    return (JSON.parse(raw) as { projects?: Record<string, string> }).projects || {};
  } catch {
    return {};
  }
}

/** Parse a git remote URL into { baseUrl, slug } */
function parseRemoteUrl(remote: string): { baseUrl: string; slug: string } | null {
  const cleaned = remote.trim();
  // SSH: git@github.com:owner/repo.git
  const ssh = cleaned.match(/git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/);
  if (ssh) return { baseUrl: `https://github.com/${ssh[1]}`, slug: ssh[1] };
  // HTTPS: https://github.com/owner/repo(.git)
  const https = cleaned.match(/https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?(?:\/)?$/);
  if (https) return { baseUrl: `https://github.com/${https[1]}`, slug: https[1] };
  return null;
}

async function getRepoInfo(
  projectPath: string
): Promise<{ baseUrl: string; slug: string } | null> {
  try {
    const { stdout } = await execAsync('git remote get-url origin', {
      cwd: projectPath,
      timeout: EXEC_TIMEOUT,
    });
    return parseRemoteUrl(stdout);
  } catch {
    return null;
  }
}

/** Returns hashes of commits that exist locally but have not been pushed to any remote. */
async function getLocalOnlyHashes(projectPath: string): Promise<Set<string>> {
  try {
    const { stdout } = await execAsync('git log --format=%H --not --remotes', {
      cwd: projectPath,
      timeout: EXEC_TIMEOUT,
    });
    const hashes = stdout.split('\n').map((h) => h.trim()).filter((h) => h.length === 40);
    return new Set(hashes);
  } catch {
    return new Set(); // If the command fails, assume all commits are pushed
  }
}

/**
 * Look up which (if any) PRs a commit belongs to using the GitHub REST API via gh CLI.
 * Returns the first associated PR, or null if none / gh not available.
 */
async function getCommitPR(slug: string, sha: string): Promise<CommitPR | null> {
  try {
    const { stdout } = await execAsync(
      `gh api repos/${slug}/commits/${sha}/pulls --jq ".[0] | select(. != null) | {number: .number, title: .title, url: .html_url, state: .state}"`,
      { timeout: EXEC_TIMEOUT }
    );
    const trimmed = stdout.trim();
    if (!trimmed) return null;
    const data = JSON.parse(trimmed) as { number: number; title: string; url: string; state: string };
    if (!data.number) return null;
    return data;
  } catch {
    return null;
  }
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const project = searchParams.get('project') || '';
    const from = searchParams.get('from') || '';         // fallback: session startTime "YYYY-MM-DD HH:MM:SS"
    const to = searchParams.get('to') || '';             // fallback: session endTime
    const startHash = searchParams.get('startHash') || ''; // precise: git HEAD at session start
    const endHash = searchParams.get('endHash') || '';     // precise: git HEAD at session end

    const empty: SessionCommitsResponse = { commits: [], githubBaseUrl: null, repoSlug: null };

    if (!project) return Response.json(empty);

    const projectPaths = readProjectPaths();
    const projectPath = projectPaths[project];
    if (!projectPath || !existsSync(projectPath)) return Response.json(empty);

    // Build git log command
    // Format: HASH\x1fSUBJECT\x1fISO-DATE  (unit separator as field delimiter, safe inside messages)
    const parts = ['git log', '--format=%H\x1f%s\x1f%aI', '--no-merges'];

    if (startHash) {
      // Hash-based range: precise, branch-agnostic, no overlap between sessions.
      // startHash..endHash = commits reachable from endHash but not from startHash.
      // If endHash is absent (session still running), compare against HEAD.
      const rangeEnd = endHash || 'HEAD';
      parts.push(`${startHash}..${rangeEnd}`);
    } else {
      // Time-based fallback for sessions logged before this change.
      if (from) parts.push(`--after="${from}"`);
      if (to) parts.push(`--before="${to}"`);
    }

    const { stdout: logOut } = await execAsync(parts.join(' '), {
      cwd: projectPath,
      timeout: EXEC_TIMEOUT,
    });

    const rawLines = logOut.split('\n').filter((l) => l.trim());
    if (rawLines.length === 0) return Response.json(empty);

    // Parse git log output
    const parsed = rawLines.map((line) => {
      const [hash, message, authorDate] = line.split('\x1f');
      return { hash: hash?.trim() ?? '', message: message?.trim() ?? '', authorDate: authorDate?.trim() ?? '' };
    }).filter((c) => c.hash.length === 40);

    // Resolve remote / GitHub URL + find local-only (unpushed) commits in parallel
    const [repoInfo, localOnlyHashes] = await Promise.all([
      getRepoInfo(projectPath),
      getLocalOnlyHashes(projectPath),
    ]);
    const githubBaseUrl = repoInfo?.baseUrl ?? null;
    const repoSlug = repoInfo?.slug ?? null;

    // PR lookup — run in parallel but cap at 15 commits to avoid rate limits
    const COMMIT_PR_LIMIT = 15;
    const prResults = await Promise.allSettled(
      parsed.slice(0, COMMIT_PR_LIMIT).map((c) =>
        repoSlug ? getCommitPR(repoSlug, c.hash) : Promise.resolve(null)
      )
    );

    const commits: SessionCommit[] = parsed.map((c, i) => ({
      hash: c.hash,
      shortHash: c.hash.substring(0, 7),
      message: c.message,
      authorDate: c.authorDate,
      // Only link to GitHub if the commit has been pushed (exists on remote)
      githubUrl: (githubBaseUrl && !localOnlyHashes.has(c.hash))
        ? `${githubBaseUrl}/commit/${c.hash}`
        : null,
      pushed: !localOnlyHashes.has(c.hash),
      pr: i < COMMIT_PR_LIMIT && prResults[i]?.status === 'fulfilled'
        ? (prResults[i] as PromiseFulfilledResult<CommitPR | null>).value
        : null,
    }));

    return Response.json(
      { commits, githubBaseUrl, repoSlug } satisfies SessionCommitsResponse,
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    console.error('Error fetching session commits:', err);
    return Response.json({ commits: [], githubBaseUrl: null, repoSlug: null });
  }
}
