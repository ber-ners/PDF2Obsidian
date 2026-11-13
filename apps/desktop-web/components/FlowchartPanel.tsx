'use client';

import { memo, useCallback, useMemo, useState } from 'react';
import { parseReadingVisualsDocument, type ReadingVisualCard } from '@pdf2obsidian/core/reading-visuals';
import { MarkdownContent } from './MarkdownContent';
import { MarkdownPreview } from './MarkdownPreview';
import { MermaidRenderer } from './MermaidRenderer';

interface FlowchartPanelProps {
  taskId?: string;
  content?: string;
  onGenerated?: (content: string) => void;
}

export const FlowchartPanel = memo(function FlowchartPanel({ taskId, content, onGenerated }: FlowchartPanelProps) {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string>();
  const document = useMemo(() => parseReadingVisualsDocument(content), [content]);
  const cards = document.cards;
  const hasLegacyContent = Boolean(content?.trim()) && !cards.length;

  const scrollToCard = useCallback((index: number) => {
    const target = window.document.getElementById(`reading-visual-${index}`);
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  async function generate() {
    if (!taskId || generating) return;
    setGenerating(true);
    setError(undefined);

    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/flowchart`, { method: 'POST' });
      const data = (await response.json()) as { content?: string; error?: string };
      if (!response.ok || !data.content) {
        throw new Error(data.error || `请求失败（${response.status}）`);
      }
      onGenerated?.(data.content);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="reading-visuals-panel" aria-busy={generating}>
      <header className="reading-visuals-header">
        <div>
          <h2>阅读图解</h2>
          <p>顺着论文的逻辑主线读图，一张图回答一个必须看懂的问题。</p>
        </div>
        <button type="button" className={cards.length ? 'ghost-button' : 'primary-button'} disabled={generating || !taskId} onClick={generate}>
          {generating ? '正在生成…' : cards.length ? '重新生成' : '生成图卡'}
        </button>
      </header>

      {error && <p className="reading-visuals-error" role="alert">{error}</p>}

      {cards.length ? (
        <>
          <Overview document={document} onJump={scrollToCard} />
          <div className="reading-visuals-flow">
            {cards.map((card, index) => (
              <Card key={`${index}-${card.title}`} card={card} index={index} />
            ))}
          </div>
        </>
      ) : (
        <div className="reading-visuals-empty" role="status">
          <strong>{generating ? '正在整理图卡' : hasLegacyContent ? '这篇论文已有旧版流程图' : '还没有阅读图卡'}</strong>
          <p>
            {generating
              ? '正在先梳理全文逻辑主线，再逐环出图。'
              : hasLegacyContent
                ? '重新生成后，会按「环节衔接 → 核心要点 → 图表 → 机制拆解」重排。'
                : '生成后，每张图都会带上衔接上一环的逻辑、读图要点与原文出处。'}
          </p>
        </div>
      )}

      {hasLegacyContent && (
        <details className="reading-visuals-legacy">
          <summary>查看旧版内容</summary>
          <MarkdownPreview content={content} taskId={taskId} />
        </details>
      )}
    </div>
  );
});

function Overview({
  document,
  onJump
}: {
  document: ReturnType<typeof parseReadingVisualsDocument>;
  onJump: (index: number) => void;
}) {
  if (!document.genre && !document.thesis && !document.thread.length) return null;

  return (
    <section className="reading-visuals-overview" aria-label="全文逻辑主线">
      <div className="reading-visuals-overview-head">
        {document.genre && <span className="reading-visual-genre">{document.genre}</span>}
        {document.thesis && <p className="reading-visuals-thesis">{document.thesis}</p>}
      </div>
      {document.thread.length > 0 && (
        <ol className="reading-visuals-thread">
          {document.thread.map((step, index) => (
            <li key={`${index}-${step}`}>
              <button type="button" onClick={() => onJump(index)} title={`跳到第 ${index + 1} 环`}>
                <span className="reading-visuals-thread-index">{String(index + 1).padStart(2, '0')}</span>
                <span className="reading-visuals-thread-label">{step}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Card({ card, index }: { card: ReadingVisualCard; index: number }) {
  const { visual } = card;
  const diagramBroken = visual.kind === 'diagram' && !visual.valid;

  return (
    <article className="reading-visual-card" id={`reading-visual-${index}`}>
      <div className="reading-visual-card-heading">
        <span className="reading-visual-number">{String(index + 1).padStart(2, '0')}</span>
        <h3>{card.title}</h3>
        <span className="reading-visual-label">{visual.label}</span>
      </div>

      {card.bridge && (
        <p className="reading-visual-bridge">
          <span>衔接</span>
          {card.bridge}
        </p>
      )}

      <p className="reading-visual-takeaway">
        <span>要点</span>
        {card.takeaway}
      </p>

      {visual.kind === 'diagram' && <MermaidRenderer code={visual.code} compact maxHeight={500} />}
      {visual.kind === 'table' && (
        <div className="reading-visual-table">
          <MarkdownContent markdown={visual.markdown} />
        </div>
      )}
      {diagramBroken && (
        <p className="reading-visual-warning">
          这张图的语法未通过校验，已保留上方文字结论并展示源码，可直接改源码或复制到别处修图。
        </p>
      )}

      {card.breakdown.length > 0 && (
        <div className="reading-visual-breakdown">
          <span className="reading-visual-breakdown-title">拆解</span>
          <ul>
            {card.breakdown.map((item, itemIndex) => (
              <li key={`${itemIndex}-${item.slice(0, 12)}`}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      <p className="reading-visual-source"><span>出处</span> {card.source}</p>
    </article>
  );
}
