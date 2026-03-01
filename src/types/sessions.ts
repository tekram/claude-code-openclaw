export type InterruptReason =
  | 'manual'      // User explicitly exited
  | 'crash'       // Unexpected termination
  | 'superseded'  // New START for same project
  | 'timeout'     // 4h+ inactivity
  | 'dismissed'   // User dismissed from UI
  | 'unknown';    // Legacy or unclear

export interface Session {
  project: string;
  status: 'active' | 'paused' | 'completed' | 'exited' | 'dismissed';
  startTime: string;
  endTime?: string;
  lastActivityTime?: string;
  details?: string;

  // Enhanced metadata
  sessionSuffix?: string;     // First 6 alphanumeric chars of Claude's session_id (from log #suffix)
  instanceIndex?: number;     // 1-based ordinal when multiple sessions share the same project name
  isWorking?: boolean;        // Claude is actively using tools (activity < 30s ago)
  interruptReason?: InterruptReason;
  durationMs?: number;
  completionNotes?: string;
  dismissedAt?: string;
  notes?: string[];           // User-added notes via UI or CLI
  startCommitHash?: string;   // git HEAD at session start (40-char SHA)
  endCommitHash?: string;     // git HEAD at session end (40-char SHA)
}

export interface PendingApprovalOption {
  label: string;
  description?: string;
}

export interface PendingApproval {
  approvalId: string;
  sessionId: string;
  project: string;
  toolName: string;
  humanDescription: string;
  gateType: 'approval' | 'question';   // 'approval' = Bash/Write/Edit gate, 'question' = AskUserQuestion
  question?: string;                    // for gateType='question': the question text
  options?: PendingApprovalOption[];    // for gateType='question': selectable options
  createdAt: number;
  timeoutAt: number;
  telegramMessageId?: number;
  telegramChatId?: string;
  // Merged from decision file (if already decided)
  decision?: 'allow' | 'deny' | 'answer';
  decidedAt?: number;
  decidedBy?: 'telegram' | 'dashboard';
  selectedLabel?: string;               // for decision='answer': the chosen option label
}

export interface SessionsData {
  active: Session[];
  paused: Session[];
  completed: Session[];
  exited: Session[];
  dismissed?: Session[];
  pendingApprovals?: PendingApproval[];
  lastUpdated: string;
}

export interface GitInfo {
  branch: string | null;
  isDirty: boolean;
  pr: {
    number: number;
    title: string;
    state: 'OPEN' | 'CLOSED' | 'MERGED';
    url: string;
    ciStatus: 'passing' | 'failing' | 'pending' | null;
  } | null;
}

export type GitInfoMap = Record<string, GitInfo>; // keyed by project name
