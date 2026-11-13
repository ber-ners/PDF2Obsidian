import React, { useMemo } from 'react';
import { parseReadingVisualsDocument } from '@pdf2obsidian/core/reading-visuals';
import { MermaidRenderer } from './MermaidRenderer';

export interface ReadingVisualsViewProps {
  content: string;
  /** 解析失败时的兜底渲染（旧版流程图笔记） */
  fallback: React.ReactNode;
}

/**
 * Obsidian 端的阅读图解渲染：与 Desktop Web 共用 core 的解析结果，
 * 保证「主线总览 → 逐环图卡 → 机制拆解 → 出处」两端一致。
 */
export const ReadingVisualsView: React.FC<ReadingVisualsViewProps> = ({ content, fallback }) => {
  const document = useMemo(() => parseReadingVisualsDocument(content), [content]);

  if (!document.cards.length) {
    return <>{fallback}</>;
  }

  const jumpTo = (index: number) => {
    const target = window.document.getElementById(`rv-card-${index}`);
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {(document.genre || document.thesis || document.thread.length > 0) && (
        <section
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            padding: '12px 14px',
            borderRadius: '8px',
            border: '1px solid var(--background-modifier-border)',
            borderLeft: '3px solid var(--interactive-accent)',
            background: 'var(--background-secondary)'
          }}
        >
          {document.genre && (
            <span
              style={{
                alignSelf: 'flex-start',
                padding: '2px 8px',
                borderRadius: '999px',
                fontSize: '11px',
                fontWeight: 600,
                color: 'var(--text-muted)',
                background: 'var(--background-primary)'
              }}
            >
              {document.genre}
            </span>
          )}
          {document.thesis && (
            <p style={{ margin: 0, fontSize: '13px', lineHeight: 1.65, color: 'var(--text-normal)' }}>
              {document.thesis}
            </p>
          )}
          {document.thread.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px' }}>
              {document.thread.map((step, index) => (
                <React.Fragment key={`${index}-${step}`}>
                  {index > 0 && (
                    <span style={{ color: 'var(--text-faint)', fontSize: '11px' }}>→</span>
                  )}
                  <button
                    type="button"
                    onClick={() => jumpTo(index)}
                    title={`跳到第 ${index + 1} 环`}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'baseline',
                      gap: '6px',
                      padding: '4px 9px',
                      borderRadius: '6px',
                      border: '1px solid var(--background-modifier-border)',
                      background: 'var(--background-primary)',
                      color: 'var(--text-normal)',
                      fontSize: '12px',
                      cursor: 'pointer',
                      textAlign: 'left'
                    }}
                  >
                    <span style={{ color: 'var(--interactive-accent)', fontWeight: 700, fontSize: '11px' }}>
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <span>{step}</span>
                  </button>
                </React.Fragment>
              ))}
            </div>
          )}
        </section>
      )}

      {document.cards.map((card, index) => {
        const { visual } = card;
        return (
          <article
            key={`${index}-${card.title}`}
            id={`rv-card-${index}`}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '9px',
              padding: '14px',
              borderRadius: '8px',
              border: '1px solid var(--background-modifier-border)',
              background: 'var(--background-primary)'
            }}
          >
            <header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '8px' }}>
              <span style={{ color: 'var(--interactive-accent)', fontSize: '11px', fontWeight: 700 }}>
                {String(index + 1).padStart(2, '0')}
              </span>
              <h4 style={{ margin: 0, flex: '1 1 10rem', fontSize: '15px', fontWeight: 600, color: 'var(--text-normal)' }}>
                {card.title}
              </h4>
              <span
                style={{
                  padding: '2px 7px',
                  borderRadius: '5px',
                  fontSize: '11px',
                  fontWeight: 600,
                  color: 'var(--text-muted)',
                  background: 'var(--background-secondary)'
                }}
              >
                {visual.label}
              </span>
            </header>

            {card.bridge && (
              <p
                style={{
                  margin: 0,
                  padding: '7px 10px',
                  borderRadius: '6px',
                  background: 'var(--background-secondary)',
                  color: 'var(--text-muted)',
                  fontSize: '12.5px',
                  lineHeight: 1.6
                }}
              >
                <strong style={{ marginRight: '6px' }}>衔接</strong>
                {card.bridge}
              </p>
            )}

            <p
              style={{
                margin: 0,
                padding: '7px 10px',
                borderRadius: '6px',
                borderLeft: '2px solid var(--interactive-accent)',
                background: 'var(--background-secondary-alt, var(--background-secondary))',
                color: 'var(--text-normal)',
                fontSize: '13px',
                lineHeight: 1.6
              }}
            >
              <strong style={{ marginRight: '6px', color: 'var(--interactive-accent)' }}>要点</strong>
              {card.takeaway}
            </p>

            {visual.kind === 'diagram' && <MermaidRenderer code={visual.code} maxHeight={500} />}
            {visual.kind === 'table' && (
              <div style={{ overflowX: 'auto', borderRadius: '6px', border: '1px solid var(--background-modifier-border)' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px', lineHeight: 1.5 }}>
                  <thead>
                    <tr style={{ background: 'var(--background-secondary)' }}>
                      {visual.columns.map((col, cIdx) => (
                        <th
                          key={cIdx}
                          style={{
                            padding: '8px 12px',
                            borderBottom: '1px solid var(--background-modifier-border)',
                            textAlign: 'left',
                            fontWeight: 600,
                            color: 'var(--text-normal)',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visual.rows.map((row, rIdx) => (
                      <tr
                        key={rIdx}
                        style={{
                          background: rIdx % 2 === 1 ? 'var(--background-secondary-alt, var(--background-secondary))' : 'transparent'
                        }}
                      >
                        {row.map((cell, cIdx) => (
                          <td
                            key={cIdx}
                            style={{
                              padding: '7px 12px',
                              borderBottom: rIdx === visual.rows.length - 1 ? 'none' : '1px solid var(--background-modifier-border)',
                              color: 'var(--text-normal)'
                            }}
                          >
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {visual.kind === 'diagram' && !visual.valid && (
              <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)' }}>
                这张图未通过语法校验，已保留文字结论并展示源码，可复制出去单独修图。
              </p>
            )}
            {visual.kind === 'none' && visual.reason && (
              <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-faint)' }}>
                {visual.reason}
              </p>
            )}

            {card.breakdown.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)' }}>拆解</span>
                <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '12.5px', lineHeight: 1.65, color: 'var(--text-muted)' }}>
                  {card.breakdown.map((item, itemIndex) => (
                    <li key={`${itemIndex}-${item.slice(0, 12)}`}>{item}</li>
                  ))}
                </ul>
              </div>
            )}

            <footer
              style={{
                paddingTop: '7px',
                borderTop: '1px solid var(--background-modifier-border)',
                fontSize: '12px',
                color: 'var(--text-muted)'
              }}
            >
              <strong style={{ marginRight: '6px' }}>出处</strong>
              {card.source}
            </footer>
          </article>
        );
      })}
    </div>
  );
};
