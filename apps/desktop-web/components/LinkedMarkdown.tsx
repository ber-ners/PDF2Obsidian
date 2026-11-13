'use client';
import { memo, useLayoutEffect, useMemo, useRef } from 'react';
import { DeferredMarkdownBlock, MarkdownViewport, scrollToMarkdownBlock } from './MarkdownViewport';
import { pdfRole } from '../lib/pdf-semantics';
import { MarkdownContent } from './MarkdownContent';
import type { PdfBlock } from '../lib/pdf-blocks';
import type { BlockSelection } from './LinkedPdfViewer';

const LinkedBlock = memo(function LinkedBlock({ taskId, block, index, pageEnd, selection, onSelect }: {
  taskId: string; block: PdfBlock; index: number; pageEnd?: boolean; selection?: BlockSelection;
  onSelect: (id: string, source: BlockSelection['source']) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const pdfSelection = selection?.source === 'pdf';
  useLayoutEffect(() => {
    if (!pdfSelection) return;
    const node = container.current?.closest<HTMLElement>('section');
    if (node) scrollToMarkdownBlock(node);
  }, [pdfSelection, selection]);
  return <>
    <DeferredMarkdownBlock className="linked-md-block" data-pdf-role={block.role ?? pdfRole(block.type)}
      data-block-id={block.id} data-active={Boolean(selection)} eager={index === 0} forceRender={pdfSelection}
      estimatedHeight={Math.min(24000, Math.max(block.image ? 400 : 80, Math.round((block.sourceMarkdown || block.markdown).length * 0.45)))}>
        <div ref={container} onClick={(event) => { if (block.bbox && !(event.target as HTMLElement).closest('a,button') && !window.getSelection()?.toString()) onSelect(block.id, 'markdown'); }}>
          {block.parts ? block.parts.map((part, index) => <div key={index} className={`pdf-part pdf-part-${part.role}`} data-pdf-role={part.role}>
            {part.image ? <img loading="lazy" decoding="async" src={`/api/tasks/${taskId}/layout?image=${encodeURIComponent(part.image)}`} alt={part.role === 'table' ? '原文表格' : '原文插图'} /> :
              <MarkdownContent taskId={taskId} markdown={part.markdown ?? ''} role={part.role} annotations={block.annotations} />}
          </div>) : <MarkdownContent taskId={taskId} markdown={block.sourceMarkdown || block.markdown} /> }
        </div>
    </DeferredMarkdownBlock>
    {pageEnd ? <div className="md-page-divider" role="separator" aria-label={`第 ${block.page} 页`}><span>第 {block.page} 页</span></div> : null}
  </>;
});

function LinkedMarkdownContent({ taskId, blocks, selection, onSelect }: {
  taskId: string; blocks: PdfBlock[]; selection?: BlockSelection; onSelect: (id: string, source: BlockSelection['source']) => void;
}) {
  const visibleBlocks = useMemo(() => blocks.filter((b) => !b.continuationOf), [blocks]);
  return <MarkdownViewport key={taskId} className="markdown-preview linked-markdown">
    <p className="link-hint">点击 PDF 区块定位原文，点击原文返回 PDF 对应位置。</p>
    {visibleBlocks.map((block, index) => <LinkedBlock key={block.id} taskId={taskId} block={block} index={index}
      pageEnd={visibleBlocks[index + 1]?.page !== block.page}
      selection={selection?.id === block.id ? selection : undefined} onSelect={onSelect} />)}
  </MarkdownViewport>;
}

export const LinkedMarkdown = memo(LinkedMarkdownContent);
