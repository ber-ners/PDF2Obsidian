import React, { useRef, useLayoutEffect, useCallback } from 'react';
import { type BilingualSegmentItem, renderMathSafely } from '../../utils/bilingual';
import type { ReaderSelectionState } from './PdfViewport';
import { MermaidRenderer } from './MermaidRenderer';

export interface BilingualColumnProps {
  segments: BilingualSegmentItem[];
  selection?: ReaderSelectionState;
  onSelect: (segmentId: string, blockId: string | null, source: 'pdf' | 'markdown') => void;
}


/**
 * Parses a text string containing inline ($...$) and block ($$...$$) KaTeX math
 * into a list of React nodes with rendered HTML.
 */
export function renderMathInText(content: string): React.ReactNode {
  if (!content) return null;

  // Pattern matching display math $$...$$ and inline math $...$
  const parts: React.ReactNode[] = [];
  const mathRegex = /(\$\$[\s\S]+?\$\$|\$[^\$\n]+?\$)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = mathRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push(content.substring(lastIndex, match.index));
    }

    const token = match[0];
    if (token.startsWith('$$') && token.endsWith('$$')) {
      const tex = token.slice(2, -2).trim();
      const html = renderMathSafely(tex, true);
      parts.push(
        <div
          key={`math-display-${match.index}`}
          className="katex-display"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      );
    } else if (token.startsWith('$') && token.endsWith('$')) {
      const tex = token.slice(1, -1).trim();
      const html = renderMathSafely(tex, false);
      parts.push(
        <span
          key={`math-inline-${match.index}`}
          className="katex-inline"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      );
    }

    lastIndex = mathRegex.lastIndex;
  }

  if (lastIndex < content.length) {
    parts.push(content.substring(lastIndex));
  }

  return parts;
}

/**
 * Parses markdown text containing Mermaid code fences (```mermaid ... ```)
 * and LaTeX math formulas ($...$, $$...$$), rendering them appropriately.
 */
function renderContent(content: string): React.ReactNode {
  if (!content) return null;

  const mermaidRegex = /```mermaid\s*([\s\S]*?)```/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = mermaidRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push(renderMathInText(content.substring(lastIndex, match.index)));
    }

    const mermaidCode = match[1];
    parts.push(
      <MermaidRenderer
        key={`mermaid-${match.index}`}
        code={mermaidCode}
      />
    );

    lastIndex = mermaidRegex.lastIndex;
  }

  if (lastIndex < content.length) {
    parts.push(renderMathInText(content.substring(lastIndex)));
  }

  return parts;
}

export const BilingualColumn: React.FC<BilingualColumnProps> = ({
  segments,
  selection,
  onSelect
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // Smoothly scroll to matching bilingual segment when a PDF bbox is selected
  useLayoutEffect(() => {
    if (!selection || selection.source !== 'pdf' || !selection.activeBlockId) return;

    const matchingSeg = segments.find((s) =>
      s.blockIds.includes(selection.activeBlockId!)
    );

    if (matchingSeg) {
      const targetEl = containerRef.current?.querySelector<HTMLElement>(
        `[data-segment-id="${matchingSeg.id}"]`
      );
      if (targetEl) {
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [selection?.sequence, selection?.activeBlockId, segments]);

  const handleSegmentClick = useCallback(
    (segment: BilingualSegmentItem) => {
      const targetBlockId = segment.blockIds.length > 0 ? segment.blockIds[0] : null;
      onSelect(segment.id, targetBlockId, 'markdown');
    },
    [onSelect]
  );

  return (
    <div
      ref={containerRef}
      className="pdf2obsidian-bilingual-column"
      style={{
        flex: 1,
        height: '100%',
        overflowY: 'auto',
        padding: '24px 32px',
        backgroundColor: 'var(--background-primary)',
        lineHeight: 1.7,
        boxSizing: 'border-box'
      }}
    >
      {segments.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', textAlign: 'center', marginTop: '64px' }}>
          暂无可展示的双语内容。
        </div>
      ) : (
        segments.map((segment) => {
          const isActive = Boolean(
            (selection?.activeBlockId && segment.blockIds.includes(selection.activeBlockId)) ||
            (selection?.activeSegmentId && selection.activeSegmentId === segment.id)
          );

          if (segment.role === 'title' || (segment.headingLevel && segment.headingLevel > 0)) {
            const level = segment.headingLevel || 1;
            const HeadingTag = `h${Math.min(6, Math.max(1, level))}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

            return (
              <div
                key={segment.id}
                data-segment-id={segment.id}
                data-active={isActive}
                className="pdf2obsidian-bilingual-segment"
                onClick={() => handleSegmentClick(segment)}
                style={{ cursor: 'pointer' }}
              >
                <HeadingTag style={{ margin: '16px 0 8px 0', color: 'var(--text-normal)' }}>
                  {renderMathInText(segment.sourceText)}
                  {segment.translatedText && (
                    <span
                      style={{
                        marginLeft: '12px',
                        color: 'var(--text-muted)',
                        fontWeight: 'normal',
                        fontSize: '0.9em'
                      }}
                    >
                      {renderMathInText(segment.translatedText)}
                    </span>
                  )}
                </HeadingTag>
              </div>
            );
          }

          if (segment.role === 'equation' && !segment.translatedText) {
            return (
              <div
                key={segment.id}
                data-segment-id={segment.id}
                data-active={isActive}
                className="pdf2obsidian-bilingual-segment"
                onClick={() => handleSegmentClick(segment)}
                style={{ cursor: 'pointer' }}
              >
                {renderContent(segment.combinedMarkdown || segment.sourceText)}
              </div>
            );
          }

          return (
            <div
              key={segment.id}
              data-segment-id={segment.id}
              data-active={isActive}
              className="pdf2obsidian-bilingual-segment"
              onClick={() => handleSegmentClick(segment)}
              style={{ cursor: 'pointer' }}
            >
              <div className="pdf2obsidian-bilingual-en">
                {renderContent(segment.sourceText)}
              </div>
              {segment.translatedText && (
                <div className="pdf2obsidian-bilingual-zh">
                  {renderContent(segment.translatedText)}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
};
