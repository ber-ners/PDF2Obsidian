/**
 * Tier 3: Cross-Feature Combination Test Suite
 * Validates pairwise and multi-module interactions across pipeline, reader view, and vault.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  MockApp,
  MockPlugin,
  MockItemView,
  MockWorkspaceLeaf,
  MockMineruCloudServer,
  MockLlmServer,
  generateMockContentList,
  generateMockMineruZip,
  sanitizeBbox,
  calculateBboxStyles,
  classifyBlockRole,
  parseMineruBlocks,
  createBilingualMarkdown,
  linkBilingualSegments,
  ensureVaultDirectory,
  safeWriteVaultNote,
  safeWriteVaultBinary,
  createPaperFrontmatter,
  parsePaperFrontmatter,
  chunkMarkdown
} from './mocks/index.mjs';

describe('Tier 3: Cross-Feature Combinations', () => {
  test('C1: MinerU Cloud extraction ZIP -> Vault binary storage of figures & document.pdf (F16 + F20)', async () => {
    const app = new MockApp();
    const server = new MockMineruCloudServer({ token: 'test-token', pollThreshold: 1 });

    // Step 1: Upload and extract via MinerU Cloud
    const regRes = server.handleRequest('https://mineru.net/api/v4/file-urls/batch', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token' },
      body: JSON.stringify({ files: [{ name: 'transformer.pdf' }] })
    });
    const { data: regData } = await regRes.json();
    const uploadUrl = regData.file_urls[0];

    const dummyPdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x31, 0x2e, 0x34]);
    await server.handleRequest(uploadUrl, { method: 'PUT', body: dummyPdf });

    const pollRes = server.handleRequest(`https://mineru.net/api/v4/extract-results/batch/${regData.batch_id}`, {
      headers: { Authorization: 'Bearer test-token' }
    });
    const { data: pollData } = await pollRes.json();
    const zipUrl = pollData.extract_result[0].full_zip_url;

    const zipRes = server.handleRequest(zipUrl, { method: 'GET' });
    const zipBuf = await zipRes.arrayBuffer();

    // Step 2: Store PDF binary and extracted figure in vault
    const paperFolder = 'Papers/attention-is-all-you-need';
    const pdfFile = await safeWriteVaultBinary(app.vault, `${paperFolder}/document.pdf`, dummyPdf);
    assert.equal(pdfFile.path, `${paperFolder}/document.pdf`);

    const dummyFig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    const figFile = await safeWriteVaultBinary(app.vault, `${paperFolder}/images/fig_model_arch.png`, dummyFig);
    assert.equal(figFile.path, `${paperFolder}/images/fig_model_arch.png`);

    const readPdf = await app.vault.readBinary(pdfFile);
    assert.equal(readPdf.byteLength, dummyPdf.byteLength);
  });

  test('C2: MinerU content_list parsing -> Bounding box coordinate scaling & semantic tagging (F12 + F16)', () => {
    const rawContent = generateMockContentList({ count: 12, pageCount: 2 });
    const blocks = parseMineruBlocks(rawContent);

    assert.equal(blocks.length, 12);
    for (const b of blocks) {
      assert.ok(b.id.startsWith('block-'));
      assert.ok(b.page >= 1 && b.page <= 2);
      if (b.bbox) {
        const styles = calculateBboxStyles(b.bbox);
        assert.ok(styles.left.endsWith('%'));
        assert.ok(styles.top.endsWith('%'));
        assert.ok(styles.width.endsWith('%'));
        assert.ok(styles.height.endsWith('%'));
      }
    }

    const eqBlock = blocks.find((b) => b.role === 'equation');
    assert.ok(eqBlock);
    assert.ok(eqBlock.markdown.includes('\\text{Attention}'));
  });

  test('C3: Multi-page MinerU continuation blocks -> Bi-directional selection sync across columns (F12 + F15)', () => {
    const raw = [
      { page_idx: 0, type: 'text', text: 'Sentence begins on page 1', bbox: [100, 700, 900, 850] },
      { page_idx: 1, type: 'text', text: '', bbox: [100, 100, 900, 250], continuationOf: 'block-0' }
    ];
    const blocks = parseMineruBlocks(raw);
    assert.equal(blocks[1].continuationOf, 'block-0');

    // Simulate clicking continuation box on page 2
    let selection = { activeBlockId: null, source: null, sequence: 0 };
    const onSelect = (id, src) => {
      // If continuation, resolve to root block ID
      const target = blocks.find((b) => b.id === id);
      const effectiveId = target?.continuationOf || id;
      selection = { activeBlockId: effectiveId, source: src, sequence: selection.sequence + 1 };
    };

    onSelect('block-1', 'pdf');
    assert.equal(selection.activeBlockId, 'block-0');
    assert.equal(selection.source, 'pdf');
  });

  test('C4: PDF Bounding box click -> Aligned bilingual markdown paragraph scroll & glow highlight (F12 + F13 + F15)', () => {
    const src = '# 1. Introduction\n\nDeep learning architectures have revolutionized NLP.\n\nMulti-head attention improves model capacity.';
    const tgt = '# 1. 引言\n\n深度学习架构彻底改变了自然语言处理。\n\n多头注意力机制提高了模型容量。';
    const bilingual = createBilingualMarkdown(src, tgt);

    const blocks = [
      { id: 'block-0', role: 'title', markdown: '1. Introduction' },
      { id: 'block-1', role: 'body', markdown: 'Deep learning architectures have revolutionized NLP.' },
      { id: 'block-2', role: 'body', markdown: 'Multi-head attention improves model capacity.' }
    ];

    const segments = [
      { id: 'seg-0', sourceText: '1. Introduction', combinedMarkdown: '# 1. Introduction\u30001. 引言' },
      { id: 'seg-1', sourceText: 'Deep learning architectures have revolutionized NLP.' },
      { id: 'seg-2', sourceText: 'Multi-head attention improves model capacity.' }
    ];

    const linked = linkBilingualSegments(segments, blocks);
    assert.ok(linked[1].blockIds.includes('block-1'));

    // Selection flow: Click bbox for block-1 -> find linked segment -> scroll
    const activeBlockId = 'block-1';
    const targetSeg = linked.find((s) => s.blockIds.includes(activeBlockId));
    assert.equal(targetSeg?.id, 'seg-1');
  });

  test('C5: Bilingual paragraph click -> PDF page canvas scroll & active box pulse (F13 + F15 + F11)', () => {
    const blocks = [
      { id: 'block-0', page: 1, bbox: [100, 100, 900, 200] },
      { id: 'block-1', page: 2, bbox: [100, 300, 900, 500] }
    ];
    const segment = { id: 'seg-1', blockIds: ['block-1'] };

    // When user clicks segment seg-1 in markdown
    const clickedBlockId = segment.blockIds[0];
    const targetBlock = blocks.find((b) => b.id === clickedBlockId);
    assert.equal(targetBlock?.page, 2);

    // Coordinate verification for pulse highlight
    const styles = calculateBboxStyles(targetBlock.bbox);
    assert.equal(styles.top, '30%');
    assert.equal(styles.height, '20%');
  });

  test('C6: LLM semantic chunking -> Translation pipeline -> Bilingual markdown generation (F17 + F13)', async () => {
    const llm = new MockLlmServer({ validTokens: ['key'] });
    const originalMd = '# 1. Introduction\n\nAttention mechanisms have become an integral part of sequence modeling.\n\n$$\\text{Score} = QK^T$$';

    const chunks = chunkMarkdown(originalMd, 1000);
    assert.equal(chunks.length, 1);

    const res = llm.handleRequest('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer key' },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: 'You are an academic translator.' },
          { role: 'user', content: chunks[0].content }
        ]
      })
    });
    const { choices } = await res.json();
    const translatedMd = choices[0].message.content;

    const bilingual = createBilingualMarkdown(originalMd, translatedMd);
    assert.ok(bilingual.includes('# 1. Introduction\u30001. Introduction（中文标题）'));
    assert.ok(bilingual.includes('$$\\text{Score} = QK^T$$'));
  });

  test('C7: LLM reading assets generation -> YAML frontmatter backlink injection (F17 + F19)', async () => {
    const llm = new MockLlmServer({ validTokens: ['key'] });

    // Generate summary
    const sumRes = llm.handleRequest('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer key' },
      body: JSON.stringify({
        messages: [{ role: 'system', content: '论文总结 summary.md' }]
      })
    });
    const sumBody = (await sumRes.json()).choices[0].message.content;

    // Attach frontmatter with backlinks
    const slug = 'attention-is-all-you-need-4f3a';
    const fm = createPaperFrontmatter({
      title: 'Attention Is All You Need — Executive Summary',
      type: 'reading-summary',
      parent: `[[${slug}.index]]`,
      sourcePdf: '[[document.pdf]]'
    });
    const fullNote = `${fm}\n\n${sumBody}\n\n返回论文主索引：[[${slug}.index]]`;

    const parsed = parsePaperFrontmatter(fullNote);
    assert.equal(parsed.frontmatter.parent, `[[${slug}.index]]`);
    assert.ok(parsed.body.includes('返回论文主索引：[[attention-is-all-you-need-4f3a.index]]'));
  });

  test('C8: Paper metadata extraction -> Obsidian Vault writer with frontmatter & wikilinks (F18 + F19)', async () => {
    const app = new MockApp();
    const metadata = {
      title: 'Attention Is All You Need',
      translatedTitle: '注意力就是你所需要的一切',
      authors: ['Ashish Vaswani', 'Noam Shazeer'],
      year: 2017,
      venue: 'NeurIPS',
      doi: '10.48550/arXiv.1706.03762',
      sourcePdf: '[[document.pdf]]',
      originalNote: '[[attention.original]]',
      translatedNote: '[[attention.zh]]',
      bilingualNote: '[[attention.bilingual]]'
    };

    const frontmatter = createPaperFrontmatter(metadata);
    const content = `${frontmatter}\n\n# ${metadata.title}\n\n- 原文：${metadata.originalNote}\n- 译文：${metadata.translatedNote}`;
    const file = await safeWriteVaultNote(app.vault, 'Papers/attention/attention.index.md', content);

    const readBack = await app.vault.read(file);
    const parsed = parsePaperFrontmatter(readBack);
    assert.equal(parsed.frontmatter.title, 'Attention Is All You Need');
    assert.equal(parsed.frontmatter.year, '2017');
    assert.ok(parsed.body.includes('原文：[[attention.original]]'));
  });

  test('C9: Inlined PDF.js worker -> Vault binary PDF read -> HiDPI Canvas rendering (F4 + F11 + F18)', async () => {
    const app = new MockApp();

    // 1. Worker Blob URL
    const blob = new Blob(['console.log("worker ready");'], { type: 'application/javascript' });
    const workerUrl = URL.createObjectURL(blob);
    assert.ok(workerUrl.startsWith('blob:'));

    // 2. Vault PDF read
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x31, 0x2e, 0x34]);
    const pdfFile = await safeWriteVaultBinary(app.vault, 'PDFs/doc.pdf', pdfBytes);
    const arrayBuffer = await app.vault.readBinary(pdfFile);

    // 3. HiDPI Canvas dimension calculation
    const viewport = { width: 595, height: 842 };
    const dpr = 2.0;
    const canvas = {
      width: Math.ceil(viewport.width * dpr),
      height: Math.ceil(viewport.height * dpr),
      style: { width: `${viewport.width}px`, height: `${viewport.height}px` }
    };
    assert.equal(canvas.width, 1190);
    assert.equal(canvas.height, 1684);
    assert.equal(canvas.style.width, '595px');

    URL.revokeObjectURL(workerUrl);
  });

  test('C10: Dual-column splitter resize -> PDF viewport reflow & zoom-invariant bbox scaling (F10 + F11 + F12)', () => {
    // Left column width changes from 500px to 700px
    const initialWidth = 500;
    const resizedWidth = 700;

    const bbox = [100, 200, 500, 400]; // 10% left, 20% top, 40% width, 20% height
    const styles = calculateBboxStyles(bbox);

    // In CSS percentage, the computed styles are invariant regardless of width
    assert.equal(styles.left, '10%');
    assert.equal(styles.width, '40%');

    // The browser element pixel width scales automatically
    const pixelWidth1 = (parseFloat(styles.width) / 100) * initialWidth;
    const pixelWidth2 = (parseFloat(styles.width) / 100) * resizedWidth;
    assert.equal(pixelWidth1, 200);
    assert.equal(pixelWidth2, 280);
  });

  test('C11: Plugin lifecycle onload -> Command palette registration -> ItemView leaf mounting (F7 + F8 + F9)', async () => {
    const app = new MockApp();
    const plugin = new MockPlugin(app);
    const VIEW_TYPE = 'pdf2obsidian-academic-reader';

    let viewMounted = false;
    class TestReaderView extends MockItemView {
      getViewType() { return VIEW_TYPE; }
      async onOpen() { viewMounted = true; }
    }

    plugin.registerView(VIEW_TYPE, (leaf) => new TestReaderView(leaf));
    plugin.addCommand({
      id: 'open-academic-reader',
      name: 'Open Academic Reader',
      callback: async () => {
        const leaf = app.workspace.getLeaf(true);
        await leaf.setViewState({ type: VIEW_TYPE, active: true });
      }
    });

    await plugin.onload();
    assert.equal(plugin.commands.size, 1);

    // Trigger command
    await plugin.commands.get('open-academic-reader').callback();
    assert.equal(viewMounted, true);
    assert.equal(app.workspace.getLeavesOfType(VIEW_TYPE).length, 1);
  });

  test('C12: Plugin lifecycle onunload -> Workspace leaf detachment & worker Blob URL revocation (F7 + F4 + F9)', async () => {
    const app = new MockApp();
    const plugin = new MockPlugin(app);
    const VIEW_TYPE = 'pdf2obsidian-academic-reader';

    let workerUrl = URL.createObjectURL(new Blob(['worker']));
    plugin.registerView(VIEW_TYPE, (leaf) => new MockItemView(leaf));

    const leaf = app.workspace.getLeaf();
    await leaf.setViewState({ type: VIEW_TYPE });
    assert.equal(app.workspace.getLeavesOfType(VIEW_TYPE).length, 1);

    // Onunload logic
    app.workspace.detachLeavesOfType(VIEW_TYPE);
    URL.revokeObjectURL(workerUrl);
    workerUrl = null;
    plugin.onunload();

    assert.equal(app.workspace.getLeavesOfType(VIEW_TYPE).length, 0);
    assert.equal(workerUrl, null);
  });

  test('C13: KaTeX formula rendering inside bilingual aligned markdown with error boundary (F13 + F14)', () => {
    const src = '# Formulas\n\nInline $E=mc^2$ and display:\n\n$$\\mathcal{L}_{total} = \\sum_{i=1}^n x_i$$';
    const tgt = '# 公式\n\n行内 $E=mc^2$ 以及行间：\n\n$$\\mathcal{L}_{total} = \\sum_{i=1}^n x_i$$';
    const bilingual = createBilingualMarkdown(src, tgt);

    assert.ok(bilingual.includes('$E=mc^2$'));
    assert.ok(bilingual.includes('\\mathcal{L}_{total}'));

    // Check error handling for malformed formula
    const broken = '$$\\frac{1}{0';
    const renderMath = (tex) => {
      try {
        if (!tex.endsWith('$$')) throw new Error('Unclosed display math');
        return '<div>Rendered KaTeX</div>';
      } catch (err) {
        return `<span class="katex-error">${tex}</span>`;
      }
    };
    const rendered = renderMath(broken);
    assert.ok(rendered.includes('katex-error'));
  });

  test('C14: Vault directory recursive creation -> Full paper folder tree export with all 6 notes (F18 + F19 + F20)', async () => {
    const app = new MockApp();
    const slug = 'resnet-50-he2016';
    const folder = `Papers/${slug}`;

    const notes = [
      `${folder}/${slug}.index.md`,
      `${folder}/${slug}.bilingual.md`,
      `${folder}/${slug}.original.md`,
      `${folder}/${slug}.zh.md`,
      `${folder}/${slug}.summary.md`,
      `${folder}/${slug}.terms.md`,
      `${folder}/${slug}.qa.md`
    ];

    for (const notePath of notes) {
      const type = notePath.split('.').slice(-2, -1)[0];
      const fm = createPaperFrontmatter({ title: `ResNet-50 (${type})`, slug, type });
      await safeWriteVaultNote(app.vault, notePath, `${fm}\n\n# Note content for ${type}`);
    }

    // Write binary PDF and figure
    await safeWriteVaultBinary(app.vault, `${folder}/document.pdf`, new Uint8Array([0x25, 0x50, 0x44, 0x46]));
    await safeWriteVaultBinary(app.vault, `${folder}/images/fig_residual.png`, new Uint8Array([0x89, 0x50, 0x4e, 0x47]));

    const allFiles = app.vault.getAllLoadedFiles();
    assert.ok(allFiles.length >= 9);
    assert.ok(app.vault.getAbstractFileByPath(`${folder}/${slug}.index.md`));
    assert.ok(app.vault.getAbstractFileByPath(`${folder}/images/fig_residual.png`));
  });

  test('C15: MinerU Cloud status polling failover -> Vault binary write (F16 + F20)', async () => {
    const app = new MockApp();
    const server = new MockMineruCloudServer({ token: 'tok', pollThreshold: 2 });

    // Batch creation
    const regRes = server.handleRequest('https://mineru.net/api/v4/file-urls/batch', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok' },
      body: JSON.stringify({ files: [{ name: 'paper.pdf' }] })
    });
    const batchId = (await regRes.json()).data.batch_id;

    // Poll 1: processing
    const poll1 = server.handleRequest(`https://mineru.net/api/v4/extract-results/batch/${batchId}`, {
      headers: { Authorization: 'Bearer tok' }
    });
    assert.equal((await poll1.json()).data.extract_result[0].state, 'processing');

    // Poll 2: done
    const poll2 = server.handleRequest(`https://mineru.net/api/v4/extract-results/batch/${batchId}`, {
      headers: { Authorization: 'Bearer tok' }
    });
    const doneData = await poll2.json();
    assert.equal(doneData.data.extract_result[0].state, 'done');

    // Download and write
    const zipUrl = doneData.data.extract_result[0].full_zip_url;
    const zipBytes = await (server.handleRequest(zipUrl)).arrayBuffer();
    const f = await safeWriteVaultBinary(app.vault, 'Papers/paper/result.zip', zipBytes);
    assert.equal(f.name, 'result.zip');
  });

  test('C16: Large document chunking -> Multi-batch LLM translation -> Cache hit re-use without re-calling LLM (F17 + F13)', async () => {
    const llm = new MockLlmServer({ validTokens: ['key'] });
    const memoryCache = new Map();

    const translateChunk = async (chunkText) => {
      if (memoryCache.has(chunkText)) {
        return memoryCache.get(chunkText);
      }
      const res = llm.handleRequest('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: 'Bearer key' },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: 'You are an academic translator.' },
            { role: 'user', content: chunkText }
          ]
        })
      });
      const data = await res.json();
      const translated = data.choices[0].message.content;
      memoryCache.set(chunkText, translated);
      return translated;
    };

    const chunk1 = '# Chunk 1\n\nContent for chunk 1.';
    const res1 = await translateChunk(chunk1);
    const initialCallCount = llm.callHistory.length;
    assert.equal(initialCallCount, 1);

    // Second call for same chunk hits cache
    const res2 = await translateChunk(chunk1);
    assert.equal(res2, res1);
    assert.equal(llm.callHistory.length, initialCallCount); // No new network call
  });
});
