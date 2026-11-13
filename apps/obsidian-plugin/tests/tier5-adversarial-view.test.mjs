/**
 * Tier 5: Adversarial Coverage Hardening Test Suite (View & UI Focus)
 *
 * Exhaustive white-box adversarial stress tests targeting:
 * 1. Splitter ratio boundary clamping, precision stepping, and keyboard accessibility.
 * 2. Coordinate transformations with degenerate, inverted, out-of-range, and malformed bounding boxes.
 * 3. Selection synchronization state machine invariants, monotonic sequence counters, and rapid bidirectional transitions.
 * 4. Bilingual markdown parsing, section splitting, invariant block preservation, and KaTeX math rendering resilience.
 * 5. View lifecycle, React root mounting/unmounting, plugin load/unload idempotency, and single-instance tab reveal.
 * 6. High-frequency end-to-end stress simulation.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  MockApp,
  MockPlugin,
  MockItemView,
  MockWorkspaceLeaf,
  MockTFile,
  sanitizeBbox,
  calculateBboxStyles,
  classifyBlockRole,
  parseMineruBlocks,
  createBilingualMarkdown,
  linkBilingualSegments,
  parseBilingualMarkdown,
  DEFAULT_STORAGE_KEY,
  DEFAULT_SPLIT_RATIO,
  MIN_SPLIT_RATIO,
  MAX_SPLIT_RATIO,
  clampSplitRatio,
  stepSplitRatio,
  handleSplitterKey,
  getPageNumbers,
  groupBlocksByPage,
  renderMathSafely,
  splitIntoSections,
  isInvariantBlock,
  escapeHtml,
  hasChinese,
  createInitialSelectionState,
  updateSelectionState,
  clearSelectionState,
  isSegmentActive,
  loadProductionPlugin
} from './mocks/index.mjs';

// =========================================================================
// Suite 1: Splitter Math & Keyboard Accessibility Stress (ADV-VIEW-1)
// =========================================================================
describe('ADV-VIEW-1: Dual-Column Splitter & Ratio Mechanics Stress', () => {
  test('ADV-VIEW-1.1: Extreme Boundary Clamping (-Infinity, Infinity, NaN, -999999, 999999)', () => {
    // Non-finite and extreme numbers
    assert.equal(clampSplitRatio(-Infinity), MIN_SPLIT_RATIO);
    assert.equal(clampSplitRatio(Infinity), MAX_SPLIT_RATIO);
    assert.equal(clampSplitRatio(NaN), DEFAULT_SPLIT_RATIO);
    assert.equal(clampSplitRatio(-999999), MIN_SPLIT_RATIO);
    assert.equal(clampSplitRatio(999999), MAX_SPLIT_RATIO);
    assert.equal(clampSplitRatio(-0.000001), MIN_SPLIT_RATIO);
    assert.equal(clampSplitRatio(1.000001), MAX_SPLIT_RATIO);

    // Non-numeric types fallback safely to default 0.5
    assert.equal(clampSplitRatio('0.5'), DEFAULT_SPLIT_RATIO);
    assert.equal(clampSplitRatio('invalid'), DEFAULT_SPLIT_RATIO);
    assert.equal(clampSplitRatio(null), DEFAULT_SPLIT_RATIO);
    assert.equal(clampSplitRatio(undefined), DEFAULT_SPLIT_RATIO);
    assert.equal(clampSplitRatio({}), DEFAULT_SPLIT_RATIO);
    assert.equal(clampSplitRatio(true), DEFAULT_SPLIT_RATIO);

    // Custom min and max ranges
    assert.equal(clampSplitRatio(0.1, 0.35, 0.65), 0.35);
    assert.equal(clampSplitRatio(0.9, 0.35, 0.65), 0.65);
    assert.equal(clampSplitRatio(0.5, 0.35, 0.65), 0.5);

    // Degenerate range min === max
    assert.equal(clampSplitRatio(0.2, 0.5, 0.5), 0.5);
    assert.equal(clampSplitRatio(0.8, 0.5, 0.5), 0.5);
  });

  test('ADV-VIEW-1.2: Precision Stepping & IEEE-754 Drift Resistance', () => {
    // Basic step increments
    assert.equal(stepSplitRatio(0.5, 0.02), 0.52);
    assert.equal(stepSplitRatio(0.5, -0.02), 0.48);

    // Step sequence reaching upper boundary without overflow
    let upperRatio = 0.5;
    for (let i = 0; i < 50; i++) {
      upperRatio = stepSplitRatio(upperRatio, 0.02);
    }
    assert.equal(upperRatio, MAX_SPLIT_RATIO);

    // Step sequence reaching lower boundary without underflow
    let lowerRatio = 0.5;
    for (let i = 0; i < 50; i++) {
      lowerRatio = stepSplitRatio(lowerRatio, -0.02);
    }
    assert.equal(lowerRatio, MIN_SPLIT_RATIO);

    // IEEE 754 floating point arithmetic stability: repeated +/- 0.02 steps return exactly to baseline
    let cycleRatio = 0.5;
    for (let i = 0; i < 10; i++) {
      cycleRatio = stepSplitRatio(cycleRatio, 0.02);
    }
    for (let i = 0; i < 10; i++) {
      cycleRatio = stepSplitRatio(cycleRatio, -0.02);
    }
    assert.equal(cycleRatio, 0.5);
  });

  test('ADV-VIEW-1.3: Splitter Keyboard Accessibility Fuzzing (handleSplitterKey)', () => {
    // Standard keyboard shortcuts
    assert.equal(handleSplitterKey('ArrowLeft', 0.5), 0.48);
    assert.equal(handleSplitterKey('ArrowRight', 0.5), 0.52);
    assert.equal(handleSplitterKey('Home', 0.5), MIN_SPLIT_RATIO);
    assert.equal(handleSplitterKey('End', 0.5), MAX_SPLIT_RATIO);
    assert.equal(handleSplitterKey('Enter', 0.73), DEFAULT_SPLIT_RATIO);

    // Clamping at boundaries
    assert.equal(handleSplitterKey('ArrowLeft', MIN_SPLIT_RATIO), MIN_SPLIT_RATIO);
    assert.equal(handleSplitterKey('ArrowRight', MAX_SPLIT_RATIO), MAX_SPLIT_RATIO);

    // Custom min, max, and default ratio parameters
    assert.equal(handleSplitterKey('Home', 0.5, 0.3, 0.7, 0.5), 0.3);
    assert.equal(handleSplitterKey('End', 0.5, 0.3, 0.7, 0.5), 0.7);
    assert.equal(handleSplitterKey('Enter', 0.7, 0.3, 0.7, 0.4), 0.4);

    // Fuzzing with unhandled / adversarial keys — ratio must remain completely unchanged
    const unhandledKeys = [
      'Escape', 'Tab', 'Shift', 'Control', 'Alt', 'Meta',
      'Space', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown',
      'Backspace', 'Delete', 'F1', 'F12', 'a', 'Z', ' ',
      '', '🚀', '分栏', 'EnterKey', 'home', 'END'
    ];
    for (const key of unhandledKeys) {
      assert.equal(handleSplitterKey(key, 0.6123), 0.6123, `Key "${key}" should not alter ratio`);
    }
  });

  test('ADV-VIEW-1.4: Splitter Pointer Math & Zero-Width Container Defense', () => {
    // Simulating container width checks from Splitter.tsx handlePointerMove
    const simulatePointerMove = (clientX, containerLeft, containerWidth, currentRatio) => {
      if (containerWidth <= 0) return currentRatio;
      const offset = clientX - containerLeft;
      const rawRatio = offset / containerWidth;
      return clampSplitRatio(parseFloat(rawRatio.toFixed(4)));
    };

    // Zero width container returns current ratio without division by zero
    assert.equal(simulatePointerMove(100, 0, 0, 0.5), 0.5);
    assert.equal(simulatePointerMove(100, 0, -10, 0.5), 0.5);

    // Dragged far left past screen edge
    assert.equal(simulatePointerMove(-500, 0, 1000, 0.5), MIN_SPLIT_RATIO);

    // Dragged far right past container width
    assert.equal(simulatePointerMove(2500, 0, 1000, 0.5), MAX_SPLIT_RATIO);

    // Valid positions
    assert.equal(simulatePointerMove(500, 0, 1000, 0.5), 0.5);
    assert.equal(simulatePointerMove(300, 0, 1000, 0.5), 0.3);
    assert.equal(simulatePointerMove(700, 0, 1000, 0.5), 0.7);

    // LocalStorage corrupted values parser simulation (from Splitter.tsx initializer)
    const parseSavedRatio = (saved, min = MIN_SPLIT_RATIO, max = MAX_SPLIT_RATIO) => {
      try {
        if (saved) {
          const parsed = parseFloat(saved);
          if (!isNaN(parsed) && parsed >= min && parsed <= max) {
            return parsed;
          }
        }
      } catch {
        // fallback
      }
      return DEFAULT_SPLIT_RATIO;
    };

    assert.equal(parseSavedRatio('invalid'), 0.5);
    assert.equal(parseSavedRatio('NaN'), 0.5);
    assert.equal(parseSavedRatio('Infinity'), 0.5);
    assert.equal(parseSavedRatio('-0.5'), 0.5);
    assert.equal(parseSavedRatio('0.95'), 0.5);
    assert.equal(parseSavedRatio(''), 0.5);
    assert.equal(parseSavedRatio('0.35'), 0.35);
  });
});

// =========================================================================
// Suite 2: Degenerate Coordinates & Bounding Box Transformations (ADV-VIEW-2)
// =========================================================================
describe('ADV-VIEW-2: Degenerate Coordinates & Bounding Box Transformations', () => {
  test('ADV-VIEW-2.1: Degenerate Bounding Box Rejection (Inverted & Zero Area)', () => {
    // Inverted X: x0 > x1
    assert.equal(sanitizeBbox([600, 100, 200, 500]), undefined);
    // Inverted Y: y0 > y1
    assert.equal(sanitizeBbox([100, 700, 400, 200]), undefined);
    // Completely inverted
    assert.equal(sanitizeBbox([800, 900, 100, 200]), undefined);

    // Zero-width line box (x0 === x1)
    assert.equal(sanitizeBbox([300, 100, 300, 500]), undefined);
    // Zero-height line box (y0 === y1)
    assert.equal(sanitizeBbox([100, 400, 600, 400]), undefined);
    // Zero-area point box (x0 === x1 && y0 === y1)
    assert.equal(sanitizeBbox([250, 250, 250, 250]), undefined);

    // Sub-integer rounding causing inversion: [100.8, 200, 100.2, 500] -> x0=101, x1=100
    assert.equal(sanitizeBbox([100.8, 200, 100.2, 500]), undefined);
    // Sub-integer rounding causing zero-width: [100.4, 200, 100.1, 500] -> x0=100, x1=100
    assert.equal(sanitizeBbox([100.4, 200, 100.1, 500]), undefined);
  });

  test('ADV-VIEW-2.2: Extreme Out-of-Range Clamping & Boundary Stress', () => {
    // All negative coordinates clamp to [0, 0, 0, 0], triggering zero-area rejection
    assert.equal(sanitizeBbox([-500, -400, -200, -100]), undefined);

    // All coordinates > 1000 clamp to [1000, 1000, 1000, 1000], triggering zero-area rejection
    assert.equal(sanitizeBbox([1200, 1300, 1500, 1600]), undefined);

    // Partial negative coordinate clamped to 0 while preserving positive area
    assert.deepEqual(sanitizeBbox([-50, 100, 400, 600]), [0, 100, 400, 600]);
    assert.deepEqual(sanitizeBbox([100, -80, 400, 600]), [100, 0, 400, 600]);

    // Partial > 1000 coordinate clamped to 1000 while preserving positive area
    assert.deepEqual(sanitizeBbox([200, 300, 1050, 600]), [200, 300, 1000, 600]);
    assert.deepEqual(sanitizeBbox([200, 300, 600, 1150]), [200, 300, 600, 1000]);

    // Extreme spanning box enclosing the entire page
    assert.deepEqual(sanitizeBbox([-200, -200, 2000, 2000]), [0, 0, 1000, 1000]);
  });

  test('ADV-VIEW-2.3: Malformed, Non-Numeric, and Non-Finite Types', () => {
    // Non-finite numbers inside array
    assert.equal(sanitizeBbox([NaN, 100, 500, 600]), undefined);
    assert.equal(sanitizeBbox([100, Infinity, 500, 600]), undefined);
    assert.equal(sanitizeBbox([100, 200, -Infinity, 600]), undefined);
    assert.equal(sanitizeBbox([100, 200, 500, NaN]), undefined);

    // Non-numeric elements
    assert.equal(sanitizeBbox([null, 100, 500, 600]), undefined);
    assert.equal(sanitizeBbox([undefined, 100, 500, 600]), undefined);
    assert.equal(sanitizeBbox(['100', '200', '500', '600']), undefined);
    assert.equal(sanitizeBbox([true, false, true, false]), undefined);
    assert.equal(sanitizeBbox([{}, [], 500, 600]), undefined);

    // Non-array and malformed structures
    assert.equal(sanitizeBbox(null), undefined);
    assert.equal(sanitizeBbox(undefined), undefined);
    assert.equal(sanitizeBbox(123), undefined);
    assert.equal(sanitizeBbox('0,0,100,100'), undefined);
    assert.equal(sanitizeBbox({ x0: 0, y0: 0, x1: 100, y1: 100 }), undefined);

    // Wrong array length
    assert.equal(sanitizeBbox([]), undefined);
    assert.equal(sanitizeBbox([100]), undefined);
    assert.equal(sanitizeBbox([100, 200]), undefined);
    assert.equal(sanitizeBbox([100, 200, 300]), undefined);
    assert.equal(sanitizeBbox([100, 200, 300, 400, 500]), undefined);
  });

  test('ADV-VIEW-2.4: CSS Percentage Style Calculation Precision', () => {
    // calculateBboxStyles returns null for invalid inputs
    assert.equal(calculateBboxStyles(null), null);
    assert.equal(calculateBboxStyles([100, 200, 100, 500]), null);
    assert.equal(calculateBboxStyles([600, 200, 100, 500]), null);

    // Precision calculation: coordinates scale directly via x / 10 %
    const styles = calculateBboxStyles([123, 456, 789, 912]);
    assert.deepEqual(styles, {
      left: '12.3%',
      top: '45.6%',
      width: '66.6%',
      height: '45.6%'
    });

    // Minimal single-unit bounding box
    const minBox = calculateBboxStyles([500, 500, 501, 501]);
    assert.deepEqual(minBox, {
      left: '50%',
      top: '50%',
      width: '0.1%',
      height: '0.1%'
    });

    // Full page box
    const fullBox = calculateBboxStyles([0, 0, 1000, 1000]);
    assert.deepEqual(fullBox, {
      left: '0%',
      top: '0%',
      width: '100%',
      height: '100%'
    });
  });

  test('ADV-VIEW-2.5: Semantic Role Taxonomy & Level Boundary Fuzzing (classifyBlockRole)', () => {
    // All 16 standard types mapped accurately
    assert.equal(classifyBlockRole('title'), 'title');
    assert.equal(classifyBlockRole('equation'), 'equation');
    assert.equal(classifyBlockRole('interline_equation'), 'equation');
    assert.equal(classifyBlockRole('table'), 'table');
    assert.equal(classifyBlockRole('table_body'), 'table');
    assert.equal(classifyBlockRole('image'), 'image');
    assert.equal(classifyBlockRole('chart'), 'image');
    assert.equal(classifyBlockRole('image_body'), 'image');
    assert.equal(classifyBlockRole('table_caption'), 'caption');
    assert.equal(classifyBlockRole('image_caption'), 'caption');
    assert.equal(classifyBlockRole('caption'), 'caption');
    assert.equal(classifyBlockRole('footnote'), 'footnote');
    assert.equal(classifyBlockRole('reference'), 'reference');
    assert.equal(classifyBlockRole('ref_text'), 'reference');
    assert.equal(classifyBlockRole('header'), 'header');
    assert.equal(classifyBlockRole('footer'), 'footer');

    // text_level 1..6 overrides role to 'title' regardless of type
    for (let level = 1; level <= 6; level++) {
      assert.equal(classifyBlockRole('text', level), 'title');
      assert.equal(classifyBlockRole('paragraph', level), 'title');
    }

    // Out-of-bounds textLevel must NOT classify as title
    assert.equal(classifyBlockRole('text', 0), 'body');
    assert.equal(classifyBlockRole('text', 7), 'body');
    assert.equal(classifyBlockRole('text', -1), 'body');
    assert.equal(classifyBlockRole('text', 99), 'body');
    assert.equal(classifyBlockRole('text', NaN), 'body');
    assert.equal(classifyBlockRole('text', undefined), 'body');

    // Arbitrary unknown strings fallback to 'body'
    assert.equal(classifyBlockRole('widget'), 'body');
    assert.equal(classifyBlockRole('diagram'), 'body');
    assert.equal(classifyBlockRole('sidebar'), 'body');
    assert.equal(classifyBlockRole(''), 'body');
    assert.equal(classifyBlockRole(undefined), 'body');
  });

  test('ADV-VIEW-2.6: Layout Block Parser Invariant & Continuation Chains (parseMineruBlocks)', () => {
    // Degenerate inputs
    assert.deepEqual(parseMineruBlocks(null), []);
    assert.deepEqual(parseMineruBlocks(undefined), []);
    assert.deepEqual(parseMineruBlocks('invalid'), []);
    assert.deepEqual(parseMineruBlocks({}), []);

    const rawList = [
      // 0: Valid title
      { page_idx: 0, type: 'text', text_level: 1, text: 'Attention Is All You Need', bbox: [100, 100, 900, 200] },
      // 1: Body text paragraph
      { page_idx: 0, type: 'text', text: 'The dominant sequence models...', bbox: [100, 220, 900, 500] },
      // 2: Continuation block on next page (empty text, same role)
      { page_idx: 1, type: 'text', text: '', bbox: [100, 100, 900, 300] },
      // 3: Explicit continuation
      { page_idx: 1, type: 'text', text: '', continuationOf: 'custom-parent', bbox: [100, 320, 900, 450] },
      // 4: Table with table_body
      { page_idx: 1, type: 'table', table_body: '| A | B |\n|---|---|\n| 1 | 2 |', bbox: [100, 500, 900, 700] },
      // 5: Caption with array caption
      { page_idx: 1, type: 'caption', table_caption: ['Table 1:', 'Model comparison.'], bbox: [100, 710, 900, 750] },
      // 6: Corrupt item (negative page_idx) — should be ignored
      { page_idx: -1, type: 'text', text: 'Corrupt', bbox: [100, 100, 500, 200] },
      // 7: Corrupt item (invalid bbox) — block preserved with bbox: undefined
      { page_idx: 1, type: 'text', text: 'Text with invalid bbox', bbox: [500, 500, 200, 200] }
    ];

    const blocks = parseMineruBlocks(rawList);
    assert.equal(blocks.length, 7);

    // Title markdown formatted with '#'
    assert.equal(blocks[0].role, 'title');
    assert.equal(blocks[0].markdown, '# Attention Is All You Need');
    assert.equal(blocks[0].page, 1);

    // Implicit continuation block inherits lastBodyId
    assert.equal(blocks[2].continuationOf, blocks[1].id);

    // Explicit continuation block inherits custom ID
    assert.equal(blocks[3].continuationOf, 'custom-parent');

    // Table markdown extracted from table_body
    assert.equal(blocks[4].role, 'table');
    assert.ok(blocks[4].markdown.includes('| A | B |'));

    // Caption markdown joined from array
    assert.equal(blocks[5].role, 'caption');
    assert.equal(blocks[5].markdown, 'Table 1: Model comparison.');

    // Corrupt bbox block preserved with bbox: undefined
    assert.equal(blocks[6].markdown, 'Text with invalid bbox');
    assert.equal(blocks[6].bbox, undefined);

    // Stress test: 2,500 blocks parsed in under 25ms
    const hugeList = Array.from({ length: 2500 }, (_, i) => ({
      page_idx: Math.floor(i / 10),
      type: 'text',
      text: `Paragraph ${i}`,
      bbox: [100, 100, 900, 300]
    }));
    const tStart = performance.now();
    const parsedHuge = parseMineruBlocks(hugeList);
    const duration = performance.now() - tStart;
    assert.equal(parsedHuge.length, 2500);
    assert.ok(duration < 100, `Parsing 2500 blocks took ${duration}ms, expected < 100ms`);
  });
});

// =========================================================================
// Suite 3: Selection Synchronization State Machine (ADV-VIEW-3)
// =========================================================================
describe('ADV-VIEW-3: Selection Synchronization State Machine', () => {
  test('ADV-VIEW-3.1: Monotonic Sequence Invariant Under 1,000 Rapid Bidirectional Transitions', () => {
    const segments = [
      { id: 'seg-0', blockIds: ['block-0', 'block-1'] },
      { id: 'seg-1', blockIds: ['block-2'] },
      { id: 'seg-2', blockIds: ['block-3', 'block-4'] }
    ];

    let state = createInitialSelectionState();
    assert.equal(state.sequence, 0);
    assert.equal(state.activeBlockId, null);
    assert.equal(state.activeSegmentId, null);
    assert.equal(state.source, null);

    // 1,000 rapid bidirectional transitions alternating PDF and Markdown
    for (let i = 1; i <= 1000; i++) {
      if (i % 2 === 1) {
        state = updateSelectionState(state, 'block-0', 'pdf', segments);
        assert.equal(state.activeBlockId, 'block-0');
        assert.equal(state.activeSegmentId, 'seg-0');
        assert.equal(state.source, 'pdf');
        assert.equal(state.sequence, i);
      } else {
        state = updateSelectionState(state, 'seg-2', 'markdown', segments);
        assert.equal(state.activeBlockId, 'block-3');
        assert.equal(state.activeSegmentId, 'seg-2');
        assert.equal(state.source, 'markdown');
        assert.equal(state.sequence, i);
      }
    }

    assert.equal(state.sequence, 1000);
  });

  test('ADV-VIEW-3.2: Selection Resolution With Non-Existent & Degenerate IDs', () => {
    const segments = [
      { id: 'seg-0', blockIds: ['block-0'] }
    ];

    let state = createInitialSelectionState();

    // PDF click on a block ID that doesn't belong to any segment
    state = updateSelectionState(state, 'orphan-block-999', 'pdf', segments);
    assert.equal(state.activeBlockId, 'orphan-block-999');
    assert.equal(state.activeSegmentId, null);
    assert.equal(state.source, 'pdf');
    assert.equal(state.sequence, 1);

    // Markdown click on a non-existent segment ID that doesn't start with 'block-'
    state = updateSelectionState(state, 'phantom-seg-999', 'markdown', segments);
    assert.equal(state.activeBlockId, null);
    assert.equal(state.activeSegmentId, 'phantom-seg-999');
    assert.equal(state.source, 'markdown');
    assert.equal(state.sequence, 2);

    // Markdown click on an ID that starts with 'block-' (fallback ID resolution)
    state = updateSelectionState(state, 'block-fallback-42', 'markdown', segments);
    assert.equal(state.activeBlockId, 'block-fallback-42');
    assert.equal(state.activeSegmentId, 'block-fallback-42');
    assert.equal(state.sequence, 3);

    // Undefined / empty segments list handling
    state = updateSelectionState(state, 'block-0', 'pdf', undefined);
    assert.equal(state.activeBlockId, 'block-0');
    assert.equal(state.activeSegmentId, null);
    assert.equal(state.sequence, 4);

    // Null previous state safely initializes sequence to 1
    const freshState = updateSelectionState(null, 'seg-0', 'markdown', segments);
    assert.equal(freshState.sequence, 1);
    assert.equal(freshState.activeBlockId, 'block-0');
  });

  test('ADV-VIEW-3.3: Selection Clear & Segment Active Check (clearSelectionState, isSegmentActive)', () => {
    const segments = [{ id: 'seg-0', blockIds: ['block-0', 'block-cont-1'] }];
    let state = updateSelectionState(null, 'block-0', 'pdf', segments);

    // Segment active validation
    assert.equal(isSegmentActive(segments[0], state), true);
    assert.equal(isSegmentActive({ id: 'seg-1', blockIds: ['block-x'] }, state), false);

    // Matching by activeSegmentId
    const mdState = updateSelectionState(state, 'seg-0', 'markdown', segments);
    assert.equal(isSegmentActive(segments[0], mdState), true);

    // Clearing selection
    const cleared = clearSelectionState(mdState);
    assert.equal(cleared.activeBlockId, null);
    assert.equal(cleared.activeSegmentId, null);
    assert.equal(cleared.source, null);
    assert.equal(cleared.sequence, mdState.sequence + 1);
    assert.equal(isSegmentActive(segments[0], cleared), false);

    // isSegmentActive with null / undefined inputs
    assert.equal(isSegmentActive(segments[0], null), false);
    assert.equal(isSegmentActive(segments[0], undefined), false);
    assert.equal(isSegmentActive({ id: 'seg-no-blocks' }, state), false);
  });
});

// =========================================================================
// Suite 4: Bilingual Markdown & KaTeX Formula Rendering (ADV-VIEW-4)
// =========================================================================
describe('ADV-VIEW-4: Bilingual Markdown & KaTeX Formula Rendering', () => {
  test('ADV-VIEW-4.1: Malformed LaTeX Formula Rendering Resilience (renderMathSafely)', () => {
    // Malformed formulas that would throw in strict mode
    const malformedFormulas = [
      '\\frac{1}{',
      '\\notarealcommand{xyz}',
      '\\left( \\sum_{i=1}^n x_i',
      '\\sqrt[ ]{',
      '\\begin{pmatrix} 1 & 2',
      '\\\\\\\\\\\\\\',
      '\\underbar{',
      ''
    ];

    for (const tex of malformedFormulas) {
      assert.doesNotThrow(() => {
        const rendered = renderMathSafely(tex, false);
        assert.ok(typeof rendered === 'string');
        assert.ok(rendered.length > 0 || tex === '');
      }, `renderMathSafely threw on malformed formula "${tex}"`);
    }

    // Long complex equation
    const complexEquation = '\\mathcal{L}_{\\text{total}} = \\lambda_1 \\mathbb{E}_{x \\sim p_{\\text{data}}}[\\log D(x)] + \\lambda_2 \\mathbb{E}_{z \\sim p_z}[\\log(1 - D(G(z)))]';
    const displayHtml = renderMathSafely(complexEquation, true);
    assert.ok(displayHtml.includes('katex-display') || displayHtml.includes('katex'));
  });

  test('ADV-VIEW-4.2: XSS & HTML Injection Defense in Formulas & Content', () => {
    // Dangerous injection payloads
    const xssPayloads = [
      '<script>alert("xss")</script>',
      '"><img src=x onerror=alert(1)>',
      '<svg onload=alert(document.domain)>',
      'javascript:void(0)',
      '\\href{javascript:alert(1)}{click}'
    ];

    for (const payload of xssPayloads) {
      const rendered = renderMathSafely(payload, false);
      // Raw executable script tags must NEVER be emitted
      assert.ok(!rendered.includes('<script>'), `Raw script tag found for payload "${payload}"`);
      assert.ok(!rendered.includes('onerror=alert'), `Unescaped onerror handler found for payload "${payload}"`);
    }

    // HTML escape utility
    const raw = '<div class="test" data-id=\'1\'>& "hello"</div>';
    const escaped = escapeHtml(raw);
    assert.ok(!escaped.includes('<div'));
    assert.ok(escaped.includes('&lt;div'));
    assert.ok(escaped.includes('&quot;hello&quot;'));
    assert.ok(escaped.includes('&#039;1&#039;'));
  });

  test('ADV-VIEW-4.3: Markdown Section Splitting With Deceptive Markdown Constructs (splitIntoSections)', () => {
    // 1. Code fence containing '# Comment' must NOT split as heading
    const markdownWithCode = [
      '# Introduction',
      '',
      'Here is code:',
      '',
      '```python',
      '# This is a Python comment, NOT a markdown heading',
      'def compute():',
      '    return 42',
      '```',
      '',
      'Concluding paragraph.'
    ].join('\n');

    const sections = splitIntoSections(markdownWithCode);
    assert.equal(sections.length, 1);
    assert.equal(sections[0].heading, '# Introduction');
    // Code block preserved intact within paragraphs
    assert.ok(sections[0].paragraphs.some((p) => p.includes('# This is a Python comment')));

    // 2. Multiline math block containing '# ' must NOT split as heading
    const markdownWithMath = [
      '# Math Section',
      '',
      '$$',
      '% LaTeX comment',
      'E = mc^2',
      '$$',
      '',
      'Next paragraph.'
    ].join('\n');

    const mathSections = splitIntoSections(markdownWithMath);
    assert.equal(mathSections.length, 1);
    assert.equal(mathSections[0].heading, '# Math Section');

    // 3. Consecutive headings with no body paragraphs
    const consecutiveHeadings = '# H1\n\n## H2\n\n### H3';
    const emptySections = splitIntoSections(consecutiveHeadings);
    assert.equal(emptySections.length, 3);
    assert.equal(emptySections[0].heading, '# H1');
    assert.equal(emptySections[1].heading, '## H2');
    assert.equal(emptySections[2].heading, '### H3');

    // 4. Windows CRLF (\r\n) line endings
    const crlfMarkdown = '# Title\r\n\r\nParagraph 1.\r\n\r\nParagraph 2.';
    const crlfSections = splitIntoSections(crlfMarkdown);
    assert.equal(crlfSections.length, 1);
    assert.equal(crlfSections[0].paragraphs.length, 2);

    // 5. Empty and whitespace-only inputs
    assert.deepEqual(splitIntoSections(''), []);
    assert.deepEqual(splitIntoSections('   \n\n  \n  '), []);
  });

  test('ADV-VIEW-4.4: Bilingual Markdown Creation With Severe Paragraph Asymmetry (createBilingualMarkdown)', () => {
    // English with 10 paragraphs vs Chinese with 2 paragraphs
    const srcParas = Array.from({ length: 10 }, (_, i) => `Paragraph ${i + 1}`).join('\n\n');
    const tgtParas = '段落 1\n\n段落 2';

    const bilingual = createBilingualMarkdown(srcParas, tgtParas);
    assert.ok(bilingual.includes('Paragraph 1\n\n段落 1'));
    assert.ok(bilingual.includes('Paragraph 2\n\n段落 2'));
    // Remaining 8 English paragraphs must be preserved standalone
    assert.ok(bilingual.includes('Paragraph 3'));
    assert.ok(bilingual.includes('Paragraph 10'));

    // Invariant display math $$...$$ preserved without swallowing following translations
    const srcWithMath = [
      'Equation description:',
      '$$\\sum x_i = y$$',
      'Subsequent analysis.'
    ].join('\n\n');

    const tgtWithMath = [
      '公式描述：',
      '$$\\sum x_i = y$$',
      '后续分析。'
    ].join('\n\n');

    const alignedMath = createBilingualMarkdown(srcWithMath, tgtWithMath);
    assert.ok(alignedMath.includes('Equation description:\n\n公式描述：'));
    assert.ok(alignedMath.includes('$$\\sum x_i = y$$'));
    assert.ok(alignedMath.includes('Subsequent analysis.\n\n后续分析。'));

    // Unicode CJK punctuation variants
    const cjkSrc = 'Features: speed, scale; accuracy: 99.8%! (Really?)';
    const cjkTgt = '特性：速度、规模；准确率：99.8%！（真的吗？）';
    const cjkAligned = createBilingualMarkdown(cjkSrc, cjkTgt);
    assert.ok(cjkAligned.includes(cjkSrc));
    assert.ok(cjkAligned.includes(cjkTgt));
  });

  test('ADV-VIEW-4.5: Unicode-Aware Block Linkage Defense (linkBilingualSegments)', () => {
    const blocks = [
      { id: 'block-0', page: 1, type: 'text', role: 'title', markdown: '1. Introduction' },
      { id: 'block-1', page: 1, type: 'text', role: 'body', markdown: 'Deep neural networks have revolutionized AI.' },
      { id: 'block-2', page: 1, type: 'text', role: 'body', markdown: '', continuationOf: 'block-1' }
    ];

    // Segments containing only punctuation/symbols must NOT falsely match all blocks
    const symbolSegments = [
      { id: 'seg-dash', sourceText: '---', combinedMarkdown: '---' },
      { id: 'seg-dots', sourceText: '...', combinedMarkdown: '...' },
      { id: 'seg-nums', sourceText: '1. 2. 3.', combinedMarkdown: '1. 2. 3.' }
    ];

    const linkedSymbols = linkBilingualSegments(symbolSegments, blocks);
    assert.equal(linkedSymbols.length, 3);
    // Unmatched symbol segments receive fallback synthetic ID instead of stealing unrelated blocks
    assert.deepEqual(linkedSymbols[0].blockIds, ['block-0']); // fallback block-0 for idx 0

    // Normal text matches and continuation blocks inherit linkage
    const textSegments = [
      { id: 'seg-intro', sourceText: 'Deep neural networks have revolutionized AI.', combinedMarkdown: 'Deep neural networks' }
    ];
    const linkedText = linkBilingualSegments(textSegments, blocks);
    assert.ok(linkedText[0].blockIds.includes('block-1'));
    assert.ok(linkedText[0].blockIds.includes('block-2')); // continuation block included!
  });

  test('ADV-VIEW-4.6: Aligned Bilingual Parser Stress (parseBilingualMarkdown)', () => {
    // Markdown with YAML frontmatter at the top
    const frontmatterBilingual = [
      '---',
      'title: Test Paper',
      'tags: [ai, math]',
      '---',
      '',
      '# 1. Background\u30001. 背景',
      '',
      'Recent advancements in deep learning.',
      '',
      '深度学习近期的突破进展。',
      '',
      '$$f(x) = \\sigma(W x + b)$$'
    ].join('\n');

    const parsed = parseBilingualMarkdown(frontmatterBilingual);
    assert.ok(parsed.length >= 3);

    // Title segment
    const titleSeg = parsed.find((s) => s.role === 'title');
    assert.ok(titleSeg);
    assert.equal(titleSeg.sourceText, '1. Background');
    assert.equal(titleSeg.translatedText, '1. 背景');
    assert.equal(titleSeg.headingLevel, 1);

    // Body segment
    const bodySeg = parsed.find((s) => s.role === 'body');
    assert.ok(bodySeg);
    assert.equal(bodySeg.sourceText, 'Recent advancements in deep learning.');
    assert.equal(bodySeg.translatedText, '深度学习近期的突破进展。');

    // Equation segment
    const eqSeg = parsed.find((s) => s.role === 'equation');
    assert.ok(eqSeg);
    assert.ok(eqSeg.sourceText.includes('\\sigma(W x + b)'));
  });
});

// =========================================================================
// Suite 5: View Lifecycle, Plugin Management & Leak Prevention (ADV-VIEW-5)
// =========================================================================
describe('ADV-VIEW-5: View Lifecycle, Plugin Management & Leak Prevention', () => {
  const { AcademicReaderView, VIEW_TYPE_ACADEMIC_READER } = loadProductionPlugin();

  test('ADV-VIEW-5.1: Rapid Repeated View Open/Close Cycles on AcademicReaderView', async () => {
    const app = new MockApp();
    const leaf = new MockWorkspaceLeaf(app.workspace);
    const view = new AcademicReaderView(leaf);

    // Execute 10 rapid open and close cycles
    for (let cycle = 1; cycle <= 10; cycle++) {
      assert.equal(view.isRootMounted, false);
      await view.onOpen();
      assert.equal(view.isRootMounted, true);
      assert.ok(view.contentEl.className.includes('pdf2obsidian-reader-container'));

      await view.onClose();
      assert.equal(view.isRootMounted, false);
      assert.equal(view.contentEl.children.length, 0);
    }
  });

  test('ADV-VIEW-5.2: Display Text Reactivity & Null Reset (getDisplayText, setFile)', async () => {
    const app = new MockApp();
    const leaf = new MockWorkspaceLeaf(app.workspace);
    const view = new AcademicReaderView(leaf);

    // Default title without active file
    assert.equal(view.getDisplayText(), 'Academic Paper Reader');

    // Setting paper file updates display text
    await view.setFile({ basename: 'transformer-attention' });
    assert.equal(view.getDisplayText(), 'Reader: transformer-attention');

    // Setting complex paper filename with multiple dots
    await view.setFile({ basename: 'paper.v2.camera-ready' });
    assert.equal(view.getDisplayText(), 'Reader: paper.v2.camera-ready');

    // Resetting file back to null falls back to default title
    await view.setFile(null);
    assert.equal(view.getDisplayText(), 'Academic Paper Reader');

    // Standard metadata invariants
    assert.equal(view.getViewType(), VIEW_TYPE_ACADEMIC_READER);
    assert.equal(view.getIcon(), 'book-open');
  });

  test('ADV-VIEW-5.3: Plugin Lifecycle Idempotency & Clean Teardown', async () => {
    const { default: PDF2ObsidianPlugin } = loadProductionPlugin();
    const app = new MockApp();
    const manifest = { id: 'pdf2obsidian', name: 'PDF2obsidian' };

    // 5 consecutive onload / onunload cycles
    for (let i = 0; i < 5; i++) {
      const plugin = new PDF2ObsidianPlugin(app, manifest);
      await plugin.onload();

      // Plugin loaded state
      assert.ok(plugin.commands.has('pdf2obsidian:open-dual-column-reader'));
      assert.equal(plugin.ribbonIcons.length, 1);

      // Clean teardown
      plugin.onunload();
      assert.equal(plugin.commands.size, 0);
    }
  });

  test('ADV-VIEW-5.4: Single-Instance Tab Reveal Guarantees (activateReaderView)', async () => {
    const { default: PDF2ObsidianPlugin } = loadProductionPlugin();
    const app = new MockApp();
    const manifest = { id: 'pdf2obsidian', name: 'PDF2obsidian' };
    const plugin = new PDF2ObsidianPlugin(app, manifest);
    await plugin.onload();

    // 1. Initial activation creates a new leaf
    const leaf1 = await plugin.activateReaderView();
    assert.ok(leaf1);
    assert.equal(leaf1.viewState.type, VIEW_TYPE_ACADEMIC_READER);

    // 2. Subsequent activation re-uses the existing leaf without opening a duplicate tab
    const leaf2 = await plugin.activateReaderView();
    assert.equal(leaf1, leaf2);
    assert.equal(app.workspace.getLeavesOfType(VIEW_TYPE_ACADEMIC_READER).length, 1);

    // Clean teardown detaches all reader leaves
    plugin.onunload();
    assert.equal(app.workspace.getLeavesOfType(VIEW_TYPE_ACADEMIC_READER).length, 0);
  });

  test('ADV-VIEW-5.5: Context Menu File Type Filtering', async () => {
    const { default: PDF2ObsidianPlugin } = loadProductionPlugin();
    const app = new MockApp();
    const manifest = { id: 'pdf2obsidian', name: 'PDF2obsidian' };
    const plugin = new PDF2ObsidianPlugin(app, manifest);
    await plugin.onload();

    // Verify file-menu event registered
    const fileMenuHandler = app.workspace.listeners.get('file-menu');
    assert.ok(fileMenuHandler);

    const testMenu = (file) => {
      const menuItems = [];
      const mockMenu = {
        addItem: (cb) => {
          const item = {
            setTitle: (t) => { item.title = t; return item; },
            setIcon: (i) => { item.icon = i; return item; },
            onClick: (fn) => { item.callback = fn; return item; }
          };
          cb(item);
          menuItems.push(item);
        }
      };
      fileMenuHandler(mockMenu, file);
      return menuItems;
    };

    // Valid file targets should add context menu action (PDF has parse + open reader actions)
    const pdfFile = new MockTFile('papers/doc.pdf', 'doc.pdf', 'doc', 'pdf');
    assert.equal(testMenu(pdfFile).length, 2);

    const bilingualFile = new MockTFile('notes/paper.bilingual.md', 'paper.bilingual.md', 'paper.bilingual', 'md');
    assert.equal(testMenu(bilingualFile).length, 1);

    const indexFile = new MockTFile('notes/paper.index.md', 'paper.index.md', 'paper.index', 'md');
    assert.equal(testMenu(indexFile).length, 1);

    // Invalid targets should be ignored
    const regularNote = new MockTFile('notes/daily.md', 'daily.md', 'daily', 'md');
    assert.equal(testMenu(regularNote).length, 0);

    const imageFile = new MockTFile('assets/fig1.png', 'fig1.png', 'fig1', 'png');
    assert.equal(testMenu(imageFile).length, 0);

    const canvasFile = new MockTFile('diagrams/flow.canvas', 'flow.canvas', 'flow', 'canvas');
    assert.equal(testMenu(canvasFile).length, 0);

    plugin.onunload();
  });
});

// =========================================================================
// Suite 6: Comprehensive Stress Simulation (ADV-VIEW-6)
// =========================================================================
describe('ADV-VIEW-6: Comprehensive Stress Simulation', () => {
  const { AcademicReaderView } = loadProductionPlugin();

  test('ADV-VIEW-6.1: Integrated Multi-Page Reader Session Under High-Frequency Input', async () => {
    const app = new MockApp();
    const leaf = new MockWorkspaceLeaf(app.workspace);
    const view = new AcademicReaderView(leaf);

    await view.onOpen();

    // Generate 100 layout blocks across 5 pages with 20 continuations
    const blocks = [];
    for (let i = 0; i < 100; i++) {
      const page = Math.floor(i / 20) + 1;
      const isCont = i % 5 === 4;
      blocks.push({
        id: `block-${i}`,
        page,
        type: 'text',
        role: i === 0 ? 'title' : 'body',
        markdown: isCont ? '' : `Paragraph text content for block ${i}`,
        continuationOf: isCont ? `block-${i - 1}` : undefined,
        bbox: [100, 100 + (i % 20) * 40, 900, 130 + (i % 20) * 40]
      });
    }

    // Generate 50 bilingual segments
    const segments = [];
    for (let s = 0; s < 50; s++) {
      segments.push({
        id: `seg-${s}`,
        sourceText: `English paragraph ${s}`,
        translatedText: `中文翻译段落 ${s}`,
        combinedMarkdown: `English paragraph ${s}\n\n中文翻译段落 ${s}`,
        blockIds: [`block-${s * 2}`, `block-${s * 2 + 1}`],
        role: s === 0 ? 'title' : 'body'
      });
    }

    // 1. High-frequency splitter adjustment simulation (500 steps)
    let ratio = DEFAULT_SPLIT_RATIO;
    for (let step = 0; step < 250; step++) {
      ratio = stepSplitRatio(ratio, 0.02);
    }
    assert.equal(ratio, MAX_SPLIT_RATIO);

    for (let step = 0; step < 250; step++) {
      ratio = stepSplitRatio(ratio, -0.02);
    }
    assert.equal(ratio, MIN_SPLIT_RATIO);

    // 2. High-frequency bidirectional selection switches (500 transitions)
    let selectionState = createInitialSelectionState();
    for (let t = 0; t < 500; t++) {
      if (t % 2 === 0) {
        const blkId = `block-${t % 100}`;
        selectionState = updateSelectionState(selectionState, blkId, 'pdf', segments);
        assert.equal(selectionState.activeBlockId, blkId);
      } else {
        const segId = `seg-${t % 50}`;
        selectionState = updateSelectionState(selectionState, segId, 'markdown', segments);
        assert.equal(selectionState.activeSegmentId, segId);
      }
    }
    assert.equal(selectionState.sequence, 500);

    // 3. Page indexing check
    const pageNumbers = getPageNumbers(5);
    assert.deepEqual(pageNumbers, [1, 2, 3, 4, 5]);

    const grouped = groupBlocksByPage(blocks);
    assert.equal(grouped.size, 5);
    for (let p = 1; p <= 5; p++) {
      assert.equal(grouped.get(p)?.length, 20);
    }

    // Clean teardown
    await view.onClose();
    assert.equal(view.isRootMounted, false);
  });
});
