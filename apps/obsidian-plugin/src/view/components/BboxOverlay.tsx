import React from 'react';
import { calculateBboxStyles, type LayoutBlock } from '../../utils/coordinates';

export interface BboxOverlayProps {
  block: LayoutBlock;
  isActive: boolean;
  onSelect: (blockId: string, source: 'pdf') => void;
  pageNumber: number;
}

const ROLE_LABELS: Record<string, string> = {
  title: '标题',
  body: '正文',
  equation: '公式',
  table: '表格',
  image: '图片',
  caption: '图表注释',
  footnote: '脚注',
  reference: '参考文献',
  header: '页眉',
  footer: '页脚'
};

export const BboxOverlay: React.FC<BboxOverlayProps> = ({
  block,
  isActive,
  onSelect,
  pageNumber
}) => {
  const styles = calculateBboxStyles(block.bbox);
  if (!styles) {
    return null;
  }

  const roleLabel = ROLE_LABELS[block.role] || '正文';
  const cleanExcerpt = block.markdown.replace(/[#*$`]/g, '').trim().slice(0, 60);
  const label = cleanExcerpt ? `${roleLabel}：${cleanExcerpt}` : roleLabel;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    // Resolve to parent block ID if continuation
    const targetId = block.continuationOf || block.id;
    onSelect(targetId, 'pdf');
  };

  return (
    <div
      role="button"
      tabIndex={0}
      className="pdf2obsidian-bbox pdf-block-box"
      data-block-id={block.id}
      data-role={block.role}
      data-active={isActive}
      data-continuation-of={block.continuationOf}
      aria-label={label}
      aria-pressed={isActive}
      title={`${roleLabel} · 第 ${pageNumber} 页 · 点击定位右侧内容`}
      style={{
        position: 'absolute',
        left: styles.left,
        top: styles.top,
        width: styles.width,
        height: styles.height,
        boxSizing: 'border-box',
        cursor: 'pointer',
        background: 'transparent',
        backgroundColor: isActive ? 'rgba(14, 165, 233, 0.2)' : 'transparent',
        border: isActive
          ? '2px solid var(--interactive-accent, #0284c7)'
          : '1px dashed rgba(14, 165, 233, 0.45)',
        boxShadow: isActive ? '0 0 0 2px rgba(14, 165, 233, 0.25)' : 'none',
        borderRadius: '2px',
        padding: 0,
        margin: 0,
        zIndex: isActive ? 20 : 2
      }}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          const targetId = block.continuationOf || block.id;
          onSelect(targetId, 'pdf');
        }
      }}
    />
  );
};
