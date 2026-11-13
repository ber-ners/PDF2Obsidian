import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import YAML from '../packages/core/node_modules/yaml/dist/index.js';
import { createBilingualMarkdown } from '../packages/core/dist/markdown/bilingual-markdown.js';
import { buildBilingualNote, exportNotes } from '../packages/core/dist/obsidian/export-notes.js';

test('headings share a line; each English paragraph is followed by its translation', () => {
  const result = createBilingualMarkdown(
    '# Paper\n\n## OBJECTIVES\n\nFirst paragraph.\n\nSecond paragraph.\n\n## DESIGN\n\nReview.',
    '# 论文\n\n## 目标\n\n第一段。\n\n第二段。\n\n## 设计\n\n综述。');
  assert.equal(result.markdown, '# Paper　论文\n\n## OBJECTIVES　目标\n\nFirst paragraph.\n\n第一段。\n\nSecond paragraph.\n\n第二段。\n\n## DESIGN　设计\n\nReview.\n\n综述。');
  assert.deepEqual(result.warnings, []);
});

test('unchanged code, math and images appear once without splitting at internal blanks or headings', () => {
  const shared = '```md\n# Not a heading\n\ncode\n```\n\n$$\nx = 1\n\ny = 2\n$$\n\n![Figure](images/a.jpg)';
  const result = createBilingualMarkdown(`## Method\n\n${shared}\n\nExplanation.`, `## 方法\n\n${shared}\n\n说明。`);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.markdown, `## Method　方法\n\n${shared}\n\nExplanation.\n\n说明。`);
});

test('lists, tables and quotes remain intact', () => {
  const original = '- First\n\n  Detail.\n\n- Second\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n> Quote';
  const translated = '- 第一\n\n  详情。\n\n- 第二\n\n| 甲 | 乙 |\n| --- | --- |\n| 1 | 2 |\n\n> 引用';
  const result = createBilingualMarkdown(original, translated);
  assert.deepEqual(result.warnings, []);
  assert.ok(result.markdown.startsWith('- First\n\n  Detail.\n\n- Second\n\n- 第一'));
  assert.ok(result.markdown.endsWith('> Quote\n\n> 引用'));
});

test('merged paragraphs fall back within that section and later sections stay aligned', () => {
  const result = createBilingualMarkdown('## A\n\nFirst.\n\nSecond.\n\n## B\n\nThird.', '## 甲\n\n合并的第一、二段。\n\n## 乙\n\n第三段。');
  assert.equal(result.warnings.length, 1);
  assert.ok(result.markdown.includes('First.\n\nSecond.\n\n合并的第一、二段。'));
  assert.ok(result.markdown.endsWith('## B　乙\n\nThird.\n\n第三段。'));
});

test('missing headings preserve all text and produce a warning instead of false pairs', () => {
  const result = createBilingualMarkdown('# A\n\nSource\n\n## B\n\nMore', '# 甲\n\n译文');
  assert.equal(result.warnings.length, 1);
  assert.ok(result.markdown.includes('## B\n\nMore'));
  assert.ok(result.markdown.endsWith('# 甲\n\n译文'));
});

test('frontmatter is combined once; skipped translations never duplicate the original', () => {
  const source = '---\r\nlang: en\r\n---\r\n\r\n# Paper\r\n\r\nText.';
  const translated = '---\nlang: zh-CN\ndetectedSourceLanguage: en\n---\n\n# 论文\n\n正文。';
  const combined = buildBilingualNote(source, translated);
  const metadata = YAML.parse(/^---\n([\s\S]*?)\n---/.exec(combined.content)[1]);
  assert.deepEqual(metadata.lang, ['en', 'zh-CN']);
  assert.ok(combined.content.endsWith('# Paper　论文\n\nText.\n\n正文。\n'));
  assert.equal(createBilingualMarkdown(source, source).markdown, '# Paper\n\nText.');
});

test('export saves a bilingual Markdown alongside separate source and translation', async t => {
  const root = await mkdtemp(join(tmpdir(), 'bilingual-export-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const pdfPath = join(root, 'input.pdf');
  await writeFile(pdfPath, 'pdf');
  const result = await exportNotes({ config: {}, slug: 'paper', pdfPath, originalNote: '# Method\n\nReview.', translatedNote: '# 方法\n\n综述。', indexNote: '# Index', documentRoot: join(root, 'paper') });
  assert.match(await readFile(result.bilingualNotePath, 'utf8'), /# Method　方法\n\nReview\.\n\n综述。/);
  assert.equal(await readFile(result.translatedNotePath, 'utf8'), '# 方法\n\n综述。');
});
