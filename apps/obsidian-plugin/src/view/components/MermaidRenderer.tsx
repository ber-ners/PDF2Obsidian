import React, { memo, useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { render, detectType, type RenderResult } from 'pele';

export interface MermaidRendererProps {
  code: string;
  className?: string;
  defaultExpanded?: boolean;
  maxHeight?: number | string;
}

export const MermaidRenderer = memo(function MermaidRenderer({
  code,
  className = '',
  defaultExpanded = false,
  maxHeight = 560
}: MermaidRendererProps) {
  const [copied, setCopied] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [expanded, setExpanded] = useState(Boolean(defaultExpanded));
  const [isPanning, setIsPanning] = useState(false);
  const [canScroll, setCanScroll] = useState(false);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const panStartRef = useRef<{ startX: number; startY: number; scrollLeft: number; scrollTop: number } | null>(null);

  const trimmed = useMemo(() => code.trim(), [code]);

  const { result, error, detectedType } = useMemo(() => {
    if (!trimmed) {
      return { result: null, error: null, detectedType: null };
    }
    const detected = detectType(trimmed) || 'mermaid';
    try {
      const res: RenderResult = render(trimmed);
      return { result: res, error: null, detectedType: detected };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { result: null, error: message, detectedType: detected };
    }
  }, [trimmed]);

  const handleCopy = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(trimmed);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  }, [trimmed]);

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
    return typeof maxHeight === 'number' ? `${maxHeight}px` : (maxHeight || '560px');
  }, [expanded, maxHeight]);

  const baseWidth = result?.width || 560;
  const containerWidth = useMemo(() => {
    if (zoomLevel === 1) return undefined;
    return `${Math.round(baseWidth * zoomLevel)}px`;
  }, [baseWidth, zoomLevel]);

  if (!trimmed) return null;

  if (error) {
    return (
      <div
        className={`pdf2obsidian-pele-error ${className}`}
        style={{
          margin: '12px 0',
          padding: '12px',
          borderRadius: '6px',
          backgroundColor: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          color: 'var(--text-normal)'
        }}
      >
        <div style={{ fontWeight: 600, color: 'var(--text-error, #ef4444)', marginBottom: '4px' }}>
          ⚠️ Mermaid 图表解析失败 ({detectedType || 'mermaid'})
        </div>
        <div style={{ fontSize: '12px', opacity: 0.85, fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
          {error}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`pdf2obsidian-pele-diagram ${className}`}
      style={{
        margin: '16px 0',
        borderRadius: '8px',
        border: '1px solid var(--background-modifier-border, #d1d5db)',
        backgroundColor: 'var(--background-secondary, #f8fafc)',
        overflow: 'hidden'
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '6px 12px',
          borderBottom: '1px solid var(--background-modifier-border, #e2e8f0)',
          fontSize: '11px',
          color: 'var(--text-muted)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              backgroundColor: 'var(--interactive-accent, #7c3aed)'
            }}
          />
          <span style={{ fontWeight: 500, textTransform: 'capitalize' }}>
            {detectedType || 'Diagram'} (Pele)
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {/* Zoom Controls */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              borderRadius: '4px',
              border: '1px solid var(--background-modifier-border)',
              background: 'var(--background-primary)',
              overflow: 'hidden'
            }}
          >
            <button
              type="button"
              onClick={handleZoomOut}
              title="缩小"
              style={{
                border: 'none',
                background: 'transparent',
                padding: '2px 6px',
                cursor: 'pointer',
                fontSize: '11px',
                color: 'var(--text-normal)'
              }}
            >
              -
            </button>
            <span
              onClick={handleZoomReset}
              title="重置缩放"
              style={{
                padding: '2px 4px',
                fontSize: '10px',
                cursor: 'pointer',
                minWidth: '34px',
                textAlign: 'center',
                color: 'var(--text-muted)',
                userSelect: 'none'
              }}
            >
              {Math.round(zoomLevel * 100)}%
            </span>
            <button
              type="button"
              onClick={handleZoomIn}
              title="放大"
              style={{
                border: 'none',
                background: 'transparent',
                padding: '2px 6px',
                cursor: 'pointer',
                fontSize: '11px',
                color: 'var(--text-normal)'
              }}
            >
              +
            </button>
          </div>

          {/* Viewport / Expand toggle */}
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            title={expanded ? '切换为定高滚动视口（开启上下滚动）' : '展开为完整高度（取消内部滚动条）'}
            style={{
              fontSize: '11px',
              padding: '2px 6px',
              cursor: 'pointer',
              borderRadius: '4px',
              border: '1px solid var(--background-modifier-border)',
              background: expanded ? 'var(--interactive-accent)' : 'var(--background-primary)',
              color: expanded ? 'var(--text-on-accent)' : 'var(--text-normal)'
            }}
          >
            {expanded ? '⤡ 视口' : '⤢ 展开'}
          </button>

          <button
            type="button"
            onClick={handleCopy}
            style={{
              fontSize: '11px',
              padding: '2px 6px',
              cursor: 'pointer',
              borderRadius: '4px',
              border: '1px solid var(--background-modifier-border)',
              background: 'var(--background-primary)',
              color: 'var(--text-normal)'
            }}
          >
            {copied ? '已复制 ✓' : '复制'}
          </button>
        </div>
      </div>

      <div
        ref={wrapperRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
        title="支持鼠标滚轮上下滚动，或按住鼠标拖动画布；Ctrl+滚轮缩放"
        style={{
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'safe center',
          overflowX: 'auto',
          overflowY: 'auto',
          maxHeight: canvasMaxHeight,
          backgroundColor: 'var(--background-primary, #ffffff)',
          cursor: isPanning ? 'grabbing' : (canScroll ? 'grab' : 'default'),
          userSelect: isPanning ? 'none' : 'auto'
        }}
      >
        <div
          style={{
            width: containerWidth || '100%',
            maxWidth: zoomLevel === 1 ? '100%' : 'none',
            flexShrink: 0,
            transition: 'width 0.15s ease-out',
            display: 'flex',
            justifyContent: 'center'
          }}
          dangerouslySetInnerHTML={{ __html: result?.svg || '' }}
        />
      </div>
    </div>
  );
});
