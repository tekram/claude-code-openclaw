'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { SessionsPanel } from '@/components/SessionsPanel';
import { CapturesPanel } from '@/components/CapturesPanel';
import { TasksPanel } from '@/components/TasksPanel';
import { ThemeToggle } from '@/components/ThemeToggle';

const MIN_RIGHT_WIDTH = 280;
const MAX_RIGHT_WIDTH = 600;
const DEFAULT_RIGHT_WIDTH = 380;

const MIN_TASKS_HEIGHT = 44;   // just the header row
const MAX_TASKS_HEIGHT = 500;
const DEFAULT_TASKS_HEIGHT = 220;

function clamp(val: number, min: number, max: number) {
  return Math.min(max, Math.max(min, val));
}

export function DashboardLayout() {
  const [rightWidth, setRightWidth] = useState(DEFAULT_RIGHT_WIDTH);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [tasksHeight, setTasksHeight] = useState(DEFAULT_TASKS_HEIGHT);
  const [hasTasks, setHasTasks] = useState(false);

  // Horizontal drag (left/right split)
  const hDragging = useRef(false);
  const hDragStartX = useRef(0);
  const hDragStartWidth = useRef(DEFAULT_RIGHT_WIDTH);

  // Vertical drag (tasks/captures split)
  const vDragging = useRef(false);
  const vDragStartY = useRef(0);
  const vDragStartHeight = useRef(DEFAULT_TASKS_HEIGHT);

  // Load persisted layout
  useEffect(() => {
    const savedRightWidth = localStorage.getItem('right-panel-width');
    const savedCollapsed = localStorage.getItem('right-panel-collapsed');
    const savedTasksHeight = localStorage.getItem('tasks-panel-height');
    if (savedRightWidth) setRightWidth(clamp(Number(savedRightWidth), MIN_RIGHT_WIDTH, MAX_RIGHT_WIDTH));
    if (savedCollapsed) setRightCollapsed(savedCollapsed === 'true');
    if (savedTasksHeight) setTasksHeight(clamp(Number(savedTasksHeight), MIN_TASKS_HEIGHT, MAX_TASKS_HEIGHT));
  }, []);

  // Shared document-level mouse handlers for both drag axes
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (hDragging.current) {
        const delta = hDragStartX.current - e.clientX;
        setRightWidth(clamp(hDragStartWidth.current + delta, MIN_RIGHT_WIDTH, MAX_RIGHT_WIDTH));
      }
      if (vDragging.current) {
        const delta = e.clientY - vDragStartY.current;
        setTasksHeight(clamp(vDragStartHeight.current + delta, MIN_TASKS_HEIGHT, MAX_TASKS_HEIGHT));
      }
    };

    const onMouseUp = (e: MouseEvent) => {
      if (hDragging.current) {
        hDragging.current = false;
        const finalWidth = clamp(hDragStartWidth.current + (hDragStartX.current - e.clientX), MIN_RIGHT_WIDTH, MAX_RIGHT_WIDTH);
        localStorage.setItem('right-panel-width', String(finalWidth));
      }
      if (vDragging.current) {
        vDragging.current = false;
        const finalHeight = clamp(vDragStartHeight.current + (e.clientY - vDragStartY.current), MIN_TASKS_HEIGHT, MAX_TASKS_HEIGHT);
        localStorage.setItem('tasks-panel-height', String(finalHeight));
      }
      if (!hDragging.current && !vDragging.current) {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  const handleHorizontalMouseDown = useCallback((e: React.MouseEvent) => {
    if (rightCollapsed) return;
    hDragging.current = true;
    hDragStartX.current = e.clientX;
    hDragStartWidth.current = rightWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  }, [rightWidth, rightCollapsed]);

  const handleVerticalMouseDown = useCallback((e: React.MouseEvent) => {
    vDragging.current = true;
    vDragStartY.current = e.clientY;
    vDragStartHeight.current = tasksHeight;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  }, [tasksHeight]);

  const toggleCollapsed = useCallback(() => {
    setRightCollapsed((c) => {
      const next = !c;
      localStorage.setItem('right-panel-collapsed', String(next));
      return next;
    });
  }, []);

  const handleHasTasks = useCallback((has: boolean) => {
    setHasTasks(has);
  }, []);

  return (
    <main className="h-screen flex overflow-hidden">
      {/* Sessions panel */}
      <div className="flex-1 min-w-0 overflow-hidden flex flex-col">
        <div className="flex-shrink-0 px-5 py-3 border-b border-border bg-card/50 flex items-center justify-between">
          <h1 className="text-sm font-semibold tracking-tight">Claude Code Sessions</h1>
          <div className="flex items-center gap-3">
            <Link href="/insights" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              Insights
            </Link>
            <Link href="/stats" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              Stats
            </Link>
            <Link href="/history" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              History
            </Link>
            <Link href="/settings" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              Settings
            </Link>
            <ThemeToggle />
          </div>
        </div>
        <div className="flex-1 overflow-hidden">
          <SessionsPanel />
        </div>
      </div>

      {/* Horizontal drag divider (left/right split) */}
      <div
        className={`relative flex-shrink-0 w-[5px] border-x border-border/60 transition-colors group select-none ${
          rightCollapsed ? 'cursor-default' : 'cursor-col-resize hover:bg-primary/20'
        }`}
        onMouseDown={handleHorizontalMouseDown}
      >
        {/* Collapse/expand toggle */}
        <button
          type="button"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={toggleCollapsed}
          className={`absolute top-3 left-1/2 -translate-x-1/2 p-0.5 rounded bg-card border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors z-10 ${
            rightCollapsed ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
          title={rightCollapsed ? 'Expand right panel' : 'Collapse right panel'}
        >
          {rightCollapsed
            ? <ChevronLeft className="w-3 h-3" />
            : <ChevronRight className="w-3 h-3" />
          }
        </button>
      </div>

      {/* Right column */}
      {!rightCollapsed && (
        <div
          className="flex-shrink-0 overflow-hidden flex flex-col"
          style={{ width: rightWidth }}
        >
          {/* Tasks section — height-controlled, always mounted for polling */}
          <div
            className="flex-shrink-0 overflow-hidden border-b border-border"
            style={{ height: hasTasks ? tasksHeight : 0 }}
          >
            <TasksPanel onHasTasks={handleHasTasks} />
          </div>

          {/* Vertical drag divider (tasks/captures split) — only when tasks exist */}
          {hasTasks && (
            <div
              className="flex-shrink-0 h-[5px] border-y border-border/60 cursor-row-resize hover:bg-primary/20 select-none transition-colors"
              onMouseDown={handleVerticalMouseDown}
            />
          )}

          {/* Captures section */}
          <div className="flex-1 overflow-hidden flex flex-col min-h-0">
            <div className="flex-shrink-0 px-5 py-3 border-b border-border bg-card/50">
              <h1 className="text-sm font-semibold tracking-tight">Captures</h1>
            </div>
            <div className="flex-1 overflow-hidden">
              <CapturesPanel />
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
