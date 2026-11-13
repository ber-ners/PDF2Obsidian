import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { NextResponse } from 'next/server';
import { createTextGenerationClient } from '@pdf2obsidian/providers';
import { createFrontmatter } from '@pdf2obsidian/core';
import {
  buildReadingSourceContext,
  buildReadingVisualsPrompt,
  parseReadingVisualsDocument,
  prepareReadingVisuals
} from '@pdf2obsidian/core/reading-visuals';
import { loadLocalAppConfig } from '../../../../../lib/config';
import { getLocalTask } from '../../../../../lib/local-tasks';

export const runtime = 'nodejs';

async function readNoteBody(path: string): Promise<string> {
  const raw = await readFile(path, 'utf8').catch(() => '');
  // 上下文构造器内部还会再剔除参考文献、致谢等文末噪音。
  return raw.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '').trim();
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const task = await getLocalTask(id);
  if (!task?.result) {
    return NextResponse.json({ error: '任务不存在或尚未完成解析' }, { status: 404 });
  }

  try {
    const config = await loadLocalAppConfig();
    const { translatedNotePath, originalNotePath, slug, sourceHash } = task.result;
    const translated = await readNoteBody(translatedNotePath);
    const original = await readNoteBody(originalNotePath);

    if (!translated && !original) {
      return NextResponse.json({ error: '论文正文为空，无法生成阅读图解' }, { status: 400 });
    }

    const title = task.fileName.replace(/\.pdf$/i, '');
    const source = buildReadingSourceContext({
      original,
      translated,
      maxChars: config.readingAssets.maxSourceChars
    });

    const client = createTextGenerationClient(config.translation);
    const maxRetries = config.readingAssets.maxRetries ?? config.translation.maxRetries ?? 3;
    let raw = '';
    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
      try {
        raw = await client.generateText({
          systemPrompt: config.readingAssets.systemPrompt,
          userPrompt: buildReadingVisualsPrompt({
            title,
            context: [`论文标题：${title}`, '', source.prompt].join('\n')
          })
        });
        break;
      } catch (err) {
        if (attempt === maxRetries) {
          throw err;
        }
        await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
      }
    }

    const content = prepareReadingVisuals(raw);
    if (!content) {
      return NextResponse.json({ error: '这次没有生成可用的阅读图卡，请重试。' }, { status: 422 });
    }

    const parsed = parseReadingVisualsDocument(content);
    const warnings = [
      ...parsed.warnings,
      ...parsed.cards.flatMap((card, index) =>
        card.visual.kind === 'diagram' && !card.visual.valid
          ? [`card ${index + 1}: ${card.visual.error ?? 'invalid mermaid'}`]
          : []
      )
    ];

    const backlink = `[[${slug}.index]]`;
    const note = createFrontmatter({
      title: `${title} - 阅读图解`,
      paperTitle: title,
      type: 'workflow',
      parent: backlink,
      sourceHash,
      createdAt: new Date().toISOString()
    }, [`返回索引：${backlink}`, '', content].join('\n'));

    const outputPath = join(dirname(translatedNotePath), config.readingAssets.workflowFileName || '流程图.md');
    await writeFile(outputPath, note, 'utf8');
    return NextResponse.json({ ok: true, path: outputPath, content, warnings });
  } catch (error: unknown) {
    const message = extractErrorMessage(error);
    return NextResponse.json({ error: `阅读图解生成失败：${message}` }, { status: 500 });
  }
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.cause instanceof Error) {
      return `${error.message} (${error.cause.message})`;
    }
    if (error.cause && typeof error.cause === 'object' && 'code' in error.cause) {
      return `${error.message} (${String((error.cause as { code: unknown }).code)})`;
    }
    return error.message;
  }
  return String(error);
}
