'use client';

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { pdfRole, pdfRoleLabels } from '../lib/pdf-semantics';
import type { PdfBlock } from '../lib/pdf-blocks';

type Selection = { id: string; source: 'pdf' | 'markdown'; sequence: number };
export type BlockSelection = Selection;

interface PdfPageSheetProps {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  width: number;
  zoom: number;
  defaultRatio: number;
  scrollRoot: React.RefObject<HTMLDivElement | null>;
  pageBlocks: PdfBlock[];
  selectedBlockId?: string;
  showBoxes: boolean;
  onSelect: (id: string, source: Selection['source']) => void;
  onError: (message: string) => void;
}

const PdfPageSheet = memo(function PdfPageSheet({
  pdf,
  pageNumber,
  width,
  zoom,
  defaultRatio,
  scrollRoot,
  pageBlocks,
  selectedBlockId,
  showBoxes,
  onSelect,
  onError
}: PdfPageSheetProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ratio, setRatio] = useState<number | undefined>(undefined);
  const [nearViewport, setNearViewport] = useState(pageNumber <= 2);
  const [rendering, setRendering] = useState(false);

  const effectiveRatio = ratio ?? defaultRatio;
  const displayWidth = Math.round(width * zoom);
  const displayHeight = Math.round(displayWidth * effectiveRatio);

  useEffect(() => {
    const node = surfaceRef.current;
    const root = scrollRoot.current;
    if (!node) return;
    if (typeof IntersectionObserver === 'undefined') {
      setNearViewport(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry) setNearViewport(entry.isIntersecting);
      },
      { root, rootMargin: '1400px 0px' }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [scrollRoot]);

  useEffect(() => {
    if (!nearViewport || !canvasRef.current) return;
    let cancelled = false;
    let renderTask: { cancel: () => void } | undefined;
    setRendering(true);

    const timer = window.setTimeout(() => {
      void pdf.getPage(pageNumber).then(async (pdfPage) => {
        if (cancelled || !canvasRef.current) return;
        const original = pdfPage.getViewport({ scale: 1 });
        const nextRatio = original.height / original.width;
        setRatio((prev) => (prev && Math.abs(prev - nextRatio) < 0.001 ? prev : nextRatio));

        const viewport = pdfPage.getViewport({ scale: (width * zoom) / original.width });
        const target = canvasRef.current;
        const dpr = window.devicePixelRatio || 1;
        target.width = Math.ceil(viewport.width * dpr);
        target.height = Math.ceil(viewport.height * dpr);
        const context = target.getContext('2d');
        if (!context) return;
        const task = pdfPage.render({
          canvasContext: context,
          viewport,
          transform: [dpr, 0, 0, dpr, 0, 0]
        });
        renderTask = task;
        await task.promise;
        if (!cancelled) setRendering(false);
      }).catch((reason) => {
        if (!cancelled && reason?.name !== 'RenderingCancelledException') {
          setRendering(false);
          onError('部分页面渲染失败，可打开原文件查看。');
        }
      });
    }, 60);

    return () => {
      window.clearTimeout(timer);
      cancelled = true;
      renderTask?.cancel();
    };
  }, [pdf, pageNumber, width, zoom, nearViewport, onError]);

  return (
    <div
      className="pdf-page-surface"
      ref={surfaceRef}
      data-page-number={pageNumber}
      style={{ width: displayWidth, height: displayHeight }}
      aria-busy={rendering}
    >
      {nearViewport ? <canvas ref={canvasRef} /> : null}
      {pageBlocks.map((block) => {
        const [x0, y0, x1, y1] = block.bbox!;
        const isActive = selectedBlockId === block.id || (Boolean(block.continuationOf) && selectedBlockId === block.continuationOf);
        return (
          <button
            key={block.id}
            type="button"
            className="pdf-block-box"
            data-block-id={block.id}
            data-continuation-of={block.continuationOf}
            data-active={isActive}
            data-visible={showBoxes}
            aria-label={`定位原文：${block.markdown.replace(/[#*$]/g, '').slice(0, 65) || block.type}`}
            aria-pressed={isActive}
            title={`${pdfRoleLabels[block.role ?? pdfRole(block.type)]} · 第 ${pageNumber} 页 · 点击定位右侧内容`}
            style={{
              left: `${x0 / 10}%`,
              top: `${y0 / 10}%`,
              width: `${(x1 - x0) / 10}%`,
              height: `${(y1 - y0) / 10}%`
            }}
            onClick={() => onSelect(block.continuationOf ?? block.id, 'pdf')}
          />
        );
      })}
    </div>
  );
});

export function LinkedPdfViewer({ taskId, fileName, leadingAction, blocks, selection, onSelect }: {
  taskId: string;
  fileName?: string;
  leadingAction?: ReactNode;
  blocks: PdfBlock[];
  selection?: Selection;
  onSelect: (id: string, source: Selection['source']) => void;
}) {
  const [pdf, setPdf] = useState<PDFDocumentProxy>();
  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState('1');
  const [panMode, setPanMode] = useState(false);
  const [panning, setPanning] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [showBoxes, setShowBoxes] = useState(true);
  const [error, setError] = useState('');
  const [width, setWidth] = useState(600);
  const [defaultRatio, setDefaultRatio] = useState(1.414);
  const container = useRef<HTMLDivElement>(null);

  const anchor = useRef<{ pageNumber: number; x: number; y: number } | undefined>(undefined);
  const pan = useRef<{ x: number; y: number; left: number; top: number } | undefined>(undefined);
  const locatedSelection = useRef<number | undefined>(undefined);
  const isEditingPageInput = useRef(false);

  const blocksByPage = useMemo(() => {
    const map = new Map<number, PdfBlock[]>();
    for (const block of blocks) {
      if (!block.bbox) continue;
      const list = map.get(block.page);
      if (list) list.push(block);
      else map.set(block.page, [block]);
    }
    return map;
  }, [blocks]);

  const pageNumbers = useMemo(
    () => (pdf ? Array.from({ length: pdf.numPages }, (_, index) => index + 1) : []),
    [pdf]
  );

  function rememberPosition() {
    const viewport = container.current;
    if (!viewport) return;
    const sheet = viewport.querySelector<HTMLElement>(`.pdf-page-surface[data-page-number="${page}"]`)
      ?? viewport.querySelector<HTMLElement>('.pdf-page-surface');
    if (!sheet || !sheet.clientWidth || !sheet.clientHeight) return;
    const bounds = viewport.getBoundingClientRect();
    const pageBounds = sheet.getBoundingClientRect();
    anchor.current = {
      pageNumber: Number(sheet.dataset.pageNumber) || page,
      x: (bounds.left + viewport.clientWidth / 2 - pageBounds.left) / sheet.clientWidth,
      y: (bounds.top + viewport.clientHeight / 2 - pageBounds.top) / sheet.clientHeight
    };
  }

  function changeZoom(next: number) {
    rememberPosition();
    setZoom(next);
  }

  function scrollToPage(targetPage: number) {
    if (!pdf) return;
    const valid = Math.max(1, Math.min(pdf.numPages, Math.trunc(targetPage)));
    setPage(valid);
    setPageInput(String(valid));
    const viewport = container.current;
    const sheet = viewport?.querySelector<HTMLElement>(`.pdf-page-surface[data-page-number="${valid}"]`);
    if (viewport && sheet) {
      const viewportBounds = viewport.getBoundingClientRect();
      const sheetBounds = sheet.getBoundingClientRect();
      viewport.scrollTo({
        top: Math.max(0, viewport.scrollTop + sheetBounds.top - viewportBounds.top - 12),
        behavior: 'instant'
      });
    }
  }

  function commitPage() {
    const next = Number(pageInput);
    const valid = Number.isFinite(next) && pageInput.trim()
      ? Math.max(1, Math.min(pdf?.numPages ?? 1, Math.trunc(next)))
      : page;
    scrollToPage(valid);
  }

  useLayoutEffect(() => {
    const viewport = container.current;
    const saved = anchor.current;
    if (!viewport || !saved) return;
    const sheet = viewport.querySelector<HTMLElement>(`.pdf-page-surface[data-page-number="${saved.pageNumber}"]`);
    if (!sheet) return;
    const bounds = viewport.getBoundingClientRect();
    const pageBounds = sheet.getBoundingClientRect();
    viewport.scrollTo({
      left: viewport.scrollLeft + pageBounds.left - bounds.left + saved.x * sheet.clientWidth - viewport.clientWidth / 2,
      top: viewport.scrollTop + pageBounds.top - bounds.top + saved.y * sheet.clientHeight - viewport.clientHeight / 2,
      behavior: 'instant'
    });
    anchor.current = undefined;
  }, [width, zoom]);

  useEffect(() => {
    let disposed = false;
    let destroy: (() => void) | undefined;
    setPage(1);
    setPageInput('1');
    setPdf(undefined);
    setError('');
    locatedSelection.current = undefined;
    container.current?.scrollTo({ top: 0, left: 0, behavior: 'instant' });

    void import('pdfjs-dist').then(async (pdfjs) => {
      if (disposed) return;
      pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
      const loading = pdfjs.getDocument(`/api/tasks/${taskId}/pdf`);
      destroy = () => { void loading.destroy().catch(() => {}); };
      loading.promise.catch(() => {});
      if (disposed) { destroy(); return; }
      const doc = await loading.promise;
      if (disposed) { destroy(); return; }
      try {
        const firstPage = await doc.getPage(1);
        if (!disposed) {
          const vp = firstPage.getViewport({ scale: 1 });
          setDefaultRatio(vp.height / vp.width);
        }
      } catch {
        // Fallback to standard A4 ratio
      }
      if (!disposed) setPdf(doc);
    }).catch(() => {
      if (!disposed) setError('PDF 加载失败，请重试或打开原文件。');
    });

    return () => {
      disposed = true;
      destroy?.();
    };
  }, [taskId]);

  useEffect(() => {
    if (!container.current) return;
    let observedWidth = 0;
    const observer = new ResizeObserver(([entry]) => {
      // Round and keep the previous value when it did not really change: sub-pixel
      // jitter must not start another PDF rasterization pass.
      const nextWidth = Math.max(200, Math.round(entry.contentRect.width - 32));
      if (nextWidth === observedWidth) return;
      observedWidth = nextWidth;
      rememberPosition();
      setWidth((current) => (current === nextWidth ? current : nextWidth));
    });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);

  // Update active page indicator as the user scrolls vertically through pages
  const handleScroll = useCallback(() => {
    const viewport = container.current;
    if (!viewport || !pdf) return;
    const viewportRect = viewport.getBoundingClientRect();
    const probeY = viewportRect.top + Math.min(180, viewportRect.height * 0.35);
    const sheets = viewport.querySelectorAll<HTMLElement>('.pdf-page-surface');
    let current = 1;
    for (const sheet of sheets) {
      const rect = sheet.getBoundingClientRect();
      const pageNum = Number(sheet.dataset.pageNumber) || 1;
      if (rect.top <= probeY) {
        current = pageNum;
      } else {
        break;
      }
    }
    setPage((prev) => (prev === current ? prev : current));
    if (!isEditingPageInput.current) {
      setPageInput(String(current));
    }
  }, [pdf]);

  // Scroll directly to the target block when selected from the Markdown reader
  useLayoutEffect(() => {
    if (!pdf || selection?.source !== 'markdown' || locatedSelection.current === selection.sequence) return;
    const viewport = container.current;
    if (!viewport) return;
    const target = viewport.querySelector<HTMLElement>(`[data-block-id="${selection.id}"]`);
    if (!target) {
      const block = blocks.find((item) => item.id === selection.id);
      if (block && block.page <= pdf.numPages) {
        locatedSelection.current = selection.sequence;
        scrollToPage(block.page);
      }
      return;
    }
    locatedSelection.current = selection.sequence;
    const sheet = target.closest<HTMLElement>('.pdf-page-surface');
    const targetPage = Number(sheet?.dataset.pageNumber);
    if (targetPage) {
      setPage(targetPage);
      if (!isEditingPageInput.current) setPageInput(String(targetPage));
    }
    const bounds = target.getBoundingClientRect();
    const parent = viewport.getBoundingClientRect();
    viewport.scrollTo({
      top: Math.max(0, viewport.scrollTop + bounds.top - parent.top - (viewport.clientHeight - bounds.height) / 2),
      left: Math.max(0, viewport.scrollLeft + bounds.left - parent.left - (viewport.clientWidth - bounds.width) / 2),
      behavior: 'instant'
    });
  }, [selection, pdf, blocks, width, zoom]);

  const handlePageError = useCallback((msg: string) => {
    setError((prev) => prev || msg);
  }, []);

  return (
    <div className="linked-pdf-viewer">
      <div className="pdf-toolbar glass-toolbar">
        <div className="pdf-toolbar-leading">
          {leadingAction}
          {fileName ? <span className="pdf-toolbar-title" title={fileName}>{fileName}</span> : null}
        </div>
        <div className="pdf-toolbar-controls">
          <div className="pdf-tool-group">
            <button type="button" aria-label="上一页" disabled={!pdf || page <= 1} onClick={() => scrollToPage(page - 1)}>‹</button>
            <label>
              <input
                aria-label="PDF 页码"
                type="number"
                min={1}
                max={pdf?.numPages ?? 1}
                disabled={!pdf}
                value={pageInput}
                onFocus={() => { isEditingPageInput.current = true; }}
                onChange={(event) => setPageInput(event.target.value)}
                onBlur={() => {
                  isEditingPageInput.current = false;
                  commitPage();
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    isEditingPageInput.current = false;
                    commitPage();
                  }
                  if (event.key === 'Escape') {
                    isEditingPageInput.current = false;
                    setPageInput(String(page));
                  }
                }}
              />
              <span>/ {pdf?.numPages ?? '…'}</span>
            </label>
            <button type="button" aria-label="下一页" disabled={!pdf || page >= pdf.numPages} onClick={() => scrollToPage(page + 1)}>›</button>
          </div>
          <span className="pdf-toolbar-sep" aria-hidden="true" />
          <div className="pdf-tool-group">
            <button type="button" aria-label="缩小" disabled={zoom <= .5} onClick={() => changeZoom(Math.max(.5, zoom - .25))}>−</button>
            <button type="button" className="pdf-zoom-readout" title="恢复 100% 适应宽度" onClick={() => changeZoom(1)}>{Math.round(zoom * 100)}%</button>
            <button type="button" aria-label="放大" disabled={zoom >= 3} onClick={() => changeZoom(Math.min(3, zoom + .25))}>+</button>
          </div>
          <span className="pdf-toolbar-sep" aria-hidden="true" />
          <div className="pdf-tool-group">
            <button type="button" aria-pressed={panMode} onClick={() => setPanMode(!panMode)}>拖拽</button>
            <button type="button" aria-pressed={showBoxes} onClick={() => setShowBoxes(!showBoxes)}>区块</button>
            <a href={`/api/tasks/${taskId}/pdf`} target="_blank" rel="noreferrer" title="在新标签页打开原 PDF">原文件 ↗</a>
          </div>
        </div>
      </div>
      <div
        className="pdf-page-scroll"
        ref={container}
        data-pan-mode={panMode}
        data-panning={panning}
        onScroll={handleScroll}
        onPointerDown={(event) => {
          if (!panMode || event.button !== 0) return;
          event.preventDefault();
          pan.current = { x: event.clientX, y: event.clientY, left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop };
          event.currentTarget.setPointerCapture(event.pointerId);
          setPanning(true);
        }}
        onPointerMove={(event) => {
          if (!pan.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
          event.currentTarget.scrollLeft = pan.current.left - (event.clientX - pan.current.x);
          event.currentTarget.scrollTop = pan.current.top - (event.clientY - pan.current.y);
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          pan.current = undefined;
          setPanning(false);
        }}
        onLostPointerCapture={() => { pan.current = undefined; setPanning(false); }}
        onPointerCancel={() => { pan.current = undefined; setPanning(false); }}
      >
        {error ? <p role="alert">{error}</p> : !pdf ? <p role="status">正在加载 PDF…</p> : null}
        {pdf ? (
          <div className="pdf-pages-stack">
            {pageNumbers.map((pageNumber) => (
              <PdfPageSheet
                key={pageNumber}
                pdf={pdf}
                pageNumber={pageNumber}
                width={width}
                zoom={zoom}
                defaultRatio={defaultRatio}
                scrollRoot={container}
                pageBlocks={blocksByPage.get(pageNumber) ?? []}
                selectedBlockId={selection?.id}
                showBoxes={showBoxes}
                onSelect={onSelect}
                onError={handlePageError}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
