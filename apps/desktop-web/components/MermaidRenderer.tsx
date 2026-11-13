'use client';

import React, { memo, useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { render, detectType, type RenderResult } from 'pele';

export interface MermaidRendererProps {
  code: string;
  className?: string;
  showSourceToggle?: boolean;
  defaultExpanded?: boolean;
  maxHeight?: number | string;
  compact?: boolean;
}

const DIAGRAM_TYPE_LABELS: Record<string, string> = {
  flowchart: '流程图 (Flowchart)',
  sequence: '时序图 (Sequence)',
  class: '类图 (Class)',
  state: '状态图 (State)',
  er: '实体关系图 (ER)',
  gantt: '甘特图 (Gantt)',
  pie: '饼图 (Pie)',
  mindmap: '思维导图 (Mindmap)',
  timeline: '时间线 (Timeline)',
  git: 'Git 分支图 (Git Graph)',
  quadrant: '象限图 (Quadrant)'
};

export const MermaidRenderer = memo(function MermaidRenderer({
  code,
  className = '',
  showSourceToggle = true,
  defaultExpanded = false,
  maxHeight = 620,
  compact = false
}: MermaidRendererProps) {
  const [showSource, setShowSource] = useState(false);
  const [copied, setCopied] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [expanded, setExpanded] = useState(Boolean(defaultExpanded));
  const [isPanning, setIsPanning] = useState(false);
  const [canScroll, setCanScroll] = useState(false);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const panStartRef = useRef<{ startX: number; startY: number; scrollLeft: number; scrollTop: number } | null>(null);

  const trimmedCode = useMemo(() => code.trim(), [code]);

  const { result, error, detectedType } = useMemo(() => {
    if (!trimmedCode) {
      return { result: null, error: null, detectedType: null };
    }

    const detected = detectType(trimmedCode) || 'mermaid';

    try {
      const res: RenderResult = render(trimmedCode);
      return { result: res, error: null, detectedType: detected };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { result: null, error: message, detectedType: detected };
    }
  }, [trimmedCode]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(trimmedCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback if clipboard API is restricted
    }
  }, [trimmedCode]);

  const handleZoomIn = useCallback(() => {
    setZoomLevel((prev) => Math.min(2.5, Number((prev + 0.25).toFixed(2))));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoomLevel((prev) => Math.max(0.5, Number((prev - 0.25).toFixed(2))));
  }, []);

  const handleZoomReset = useCallback(() => {
    setZoomLevel(1);
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('button, a, input, select, textarea')) return;

    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const isScrollable = wrapper.scrollHeight > wrapper.clientHeight || wrapper.scrollWidth > wrapper.clientWidth;
    if (!isScrollable) return;

    panStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      scrollLeft: wrapper.scrollLeft,
      scrollTop: wrapper.scrollTop
    };
    setIsPanning(true);
    wrapper.setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!panStartRef.current || !wrapperRef.current) return;
    const dx = e.clientX - panStartRef.current.startX;
    const dy = e.clientY - panStartRef.current.startY;
    wrapperRef.current.scrollLeft = panStartRef.current.scrollLeft - dx;
    wrapperRef.current.scrollTop = panStartRef.current.scrollTop - dy;
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (panStartRef.current && wrapperRef.current?.hasPointerCapture(e.pointerId)) {
      wrapperRef.current.releasePointerCapture(e.pointerId);
    }
    panStartRef.current = null;
    setIsPanning(false);
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      if (e.deltaY < 0) {
        handleZoomIn();
      } else if (e.deltaY > 0) {
        handleZoomOut();
      }
    }
  }, [handleZoomIn, handleZoomOut]);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const checkScrollable = () => {
      setCanScroll(el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth);
    };
    checkScrollable();
    const observer = new ResizeObserver(checkScrollable);
    observer.observe(el);
    return () => observer.disconnect();
  }, [result, zoomLevel, expanded]);

  const canvasMaxHeight = useMemo(() => {
    if (expanded) return undefined;
    return typeof maxHeight === 'number' ? `${maxHeight}px` : (maxHeight || '620px');
  }, [expanded, maxHeight]);

  const baseWidth = result?.width || 560;
  const containerWidth = useMemo(() => {
    if (zoomLevel === 1) return undefined;
    return `${Math.round(baseWidth * zoomLevel)}px`;
  }, [baseWidth, zoomLevel]);

  if (!trimmedCode) {
    return null;
  }

  const typeLabel = detectedType ? (DIAGRAM_TYPE_LABELS[detectedType] || detectedType) : 'Mermaid';

  if (error) {
    return (
      <div className={`pele-error-container ${className}`}>
        <div className="pele-error-header">
          <span className="pele-error-title">
            ⚠️ Mermaid 图表解析失败 ({typeLabel})
          </span>
          <button
            type="button"
            onClick={handleCopy}
            className="pele-action-btn"
          >
            {copied ? '已复制' : '复制代码'}
          </button>
        </div>
        <div className="pele-error-message">
          {error}
        </div>
        <pre className="md-code" style={{ margin: 0, maxHeight: '200px', overflowY: 'auto' }}>
          <code>{trimmedCode}</code>
        </pre>
      </div>
    );
  }

  return (
    <div
      className={`pele-diagram-card ${compact ? 'pele-diagram-compact' : ''} ${className}`}
      style={{
        margin: compact ? 0 : '20px 0',
        boxShadow: compact ? 'none' : undefined
      }}
    >
      {/* Header toolbar */}
      <div className="pele-diagram-toolbar">
        {!compact && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={{
                display: 'inline-block',
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: 'var(--accent, #333333)'
              }}
            />
            <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
              {typeLabel}
            </span>
            <span style={{ color: 'var(--text-secondary)', fontSize: '11px' }}>
              rendered by Pele
            </span>
          </div>
        )}

        <div className="pele-diagram-actions">
          {/* Zoom controls */}
          <div className="pele-zoom-group">
            <button
              type="button"
              className="pele-zoom-btn"
              onClick={handleZoomOut}
              title="缩小"
            >
              -
            </button>
            <button
              type="button"
              className="pele-zoom-value"
              onClick={handleZoomReset}
              title="点击重置缩放"
            >
              {Math.round(zoomLevel * 100)}%
            </button>
            <button
              type="button"
              className="pele-zoom-btn"
              onClick={handleZoomIn}
              title="放大"
            >
              +
            </button>
          </div>

          {/* Viewport Height / Expand Toggle */}
          <button
            type="button"
            className="pele-action-btn"
            aria-pressed={expanded}
            onClick={() => setExpanded((prev) => !prev)}
            title={expanded ? '切换为定高滚动视口（开启上下滚动）' : '展开为完整高度（取消内部滚动）'}
          >
            {expanded ? '⤡ 视口' : '⤢ 展开'}
          </button>

          {showSourceToggle && (
            <button
              type="button"
              className="pele-action-btn"
              aria-pressed={showSource}
              onClick={() => setShowSource((prev) => !prev)}
            >
              {showSource ? '隐藏源码' : '源码'}
            </button>
          )}

          <button
            type="button"
            className="pele-action-btn"
            onClick={handleCopy}
            title="复制 Mermaid 语法"
          >
            {copied ? '已复制 ✓' : '复制'}
          </button>
        </div>
      </div>

      {/* SVG Canvas Area */}
      <div
        ref={wrapperRef}
        className="pele-canvas-wrapper"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
        title="支持鼠标滚轮上下滚动，或按住鼠标拖动画布；Ctrl+滚轮缩放"
        style={{
          width: '100%',
          maxHeight: canvasMaxHeight,
          overflowX: 'auto',
          overflowY: 'auto',
          padding: compact ? '12px' : '24px 16px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'safe center',
          cursor: isPanning ? 'grabbing' : (canScroll ? 'grab' : 'default'),
          userSelect: isPanning ? 'none' : 'auto'
        }}
      >
        <div
          className="pele-svg-container"
          style={{
            width: containerWidth || (compact ? `min(100%, ${baseWidth}px)` : '100%'),
            maxWidth: zoomLevel === 1 ? '100%' : 'none',
            flexShrink: 0,
            transition: 'width 0.15s ease-out',
            display: 'flex',
            justifyContent: 'center'
          }}
          dangerouslySetInnerHTML={{ __html: result?.svg || '' }}
        />
      </div>

      {/* Source preview toggle */}
      {showSource && (
        <div className="pele-source-drawer">
          <pre className="pele-source-code">
            <code>{trimmedCode}</code>
          </pre>
        </div>
      )}
    </div>
  );
});
