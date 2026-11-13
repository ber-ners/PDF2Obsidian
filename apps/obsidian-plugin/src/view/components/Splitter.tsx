import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  DEFAULT_STORAGE_KEY,
  DEFAULT_SPLIT_RATIO,
  MIN_SPLIT_RATIO,
  MAX_SPLIT_RATIO,
  clampSplitRatio,
  stepSplitRatio
} from '../../utils/coordinates';

export interface SplitterProps {
  children: [React.ReactNode, React.ReactNode];
  storageKey?: string;
  minRatio?: number;
  maxRatio?: number;
}

export const Splitter: React.FC<SplitterProps> = ({
  children,
  storageKey = DEFAULT_STORAGE_KEY,
  minRatio = MIN_SPLIT_RATIO,
  maxRatio = MAX_SPLIT_RATIO
}) => {
  const [leftPane, rightPane] = children;
  const containerRef = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = parseFloat(saved);
        if (!isNaN(parsed) && parsed >= minRatio && parsed <= maxRatio) {
          return parsed;
        }
      }
    } catch {
      // Ignore localStorage access errors
    }
    return DEFAULT_SPLIT_RATIO;
  });

  const [isDragging, setIsDragging] = useState(false);
  const ratioRef = useRef(ratio);
  ratioRef.current = ratio;

  const clamp = useCallback(
    (val: number): number => clampSplitRatio(val, minRatio, maxRatio),
    [minRatio, maxRatio]
  );

  const updateRatio = useCallback(
    (newRatio: number, persist = false) => {
      const clamped = clamp(parseFloat(newRatio.toFixed(4)));
      setRatio(clamped);
      if (persist) {
        try {
          localStorage.setItem(storageKey, clamped.toString());
        } catch {
          // Ignore localStorage errors
        }
      }
    },
    [clamp, storageKey]
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    target.focus();
    setIsDragging(true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    if (rect.width <= 0) return;
    const offset = e.clientX - rect.left;
    const newRatio = offset / rect.width;
    updateRatio(newRatio, false);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDragging) {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      setIsDragging(false);
      updateRatio(ratioRef.current, true);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    let next: number | undefined;
    if (e.key === 'ArrowLeft') {
      next = stepSplitRatio(ratioRef.current, -0.02, minRatio, maxRatio);
    } else if (e.key === 'ArrowRight') {
      next = stepSplitRatio(ratioRef.current, 0.02, minRatio, maxRatio);
    } else if (e.key === 'Home') {
      next = minRatio;
    } else if (e.key === 'End') {
      next = maxRatio;
    } else if (e.key === 'Enter') {
      next = DEFAULT_SPLIT_RATIO;
    }

    if (next !== undefined) {
      e.preventDefault();
      updateRatio(next, true);
    }
  };

  const handleDoubleClick = () => {
    updateRatio(DEFAULT_SPLIT_RATIO, true);
  };

  const leftPercent = `${(ratio * 100).toFixed(2)}%`;
  const rightPercent = `${((1 - ratio) * 100).toFixed(2)}%`;

  return (
    <div
      ref={containerRef}
      className="pdf2obsidian-split-pane"
      data-resizing={isDragging}
      style={{
        display: 'flex',
        flexDirection: 'row',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        userSelect: isDragging ? 'none' : 'auto'
      }}
    >
      <div
        className="pdf2obsidian-split-left"
        style={{
          width: leftPercent,
          minWidth: `${minRatio * 100}%`,
          maxWidth: `${maxRatio * 100}%`,
          height: '100%',
          overflow: 'hidden'
        }}
      >
        {leftPane}
      </div>

      <div
        role="separator"
        tabIndex={0}
        className="pdf2obsidian-splitter"
        aria-orientation="vertical"
        aria-valuenow={Math.round(ratio * 100)}
        aria-valuemin={Math.round(minRatio * 100)}
        aria-valuemax={Math.round(maxRatio * 100)}
        aria-label="拖动调整左右分栏比例"
        title="拖动调整分栏比例；双击重置为50%；方向键微调"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => setIsDragging(false)}
        onLostPointerCapture={() => setIsDragging(false)}
        onDoubleClick={handleDoubleClick}
        onKeyDown={handleKeyDown}
      />

      <div
        className="pdf2obsidian-split-right"
        style={{
          width: rightPercent,
          minWidth: `${(1 - maxRatio) * 100}%`,
          maxWidth: `${(1 - minRatio) * 100}%`,
          height: '100%',
          overflow: 'hidden'
        }}
      >
        {rightPane}
      </div>
    </div>
  );
};
