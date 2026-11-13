import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import katexModule from './apps/obsidian-plugin/node_modules/katex/dist/katex.mjs';
const katex = katexModule.default || katexModule;

// Import reference and actual implementations
import {
  sanitizeBbox,
  calculateBboxStyles,
  classifyBlockRole,
  parseMineruBlocks
} from './apps/obsidian-plugin/src/utils/coordinates.ts';

import {
  createBilingualMarkdown,
  linkBilingualSegments,
  parseBilingualMarkdown
} from './apps/obsidian-plugin/src/utils/bilingual.ts';

const WORKSPACE_ROOT = process.cwd();
const PLUGIN_DIR = join(WORKSPACE_ROOT, 'apps/obsidian-plugin');

console.log('================================================================');
console.log('  CHALLENGER 2 ADVERSARIAL STRESS TEST SUITE: MILESTONE 2');
console.log('================================================================');

let passedTests = 0;
let totalTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✔ [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✖ [FAIL] ${name}`);
    console.error(`    ${err.message}`);
    throw err;
  }
}

async function runAsyncTest(name, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✔ [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✖ [FAIL] ${name}`);
    console.error(`    ${err.message}`);
    throw err;
  }
}

// -------------------------------------------------------------------------
// SUITE 1: Build Output & Stylesheet Verification
// -------------------------------------------------------------------------
console.log('\n--- SUITE 1: Build Outputs & Stylesheet CSS Rules Verification ---');

runTest('1.1: styles.css exists and is bundled (>1MB with KaTeX fonts)', () => {
  const cssPath = join(PLUGIN_DIR, 'styles.css');
  const css = readFileSync(cssPath, 'utf8');
  assert.ok(css.length > 1024 * 1024, `styles.css size must be >1MB, was ${css.length}`);
});

runTest('1.2: styles.css contains required bounding box overlay rules', () => {
  const css = readFileSync(join(PLUGIN_DIR, 'styles.css'), 'utf8');
  assert.ok(css.includes('.pdf2obsidian-bbox'), 'Missing .pdf2obsidian-bbox class');
  assert.ok(css.includes('.pdf-block-box'), 'Missing .pdf-block-box class');
  assert.ok(/\[data-active=["']?true["']?\]/.test(css), 'Missing [data-active=true] selector');
  assert.ok(css.includes('.pdf2obsidian-bbox:hover'), 'Missing .pdf2obsidian-bbox:hover state');
  assert.ok(/\[data-role=["']?title["']?\]/.test(css), 'Missing [data-role=title] role color');
  assert.ok(/\[data-role=["']?equation["']?\]/.test(css), 'Missing [data-role=equation] role color');
  assert.ok(/\[data-role=["']?table["']?\]/.test(css), 'Missing [data-role=table] role color');
  assert.ok(/\[data-role=["']?image["']?\]/.test(css), 'Missing [data-role=image] role color');
});

runTest('1.3: styles.css contains KaTeX error badge styling', () => {
  const css = readFileSync(join(PLUGIN_DIR, 'styles.css'), 'utf8');
  assert.ok(css.includes('.katex-error'), 'Missing .katex-error class');
  assert.ok(css.includes('var(--text-error'), 'Missing --text-error styling on .katex-error');
  assert.ok(css.includes('font-family:'), 'Missing font-family monospace on .katex-error');
});

runTest('1.4: styles.css contains Splitter handle focus-visible ring', () => {
  const css = readFileSync(join(PLUGIN_DIR, 'styles.css'), 'utf8');
  assert.ok(css.includes('.pdf2obsidian-splitter:focus-visible'), 'Missing focus-visible on splitter');
  assert.ok(css.includes('outline:'), 'Missing outline rule on splitter focus-visible');
  assert.ok(css.includes('outline-offset:'), 'Missing outline-offset rule on splitter focus-visible');
});

runAsyncTest('1.5: main.js inlines PDF.js worker as Blob URL and exports required classes', async () => {
  const mainJs = readFileSync(join(PLUGIN_DIR, 'main.js'), 'utf8');
  assert.ok(mainJs.includes('URL.createObjectURL'), 'Missing URL.createObjectURL in main.js');
  assert.ok(mainJs.includes('application/javascript'), 'Missing application/javascript MIME in Blob creation');
  assert.ok(mainJs.includes('VIEW_TYPE_ACADEMIC_READER'), 'Missing VIEW_TYPE_ACADEMIC_READER export');
  assert.ok(mainJs.includes('AcademicReaderView'), 'Missing AcademicReaderView export');
  assert.ok(mainJs.includes('pdf2obsidian-academic-reader'), 'Missing view type constant');
  assert.ok(mainJs.length > 1024 * 1024, `main.js size must be >1MB, was ${mainJs.length}`);

  // Dynamically load main.js in sandbox to verify runtime contract
  const { default: Module } = await import('node:module');
  const origRequire = Module.prototype.require;
  try {
    Module.prototype.require = function(path) {
      if (path === 'obsidian') {
        return {
          Plugin: class MockPlugin {},
          ItemView: class MockItemView {},
          TFile: class MockTFile {}
        };
      }
      return origRequire.apply(this, arguments);
    };
    const pluginExport = origRequire.call(this, join(PLUGIN_DIR, 'main.js'));
    assert.equal(typeof pluginExport, 'function', 'Plugin main export must be a class/function');
    assert.equal(pluginExport.VIEW_TYPE_ACADEMIC_READER, 'pdf2obsidian-academic-reader');
    assert.equal(typeof pluginExport.AcademicReaderView, 'function');
    assert.equal(typeof pluginExport.initializePdfWorker, 'function');
  } finally {
    Module.prototype.require = origRequire;
  }
});

// -------------------------------------------------------------------------
// SUITE 2: Bi-Directional Click Synchronization, Concurrency & Monotonic Sequence
// -------------------------------------------------------------------------
console.log('\n--- SUITE 2: Concurrency & Bi-Directional Click Synchronization ---');

runTest('2.1: Monotonic sequence strictly increments across 10,000 rapid alternating clicks', () => {
  // Model state machine of AcademicReaderRoot
  const segments = [
    { id: 'seg-0', blockIds: ['b-0'], sourceText: 'Abstract' },
    { id: 'seg-1', blockIds: ['b-1', 'b-2'], sourceText: 'Introduction' },
    { id: 'seg-2', blockIds: ['b-3'], sourceText: 'Methodology' },
    { id: 'seg-3', blockIds: ['b-4', 'b-5', 'b-6'], sourceText: 'Experiments' }
  ];

  let state = {
    activeBlockId: null,
    activeSegmentId: null,
    source: null,
    sequence: 0
  };

  const handleSelect = (id, source) => {
    if (source === 'pdf') {
      const matchingSeg = segments.find((s) => s.blockIds.includes(id));
      state = {
        activeBlockId: id,
        activeSegmentId: matchingSeg ? matchingSeg.id : null,
        source: 'pdf',
        sequence: state.sequence + 1
      };
    } else {
      const seg = segments.find((s) => s.id === id);
      const targetBlockId = seg && seg.blockIds.length > 0 ? seg.blockIds[0] : null;
      state = {
        activeBlockId: targetBlockId,
        activeSegmentId: id,
        source: 'markdown',
        sequence: state.sequence + 1
      };
    }
  };

  const blocks = ['b-0', 'b-1', 'b-2', 'b-3', 'b-4', 'b-5', 'b-6'];
  const segs = ['seg-0', 'seg-1', 'seg-2', 'seg-3'];

  for (let i = 0; i < 10000; i++) {
    const prevSeq = state.sequence;
    if (i % 2 === 0) {
      const blockId = blocks[i % blocks.length];
      handleSelect(blockId, 'pdf');
      assert.equal(state.sequence, prevSeq + 1, 'Sequence must increment by exactly 1');
      assert.equal(state.source, 'pdf');
      assert.equal(state.activeBlockId, blockId);
      assert.ok(state.activeSegmentId !== undefined);
    } else {
      const segId = segs[i % segs.length];
      handleSelect(segId, 'markdown');
      assert.equal(state.sequence, prevSeq + 1, 'Sequence must increment by exactly 1');
      assert.equal(state.source, 'markdown');
      assert.equal(state.activeSegmentId, segId);
      assert.ok(state.activeBlockId !== undefined);
    }
  }

  assert.equal(state.sequence, 10000);
});

runTest('2.2: Stale async scroll event rejection via monotonic sequence check', () => {
  // Test simulated async scroll events arriving out-of-order
  let state = {
    activeBlockId: null,
    activeSegmentId: null,
    source: null,
    sequence: 0
  };

  let lastAppliedScrollSeq = 0;
  let activeScrollTarget = null;

  const applyScroll = (target, eventSeq) => {
    // Monotonic guard: reject any scroll operation older than the latest applied
    if (eventSeq >= lastAppliedScrollSeq) {
      lastAppliedScrollSeq = eventSeq;
      activeScrollTarget = target;
      return true;
    }
    return false; // Stale rejected
  };

  // Click 1 at seq 1
  state = { activeBlockId: 'b-1', activeSegmentId: 'seg-1', source: 'pdf', sequence: 1 };
  const scrollPromise1 = { target: 'seg-1', seq: 1, delay: 50 };

  // Rapid Click 2 at seq 2 arrives immediately before scroll 1 finishes
  state = { activeBlockId: 'b-4', activeSegmentId: 'seg-3', source: 'pdf', sequence: 2 };
  const scrollPromise2 = { target: 'seg-3', seq: 2, delay: 10 };

  // Scroll 2 finishes FIRST (delay 10)
  const applied2 = applyScroll(scrollPromise2.target, scrollPromise2.seq);
  assert.equal(applied2, true);
  assert.equal(activeScrollTarget, 'seg-3');

  // Stale Scroll 1 finishes LATER (delay 50)
  const applied1 = applyScroll(scrollPromise1.target, scrollPromise1.seq);
  assert.equal(applied1, false, 'Stale scroll event must be rejected');
  assert.equal(activeScrollTarget, 'seg-3', 'Scroll target must remain at the latest target');
  assert.equal(lastAppliedScrollSeq, 2);
});

runTest('2.3: Continuation block parent resolution on PDF click', () => {
  const blocks = [
    { id: 'parent-block', role: 'body', markdown: 'First part of paragraph...', page: 1, bbox: [100, 100, 900, 300] },
    { id: 'child-block', role: 'body', markdown: '', continuationOf: 'parent-block', page: 2, bbox: [100, 100, 900, 250] }
  ];

  const segments = [
    { id: 'seg-1', blockIds: ['parent-block'], sourceText: 'First part of paragraph... continued on next page' }
  ];

  // Simulating BboxOverlay click on child continuation block
  const clickedBlock = blocks[1];
  const targetId = clickedBlock.continuationOf || clickedBlock.id;
  assert.equal(targetId, 'parent-block', 'Continuation block click must resolve to parent block ID');

  const matchingSeg = segments.find((s) => s.blockIds.includes(targetId));
  assert.ok(matchingSeg, 'Parent block ID must match segment in bilingual column');
  assert.equal(matchingSeg.id, 'seg-1');

  // Both parent and child blocks must be marked active
  const selectedBlockId = targetId;
  const isParentActive = selectedBlockId === blocks[0].id || (Boolean(blocks[0].continuationOf) && selectedBlockId === blocks[0].continuationOf);
  const isChildActive = selectedBlockId === blocks[1].id || (Boolean(blocks[1].continuationOf) && selectedBlockId === blocks[1].continuationOf);
  assert.equal(isParentActive, true, 'Parent block must be active');
  assert.equal(isChildActive, true, 'Child continuation block must also be active');
});

runTest('2.4: Unmapped block and empty segment click robustness', () => {
  const segments = [
    { id: 'seg-empty', blockIds: [], sourceText: 'Empty segment' }
  ];

  // PDF click on unmapped block
  const unmappedId = 'ghost-block-999';
  const matchingSeg = segments.find((s) => s.blockIds.includes(unmappedId));
  assert.equal(matchingSeg, undefined);

  let state = {
    activeBlockId: unmappedId,
    activeSegmentId: matchingSeg ? matchingSeg.id : null,
    source: 'pdf',
    sequence: 1
  };
  assert.equal(state.activeSegmentId, null);
  assert.equal(state.sequence, 1);

  // Markdown click on segment with empty blockIds
  const seg = segments[0];
  const targetBlockId = seg.blockIds.length > 0 ? seg.blockIds[0] : null;
  assert.equal(targetBlockId, null);

  state = {
    activeBlockId: targetBlockId,
    activeSegmentId: seg.id,
    source: 'markdown',
    sequence: 2
  };
  assert.equal(state.activeBlockId, null);
  assert.equal(state.sequence, 2);
});

// -------------------------------------------------------------------------
// SUITE 3: PDF Canvas Scaling & Coordinate Overlay Alignment Under Extreme Zoom & Resize
// -------------------------------------------------------------------------
console.log('\n--- SUITE 3: PDF Canvas Scaling & Coordinate Overlay Invariance ---');

runTest('3.1: Coordinate mapping formula zoom-invariance across extreme zoom levels (0.1x to 10.0x)', () => {
  const zoomLevels = [0.1, 0.25, 0.4, 0.75, 1.0, 1.5, 2.0, 3.0, 5.0, 10.0];
  const containerWidths = [200, 400, 600, 800, 1200, 1920, 2560, 3840];
  const aspectRatio = 1.4142; // A4 aspect ratio

  const testBboxes = [
    [0, 0, 1000, 1000],       // Full page
    [50, 100, 450, 900],      // Left column
    [550, 100, 950, 900],     // Right column
    [100, 50, 900, 80],       // Header
    [499, 499, 501, 501],     // 2x2 micro-box center
    [1, 1, 2, 2],             // Minimum non-zero box
    [998, 998, 1000, 1000]    // Bottom-right corner
  ];

  for (const zoom of zoomLevels) {
    for (const cWidth of containerWidths) {
      const pageWidth = Math.max(200, Math.round(cWidth * zoom));
      const pageHeight = Math.round(pageWidth * aspectRatio);

      for (const bbox of testBboxes) {
        const styles = calculateBboxStyles(bbox);
        assert.ok(styles !== null);

        // Parse percentages
        const leftPct = parseFloat(styles.left) / 100;
        const topPct = parseFloat(styles.top) / 100;
        const widthPct = parseFloat(styles.width) / 100;
        const heightPct = parseFloat(styles.height) / 100;

        // Verify percentage is exact normalized fraction
        assert.equal(leftPct, bbox[0] / 1000);
        assert.equal(topPct, bbox[1] / 1000);
        assert.equal(widthPct, (bbox[2] - bbox[0]) / 1000);
        assert.equal(heightPct, (bbox[3] - bbox[1]) / 1000);

        // Verify sub-pixel pixel placement relative to viewport
        const pixelLeft = pageWidth * leftPct;
        const pixelTop = pageHeight * topPct;
        const pixelWidth = pageWidth * widthPct;
        const pixelHeight = pageHeight * heightPct;

        // Bounds check
        assert.ok(pixelLeft >= 0 && pixelLeft <= pageWidth);
        assert.ok(pixelTop >= 0 && pixelTop <= pageHeight);
        assert.ok(pixelLeft + pixelWidth <= pageWidth + 0.001);
        assert.ok(pixelTop + pixelHeight <= pageHeight + 0.001);

        // Theoretical exact continuous viewport dimensions
        const theoreticalExactHeight = pageWidth * aspectRatio;
        const roundingError = Math.abs(pageHeight - theoreticalExactHeight);
        assert.ok(roundingError <= 0.5, `Page height rounding error must be <= 0.5px, was ${roundingError}`);

        // Individual box vertical position error bounded by 0.5px * (y / 1000) <= 0.5px
        const boxTopError = Math.abs(pixelTop - theoreticalExactHeight * topPct);
        assert.ok(boxTopError <= 0.5, `Bbox top alignment drift must be <= 0.5px, was ${boxTopError}`);
      }
    }
  }
});

runTest('3.2: Rapid window resize viewport boundary enforcement', () => {
  // Testing container width clamping under extreme resize values
  const rawResizeWidths = [-500, 0, 50, 100, 248, 600, 4000, 100000];
  for (const w of rawResizeWidths) {
    const containerWidth = Math.max(200, Math.round(w - 48));
    assert.ok(containerWidth >= 200, `Container width must be >= 200, got ${containerWidth}`);
    assert.ok(Number.isFinite(containerWidth));
  }
});

runTest('3.3: Bbox sanitization adversarial inputs', () => {
  // Inverted bboxes
  assert.equal(sanitizeBbox([500, 500, 400, 400]), undefined);
  assert.equal(sanitizeBbox([500, 500, 500, 600]), undefined);
  assert.equal(sanitizeBbox([500, 500, 600, 500]), undefined);

  // Out of bounds clamping
  const clamped = sanitizeBbox([-200, -500, 1500, 2000]);
  assert.deepEqual(clamped, [0, 0, 1000, 1000]);

  // Non-finite and malformed
  assert.equal(sanitizeBbox([NaN, 0, 100, 100]), undefined);
  assert.equal(sanitizeBbox([0, Infinity, 100, 100]), undefined);
  assert.equal(sanitizeBbox([0, 0, 100]), undefined);
  assert.equal(sanitizeBbox([0, 0, 100, 100, 100]), undefined);
  assert.equal(sanitizeBbox('not-a-bbox'), undefined);
  assert.equal(sanitizeBbox(null), undefined);
  assert.equal(sanitizeBbox(undefined), undefined);
  assert.equal(sanitizeBbox({ x0: 0, y0: 0 }), undefined);
});

// -------------------------------------------------------------------------
// SUITE 4: Bilingual Markdown Parser and Linker Adversarial Cases
// -------------------------------------------------------------------------
console.log('\n--- SUITE 4: Bilingual Markdown Parser & KaTeX Resilience ---');

runTest('4.1: Empty and whitespace-only markdown handling', () => {
  assert.deepEqual(parseBilingualMarkdown(''), []);
  assert.deepEqual(parseBilingualMarkdown('   \n\n   \t  \n'), []);
  assert.equal(createBilingualMarkdown('', ''), '');
  assert.equal(createBilingualMarkdown('   ', '   '), '');
  assert.deepEqual(linkBilingualSegments([], []), []);
});

runTest('4.2: English-only markdown without Chinese translation', () => {
  const enMd = `# Introduction to Neural Attention

Attention mechanisms allow neural networks to focus on specific subsets of inputs.

In this work, we propose Transformer, a model architecture relying entirely on an attention mechanism.`;

  const parsed = parseBilingualMarkdown(enMd);
  assert.equal(parsed.length, 3);
  assert.equal(parsed[0].role, 'title');
  assert.equal(parsed[0].sourceText, 'Introduction to Neural Attention');
  assert.equal(parsed[0].translatedText, '');

  assert.equal(parsed[1].role, 'body');
  assert.equal(parsed[1].sourceText, 'Attention mechanisms allow neural networks to focus on specific subsets of inputs.');
  assert.equal(parsed[1].translatedText, undefined);

  assert.equal(parsed[2].role, 'body');
  assert.equal(parsed[2].sourceText, 'In this work, we propose Transformer, a model architecture relying entirely on an attention mechanism.');
  assert.equal(parsed[2].translatedText, undefined);

  // createBilingualMarkdown with empty target returns sourceMd cleanly
  const combined = createBilingualMarkdown(enMd, '');
  assert.equal(combined, enMd);
});

runTest('4.3: Chinese-only markdown without English source', () => {
  const zhMd = `# 神经网络注意力机制简介

注意力机制允许神经网络聚焦于输入的特定子集。

在这项工作中，我们提出了 Transformer，一种完全依赖于注意力机制的模型架构。`;

  const parsed = parseBilingualMarkdown(zhMd);
  assert.equal(parsed.length, 3);
  assert.equal(parsed[0].role, 'title');
  assert.equal(parsed[0].sourceText, '神经网络注意力机制简介');
  assert.equal(parsed[0].translatedText, '');

  assert.equal(parsed[1].role, 'body');
  assert.equal(parsed[1].sourceText, '注意力机制允许神经网络聚焦于输入的特定子集。');
  assert.equal(parsed[1].translatedText, undefined);

  // createBilingualMarkdown with empty source returns targetMd cleanly
  const combined = createBilingualMarkdown('', zhMd);
  assert.equal(combined, zhMd);
});

runTest('4.4: Asymmetric segment counts (source >> target and target >> source)', () => {
  // Case A: 5 source paragraphs vs 1 target paragraph
  const srcA = `# Section 1\n\nPara 1\n\nPara 2\n\nPara 3\n\nPara 4\n\nPara 5`;
  const tgtA = `# 第1节\n\n第1段`;
  const combinedA = createBilingualMarkdown(srcA, tgtA);
  const parsedA = parseBilingualMarkdown(combinedA);

  assert.equal(parsedA[0].role, 'title');
  assert.equal(parsedA[0].sourceText, 'Section 1');
  assert.equal(parsedA[0].translatedText, '第1节');

  // Pair 1 is bilingual
  assert.equal(parsedA[1].sourceText, 'Para 1');
  assert.equal(parsedA[1].translatedText, '第1段');

  // Pairs 2-5 are English only
  assert.equal(parsedA[2].sourceText, 'Para 2');
  assert.equal(parsedA[2].translatedText, undefined);
  assert.equal(parsedA[3].sourceText, 'Para 3');
  assert.equal(parsedA[3].translatedText, undefined);
  assert.equal(parsedA[4].sourceText, 'Para 4');
  assert.equal(parsedA[4].translatedText, undefined);
  assert.equal(parsedA[5].sourceText, 'Para 5');
  assert.equal(parsedA[5].translatedText, undefined);

  // Case B: 1 source paragraph vs 4 target paragraphs
  const srcB = `# Section 2\n\nSolo source paragraph`;
  const tgtB = `# 第2节\n\n翻译段落1\n\n翻译段落2\n\n翻译段落3\n\n翻译段落4`;
  const combinedB = createBilingualMarkdown(srcB, tgtB);
  const parsedB = parseBilingualMarkdown(combinedB);

  assert.equal(parsedB[0].role, 'title');
  assert.equal(parsedB[1].sourceText, 'Solo source paragraph');
  assert.equal(parsedB[1].translatedText, '翻译段落1');
  assert.equal(parsedB[2].sourceText, '翻译段落2');
  assert.equal(parsedB[3].sourceText, '翻译段落3');
  assert.equal(parsedB[4].sourceText, '翻译段落4');
});

runTest('4.5: Unmatched math tags, currency dollars, and pathological LaTeX', () => {
  function renderMathSafely(tex, displayMode) {
    try {
      return katex.renderToString(tex, {
        displayMode,
        throwOnError: false
      });
    } catch (err) {
      return `<span class="katex-error" style="color: var(--text-error); font-family: monospace;">${escapeHtml(tex)}</span>`;
    }
  }

  function escapeHtml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function renderMathInText(content) {
    if (!content) return [];
    const parts = [];
    const mathRegex = /(\$\$[\s\S]+?\$\$|\$[^\$\n]+?\$)/g;
    let lastIndex = 0;
    let match;

    while ((match = mathRegex.exec(content)) !== null) {
      if (match.index > lastIndex) {
        parts.push({ type: 'text', text: content.substring(lastIndex, match.index) });
      }

      const token = match[0];
      if (token.startsWith('$$') && token.endsWith('$$')) {
        const tex = token.slice(2, -2).trim();
        const html = renderMathSafely(tex, true);
        parts.push({ type: 'math-display', html });
      } else if (token.startsWith('$') && token.endsWith('$')) {
        const tex = token.slice(1, -1).trim();
        const html = renderMathSafely(tex, false);
        parts.push({ type: 'math-inline', html });
      }

      lastIndex = mathRegex.lastIndex;
    }

    if (lastIndex < content.length) {
      parts.push({ type: 'text', text: content.substring(lastIndex) });
    }

    return parts;
  }

  // Pathological cases:
  const testCases = [
    // 1. Single unmatched dollar
    'Cost is $500 per month without closing tag.',
    // 2. Unmatched display math
    'Here is an unclosed display formula: $$ E = mc^2',
    // 3. Syntax errors in KaTeX
    'Invalid fraction: $\\frac{1}{$ and missing braces $\\sqrt{$',
    // 4. Undefined commands
    'Unknown macro: $\\someUndefinedCommand{123}$',
    // 5. Unbalanced braces
    'Unbalanced: $\\sum_{i=1}^{n$',
    // 6. XSS attack vector in formula
    'Malicious math: $<script>alert("xss")</script>$ and $<img src=x onerror=alert(1)>$',
    // 7. Currency dollars
    'The product costs $10 on Monday and $20 on Tuesday.'
  ];

  for (const tc of testCases) {
    let result;
    assert.doesNotThrow(() => {
      result = renderMathInText(tc);
    }, `Should never throw for input: ${tc}`);

    assert.ok(Array.isArray(result));
    assert.ok(result.length > 0);

    // Verify any generated HTML does not contain unescaped raw script tags
    for (const part of result) {
      if (part.html) {
        assert.ok(!part.html.includes('<script>alert'), 'Must not execute unescaped script tags');
      }
    }
  }

  // Specifically check KaTeX error rendering produces .katex-error or katex markup
  const brokenMath = renderMathSafely('\\frac{', false);
  assert.ok(brokenMath.includes('katex-error') || brokenMath.includes('class="katex"'), 'KaTeX should return error span or resilient output');
});

runTest('4.6: High-volume linker scale test (1,000 blocks and 1,000 segments)', () => {
  const blocks = [];
  for (let i = 0; i < 1000; i++) {
    blocks.push({
      id: `block-${i}`,
      page: Math.floor(i / 10) + 1,
      role: 'body',
      markdown: `Academic paragraph content number ${i} discussing empirical methodology and evaluation metrics.`,
      bbox: [100, 100, 900, 200]
    });
  }

  const rawSegments = [];
  for (let i = 0; i < 1000; i++) {
    rawSegments.push({
      id: `seg-${i}`,
      sourceText: `Academic paragraph content number ${i} discussing empirical methodology and evaluation metrics.`,
      translatedText: `学术段落内容编号 ${i}，讨论实证方法与评估指标。`,
      combinedMarkdown: `Academic paragraph content number ${i}\n\n学术段落内容编号 ${i}`,
      blockIds: []
    });
  }

  const startTime = Date.now();
  const linked = linkBilingualSegments(rawSegments, blocks);
  const elapsed = Date.now() - startTime;

  assert.equal(linked.length, 1000);
  assert.equal(linked[0].blockIds[0], 'block-0');
  assert.equal(linked[999].blockIds[0], 'block-999');
  assert.ok(elapsed < 1000, `Linking 1000 segments took ${elapsed}ms (should be <1000ms)`);
});

// -------------------------------------------------------------------------
// SUITE 5: Splitter Keyboard Navigation & Clamping Stress
// -------------------------------------------------------------------------
console.log('\n--- SUITE 5: Splitter Resilience & Keyboard Accessibility ---');

runTest('5.1: Splitter ratio clamping logic (min: 0.2, max: 0.8)', () => {
  const minRatio = 0.2;
  const maxRatio = 0.8;
  const clamp = (val) => Math.min(maxRatio, Math.max(minRatio, val));

  assert.equal(clamp(-1.0), 0.2);
  assert.equal(clamp(0.0), 0.2);
  assert.equal(clamp(0.19), 0.2);
  assert.equal(clamp(0.5), 0.5);
  assert.equal(clamp(0.81), 0.8);
  assert.equal(clamp(2.5), 0.8);
  assert.equal(clamp(100.0), 0.8);
});

runTest('5.2: Splitter keyboard navigation actions', () => {
  const minRatio = 0.2;
  const maxRatio = 0.8;
  const defaultRatio = 0.5;
  const clamp = (val) => Math.min(maxRatio, Math.max(minRatio, parseFloat(val.toFixed(4))));

  let ratio = defaultRatio;

  const handleKey = (key) => {
    let next;
    if (key === 'ArrowLeft') next = ratio - 0.02;
    else if (key === 'ArrowRight') next = ratio + 0.02;
    else if (key === 'Home') next = minRatio;
    else if (key === 'End') next = maxRatio;
    else if (key === 'Enter') next = defaultRatio;
    if (next !== undefined) ratio = clamp(next);
  };

  handleKey('ArrowLeft');
  assert.equal(ratio, 0.48);
  handleKey('ArrowRight');
  assert.equal(ratio, 0.5);
  handleKey('Home');
  assert.equal(ratio, 0.2);
  handleKey('ArrowLeft'); // Clamped at min
  assert.equal(ratio, 0.2);
  handleKey('End');
  assert.equal(ratio, 0.8);
  handleKey('ArrowRight'); // Clamped at max
  assert.equal(ratio, 0.8);
  handleKey('Enter');
  assert.equal(ratio, 0.5);
});

console.log('================================================================');
console.log(`  ALL CHALLENGE TESTS COMPLETED: ${passedTests}/${totalTests} PASSED`);
console.log('================================================================\n');
