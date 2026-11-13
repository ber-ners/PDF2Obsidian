'use client';

import React, { memo, useMemo } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeKatex from 'rehype-katex';
import { rehypePdfSemantics } from '../lib/rehype-pdf-semantics';
import type { PdfRole, PdfAnnotation } from '../lib/pdf-semantics';
import { MermaidRenderer } from './MermaidRenderer';

const remarkPlugins = [remarkGfm, remarkMath];
// Sanitize document HTML before KaTeX creates its own trusted markup.
const rehypePlugins = [rehypeRaw, [rehypeSanitize, {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), 'caption'],
  attributes: {
    ...defaultSchema.attributes,
    td: [...(defaultSchema.attributes?.td ?? []), 'colSpan', 'rowSpan'],
    th: [...(defaultSchema.attributes?.th ?? []), 'colSpan', 'rowSpan'],
    code: [...(defaultSchema.attributes?.code ?? []), ['className', /^language-./, 'math-inline', 'math-display']]
  }
}]] as NonNullable<React.ComponentProps<typeof Markdown>['rehypePlugins']>;

export const MarkdownContent = memo(function MarkdownContent({ markdown, taskId, role, annotations }: { markdown: string; taskId?: string; role?: PdfRole; annotations?: PdfAnnotation[] }) {
  const semanticPlugins = useMemo(() => [...rehypePlugins, [rehypePdfSemantics, { role, annotations }], rehypeKatex] as NonNullable<React.ComponentProps<typeof Markdown>['rehypePlugins']>, [role, annotations]);
  const components = useMemo<Components>(() => ({
    table: ({ node, ...props }) => <div className="md-table" role="region" aria-label="表格，可横向滚动" tabIndex={0}><table {...props} /></div>,
    pre: ({ node, children, ...props }) => {
      const childArray = React.Children.toArray(children);
      const firstChild = childArray[0];
      if (
        React.isValidElement(firstChild) &&
        typeof firstChild.props === 'object' &&
        firstChild.props !== null &&
        'className' in firstChild.props &&
        typeof (firstChild.props as { className?: unknown }).className === 'string' &&
        ((firstChild.props as { className: string }).className.includes('language-mermaid') ||
         (firstChild.props as { className: string }).className.includes('mermaid'))
      ) {
        const rawCode = String((firstChild.props as { children?: unknown }).children || '').replace(/\n$/, '');
        return <MermaidRenderer code={rawCode} />;
      }
      return <pre className="md-code" {...props}>{children}</pre>;
    },
    code: ({ node, className, children, ...props }) => {
      const isMermaid = typeof className === 'string' && (className.includes('language-mermaid') || className.includes('mermaid'));
      if (isMermaid && !node?.position?.start.line) {
        return <MermaidRenderer code={String(children).replace(/\n$/, '')} />;
      }
      return <code className={className} {...props}>{children}</code>;
    },
    img: ({ node, src, ...props }) => {
      if (typeof src !== 'string' || !src) return null;
      const path = src.replace(/^\.\//, '');
      const imageSrc = taskId && !/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(path)
        ? `/api/tasks/${encodeURIComponent(taskId)}/layout?image=${encodeURIComponent(path)}` : path;
      return <img {...props} loading="lazy" decoding="async" src={imageSrc} />;
    }
  }), [taskId]);
  return <Markdown remarkPlugins={remarkPlugins} rehypePlugins={semanticPlugins} components={components}>{markdown}</Markdown>;
});
