/**
 * Synthetic MinerU datasets, ZIP generator, and Cloud / Remote HTTP server stubs.
 */

import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { MONOREPO_ROOT } from './paths.mjs';

// Load fflate dynamically or via createRequire from core
let fflate;
try {
  const req = createRequire(resolve(MONOREPO_ROOT, 'packages/core/package.json'));
  fflate = req('fflate');
} catch {
  try {
    fflate = await import(resolve(MONOREPO_ROOT, 'packages/core/node_modules/fflate/esm/index.mjs'));
  } catch (err) {
    // Fallback stub if fflate unavailable
    fflate = null;
  }
}

/**
 * Generates synthetic MinerU content_list.json items.
 * @param {object} [options]
 * @param {number} [options.count=10]
 * @param {number} [options.pageCount=2]
 * @param {boolean} [options.includeContinuations=true]
 * @param {boolean} [options.includeMath=true]
 * @param {boolean} [options.includeImages=true]
 * @param {boolean} [options.includeTables=true]
 */
export function generateMockContentList(options = {}) {
  const {
    count = 10,
    pageCount = 2,
    includeContinuations = true,
    includeMath = true,
    includeImages = true,
    includeTables = true
  } = options;

  if (count <= 0) {
    return [];
  }

  const items = [];

  // Item 0: Document Title
  items.push({
    page_idx: 0,
    type: 'title',
    text: 'Attention Is All You Need: High-Performance Transformer Networks',
    text_level: 1,
    bbox: [100, 50, 900, 120]
  });

  // Item 1: Abstract heading
  if (items.length < count) {
    items.push({
      page_idx: 0,
      type: 'title',
      text: 'Abstract',
      text_level: 2,
      bbox: [150, 140, 850, 170]
    });
  }

  // Item 2: Abstract text
  if (items.length < count) {
    items.push({
      page_idx: 0,
      type: 'text',
      text: 'The dominant sequence transduction models are based on complex recurrent or convolutional neural networks that include an encoder and a decoder.',
      bbox: [150, 180, 850, 260]
    });
  }

  let lastTextBlockId = 'block-2';
  let imgIdx = 1;
  let tableIdx = 1;

  for (let i = items.length; i < count; i++) {
    const pageIdx = Math.min(pageCount - 1, Math.floor((i / count) * pageCount));
    const step = i % 7;

    if (step === 0 && includeMath) {
      items.push({
        page_idx: pageIdx,
        type: 'equation',
        text: '$$\\text{Attention}(Q, K, V) = \\text{softmax}\\left(\\frac{QK^T}{\\sqrt{d_k}}\\right)V$$',
        bbox: [100, 300, 900, 380]
      });
    } else if (step === 1 && includeImages) {
      const imgPath = `images/figure_${imgIdx}.png`;
      items.push({
        page_idx: pageIdx,
        type: 'image',
        img_path: imgPath,
        image_caption: [`Figure ${imgIdx}: Scaled Dot-Product and Multi-Head Attention Mechanisms.`],
        bbox: [120, 400, 880, 650]
      });
      imgIdx++;
    } else if (step === 2 && includeTables) {
      items.push({
        page_idx: pageIdx,
        type: 'table',
        table_body: '| Model | BLEU (EN-DE) | BLEU (EN-FR) |\n|---|---|---|\n| Transformer (base) | 27.3 | 38.1 |\n| Transformer (big) | 28.4 | 41.8 |',
        table_caption: [`Table ${tableIdx}: Maximum BLEU scores on translation tasks.`],
        bbox: [100, 660, 900, 780]
      });
      tableIdx++;
    } else if (step === 3 && includeContinuations) {
      // Continuation of last paragraph across column or page
      items.push({
        page_idx: pageIdx,
        type: 'text',
        text: '', // Empty text indicating continuation
        bbox: [100, 800, 900, 880],
        continuationOf: lastTextBlockId
      });
    } else if (step === 4) {
      // Section heading
      const sectionNum = Math.floor(i / 5);
      items.push({
        page_idx: pageIdx,
        type: 'title',
        text: `${sectionNum}. Model Architecture and Optimization Details`,
        text_level: 2,
        bbox: [100, 100, 800, 140]
      });
    } else {
      // Regular body text
      const blockId = `block-${i}`;
      items.push({
        page_idx: pageIdx,
        type: 'text',
        text: `Section content block ${i}: Multi-head attention allows the model to jointly attend to information from different representation subspaces at different positions.`,
        bbox: [100, 200 + (step * 80), 900, 270 + (step * 80)]
      });
      lastTextBlockId = blockId;
    }
  }

  return items;
}

/**
 * Generates a mock MinerU zip archive as a Uint8Array.
 * @param {object} input
 * @param {Array<any>} input.contentList
 * @param {string} [input.markdown]
 * @param {Record<string, Uint8Array>} [input.images]
 * @returns {Uint8Array}
 */
export function generateMockMineruZip(input) {
  const {
    contentList = generateMockContentList(),
    markdown = '# Mock Paper Markdown\n\nFull parsed text content.',
    images = {}
  } = input;

  if (!fflate) {
    // If fflate is somehow completely unavailable, return raw JSON as uint8array
    return new TextEncoder().encode(JSON.stringify({ contentList, markdown }));
  }

  const zipEntries = {
    'content_list.json': fflate.strToU8(JSON.stringify(contentList, null, 2)),
    'full.md': fflate.strToU8(markdown)
  };

  // Add default mock image if none provided
  if (Object.keys(images).length === 0) {
    // Minimal 1x1 PNG binary
    const dummyPng = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
      0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
      0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
      0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82
    ]);
    zipEntries['images/figure_1.png'] = dummyPng;
  } else {
    for (const [k, v] of Object.entries(images)) {
      zipEntries[k] = v instanceof Uint8Array ? v : fflate.strToU8(String(v));
    }
  }

  return fflate.zipSync(zipEntries);
}

/**
 * Headless stateful mock of MinerU Cloud API v4 & Remote HTTP server.
 */
export class MockMineruCloudServer {
  constructor(options = {}) {
    this.token = options.token || 'valid-mineru-token';
    this.batches = new Map();
    this.uploadedFiles = new Map();
    this.pollCount = new Map();
    this.pollThreshold = options.pollThreshold ?? 2; // Returns 'done' on 2nd poll
    this.failUpload = options.failUpload ?? false;
    this.failExtract = options.failExtract ?? false;
  }

  handleRequest(urlStr, options = {}) {
    const url = new URL(urlStr, 'https://mineru.net');
    const method = (options.method || 'GET').toUpperCase();
    const headers = options.headers || {};
    const auth = headers['Authorization'] || headers['authorization'] || '';

    // 1. POST /api/v4/file-urls/batch
    if (url.pathname === '/api/v4/file-urls/batch' && method === 'POST') {
      if (!auth.includes(this.token)) {
        return {
          status: 401,
          json: () => Promise.resolve({ code: 401, msg: 'Unauthorized: Invalid token' })
        };
      }
      const body = typeof options.body === 'string' ? JSON.parse(options.body) : {};
      const batchId = `batch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const files = body.files || [{ name: 'doc.pdf' }];
      const fileUrls = files.map((f, idx) => `https://oss-mock.aliyuncs.com/upload/${batchId}/${idx}`);

      this.batches.set(batchId, {
        state: 'waiting_upload',
        files,
        fileUrls
      });

      return {
        status: 200,
        json: () => Promise.resolve({
          code: 0,
          data: {
            batch_id: batchId,
            file_urls: fileUrls
          }
        })
      };
    }

    // 2. PUT to OSS upload URL
    if (url.hostname === 'oss-mock.aliyuncs.com' && method === 'PUT') {
      if (this.failUpload) {
        return {
          status: 500,
          text: () => Promise.resolve('OSS Internal Server Error')
        };
      }
      this.uploadedFiles.set(url.pathname, options.body);
      return {
        status: 200,
        text: () => Promise.resolve('OK')
      };
    }

    // 3. GET /api/v4/extract-results/batch/:batchId
    if (url.pathname.startsWith('/api/v4/extract-results/batch/') && method === 'GET') {
      if (!auth.includes(this.token)) {
        return {
          status: 401,
          json: () => Promise.resolve({ code: 401, msg: 'Unauthorized' })
        };
      }
      const batchId = url.pathname.split('/').pop();
      const batch = this.batches.get(batchId);
      if (!batch) {
        return {
          status: 404,
          json: () => Promise.resolve({ code: 404, msg: 'Batch not found' })
        };
      }

      if (this.failExtract) {
        return {
          status: 200,
          json: () => Promise.resolve({
            code: 0,
            data: {
              extract_result: [{ state: 'failed', err_msg: 'OCR engine fatal error' }]
            }
          })
        };
      }

      const polls = (this.pollCount.get(batchId) || 0) + 1;
      this.pollCount.set(batchId, polls);

      if (polls < this.pollThreshold) {
        return {
          status: 200,
          json: () => Promise.resolve({
            code: 0,
            data: {
              extract_result: [{ state: 'processing' }]
            }
          })
        };
      }

      const zipUrl = `https://cdn-mock.openxlab.org.cn/results/${batchId}/full.zip`;
      return {
        status: 200,
        json: () => Promise.resolve({
          code: 0,
          data: {
            extract_result: [{
              state: 'done',
              full_zip_url: zipUrl
            }]
          }
        })
      };
    }

    // 4. GET result zip
    if (url.pathname.endsWith('/full.zip') && method === 'GET') {
      const zipBytes = generateMockMineruZip({});
      return {
        status: 200,
        arrayBuffer: () => Promise.resolve(zipBytes.buffer)
      };
    }

    // 5. Remote HTTP POST /tasks
    if (url.pathname === '/tasks' && method === 'POST') {
      const taskId = `task-${Date.now()}`;
      return {
        status: 200,
        json: () => Promise.resolve({
          task_id: taskId,
          status: 'done',
          result: {
            content_list: generateMockContentList(),
            markdown: '# Remote Parsed Paper\n\nContent parsed via remote HTTP.'
          }
        })
      };
    }

    return {
      status: 404,
      text: () => Promise.resolve(`Unhandled URL: ${urlStr}`)
    };
  }
}
