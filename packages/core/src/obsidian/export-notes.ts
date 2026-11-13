import { basename, join } from 'node:path';
import type { AppConfig } from '../config/types.js';
import { createBilingualMarkdown } from '../markdown/bilingual-markdown.js';
import { createFrontmatter } from '../utils/frontmatter.js';
import YAML from 'yaml';
import { copyFileTo, deleteFileIfExists, ensureDirectory, writeTextFile } from '../storage/file-system.js';

export interface ExportNotesInput {
  config: AppConfig;
  slug: string;
  pdfPath: string;
  originalNote: string | undefined;
  translatedNote: string;
  indexNote: string;
  documentRoot: string;
}

export interface ExportNotesResult {
  originalNotePath?: string | undefined;
  translatedNotePath: string;
  bilingualNotePath: string;
  indexNotePath: string;
}

export async function exportNotes(input: ExportNotesInput): Promise<ExportNotesResult> {
  await ensureDirectory(input.documentRoot);

  // 独立译文用于恢复翻译和质检，对照笔记用于阅读。
  const originalNotePath = join(input.documentRoot, `${input.slug}.original.md`);
  const translatedNotePath = join(input.documentRoot, `${input.slug}.zh.md`);
  const indexNotePath = join(input.documentRoot, `${input.slug}.index.md`);
  const bilingualNotePath = join(input.documentRoot, `${input.slug}.bilingual.md`);

  if (input.originalNote) {
    await writeTextFile(originalNotePath, input.originalNote);
  } else {
    await deleteFileIfExists(originalNotePath);
  }

  await writeTextFile(translatedNotePath, input.translatedNote);
  const bilingual = buildBilingualNote(input.originalNote ?? input.translatedNote, input.translatedNote);
  await writeTextFile(bilingualNotePath, bilingual.content);
  await writeTextFile(indexNotePath, input.indexNote);
  // PDF 原件放在同一目录下，Obsidian 内部链接和用户手动归档都更直观。
  await copyFileTo(input.pdfPath, join(input.documentRoot, basename(input.pdfPath)));

  return {
    originalNotePath: input.originalNote ? originalNotePath : undefined,
    translatedNotePath,
    bilingualNotePath,
    indexNotePath
  };
}

/** Also used to expose older task outputs without another translation request. */
export function buildBilingualNote(originalNote: string, translatedNote: string) {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(translatedNote);
  const metadata = frontmatter ? YAML.parse(frontmatter[1]!) : {};
  const { markdown, warnings } = createBilingualMarkdown(originalNote, translatedNote);
  return {
    content: createFrontmatter({
      ...metadata,
      type: 'bilingual',
      lang: metadata?.translationSkipped ? metadata.detectedSourceLanguage : [metadata?.detectedSourceLanguage ?? 'en', 'zh-CN'],
      bilingualWarnings: warnings.length ? warnings : undefined
    }, markdown),
    warnings
  };
}
