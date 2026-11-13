'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';

type ObserveBlock = (node: HTMLElement, reveal: () => void) => () => void;
const ViewportContext = createContext<ObserveBlock | null>(null);

/** One intersection observer per document; scrolling never scans blocks or sets state. */
export function MarkdownViewport({ children, ...props }: HTMLAttributes<HTMLElement>) {
  const article = useRef<HTMLElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const bottomPinned = useRef(false);
  const observer = useRef<IntersectionObserver | null>(null);
  const pending = useRef(new Map<HTMLElement, () => void>());
  const observe = useCallback<ObserveBlock>((node, reveal) => {
    pending.current.set(node, reveal);
    observer.current?.observe(node);
    return () => {
      pending.current.delete(node);
      observer.current?.unobserve(node);
    };
  }, []);

  useEffect(() => {
    if (!article.current) return;
    if (typeof IntersectionObserver === 'undefined') {
      pending.current.forEach((reveal) => reveal());
      pending.current.clear();
      return;
    }
    const blocks = pending.current;
    const intersection = new IntersectionObserver((entries) => {
      const viewport = article.current;
      if (viewport && viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= 4) bottomPinned.current = true;
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const reveal = blocks.get(entry.target as HTMLElement);
        blocks.delete(entry.target as HTMLElement);
        intersection.unobserve(entry.target);
        reveal?.();
      }
    }, { root: article.current, rootMargin: '1600px 0px' });
    observer.current = intersection;
    blocks.forEach((_, node) => intersection.observe(node));
    return () => {
      intersection.disconnect();
      observer.current = null;
    };
  }, []);

  // Only follow height changes after the reader actually reaches the end. This also
  // covers late image loads; scrolling upward immediately releases the bottom anchor.
  useEffect(() => {
    const viewport = article.current;
    if (!viewport || !content.current) return;
    let lastTop = viewport.scrollTop;
    const onScroll = () => {
      if (viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= 4) bottomPinned.current = true;
      else if (viewport.scrollTop < lastTop - 1) bottomPinned.current = false;
      lastTop = viewport.scrollTop;
    };
    const onWheel = (event: WheelEvent) => { if (event.deltaY < 0) bottomPinned.current = false; };
    const onKeyDown = (event: KeyboardEvent) => {
      if (['ArrowUp', 'PageUp', 'Home'].includes(event.key) || (event.key === ' ' && event.shiftKey)) bottomPinned.current = false;
    };
    const resize = new ResizeObserver(() => {
      if (bottomPinned.current) viewport.scrollTop = viewport.scrollHeight - viewport.clientHeight;
    });
    resize.observe(content.current);
    viewport.addEventListener('scroll', onScroll, { passive: true });
    viewport.addEventListener('wheel', onWheel, { passive: true });
    viewport.addEventListener('keydown', onKeyDown);
    return () => {
      resize.disconnect();
      viewport.removeEventListener('scroll', onScroll);
      viewport.removeEventListener('wheel', onWheel);
      viewport.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  return <ViewportContext.Provider value={observe}>
    <article tabIndex={0} aria-label="Markdown 正文" {...props} ref={article}>
      <div ref={content}>{children}</div>
    </article>
  </ViewportContext.Provider>;
}

/** Keep visited Markdown mounted; the browser skips layout/paint outside the viewport. */
export function DeferredMarkdownBlock({ children, estimatedHeight, eager = false, forceRender = false, className = '', style, ...props }: {
  children: ReactNode;
  estimatedHeight: number;
  eager?: boolean;
  forceRender?: boolean;
} & HTMLAttributes<HTMLElement>) {
  const node = useRef<HTMLElement>(null);
  const observe = useContext(ViewportContext);
  const [visited, setVisited] = useState(eager);
  const mounted = visited || forceRender;

  useEffect(() => {
    if (mounted) {
      if (!visited) setVisited(true);
      return;
    }
    if (!node.current) return;
    if (!observe || typeof IntersectionObserver === 'undefined') { setVisited(true); return; }
    return observe(node.current, () => setVisited(true));
  }, [mounted, visited, observe]);

  return <section {...props} ref={node} className={`deferred-md-block ${className}`} data-mounted={mounted ? 'true' : 'false'}
    style={{ ...style, '--md-block-height': `${estimatedHeight}px`,
      ...(mounted ? undefined : { height: estimatedHeight, overflow: 'hidden' }),
      // A selected destination must have real geometry before the layout effect scrolls.
      ...(forceRender ? { contentVisibility: 'visible' } : undefined)
    } as CSSProperties}>
    {mounted ? children : null}
  </section>;
}

/** Explicit PDF navigation is immediate and only scrolls the Markdown pane. */
export function scrollToMarkdownBlock(node: HTMLElement) {
  const viewport = node.closest<HTMLElement>('.markdown-preview');
  if (!viewport) return;
  const top = node.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop;
  viewport.scrollTo({ top: Math.max(0, top - Math.max(0, (viewport.clientHeight - node.offsetHeight) / 2)), behavior: 'auto' });
}
