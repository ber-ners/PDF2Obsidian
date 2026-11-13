import type { TFile } from 'obsidian';
import type {
  ImportPipelineInput,
  ImportPipelineResult,
  PaperMetadata
} from '../types/pipeline';
import {
  createPaperFrontmatter,
  formatImageWikilink,
  formatNoteWikilink,
  normalizeVaultPath,
  writeVaultBinary,
  writeVaultNote
} from './vault-writer';
import { MineruClient } from './mineru-client';
import {
  createBilingualMarkdown,
  LlmClient
} from './llm-client';

/**
 * Creates a URL-safe, filesystem-safe slug from paper title or filename.
 */
export function generatePaperSlug(title: string, suffix?: string): string {
  const clean = title
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
  const base = clean || 'paper';
  if (suffix) {
    const cleanSuffix = suffix.toLowerCase().replace(/[^\w-]/g, '-');
    return `${base}-${cleanSuffix}`;
  }
  return base;
}

/**
 * Orchestrates the full academic paper import pipeline:
 * 1. Takes PDF binary and paper metadata
 * 2. Parses layout, math, tables, and images via MinerU (Cloud v4 or Remote HTTP)
 * 3. Runs LLM translation and supplementary reading assets generation
 * 4. Idempotently writes all 7 notes and binary assets into the Obsidian vault
 */
export async function importPaper(input: ImportPipelineInput): Promise<ImportPipelineResult> {
  const { vault, pdfData, pdfFileName } = input;

  // 1. Determine slug and target folder
  const initialTitle = input.metadata?.title || pdfFileName.replace(/\.pdf$/i, '');
  const slug =
    input.metadata?.slug ||
    generatePaperSlug(initialTitle, input.metadata?.arxivId || input.metadata?.doi?.replace(/[^a-zA-Z0-9]/g, ''));
  const baseDir = input.targetFolder
    ? normalizeVaultPath(input.targetFolder)
    : `Papers/${slug}`;

  // 2. Invoke MinerU parser
  input.onProgress?.('正在使用 MinerU 解析 PDF 布局与公式...', 10);
  const mineru = new MineruClient(input.mineruConfig);
  const extractResult = await mineru.extractPdf(
    pdfData,
    pdfFileName,
    input.metadata?.arxivId || slug
  );

  const originalMarkdown = extractResult.markdown || `# ${initialTitle}\n\n(No markdown content extracted)`;
  const contentList = extractResult.contentList || [];
  const images = extractResult.images || {};

  // 3. Translation and Reading Assets via LLM
  let translatedMarkdown = '';
  let bilingualMarkdown = originalMarkdown;
  let summaryMd = '';
  let termsMd = '';
  let qaMd = '';

  const hasLlm = Boolean(input.llmConfig?.apiKey || input.llmConfig?.baseUrl);
  const shouldTranslate = !input.skipTranslation && hasLlm;
  const shouldGenAssets = !input.skipReadingAssets && hasLlm;

  if (shouldTranslate || shouldGenAssets) {
    const llm = new LlmClient(input.llmConfig);

    if (shouldTranslate) {
      input.onProgress?.('正在通过大模型进行结构化分块翻译...', 40);
      try {
        const transResult = await llm.translateMarkdown(originalMarkdown, initialTitle);
        translatedMarkdown = transResult.translatedMarkdown;
        bilingualMarkdown = createBilingualMarkdown(originalMarkdown, translatedMarkdown);
      } catch (err) {
        console.warn('[Import Pipeline] Translation failed, proceeding with original text:', err);
        translatedMarkdown = '(Translation failed or skipped)';
        bilingualMarkdown = originalMarkdown;
      }
    }

    if (shouldGenAssets) {
      input.onProgress?.('正在生成学术阅读材料 (速读/术语/问答)...', 70);
      try {
        const assets = await llm.generateReadingAssets({
          title: initialTitle,
          translatedTitle: input.metadata?.translatedTitle,
          markdown: originalMarkdown,
          translatedMarkdown
        });
        summaryMd = assets.summary;
        termsMd = assets.terms;
        qaMd = assets.qa;
      } catch (err) {
        console.warn('[Import Pipeline] Reading assets generation failed:', err);
      }
    }
  }

  // 4. Persist binary assets (PDF and figures) into vault
  input.onProgress?.('正在保存源 PDF 与提取图片...', 85);

  // Store source PDF
  const pdfFile = await writeVaultBinary(vault, `${baseDir}/document.pdf`, pdfData);

  // Store extracted figures
  const imageFiles: TFile[] = [];
  const storedImageNames = new Set<string>();

  for (const [imgName, imgBuffer] of Object.entries(images)) {
    // Only store basenames in images/ folder to avoid redundant nested paths
    const simpleName = imgName.split('/').pop() || imgName;
    if (storedImageNames.has(simpleName)) continue;
    storedImageNames.add(simpleName);

    const imgPath = `${baseDir}/images/${simpleName}`;
    const imgFile = await writeVaultBinary(vault, imgPath, imgBuffer);
    imageFiles.push(imgFile);
  }

  // Store MinerU layout JSON
  const layoutFile = await writeVaultNote(
    vault,
    `${baseDir}/${slug}.layout.json`,
    JSON.stringify(contentList, null, 2)
  );

  // 5. Build structured frontmatter base
  const frontmatterBase: PaperMetadata = {
    title: initialTitle,
    translatedTitle: input.metadata?.translatedTitle,
    authors: input.metadata?.authors,
    year: input.metadata?.year,
    venue: input.metadata?.venue,
    doi: input.metadata?.doi,
    arxivId: input.metadata?.arxivId,
    slug,
    tags: input.metadata?.tags || ['paper', 'academic'],
    sourcePdf: formatNoteWikilink(`${baseDir}/document.pdf`),
    originalNote: formatNoteWikilink(`${slug}.original`),
    translatedNote: translatedMarkdown ? formatNoteWikilink(`${slug}.zh`) : undefined,
    bilingualNote: formatNoteWikilink(`${slug}.bilingual`),
    indexNote: formatNoteWikilink(`${slug}.index`),
    summaryNote: summaryMd ? formatNoteWikilink(`${slug}.summary`) : undefined,
    termsNote: termsMd ? formatNoteWikilink(`${slug}.terms`) : undefined,
    qaNote: qaMd ? formatNoteWikilink(`${slug}.qa`) : undefined,
    createdAt: input.metadata?.createdAt || new Date().toISOString(),
    ...input.metadata
  };

  input.onProgress?.('正在写入 7 篇学术笔记与双向链接...', 95);

  // Note 1: Main Index Note
  const indexFm = createPaperFrontmatter({ ...frontmatterBase, type: 'paper-index' });
  const indexContent = [
    indexFm,
    '',
    `# ${initialTitle}`,
    '',
    `- 原文：${formatNoteWikilink(`${slug}.original`)}`,
    `- 中英双语：${formatNoteWikilink(`${slug}.bilingual`)}`,
    translatedMarkdown ? `- 译文：${formatNoteWikilink(`${slug}.zh`)}` : null,
    summaryMd ? `- 核心速读：${formatNoteWikilink(`${slug}.summary`)}` : null,
    termsMd ? `- 术语表：${formatNoteWikilink(`${slug}.terms`)}` : null,
    qaMd ? `- 深度问答：${formatNoteWikilink(`${slug}.qa`)}` : null,
    `- 源文档 PDF：${formatNoteWikilink(`${baseDir}/document.pdf`)}`
  ]
    .filter(Boolean)
    .join('\n');
  const indexFile = await writeVaultNote(vault, `${baseDir}/${slug}.index.md`, indexContent);

  // Note 2: Bilingual Note
  const biFm = createPaperFrontmatter({ ...frontmatterBase, type: 'paper-bilingual' });
  const bilingualFile = await writeVaultNote(
    vault,
    `${baseDir}/${slug}.bilingual.md`,
    `${biFm}\n\n${bilingualMarkdown}`
  );

  // Note 3: Original Note
  const origFm = createPaperFrontmatter({ ...frontmatterBase, type: 'paper-original' });
  const originalFile = await writeVaultNote(
    vault,
    `${baseDir}/${slug}.original.md`,
    `${origFm}\n\n${originalMarkdown}`
  );

  // Note 4: Translated Note (if translated)
  let translatedFile: TFile | undefined;
  if (translatedMarkdown) {
    const zhFm = createPaperFrontmatter({ ...frontmatterBase, type: 'paper-translated' });
    translatedFile = await writeVaultNote(
      vault,
      `${baseDir}/${slug}.zh.md`,
      `${zhFm}\n\n${translatedMarkdown}`
    );
  }

  // Note 5: Summary Note (if generated)
  let summaryFile: TFile | undefined;
  if (summaryMd) {
    const sumFm = createPaperFrontmatter({
      ...frontmatterBase,
      type: 'paper-summary',
      parent: formatNoteWikilink(`${slug}.index`)
    });
    summaryFile = await writeVaultNote(
      vault,
      `${baseDir}/${slug}.summary.md`,
      `${sumFm}\n\n${summaryMd}`
    );
  }

  // Note 6: Terms Note (if generated)
  let termsFile: TFile | undefined;
  if (termsMd) {
    const termsFm = createPaperFrontmatter({
      ...frontmatterBase,
      type: 'paper-terms',
      parent: formatNoteWikilink(`${slug}.index`)
    });
    termsFile = await writeVaultNote(
      vault,
      `${baseDir}/${slug}.terms.md`,
      `${termsFm}\n\n${termsMd}`
    );
  }

  // Note 7: Q&A Note (if generated)
  let qaFile: TFile | undefined;
  if (qaMd) {
    const qaFm = createPaperFrontmatter({
      ...frontmatterBase,
      type: 'paper-qa',
      parent: formatNoteWikilink(`${slug}.index`)
    });
    qaFile = await writeVaultNote(
      vault,
      `${baseDir}/${slug}.qa.md`,
      `${qaFm}\n\n${qaMd}`
    );
  }

  input.onProgress?.('论文解析与笔记持久化完成！', 100);

  return {
    folderPath: baseDir,
    slug,
    metadata: frontmatterBase,
    indexFile,
    bilingualFile,
    originalFile,
    translatedFile,
    summaryFile,
    termsFile,
    qaFile,
    layoutFile,
    pdfFile,
    imageFiles
  };
}
