import React, { useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { BboxOverlay } from './BboxOverlay';
import {
  type LayoutBlock,
  type ReaderSelectionState,
  getPageNumbers
} from '../../utils/coordinates';

export { type ReaderSelectionState };

export interface PdfViewportProps {
  pdfData: ArrayBuffer | Uint8Array | null;
  blocks: LayoutBlock[];
  selection?: ReaderSelectionState;
  onSelect: (blockId: string, source: 'pdf' | 'markdown') => void;
  fileName?: string;
}

interface PageSheetProps {
  doc: PDFDocumentProxy;
  pageNumber: number;
  zoom: number;
  containerWidth: number;
  blocks: LayoutBlock[];
  selectedBlockId: string | null;
  showBoxes: boolean;
  onSelect: (blockId: string, source: 'pdf') => void;
}

const PageSheet: React.FC<PageSheetProps> = React.memo(({
  doc,
  pageNumber,
  zoom,
  containerWidth,
  blocks,
  selectedBlockId,
  showBoxes,
  onSelect
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [aspectRatio, setAspectRatio] = useState<number>(1.414); // Default A4 ratio
  const [isRendered, setIsRendered] = useState(false);

  // Compute responsive width and height
  const pageWidth = Math.max(200, Math.round(containerWidth * zoom));
  const pageHeight = Math.round(pageWidth * aspectRatio);

  useEffect(() => {
    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<unknown> } | null = null;

    doc.getPage(pageNumber).then(async (page: PDFPageProxy) => {
      if (cancelled) return;
      const unscaledViewport = page.getViewport({ scale: 1 });
      const currentRatio = unscaledViewport.height / unscaledViewport.width;
      setAspectRatio(currentRatio);

      const targetCanvas = canvasRef.current;
      if (!targetCanvas) return;

      const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
      const scale = (pageWidth / unscaledViewport.width);
      const viewport = page.getViewport({ scale });

      targetCanvas.width = Math.ceil(viewport.width * dpr);
      targetCanvas.height = Math.ceil(viewport.height * dpr);
      targetCanvas.style.width = `${viewport.width}px`;
      targetCanvas.style.height = `${viewport.height}px`;

      const context = targetCanvas.getContext('2d');
      if (!context) return;

      try {
        renderTask = page.render({
          canvasContext: context,
          viewport,
          transform: [dpr, 0, 0, dpr, 0, 0]
        });
        await renderTask.promise;
        if (!cancelled) {
          setIsRendered(true);
        }
      } catch (err: unknown) {
        if (!cancelled && (err as { name?: string })?.name !== 'RenderingCancelledException') {
          console.error(`Error rendering page ${pageNumber}:`, err);
        }
      }
    }).catch((err) => {
      if (!cancelled) {
        console.error(`Failed to load page ${pageNumber}:`, err);
      }
    });

    return () => {
      cancelled = true;
      if (renderTask) {
        try {
          renderTask.cancel();
        } catch {
          // Ignore cancellation errors
        }
      }
    };
  }, [doc, pageNumber, pageWidth]);

  return (
    <div
      ref={surfaceRef}
      className="pdf2obsidian-page-surface pdf-page-surface"
      data-page-number={pageNumber}
      style={{
        position: 'relative',
        width: `${pageWidth}px`,
        height: `${pageHeight}px`,
        marginBottom: '24px',
        backgroundColor: '#ffffff',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
        borderRadius: '2px',
        flexShrink: 0
      }}
    >
      <canvas
        ref={canvasRef}
        className="pdf2obsidian-page-canvas"
        style={{ display: 'block', width: `${pageWidth}px`, height: `${pageHeight}px` }}
      />

      {showBoxes && blocks.map((block) => {
        const isActive =
          selectedBlockId === block.id ||
          (Boolean(block.continuationOf) && selectedBlockId === block.continuationOf);

        return (
          <BboxOverlay
            key={block.id}
            block={block}
            isActive={Boolean(isActive)}
            onSelect={onSelect}
            pageNumber={pageNumber}
          />
        );
      })}
    </div>
  );
});

PageSheet.displayName = 'PageSheet';

export const PdfViewport: React.FC<PdfViewportProps> = ({
  pdfData,
  blocks,
  selection,
  onSelect,
  fileName
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number>(1.0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [containerWidth, setContainerWidth] = useState<number>(600);
  const [showBoxes, setShowBoxes] = useState<boolean>(true);

  // Measure container width dynamically
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        if (w > 0) {
          setContainerWidth(Math.max(200, Math.round(w - 48)));
        }
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Load PDF document from binary data
  useEffect(() => {
    if (!pdfData) {
      setDoc(null);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    let cancelled = false;

    const loadingTask = pdfjsLib.getDocument({
      data: pdfData instanceof Uint8Array ? pdfData : new Uint8Array(pdfData)
    });

    loadingTask.promise
      .then((loadedDoc) => {
        if (!cancelled) {
          setDoc(loadedDoc);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('Failed to parse PDF document:', err);
          setError('无法解析 PDF 文件，请确认文件完整有效。');
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      try {
        void loadingTask.destroy();
      } catch {
        // Ignore destroy errors
      }
    };
  }, [pdfData]);

  // Group blocks by page index
  const blocksByPage = useMemo(() => {
    const map = new Map<number, LayoutBlock[]>();
    for (const b of blocks) {
      const pageList = map.get(b.page) || [];
      pageList.push(b);
      map.set(b.page, pageList);
    }
    return map;
  }, [blocks]);

  // Page numbers list
  const pageNumbers = useMemo(() => {
    if (!doc) return [];
    return getPageNumbers(doc.numPages);
  }, [doc]);

  // Handle synchronized scrolling when markdown paragraph is clicked
  useLayoutEffect(() => {
    if (!selection || selection.source !== 'markdown' || !selection.activeBlockId) return;

    const container = containerRef.current;
    if (!container) return;

    const targetBox = container.querySelector<HTMLElement>(
      `[data-block-id="${selection.activeBlockId}"]`
    );

    if (targetBox) {
      targetBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    // Fallback: locate target block's page
    const block = blocks.find(
      (b) => b.id === selection.activeBlockId || b.continuationOf === selection.activeBlockId
    );
    if (block) {
      const targetPage = container.querySelector<HTMLElement>(
        `[data-page-number="${block.page}"]`
      );
      if (targetPage) {
        targetPage.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setCurrentPage(block.page);
      }
    }
  }, [selection?.sequence, selection?.activeBlockId, blocks]);

  const handleZoomIn = () => setZoom((z) => Math.min(3.0, parseFloat((z + 0.2).toFixed(1))));
  const handleZoomOut = () => setZoom((z) => Math.max(0.4, parseFloat((z - 0.2).toFixed(1))));
  const handleZoomReset = () => setZoom(1.0);

  const scrollToPage = (pageNum: number) => {
    if (!doc || pageNum < 1 || pageNum > doc.numPages) return;
    setCurrentPage(pageNum);
    const targetPage = containerRef.current?.querySelector<HTMLElement>(
      `[data-page-number="${pageNum}"]`
    );
    targetPage?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div
      className="pdf2obsidian-pdf-column"
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        position: 'relative',
        backgroundColor: 'var(--background-secondary)'
      }}
    >
      {/* Floating Toolbar */}
      <div
        className="pdf2obsidian-pdf-toolbar"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 12px',
          borderBottom: '1px solid var(--background-modifier-border)',
          backgroundColor: 'var(--background-primary)',
          fontSize: '0.85rem',
          zIndex: 10,
          flexShrink: 0
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
          {fileName && (
            <span
              style={{
                fontWeight: 600,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: '220px'
              }}
              title={fileName}
            >
              {fileName}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Page navigation */}
          {doc && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <button
                type="button"
                onClick={() => scrollToPage(currentPage - 1)}
                disabled={currentPage <= 1}
                aria-label="上一页"
                style={{ padding: '2px 8px', cursor: 'pointer' }}
              >
                ‹
              </button>
              <span>
                {currentPage} / {doc.numPages}
              </span>
              <button
                type="button"
                onClick={() => scrollToPage(currentPage + 1)}
                disabled={currentPage >= doc.numPages}
                aria-label="下一页"
                style={{ padding: '2px 8px', cursor: 'pointer' }}
              >
                ›
              </button>
            </div>
          )}

          {/* Zoom controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <button
              type="button"
              onClick={handleZoomOut}
              disabled={zoom <= 0.4}
              aria-label="缩小"
              style={{ padding: '2px 8px', cursor: 'pointer' }}
            >
              −
            </button>
            <button
              type="button"
              onClick={handleZoomReset}
              title="重置缩放 100%"
              style={{ padding: '2px 6px', cursor: 'pointer', minWidth: '46px' }}
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              onClick={handleZoomIn}
              disabled={zoom >= 3.0}
              aria-label="放大"
              style={{ padding: '2px 8px', cursor: 'pointer' }}
            >
              +
            </button>
          </div>

          {/* Toggle bboxes */}
          <button
            type="button"
            onClick={() => setShowBoxes((v) => !v)}
            aria-pressed={showBoxes}
            style={{
              padding: '2px 8px',
              cursor: 'pointer',
              backgroundColor: showBoxes ? 'var(--interactive-accent)' : 'transparent',
              color: showBoxes ? 'var(--text-on-accent)' : 'var(--text-normal)'
            }}
          >
            识别框
          </button>
        </div>
      </div>

      {/* Pages Container */}
      <div
        ref={containerRef}
        className="pdf2obsidian-pdf-scroll"
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'auto',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '24px 16px'
        }}
      >
        {loading && (
          <div style={{ padding: '32px', color: 'var(--text-muted)' }}>
            正在加载 PDF 页面...
          </div>
        )}

        {error && (
          <div style={{ padding: '32px', color: 'var(--text-error)' }}>
            {error}
          </div>
        )}

        {!loading && !error && !pdfData && (
          <div style={{ padding: '48px', color: 'var(--text-muted)', textAlign: 'center' }}>
            未加载 PDF 文件。请在右侧选择或打开一篇论文。
          </div>
        )}

        {doc && (
          <div className="pdf2obsidian-pages-stack">
            {pageNumbers.map((pageNum) => (
              <PageSheet
                key={pageNum}
                doc={doc}
                pageNumber={pageNum}
                zoom={zoom}
                containerWidth={containerWidth}
                blocks={blocksByPage.get(pageNum) || []}
                selectedBlockId={selection?.activeBlockId || null}
                showBoxes={showBoxes}
                onSelect={(id, src) => onSelect(id, src)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
