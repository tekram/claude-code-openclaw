'use client';

import { useState, useEffect } from 'react';
import { Plus, Trash2, FolderOpen } from 'lucide-react';

interface ProjectSettings {
  projects: Record<string, string>;
  defaultProjectPath?: string;
}

export const ProjectSettings = () => {
  const [projects, setProjects] = useState<Record<string, string>>({});
  const [defaultProjectPath, setDefaultProjectPath] = useState('');
  const [defaultPathDraft, setDefaultPathDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingDefault, setSavingDefault] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPath, setNewPath] = useState('');
  const [addError, setAddError] = useState('');
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editPath, setEditPath] = useState('');

  useEffect(() => {
    fetch('/api/settings/projects')
      .then((r) => r.ok ? r.json() as Promise<ProjectSettings> : null)
      .then((data) => {
        if (data?.projects) setProjects(data.projects);
        const dp = data?.defaultProjectPath ?? '';
        setDefaultProjectPath(dp);
        setDefaultPathDraft(dp);
      })
      .catch(() => {/* ignore */})
      .finally(() => setLoading(false));
  }, []);

  const save = async (updated: Record<string, string>) => {
    setSaving(true);
    try {
      const res = await fetch('/api/settings/projects', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projects: updated, defaultProjectPath }),
      });
      if (res.ok) {
        const data = await res.json() as ProjectSettings;
        setProjects(data.projects);
      }
    } catch (err) {
      console.error('Failed to save project settings:', err);
    } finally {
      setSaving(false);
    }
  };

  const saveDefaultPath = async () => {
    setSavingDefault(true);
    try {
      const res = await fetch('/api/settings/projects', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projects, defaultProjectPath: defaultPathDraft.trim() }),
      });
      if (res.ok) {
        const data = await res.json() as ProjectSettings;
        const dp = data.defaultProjectPath ?? '';
        setDefaultProjectPath(dp);
        setDefaultPathDraft(dp);
      }
    } catch (err) {
      console.error('Failed to save default path:', err);
    } finally {
      setSavingDefault(false);
    }
  };

  const handleAdd = async () => {
    const name = newName.trim();
    const p = newPath.trim();
    if (!name || !p) { setAddError('Both name and path are required'); return; }
    if (projects[name] !== undefined) { setAddError(`"${name}" already exists`); return; }
    setAddError('');
    const updated = { ...projects, [name]: p };
    await save(updated);
    setNewName('');
    setNewPath('');
  };

  const handleRemove = async (name: string) => {
    const updated = { ...projects };
    delete updated[name];
    await save(updated);
  };

  const startEdit = (name: string) => {
    setEditingKey(name);
    setEditPath(projects[name]);
  };

  const commitEdit = async (name: string) => {
    const p = editPath.trim();
    if (!p) return;
    const updated = { ...projects, [name]: p };
    await save(updated);
    setEditingKey(null);
  };

  if (loading) {
    return <p className="text-xs text-muted-foreground px-4 py-2">Loading...</p>;
  }

  const entries = Object.entries(projects);

  return (
    <div className="space-y-3 px-4 py-3">
      {/* Default project path */}
      <div>
        <label className="block text-xs text-muted-foreground mb-1">Default project path</label>
        <div className="flex gap-2">
          <input
            type="text"
            className="ui-input flex-1 rounded px-2.5 py-1.5 text-xs font-mono"
            placeholder="C:\Users\yourname\my-project"
            value={defaultPathDraft}
            onChange={(e) => setDefaultPathDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') saveDefaultPath(); }}
          />
          <button
            type="button"
            className="ui-btn-primary px-2.5 py-1.5 text-xs"
            onClick={saveDefaultPath}
            disabled={savingDefault || defaultPathDraft.trim() === defaultProjectPath}
          >
            {savingDefault ? 'Saving…' : 'Save'}
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground mt-1">
          Pre-fills the path field when dispatching a capture to Claude Code with no project tag match.
        </p>
      </div>

      <div className="border-t border-border/50 pt-3">
        <p className="text-xs font-medium text-muted-foreground mb-2">Per-project paths</p>
      </div>

      {entries.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No project paths configured. Add one below to enable Claude Code dispatch.
        </p>
      )}

      {entries.length > 0 && (
        <div className="rounded-md border border-border overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-3 py-2 font-medium text-muted-foreground w-1/3">Project</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Path</th>
                <th className="w-16" />
              </tr>
            </thead>
            <tbody>
              {entries.map(([name, p]) => (
                <tr key={name} className="border-b border-border last:border-0 hover:bg-muted/20 transition">
                  <td className="px-3 py-2 font-mono">{name}</td>
                  <td className="px-3 py-2">
                    {editingKey === name ? (
                      <input
                        type="text"
                        className="ui-input w-full rounded px-2 py-1 text-xs font-mono"
                        value={editPath}
                        onChange={(e) => setEditPath(e.target.value)}
                        onBlur={() => commitEdit(name)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitEdit(name);
                          if (e.key === 'Escape') setEditingKey(null);
                        }}
                        autoFocus
                      />
                    ) : (
                      <button
                        type="button"
                        className="font-mono text-left w-full hover:text-primary transition truncate"
                        onClick={() => startEdit(name)}
                        title="Click to edit"
                      >
                        {p}
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-destructive transition"
                      onClick={() => handleRemove(name)}
                      disabled={saving}
                      title="Remove"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add new project */}
      <div className="flex gap-2 items-start">
        <div className="flex flex-col gap-1.5 flex-1">
          <input
            type="text"
            className="ui-input rounded px-2.5 py-1.5 text-xs"
            placeholder="Project name (e.g. claude-dash)"
            value={newName}
            onChange={(e) => { setNewName(e.target.value); setAddError(''); }}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
          />
          <input
            type="text"
            className="ui-input rounded px-2.5 py-1.5 text-xs font-mono"
            placeholder="Absolute path (e.g. C:\Users\yourname\my-project)"
            value={newPath}
            onChange={(e) => { setNewPath(e.target.value); setAddError(''); }}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
          />
          {addError && <p className="text-xs text-destructive">{addError}</p>}
        </div>
        <button
          type="button"
          className="ui-btn-primary px-2.5 py-1.5 text-xs flex items-center gap-1 mt-0.5"
          onClick={handleAdd}
          disabled={saving || !newName.trim() || !newPath.trim()}
        >
          <Plus className="w-3.5 h-3.5" />
          Add
        </button>
      </div>

      <p className="text-[10px] text-muted-foreground flex items-center gap-1">
        <FolderOpen className="w-3 h-3" />
        Paths are used to run <code className="bg-muted px-1 rounded">claude -p</code> in the correct directory.
      </p>
    </div>
  );
};
