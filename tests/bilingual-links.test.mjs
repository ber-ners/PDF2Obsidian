import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBilingualMarkdown } from '../packages/core/dist/markdown/bilingual-markdown.js';
import { linkBilingualSegments } from '../apps/desktop-web/lib/bilingual-links.ts';
const box = [10, 10, 90, 90];
const block = (id, markdown, page = 1) => ({ id, markdown, page, bbox: box, type: 'text' });

test('a PDF block selects the English paragraph together with its translation', () => {
  const paired = createBilingualMarkdown('## Design\n\nLiving review.', '## 设计\n\n动态综述。');
  const linked = linkBilingualSegments(paired.segments, [block('a', '## Design'), block('b', 'Living review.')]);
  assert.deepEqual(linked.map(segment => segment.blockIds), [['a'], ['b']]);
  assert.match(linked[1].markdown, /Living review\.\n\n动态综述。/);
});

test('repeated paragraphs map to separate pairs; PDF reading order may differ across pages', () => {
  const segments = ['Same.', 'Later.', 'Same.'].map((source, i) => ({ source, markdown: `${source}\n\n译文${i}` }));
  const linked = linkBilingualSegments(segments, [block('a', 'Same.'), block('b', 'Same.', 2), block('c', 'Later.', 2)]);
  assert.deepEqual(linked.map(segment => segment.blockIds), [['a'], ['c'], ['b']]);
});

test('merged translations use section anchors without shifting subsequent pairs', () => {
  const paired = createBilingualMarkdown('## A\n\nFirst.\n\nSecond.\n\n## B\n\nLast.', '## 甲\n\n合并译文。\n\n## 乙\n\n末段。');
  const linked = linkBilingualSegments(paired.segments, [block('a', 'First.'), block('b', 'Second.', 2), block('c', 'Last.', 3)]);
  assert.deepEqual(linked.find(segment => segment.markdown.includes('合并译文')).blockIds, ['a', 'b']);
  assert.deepEqual(linked.find(segment => segment.markdown.includes('末段')).blockIds, ['c']);
});

test('normalization tolerates whitespace and note links; missing content stays unmapped', () => {
  const linked = linkBilingualSegments([{ source: 'A [[ref|study]]\ncontinues.', markdown: 'A study continues.\n\n研究继续。' }],
    [block('a', 'A study continues.'), block('footer', 'Journal footer')]);
  assert.deepEqual(linked[0].blockIds, ['a']);
});

test('tables use full source HTML; image anchors use filenames after asset rewriting', () => {
  const linked = linkBilingualSegments([{ source: 'Table 1\n\n<table><tr><td>A</td></tr></table>\n\nNote', markdown: 'table' },
    { source: '![](assets/img.jpg)', markdown: 'figure' }],
    [{ ...block('table', 'Table 1\n\nNote'), sourceMarkdown: 'Table 1\n\n<table><tr><td>A</td></tr></table>\n\nNote' }, { ...block('image', ''), image: 'images/img.jpg' }]);
  assert.deepEqual(linked.map(segment => segment.blockIds), [['table'], ['image']]);
});

test('skipped translations retain individual source paragraph anchors', () => {
  const source = '# Title\n\nOne.\n\nTwo.';
  const paired = createBilingualMarkdown(source, source);
  assert.equal(paired.segments.length, 3);
  assert.equal(paired.segments.map(segment => segment.markdown).join('\n\n'), paired.markdown);
});

test('PDF page numbers and repeating furniture cannot link to numbers inside the author list', () => {
  const linked = linkBilingualSegments([{ source: 'Author $^{1,2,3}$', markdown: 'Author $^{1,2,3}$' }],
    [block('authors', 'Author $^{1,2,3}$'), { ...block('number', '1'), type: 'page_number' }, { ...block('header', 'Author'), type: 'header' }]);
  assert.deepEqual(linked[0].blockIds, ['authors']);
});

test('a subsection heading cannot match a phrase inside an earlier paragraph', () => {
  const paired = createBilingualMarkdown('## Design\n\nLiving umbrella review, evaluation.\n\n## Living umbrella review\n\nDetails.', '## 设计\n\n动态综述、评估。\n\n## 动态伞状综述\n\n详情。');
  const linked = linkBilingualSegments(paired.segments, [block('paragraph', 'Living umbrella review, evaluation.'), block('heading', '## Living umbrella review', 2)]);
  assert.deepEqual(linked[1].blockIds, ['paragraph']);
  assert.deepEqual(linked[2].blockIds, ['heading']);
});

test('continuation blocks inherit bilingual segment links from their parent block', () => {
  const paired = createBilingualMarkdown('Full paragraph text spanning columns.', '跨栏段落完整译文。');
  const linked = linkBilingualSegments(paired.segments, [
    block('parent', 'Full paragraph text spanning columns.', 1),
    { ...block('child', 'Full paragraph text spanning columns.', 1), continuationOf: 'parent' }
  ]);
  assert.deepEqual(linked[0].blockIds, ['parent', 'child']);
});
