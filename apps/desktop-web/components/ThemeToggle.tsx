'use client';

import { useEffect, useState } from 'react';

type ThemeMode = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'pdf2obsidian.theme';

function applyTheme(mode: ThemeMode) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (mode === 'light' || mode === 'dark') {
    root.dataset.theme = mode;
  } else {
    delete root.dataset.theme;
  }
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeMode>('light');

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY) as ThemeMode | null;
      if (saved === 'light' || saved === 'dark' || saved === 'system') {
        setTheme(saved);
        applyTheme(saved);
      }
    } catch {
      // Ignore storage access errors
    }
  }, []);

  function cycleTheme() {
    const order: ThemeMode[] = ['system', 'light', 'dark'];
    const next = order[(order.indexOf(theme) + 1) % order.length];
    setTheme(next);
    applyTheme(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Ignore storage access errors
    }
  }

  const label = theme === 'system' ? '自动' : theme === 'light' ? '浅色' : '深色';
  const icon = theme === 'system' ? '◐' : theme === 'light' ? '☀' : '☾';

  return (
    <button
      className="icon-link theme-toggle"
      type="button"
      onClick={cycleTheme}
      title={`外观模式：${label}（点击切换浅色 / 深色 / 跟随系统）`}
      aria-label={`外观模式：${label}`}
    >
      <span className="theme-toggle-icon" aria-hidden="true">{icon}</span>
      <span>{label}</span>
    </button>
  );
}
