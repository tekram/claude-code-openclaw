'use client';

import { useEffect, useState, useCallback } from 'react';
import type { NotificationPrefs, NotificationRule, NotificationEventType, OpenClawConfig, DeliveryMode } from '@/types/notifications';
import { DEFAULT_PREFS, RULE_LABELS } from '@/types/notifications';

const MIN_OPTIONS = [0, 5, 10, 15, 20, 30, 60];

export function NotificationSettings() {
  const [ocConfig, setOcConfig] = useState<OpenClawConfig | null>(null);
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_PREFS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testState, setTestState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [testError, setTestError] = useState('');
  const [hookSetupState, setHookSetupState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');

  const load = useCallback(async () => {
    const [cfgRes, prefsRes] = await Promise.all([
      fetch('/api/openclaw/config'),
      fetch('/api/notifications/prefs'),
    ]);
    const cfg = await cfgRes.json() as OpenClawConfig;
    const p = await prefsRes.json() as NotificationPrefs;
    setOcConfig(cfg);

    // Auto-populate channel + to from OpenClaw if prefs have no recipient yet, then save
    if (!p.to && cfg.detected && cfg.channels.length > 0) {
      const first = cfg.channels[0];
      const populated = { ...p, channel: first.id, to: first.to };
      setPrefs(populated);
      // Save immediately so the test endpoint and hook can read it
      await fetch('/api/notifications/prefs', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(populated),
      });
    } else {
      setPrefs(p);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = useCallback(async (updated: NotificationPrefs) => {
    setSaving(true);
    await fetch('/api/notifications/prefs', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    });
    setSaving(false);
  }, []);

  const updateRule = useCallback((type: NotificationEventType, patch: Partial<NotificationRule>) => {
    setPrefs(prev => {
      const updated: NotificationPrefs = {
        ...prev,
        rules: prev.rules.map(r => r.type === type ? { ...r, ...patch } : r),
      };
      save(updated);
      return updated;
    });
  }, [save]);

  const setChannel = useCallback((channelId: string) => {
    const channel = ocConfig?.channels.find(c => c.id === channelId);
    setPrefs(prev => {
      const updated = { ...prev, channel: channelId, to: channel?.to || prev.to };
      save(updated);
      return updated;
    });
  }, [ocConfig, save]);

  const setDeliveryMode = useCallback((mode: DeliveryMode) => {
    setPrefs(prev => {
      const updated = { ...prev, deliveryMode: mode };
      save(updated);
      return updated;
    });
  }, [save]);

  const setupHooks = useCallback(async () => {
    setHookSetupState('running');
    const res = await fetch('/api/openclaw/setup-hooks', { method: 'POST' });
    const data = await res.json() as { ok: boolean; alreadyConfigured?: boolean; needsRestart?: boolean; error?: string };
    if (data.ok) {
      setHookSetupState('done');
      // Refresh config so hooksReady updates
      const cfgRes = await fetch('/api/openclaw/config');
      setOcConfig(await cfgRes.json() as OpenClawConfig);
    } else {
      setHookSetupState('error');
      setTestError(data.error || 'Setup failed');
    }
  }, []);

  const sendTest = useCallback(async () => {
    setTestState('sending');
    setTestError('');
    try {
      const res = await fetch('/api/notifications/test', { method: 'POST' });
      const data = await res.json() as { sent: boolean; error?: string };
      if (data.sent) {
        setTestState('sent');
        setTimeout(() => setTestState('idle'), 3000);
      } else {
        setTestState('error');
        setTestError(data.error || 'Unknown error');
      }
    } catch {
      setTestState('error');
      setTestError('Could not reach server');
    }
  }, []);

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  }

  if (!ocConfig?.detected) {
    return (
      <div className="p-6 space-y-3">
        <div className="text-sm font-medium">OpenClaw not detected</div>
        <p className="text-sm text-muted-foreground">
          Notifications require OpenClaw to be installed and configured.
          Claude Dash reads your OpenClaw settings to discover available channels.
        </p>
        <a
          href="https://github.com/tekram/openclaw-ollama-telegram"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-blue-500 hover:underline"
        >
          Set up OpenClaw →
        </a>
      </div>
    );
  }

  const activeChannel = ocConfig.channels.find(c => c.id === prefs.channel);

  return (
    <div className="p-6 space-y-6 max-w-lg">

      {/* Channel selector */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Send notifications to</label>
        {ocConfig.channels.length === 1 ? (
          // Single channel — show as a static pill, no click needed
          <div className="flex items-center gap-2">
            <span className="px-3 py-1.5 rounded-md text-sm border bg-foreground text-background border-foreground">
              {ocConfig.channels[0].label}
            </span>
            {ocConfig.channels[0].to && (
              <span className="text-xs text-muted-foreground font-mono">
                {ocConfig.channels[0].to}
              </span>
            )}
          </div>
        ) : (
          // Multiple channels — show selector
          <div className="flex gap-2 flex-wrap">
            {ocConfig.channels.map(ch => (
              <button
                key={ch.id}
                onClick={() => setChannel(ch.id)}
                className={`px-3 py-1.5 rounded-md text-sm border transition-colors ${
                  prefs.channel === ch.id
                    ? 'bg-foreground text-background border-foreground'
                    : 'border-border hover:border-foreground/40'
                }`}
              >
                {ch.label}
              </button>
            ))}
            {activeChannel?.to && (
              <span className="text-xs text-muted-foreground self-center font-mono">
                → {activeChannel.to}
              </span>
            )}
          </div>
        )}
        <p className="text-xs text-muted-foreground">Pulled from your OpenClaw config</p>
      </div>

      {/* OpenClaw hooks setup banner */}
      {prefs.deliveryMode !== 'direct' && !ocConfig.hooksReady && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 space-y-2">
          <div className="text-sm font-medium text-amber-600 dark:text-amber-400">
            OpenClaw hooks not configured
          </div>
          <p className="text-xs text-muted-foreground">
            The Via OpenClaw delivery mode requires hooks to be enabled in your OpenClaw config with a distinct token.
            Click below to configure it automatically, then restart your OpenClaw gateway.
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={setupHooks}
              disabled={hookSetupState === 'running' || hookSetupState === 'done'}
              className="px-3 py-1.5 text-sm rounded-md border border-amber-500/50 hover:border-amber-500 transition-colors disabled:opacity-50"
            >
              {hookSetupState === 'running' ? 'Configuring…'
                : hookSetupState === 'done' ? 'Done ✓ — restart OpenClaw gateway'
                : 'Configure hooks automatically'}
            </button>
            {hookSetupState === 'error' && (
              <span className="text-xs text-red-500">{testError}</span>
            )}
          </div>
        </div>
      )}

      {/* Delivery mode */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Delivery</label>
        <div className="flex gap-2">
          {([
            {
              id: 'direct' as DeliveryMode,
              label: 'Direct',
              pros: ['Exact message, every time', 'Works if OpenClaw is down', 'Model-independent'],
              cons: ['Not logged in gateway dashboard'],
            },
            {
              id: 'openclaw' as DeliveryMode,
              label: 'Via OpenClaw',
              pros: ['Logged in gateway dashboard', 'Consistent with OpenClaw architecture'],
              cons: ['Message passed through LLM — may vary by model', 'Requires gateway running'],
            },
          ]).map(opt => {
            const active = prefs.deliveryMode === opt.id;
            return (
              <button
                key={opt.id}
                onClick={() => setDeliveryMode(opt.id)}
                className={`flex-1 px-3 py-2.5 rounded-md text-sm border transition-colors text-left ${
                  active
                    ? 'bg-foreground text-background border-foreground'
                    : 'border-border hover:border-foreground/40'
                }`}
              >
                <div className="font-medium mb-1.5">{opt.label}</div>
                <ul className={`text-xs space-y-0.5 ${active ? 'opacity-80' : 'text-muted-foreground'}`}>
                  {opt.pros.map(p => <li key={p}>✓ {p}</li>)}
                  {opt.cons.map(c => <li key={c} className={active ? 'opacity-60' : 'opacity-60'}>✗ {c}</li>)}
                </ul>
              </button>
            );
          })}
        </div>
      </div>

      {/* Notification rules */}
      <div className="space-y-1">
        <label className="text-sm font-medium">When to notify</label>
        <div className="mt-2 space-y-1 rounded-lg border border-border overflow-hidden">
          {prefs.rules.map((rule, i) => {
            const meta = RULE_LABELS[rule.type];
            return (
              <div
                key={rule.type}
                className={`flex items-center gap-3 px-4 py-3 ${
                  i < prefs.rules.length - 1 ? 'border-b border-border' : ''
                } ${rule.enabled ? '' : 'opacity-50'}`}
              >
                {/* Toggle */}
                <button
                  onClick={() => updateRule(rule.type, { enabled: !rule.enabled })}
                  className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${
                    rule.enabled ? 'bg-foreground' : 'bg-muted'
                  }`}
                  aria-label={rule.enabled ? 'Disable' : 'Enable'}
                >
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-background transition-transform ${
                    rule.enabled ? 'translate-x-4' : 'translate-x-0'
                  }`} />
                </button>

                {/* Icon + label */}
                <div className="flex-1 min-w-0">
                  <div className="text-sm">
                    <span className="mr-1.5">{meta.icon}</span>
                    {meta.label}
                  </div>
                  <div className="text-xs text-muted-foreground">{meta.description}</div>
                </div>

                {/* Delay selector */}
                {rule.enabled && (
                  <select
                    value={rule.minMinutes}
                    onChange={e => updateRule(rule.type, { minMinutes: Number(e.target.value) })}
                    className="text-xs border border-border rounded px-2 py-1 bg-background flex-shrink-0"
                  >
                    {MIN_OPTIONS.map(m => (
                      <option key={m} value={m}>
                        {m === 0 ? 'immediately' : `after ${m} min`}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Test notification */}
      <div className="flex items-center gap-3">
        <button
          onClick={sendTest}
          disabled={testState === 'sending'}
          className="px-4 py-2 text-sm rounded-md border border-border hover:border-foreground/40 transition-colors disabled:opacity-50"
        >
          {testState === 'sending' ? 'Sending…' : 'Send test notification'}
        </button>
        {testState === 'sent' && (
          <span className="text-sm text-green-600">Sent ✓</span>
        )}
        {testState === 'error' && (
          <span className="text-sm text-red-500">{testError}</span>
        )}
        {saving && (
          <span className="text-xs text-muted-foreground ml-auto">Saving…</span>
        )}
      </div>
    </div>
  );
}
