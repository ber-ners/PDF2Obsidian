import type {
  LlmClientConfig,
  MarkdownChunk,
  ReadingAssetsResult,
  TranslationResult
} from '../types/pipeline';

/**
 * Splits markdown content into semantic sections based on headings (#, ##, etc.).
 * Preserves code fences and display math blocks without breaking them apart.
 */
function splitIntoSections(markdown: string): Array<{
  heading: string | null;
  paragraphs: string[];
  raw: string;
}> {
  if (!markdown) return [];
  const lines = markdown.split('\n');
  const sections: Array<{ heading: string | null; paragraphs: string[]; raw: string }> = [];

  let currentHeading: string | null = null;
  let currentParas: string[] = [];
  let buffer: string[] = [];
  let inCodeFence = false;
  let inMathBlock = false;

  const flushBuffer = () => {
    if (buffer.length > 0) {
      const p = buffer.join('\n').trim();
      if (p) currentParas.push(p);
      buffer = [];
    }
  };

  const flushSection = () => {
    flushBuffer();
    if (currentHeading || currentParas.length > 0) {
      sections.push({
        heading: currentHeading,
        paragraphs: [...currentParas],
        raw: (currentHeading ? currentHeading + '\n\n' : '') + currentParas.join('\n\n')
      });
    }
    currentHeading = null;
    currentParas = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (!inMathBlock && trimmed.startsWith('```')) {
      if (trimmed.endsWith('```') && trimmed.length > 3 && trimmed.slice(3).includes('```')) {
        buffer.push(line);
        continue;
      }
      inCodeFence = !inCodeFence;
      buffer.push(line);
      continue;
    }

    if (!inCodeFence && trimmed.startsWith('$$')) {
      if (trimmed.endsWith('$$') && trimmed.length > 2 && trimmed.slice(2).includes('$$')) {
        buffer.push(line);
        continue;
      }
      inMathBlock = !inMathBlock;
      buffer.push(line);
      continue;
    }

    if (!inCodeFence && !inMathBlock && /^#{1,6}\s+/.test(line)) {
      flushSection();
      currentHeading = line.trim();
    } else if (!inCodeFence && !inMathBlock && trimmed === '') {
      flushBuffer();
    } else {
      buffer.push(line);
    }
  }

  flushSection();
  return sections;
}

/**
 * Splits Markdown text into structural chunks for translation.
 * Respects heading hierarchy, code blocks, and math blocks.
 */
export function chunkMarkdown(markdown: string, chunkCharLimit = 2000): MarkdownChunk[] {
  const sections = splitIntoSections(markdown);
  const chunks: MarkdownChunk[] = [];
  let currentChunk = '';
  let currentHeadingPath: string[] = [];
  let chunkIndex = 0;

  for (const sec of sections) {
    const secHeading = sec.heading ? sec.heading.replace(/^#+\s*/, '') : '';

    // If section itself is larger than the limit, split its paragraphs
    if (sec.raw.length > chunkCharLimit && sec.paragraphs.length > 1) {
      if (currentChunk.trim()) {
        chunks.push({
          index: chunkIndex++,
          headingPath: [...currentHeadingPath],
          content: currentChunk.trim()
        });
        currentChunk = '';
      }

      if (secHeading) {
        currentHeadingPath = [secHeading];
      }

      let subChunk = sec.heading ? sec.heading + '\n\n' : '';
      for (const p of sec.paragraphs) {
        if ((subChunk.length + p.length) > chunkCharLimit && subChunk.trim()) {
          chunks.push({
            index: chunkIndex++,
            headingPath: [...currentHeadingPath],
            content: subChunk.trim()
          });
          subChunk = '';
        }
        subChunk += (subChunk ? '\n\n' : '') + p;
      }
      if (subChunk.trim()) {
        chunks.push({
          index: chunkIndex++,
          headingPath: [...currentHeadingPath],
          content: subChunk.trim()
        });
      }
      continue;
    }

    if (currentChunk.length + sec.raw.length > chunkCharLimit && currentChunk.length > 0) {
      chunks.push({
        index: chunkIndex++,
        headingPath: [...currentHeadingPath],
        content: currentChunk.trim()
      });
      currentChunk = '';
    }

    if (secHeading) {
      currentHeadingPath = [secHeading];
    }
    currentChunk += (currentChunk ? '\n\n' : '') + sec.raw;
  }

  if (currentChunk.trim()) {
    chunks.push({
      index: chunkIndex++,
      headingPath: currentHeadingPath,
      content: currentChunk.trim()
    });
  }

  // If input was non-empty but somehow yielded no chunks, return whole input
  if (chunks.length === 0 && markdown.trim()) {
    chunks.push({
      index: 0,
      headingPath: [],
      content: markdown.trim()
    });
  }

  return chunks;
}

/**
 * Creates aligned bilingual markdown text:
 * - Pairs headings with an ideographic space '\u3000'
 * - Interleaves English and Chinese body paragraphs 1:1
 * - Preserves code blocks, equations, and images without duplication
 */
export function createBilingualMarkdown(sourceMd: string, targetMd: string): string {
  const sourceSections = splitIntoSections(sourceMd);
  const targetSections = splitIntoSections(targetMd);

  const combinedSections: string[] = [];
  const maxSec = Math.max(sourceSections.length, targetSections.length);

  for (let i = 0; i < maxSec; i++) {
    const src = sourceSections[i];
    const tgt = targetSections[i];

    if (!src && tgt) {
      combinedSections.push(tgt.raw);
      continue;
    }
    if (src && !tgt) {
      combinedSections.push(src.raw);
      continue;
    }
    if (!src || !tgt) continue;

    // 1. Combine heading
    let sectionHeading = '';
    if (src.heading && tgt.heading) {
      const srcLevelMatch = src.heading.match(/^(#{1,6})\s+(.*)$/);
      const tgtClean = tgt.heading.replace(/^#{1,6}\s+/, '').trim();
      if (srcLevelMatch) {
        sectionHeading = `${srcLevelMatch[1]} ${srcLevelMatch[2]}\u3000${tgtClean}`;
      } else {
        sectionHeading = `${src.heading}\u3000${tgtClean}`;
      }
    } else if (src.heading) {
      sectionHeading = src.heading;
    } else if (tgt.heading) {
      sectionHeading = tgt.heading;
    }

    // 2. Pair paragraphs
    const pairedParas: string[] = [];
    const maxP = Math.max(src.paragraphs.length, tgt.paragraphs.length);

    for (let pIdx = 0; pIdx < maxP; pIdx++) {
      const srcP = src.paragraphs[pIdx];
      const tgtP = tgt.paragraphs[pIdx];

      const isInvariant = (t?: string) =>
        Boolean(t && (t.startsWith('```') || t.startsWith('$$') || /^!\[.*\]\(.*\)/.test(t)));

      if (isInvariant(srcP)) {
        pairedParas.push(srcP!);
      } else if (srcP && tgtP) {
        pairedParas.push(srcP);
        pairedParas.push(tgtP);
      } else if (srcP) {
        pairedParas.push(srcP);
      } else if (tgtP) {
        pairedParas.push(tgtP);
      }
    }

    const secContent = (sectionHeading ? sectionHeading + '\n\n' : '') + pairedParas.join('\n\n');
    combinedSections.push(secContent);
  }

  return combinedSections.join('\n\n');
}

/**
 * Universal OpenAI-compatible chat completion client.
 * Supports OpenAI endpoints and DeepSeek (deepseek-chat / deepseek-reasoner).
 */
export class LlmClient {
  private config: LlmClientConfig;

  constructor(config: LlmClientConfig = {}) {
    let defaultBaseUrl = 'https://api.openai.com/v1';
    let defaultModel = 'gpt-4o';

    if (config.provider === 'deepseek') {
      defaultBaseUrl = 'https://api.deepseek.com/v1';
      defaultModel = 'deepseek-chat';
    }

    this.config = {
      baseUrl: defaultBaseUrl,
      model: defaultModel,
      chunkCharLimit: 2000,
      timeoutMs: 120_000,
      maxRetries: 3,
      ...config
    };
  }

  /**
   * Executes a chat completion request conforming to OpenAI specifications.
   */
  async chatCompletion(systemPrompt: string, userPrompt: string): Promise<string> {
    const apiKey = this.config.apiKey;
    const baseUrl = (this.config.baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
    const url = `${baseUrl}/chat/completions`;
    const model = this.config.model ?? 'gpt-4o';
    const maxRetries = this.config.maxRetries ?? 3;

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json'
        };
        if (apiKey) {
          headers['Authorization'] = `Bearer ${apiKey}`;
        }

        const res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt }
            ],
            stream: false
          })
        });

        const isOk = typeof res.ok === 'boolean' ? res.ok : (res.status >= 200 && res.status < 300);
        if (!isOk) {
          const status = res.status;
          let errMsg = `HTTP ${status}`;
          try {
            if (typeof res.json === 'function') {
              const errJson = (await res.json()) as { error?: { message?: string } };
              if (errJson.error?.message) {
                errMsg = errJson.error.message;
              }
            }
          } catch {
            if (typeof res.text === 'function') {
              errMsg = await res.text().catch(() => errMsg);
            }
          }

          if (status === 401) {
            throw new Error(`LLM API 401 Unauthorized: Invalid API key (${errMsg})`);
          }
          if (status === 429) {
            throw new Error(`LLM API 429 Rate Limit exceeded: ${errMsg}`);
          }
          if (status >= 500) {
            throw new Error(`LLM API 500 Internal Server Error: ${errMsg}`);
          }
          throw new Error(`LLM API request failed (${status}): ${errMsg}`);
        }

        const data = (await res.json()) as {
          choices?: Array<{
            message?: {
              content?: string;
            };
          }>;
        };

        const content = data.choices?.[0]?.message?.content;
        if (typeof content !== 'string') {
          throw new Error('LLM API response did not contain message content');
        }

        return content;
      } catch (err: unknown) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const msg = lastError.message.toLowerCase();

        // Do not retry 401 unauthorized
        if (msg.includes('401') || msg.includes('unauthorized')) {
          throw lastError;
        }

        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, attempt * 1000));
        }
      }
    }

    throw lastError || new Error('LLM chat completion failed after retries');
  }

  /**
   * Translates an academic paper in structured chunks preserving markdown and math.
   */
  async translateMarkdown(markdown: string, title = 'Paper'): Promise<TranslationResult> {
    const limit = this.config.chunkCharLimit ?? 2000;
    const chunks = chunkMarkdown(markdown, limit);
    const translatedChunks: Array<{
      index: number;
      headingPath: string[];
      charCount: number;
      translatedContent: string;
    }> = [];

    const systemPrompt =
      'You are an academic translator. Translate English academic text into clear, natural, and rigorous Simplified Chinese. ' +
      'Preserve all Markdown formatting, LaTeX equations ($...$ and $$...$$), image links, and citation keys intact. ' +
      'Do NOT merge or split paragraphs; retain exact 1:1 paragraph boundaries.';

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]!;
      this.config.onProgress?.(`正在翻译文档分块 (${i + 1}/${chunks.length})...`);

      const headingBreadcrumb =
        chunk.headingPath.length > 0 ? chunk.headingPath.join(' > ') : title;
      const userPrompt = [
        `文档标题: ${title}`,
        `章节目录: ${headingBreadcrumb}`,
        `分块编号: ${i + 1}/${chunks.length}`,
        '',
        '待翻译原文:',
        chunk.content
      ].join('\n');

      const translated = await this.chatCompletion(systemPrompt, userPrompt);
      translatedChunks.push({
        index: chunk.index,
        headingPath: chunk.headingPath,
        charCount: chunk.content.length,
        translatedContent: translated.trim()
      });
    }

    return {
      translatedMarkdown: translatedChunks.map((c) => c.translatedContent).join('\n\n'),
      chunks: translatedChunks
    };
  }

  /**
   * Generates academic reading assets: summary.md, terms.md, qa.md.
   */
  async generateReadingAssets(input: {
    title: string;
    translatedTitle?: string;
    markdown: string;
    translatedMarkdown?: string;
  }): Promise<ReadingAssetsResult> {
    const { title, translatedTitle = title, markdown, translatedMarkdown = '' } = input;

    // Prepare bounded context for LLM prompt
    const context = (translatedMarkdown ? translatedMarkdown : markdown).slice(0, 15000);

    // 1. summary.md
    this.config.onProgress?.('正在生成核心速读摘要 (summary.md)...');
    const summaryPrompt = [
      `请为学术论文《${title}》（中文名：《${translatedTitle}》）生成核心速读摘要 summary.md。`,
      '',
      '论文内容节选:',
      context
    ].join('\n');

    const summary = await this.chatCompletion('论文总结 summary.md', summaryPrompt);

    // 2. terms.md
    this.config.onProgress?.('正在生成专业术语表 (terms.md)...');
    const termsPrompt = [
      `请为学术论文《${title}》提取 8 到 15 个核心专业术语，并生成 Markdown 术语表格。`,
      '列名要求严格包含：| 英文术语 | 中文译名 | 上下文解释 |',
      '',
      '论文内容节选:',
      context
    ].join('\n');

    const terms = await this.chatCompletion('术语表 terms.md', termsPrompt);

    // 3. qa.md
    this.config.onProgress?.('正在生成方法论深度问答 (qa.md)...');
    const qaPrompt = [
      `请针对学术论文《${title}》的研究动机、模型架构、实验基线、核心贡献与潜在局限性设计 5 到 8 组深度问答。`,
      '',
      '论文内容节选:',
      context
    ].join('\n');

    const qa = await this.chatCompletion('问答 qa.md', qaPrompt);

    return {
      summary,
      terms,
      qa
    };
  }
}
