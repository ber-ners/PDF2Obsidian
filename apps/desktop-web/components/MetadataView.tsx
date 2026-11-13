'use client';

import { useMemo } from 'react';
import { createMetadataRows, parsePaperMetadata } from '../lib/paper-metadata';

export function MetadataView({ content }: { content?: string }) {
  const metadata = useMemo(() => parsePaperMetadata(content ?? ''), [content]);
  const rows = createMetadataRows(metadata);
  if (!rows.length) return (
    <div className="structured-empty">
      <strong>暂无论文信息</strong>
      <span>任务完成后会在这里展示标题、作者、DOI、来源和关键词。</span>
    </div>
  );
  return (
    <div className="metadata-view">
      <div className="metadata-title">
        <span>论文信息</span>
        <strong>{metadata.translatedTitle || metadata.paperTitle || metadata.title || '未命名论文'}</strong>
      </div>
      <div className="metadata-grid">
        {rows.map((row) => (
          <div className="metadata-row" key={row.label}>
            <span>{row.label}</span>
            <strong>{row.value}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}
