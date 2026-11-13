import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { NextResponse } from 'next/server';
import { buildBilingualNote, createBilingualMarkdown, stripNoteMetadata } from '@pdf2obsidian/core';
import type { ImportPdfResult } from '@pdf2obsidian/pipeline';
import { loadLocalAppConfig } from '../../../../../lib/config';
import { readMineruLayout } from '../../../../../lib/mineru-layout';
import { linkBilingualSegments } from '../../../../../lib/bilingual-links';
import { getLocalTask } from '../../../../../lib/local-tasks';
import { repairPaperMetadata } from '../../../../../lib/repair-paper-metadata';

export const runtime = 'nodejs';

const artifactKinds = ['original', 'translated', 'bilingual', 'index', 'database', 'summary', 'terms', 'qa', 'workflow'] as const;
type ArtifactKind = typeof artifactKinds[number];

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const task = await getLocalTask(id);
  if (!task?.result) {
    return NextResponse.json({ error: '任务产物不存在' }, { status: 404 });
  }

  const kind = parseArtifactKind(new URL(request.url).searchParams.get('kind'));
  if (!kind) {
    return NextResponse.json({ error: '不支持的产物类型' }, { status: 400 });
  }

  const path = await resolveArtifactPath(task.result, kind);
  if (!path) {
    return NextResponse.json({ error: '该产物未生成或已在设置中关闭。' }, { status: 404 });
  }

  try {
    let content = kind === 'bilingual' ? await readBilingualNote(task.result, path) : await readFile(path, 'utf8');
    if (kind === 'index') {
      try {
        content = repairPaperMetadata(content, await readFile(task.result.originalNotePath, 'utf8'));
      } catch { /* Keep metadata readable even when the original note is unavailable. */ }
    }
    if (kind === 'bilingual') {
      // Keep saved/user-edited Markdown authoritative. Linking must never make it unreadable.
      try {
        const [original, translated, layout] = await Promise.all([
          readFile(task.result.configSummary?.translationSkipped ? task.result.translatedNotePath : task.result.originalNotePath, 'utf8'),
          readFile(task.result.translatedNotePath, 'utf8'),
          readMineruLayout(task)
        ]);
        const paired = createBilingualMarkdown(original, translated);
        if (stripNoteMetadata(content) === paired.markdown) {
          const segments = linkBilingualSegments(paired.segments, layout.blocks);
          return NextResponse.json({ path, content, segments });
        }
      } catch { /* A missing source or layout must not hide a saved bilingual note. */ }
      return NextResponse.json({ path, content, linkMessage: '当前对照笔记与源文件的配对结构不一致或缺少区块数据，暂无法定位 PDF。' });
    }
    return NextResponse.json({ path, content });
  } catch (error) {
    return NextResponse.json({
      path,
      error: isReadingArtifact(kind)
        ? '当前任务没有生成该阅读材料。请在设置中开启“生成阅读材料”后重新处理。'
        : error instanceof Error ? error.message : String(error)
    }, { status: 404 });
  }
}

async function readBilingualNote(result: ImportPdfResult, path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const translated = await readFile(result.translatedNotePath, 'utf8');
  const original = result.configSummary?.translationSkipped ? translated : await readFile(result.originalNotePath, 'utf8');
  const { content } = buildBilingualNote(original, translated);
  // Upgrade older outputs once, preserving any existing user edits.
  try { await writeFile(path, content, { flag: 'wx' }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  return await readFile(path, 'utf8');
}

function isReadingArtifact(kind: ArtifactKind | null): kind is 'summary' | 'terms' | 'qa' | 'workflow' {
  return kind === 'summary' || kind === 'terms' || kind === 'qa' || kind === 'workflow';
}

function parseArtifactKind(value: string | null): ArtifactKind | undefined {
  return artifactKinds.find((kind) => kind === value);
}

async function resolveArtifactPath(result: ImportPdfResult, kind: ArtifactKind | null): Promise<string | undefined> {
  if (kind === 'original') return result.originalNotePath;
  if (kind === 'translated') return result.translatedNotePath;
  if (kind === 'bilingual') return result.bilingualNotePath ?? join(dirname(result.translatedNotePath), `${result.slug}.bilingual.md`);
  if (kind === 'index') return result.indexNotePath;
  if (kind === 'database') return result.databaseNotePath;
  if (kind === 'summary' || kind === 'terms' || kind === 'qa' || kind === 'workflow') {
    const config = await loadLocalAppConfig();
    const fileNames: Record<'summary' | 'terms' | 'qa' | 'workflow', string> = {
      summary: config.readingAssets.summaryFileName,
      terms: config.readingAssets.termsFileName,
      qa: config.readingAssets.qaFileName,
      workflow: config.readingAssets.workflowFileName || '流程图.md'
    };
    return join(dirname(result.translatedNotePath), fileNames[kind]);
  }
  return undefined;
}
