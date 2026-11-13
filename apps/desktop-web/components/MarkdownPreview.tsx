'use client';

import { memo, useMemo } from 'react';
import { MarkdownContent } from './MarkdownContent';

export const MarkdownPreview = memo(function MarkdownPreview({
  content,
  taskId,
  emptyText = '任务完成后会在这里显示生成内容。',
  emptyTitle = '暂无输出内容'
}: {
  content?: string;
  taskId?: string;
  emptyText?: string;
  emptyTitle?: string;
}) {
  const displayContent = useMemo(() => (content ?? '')
    .replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '').trim(), [content]);
  const renderedContent = useMemo(() => (
    <MarkdownContent markdown={displayContent} taskId={taskId} />
  ), [displayContent, taskId]);

  if (!displayContent) {
    return <div className="markdown-preview empty-output">
      <strong>{emptyTitle}</strong>
      <span>{emptyText}</span>
    </div>;
  }

  return <article className="markdown-preview">{renderedContent}</article>;
});
