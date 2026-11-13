'use client';

import { Children, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

const storageKey = 'pdf2obsidian.reader.split';

/** Resize only this grid, without re-rendering the Markdown document on every move. */
export function ReaderSplit({ children }: { children: ReactNode }) {
  const [preview, output] = Children.toArray(children);
  const root = useRef<HTMLDivElement>(null);
  const share = useRef(.5);
  const [value, setValue] = useState(50);
  const [resizing, setResizing] = useState(false);

  function update(next: number, persist = false) {
    const width = (root.current?.clientWidth ?? 1000) - 8;
    const minimum = Math.min(.5, 240 / Math.max(1, width));
    share.current = Math.max(minimum, Math.min(1 - minimum, next));
    root.current?.style.setProperty('--pdf-share', `${share.current}fr`);
    root.current?.style.setProperty('--output-share', `${1 - share.current}fr`);
    setValue(Math.round(share.current * 100));
    if (persist) {
      try { localStorage.setItem(storageKey, String(share.current)); } catch { /* Storage is optional. */ }
    }
  }

  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(storageKey));
      if (saved > 0 && saved < 1) update(saved);
    } catch { /* Use an even split when storage is unavailable. */ }
  }, []);

  return <div className="reader-split" ref={root} data-with-output={Boolean(output)} data-resizing={resizing}>
    {preview}
    {output ? <>
      <div className="reader-divider" role="separator" tabIndex={0} aria-label="调整 PDF 与结果宽度"
        aria-orientation="vertical" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}
        aria-valuetext={`PDF ${value}%，结果 ${100 - value}%`}
        title="拖动调整宽度；双击恢复均分；方向键微调"
        onDoubleClick={() => update(.5, true)}
        onKeyDown={(event) => {
          const next = event.key === 'ArrowLeft' ? share.current - .02 : event.key === 'ArrowRight' ? share.current + .02
            : event.key === 'Home' ? 0 : event.key === 'End' ? 1 : event.key === 'Enter' ? .5 : undefined;
          if (next === undefined) return;
          event.preventDefault(); update(next, true);
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault(); event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId); setResizing(true);
        }}
        onPointerMove={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId) || !root.current) return;
          const rect = root.current.getBoundingClientRect();
          update((event.clientX - rect.left - 4) / (rect.width - 8));
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          update(share.current, true); setResizing(false);
        }}
        onLostPointerCapture={() => setResizing(false)}
        onPointerCancel={() => setResizing(false)}
      ><span /></div>
      {output}
    </> : null}
  </div>;
}
