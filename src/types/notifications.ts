export type NotificationEventType =
  | 'question' // Claude asked me a question (AskUserQuestion)
  | 'bash'     // Claude needs bash permission
  | 'file'     // Claude needs write/edit permission
  | 'done'     // Session marked complete
  | 'crash'    // Session exited unexpectedly
  | 'start';   // Session started

export interface NotificationRule {
  type: NotificationEventType;
  enabled: boolean;
  minMinutes: number; // 0 = fire immediately
}

export type DeliveryMode = 'openclaw' | 'direct';

export interface NotificationPrefs {
  channel: string;        // 'telegram' | 'whatsapp' | 'discord' | 'slack'
  to: string;             // recipient ID (auto-populated from OpenClaw)
  deliveryMode: DeliveryMode; // 'openclaw' = via /hooks/agent (logged), 'direct' = Bot API
  rules: NotificationRule[];
}

export const DEFAULT_PREFS: NotificationPrefs = {
  channel: 'telegram',
  to: '',
  deliveryMode: 'direct',
  rules: [
    { type: 'question', enabled: true,  minMinutes: 0  },
    { type: 'bash',     enabled: true,  minMinutes: 10 },
    { type: 'file',     enabled: false, minMinutes: 0  },
    { type: 'done',     enabled: true,  minMinutes: 0  },
    { type: 'crash',    enabled: true,  minMinutes: 0  },
    { type: 'start',    enabled: false, minMinutes: 0  },
  ],
};

export const RULE_LABELS: Record<NotificationEventType, { label: string; description: string; icon: string }> = {
  question: { label: 'Claude asked me a question',     description: 'e.g. "Which approach should I take?"', icon: '❓' },
  bash:     { label: 'Needs bash permission',           description: 'Claude wants to run a command',         icon: '⏸' },
  file:     { label: 'Needs file permission',           description: 'Claude wants to write or edit a file',  icon: '📄' },
  done:     { label: 'Session completed',               description: 'Overnight work finished',               icon: '✅' },
  crash:    { label: 'Session crashed / interrupted',   description: 'Unexpected exit',                       icon: '💀' },
  start:    { label: 'Session started',                 description: 'Claude Code session opened',            icon: '🚀' },
};

export interface OpenClawChannel {
  id: string;    // 'telegram' | 'whatsapp' | 'discord' | 'slack'
  label: string;
  to: string;    // chat ID / phone number / webhook — pulled from OpenClaw credentials
  enabled: boolean;
}

export interface OpenClawAgent {
  id: string;
  label: string;
}

export interface OpenClawConfig {
  detected: boolean;
  gatewayUrl: string;
  gatewayToken: string;
  channels: OpenClawChannel[];
  hooksReady: boolean; // hooks.enabled=true and distinct token configured
  agents: OpenClawAgent[];
}
