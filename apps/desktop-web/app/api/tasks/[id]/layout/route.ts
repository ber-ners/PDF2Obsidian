import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { NextResponse } from 'next/server';
import { getLocalTask } from '../../../../../lib/local-tasks';
import { readMineruLayout, resolveLayoutImage } from '../../../../../lib/mineru-layout';

export const runtime = 'nodejs';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const task = await getLocalTask((await context.params).id);
  if (!task?.result) return NextResponse.json({ blocks: [], message: '任务尚未生成解析结果。' }, { status: 404 });
  try {
    const asset = new URL(request.url).searchParams.get('image');
    if (asset !== null) {
      const path = await resolveLayoutImage(task, asset);
      const mime = path && ({ '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' } as Record<string, string>)[extname(path).toLowerCase()];
      if (!path || !mime) return new Response('Image not found', { status: 404 });
      return new Response(await readFile(path), { headers: { 'Content-Type': mime, 'X-Content-Type-Options': 'nosniff' } });
    }
    return NextResponse.json(await readMineruLayout(task));
  } catch {
    return NextResponse.json({ blocks: [], message: '未找到可用的 MinerU 区块数据，可重新解析后再试。' }, { status: 404 });
  }
}
