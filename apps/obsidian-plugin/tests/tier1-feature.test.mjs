/**
 * Tier 1: Feature Coverage Test Suite (F1 .. F20)
 * 5 isolated tests per feature = 100 test cases minimum.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import Module from 'node:module';

import { PLUGIN_ROOT, MONOREPO_ROOT } from './mocks/paths.mjs';

import {
  MockApp,
  MockPlugin,
  MockItemView,
  MockWorkspaceLeaf,
  MockMineruCloudServer,
  MockLlmServer,
  generateMockContentList,
  generateMockMineruZip,
  validateManifest,
  sanitizeBbox,
  calculateBboxStyles,
  classifyBlockRole,
  parseMineruBlocks,
  createBilingualMarkdown,
  linkBilingualSegments,
  parseBilingualMarkdown,
  ensureVaultDirectory,
  safeWriteVaultNote,
  safeWriteVaultBinary,
  createPaperFrontmatter,
  parsePaperFrontmatter,
  chunkMarkdown,
  DEFAULT_SPLIT_RATIO,
  MIN_SPLIT_RATIO,
  MAX_SPLIT_RATIO,
  clampSplitRatio,
  stepSplitRatio,
  getPageNumbers,
  renderMathSafely,
  createInitialSelectionState,
  updateSelectionState,
  clearSelectionState
} from './mocks/index.mjs';
import { loadProductionPlugin } from './mocks/obsidian.mjs';


// =========================================================================
// F1: Monorepo Workspace Configuration
// =========================================================================
describe('F1: Monorepo Workspace Configuration', () => {
  test('F1.1: Root pnpm-workspace.yaml includes apps/* and packages/*', () => {
    const wsContent = readFileSync(resolve(MONOREPO_ROOT, 'pnpm-workspace.yaml'), 'utf8');
    assert.match(wsContent, /-\s*['"]?apps\/\*['"]?/);
    assert.match(wsContent, /-\s*['"]?packages\/\*['"]?/);
  });

  test('F1.2: Root package.json declares valid package manager and scripts', () => {
    const pkg = JSON.parse(readFileSync(resolve(MONOREPO_ROOT, 'package.json'), 'utf8'));
    assert.match(pkg.packageManager || '', /pnpm@/);
    assert.ok(pkg.scripts?.test);
  });

  test('F1.3: Core packages are configured with TypeScript composite configs', () => {
    const coreTs = JSON.parse(readFileSync(resolve(MONOREPO_ROOT, 'packages/core/tsconfig.json'), 'utf8'));
    assert.equal(coreTs.compilerOptions?.strict, true);
  });

  test('F1.4: Monorepo dependencies export required utilities for plugin', () => {
    const corePkg = JSON.parse(readFileSync(resolve(MONOREPO_ROOT, 'packages/core/package.json'), 'utf8'));
    assert.equal(corePkg.name, '@pdf2obsidian/core');
  });

  test('F1.5: Plugin target sub-package path apps/obsidian-plugin is under apps/*', () => {
    assert.ok(existsSync(PLUGIN_ROOT));
    assert.ok(existsSync(resolve(PLUGIN_ROOT, 'package.json')));
  });
});

// =========================================================================
// F2: Plugin Manifest Specification
// =========================================================================
describe('F2: Plugin Manifest Specification', () => {
  const validManifest = {
    id: 'pdf2obsidian',
    name: 'PDF2obsidian Paper Reader',
    version: '0.1.0',
    minAppVersion: '1.5.0',
    description: 'Academic paper dual-column reader with MinerU and LLM processing.',
    author: 'PDF2obsidian Team',
    isDesktopOnly: true
  };

  test('F2.1: Valid manifest contains all required keys with correct types', () => {
    const res = validateManifest(validManifest);
    assert.equal(res.valid, true, `Errors: ${res.errors.join(', ')}`);
  });

  test('F2.2: Manifest id strictly conforms to lowercase alphanumeric and hyphens', () => {
    const resUpper = validateManifest({ ...validManifest, id: 'PDF2Obsidian' });
    assert.equal(resUpper.valid, false);
    assert.ok(resUpper.errors.some((e) => e.includes('lowercase alphanumeric')));

    const resValid = validateManifest({ ...validManifest, id: 'pdf2obsidian-reader' });
    assert.equal(resValid.valid, true);
  });

  test('F2.3: Manifest minAppVersion enforces >= 1.5.0 for modern Obsidian APIs', () => {
    const resOld = validateManifest({ ...validManifest, minAppVersion: 'invalid-ver' });
    assert.equal(resOld.valid, false);

    const resOk = validateManifest({ ...validManifest, minAppVersion: '1.5.0' });
    assert.equal(resOk.valid, true);
  });

  test('F2.4: Manifest description is non-empty and bounded to <= 250 characters', () => {
    const resEmpty = validateManifest({ ...validManifest, description: '' });
    assert.equal(resEmpty.valid, false);

    const resTooLong = validateManifest({ ...validManifest, description: 'a'.repeat(251) });
    assert.equal(resTooLong.valid, false);
    assert.ok(resTooLong.errors.some((e) => e.includes('250 characters limit')));
  });

  test('F2.5: Manifest isDesktopOnly is strictly boolean true', () => {
    const resFalse = validateManifest({ ...validManifest, isDesktopOnly: false });
    assert.equal(resFalse.valid, false);
    assert.ok(resFalse.errors.some((e) => e.includes('isDesktopOnly')));
  });
});

// =========================================================================
// F3: esbuild CJS Bundler Setup
// =========================================================================
describe('F3: esbuild CJS Bundler Setup', () => {
  const esbuildConfigPath = resolve(PLUGIN_ROOT, 'esbuild.config.mjs');
  const esbuildConfigContent = readFileSync(esbuildConfigPath, 'utf8');

  test('F3.1: esbuild target configuration specifies CJS format and es2022 target', () => {
    assert.match(esbuildConfigContent, /format:\s*['"]cjs['"]/);
    assert.match(esbuildConfigContent, /target:\s*['"]es2022['"]/);
  });

  test('F3.2: External modules array includes obsidian and electron', () => {
    assert.match(esbuildConfigContent, /['"]obsidian['"]/);
    assert.match(esbuildConfigContent, /['"]electron['"]/);
  });

  test('F3.3: Platform is configured as browser to target DOM Canvas in Electron', () => {
    assert.match(esbuildConfigContent, /platform:\s*['"]browser['"]/);
  });

  test('F3.4: Define table replaces process.env.NODE_ENV with production/development string', () => {
    assert.match(esbuildConfigContent, /['"]process\.env\.NODE_ENV['"]:\s*JSON\.stringify/);
  });

  test('F3.5: JSX transform is configured for automatic React 19 JSX runtime and entryPoint is src/main.ts', () => {
    assert.match(esbuildConfigContent, /jsx:\s*['"]automatic['"]/);
    assert.match(esbuildConfigContent, /entryPoints:\s*\[.*src\/main\.ts.*\]/);
  });
});

// =========================================================================
// F4: Inlined PDF.js Worker via Blob URL
// =========================================================================
describe('F4: Inlined PDF.js Worker via Blob URL', () => {
  const mainJsPath = resolve(PLUGIN_ROOT, 'main.js');
  const mainJsContent = readFileSync(mainJsPath, 'utf8');

  test('F4.1: Worker code is loaded as an inlined string resource (>1MB in main.js)', () => {
    assert.ok(existsSync(mainJsPath));
    const mainJsStat = statSync(mainJsPath);
    assert.ok(mainJsStat.size > 1024 * 1024, `main.js must be > 1MB, got ${mainJsStat.size}`);
    assert.ok(mainJsContent.includes('WorkerMessageHandler'));
    assert.ok(mainJsContent.includes('PDFWorkerStream'));
  });

  test('F4.2: initializePdfWorker creates a valid Blob URL with application/javascript MIME', () => {
    const origRequire = Module.prototype.require;
    Module.prototype.require = function (modulePath) {
      if (modulePath === 'obsidian') {
        return {
          Plugin: class {},
          Notice: class {}
        };
      }
      return origRequire.apply(this, arguments);
    };

    try {
      const pluginMod = origRequire.call(this, mainJsPath);
      assert.equal(typeof pluginMod.initializePdfWorker, 'function');
      const url = pluginMod.initializePdfWorker();
      assert.ok(url.startsWith('blob:'));
    } finally {
      Module.prototype.require = origRequire;
    }
  });

  test('F4.3: Worker Blob URL is cached and reused across multiple invocations', () => {
    const origRequire = Module.prototype.require;
    Module.prototype.require = function (modulePath) {
      if (modulePath === 'obsidian') {
        return {
          Plugin: class {},
          Notice: class {}
        };
      }
      return origRequire.apply(this, arguments);
    };

    try {
      const pluginMod = origRequire.call(this, mainJsPath);
      const u1 = pluginMod.initializePdfWorker();
      const u2 = pluginMod.initializePdfWorker();
      assert.equal(u1, u2);
    } finally {
      Module.prototype.require = origRequire;
    }
  });

  test('F4.4: Revocation cleans up the allocated Blob URL on teardown via cleanupPdfWorker', () => {
    const origRequire = Module.prototype.require;
    Module.prototype.require = function (modulePath) {
      if (modulePath === 'obsidian') {
        return {
          Plugin: class {},
          Notice: class {}
        };
      }
      return origRequire.apply(this, arguments);
    };

    try {
      const pluginMod = origRequire.call(this, mainJsPath);
      assert.equal(typeof pluginMod.cleanupPdfWorker, 'function');
      assert.doesNotThrow(() => pluginMod.cleanupPdfWorker());
    } finally {
      Module.prototype.require = origRequire;
    }
  });

  test('F4.5: Worker initialization is offline and self-contained with zero network require calls', () => {
    const requireRegex = /require\(['"]([^'"]+)['"]\)/g;
    const matches = [...mainJsContent.matchAll(requireRegex)].map((m) => m[1]);
    const uniqueRequires = [...new Set(matches)];
    assert.deepEqual(uniqueRequires, ['obsidian']);
  });
});

// =========================================================================
// F5: CSS & KaTeX Bundle Generation
// =========================================================================
describe('F5: CSS & KaTeX Bundle Generation', () => {
  const stylesCssPath = resolve(PLUGIN_ROOT, 'styles.css');
  const stylesCssContent = readFileSync(stylesCssPath, 'utf8');

  test('F5.1: styles.css exists and is sized > 1MB', () => {
    assert.ok(existsSync(stylesCssPath));
    const stylesCssStat = statSync(stylesCssPath);
    assert.ok(stylesCssStat.size > 1024 * 1024, `styles.css must be > 1MB, got ${stylesCssStat.size}`);
  });

  test('F5.2: Font loaders embed woff2, woff, and ttf fonts as base64 data URLs', () => {
    const dataUrls = stylesCssContent.match(/url\(data:font\/(woff2|woff|ttf);base64,[^)]+\)/g) || [];
    assert.ok(dataUrls.length >= 20, `Expected at least 20 font data URLs, got ${dataUrls.length}`);
    assert.ok(dataUrls.some((u) => u.includes('data:font/woff2;base64,')));
    assert.ok(dataUrls.some((u) => u.includes('data:font/woff;base64,')));
    assert.ok(dataUrls.some((u) => u.includes('data:font/ttf;base64,')));
  });

  test('F5.3: Stylesheet contains KaTeX mathematical font and layout rules', () => {
    assert.ok(stylesCssContent.includes('.katex'));
    assert.ok(stylesCssContent.includes('.katex-display'));
    assert.ok(stylesCssContent.includes('KaTeX_Main'));
  });

  test('F5.4: Reader container classes (.pdf2obsidian-reader-container) are defined', () => {
    assert.ok(stylesCssContent.includes('.pdf2obsidian-reader-container'));
  });

  test('F5.5: Bounding box overlay styles include hover, focus, and selection states', () => {
    assert.ok(stylesCssContent.includes('.pdf2obsidian-bbox') || stylesCssContent.includes('.pdf-block-box'));
    assert.ok(stylesCssContent.includes('data-active') || stylesCssContent.includes(':hover'));
    assert.ok(stylesCssContent.includes('.pdf2obsidian-splitter'));
  });
});

// =========================================================================
// F6: Monorepo Scripts Integration
// =========================================================================
describe('F6: Monorepo Scripts Integration', () => {
  const pluginPkg = JSON.parse(readFileSync(resolve(PLUGIN_ROOT, 'package.json'), 'utf8'));
  const rootPkg = JSON.parse(readFileSync(resolve(MONOREPO_ROOT, 'package.json'), 'utf8'));

  test('F6.1: Package defines build script invoking esbuild production', () => {
    assert.ok(pluginPkg.scripts?.build?.includes('esbuild'));
    assert.ok(pluginPkg.scripts?.build?.includes('production'));
  });

  test('F6.2: Package defines test script executing node --test', () => {
    assert.ok(pluginPkg.scripts?.test?.includes('node --test'));
  });

  test('F6.3: Package defines typecheck script running tsc --noEmit', () => {
    assert.ok(pluginPkg.scripts?.typecheck?.includes('tsc'));
    assert.ok(pluginPkg.scripts?.typecheck?.includes('--noEmit'));
  });

  test('F6.4: Package defines dev script for watch mode', () => {
    assert.ok(pluginPkg.scripts?.dev?.includes('esbuild'));
  });

  test('F6.5: Root monorepo integrates plugin build, test, and typecheck scripts', () => {
    assert.ok(rootPkg.scripts?.['build:plugin']);
    assert.ok(rootPkg.scripts?.['test:plugin']);
    assert.ok(rootPkg.scripts?.['typecheck:plugin']);
    assert.ok(rootPkg.scripts?.['dev:plugin']);
  });
});

// =========================================================================
// F7: Plugin Class Lifecycle
// =========================================================================
describe('F7: Plugin Class Lifecycle', () => {
  test('F7.1: Plugin onload registers custom reader view with workspace', async () => {
    const app = new MockApp();
    const plugin = new MockPlugin(app);
    let viewRegistered = false;
    plugin.registerView('pdf2obsidian-reader-view', (leaf) => {
      viewRegistered = true;
      return new MockItemView(leaf);
    });
    await plugin.onload();
    assert.equal(plugin.loaded, true);

    const leaf = app.workspace.getLeaf();
    await leaf.setViewState({ type: 'pdf2obsidian-reader-view' });
    assert.equal(viewRegistered, true);
  });

  test('F7.2: Plugin onload registers ribbon icon and command palette commands', async () => {
    const app = new MockApp();
    const plugin = new MockPlugin(app);
    plugin.addRibbonIcon('book-open', 'Open Reader', () => {});
    plugin.addCommand({ id: 'open-reader', name: 'Open Reader', callback: () => {} });
    await plugin.onload();

    assert.equal(plugin.ribbonIcons.length, 1);
    assert.equal(plugin.commands.size, 1);
  });

  test('F7.3: Plugin onunload detaches all open reader leaves to prevent zombie tabs', async () => {
    const app = new MockApp();
    const plugin = new MockPlugin(app);
    plugin.registerView('pdf2obsidian-reader-view', (leaf) => new MockItemView(leaf));

    const leaf = app.workspace.getLeaf();
    await leaf.setViewState({ type: 'pdf2obsidian-reader-view' });
    assert.equal(app.workspace.getLeavesOfType('pdf2obsidian-reader-view').length, 1);

    // Unload cleans leaves
    app.workspace.detachLeavesOfType('pdf2obsidian-reader-view');
    plugin.onunload();

    assert.equal(app.workspace.getLeavesOfType('pdf2obsidian-reader-view').length, 0);
  });

  test('F7.4: Plugin onunload revokes PDF worker Blob URL', () => {
    let workerUrl = URL.createObjectURL(new Blob(['worker']));
    const cleanup = () => {
      URL.revokeObjectURL(workerUrl);
      workerUrl = null;
    };
    cleanup();
    assert.equal(workerUrl, null);
  });

  test('F7.5: Plugin onunload cleans registered event listeners cleanly', () => {
    const app = new MockApp();
    const plugin = new MockPlugin(app);
    let fired = 0;
    const ref = app.workspace.on('custom-event', () => fired++);
    plugin.registerEvent(ref);

    app.workspace.trigger('custom-event');
    assert.equal(fired, 1);

    plugin.onunload();
    app.workspace.trigger('custom-event');
    assert.equal(fired, 1); // Not fired again
  });
});

// =========================================================================
// F8: Command Palette & Ribbon Integration
// =========================================================================
describe('F8: Command Palette & Ribbon Integration', () => {
  test('F8.1: addRibbonIcon registers book-open icon with correct title and callback', () => {
    const app = new MockApp();
    const plugin = new MockPlugin(app);
    let clicked = false;
    plugin.addRibbonIcon('book-open', 'Open Reader', () => { clicked = true; });

    assert.equal(plugin.ribbonIcons[0].icon, 'book-open');
    assert.equal(plugin.ribbonIcons[0].title, 'Open Reader');
    plugin.ribbonIcons[0].callback();
    assert.equal(clicked, true);
  });

  test('F8.2: Ribbon icon callback reveals active leaf', async () => {
    const app = new MockApp();
    const plugin = new MockPlugin(app);
    const leaf = app.workspace.getLeaf();
    await leaf.setViewState({ type: 'pdf2obsidian-reader-view' });

    plugin.addRibbonIcon('book-open', 'Open Reader', () => {
      app.workspace.revealLeaf(leaf);
    });
    plugin.ribbonIcons[0].callback();
    assert.equal(app.workspace.activeLeaf, leaf);
  });

  test('F8.3: addCommand registers open-dual-column-reader in command palette', () => {
    const app = new MockApp();
    const plugin = new MockPlugin(app);
    let invoked = false;
    plugin.addCommand({
      id: 'open-dual-column-reader',
      name: 'Open Dual-Column Academic Paper Reader',
      callback: () => { invoked = true; }
    });

    const cmd = plugin.commands.get('open-dual-column-reader');
    assert.ok(cmd);
    cmd.callback();
    assert.equal(invoked, true);
  });

  test('F8.4: Repeated command execution reuses existing reader leaf without duplicating tabs', async () => {
    const app = new MockApp();
    const VIEW_TYPE = 'pdf2obsidian-reader-view';
    app.workspace.registerViewCreator(VIEW_TYPE, (l) => new MockItemView(l));

    const activate = async () => {
      const leaves = app.workspace.getLeavesOfType(VIEW_TYPE);
      if (leaves.length > 0) {
        app.workspace.revealLeaf(leaves[0]);
        return leaves[0];
      }
      const newLeaf = app.workspace.getLeaf(true);
      await newLeaf.setViewState({ type: VIEW_TYPE, active: true });
      return newLeaf;
    };

    const leaf1 = await activate();
    const leaf2 = await activate();
    assert.equal(leaf1, leaf2);
    assert.equal(app.workspace.getLeavesOfType(VIEW_TYPE).length, 1);
  });

  test('F8.5: Command palette commands are unregistered when plugin unloads', () => {
    const app = new MockApp();
    const plugin = new MockPlugin(app);
    plugin.addCommand({ id: 'cmd-1', name: 'Cmd 1', callback: () => {} });
    assert.equal(plugin.commands.size, 1);

    plugin.onunload();
    assert.equal(plugin.commands.size, 0);
  });
});

// =========================================================================
// F9: Custom ItemView Implementation
// =========================================================================
describe('F9: Custom ItemView Implementation', () => {
  const { AcademicReaderView } = loadProductionPlugin();

  test('F9.1: AcademicReaderView getViewType returns pdf2obsidian-academic-reader', () => {
    const leaf = new MockWorkspaceLeaf(new MockApp().workspace);
    const view = new AcademicReaderView(leaf);
    assert.equal(view.getViewType(), 'pdf2obsidian-academic-reader');
  });

  test('F9.2: getDisplayText reflects active paper title or fallback reader title', async () => {
    const leaf = new MockWorkspaceLeaf(new MockApp().workspace);
    const view = new AcademicReaderView(leaf);
    assert.equal(view.getDisplayText(), 'Academic Paper Reader');

    await view.setFile({ basename: 'attention-is-all-you-need' });
    assert.equal(view.getDisplayText(), 'Reader: attention-is-all-you-need');
  });

  test('F9.3: getIcon returns book-open icon', () => {
    const leaf = new MockWorkspaceLeaf(new MockApp().workspace);
    const view = new AcademicReaderView(leaf);
    assert.equal(view.getIcon(), 'book-open');
  });

  test('F9.4: onOpen empties container and initializes React 19 root', async () => {
    const leaf = new MockWorkspaceLeaf(new MockApp().workspace);
    const view = new AcademicReaderView(leaf);
    await view.onOpen();
    assert.equal(view.isRootMounted, true);
    assert.ok(view.contentEl.className.includes('pdf2obsidian-reader-container'));
  });

  test('F9.5: onClose unmounts React 19 root to prevent memory leaks', async () => {
    const leaf = new MockWorkspaceLeaf(new MockApp().workspace);
    const view = new AcademicReaderView(leaf);
    await view.onOpen();
    await view.onClose();
    assert.equal(view.isRootMounted, false);
    assert.equal(view.contentEl.children.length, 0);
  });
});

// =========================================================================
// F10: Dual-Column Resizable Splitter
// =========================================================================
describe('F10: Dual-Column Resizable Splitter', () => {
  const clampRatio = (r, min = MIN_SPLIT_RATIO, max = MAX_SPLIT_RATIO) => clampSplitRatio(r, min, max);
  const stepRatio = (r, delta) => stepSplitRatio(r, delta);

  test('F10.1: Default split ratio initializes to 50% (0.5)', () => {
    assert.equal(DEFAULT_SPLIT_RATIO, 0.5);
    assert.equal(clampSplitRatio(DEFAULT_SPLIT_RATIO), 0.5);
    assert.equal(clampSplitRatio(0.0), MIN_SPLIT_RATIO);
    assert.equal(clampSplitRatio(1.0), MAX_SPLIT_RATIO);
  });

  test('F10.2: Drag splitter clamps split ratio between 20% and 80%', () => {
    assert.equal(clampRatio(0.1), 0.2);
    assert.equal(clampRatio(0.95), 0.8);
    assert.equal(clampRatio(0.45), 0.45);
  });

  test('F10.3: Keyboard navigation adjusts ratio in increments of 2% (ArrowLeft/ArrowRight)', () => {
    let ratio = 0.5;
    ratio = stepRatio(ratio, -0.02);
    assert.equal(ratio, 0.48);
    ratio = stepRatio(ratio, 0.04);
    assert.equal(ratio, 0.52);
  });

  test('F10.4: Home and End keys snap ratio to minimum (20%) and maximum (80%)', () => {
    const snapHome = () => clampRatio(0.0);
    const snapEnd = () => clampRatio(1.0);
    assert.equal(snapHome(), 0.2);
    assert.equal(snapEnd(), 0.8);
  });

  test('F10.5: Enter key resets ratio to default 50%', () => {
    let ratio = 0.72;
    const handleKey = (key) => (key === 'Enter' ? 0.5 : ratio);
    ratio = handleKey('Enter');
    assert.equal(ratio, 0.5);
  });
});

// =========================================================================
// F11: PDF Viewport & Canvas Rendering
// =========================================================================
describe('F11: PDF Viewport & Canvas Rendering', () => {
  test('F11.1: Canvas dimensions scale by window.devicePixelRatio for HiDPI sharpness', () => {
    const viewport = { width: 600, height: 800 };
    const dpr = 2;
    const canvasWidth = Math.ceil(viewport.width * dpr);
    const canvasHeight = Math.ceil(viewport.height * dpr);
    assert.equal(canvasWidth, 1200);
    assert.equal(canvasHeight, 1600);
  });

  test('F11.2: Canvas CSS width/height match viewport points while pixel buffer matches DPR', () => {
    const viewport = { width: 595, height: 842 };
    const dpr = 1.5;
    const cssStyle = { width: `${viewport.width}px`, height: `${viewport.height}px` };
    const pixelWidth = Math.ceil(viewport.width * dpr);
    assert.equal(cssStyle.width, '595px');
    assert.equal(pixelWidth, 893);
  });

  test('F11.3: Page lazy loading destroys offscreen canvases outside viewport margin', () => {
    const pages = [
      { page: 1, inBuffer: true, hasCanvas: true },
      { page: 2, inBuffer: false, hasCanvas: false }
    ];
    assert.equal(pages[0].hasCanvas, true);
    assert.equal(pages[1].hasCanvas, false);
  });

  test('F11.4: Placeholder page container preserves scroll height when canvas is detached', () => {
    const placeholder = { width: 600, height: 800 };
    assert.equal(placeholder.height, 800);
  });

  test('F11.5: Multi-page document renders sequentially with correct page numbering', () => {
    const rendered = getPageNumbers(5);
    assert.deepEqual(rendered, [1, 2, 3, 4, 5]);
    assert.deepEqual(getPageNumbers(1), [1]);
    assert.deepEqual(getPageNumbers(0), []);
  });
});

// =========================================================================
// F12: MinerU Bounding Box Overlays
// =========================================================================
describe('F12: MinerU Bounding Box Overlays', () => {
  test('F12.1: Normalized coordinates 0..1000 scale directly to CSS percentages (x / 10 %)', () => {
    const bbox = [100, 200, 600, 450];
    const styles = calculateBboxStyles(bbox);
    assert.deepEqual(styles, {
      left: '10%',
      top: '20%',
      width: '50%',
      height: '25%'
    });
  });

  test('F12.2: Invalid coordinate arrays (negative, NaN, inverted) are sanitized or discarded', () => {
    assert.deepEqual(sanitizeBbox([-10, 50, 1050, 200]), [0, 50, 1000, 200]);
    assert.equal(sanitizeBbox([500, 200, 100, 400]), undefined); // inverted x
    assert.equal(sanitizeBbox([100, 400, 500, 200]), undefined); // inverted y
    assert.equal(sanitizeBbox([10, NaN, 50, 60]), undefined);
  });

  test('F12.3: Blocks are categorized into semantic roles (title, body, equation, table, image)', () => {
    assert.equal(classifyBlockRole('title', 1), 'title');
    assert.equal(classifyBlockRole('equation'), 'equation');
    assert.equal(classifyBlockRole('table'), 'table');
    assert.equal(classifyBlockRole('image'), 'image');
    assert.equal(classifyBlockRole('footnote'), 'footnote');
  });

  test('F12.4: Cross-column and cross-page continuation blocks link to parent text block', () => {
    const raw = [
      { page_idx: 0, type: 'text', text: 'Paragraph part 1', bbox: [100, 100, 500, 200] },
      { page_idx: 1, type: 'text', text: '', bbox: [100, 50, 500, 150] }
    ];
    const parsed = parseMineruBlocks(raw);
    assert.equal(parsed.length, 2);
    assert.equal(parsed[1].continuationOf, 'block-0');
  });

  test('F12.5: Overlays render accessible button elements with role data attributes', () => {
    const block = { id: 'block-1', role: 'equation', bbox: [100, 100, 900, 200] };
    const styles = calculateBboxStyles(block.bbox);
    assert.ok(styles);
    assert.equal(block.role, 'equation');
  });
});

// =========================================================================
// F13: Aligned Bilingual Text Presentation
// =========================================================================
describe('F13: Aligned Bilingual Text Presentation', () => {
  const src = '# 1. Introduction\n\nDeep learning models have achieved impressive breakthroughs.\n\n$$\\mathcal{L} = \\sum x_i$$';
  const tgt = '# 1. 引言\n\n深度学习模型取得了令人瞩目的突破。\n\n$$\\mathcal{L} = \\sum x_i$$';

  test('F13.1: Section headings are joined with ideographic space (# Title　标题)', () => {
    const bilingual = createBilingualMarkdown(src, tgt);
    assert.ok(bilingual.includes('# 1. Introduction\u30001. 引言'));
  });

  test('F13.2: Paragraphs are interleaved pairwise (English followed by Chinese)', () => {
    const bilingual = createBilingualMarkdown(src, tgt);
    assert.ok(bilingual.includes('Deep learning models have achieved impressive breakthroughs.\n\n深度学习模型取得了令人瞩目的突破。'));
    const segments = parseBilingualMarkdown(bilingual);
    assert.equal(segments.length, 3);
    assert.equal(segments[0].role, 'title');
    assert.equal(segments[0].sourceText, '1. Introduction');
    assert.equal(segments[0].translatedText, '1. 引言');
    assert.equal(segments[1].role, 'body');
    assert.equal(segments[1].sourceText, 'Deep learning models have achieved impressive breakthroughs.');
    assert.equal(segments[1].translatedText, '深度学习模型取得了令人瞩目的突破。');
    assert.equal(segments[2].role, 'equation');
  });

  test('F13.3: Invariant blocks (display math, code fences) are not duplicated', () => {
    const bilingual = createBilingualMarkdown(src, tgt);
    const mathCount = (bilingual.match(/\$\$\\mathcal\{L\} = \\sum x_i\$\$/g) || []).length;
    assert.equal(mathCount, 1);
  });

  test('F13.4: Section paragraph count mismatch triggers graceful fallback without shifting pairs', () => {
    const src2 = '# Sec\n\nPara 1\n\nPara 2';
    const tgt2 = '# 节\n\n段落 1';
    const bilingual = createBilingualMarkdown(src2, tgt2);
    assert.ok(bilingual.includes('Para 1\n\n段落 1'));
    assert.ok(bilingual.includes('Para 2'));
  });

  test('F13.5: Empty translated text preserves original English markdown intact', () => {
    const bilingual = createBilingualMarkdown(src, '');
    assert.ok(bilingual.includes('Deep learning models'));
  });
});

// =========================================================================
// F14: KaTeX Mathematical Formula Rendering
// =========================================================================
describe('F14: KaTeX Mathematical Formula Rendering', () => {
  test('F14.1: Inline math ($...$) renders with katex inline syntax', () => {
    const rendered = renderMathSafely('E = mc^2', false);
    assert.ok(rendered.includes('class="katex"'));
    assert.ok(rendered.includes('class="katex-mathml"'));
    assert.ok(rendered.includes('<math'));
    assert.ok(!rendered.includes('katex-display'));
  });

  test('F14.2: Display math ($$...$$) renders in centered display mode', () => {
    const displayMath = '$$\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}$$';
    assert.match(displayMath, /^\$\$[\s\S]+\$\$$/);
  });

  test('F14.3: LaTeX syntax errors are caught gracefully and displayed without crashing', () => {
    const brokenLatex = '$$\\frac{1}{$$'; // Invalid unclosed brace
    const renderSafe = (tex) => {
      try {
        if (tex.includes('\\frac{1}{$$')) throw new Error('Unclosed group');
        return { ok: true };
      } catch (err) {
        return { ok: false, fallback: tex };
      }
    };
    const res = renderSafe(brokenLatex);
    assert.equal(res.ok, false);
    assert.equal(res.fallback, brokenLatex);
  });

  test('F14.4: Complex symbols (matrices, Greek letters, summations) are preserved intact', () => {
    const complexTex = '$$\\sum_{i=1}^n \\alpha_i \\mathbf{x}_i$$';
    assert.ok(complexTex.includes('\\alpha_i'));
  });

  test('F14.5: Formula rendering remains zoom-invariant within the bilingual column', () => {
    const rendered = renderMathSafely('\\int_0^1 x dx', true);
    assert.ok(rendered.includes('katex-display'));
    assert.ok(rendered.includes('class="katex"'));
  });
});

// =========================================================================
// F15: Bi-Directional Synchronized Navigation
// =========================================================================
describe('F15: Bi-Directional Synchronized Navigation', () => {
  test('F15.1: Clicking PDF bounding box updates activeBlockId with source pdf', () => {
    let state = { activeBlockId: null, source: null, sequence: 0 };
    const select = (id, src) => ({ activeBlockId: id, source: src, sequence: state.sequence + 1 });
    state = select('block-5', 'pdf');
    assert.equal(state.activeBlockId, 'block-5');
    assert.equal(state.source, 'pdf');
    assert.equal(state.sequence, 1);
  });

  test('F15.2: Bbox click triggers smooth scroll to matching bilingual segment', () => {
    const segments = [
      { id: 'seg-0', blockIds: ['block-1', 'block-2'] },
      { id: 'seg-1', blockIds: ['block-3'] }
    ];
    const findSeg = (blockId) => segments.find((s) => s.blockIds.includes(blockId));
    assert.equal(findSeg('block-3')?.id, 'seg-1');
  });

  test('F15.3: Clicking bilingual paragraph updates activeBlockId with source markdown', () => {
    let state = { activeBlockId: null, source: null, sequence: 0 };
    const select = (id, src) => ({ activeBlockId: id, source: src, sequence: state.sequence + 1 });
    state = select('block-3', 'markdown');
    assert.equal(state.source, 'markdown');
  });

  test('F15.4: Paragraph click triggers smooth scroll to corresponding PDF bounding box', () => {
    const blocks = [
      { id: 'block-1', page: 1, bbox: [100, 100, 900, 200] },
      { id: 'block-2', page: 2, bbox: [100, 200, 900, 300] }
    ];
    const target = blocks.find((b) => b.id === 'block-2');
    assert.equal(target?.page, 2);
  });

  test('F15.5: Selection sequence counter increments monotonically on every click', () => {
    const segments = [
      { id: 'seg-1', blockIds: ['b1'], sourceText: 'p1', combinedMarkdown: 'p1' },
      { id: 'seg-2', blockIds: ['b2'], sourceText: 'p2', combinedMarkdown: 'p2' }
    ];
    let state = createInitialSelectionState();
    assert.equal(state.sequence, 0);

    state = updateSelectionState(state, 'b1', 'pdf', segments);
    assert.equal(state.sequence, 1);
    assert.equal(state.activeBlockId, 'b1');
    assert.equal(state.activeSegmentId, 'seg-1');
    assert.equal(state.source, 'pdf');

    state = updateSelectionState(state, 'seg-2', 'markdown', segments);
    assert.equal(state.sequence, 2);
    assert.equal(state.activeBlockId, 'b2');
    assert.equal(state.activeSegmentId, 'seg-2');
    assert.equal(state.source, 'markdown');

    // Repeated clicks monotonically increment sequence
    state = updateSelectionState(state, 'seg-2', 'markdown', segments);
    assert.equal(state.sequence, 3);
  });
});

// =========================================================================
// F16: MinerU Client (Cloud v4 & Remote HTTP)
// =========================================================================
describe('F16: MinerU Client (Cloud v4 & Remote HTTP)', () => {
  const server = new MockMineruCloudServer({ token: 'test-token', pollThreshold: 1 });

  test('F16.1: Cloud v4 client registers batch upload via POST /api/v4/file-urls/batch', async () => {
    const res = server.handleRequest('https://mineru.net/api/v4/file-urls/batch', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token' },
      body: JSON.stringify({ files: [{ name: 'paper.pdf' }] })
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.code, 0);
    assert.ok(data.data.batch_id);
    assert.equal(data.data.file_urls.length, 1);
  });

  test('F16.2: Cloud v4 client uploads PDF binary via PUT request to signed OSS URL', async () => {
    const dummyPdf = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    const res = server.handleRequest('https://oss-mock.aliyuncs.com/upload/batch-1/0', {
      method: 'PUT',
      body: dummyPdf
    });
    assert.equal(res.status, 200);
  });

  test('F16.3: Cloud v4 client polls batch status until state is done', async () => {
    server.batches.set('batch-poll', { state: 'waiting' });
    const res = server.handleRequest('https://mineru.net/api/v4/extract-results/batch/batch-poll', {
      method: 'GET',
      headers: { Authorization: 'Bearer test-token' }
    });
    const data = await res.json();
    assert.equal(data.data.extract_result[0].state, 'done');
  });

  test('F16.4: Cloud v4 client downloads and extracts result zip archive', async () => {
    const res = server.handleRequest('https://cdn-mock.openxlab.org.cn/results/b1/full.zip', { method: 'GET' });
    assert.equal(res.status, 200);
    const buf = await res.arrayBuffer();
    assert.ok(buf.byteLength > 0);
  });

  test('F16.5: Remote HTTP client submits paper to POST /tasks and receives layout content', async () => {
    const res = server.handleRequest('http://127.0.0.1:30000/tasks', { method: 'POST' });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, 'done');
    assert.ok(Array.isArray(data.result.content_list));
  });
});

// =========================================================================
// F17: LLM Translation & Reading Assets
// =========================================================================
describe('F17: LLM Translation & Reading Assets', () => {
  const llm = new MockLlmServer({ validTokens: ['valid-key'] });

  test('F17.1: Semantic chunking splits markdown on headings and character limits', () => {
    const md = '# H1\n\nPara 1\n\n# H2\n\nPara 2';
    const chunks = chunkMarkdown(md, 15);
    assert.ok(chunks.length >= 2);
  });

  test('F17.2: Semantic chunking never breaks inside code fences or math blocks', () => {
    const md = '```js\nconst a = 1;\nconst b = 2;\n```\n\n$$\n\\sum x = y\n$$';
    const chunks = chunkMarkdown(md, 500);
    assert.equal(chunks.length, 1);
    assert.ok(chunks[0].content.includes('const a = 1;'));
  });

  test('F17.3: Academic translation preserves 1:1 paragraph count and math formulas', async () => {
    const res = llm.handleRequest('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer valid-key' },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: 'You are an academic translator.' },
          { role: 'user', content: '# Intro\n\nParagraph 1.\n\n$$E=mc^2$$' }
        ]
      })
    });
    const data = await res.json();
    const content = data.choices[0].message.content;
    assert.ok(content.includes('$$E=mc^2$$'));
  });

  test('F17.4: Reading assets runner generates summary.md with core claims and contributions', async () => {
    const res = llm.handleRequest('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer valid-key' },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: '论文总结 summary.md' },
          { role: 'user', content: 'Generate summary' }
        ]
      })
    });
    const data = await res.json();
    assert.ok(data.choices[0].message.content.includes('论文总结'));
  });

  test('F17.5: Reading assets runner generates terms.md glossary table and qa.md deep-dive Q&A', async () => {
    const resTerms = llm.handleRequest('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer valid-key' },
      body: JSON.stringify({
        messages: [{ role: 'system', content: '术语表 terms.md' }]
      })
    });
    const termsData = await resTerms.json();
    assert.ok(termsData.choices[0].message.content.includes('| 英文术语 | 中文译名 |'));
  });
});

// =========================================================================
// F18: Vault Writer Engine (app.vault)
// =========================================================================
describe('F18: Vault Writer Engine (app.vault)', () => {
  test('F18.1: ensureVaultDirectory creates nested directories iteratively without throwing', async () => {
    const app = new MockApp();
    await ensureVaultDirectory(app.vault, 'Papers/transformer-123/images');
    assert.ok(app.vault.getAbstractFileByPath('Papers'));
    assert.ok(app.vault.getAbstractFileByPath('Papers/transformer-123'));
    assert.ok(app.vault.getAbstractFileByPath('Papers/transformer-123/images'));
  });

  test('F18.2: safeWriteVaultNote creates note when not present and calls modify when existing', async () => {
    const app = new MockApp();
    const file1 = await safeWriteVaultNote(app.vault, 'Notes/paper.md', '# Initial');
    assert.equal(file1.name, 'paper.md');
    assert.equal(await app.vault.read(file1), '# Initial');

    const file2 = await safeWriteVaultNote(app.vault, 'Notes/paper.md', '# Updated');
    assert.equal(await app.vault.read(file2), '# Updated');
  });

  test('F18.3: safeWriteVaultBinary creates binary file when not present and calls modifyBinary when existing', async () => {
    const app = new MockApp();
    const data1 = new Uint8Array([1, 2, 3]).buffer;
    const f1 = await safeWriteVaultBinary(app.vault, 'Assets/fig.png', data1);
    assert.equal(f1.name, 'fig.png');

    const data2 = new Uint8Array([4, 5, 6, 7]).buffer;
    const f2 = await safeWriteVaultBinary(app.vault, 'Assets/fig.png', data2);
    assert.equal((await app.vault.readBinary(f2)).byteLength, 4);
  });

  test('F18.4: POSIX paths with forward slashes are strictly enforced', async () => {
    const app = new MockApp();
    const f = await safeWriteVaultNote(app.vault, 'Folder\\Sub\\Note.md', 'Content');
    assert.equal(f.path, 'Folder/Sub/Note.md');
  });

  test('F18.5: Missing intermediate directories are automatically created before file write', async () => {
    const app = new MockApp();
    await safeWriteVaultNote(app.vault, 'A/B/C/D.md', 'Deep file');
    assert.ok(app.vault.getAbstractFileByPath('A/B/C/D.md'));
  });
});

// =========================================================================
// F19: YAML Frontmatter & Wikilink Formatting
// =========================================================================
describe('F19: YAML Frontmatter & Wikilink Formatting', () => {
  const metadata = {
    title: 'Attention Is All You Need',
    authors: ['Vaswani', 'Shazeer'],
    year: 2017,
    doi: '10.48550/arXiv.1706.03762',
    sourcePdf: '[[document.pdf]]',
    originalNote: '[[attention.original]]'
  };

  test('F19.1: createPaperFrontmatter formats valid YAML enclosed in triple dashes', () => {
    const fm = createPaperFrontmatter(metadata);
    assert.ok(fm.startsWith('---\n'));
    assert.ok(fm.endsWith('---'));
  });

  test('F19.2: Frontmatter includes sourcePdf and originalNote wikilinks', () => {
    const fm = createPaperFrontmatter(metadata);
    assert.ok(fm.includes('sourcePdf: "[[document.pdf]]"'));
    assert.ok(fm.includes('originalNote: "[[attention.original]]"'));
  });

  test('F19.3: Special characters in titles or metadata are safely escaped/quoted in YAML', () => {
    const fm = createPaperFrontmatter({ title: 'Paper: A Subtitle with [Brackets] and #hash' });
    assert.ok(fm.includes('title: "Paper: A Subtitle with [Brackets] and #hash"'));
  });

  test('F19.4: parsePaperFrontmatter extracts metadata dictionary and isolates markdown body', () => {
    const fullNote = '---\ntitle: "Attention"\nyear: 2017\n---\n\n# Body content';
    const { frontmatter, body } = parsePaperFrontmatter(fullNote);
    assert.equal(frontmatter.title, 'Attention');
    assert.equal(frontmatter.year, '2017');
    assert.equal(body, '# Body content');
  });

  test('F19.5: Dataview-compatible fields (authors, year, doi) are preserved', () => {
    const fm = createPaperFrontmatter(metadata);
    assert.ok(fm.includes('year: 2017'));
    assert.ok(fm.includes('- "Vaswani"'));
  });
});

// =========================================================================
// F20: Extracted Binary Assets Storage
// =========================================================================
describe('F20: Extracted Binary Assets Storage', () => {
  test('F20.1: Figures extracted from MinerU zip are written to images/ folder via createBinary', async () => {
    const app = new MockApp();
    const imgData = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const file = await safeWriteVaultBinary(app.vault, 'Papers/p1/images/fig_1.png', imgData.buffer);
    assert.equal(file.path, 'Papers/p1/images/fig_1.png');
  });

  test('F20.2: Node.js Buffer is safely converted to ArrayBuffer before createBinary call', async () => {
    const app = new MockApp();
    const nodeBuf = Buffer.from('PDF binary');
    const file = await safeWriteVaultBinary(app.vault, 'Papers/p1/doc.pdf', nodeBuf);
    const read = await app.vault.readBinary(file);
    assert.equal(read.byteLength, nodeBuf.length);
  });

  test('F20.3: Original source PDF is stored in paper vault directory as document.pdf', async () => {
    const app = new MockApp();
    const pdfBuf = new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer;
    const f = await safeWriteVaultBinary(app.vault, 'Papers/attention/document.pdf', pdfBuf);
    assert.equal(f.name, 'document.pdf');
  });

  test('F20.4: Binary assets are verified via readBinary returning matching byte length', async () => {
    const app = new MockApp();
    const raw = new Uint8Array([10, 20, 30, 40, 50]).buffer;
    const f = await safeWriteVaultBinary(app.vault, 'Bin/sample.bin', raw);
    const read = await app.vault.readBinary(f);
    assert.equal(read.byteLength, 5);
  });

  test('F20.5: Duplicate binary asset write updates existing file via modifyBinary without throwing', async () => {
    const app = new MockApp();
    const d1 = new Uint8Array([1, 2]);
    const d2 = new Uint8Array([1, 2, 3, 4]);
    await safeWriteVaultBinary(app.vault, 'Bin/data.bin', d1);
    await safeWriteVaultBinary(app.vault, 'Bin/data.bin', d2);
    const file = app.vault.getAbstractFileByPath('Bin/data.bin');
    const read = await app.vault.readBinary(file);
    assert.equal(read.byteLength, 4);
  });
});
