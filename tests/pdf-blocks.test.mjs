import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePdfBlocks } from '../apps/desktop-web/lib/pdf-blocks.ts';

test('normalized geometry, page numbers and stable IDs survive discarded entries', () => {
  const blocks = parsePdfBlocks([
    { page_idx: 0, text: 'Title', text_level: 1, bbox: [100, 150, 900, 250] },
    { page_idx: -1, text: 'invalid' },
    { page_idx: 4, text: 'Repeated paragraph', bbox: [-1, 500, 1200, 999] },
    { page_idx: 4, text: 'Repeated paragraph', bbox: [20, 30, 10, 40] }
  ]);
  assert.deepEqual(blocks.map(b => [b.id, b.page, b.bbox]), [
    ['block-0', 1, [100, 150, 900, 250]], ['block-2', 5, [0, 500, 1000, 999]], ['block-3', 5, undefined]
  ]);
  assert.equal(blocks[0].markdown, '# Title');
});

test('tables and figures keep captions and image; blocks without coordinates stay readable', () => {
  const blocks = parsePdfBlocks([{ page_idx: 2, type: 'table', img_path: 'images/table.jpg', table_caption: ['Table 1'], table_footnote: ['Footnote'] },
    { page_idx: 3, text: 'Text without a box' }]);
  assert.equal(blocks[0].image, 'images/table.jpg');
  assert.equal(blocks[0].markdown, 'Table 1\n\nFootnote');
  assert.equal(blocks[1].bbox, undefined);
  assert.equal(parsePdfBlocks({}).length, 0);
});


test('HTML-only tables survive parsing and empty table bodies retain the image fallback', () => {
  const table = '<table><tr><td colspan="2">Table</td></tr></table>';
  const blocks = parsePdfBlocks([
    { page_idx: 0, type: 'table', table_body: table },
    { page_idx: 1, type: 'table', table_body: '  ', table_caption: ['Caption'], img_path: 'images/table.jpg' }
  ]);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].sourceMarkdown, table);
  assert.equal(blocks[1].sourceMarkdown, undefined);
  assert.equal(blocks[1].image, 'images/table.jpg');
});

test('cross-page and cross-column continuation blocks with empty text retain their bounding boxes and parent linkage', () => {
  const blocks = parsePdfBlocks([
    { page_idx: 0, text: 'Paragraph started on page 1', bbox: [100, 100, 500, 200] },
    { page_idx: 0, type: 'footer', text: 'Footer text', bbox: [100, 900, 500, 920] },
    { page_idx: 1, type: 'header', text: 'Header text', bbox: [100, 30, 500, 50] },
    { page_idx: 1, text: '', bbox: [100, 60, 500, 180] },
    { page_idx: 1, text: 'Next standalone heading', text_level: 2, bbox: [100, 200, 500, 220] },
    { page_idx: 1, text: '', bbox: [100, 230, 500, 300] }
  ]);
  assert.equal(blocks.length, 5);
  const continuation = blocks.find(b => b.continuationOf === 'block-0');
  assert.ok(continuation);
  assert.equal(continuation.page, 2);
  assert.deepEqual(continuation.bbox, [100, 60, 500, 180]);
  assert.equal(continuation.markdown, 'Paragraph started on page 1');
  assert.equal(continuation.role, 'body');
  // Heading reset lastTextBlock so subsequent empty box without a body paragraph is discarded
  assert.equal(blocks.filter(b => b.continuationOf).length, 1);
});
