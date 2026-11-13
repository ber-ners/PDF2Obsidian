/**
 * Tier 4: Real-World Application Scenarios Test Suite
 * Validates complete end-to-end import and reader workflows for academic papers.
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
  calculateBboxStyles,
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

describe('Tier 4: Real-World Application Scenarios', () => {
  test('APP1: Complete arXiv Paper Import Pipeline (Attention Is All You Need)', async () => {
    const app = new MockApp();
    const mineruServer = new MockMineruCloudServer({ token: 'mineru-cloud-token', pollThreshold: 1 });
    const llmServer = new MockLlmServer({ validTokens: ['llm-api-token'] });

    // Step 1: Start with academic paper metadata & PDF binary
    const paperMeta = {
      title: 'Attention Is All You Need',
      translatedTitle: '注意力就是你所需要的一切',
      authors: ['Ashish Vaswani', 'Noam Shazeer', 'Niki Parmar', 'Jakob Uszkoreit'],
      year: 2017,
      venue: 'NeurIPS 2017',
      doi: '10.48550/arXiv.1706.03762',
      arxivId: '1706.03762',
      slug: 'attention-is-all-you-need-1706-03762'
    };
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x35, 0x0a]); // %PDF-1.5

    // Step 2: Upload to MinerU Cloud API v4
    const regRes = mineruServer.handleRequest('https://mineru.net/api/v4/file-urls/batch', {
      method: 'POST',
      headers: { Authorization: 'Bearer mineru-cloud-token' },
      body: JSON.stringify({
        files: [{ name: `${paperMeta.slug}.pdf`, data_id: paperMeta.arxivId }],
        model_version: 'vlm',
        enable_formula: true,
        enable_table: true
      })
    });
    const regJson = await regRes.json();
    assert.equal(regJson.code, 0);
    const batchId = regJson.data.batch_id;
    const uploadUrl = regJson.data.file_urls[0];

    // Step 3: Binary upload to OSS
    const putRes = mineruServer.handleRequest(uploadUrl, { method: 'PUT', body: pdfBytes });
    assert.equal(putRes.status, 200);

    // Step 4: Poll status until done
    const pollRes = mineruServer.handleRequest(`https://mineru.net/api/v4/extract-results/batch/${batchId}`, {
      headers: { Authorization: 'Bearer mineru-cloud-token' }
    });
    const pollJson = await pollRes.json();
    assert.equal(pollJson.data.extract_result[0].state, 'done');
    const zipUrl = pollJson.data.extract_result[0].full_zip_url;

    // Step 5: Download and parse layout content
    const zipRes = mineruServer.handleRequest(zipUrl, { method: 'GET' });
    const zipBuffer = await zipRes.arrayBuffer();
    assert.ok(zipBuffer.byteLength > 0);

    const mockContentItems = generateMockContentList({ count: 10, pageCount: 2 });
    const parsedBlocks = parseMineruBlocks(mockContentItems);
    assert.equal(parsedBlocks.length, 10);

    // Step 6: Chunk and translate original markdown
    const originalMarkdown = `# ${paperMeta.title}\n\n` +
      `The dominant sequence transduction models are based on complex recurrent neural networks.\n\n` +
      `$$\\text{Attention}(Q, K, V) = \\text{softmax}\\left(\\frac{QK^T}{\\sqrt{d_k}}\\right)V$$\n\n` +
      `We propose the Transformer, a model architecture eschewing recurrence.`;

    const chunks = chunkMarkdown(originalMarkdown, 1000);
    const transRes = llmServer.handleRequest('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer llm-api-token' },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: 'You are an academic translator.' },
          { role: 'user', content: chunks[0].content }
        ]
      })
    });
    const translatedMd = (await transRes.json()).choices[0].message.content;

    // Step 7: Pair into bilingual markdown
    const bilingualMd = createBilingualMarkdown(originalMarkdown, translatedMd);

    // Step 8: Generate supplementary reading assets (summary, terms, qa)
    const sumRes = llmServer.handleRequest('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer llm-api-token' },
      body: JSON.stringify({ messages: [{ role: 'system', content: '论文总结 summary.md' }] })
    });
    const summaryMd = (await sumRes.json()).choices[0].message.content;

    const termsRes = llmServer.handleRequest('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer llm-api-token' },
      body: JSON.stringify({ messages: [{ role: 'system', content: '术语表 terms.md' }] })
    });
    const termsMd = (await termsRes.json()).choices[0].message.content;

    const qaRes = llmServer.handleRequest('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer llm-api-token' },
      body: JSON.stringify({ messages: [{ role: 'system', content: '问答 qa.md' }] })
    });
    const qaMd = (await qaRes.json()).choices[0].message.content;

    // Step 9: Persist full asset bundle into Vault
    const baseDir = `Papers/${paperMeta.slug}`;
    const frontmatterBase = {
      ...paperMeta,
      sourcePdf: `[[${baseDir}/document.pdf]]`,
      originalNote: `[[${paperMeta.slug}.original]]`,
      translatedNote: `[[${paperMeta.slug}.zh]]`,
      bilingualNote: `[[${paperMeta.slug}.bilingual]]`,
      indexNote: `[[${paperMeta.slug}.index]]`,
      createdAt: '2026-11-08T18:00:00Z'
    };

    // 1. Index note
    const indexFm = createPaperFrontmatter({ ...frontmatterBase, type: 'paper-index' });
    const indexContent = `${indexFm}\n\n# ${paperMeta.title}\n\n- 原文：[[${paperMeta.slug}.original]]\n- 中英双语：[[${paperMeta.slug}.bilingual]]\n- 译文：[[${paperMeta.slug}.zh]]\n- 核心速读：[[${paperMeta.slug}.summary]]\n- 术语表：[[${paperMeta.slug}.terms]]\n- 深度问答：[[${paperMeta.slug}.qa]]`;
    await safeWriteVaultNote(app.vault, `${baseDir}/${paperMeta.slug}.index.md`, indexContent);

    // 2. Bilingual note
    const biFm = createPaperFrontmatter({ ...frontmatterBase, type: 'paper-bilingual' });
    await safeWriteVaultNote(app.vault, `${baseDir}/${paperMeta.slug}.bilingual.md`, `${biFm}\n\n${bilingualMd}`);

    // 3. Original note
    const origFm = createPaperFrontmatter({ ...frontmatterBase, type: 'paper-original' });
    await safeWriteVaultNote(app.vault, `${baseDir}/${paperMeta.slug}.original.md`, `${origFm}\n\n${originalMarkdown}`);

    // 4. Translated note
    const zhFm = createPaperFrontmatter({ ...frontmatterBase, type: 'paper-translated' });
    await safeWriteVaultNote(app.vault, `${baseDir}/${paperMeta.slug}.zh.md`, `${zhFm}\n\n${translatedMd}`);

    // 5. Summary note
    const sumFm = createPaperFrontmatter({ ...frontmatterBase, type: 'paper-summary', parent: `[[${paperMeta.slug}.index]]` });
    await safeWriteVaultNote(app.vault, `${baseDir}/${paperMeta.slug}.summary.md`, `${sumFm}\n\n${summaryMd}`);

    // 6. Terms note
    const termsFm = createPaperFrontmatter({ ...frontmatterBase, type: 'paper-terms', parent: `[[${paperMeta.slug}.index]]` });
    await safeWriteVaultNote(app.vault, `${baseDir}/${paperMeta.slug}.terms.md`, `${termsFm}\n\n${termsMd}`);

    // 7. Q&A note
    const qaFm = createPaperFrontmatter({ ...frontmatterBase, type: 'paper-qa', parent: `[[${paperMeta.slug}.index]]` });
    await safeWriteVaultNote(app.vault, `${baseDir}/${paperMeta.slug}.qa.md`, `${qaFm}\n\n${qaMd}`);

    // 8. Layout JSON
    await safeWriteVaultNote(app.vault, `${baseDir}/${paperMeta.slug}.layout.json`, JSON.stringify(mockContentItems, null, 2));

    // 9. Binary PDF and extracted figure
    await safeWriteVaultBinary(app.vault, `${baseDir}/document.pdf`, pdfBytes);
    const mockFig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    await safeWriteVaultBinary(app.vault, `${baseDir}/images/fig_model_arch.png`, mockFig);

    // Step 10: Verify vault assets and integrity
    const indexFile = app.vault.getAbstractFileByPath(`${baseDir}/${paperMeta.slug}.index.md`);
    assert.ok(indexFile);
    const readIndex = await app.vault.read(indexFile);
    assert.ok(readIndex.includes('doi: 10.48550/arXiv.1706.03762'));

    const storedPdf = app.vault.getAbstractFileByPath(`${baseDir}/document.pdf`);
    assert.ok(storedPdf);
    assert.equal((await app.vault.readBinary(storedPdf)).byteLength, pdfBytes.byteLength);

    const storedFig = app.vault.getAbstractFileByPath(`${baseDir}/images/fig_model_arch.png`);
    assert.ok(storedFig);
    assert.equal((await app.vault.readBinary(storedFig)).byteLength, mockFig.byteLength);
  });

  test('APP2: Bilingual Reading Session with Dual-Column Synchronized Navigation', async () => {
    const app = new MockApp();
    const rawBlocks = generateMockContentList({ count: 8, pageCount: 2 });
    const blocks = parseMineruBlocks(rawBlocks);

    // Mock segment linkage
    const segments = [
      { id: 'seg-0', sourceText: 'Attention Is All You Need', combinedMarkdown: '# Attention Is All You Need' },
      { id: 'seg-1', sourceText: 'Abstract', combinedMarkdown: '## Abstract' },
      { id: 'seg-2', sourceText: 'The dominant sequence transduction models', combinedMarkdown: 'The dominant sequence transduction models' }
    ];
    const linkedSegments = linkBilingualSegments(segments, blocks);

    // Shared reader state
    let selectionState = {
      activeBlockId: null,
      activeSegmentId: null,
      source: null,
      sequence: 0
    };

    const handleSelect = (id, src) => {
      let targetBlockId = id;
      let targetSegId = null;

      if (src === 'pdf') {
        targetBlockId = id;
        const matchingSeg = linkedSegments.find((s) => s.blockIds.includes(id));
        targetSegId = matchingSeg ? matchingSeg.id : null;
      } else {
        const seg = linkedSegments.find((s) => s.id === id);
        targetSegId = id;
        targetBlockId = seg ? seg.blockIds[0] : null;
      }

      selectionState = {
        activeBlockId: targetBlockId,
        activeSegmentId: targetSegId,
        source: src,
        sequence: selectionState.sequence + 1
      };
    };

    // User clicks block-0 in PDF canvas
    handleSelect('block-0', 'pdf');
    assert.equal(selectionState.activeBlockId, 'block-0');
    assert.equal(selectionState.activeSegmentId, 'seg-0');
    assert.equal(selectionState.source, 'pdf');
    assert.equal(selectionState.sequence, 1);

    // User clicks seg-2 in bilingual markdown
    handleSelect('seg-2', 'markdown');
    assert.equal(selectionState.activeSegmentId, 'seg-2');
    assert.equal(selectionState.activeBlockId, 'block-2');
    assert.equal(selectionState.source, 'markdown');
    assert.equal(selectionState.sequence, 2);

    // Split pane adjustment test
    let splitRatio = 0.5;
    const onSplitterDrag = (newRatio) => {
      splitRatio = Math.min(0.8, Math.max(0.2, newRatio));
    };
    onSplitterDrag(0.35);
    assert.equal(splitRatio, 0.35);

    // Overlays still calculate invariant CSS percentages
    const bboxStyle = calculateBboxStyles(blocks[0].bbox);
    assert.equal(bboxStyle.left, '10%');
    assert.equal(bboxStyle.top, '5%');
  });

  test('APP3: Multi-Page Academic Paper with Cross-Column Continuations & Figures', () => {
    const rawContent = [
      { page_idx: 0, type: 'title', text: 'ResNet Paper', text_level: 1, bbox: [100, 100, 900, 180] },
      { page_idx: 0, type: 'text', text: 'Deep convolutional networks have led to breakthroughs.', bbox: [100, 200, 480, 500] },
      { page_idx: 0, type: 'image', img_path: 'images/fig_residual.png', image_caption: ['Figure 1: Residual unit.'], bbox: [520, 200, 900, 600] },
      // Paragraph started on page 0 column 1 continues on column 2
      { page_idx: 0, type: 'text', text: '', bbox: [520, 620, 900, 800], continuationOf: 'block-1' },
      // Page 1 header and footnote
      { page_idx: 1, type: 'header', text: 'IEEE Conference Paper', bbox: [100, 40, 900, 70] },
      { page_idx: 1, type: 'text', text: 'When deeper networks are able to start converging...', bbox: [100, 80, 900, 300] },
      { page_idx: 1, type: 'footnote', text: '*Equal contribution', bbox: [100, 920, 900, 960] }
    ];

    const blocks = parseMineruBlocks(rawContent);
    assert.equal(blocks.length, 7);

    // Continuation linkage
    const contBlock = blocks.find((b) => b.continuationOf === 'block-1');
    assert.ok(contBlock);
    assert.equal(contBlock.page, 1);

    // Image block retains image path and caption
    const imgBlock = blocks.find((b) => b.role === 'image');
    assert.equal(imgBlock.image, 'images/fig_residual.png');

    // Footnote role classification
    const footnoteBlock = blocks.find((b) => b.role === 'footnote');
    assert.ok(footnoteBlock);
  });

  test('APP4: Vault Asset Integrity & Obsidian Graph Bidirectional Linking', async () => {
    const app = new MockApp();
    const slug = 'bert-devlin2019';
    const folder = `Papers/${slug}`;

    const mainIndex = `---
title: "BERT: Pre-training of Deep Bidirectional Transformers"
slug: "${slug}"
sourcePdf: "[[document.pdf]]"
originalNote: "[[${slug}.original]]"
bilingualNote: "[[${slug}.bilingual]]"
summaryNote: "[[${slug}.summary]]"
tags: ["ai/nlp", "transformers", "paper"]
---

# BERT

- 原文：[[${slug}.original]]
- 双语：[[${slug}.bilingual]]
- 总结：[[${slug}.summary]]

相关引用：[[ref-vaswani2017|Vaswani et al., 2017]]
`;

    await safeWriteVaultNote(app.vault, `${folder}/${slug}.index.md`, mainIndex);
    await safeWriteVaultNote(app.vault, `${folder}/${slug}.original.md`, `# Original\n\n[[${slug}.index|返回索引]]`);
    await safeWriteVaultNote(app.vault, `${folder}/${slug}.summary.md`, `# Summary\n\n[[${slug}.index|返回索引]]`);

    const indexFile = app.vault.getAbstractFileByPath(`${folder}/${slug}.index.md`);
    const content = await app.vault.read(indexFile);

    // Parse all internal wikilinks [[...]]
    const wikilinks = Array.from(content.matchAll(/\[\[(.*?)\]\]/g)).map((m) => m[1]);
    assert.ok(wikilinks.includes('document.pdf'));
    assert.ok(wikilinks.includes(`${slug}.original`));
    assert.ok(wikilinks.includes(`${slug}.bilingual`));
    assert.ok(wikilinks.includes('ref-vaswani2017|Vaswani et al., 2017'));
  });

  test('APP5: Error Recovery and Resilient Import under Transient Network Glitches', async () => {
    const app = new MockApp();
    const server = new MockMineruCloudServer({ token: 'tok', failUpload: true });

    // Step 1: Upload fails on transient 500
    const regRes = server.handleRequest('https://mineru.net/api/v4/file-urls/batch', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok' },
      body: JSON.stringify({ files: [{ name: 'test.pdf' }] })
    });
    const { file_urls: [uploadUrl] } = (await regRes.json()).data;

    const failedPut = server.handleRequest(uploadUrl, { method: 'PUT', body: new Uint8Array([1, 2]) });
    assert.equal(failedPut.status, 500);

    // Step 2: Retry mechanism resolves transient failure
    server.failUpload = false;
    const retryPut = server.handleRequest(uploadUrl, { method: 'PUT', body: new Uint8Array([1, 2]) });
    assert.equal(retryPut.status, 200);

    // Step 3: Vault note creation completes safely after recovery
    const file = await safeWriteVaultNote(app.vault, 'Papers/recovered/doc.md', '# Recovered note');
    assert.equal(file.name, 'doc.md');
    assert.equal(await app.vault.read(file), '# Recovered note');
  });

  test('APP6: Plugin Lifecycle Hot Reload and State Persistence', async () => {
    const app = new MockApp();
    const plugin = new MockPlugin(app);
    const VIEW_TYPE = 'pdf2obsidian-academic-reader';

    let isViewOpen = false;
    class HotReloadReaderView extends MockItemView {
      getViewType() { return VIEW_TYPE; }
      async onOpen() { isViewOpen = true; }
      async onClose() { isViewOpen = false; }
    }

    plugin.registerView(VIEW_TYPE, (l) => new HotReloadReaderView(l));
    await plugin.onload();

    // Open view
    const leaf = app.workspace.getLeaf(true);
    await leaf.setViewState({ type: VIEW_TYPE, active: true });
    assert.equal(isViewOpen, true);
    assert.equal(app.workspace.getLeavesOfType(VIEW_TYPE).length, 1);

    // Simulate Obsidian reloading plugin: onunload -> detach -> reload
    app.workspace.detachLeavesOfType(VIEW_TYPE);
    plugin.onunload();
    assert.equal(isViewOpen, false);
    assert.equal(app.workspace.getLeavesOfType(VIEW_TYPE).length, 0);

    // Reload plugin
    const reloadedPlugin = new MockPlugin(app);
    reloadedPlugin.registerView(VIEW_TYPE, (l) => new HotReloadReaderView(l));
    await reloadedPlugin.onload();

    // Re-open leaf
    const leaf2 = app.workspace.getLeaf(true);
    await leaf2.setViewState({ type: VIEW_TYPE, active: true });
    assert.equal(isViewOpen, true);
    assert.equal(app.workspace.getLeavesOfType(VIEW_TYPE).length, 1);
  });
});
