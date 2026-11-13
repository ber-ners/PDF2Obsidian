'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { LinkedPdfViewer, type BlockSelection } from './LinkedPdfViewer';
import { LinkedMarkdown } from './LinkedMarkdown';
import type { LinkedBilingualSegment } from '../lib/bilingual-links';
import type { PdfBlock } from '../lib/pdf-blocks';
import { SettingsWorkspace, type SettingsConfigResponse } from './SettingsWorkspace';
import { BilingualMarkdown } from './BilingualMarkdown';
import { ReaderSplit } from './ReaderSplit';
import { MarkdownPreview } from './MarkdownPreview';
import { MetadataView } from './MetadataView';
import { ThemeToggle } from './ThemeToggle';
import { FlowchartPanel } from './FlowchartPanel';

const RAIL_WIDTH_STORAGE_KEY = 'pdf2obsidian.rail.width';
const RAIL_DEFAULT_WIDTH = 260;
const RAIL_MIN_WIDTH = 210;
const RAIL_MAX_WIDTH = 400;

type TaskStatus = 'queued' | 'running' | 'completed' | 'failed';
type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
type ArtifactKind = 'original' | 'translated' | 'bilingual' | 'index' | 'database' | 'summary' | 'terms' | 'qa' | 'workflow';
type OutputViewKind = 'original' | 'translated' | 'workflow' | 'reading' | 'metadata' | 'database';
type ReadingKind = 'summary' | 'terms' | 'qa';

type ConfigResponse = SettingsConfigResponse;

interface LocalTaskStep {
  step: string;
  status: StepStatus;
  message?: string;
}

interface LocalTask {
  id: string;
  fileName: string;
  pdfPath: string;
  status: TaskStatus;
  progress: number;
  createdAt?: string;
  updatedAt?: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  result?: {
    slug: string;
    originalNotePath?: string;
    translatedNotePath: string;
    indexNotePath: string;
    databaseNotePath?: string;
    configSummary?: {
      mineruMode: string;
      mineruBackend: string;
      translationEnabled: boolean;
      translationSkipped?: boolean;
      translationProvider?: string;
      translationModel?: string;
      readingAssetsEnabled?: boolean;
    };
  };
  steps: LocalTaskStep[];
  logs: string[];
}

interface ArtifactState {
  taskId: string;
  segments?: LinkedBilingualSegment[];
  linkMessage?: string;
  kind: ArtifactKind;
  view: OutputViewKind;
  path?: string;
  content?: string;
  error?: string;
}

const stepLabels: Record<string, string> = {
  upload: '读取论文',
  mineru: '提取内容',
  normalize: '整理结构',
  translate: '生成译文',
  obsidian_export: '写入笔记',
  quality_check: '质量检查'
};

// Polling re-fetches the task list every 1.8s. Keeping the previous array when nothing
// changed stops React from re-rendering the whole reader (and re-parsing its Markdown).
function taskFingerprint(task: LocalTask): string {
  return JSON.stringify([
    task.id, task.status, task.progress, task.updatedAt, task.error,
    task.steps.map((step) => [step.step, step.status, step.message]),
    task.logs.length
  ]);
}

function sameTaskList(previous: LocalTask[], next: LocalTask[]): boolean {
  if (previous === next) return true;
  if (previous.length !== next.length) return false;
  return previous.every((task, index) => taskFingerprint(task) === taskFingerprint(next[index]));
}

const outputViews: Array<{ kind: OutputViewKind; label: string; source: ArtifactKind }> = [
  { kind: 'original', label: '原文', source: 'original' },
  { kind: 'translated', label: '中英对照', source: 'bilingual' },
  { kind: 'workflow', label: '阅读图解', source: 'workflow' },
  { kind: 'reading', label: '阅读材料', source: 'summary' },
  { kind: 'metadata', label: '论文信息', source: 'index' }
];

const readingViews: Array<{ kind: ReadingKind; label: string; desc: string }> = [
  { kind: 'summary', label: '摘要', desc: '核心观点' },
  { kind: 'terms', label: '术语表', desc: '关键概念' },
  { kind: 'qa', label: '问答', desc: '复习问题' }
];

export function LocalWorkspace() {
  const [config, setConfig] = useState<ConfigResponse | undefined>();
  const [tasks, setTasks] = useState<LocalTask[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | undefined>();
  const [artifact, setArtifact] = useState<ArtifactState | undefined>();
  const [activeView, setActiveView] = useState<OutputViewKind>('translated');
  const [readingKind, setReadingKind] = useState<ReadingKind>('summary');
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const uploading = useRef(false);
  const [message, setMessage] = useState<string | undefined>();
  const [actionMessage, setActionMessage] = useState<string | undefined>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [layout, setLayout] = useState<{ taskId: string; blocks: PdfBlock[]; message?: string }>();
  const [selection, setSelection] = useState<BlockSelection>();
  const [urlInput, setUrlInput] = useState('');
  const [urlBusy, setUrlBusy] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [railWidth, setRailWidth] = useState(RAIL_DEFAULT_WIDTH);
  const [railResizing, setRailResizing] = useState(false);
  const railWidthRef = useRef(RAIL_DEFAULT_WIDTH);

  function updateRailWidth(next: number, persist = false) {
    const clamped = Math.max(RAIL_MIN_WIDTH, Math.min(RAIL_MAX_WIDTH, Math.round(next)));
    railWidthRef.current = clamped;
    setRailWidth(clamped);
    if (persist) {
      try { window.localStorage.setItem(RAIL_WIDTH_STORAGE_KEY, String(clamped)); } catch { /* Storage is optional */ }
    }
  }

  useEffect(() => {
    try {
      const saved = Number(window.localStorage.getItem(RAIL_WIDTH_STORAGE_KEY));
      if (saved >= RAIL_MIN_WIDTH && saved <= RAIL_MAX_WIDTH) {
        railWidthRef.current = saved;
        setRailWidth(saved);
      }
    } catch { /* Ignore storage access errors */ }
  }, []);

  const selectedTask = useMemo(() => {
    return tasks.find((task) => task.id === selectedTaskId) ?? tasks[0];
  }, [selectedTaskId, tasks]);
  const selectedTaskHasOutput = Boolean(selectedTask?.result);
  const translationSkipped = selectedTask?.result?.configSummary?.translationSkipped === true;
  const visibleOutputViews = useMemo(() => {
    return outputViews.filter((view) => {
      if (view.kind === 'database' && !selectedTask?.result?.databaseNotePath) return false;
      if (view.kind === 'reading' && selectedTask?.result?.configSummary?.readingAssetsEnabled === false) return false;
      return true;
    });
  }, [selectedTask?.result?.configSummary?.readingAssetsEnabled]);

  useEffect(() => {
    void refreshConfig();
    void refreshTasks();
  }, []);

  useEffect(() => {
    if (!config) return;
    if (config.valid && config.exists) return;

    const completed =
      window.localStorage.getItem('pdf2obsidian.settings.configured') === 'true' ||
      window.localStorage.getItem('pdf2obsidian.onboarding.completed') === 'true';
    const dismissed =
      window.localStorage.getItem('pdf2obsidian.settings.dismissed') === 'true' ||
      window.localStorage.getItem('pdf2obsidian.onboarding.dismissed') === 'true';
    if (!completed && !dismissed) {
      setSettingsOpen(true);
    }
  }, [config]);

  function openSettings() {
    window.localStorage.removeItem('pdf2obsidian.settings.dismissed');
    window.localStorage.removeItem('pdf2obsidian.onboarding.dismissed');
    setSettingsOpen(true);
  }

  // Only poll while a task is actually running; an idle workbench must not re-render
  // the (multi-thousand-node) Markdown reader every couple of seconds.
  const hasActiveTask = tasks.some((task) => task.status === 'running' || task.status === 'queued');
  useEffect(() => {
    if (!hasActiveTask) return;
    const timer = window.setInterval(() => {
      void refreshTasks();
    }, 1800);
    return () => window.clearInterval(timer);
  }, [hasActiveTask]);

  useEffect(() => {
    if (selectedTaskHasOutput) {
      setActiveView('translated');
      setReadingKind('summary');
      if (selectedTask) void loadArtifact(selectedTask.id, 'bilingual', 'translated');
    } else {
      setArtifact(undefined);
    }
  }, [selectedTask?.id, selectedTaskHasOutput, translationSkipped]);

  useEffect(() => {
    setLayout(undefined);
    setSelection(undefined);
    if (!selectedTask?.result) return;
    const controller = new AbortController();
    const taskId = selectedTask.id;
    void fetch(`/api/tasks/${taskId}/layout`, { signal: controller.signal, cache: 'no-store' })
      .then((response) => response.json())
      .then((payload) => { if (!controller.signal.aborted) setLayout({ taskId, ...payload }); })
      .catch(() => { if (!controller.signal.aborted) setLayout({ taskId, blocks: [], message: '区块数据加载失败，可切换任务重试。' }); });
    return () => controller.abort();
  }, [selectedTask?.id, selectedTaskHasOutput]);

  const linkedBlocks = layout?.taskId === selectedTask?.id ? layout?.blocks ?? [] : [];
  const selectBlock = useCallback((id: string, source: BlockSelection['source']) => {
    setSelection((previous) => ({ id, source, sequence: (previous?.sequence ?? 0) + 1 }));
    if (source === 'pdf' && activeView !== 'translated') setActiveView('original');
  }, [activeView]);

  async function refreshConfig() {
    const response = await fetch('/api/config', { cache: 'no-store' });
    setConfig(await response.json() as ConfigResponse);
  }

  async function refreshTasks() {
    const response = await fetch('/api/tasks', { cache: 'no-store' });
    const payload = await response.json() as { tasks: LocalTask[] };
    const nextTasks = payload.tasks;
    setTasks((previous) => sameTaskList(previous, nextTasks) ? previous : nextTasks);
    setSelectedTaskId((current) => {
      if (current && payload.tasks.some((task) => task.id === current)) return current;
      return payload.tasks[0]?.id;
    });
  }

  function selectPdf(files: FileList | File[]) {
    if (uploading.current || !config?.valid) return;
    if (files.length !== 1) {
      setMessage('请每次拖入一个 PDF 文件。');
      return;
    }
    const file = files[0];
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setMessage('仅支持 PDF 文件，请选择或拖入 .pdf 文件。');
      return;
    }
    const formData = new FormData();
    formData.set('file', file);
    void uploadPdf(formData);
  }

  async function uploadPdf(formData: FormData) {
    uploading.current = true;
    setBusy(true);
    setMessage(undefined);
    try {
      const response = await fetch('/api/tasks', { method: 'POST', body: formData });
      const payload = await response.json() as { task?: LocalTask; error?: string };
      if (!response.ok || !payload.task) {
        setMessage(payload.error ?? '上传失败');
        return;
      }
      setSelectedTaskId(payload.task.id);
      await refreshTasks();
      setMessage('任务已创建');
    } catch {
      setMessage('上传失败，请检查工作台连接后重试。');
    } finally {
      uploading.current = false;
      setBusy(false);
    }
  }

  async function importFromUrl() {
    const url = urlInput.trim();
    if (!url) return;
    setUrlBusy(true);
    setMessage(undefined);
    try {
      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
      const payload = await response.json() as { task?: LocalTask; error?: string };
      if (!response.ok || !payload.task) {
        setMessage(payload.error ?? '导入失败');
        return;
      }
      setUrlInput('');
      setSelectedTaskId(payload.task.id);
      await refreshTasks();
      setMessage('任务已创建');
    } finally {
      setUrlBusy(false);
    }
  }

  const artifactRequest = useRef(0);

  async function loadArtifact(taskId: string, kind: ArtifactKind, view: OutputViewKind) {
    const requestId = ++artifactRequest.current;
    const response = await fetch(`/api/tasks/${taskId}/artifact?kind=${kind}`, { cache: 'no-store' });
    const payload = await response.json() as Omit<ArtifactState, 'taskId' | 'kind' | 'view'>;
    if (requestId === artifactRequest.current) setArtifact({ ...payload, taskId, kind, view });
  }

  async function selectOutputView(view: OutputViewKind) {
    if (!selectedTask) return;
    const outputView = visibleOutputViews.find((item) => item.kind === view);
    if (!outputView) return;
    setActiveView(view);
    const source = view === 'reading' ? readingKind : outputView.source;
    await loadArtifact(selectedTask.id, source, view);
  }

  async function selectReadingView(kind: ReadingKind) {
    if (!selectedTask) return;
    setReadingKind(kind);
    setActiveView('reading');
    await loadArtifact(selectedTask.id, kind, 'reading');
  }

  async function deleteTask(task: LocalTask) {
    const confirmed = window.confirm('删除后会移除本地任务记录和上传的 PDF，不会删除已经生成的本地文件。确定删除吗？');
    if (!confirmed) return;
    setActionMessage(undefined);
    const response = await fetch(`/api/tasks/${task.id}`, { method: 'DELETE' });
    const payload = await response.json() as { error?: string };
    if (!response.ok) {
      setActionMessage(payload.error ?? '删除失败');
      return;
    }
    setArtifact(undefined);
    await refreshTasks();
    setActionMessage('任务已删除');
  }

  async function retryTask(task: LocalTask) {
    setActionMessage(undefined);
    const response = await fetch(`/api/tasks/${task.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'retry' })
    });
    const payload = await response.json() as { task?: LocalTask; error?: string };
    if (!response.ok || !payload.task) {
      setActionMessage(payload.error ?? '重试失败');
      return;
    }
    setSelectedTaskId(payload.task.id);
    await refreshTasks();
    setActionMessage('任务已重新开始');
  }

  const hasOutput = selectedTaskHasOutput;
  const currentArtifact = artifact
    && artifact.taskId === selectedTask?.id
    && artifact.view === activeView
    && (activeView !== 'reading' || artifact.kind === readingKind)
    ? artifact
    : undefined;
  const taskSummary = getTaskSummary(tasks);
  const activeStep = selectedTask?.steps.find((step) => step.status === 'running')
    ?? selectedTask?.steps.find((step) => step.status === 'failed')
    ?? selectedTask?.steps.find((step) => step.status === 'pending');
  const currentStatusText = selectedTask
    ? activeStep && selectedTask.status !== 'completed' ? `${stepLabels[activeStep.step] ?? activeStep.step} ${formatStepStatus(activeStep.status)}` : undefined
    : undefined;

  const railToggleButton = (
    <button
      className="icon-link rail-toggle"
      type="button"
      aria-controls="workspace-task-rail"
      aria-expanded={!railCollapsed}
      title={railCollapsed ? '展开左侧任务栏' : '收起左侧任务栏'}
      onClick={() => setRailCollapsed((collapsed) => !collapsed)}
    >
      <span aria-hidden="true">{railCollapsed ? '◧' : '◧'}</span>
      <span>{railCollapsed ? '展开侧栏' : '收起侧栏'}</span>
    </button>
  );

  return (
    <main
      className="app-shell"
      data-with-output={hasOutput ? 'true' : 'false'}
      data-rail-collapsed={railCollapsed}
      data-rail-resizing={railResizing}
      style={{ '--rail-width': `${railWidth}px` } as CSSProperties}
    >
      <aside className="left-rail glass-panel" id="workspace-task-rail" hidden={railCollapsed}>
        <div className="rail-header">
          <h1>PDF2Obsidian</h1>
          <div className="rail-actions">
            <ThemeToggle />
            <button className="icon-link" type="button" onClick={openSettings} title="设置">设置</button>
          </div>
        </div>

        <div className="rail-section-title">
          <span>导入</span>
        </div>

        <div className="upload-zone">
          <label
            className="upload-card glass-card"
            data-dragging={dragging && !busy && config?.valid ? 'true' : 'false'}
            onDragEnter={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (!event.dataTransfer.types.includes('Files')) return;
              dragDepth.current += 1;
              if (!uploading.current && config?.valid) setDragging(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.stopPropagation();
              event.dataTransfer.dropEffect = uploading.current || !config?.valid ? 'none' : 'copy';
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              event.stopPropagation();
              dragDepth.current = Math.max(0, dragDepth.current - 1);
              if (dragDepth.current === 0) setDragging(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              event.stopPropagation();
              dragDepth.current = 0;
              setDragging(false);
              selectPdf(event.dataTransfer.files);
            }}
          >
            <span className="upload-icon" aria-hidden="true">＋</span>
            <div className="upload-text">
              <strong>{busy ? '上传中...' : dragging && config?.valid ? '松开即可上传 PDF' : config?.valid ? '选择或拖入 PDF' : '先完成设置'}</strong>
              <span role="status">{message || (config?.valid ? '支持单篇 PDF 本地解析' : '配置解析服务后即可上传')}</span>
            </div>
            <input
              accept="application/pdf,.pdf"
              disabled={busy || !config?.valid}
              name="file"
              type="file"
              onChange={(event) => {
                const files = event.currentTarget.files;
                if (files?.length) selectPdf(files);
                event.currentTarget.value = '';
              }}
            />
          </label>

          <div className="url-import">
            <input
              className="url-input"
              disabled={urlBusy || !config?.valid}
              placeholder="arXiv ID、DOI 或 PDF 链接"
              type="text"
              value={urlInput}
              onChange={(event) => setUrlInput(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void importFromUrl();
              }}
            />
            <button
              className="url-submit"
              disabled={urlBusy || !config?.valid || !urlInput.trim()}
              type="button"
              onClick={() => void importFromUrl()}
            >
              {urlBusy ? '导入中' : '导入'}
            </button>
          </div>
        </div>

        {!config?.valid ? (
          <div className="setup-warning glass-card">
            <strong>配置未完成</strong>
            {config?.error ? <small>{config.error}</small> : <small>完成设置后即可上传 PDF。</small>}
            <div className="setup-actions">
              <button type="button" onClick={openSettings}>打开设置</button>
            </div>
          </div>
        ) : null}

        <div className="rail-section-title">
          <span>
            文稿
            <small className="rail-count">
              {taskSummary.running > 0 ? `${taskSummary.running} 处理中 · ` : ''}
              {taskSummary.total}
            </small>
          </span>
          <button type="button" onClick={() => void refreshTasks()}>刷新</button>
        </div>
        {actionMessage ? <p className="rail-message">{actionMessage}</p> : null}

        <div className="task-list" role="list">
          {tasks.length === 0 ? <p className="empty">暂无解析任务</p> : null}
          {tasks.map((task) => {
            const isRunning = task.status === 'running' || task.status === 'queued';
            return (
              <div
                className="task-item glass-card"
                data-active={selectedTask?.id === task.id ? 'true' : 'false'}
                data-status={task.status}
                key={task.id}
                role="listitem"
              >
                <button
                  className="task-card"
                  type="button"
                  onClick={() => setSelectedTaskId(task.id)}
                >
                  <div className="task-title-row">
                    <span className="task-dot" aria-hidden="true" />
                    <span className="task-filename" title={task.fileName}>{task.fileName}</span>
                  </div>
                  <p className="task-meta">{getTaskHint(task)}</p>
                  {isRunning ? (
                    <div className="mini-progress"><span style={{ width: `${task.progress}%` }} /></div>
                  ) : null}
                </button>
                {canRetryTask(task) || canDeleteTask(task) ? (
                  <div className="task-actions">
                    {canRetryTask(task) ? (
                      <button className="mini-action" type="button" title="重试任务" onClick={() => void retryTask(task)}>
                        重试
                      </button>
                    ) : null}
                    {canDeleteTask(task) ? (
                      <button className="mini-action danger" type="button" title="删除任务" onClick={() => void deleteTask(task)}>
                        删除
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </aside>

      <div
        className="rail-divider"
        role="separator"
        tabIndex={railCollapsed ? -1 : 0}
        hidden={railCollapsed}
        aria-label="调整左侧任务栏宽度"
        aria-orientation="vertical"
        aria-valuemin={RAIL_MIN_WIDTH}
        aria-valuemax={RAIL_MAX_WIDTH}
        aria-valuenow={railWidth}
        title="拖动调整侧栏宽度；双击恢复默认宽度"
        onDoubleClick={() => updateRailWidth(RAIL_DEFAULT_WIDTH, true)}
        onKeyDown={(event) => {
          const next = event.key === 'ArrowLeft' ? railWidthRef.current - 12
            : event.key === 'ArrowRight' ? railWidthRef.current + 12
            : event.key === 'Enter' ? RAIL_DEFAULT_WIDTH : undefined;
          if (next === undefined) return;
          event.preventDefault();
          updateRailWidth(next, true);
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          setRailResizing(true);
        }}
        onPointerMove={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
          updateRailWidth(event.clientX);
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
          updateRailWidth(railWidthRef.current, true);
          setRailResizing(false);
        }}
        onLostPointerCapture={() => setRailResizing(false)}
        onPointerCancel={() => setRailResizing(false)}
      >
        <span />
      </div>

      <ReaderSplit>
        <section className="preview-pane" data-with-output={hasOutput ? 'true' : 'false'}>
          {selectedTask ? (
            <LinkedPdfViewer
              key={selectedTask.id}
              taskId={selectedTask.id}
              fileName={selectedTask.fileName}
              leadingAction={railToggleButton}
              blocks={linkedBlocks}
              selection={selection}
              onSelect={selectBlock}
            />
          ) : (
            <>
              <div className="pane-header glass-toolbar">
                <div className="pane-actions">{railToggleButton}</div>
              </div>
              <div className="empty-pane">
                <strong>从左侧上传一篇 PDF</strong>
                <span>上传后会在这里预览原文件，并在右侧显示生成结果。</span>
              </div>
            </>
          )}
        </section>

        {hasOutput ? (
          <section className="output-pane">
            <div className="artifact-tabs glass-toolbar">
              <div className="segmented-track" role="tablist" aria-label="输出视图">
                {visibleOutputViews.map((item) => (
                  <button
                    role="tab"
                    aria-selected={activeView === item.kind}
                    aria-label={`查看${item.label}`}
                    className="tab-button"
                    data-active={activeView === item.kind ? 'true' : 'false'}
                    key={item.kind}
                    type="button"
                    onClick={() => void selectOutputView(item.kind)}
                  >
                    {item.kind === 'translated' && translationSkipped ? '正文' : item.label}
                  </button>
                ))}
              </div>
              {selectedTask && selectedTask.status !== 'completed' ? (
                <div className="output-toolbar-meta">
                  <CompactStatus task={selectedTask} text={currentStatusText} />
                </div>
              ) : null}
              {activeView === 'reading' ? (
                <div className="reading-switcher" role="tablist" aria-label="阅读材料类型">
                  {readingViews.map((item) => (
                    <button
                      role="tab"
                      aria-selected={readingKind === item.kind}
                      className="reading-button"
                      data-active={readingKind === item.kind ? 'true' : 'false'}
                      key={item.kind}
                      type="button"
                      title={item.desc}
                      onClick={() => void selectReadingView(item.kind)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            {currentArtifact?.error ? <p className="error-text">{currentArtifact.error}</p> : null}
            {activeView === 'original' && layout?.message ? <p className="link-hint">{layout.message}</p> : null}
            {activeView === 'original' && linkedBlocks.length > 0 && selectedTask ? (
              <LinkedMarkdown taskId={selectedTask.id} blocks={linkedBlocks} selection={selection} onSelect={selectBlock} />
            ) : <OutputContent
              blocks={linkedBlocks}
              selection={selection}
              onSelectBlock={selectBlock}
              artifact={currentArtifact}
              selectedTask={selectedTask}
              view={activeView}
              onContentUpdate={(newContent) => {
                setArtifact((prev) => prev?.kind === 'workflow' && prev.taskId === selectedTask?.id
                  ? { ...prev, content: newContent, error: undefined } : prev);
              }}
            />}
          </section>
        ) : null}
      </ReaderSplit>
      <SettingsWorkspace
        asModal
        config={config}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onSaved={async () => {
          await refreshConfig();
          await refreshTasks();
        }}
      />
    </main>
  );
}

function CompactStatus({ task, text }: { task?: LocalTask; text?: string }) {
  if (!task) return null;
  return (
    <div className="compact-status" data-status={task.status}>
      <strong>{formatStatus(task.status)}</strong>
      {text ? <span>{text}</span> : null}
    </div>
  );
}

function OutputContent({
  blocks,
  selection,
  onSelectBlock,
  artifact,
  selectedTask,
  view,
  onContentUpdate
}: {
  blocks: PdfBlock[];
  selection?: BlockSelection;
  onSelectBlock: (id: string, source: BlockSelection['source']) => void;
  artifact?: ArtifactState;
  selectedTask?: LocalTask;
  view: OutputViewKind;
  onContentUpdate?: (content: string) => void;
}) {
  if (view === 'workflow') {
    return (
      <FlowchartPanel
        key={selectedTask?.id}
        taskId={artifact?.taskId}
        content={artifact?.content}
        onGenerated={onContentUpdate}
      />
    );
  }

  if (view === 'reading') {
    return (
      <div className="output-document">
        <MarkdownPreview
          taskId={selectedTask?.id}
          content={artifact?.content}
          emptyTitle="暂无阅读材料"
          emptyText="开启“生成阅读材料”后，任务会额外生成摘要、术语表和问答。"
        />
      </div>
    );
  }

  if (view === 'metadata') {
    return <MetadataView content={artifact?.content} />;
  }

  if (view === 'translated' && selectedTask && artifact?.content) {
    return <BilingualMarkdown taskId={selectedTask.id} content={artifact.content} segments={artifact.segments} blocks={blocks} selection={selection} onSelect={onSelectBlock} linkMessage={artifact.linkMessage} />;
  }

  return (
    <MarkdownPreview
      taskId={selectedTask?.id}
      content={artifact?.content}
      emptyTitle="暂无输出内容"
      emptyText="任务完成后会在这里显示生成内容。"
    />
  );
}

function getTaskCapabilities(task: LocalTask): string[] {
  const capabilities = ['PDF 解析', '本地保存'];
  if (task.result?.configSummary?.translationEnabled !== false) {
    capabilities.push('AI 译文');
  }
  if (task.result?.configSummary?.readingAssetsEnabled) {
    capabilities.push('AI 阅读材料');
  }
  if (task.steps.some((step) => step.step === 'quality_check' && step.status === 'completed')) {
    capabilities.push('质量检查');
  }
  return capabilities;
}

function getTaskSummary(tasks: LocalTask[]) {
  return {
    total: tasks.length,
    running: tasks.filter((task) => task.status === 'queued' || task.status === 'running').length,
    completed: tasks.filter((task) => task.status === 'completed').length,
    failed: tasks.filter((task) => task.status === 'failed').length
  };
}

function canRetryTask(task: LocalTask): boolean {
  return task.status === 'failed';
}

function canDeleteTask(task: LocalTask): boolean {
  return task.status !== 'queued' && task.status !== 'running';
}

function getTaskHint(task: LocalTask): string {
  if (task.error) {
    return task.error;
  }
  if (task.status === 'completed') {
    return '处理完成';
  }
  const activeStep = task.steps.find((step) => step.status === 'running')
    ?? task.steps.find((step) => step.status === 'pending');
  const stepText = activeStep ? stepLabels[activeStep.step] ?? activeStep.step : formatStatus(task.status);
  return `${stepText} · ${formatPercent(task.progress)}${task.updatedAt ? ` · ${formatRelativeTime(task.updatedAt)}` : ''}`;
}

function formatPercent(value: number): string {
  return `${Math.max(0, Math.min(100, Math.round(value)))}%`;
}

function formatRelativeTime(value: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return '';
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return '刚刚';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return new Date(timestamp).toLocaleDateString('zh-CN');
}

function formatStatus(status: TaskStatus): string {
  const labels: Record<TaskStatus, string> = {
    queued: '排队',
    running: '运行中',
    completed: '完成',
    failed: '失败'
  };
  return labels[status];
}

function formatStepStatus(status: StepStatus): string {
  const labels: Record<StepStatus, string> = {
    pending: '等待',
    running: '运行中',
    completed: '完成',
    failed: '失败',
    skipped: '跳过'
  };
  return labels[status];
}
