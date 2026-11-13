import { readdir, readFile, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { toSlug } from '@pdf2obsidian/core';
import { loadLocalAppConfig } from './config';
import type { LocalTask } from './local-tasks';
import { parsePdfBlocks } from './pdf-blocks';

export async function getMineruRoot(task: LocalTask): Promise<string | undefined> {
  if (!task.result) return undefined;
  if (task.result.mineruOutputDir) return task.result.mineruOutputDir;
  // Resolve tasks created before mineruOutputDir was saved in the task index.
  const config = await loadLocalAppConfig();
  const sourceSlug = toSlug(basename(task.pdfPath, '.pdf'));
  const hashSlug = task.result.sourceHash.replace(/[^a-zA-Z0-9]+/g, '-');
  return join(config.mineru.outputDir, `${sourceSlug.slice(0, 15)}-${hashSlug.slice(0, 16)}`);
}

export async function findContentList(root: string): Promise<string | undefined> {
  const entries = await readdir(root, { withFileTypes: true });
  const file = entries.find((entry) => entry.isFile() && /(?:^|_)content_list\.json$/.test(entry.name));
  if (file) return join(root, file.name);
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === 'images') continue;
    const nested = await findContentList(join(root, entry.name));
    if (nested) return nested;
  }
}

export async function readMineruLayout(task: LocalTask) {
  const root = await getMineruRoot(task);
  const file = root ? await findContentList(root) : undefined;
  if (!file) return { blocks: [], message: '该任务缺少 MinerU 区块坐标，可重新解析以启用原文联动。' };
  const blocks = parsePdfBlocks(JSON.parse(await readFile(file, 'utf8')));
  return { blocks, message: blocks.some((block) => block.bbox) ? undefined : '解析产物未包含可用区块坐标。' };
}

export async function resolveLayoutImage(task: LocalTask, asset: string): Promise<string | undefined> {
  const root = await getMineruRoot(task);
  const file = root ? await findContentList(root) : undefined;
  if (!file) return undefined;
  const base = await realpath(dirname(file));
  const target = await realpath(resolve(base, asset));
  const rel = relative(base, target);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return undefined;
  // Only serve images actually referenced by this task's content list.
  const { blocks } = await readMineruLayout(task);
  if (!blocks.some((block) => block.image === asset)) return undefined;
  return target;
}
