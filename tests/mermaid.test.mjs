import test from 'node:test';
import assert from 'node:assert/strict';
import { validateMermaid, renderMermaidSvg, detectMermaidType } from '../packages/core/dist/index.js';

test('validateMermaid accepts valid flowchart and detects type', () => {
  const code = `
flowchart TD
    A[Paper PDF] --> B[MinerU Parse]
    B --> C[Bilingual Markdown]
    C --> D[Obsidian Vault]
  `;
  const result = validateMermaid(code);
  assert.equal(result.valid, true);
  assert.equal(result.type, 'flowchart');
  assert.equal(result.error, undefined);
});

test('validateMermaid rejects invalid or unparseable syntax gracefully', () => {
  const code = `
flowchart TD
    A --->>>> B
  `;
  const result = validateMermaid(code);
  assert.equal(result.valid, false);
  assert.ok(result.error);
});

test('validateMermaid handles empty or whitespace input', () => {
  const result = validateMermaid('   \n  ');
  assert.equal(result.valid, false);
  assert.match(result.error, /Empty Mermaid/);
});

test('renderMermaidSvg generates valid SVG markup with pele classes', () => {
  const code = `
graph LR
    Input[Literature] --> Process[Methodology Flow]
    Process --> Output[Synthesis]
  `;
  const res = renderMermaidSvg(code);
  assert.ok(res.svg.includes('<svg'));
  assert.ok(res.svg.includes('pele'));
  assert.ok(res.width > 0);
  assert.ok(res.height > 0);
});

test('detectMermaidType correctly identifies diagram categories', () => {
  assert.equal(detectMermaidType('flowchart TD\n A --> B'), 'flowchart');
  assert.equal(detectMermaidType('sequenceDiagram\n Alice->>Bob: Hello'), 'sequence');
  assert.equal(detectMermaidType('classDiagram\n class Paper'), 'class');
});
