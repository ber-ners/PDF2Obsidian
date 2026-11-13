'use client';

import { memo, useLayoutEffect, useMemo, useRef } from 'react';
import { MarkdownContent } from './MarkdownContent';
import { DeferredMarkdownBlock, MarkdownViewport, scrollToMarkdownBlock } from './MarkdownViewport';
import YAML from 'yaml';
import type { LinkedBilingualSegment } from '../lib/bilingual-links';
import type { PdfBlock } from '../lib/pdf-blocks';
import type { BlockSelection } from './LinkedPdfViewer';

const BilingualSegment = memo(function BilingualSegment({ taskId, segment, index, targets, pageEnd, selection, onSelect }: {
  taskId: string; segment: LinkedBilingualSegment; index: number; targets: PdfBlock[]; pageEnd?: number;
  selection?: BlockSelection; onSelect?: (id: string, source: BlockSelection['source']) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const active = Boolean(selection);
  const pdfSelection = selection?.source === 'pdf';

  useLayoutEffect(() => {
    if (!pdfSelection) return;
    const node = container.current?.closest<HTMLElement>('section');
    if (node) scrollToMarkdownBlock(node);
  }, [pdfSelection, selection]);

  function locate() {
    const id = selection?.id ?? targets[0]?.id;
    if (id) onSelect?.(id, 'markdown');
  }

  return <>
    <DeferredMarkdownBlock className="linked-md-block bilingual-pair" data-segment-index={index}
      data-pdf-role={segment.role ?? 'body'} data-block-ids={segment.blockIds.join(' ')} data-active={active}
      eager={index === 0} forceRender={pdfSelection}
      estimatedHeight={Math.min(24000, Math.max(80, Math.round(segment.markdown.length * 0.62)))}>
      <div ref={container} onClick={(event) => { if (!(event.target as HTMLElement).closest('a,button') && !window.getSelection()?.toString()) locate(); }}>
        <MarkdownContent taskId={taskId} markdown={segment.markdown} role={segment.role} annotations={segment.annotations} />
      </div>
    </DeferredMarkdownBlock>
    {pageEnd ? <div className="md-page-divider" role="separator" aria-label={`第 ${pageEnd} 页`}><span>第 {pageEnd} 页</span></div> : null}
  </>;
});

function BilingualMarkdownContent({ taskId, content, segments, blocks = [], selection, onSelect, linkMessage }: {
  taskId: string; content: string; segments?: LinkedBilingualSegment[]; blocks?: PdfBlock[];
  selection?: BlockSelection; onSelect?: (id: string, source: BlockSelection['source']) => void; linkMessage?: string;
}) {
  const { body, warnings } = useMemo(() => {
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
    const metadata = match ? YAML.parse(match[1]) : {};
    return {
      body: (match ? content.slice(match[0].length) : content).trim(),
      warnings: Array.isArray(metadata?.bilingualWarnings) ? metadata.bilingualWarnings as string[] : []
    };
  }, [content]);

  // Resolve PDF links once, instead of searching every PDF block on every scroll frame.
  const targets = useMemo(() => {
    const byId = new Map(blocks.map(block => [block.id, block]));
    return segments?.map(segment => segment.blockIds.map(id => byId.get(id)).filter((block): block is PdfBlock => Boolean(block))) ?? [];
  }, [segments, blocks]);
  const pageEnds = useMemo(() => {
    if (!segments?.length) return [];
    const pages = segments.map((_, index) => {
      const matched = targets[index];
      return matched?.length ? matched[matched.length - 1]!.page : undefined;
    });
    for (let i = pages.length - 1; i >= 0; i--) {
      if (pages[i] === undefined && /^#{1,6}\s/.test(segments[i]!.markdown)) pages[i] = pages[i + 1];
    }
    for (let i = 0; i < pages.length; i++) {
      if (pages[i] === undefined && i > 0) pages[i] = pages[i - 1];
    }
    for (let i = pages.length - 1; i >= 0; i--) {
      if (pages[i] === undefined) pages[i] = pages[i + 1];
    }
    return pages.map((page, index) => (page !== undefined && pages[index + 1] !== page ? page : undefined));
  }, [segments, targets]);
  const linked = useMemo(() => segments?.some(segment => segment.blockIds.length), [segments]);
  const selectedIndex = useMemo(() => selection ? segments?.findIndex(segment => segment.blockIds.includes(selection.id)) : -1, [segments, selection]);

  return <MarkdownViewport key={taskId} className="markdown-preview bilingual-markdown">
    {warnings.length ? <p className="link-hint" role="status">{warnings.join(' ')}</p> : null}
    {selection?.source === 'pdf' && segments && selectedIndex === -1 ?
      <p className="link-hint" role="status">该 PDF 区块未在中英对照正文中找到对应内容，可能是页眉、页脚或已移除的内容。可切换“原文”查看。</p> : null}
    {linkMessage ? <p className="link-hint" role="status">{linkMessage}</p> : null}
    {linked ? <p className="link-hint">点击 PDF 区块定位中英对照；点击中英段落返回 PDF。未逐段配对的内容按整节定位。</p> : null}
    {segments ? segments.map((segment, index) => <BilingualSegment key={`${index}:${segment.markdown}`} taskId={taskId} segment={segment}
      index={index} targets={targets[index]} pageEnd={pageEnds[index]} selection={selectedIndex === index ? selection : undefined} onSelect={onSelect} />)
      : <MarkdownContent taskId={taskId} markdown={body} />}
  </MarkdownViewport>;
}

export const BilingualMarkdown = memo(BilingualMarkdownContent);
