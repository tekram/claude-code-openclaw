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
}

export interface SessionsData {
  active: Session[];
  paused: Session[];
  completed: Session[];
  exited: Session[];
  dismissed?: Session[];
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
