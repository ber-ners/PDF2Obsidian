import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { App, WorkspaceLeaf, TFile } from 'obsidian';
import { Splitter } from './Splitter';
import { PdfViewport, type ReaderSelectionState } from './PdfViewport';
import { BilingualColumn, renderMathInText } from './BilingualColumn';
import {
  parseMineruBlocks,
  type LayoutBlock,
  createInitialSelectionState,
  updateSelectionState
} from '../../utils/coordinates';
import {
  parseBilingualMarkdown,
  linkBilingualSegments,
  type BilingualSegmentItem,
  renderMathSafely
} from '../../utils/bilingual';
import { MermaidRenderer } from './MermaidRenderer';
import { ReadingVisualsView } from './ReadingVisualsView';

export type RightTabKey = 'bilingual' | 'original' | 'workflow' | 'summary' | 'terms' | 'qa';

export interface AcademicReaderRootProps {
  app: App;
  leaf: WorkspaceLeaf;
  file: TFile | null;
  plugin?: any;
  onClose?: () => void;
}

export const AcademicReaderRoot: React.FC<AcademicReaderRootProps> = ({
  app,
  leaf,
  file,
  plugin,
  onClose
}) => {
  const [pdfData, setPdfData] = useState<ArrayBuffer | null>(null);
  const [blocks, setBlocks] = useState<LayoutBlock[]>([]);
  const [segments, setSegments] = useState<BilingualSegmentItem[]>([]);
  const [originalText, setOriginalText] = useState<string>('');
  const [workflowText, setWorkflowText] = useState<string>('');
  const [summaryText, setSummaryText] = useState<string>('');
  const [termsText, setTermsText] = useState<string>('');
  const [qaText, setQaText] = useState<string>('');

  const [activeTab, setActiveTab] = useState<RightTabKey>('bilingual');
  const [selection, setSelection] = useState<ReaderSelectionState>(createInitialSelectionState);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [paperTitle, setPaperTitle] = useState<string>(file ? file.basename : '学术论文阅读');
  const [availablePapers, setAvailablePapers] = useState<TFile[]>([]);

  // Flowchart generation state
  const [isGeneratingWorkflow, setIsGeneratingWorkflow] = useState<boolean>(false);
  const [workflowError, setWorkflowError] = useState<string | null>(null);

  // Parsing state for in-view trigger
  const [isParsing, setIsParsing] = useState<boolean>(false);
  const [parseStatus, setParseStatus] = useState<string>('');
  const [parseProgress, setParseProgress] = useState<number>(0);

  // Scan vault for papers to offer in empty state
  useEffect(() => {
    if (!file) {
      try {
        const files = app.vault.getFiles();
        const papers = files.filter(
          (f) =>
            f.extension === 'pdf' ||
            f.name.endsWith('.bilingual.md') ||
            f.name.endsWith('.index.md')
        );
        setAvailablePapers(papers);
      } catch (err) {
        console.warn('[PDF2obsidian] Error reading vault files:', err);
      }
    }
  }, [app, file]);

  const loadPaper = useCallback(async (targetFile: TFile) => {
    setLoading(true);
    setError(null);
    setPaperTitle(targetFile.basename);

    try {
      let loadedPdfBuffer: ArrayBuffer | null = null;
      let loadedBlocks: LayoutBlock[] = [];
      let rawSegments: BilingualSegmentItem[] = [];
      let loadedOrig = '';
      let loadedWorkflow = '';
      let loadedSummary = '';
      let loadedTerms = '';
      let loadedQa = '';

      const parentPath = targetFile.parent ? targetFile.parent.path : '';
      const baseName = targetFile.basename.replace(/(\.bilingual|\.index|\.original|\.zh)$/, '');

      // Locate all sibling files in the parent folder
      const allFiles = app.vault.getFiles();
      const siblings = targetFile.parent?.children
        ? (targetFile.parent.children.filter((c): c is TFile => 'extension' in c) as TFile[])
        : allFiles.filter((f) => (parentPath ? f.path.startsWith(parentPath) : true));

      // 1. Locate and load PDF buffer
      let pdfFile: TFile | null = null;
      if (targetFile.extension === 'pdf') {
        pdfFile = targetFile;
      } else {
        // Read file to check for sourcePdf frontmatter
        const text = await app.vault.read(targetFile);
        const match = text.match(/sourcePdf:\s*"?\[\[([^\]]+)\]\]"?/);
        if (match && match[1]) {
          const resolved = app.metadataCache?.getFirstLinkpathDest
            ? app.metadataCache.getFirstLinkpathDest(match[1], targetFile.path)
            : null;
          if (resolved instanceof Object && 'extension' in resolved && (resolved as TFile).extension === 'pdf') {
            pdfFile = resolved as TFile;
          }
        }
        if (!pdfFile) {
          pdfFile = siblings.find((f) => f.extension === 'pdf') || null;
        }
      }

      if (pdfFile) {
        try {
          loadedPdfBuffer = await app.vault.readBinary(pdfFile);
        } catch (e) {
          console.warn('[PDF2obsidian] Failed to read PDF binary:', e);
        }
      }

      // 2. Locate and parse layout JSON (content_list.json or *.layout.json)
      const layoutFile = siblings.find(
        (f) =>
          f.name === 'content_list.json' ||
          f.name.endsWith('.layout.json') ||
          f.name === `${targetFile.basename}.layout.json` ||
          f.name === `${baseName}.layout.json`
      );

      if (layoutFile) {
        try {
          const content = await app.vault.read(layoutFile);
          const parsedJson = JSON.parse(content);
          loadedBlocks = parseMineruBlocks(parsedJson);
        } catch (e) {
          console.warn('[PDF2obsidian] Failed to parse layout json:', e);
        }
      }

      // 3. Locate companion Bilingual note
      const bilingualFile =
        (targetFile.name.endsWith('.bilingual.md') ? targetFile : null) ||
        siblings.find(
          (f) =>
            f.name.endsWith('.bilingual.md') &&
            (f.name.includes(baseName) || siblings.length <= 15 || f.name.startsWith(baseName.slice(0, 15)))
        ) ||
        siblings.find((f) => f.name.endsWith('.bilingual.md'));

      if (bilingualFile) {
        try {
          const content = await app.vault.read(bilingualFile);
          rawSegments = parseBilingualMarkdown(content);
        } catch (e) {
          console.warn('[PDF2obsidian] Failed to read bilingual note:', e);
        }
      }

      // 4. Locate Original note
      const origFile = siblings.find((f) => f.name.endsWith('.original.md'));
      if (origFile) {
        try {
          loadedOrig = await app.vault.read(origFile);
        } catch {}
      }

      // 5. Locate Summary note (摘要.md / summary)
      const summaryFile = siblings.find(
        (f) =>
          f.name === '摘要.md' ||
          f.name.includes('摘要') ||
          f.name.toLowerCase().includes('summary')
      );
      if (summaryFile) {
        try {
          loadedSummary = await app.vault.read(summaryFile);
        } catch {}
      }

      // 6. Locate Terms note (术语表.md / glossary)
      const termsFile = siblings.find(
        (f) =>
          f.name === '术语表.md' ||
          f.name.includes('术语') ||
          f.name.toLowerCase().includes('terms') ||
          f.name.toLowerCase().includes('glossary')
      );
      if (termsFile) {
        try {
          loadedTerms = await app.vault.read(termsFile);
        } catch {}
      }

      // 7. Locate QA note (问答.md / qa)
      const qaFile = siblings.find(
        (f) =>
          f.name === '问答.md' ||
          f.name.includes('问答') ||
          f.name.toLowerCase().includes('qa')
      );
      if (qaFile) {
        try {
          loadedQa = await app.vault.read(qaFile);
        } catch {}
      }

      // 8. Locate reading visuals note (流程图.md / 阅读图解.md / workflow)
      const workflowFile = siblings.find(
        (f) =>
          f.name === '流程图.md' ||
          f.name.includes('流程图') ||
          f.name.includes('阅读图解') ||
          f.name.toLowerCase().includes('workflow') ||
          f.name.toLowerCase().includes('flowchart')
      );
      if (workflowFile) {
        try {
          loadedWorkflow = await app.vault.read(workflowFile);
        } catch {}
      }

      // Link bilingual segments to parsed PDF layout blocks
      const linked = linkBilingualSegments(rawSegments, loadedBlocks);

      setPdfData(loadedPdfBuffer);
      setBlocks(loadedBlocks);
      setSegments(linked);
      setOriginalText(loadedOrig);
      setWorkflowText(loadedWorkflow);
      setSummaryText(loadedSummary);
      setTermsText(loadedTerms);
      setQaText(loadedQa);
      setLoading(false);
    } catch (err: unknown) {
      console.error('[PDF2obsidian] Error loading paper assets:', err);
      setError(`加载论文失败: ${(err as Error).message}`);
      setLoading(false);
    }
  }, [app]);

  // Load paper whenever `file` prop changes
  useEffect(() => {
    if (file) {
      void loadPaper(file);
    } else {
      setPdfData(null);
      setBlocks([]);
      setSegments([]);
      setOriginalText('');
      setWorkflowText('');
      setSummaryText('');
      setTermsText('');
      setQaText('');
      setLoading(false);
    }
  }, [file, loadPaper]);

  // Handle synchronized selection navigation
  const handleSelect = useCallback(
    (id: string, source: 'pdf' | 'markdown') => {
      setSelection((prev) => updateSelectionState(prev, id, source, segments));
    },
    [segments]
  );

  // In-view parsing handler
  const handleStartParsing = async () => {
    if (!file) return;
    if (!plugin || typeof plugin.parseAndOpenPaper !== 'function') {
      setError('插件核心管线未就绪，请在 Obsidian 插件列表中重新启用 PDF2obsidian。');
      return;
    }

    setIsParsing(true);
    setParseStatus('正在提交解析任务到 MinerU...');
    setParseProgress(0.1);

    try {
      await plugin.parseAndOpenPaper(file, (msg: string, pct: number) => {
        setParseStatus(msg);
        setParseProgress(pct);
      });
      // Reload assets
      await loadPaper(file);
    } catch (err: unknown) {
      setParseStatus(`解析失败: ${(err as Error).message}`);
    } finally {
      setIsParsing(false);
    }
  };

  // On-demand reading visuals generation handler (与 Desktop Web / Core 共用同一套生成与清洗逻辑)
  const handleGenerateWorkflow = async () => {
    if (!file) return;
    setIsGeneratingWorkflow(true);
    setWorkflowError(null);

    try {
      const parentPath = file.parent ? file.parent.path : '';
      const originalBody = segments.length
        ? segments.map((s) => s.sourceText || '').join('\n\n')
        : originalText;
      const translatedBody = segments.length
        ? segments.map((s) => s.translatedText || '').join('\n\n')
        : '';

      if (!originalBody.trim() && !translatedBody.trim()) {
        throw new Error('未检测到论文正文内容，请先解析论文或打开含正文的文献笔记。');
      }

      const { buildReadingSourceContext, buildReadingVisualsPrompt, prepareReadingVisuals } = await import(
        '@pdf2obsidian/core/reading-visuals'
      );

      // 提纯正文（剔除参考文献/致谢等）+ 保留全文大纲，避免长论文被掐头去尾。
      const source = buildReadingSourceContext({
        original: originalBody,
        translated: translatedBody,
        maxChars: 24000
      });

      const { LlmClient } = await import('../../pipeline/llm-client');
      const llm = new LlmClient(
        plugin?.settings
          ? {
              provider: plugin.settings.translationProvider,
              baseUrl: plugin.settings.translationBaseUrl,
              apiKey: plugin.settings.translationApiKey,
              model: plugin.settings.translationModel
            }
          : {}
      );

      const prompt = buildReadingVisualsPrompt({
        title: paperTitle,
        context: [`论文标题：${paperTitle}`, '', source.prompt].join('\n')
      });

      const raw = await llm.chatCompletion(
        '你是学术论文阅读辅助编辑。只输出规定格式的 Markdown，不写前言、解释或结语。',
        prompt
      );

      const prepared = prepareReadingVisuals(raw);
      if (!prepared) {
        throw new Error('这次没有生成可用的阅读图卡，请重试。');
      }

      const slug = file.basename.replace(/(\.bilingual|\.index|\.original|\.zh)$/i, '');
      const backlink = `[[${slug}.index]]`;
      const note = [
        '---',
        `title: "${paperTitle} - 阅读图解"`,
        'type: workflow',
        `paperTitle: "${paperTitle.replace(/"/g, "'")}"`,
        `parent: "${backlink}"`,
        `createdAt: ${new Date().toISOString()}`,
        '---',
        `返回索引：${backlink}`,
        '',
        prepared
      ].join('\n');

      const savePath = `${parentPath ? `${parentPath}/` : ''}流程图.md`;
      const { writeVaultNote } = await import('../../pipeline/vault-writer');
      await writeVaultNote(app.vault, savePath, note);
      setWorkflowText(note);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setWorkflowError(msg);
    } finally {
      setIsGeneratingWorkflow(false);
    }
  };

  // Helper to render markdown text with KaTeX formulas and Mermaid diagrams
  const renderFormattedMarkdown = (content: string) => {
    if (!content) {
      return (
        <div style={{ padding: '32px', color: 'var(--text-muted)', textAlign: 'center' }}>
          暂无此内容。可在论文目录下生成或点击右上角重新解析。
        </div>
      );
    }

    // Split markdown by mermaid blocks and render parts
    const mermaidRegex = /```mermaid\s*([\s\S]*?)```/g;
    const elements: React.ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = mermaidRegex.exec(content)) !== null) {
      if (match.index > lastIndex) {
        const textBefore = content.substring(lastIndex, match.index);
        elements.push(
          <div
            key={`txt-${lastIndex}`}
            style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}
          >
            {renderMathInText(textBefore)}
          </div>
        );
      }

      const mermaidCode = match[1];
      elements.push(
        <MermaidRenderer key={`mermaid-${match.index}`} code={mermaidCode} />
      );

      lastIndex = mermaidRegex.lastIndex;
    }

    if (lastIndex < content.length) {
      const restText = content.substring(lastIndex);
      elements.push(
        <div
          key={`txt-${lastIndex}`}
          style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}
        >
          {renderMathInText(restText)}
        </div>
      );
    }

    return elements;
  };

  return (
    <div
      className="pdf2obsidian-reader-container"
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        position: 'relative'
      }}
    >
      {/* Top Header / Navigation Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 16px',
          backgroundColor: 'var(--background-secondary)',
          borderBottom: '1px solid var(--background-modifier-border)',
          flexShrink: 0
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontWeight: 600, color: 'var(--text-normal)' }}>
            📖 {paperTitle}
          </span>
          {loading && (
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              (正在加载...)
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {file && file.extension === 'pdf' && (
            <button
              type="button"
              onClick={handleStartParsing}
              disabled={isParsing}
              title="使用 MinerU + DeepSeek 重新解析该论文"
              style={{
                fontSize: '12px',
                padding: '3px 8px',
                cursor: isParsing ? 'not-allowed' : 'pointer',
                borderRadius: '4px',
                background: 'var(--interactive-normal)',
                color: 'var(--text-normal)'
              }}
            >
              {isParsing ? '⏳ 正在解析...' : '🔄 重新解析'}
            </button>
          )}

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭阅读器"
              style={{
                padding: '2px 8px',
                fontSize: '0.85rem',
                cursor: 'pointer',
                borderRadius: '4px',
                border: '1px solid var(--background-modifier-border)',
                backgroundColor: 'transparent',
                color: 'var(--text-muted)'
              }}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {!file ? (
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '32px',
              textAlign: 'center'
            }}
          >
            <h3 style={{ marginBottom: '12px', color: 'var(--text-normal)' }}>
              📚 PDF2obsidian 学术论文双语阅读器
            </h3>
            <p style={{ color: 'var(--text-muted)', maxWidth: '520px', marginBottom: '24px' }}>
              当前未选择论文。请从下方列表中选择已导入的论文，或在笔记列表右键点击 PDF / 双语笔记以打开阅读器。
            </p>

            {availablePapers.length > 0 ? (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  textAlign: 'left',
                  maxHeight: '320px',
                  overflowY: 'auto',
                  border: '1px solid var(--background-modifier-border)',
                  borderRadius: '6px',
                  padding: '12px',
                  backgroundColor: 'var(--background-primary)'
                }}
              >
                {availablePapers.map((paper) => (
                  <button
                    key={paper.path}
                    type="button"
                    onClick={() => {
                      if (leaf.view && 'setFile' in leaf.view) {
                        void (leaf.view as { setFile: (f: TFile) => Promise<void> }).setFile(paper);
                      }
                    }}
                    style={{
                      textAlign: 'left',
                      padding: '8px 12px',
                      background: 'var(--background-secondary)',
                      border: '1px solid var(--background-modifier-border)',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      color: 'var(--text-normal)'
                    }}
                  >
                    📄 {paper.basename} ({paper.path})
                  </button>
                ))}
              </div>
            ) : (
              <p style={{ fontSize: '0.9rem', color: 'var(--text-faint)' }}>
                Vault 中尚未找到论文文件。
              </p>
            )}
          </div>
        ) : (
          <Splitter>
            {/* Left Column: PDF Viewport with Blue Bounding Boxes */}
            <PdfViewport
              pdfData={pdfData}
              blocks={blocks}
              selection={selection}
              onSelect={handleSelect}
              fileName={paperTitle}
            />

            {/* Right Column: Multi-Tab Academic Reading Assets */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                width: '100%',
                overflow: 'hidden',
                backgroundColor: 'var(--background-primary)'
              }}
            >
              {/* Tab Navigation Header */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '6px 12px',
                  borderBottom: '1px solid var(--background-modifier-border)',
                  backgroundColor: 'var(--background-secondary)',
                  overflowX: 'auto',
                  flexShrink: 0
                }}
              >
                <button
                  type="button"
                  onClick={() => setActiveTab('bilingual')}
                  style={{
                    padding: '4px 10px',
                    fontSize: '12px',
                    fontWeight: activeTab === 'bilingual' ? 600 : 400,
                    borderRadius: '4px',
                    cursor: 'pointer',
                    border: 'none',
                    backgroundColor: activeTab === 'bilingual' ? 'var(--interactive-accent)' : 'transparent',
                    color: activeTab === 'bilingual' ? 'var(--text-on-accent)' : 'var(--text-normal)'
                  }}
                >
                  🌐 中英对照
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('original')}
                  style={{
                    padding: '4px 10px',
                    fontSize: '12px',
                    fontWeight: activeTab === 'original' ? 600 : 400,
                    borderRadius: '4px',
                    cursor: 'pointer',
                    border: 'none',
                    backgroundColor: activeTab === 'original' ? 'var(--interactive-accent)' : 'transparent',
                    color: activeTab === 'original' ? 'var(--text-on-accent)' : 'var(--text-normal)'
                  }}
                >
                  📄 英文原文
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('workflow')}
                  style={{
                    padding: '4px 10px',
                    fontSize: '12px',
                    fontWeight: activeTab === 'workflow' ? 600 : 400,
                    borderRadius: '4px',
                    cursor: 'pointer',
                    border: 'none',
                    backgroundColor: activeTab === 'workflow' ? 'var(--interactive-accent)' : 'transparent',
                    color: activeTab === 'workflow' ? 'var(--text-on-accent)' : 'var(--text-normal)'
                  }}
                >
                  📊 阅读图解
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('summary')}
                  style={{
                    padding: '4px 10px',
                    fontSize: '12px',
                    fontWeight: activeTab === 'summary' ? 600 : 400,
                    borderRadius: '4px',
                    cursor: 'pointer',
                    border: 'none',
                    backgroundColor: activeTab === 'summary' ? 'var(--interactive-accent)' : 'transparent',
                    color: activeTab === 'summary' ? 'var(--text-on-accent)' : 'var(--text-normal)'
                  }}
                >
                  💡 核心速读
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('terms')}
                  style={{
                    padding: '4px 10px',
                    fontSize: '12px',
                    fontWeight: activeTab === 'terms' ? 600 : 400,
                    borderRadius: '4px',
                    cursor: 'pointer',
                    border: 'none',
                    backgroundColor: activeTab === 'terms' ? 'var(--interactive-accent)' : 'transparent',
                    color: activeTab === 'terms' ? 'var(--text-on-accent)' : 'var(--text-normal)'
                  }}
                >
                  📚 术语表
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('qa')}
                  style={{
                    padding: '4px 10px',
                    fontSize: '12px',
                    fontWeight: activeTab === 'qa' ? 600 : 400,
                    borderRadius: '4px',
                    cursor: 'pointer',
                    border: 'none',
                    backgroundColor: activeTab === 'qa' ? 'var(--interactive-accent)' : 'transparent',
                    color: activeTab === 'qa' ? 'var(--text-on-accent)' : 'var(--text-normal)'
                  }}
                >
                  ❓ 深度问答
                </button>
              </div>

              {/* Tab Contents */}
              <div style={{ flex: 1, overflowY: 'auto', position: 'relative' }}>
                {activeTab === 'bilingual' && (
                  segments.length > 0 ? (
                    <BilingualColumn
                      segments={segments}
                      selection={selection}
                      onSelect={(segId, blockId, src) => handleSelect(blockId || segId, src)}
                    />
                  ) : (
                    /* In-View Parsing Prompt Card when no bilingual assets exist */
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '48px 24px',
                        textAlign: 'center',
                        height: '100%'
                      }}
                    >
                      <div style={{ fontSize: '36px', marginBottom: '16px' }}>🚀</div>
                      <h3 style={{ margin: '0 0 8px 0', fontSize: '18px', fontWeight: 600, color: 'var(--text-normal)' }}>
                        一键解析并生成中英双语精读
                      </h3>
                      <p
                        style={{
                          color: 'var(--text-muted)',
                          fontSize: '13px',
                          lineHeight: 1.6,
                          maxWidth: '420px',
                          margin: '0 0 24px 0'
                        }}
                      >
                        当前 PDF 尚未提取版面公式或生成双语对照笔记。点击下方按钮，由 MinerU 提取高精度版面坐标与公式，并通过 DeepSeek 智能生成段落对齐与学术精读卡片。
                      </p>

                      {isParsing ? (
                        <div style={{ width: '100%', maxWidth: '360px', textAlign: 'center' }}>
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              fontSize: '12px',
                              marginBottom: '8px'
                            }}
                          >
                            <span style={{ color: 'var(--interactive-accent)', fontWeight: 500 }}>
                              {parseStatus || '正在解析中...'}
                            </span>
                            <span style={{ color: 'var(--text-muted)' }}>
                              {Math.round(parseProgress * 100)}%
                            </span>
                          </div>
                          <div
                            style={{
                              width: '100%',
                              height: '8px',
                              backgroundColor: 'var(--background-modifier-border)',
                              borderRadius: '4px',
                              overflow: 'hidden'
                            }}
                          >
                            <div
                              style={{
                                width: `${Math.max(5, parseProgress * 100)}%`,
                                height: '100%',
                                backgroundColor: 'var(--interactive-accent)',
                                transition: 'width 0.3s ease'
                              }}
                            />
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="mod-cta"
                          onClick={handleStartParsing}
                          style={{
                            padding: '10px 24px',
                            fontSize: '14px',
                            fontWeight: 600,
                            borderRadius: '6px',
                            cursor: 'pointer',
                            backgroundColor: 'var(--interactive-accent)',
                            color: 'var(--text-on-accent)',
                            border: 'none',
                            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)'
                          }}
                        >
                          🚀 一键解析并生成双语对照
                        </button>
                      )}
                    </div>
                  )
                )}

                {activeTab === 'original' && (
                  <div style={{ padding: '24px', lineHeight: 1.6 }}>
                    {renderFormattedMarkdown(originalText)}
                  </div>
                )}

                {activeTab === 'workflow' && (
                  <div style={{ padding: '24px', lineHeight: 1.6, flex: 1, minHeight: 0, height: '100%', overflowY: 'auto' }}>
                    {workflowText ? (
                      <div>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            marginBottom: '16px',
                            paddingBottom: '12px',
                            borderBottom: '1px solid var(--background-modifier-border)'
                          }}
                        >
                          <div>
                            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: 'var(--text-normal)' }}>
                              📊 阅读图解 (Reading Visuals)
                            </h3>
                            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                              沿全文逻辑主线逐环出图，Pele 渲染 Mermaid
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={handleGenerateWorkflow}
                            disabled={isGeneratingWorkflow}
                            style={{
                              padding: '4px 12px',
                              fontSize: '12px',
                              borderRadius: '4px',
                              cursor: isGeneratingWorkflow ? 'not-allowed' : 'pointer',
                              border: '1px solid var(--background-modifier-border)',
                              background: 'var(--background-secondary)',
                              color: 'var(--text-normal)'
                            }}
                          >
                            {isGeneratingWorkflow ? '⏳ 正在重新生成阅读图解...' : '🔄 重新生成阅读图解'}
                          </button>
                        </div>
                        {workflowError && (
                          <div
                            style={{
                              padding: '8px 12px',
                              marginBottom: '12px',
                              borderRadius: '4px',
                              backgroundColor: 'var(--background-modifier-error)',
                              color: 'var(--text-error)',
                              fontSize: '12px'
                            }}
                          >
                            生成失败: {workflowError}
                          </div>
                        )}
                        <ReadingVisualsView
                          content={workflowText}
                          fallback={renderFormattedMarkdown(workflowText)}
                        />
                      </div>
                    ) : (
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          padding: '48px 24px',
                          textAlign: 'center',
                          height: '100%'
                        }}
                      >
                        <div style={{ fontSize: '36px', marginBottom: '16px' }}>📊</div>
                        <h3 style={{ margin: '0 0 8px 0', fontSize: '18px', fontWeight: 600, color: 'var(--text-normal)' }}>
                          让图承担解释，而不是装饰
                        </h3>
                        <p
                          style={{
                            color: 'var(--text-muted)',
                            fontSize: '13px',
                            lineHeight: 1.6,
                            maxWidth: '440px',
                            margin: '0 0 24px 0'
                          }}
                        >
                          暂无阅读图解。点击下方按钮，AI 会先梳理全文逻辑主线（体裁 / 主旨 / 2–5 个递进环节），再逐环生成图卡：衔接上一环、给出读图要点、画出机制图并标注原文出处。
                        </p>
                        {workflowError && (
                          <div
                            style={{
                              padding: '8px 12px',
                              marginBottom: '16px',
                              borderRadius: '4px',
                              backgroundColor: 'var(--background-modifier-error)',
                              color: 'var(--text-error)',
                              fontSize: '12px',
                              maxWidth: '440px'
                            }}
                          >
                            生成失败: {workflowError}
                          </div>
                        )}
                        <button
                          type="button"
                          className="mod-cta"
                          onClick={handleGenerateWorkflow}
                          disabled={isGeneratingWorkflow}
                          style={{
                            padding: '10px 24px',
                            fontSize: '14px',
                            fontWeight: 600,
                            borderRadius: '6px',
                            cursor: isGeneratingWorkflow ? 'not-allowed' : 'pointer',
                            backgroundColor: 'var(--interactive-accent)',
                            color: 'var(--text-on-accent)',
                            border: 'none',
                            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)'
                          }}
                        >
                          {isGeneratingWorkflow ? '⏳ 正在梳理主线并生成图解...' : '⚡ 立即生成阅读图解'}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {activeTab === 'summary' && (
                  <div style={{ padding: '24px', lineHeight: 1.6 }}>
                    {renderFormattedMarkdown(summaryText)}
                  </div>
                )}

                {activeTab === 'terms' && (
                  <div style={{ padding: '24px', lineHeight: 1.6 }}>
                    {renderFormattedMarkdown(termsText)}
                  </div>
                )}

                {activeTab === 'qa' && (
                  <div style={{ padding: '24px', lineHeight: 1.6 }}>
                    {renderFormattedMarkdown(qaText)}
                  </div>
                )}
              </div>
            </div>
          </Splitter>
        )}
      </div>
    </div>
  );
};
