import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import path from 'path';

const SESSION_OWNER_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || '',
  '.openclaw', 'workspace', '.session-owners'
);

export async function GET() {
  if (!existsSync(SESSION_OWNER_DIR)) {
    return NextResponse.json({ approvals: [] });
  }
  const approvals = [];
  const now = Date.now();
  try {
    const files = readdirSync(SESSION_OWNER_DIR);
    for (const file of files) {
      if (!file.endsWith('.pending-approval.json')) continue;
      try {
        const data = JSON.parse(readFileSync(path.join(SESSION_OWNER_DIR, file), 'utf-8'));
        if (data.timeoutAt > now) {
          approvals.push(data);
        }
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  return NextResponse.json({ approvals });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { approvalId, decision, project, selectedLabel } = body as {
    approvalId?: string;
    decision?: string;
    project?: string;
    selectedLabel?: string;
  };

  if (!approvalId || !decision || !project) {
    return NextResponse.json(
      { error: 'approvalId, decision, and project are required' },
      { status: 400 }
    );
  }
  if (decision !== 'allow' && decision !== 'deny' && decision !== 'answer') {
    return NextResponse.json(
      { error: 'decision must be "allow", "deny", or "answer"' },
      { status: 400 }
    );
  }
  if (decision === 'answer' && !selectedLabel) {
    return NextResponse.json(
      { error: 'selectedLabel is required when decision is "answer"' },
      { status: 400 }
    );
  }

  const pendingPath = path.join(SESSION_OWNER_DIR, `${project}.pending-approval.json`);
  if (!existsSync(pendingPath)) {
    return NextResponse.json(
      { error: 'No pending approval found for this project' },
      { status: 404 }
    );
  }

  let pending: { approvalId: string; timeoutAt: number };
  try {
    pending = JSON.parse(readFileSync(pendingPath, 'utf-8'));
  } catch {
    return NextResponse.json({ error: 'Failed to read pending approval' }, { status: 500 });
  }

  if (pending.approvalId !== approvalId) {
    return NextResponse.json({ error: 'Approval ID mismatch' }, { status: 409 });
  }

  if (Date.now() > pending.timeoutAt) {
    return NextResponse.json({ error: 'Approval request has expired' }, { status: 410 });
  }

  const decisionPath = path.join(SESSION_OWNER_DIR, `${project}.approval-decision.json`);
  try {
    const decisionData: Record<string, unknown> = {
      approvalId,
      decision,
      decidedAt: Date.now(),
      decidedBy: 'dashboard',
    };
    if (decision === 'answer' && selectedLabel) {
      decisionData.selectedLabel = selectedLabel;
    }
    writeFileSync(decisionPath, JSON.stringify(decisionData), 'utf-8');
  } catch {
    return NextResponse.json({ error: 'Failed to write decision' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
