/**
 * Tier 5: Adversarial Coverage Hardening — Pipeline & Vault Layer
 * 
 * Target source files under white-box test:
 * - apps/obsidian-plugin/src/pipeline/mineru-client.ts
 * - apps/obsidian-plugin/src/pipeline/llm-client.ts
 * - apps/obsidian-plugin/src/pipeline/vault-writer.ts
 * - apps/obsidian-plugin/src/pipeline/import-adapter.ts
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { deflateRawSync } from 'node:zlib';

// Dynamic resolver hook to allow TypeScript extensionless relative imports in Node.js
const hookCode = `
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (err.code === 'ERR_MODULE_NOT_FOUND') {
      for (const ext of ['.ts', '.js', '.mjs']) {
        try {
          return await nextResolve(specifier + ext, context);
        } catch {}
      }
    }
    throw err;
  }
}
`;
register('data:text/javascript;base64,' + Buffer.from(hookCode).toString('base64'));

// Direct imports of actual production pipeline TypeScript code
const {
  MineruClient,
  sanitizeBbox,
  parseZipArchive,
  extractFromZipEntries
} = await import('../src/pipeline/mineru-client.ts');

const {
  LlmClient,
  chunkMarkdown,
  createBilingualMarkdown
} = await import('../src/pipeline/llm-client.ts');

const {
  normalizeVaultPath,
  ensureVaultDirectory,
  writeVaultNote,
  safeWriteVaultNote,
  writeVaultBinary,
  safeWriteVaultBinary,
  createPaperFrontmatter,
  parsePaperFrontmatter,
  formatImageWikilink,
  formatImageMarkdown,
  formatNoteWikilink
} = await import('../src/pipeline/vault-writer.ts');

const {
  importPaper,
  generatePaperSlug
} = await import('../src/pipeline/import-adapter.ts');

// Harness mocks
const {
  MockApp,
  MockMineruCloudServer,
  MockLlmServer,
  generateMockMineruZip,
  generateMockContentList
} = await import('./mocks/index.mjs');

// =========================================================================
// Global Fetch Interceptor Sandbox
// =========================================================================
const originalFetch = globalThis.fetch;

// =========================================================================
// Suite 1: MinerU Client Adversarial Stress & Failure Modes
// =========================================================================
describe('Tier 5 Adversarial: MinerU Client Stress & Failure Modes', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('ADV-PIPE-1.1: Missing cloudApiToken in official mode throws immediate validation error', async () => {
    const client = new MineruClient({ mode: 'official', cloudApiToken: '' });
    await assert.rejects(
      () => client.extractPdf(new Uint8Array([1, 2, 3]), 'paper.pdf'),
      /requires cloudApiToken configuration/
    );
  });

  test('ADV-PIPE-1.2: Registration returns HTTP 401 Unauthorized', async () => {
    const client = new MineruClient({ cloudApiToken: 'invalid-token' });
    globalThis.fetch = async () => new Response(JSON.stringify({ code: 401, msg: 'Invalid token' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });

    await assert.rejects(
      () => client.extractViaCloudApi(new Uint8Array([1, 2, 3]), 'paper.pdf'),
      /MinerU batch registration failed \(401\)/
    );
  });

  test('ADV-PIPE-1.3: Registration returns HTTP 403 Forbidden with custom message', async () => {
    const client = new MineruClient({ cloudApiToken: 'blocked-token' });
    globalThis.fetch = async () => new Response('Access denied by IP whitelist', {
      status: 403,
      headers: { 'Content-Type': 'text/plain' }
    });

    await assert.rejects(
      () => client.extractViaCloudApi(new Uint8Array([1, 2, 3]), 'paper.pdf'),
      /MinerU batch registration failed \(403\): Access denied by IP whitelist/
    );
  });

  test('ADV-PIPE-1.4: Registration returns HTTP 429 Rate Limit Exceeded', async () => {
    const client = new MineruClient({ cloudApiToken: 'rate-limited' });
    globalThis.fetch = async () => new Response(JSON.stringify({ code: 429, msg: 'Too many requests' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' }
    });

    await assert.rejects(
      () => client.extractViaCloudApi(new Uint8Array([1, 2, 3]), 'paper.pdf'),
      /MinerU batch registration failed \(429\)/
    );
  });

  test('ADV-PIPE-1.5: Registration returns HTTP 200 with non-zero error code in body', async () => {
    const client = new MineruClient({ cloudApiToken: 'token' });
    globalThis.fetch = async () => new Response(JSON.stringify({ code: 10005, msg: 'Account quota exhausted' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

    await assert.rejects(
      () => client.extractViaCloudApi(new Uint8Array([1, 2, 3]), 'paper.pdf'),
      /MinerU batch registration returned error: Account quota exhausted/
    );
  });

  test('ADV-PIPE-1.6: Registration returns HTTP 200 but missing file_urls array', async () => {
    const client = new MineruClient({ cloudApiToken: 'token' });
    globalThis.fetch = async () => new Response(JSON.stringify({ code: 0, data: { batch_id: 'b1', file_urls: [] } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

    await assert.rejects(
      () => client.extractViaCloudApi(new Uint8Array([1, 2, 3]), 'paper.pdf'),
      /MinerU batch registration returned error/
    );
  });

  test('ADV-PIPE-1.7: Signed OSS binary PUT upload returns HTTP 403 Expired', async () => {
    const client = new MineruClient({ cloudApiToken: 'token' });
    globalThis.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (u.includes('file-urls/batch')) {
        return new Response(JSON.stringify({
          code: 0,
          data: { batch_id: 'b123', file_urls: ['https://oss.aliyun.com/upload/b123'] }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (opts.method === 'PUT') {
        return new Response('OSS RequestTimeTooSkewed', { status: 403 });
      }
      return new Response('Not Found', { status: 404 });
    };

    await assert.rejects(
      () => client.extractViaCloudApi(new Uint8Array([1, 2, 3]), 'paper.pdf'),
      /MinerU signed upload failed \(403\): OSS RequestTimeTooSkewed/
    );
  });

  test('ADV-PIPE-1.8: Polling batch status returns state failed with custom error', async () => {
    const client = new MineruClient({ cloudApiToken: 'token', pollIntervalMs: 5 });
    globalThis.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (u.includes('file-urls/batch')) {
        return new Response(JSON.stringify({
          code: 0,
          data: { batch_id: 'b1', file_urls: ['https://oss.aliyun.com/upload'] }
        }), { status: 200 });
      }
      if (opts.method === 'PUT') {
        return new Response('OK', { status: 200 });
      }
      if (u.includes('extract-results/batch/')) {
        return new Response(JSON.stringify({
          code: 0,
          data: {
            extract_result: [{ state: 'failed', err_msg: 'PDF contains DRM password protection' }]
          }
        }), { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    };

    await assert.rejects(
      () => client.extractViaCloudApi(new Uint8Array([1, 2, 3]), 'paper.pdf'),
      /MinerU extraction failed: PDF contains DRM password protection/
    );
  });

  test('ADV-PIPE-1.9: Polling batch status times out when duration exceeds timeoutMs', async () => {
    const client = new MineruClient({ cloudApiToken: 'token', pollIntervalMs: 10, timeoutMs: 30 });
    globalThis.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (u.includes('file-urls/batch')) {
        return new Response(JSON.stringify({
          code: 0,
          data: { batch_id: 'b-timeout', file_urls: ['https://oss.aliyun.com/upload'] }
        }), { status: 200 });
      }
      if (opts.method === 'PUT') return new Response('OK', { status: 200 });
      if (u.includes('extract-results/batch/')) {
        return new Response(JSON.stringify({
          code: 0,
          data: { extract_result: [{ state: 'running' }] }
        }), { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    };

    await assert.rejects(
      () => client.extractViaCloudApi(new Uint8Array([1, 2, 3]), 'paper.pdf'),
      /MinerU batch polling timed out/
    );
  });

  test('ADV-PIPE-1.10: Polling transient 500 error recovers on subsequent poll attempt', async () => {
    const client = new MineruClient({ cloudApiToken: 'token', pollIntervalMs: 5 });
    let pollCount = 0;
    const mockZip = generateMockMineruZip({ markdown: '# Recovered Markdown' });

    globalThis.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (u.includes('file-urls/batch')) {
        return new Response(JSON.stringify({
          code: 0,
          data: { batch_id: 'b-recover', file_urls: ['https://oss.aliyun.com/upload'] }
        }), { status: 200 });
      }
      if (opts.method === 'PUT') return new Response('OK', { status: 200 });
      if (u.includes('extract-results/batch/')) {
        pollCount++;
        if (pollCount === 1) {
          // Transient 502 Bad Gateway
          return new Response('Bad Gateway', { status: 502 });
        }
        return new Response(JSON.stringify({
          code: 0,
          data: { extract_result: [{ state: 'done', full_zip_url: 'https://cdn.example.com/result.zip' }] }
        }), { status: 200 });
      }
      if (u.includes('result.zip')) {
        return new Response(mockZip, { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    };

    const result = await client.extractViaCloudApi(new Uint8Array([1, 2, 3]), 'paper.pdf');
    assert.equal(result.markdown, '# Recovered Markdown');
    assert.ok(pollCount >= 2);
  });

  test('ADV-PIPE-1.11: Polling transient network throw recovers on subsequent poll attempt', async () => {
    const client = new MineruClient({ cloudApiToken: 'token', pollIntervalMs: 5 });
    let pollCount = 0;
    const mockZip = generateMockMineruZip({ markdown: '# Network Recovered' });

    globalThis.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (u.includes('file-urls/batch')) {
        return new Response(JSON.stringify({
          code: 0,
          data: { batch_id: 'b-net', file_urls: ['https://oss.aliyun.com/upload'] }
        }), { status: 200 });
      }
      if (opts.method === 'PUT') return new Response('OK', { status: 200 });
      if (u.includes('extract-results/batch/')) {
        pollCount++;
        if (pollCount === 1) {
          throw new Error('ECONNRESET: Connection reset by peer');
        }
        return new Response(JSON.stringify({
          code: 0,
          data: { extract_result: [{ state: 'done', full_zip_url: 'https://cdn.example.com/net.zip' }] }
        }), { status: 200 });
      }
      if (u.includes('net.zip')) {
        return new Response(mockZip, { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    };

    const result = await client.extractViaCloudApi(new Uint8Array([1, 2, 3]), 'paper.pdf');
    assert.equal(result.markdown, '# Network Recovered');
  });

  test('ADV-PIPE-1.12: CDN download failure triggers failover to official OSS bucket', async () => {
    const client = new MineruClient({ cloudApiToken: 'token', pollIntervalMs: 5 });
    const mockZip = generateMockMineruZip({ markdown: '# Failover Content' });
    let triedCdn = false;
    let triedOss = false;

    globalThis.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (u.includes('file-urls/batch')) {
        return new Response(JSON.stringify({
          code: 0,
          data: { batch_id: 'b-failover', file_urls: ['https://oss.aliyun.com/upload'] }
        }), { status: 200 });
      }
      if (opts.method === 'PUT') return new Response('OK', { status: 200 });
      if (u.includes('extract-results/batch/')) {
        return new Response(JSON.stringify({
          code: 0,
          data: {
            extract_result: [{
              state: 'done',
              full_zip_url: 'https://cdn-mineru.openxlab.org.cn/results/b-failover/full.zip'
            }]
          }
        }), { status: 200 });
      }
      if (u.includes('cdn-mineru.openxlab.org.cn')) {
        triedCdn = true;
        return new Response('CDN Edge Server 504 Gateway Timeout', { status: 504 });
      }
      if (u.includes('mineru.oss-cn-shanghai.aliyuncs.com')) {
        triedOss = true;
        return new Response(mockZip, { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    };

    const res = await client.extractViaCloudApi(new Uint8Array([1, 2, 3]), 'failover.pdf');
    assert.ok(triedCdn, 'Should attempt CDN URL first');
    assert.ok(triedOss, 'Should failover to OSS bucket URL');
    assert.equal(res.markdown, '# Failover Content');
  });

  test('ADV-PIPE-1.13: CDN download failover also fails throws descriptive error', async () => {
    const client = new MineruClient({ cloudApiToken: 'token', pollIntervalMs: 5 });

    globalThis.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (u.includes('file-urls/batch')) {
        return new Response(JSON.stringify({
          code: 0,
          data: { batch_id: 'b-failover2', file_urls: ['https://oss.aliyun.com/upload'] }
        }), { status: 200 });
      }
      if (opts.method === 'PUT') return new Response('OK', { status: 200 });
      if (u.includes('extract-results/batch/')) {
        return new Response(JSON.stringify({
          code: 0,
          data: {
            extract_result: [{
              state: 'done',
              full_zip_url: 'https://cdn-mineru.openxlab.org.cn/results/b-failover2/full.zip'
            }]
          }
        }), { status: 200 });
      }
      if (u.includes('cdn-mineru.openxlab.org.cn')) {
        return new Response('CDN 500', { status: 500 });
      }
      if (u.includes('mineru.oss-cn-shanghai.aliyuncs.com')) {
        return new Response('OSS 403 Forbidden', { status: 403 });
      }
      return new Response('Not found', { status: 404 });
    };

    await assert.rejects(
      () => client.extractViaCloudApi(new Uint8Array([1, 2, 3]), 'failover2.pdf'),
      /MinerU OSS fallback download failed \(403\)/
    );
  });

  test('ADV-PIPE-1.14: parseZipArchive handles 0-byte buffer and corrupted headers without crash', () => {
    assert.deepEqual(parseZipArchive(new Uint8Array([])), {});
    assert.deepEqual(parseZipArchive(new Uint8Array([1, 2, 3, 4, 5])), {});
    const corruptedZip = new Uint8Array(50);
    corruptedZip.set([0x50, 0x4b, 0x05, 0x06], 20); // fake EOCD signature
    assert.deepEqual(parseZipArchive(corruptedZip), {});
  });

  test('ADV-PIPE-1.15: extractFromZipEntries handles empty entries and malformed JSON content_list', () => {
    const emptyResult = extractFromZipEntries({});
    assert.equal(emptyResult.markdown, '');
    assert.deepEqual(emptyResult.contentList, []);
    assert.deepEqual(emptyResult.images, {});

    // Malformed JSON content list
    const malformedEntries = {
      'content_list.json': new TextEncoder().encode('{ invalid json ]'),
      'full.md': new TextEncoder().encode('# Valid MD')
    };
    const res = extractFromZipEntries(malformedEntries);
    assert.equal(res.markdown, '# Valid MD');
    assert.deepEqual(res.contentList, [], 'Malformed content_list should degrade to empty array');
  });

  test('ADV-PIPE-1.16: extractFromZipEntries supports Windows backslash directory paths and image types', () => {
    const entries = {
      'images\\chart.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      'images\\nested\\diagram.svg': new TextEncoder().encode('<svg></svg>'),
      'sub\\full.md': new TextEncoder().encode('# Sub Markdown')
    };
    const res = extractFromZipEntries(entries);
    assert.equal(res.markdown, '# Sub Markdown');
    assert.ok(res.images['chart.png']);
    assert.ok(res.images['diagram.svg']);
  });

  test('ADV-PIPE-1.17: sanitizeBbox sanitizes corrupted, inverted, NaN, and extreme coordinates', () => {
    assert.equal(sanitizeBbox(null), undefined);
    assert.equal(sanitizeBbox([10, 20]), undefined);
    assert.equal(sanitizeBbox([10, 20, 30, 40, 50]), undefined);
    assert.equal(sanitizeBbox([10, NaN, 30, 40]), undefined);
    assert.equal(sanitizeBbox([10, Infinity, 30, 40]), undefined);
    // Inverted coordinates x1 <= x0 or y1 <= y0
    assert.equal(sanitizeBbox([100, 50, 100, 100]), undefined, 'Zero width bbox must be undefined');
    assert.equal(sanitizeBbox([100, 50, 90, 100]), undefined, 'Negative width bbox must be undefined');
    assert.equal(sanitizeBbox([50, 100, 100, 100]), undefined, 'Zero height bbox must be undefined');
    assert.equal(sanitizeBbox([50, 100, 100, 80]), undefined, 'Negative height bbox must be undefined');

    // Clamping and rounding
    const clamped = sanitizeBbox([-50.4, -20.8, 1200.7, 999.2]);
    assert.deepEqual(clamped, [0, 0, 1000, 999]);
  });

  test('ADV-PIPE-1.18: Remote HTTP runner handles 500 error from POST /tasks', async () => {
    const client = new MineruClient({ mode: 'remote', remoteApiUrl: 'http://127.0.0.1:30000' });
    globalThis.fetch = async () => new Response('Internal Server Error: GPU OOM', { status: 500 });

    await assert.rejects(
      () => client.extractViaRemoteHttp(new Uint8Array([1, 2, 3]), 'test.pdf'),
      /MinerU remote service failed \(500\): Internal Server Error: GPU OOM/
    );
  });

  test('ADV-PIPE-1.19: Remote HTTP runner handles async task failing during polling', async () => {
    const client = new MineruClient({ mode: 'remote', remoteApiUrl: 'http://127.0.0.1:30000', pollIntervalMs: 5 });
    globalThis.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (u.endsWith('/tasks') && opts.method === 'POST') {
        return new Response(JSON.stringify({ task_id: 'task-fail-99' }), { status: 200 });
      }
      if (u.includes('/tasks/task-fail-99')) {
        return new Response(JSON.stringify({ status: 'failed', error: 'PDF parsing engine crashed' }), { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    };

    await assert.rejects(
      () => client.extractViaRemoteHttp(new Uint8Array([1, 2, 3]), 'test.pdf'),
      /PDF parsing engine crashed/
    );
  });
});

// =========================================================================
// Suite 2: LLM Client Robustness & Error Resilience
// =========================================================================
describe('Tier 5 Adversarial: LLM Client Robustness & Error Resilience', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('ADV-PIPE-2.1: HTTP 401 Unauthorized MUST NOT be retried (strictly 1 attempt)', async () => {
    const llm = new LlmClient({ apiKey: 'bad-key', maxRetries: 3 });
    let attempts = 0;

    globalThis.fetch = async () => {
      attempts++;
      return new Response(JSON.stringify({ error: { message: 'Incorrect API key provided' } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    };

    await assert.rejects(
      () => llm.chatCompletion('System', 'User'),
      /LLM API 401 Unauthorized: Invalid API key/
    );
    assert.equal(attempts, 1, '401 Unauthorized must immediately abort without retries');
  });

  test('ADV-PIPE-2.2: HTTP 429 Rate Limit retries up to maxRetries then throws', async () => {
    const llm = new LlmClient({ apiKey: 'valid-key', maxRetries: 2 });
    let attempts = 0;

    globalThis.fetch = async () => {
      attempts++;
      return new Response(JSON.stringify({ error: { message: 'Rate limit reached: 3 RPM' } }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' }
      });
    };

    await assert.rejects(
      () => llm.chatCompletion('System', 'User'),
      /LLM API 429 Rate Limit exceeded/
    );
    assert.equal(attempts, 2, 'Should retry until maxRetries is exhausted');
  });

  test('ADV-PIPE-2.3: HTTP 500 Internal Server Error retries and recovers on final attempt', async () => {
    const llm = new LlmClient({ apiKey: 'valid-key', maxRetries: 3 });
    let attempts = 0;

    globalThis.fetch = async () => {
      attempts++;
      if (attempts < 2) {
        return new Response(JSON.stringify({ error: { message: 'Overloaded' } }), { status: 500 });
      }
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'Recovered response' } }]
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    const res = await llm.chatCompletion('System', 'User');
    assert.equal(res, 'Recovered response');
    assert.equal(attempts, 2);
  });

  test('ADV-PIPE-2.4: Malformed response missing choices array or content throws explicit error', async () => {
    const llm = new LlmClient({ apiKey: 'valid-key', maxRetries: 1 });

    globalThis.fetch = async () => new Response(JSON.stringify({ choices: [] }), { status: 200 });
    await assert.rejects(
      () => llm.chatCompletion('System', 'User'),
      /LLM API response did not contain message content/
    );

    globalThis.fetch = async () => new Response(JSON.stringify({ id: 'chat-123' }), { status: 200 });
    await assert.rejects(
      () => llm.chatCompletion('System', 'User'),
      /LLM API response did not contain message content/
    );
  });

  test('ADV-PIPE-2.5: DeepSeek provider config sets deepseek endpoint and model', async () => {
    const llm = new LlmClient({ provider: 'deepseek', apiKey: 'ds-token' });
    let capturedUrl = '';
    let capturedBody = null;

    globalThis.fetch = async (url, opts = {}) => {
      capturedUrl = String(url);
      capturedBody = JSON.parse(opts.body);
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'DeepSeek response' } }]
      }), { status: 200 });
    };

    const res = await llm.chatCompletion('System', 'User');
    assert.equal(res, 'DeepSeek response');
    assert.equal(capturedUrl, 'https://api.deepseek.com/v1/chat/completions');
    assert.equal(capturedBody.model, 'deepseek-chat');
  });

  test('ADV-PIPE-2.6: chunkMarkdown handles unclosed code fence without crashing or splitting fence', () => {
    const md = [
      '# Code Section',
      '',
      '```python',
      'def foo():',
      '    print("Unclosed fence")',
      '# Inside code fence: not a heading',
      '    return 42'
    ].join('\n');

    const chunks = chunkMarkdown(md, 500);
    assert.equal(chunks.length, 1);
    assert.ok(chunks[0].content.includes('def foo():'));
    assert.ok(chunks[0].content.includes('# Inside code fence: not a heading'));
  });

  test('ADV-PIPE-2.7: chunkMarkdown handles multiline display math blocks intact', () => {
    const md = [
      '# Equation Section',
      '',
      '$$',
      '\\begin{aligned}',
      '  \\nabla \\times \\mathbf{E} &= -\\frac{\\partial \\mathbf{B}}{\\partial t} \\\\',
      '  \\nabla \\cdot \\mathbf{B} &= 0',
      '\\end{aligned}',
      '$$',
      '',
      'Explanation paragraph after math.'
    ].join('\n');

    const chunks = chunkMarkdown(md, 1000);
    assert.equal(chunks.length, 1);
    assert.ok(chunks[0].content.includes('\\nabla \\times \\mathbf{E}'));
    assert.ok(chunks[0].content.includes('Explanation paragraph after math.'));
  });

  test('ADV-PIPE-2.8: chunkMarkdown splits large section by paragraphs while preserving heading breadcrumbs', () => {
    const p1 = 'Paragraph 1: '.padEnd(300, 'A');
    const p2 = 'Paragraph 2: '.padEnd(300, 'B');
    const p3 = 'Paragraph 3: '.padEnd(300, 'C');
    const md = `# Deep Section\n\n${p1}\n\n${p2}\n\n${p3}`;

    const chunks = chunkMarkdown(md, 350);
    assert.ok(chunks.length >= 2, `Expected at least 2 chunks, got ${chunks.length}`);
    for (const c of chunks) {
      assert.deepEqual(c.headingPath, ['Deep Section']);
    }
  });

  test('ADV-PIPE-2.9: chunkMarkdown handles empty string and whitespace-only content', () => {
    assert.deepEqual(chunkMarkdown(''), []);
    assert.deepEqual(chunkMarkdown('   \n\n\t  '), []);
  });

  test('ADV-PIPE-2.10: chunkMarkdown handles single giant paragraph exceeding limit without discarding', () => {
    const giant = 'Word '.repeat(600); // ~3000 chars
    const chunks = chunkMarkdown(giant, 1000);
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].content, giant.trim());
  });

  test('ADV-PIPE-2.11: createBilingualMarkdown pairs headings with ideographic space and preserves levels', () => {
    const src = '# Introduction\n\nEnglish paragraph.';
    const tgt = '# 引言\n\n中文段落。';
    const combined = createBilingualMarkdown(src, tgt);

    assert.ok(combined.includes('# Introduction\u3000引言'));
    assert.ok(combined.includes('English paragraph.\n\n中文段落。'));
  });

  test('ADV-PIPE-2.12: createBilingualMarkdown preserves display math, code fences, and images without duplicate', () => {
    const src = [
      '# Math and Figures',
      '',
      '$$',
      'E = mc^2',
      '$$',
      '',
      '```typescript',
      'const x: number = 42;',
      '```',
      '',
      '![Figure 1](images/fig1.png)'
    ].join('\n');

    const tgt = [
      '# 数学与配图',
      '',
      '$$',
      'E = mc^2',
      '$$',
      '',
      '```typescript',
      'const x: number = 42;',
      '```',
      '',
      '![Figure 1](images/fig1.png)'
    ].join('\n');

    const result = createBilingualMarkdown(src, tgt);

    // Each invariant block should occur exactly once
    const mathOccurrences = (result.match(/E = mc\^2/g) || []).length;
    const codeOccurrences = (result.match(/const x: number = 42;/g) || []).length;
    const imageOccurrences = (result.match(/!\[Figure 1\]\(images\/fig1\.png\)/g) || []).length;

    assert.equal(mathOccurrences, 1, 'Display math should not be duplicated');
    assert.equal(codeOccurrences, 1, 'Code fence should not be duplicated');
    assert.equal(imageOccurrences, 1, 'Image markdown should not be duplicated');
  });

  test('ADV-PIPE-2.13: createBilingualMarkdown handles asymmetric section counts gracefully', () => {
    const src = '# Section 1\n\nPara 1\n\n# Section 2\n\nPara 2';
    const tgt = '# 第 1 节\n\n第 1 段'; // Missing section 2

    const result = createBilingualMarkdown(src, tgt);
    assert.ok(result.includes('# Section 1\u3000第 1 节'));
    assert.ok(result.includes('Para 1\n\n第 1 段'));
    assert.ok(result.includes('# Section 2'));
    assert.ok(result.includes('Para 2'));
  });

  test('ADV-PIPE-2.14: generateReadingAssets slices input context to 15,000 characters maximum', async () => {
    const llm = new LlmClient({ apiKey: 'test-key' });
    const calls = [];

    globalThis.fetch = async (url, opts = {}) => {
      const body = JSON.parse(opts.body);
      const userPrompt = body.messages[1].content;
      calls.push(userPrompt);
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'Asset response' } }]
      }), { status: 200 });
    };

    const hugeText = 'A'.repeat(30_000);
    const assets = await llm.generateReadingAssets({
      title: 'Attention',
      markdown: hugeText
    });

    assert.equal(calls.length, 3, 'Should generate summary, terms, and qa');
    for (const prompt of calls) {
      assert.ok(prompt.length <= 16_000, 'Context prompt should be bounded');
    }
    assert.equal(assets.summary, 'Asset response');
  });
});

// =========================================================================
// Suite 3: Vault Writer Integrity & Path Traversal
// =========================================================================
describe('Tier 5 Adversarial: Vault Writer Integrity & Path Traversal', () => {
  test('ADV-PIPE-3.1: normalizeVaultPath sanitizes path traversal, multiple slashes, and whitespace', () => {
    assert.equal(normalizeVaultPath(''), '');
    assert.equal(normalizeVaultPath('   '), '');
    assert.equal(normalizeVaultPath('///Papers///DeepSeek///'), 'Papers/DeepSeek');
    assert.equal(normalizeVaultPath('Papers\\NLP\\transformer.md'), 'Papers/NLP/transformer.md');
    assert.equal(normalizeVaultPath('/root/folder/file.md'), 'root/folder/file.md');
  });

  test('ADV-PIPE-3.2: ensureVaultDirectory creates deep recursive directory tree without crashing', async () => {
    const app = new MockApp();
    await ensureVaultDirectory(app.vault, 'Papers/2024/NeurIPS/Transformers/v1/images');

    assert.ok(app.vault.getAbstractFileByPath('Papers'));
    assert.ok(app.vault.getAbstractFileByPath('Papers/2024'));
    assert.ok(app.vault.getAbstractFileByPath('Papers/2024/NeurIPS'));
    assert.ok(app.vault.getAbstractFileByPath('Papers/2024/NeurIPS/Transformers'));
    assert.ok(app.vault.getAbstractFileByPath('Papers/2024/NeurIPS/Transformers/v1'));
    assert.ok(app.vault.getAbstractFileByPath('Papers/2024/NeurIPS/Transformers/v1/images'));

    // Repeated call must be idempotent
    await ensureVaultDirectory(app.vault, 'Papers/2024/NeurIPS/Transformers/v1/images');
  });

  test('ADV-PIPE-3.3: writeVaultNote creates new note and idempotently modifies existing file', async () => {
    const app = new MockApp();
    const notePath = 'Papers/attention/attention.index.md';

    const file1 = await writeVaultNote(app.vault, notePath, '# Initial Content');
    assert.equal(file1.path, notePath);
    assert.equal(await app.vault.read(file1), '# Initial Content');

    const file2 = await writeVaultNote(app.vault, notePath, '# Modified Content');
    assert.equal(file2.path, notePath);
    assert.equal(await app.vault.read(file2), '# Modified Content');
  });

  test('ADV-PIPE-3.4: writeVaultBinary correctly handles sliced Uint8Array views with non-zero byte offsets', async () => {
    const app = new MockApp();
    const rawBuffer = new Uint8Array([0x00, 0x00, 0x89, 0x50, 0x4e, 0x47, 0x00]);
    // Sub-view offset 2, length 4: [0x89, 0x50, 0x4e, 0x47]
    const subView = rawBuffer.subarray(2, 6);

    const binFile = await writeVaultBinary(app.vault, 'Papers/test/image.png', subView);
    const readBack = await app.vault.readBinary(binFile);
    assert.equal(readBack.byteLength, 4);

    const readU8 = new Uint8Array(readBack);
    assert.deepEqual(Array.from(readU8), [0x89, 0x50, 0x4e, 0x47]);
  });

  test('ADV-PIPE-3.5: writeVaultBinary rejects non-binary data types with TypeError', async () => {
    const app = new MockApp();
    await assert.rejects(
      // @ts-expect-error Testing invalid runtime argument
      () => writeVaultBinary(app.vault, 'Papers/test/invalid.bin', 'Not a buffer'),
      /Expected ArrayBuffer or TypedArray/
    );
    await assert.rejects(
      // @ts-expect-error Testing invalid runtime argument
      () => writeVaultBinary(app.vault, 'Papers/test/invalid.bin', 12345),
      /Expected ArrayBuffer or TypedArray/
    );
  });

  test('ADV-PIPE-3.6: writeVaultBinary idempotently updates existing binary file via modifyBinary', async () => {
    const app = new MockApp();
    const binPath = 'Papers/test/doc.pdf';

    const buf1 = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x31]);
    const file1 = await writeVaultBinary(app.vault, binPath, buf1);
    assert.equal((await app.vault.readBinary(file1)).byteLength, 5);

    const buf2 = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x32, 0x2e, 0x30]);
    const file2 = await writeVaultBinary(app.vault, binPath, buf2);
    assert.equal((await app.vault.readBinary(file2)).byteLength, 7);
  });

  test('ADV-PIPE-3.7: createPaperFrontmatter safely escapes strings with YAML control characters', () => {
    const fm = createPaperFrontmatter({
      title: 'Attention: All You Need #1 "Special" [2024]',
      year: 2024,
      isPeerReviewed: true,
      authors: ['Vaswani, A.', 'Shazeer, N.: Lead'],
      nested: { key: 'value: with colon' },
      nullField: null,
      undefinedField: undefined
    });

    assert.ok(fm.startsWith('---\n'));
    assert.ok(fm.endsWith('\n---'));
    // Colons/quotes must be JSON-stringified
    assert.ok(fm.includes('title: "Attention: All You Need #1 \\"Special\\" [2024]"'));
    assert.ok(fm.includes('year: 2024'));
    assert.ok(fm.includes('authors:'));
    assert.ok(fm.includes('  - "Vaswani, A."'));
    assert.ok(fm.includes('  - "Shazeer, N.: Lead"'));
    assert.ok(fm.includes('nested:'));
    assert.ok(fm.includes('  key: "value: with colon"'));
    assert.ok(!fm.includes('nullField'), 'Null fields must be omitted');
    assert.ok(!fm.includes('undefinedField'), 'Undefined fields must be omitted');
  });

  test('ADV-PIPE-3.8: parsePaperFrontmatter extracts frontmatter and body cleanly, unquoting strings', () => {
    const doc = [
      '---',
      'title: "Attention: Is All You Need"',
      'year: 2017',
      'slug: attention-is-all-you-need',
      '---',
      '',
      '# Body Header',
      '',
      'Body paragraph text.'
    ].join('\n');

    const { frontmatter, body } = parsePaperFrontmatter(doc);
    assert.equal(frontmatter.title, 'Attention: Is All You Need');
    assert.equal(frontmatter.year, '2017');
    assert.equal(frontmatter.slug, 'attention-is-all-you-need');
    assert.ok(body.startsWith('# Body Header'));
    assert.ok(body.includes('Body paragraph text.'));
  });

  test('ADV-PIPE-3.9: parsePaperFrontmatter handles non-frontmatter markdown or missing closing delimiter', () => {
    const raw = '# Just Markdown\n\nNo frontmatter here.';
    const r1 = parsePaperFrontmatter(raw);
    assert.deepEqual(r1.frontmatter, {});
    assert.equal(r1.body, raw);

    const unclosed = '---\ntitle: Unclosed frontmatter\nyear: 2024\n# Missing closing dashes';
    const r2 = parsePaperFrontmatter(unclosed);
    assert.deepEqual(r2.frontmatter, {});
    assert.equal(r2.body, unclosed);
  });

  test('ADV-PIPE-3.10: Wikilink helpers produce exact Obsidian markdown syntax', () => {
    assert.equal(formatImageWikilink('figures/model_arch.png'), '![[model_arch.png]]');
    assert.equal(formatImageWikilink('images\\sub\\diagram.svg'), '![[diagram.svg]]');
    assert.equal(formatImageMarkdown('Arch diagram', 'images/arch.png'), '![Arch diagram](images/arch.png)');
    assert.equal(formatNoteWikilink('paper.index'), '[[paper.index]]');
    assert.equal(formatNoteWikilink('paper.original', 'Original Paper (EN)'), '[[paper.original|Original Paper (EN)]]');
  });
});

// =========================================================================
// Suite 4: Import Adapter Fault-Tolerance & End-to-End Resilience
// =========================================================================
describe('Tier 5 Adversarial: Import Adapter Fault-Tolerance & E2E Resilience', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('ADV-PIPE-4.1: generatePaperSlug sanitizes illegal filesystem characters, colons, and unicode', () => {
    assert.equal(
      generatePaperSlug('Attention: Is All You Need? / A Review! *2024*'),
      'attention-is-all-you-need-a-review-2024'
    );
    assert.equal(
      generatePaperSlug('Deep Learning: 深度学习 & AI', '1706.03762'),
      'deep-learning-ai-1706-03762'
    );
    assert.equal(generatePaperSlug('   '), 'paper');
  });

  test('ADV-PIPE-4.2: Full End-to-End Paper Import creates all 7 notes, PDF, layout, and images', async () => {
    const app = new MockApp();
    const mineruServer = new MockMineruCloudServer({ token: 'test-token', pollThreshold: 1 });
    const llmServer = new MockLlmServer({ validTokens: ['test-llm'] });

    globalThis.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (u.includes('mineru.net') || u.includes('oss-mock') || u.includes('openxlab.org.cn')) {
        return mineruServer.handleRequest(u, opts);
      }
      if (u.includes('api.openai.com')) {
        return llmServer.handleRequest(u, opts);
      }
      return originalFetch(url, opts);
    };

    const progressSteps = [];
    const result = await importPaper({
      vault: app.vault,
      pdfData: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x31, 0x2e, 0x35]),
      pdfFileName: 'attention.pdf',
      metadata: {
        title: 'Attention Is All You Need',
        translatedTitle: '注意力就是你所需要的一切',
        arxivId: '1706.03762',
        authors: ['Vaswani et al.'],
        year: 2017
      },
      mineruConfig: { cloudApiToken: 'test-token', pollIntervalMs: 5 },
      llmConfig: { apiKey: 'test-llm' },
      onProgress: (step, pct) => progressSteps.push({ step, pct })
    });

    assert.equal(result.slug, 'attention-is-all-you-need-1706-03762');
    assert.equal(result.folderPath, 'Papers/attention-is-all-you-need-1706-03762');

    // Verify all 7 note files exist in vault
    assert.ok(app.vault.getAbstractFileByPath(`${result.folderPath}/${result.slug}.index.md`));
    assert.ok(app.vault.getAbstractFileByPath(`${result.folderPath}/${result.slug}.original.md`));
    assert.ok(app.vault.getAbstractFileByPath(`${result.folderPath}/${result.slug}.bilingual.md`));
    assert.ok(app.vault.getAbstractFileByPath(`${result.folderPath}/${result.slug}.zh.md`));
    assert.ok(app.vault.getAbstractFileByPath(`${result.folderPath}/${result.slug}.summary.md`));
    assert.ok(app.vault.getAbstractFileByPath(`${result.folderPath}/${result.slug}.terms.md`));
    assert.ok(app.vault.getAbstractFileByPath(`${result.folderPath}/${result.slug}.qa.md`));

    // Verify layout JSON and source PDF
    assert.ok(app.vault.getAbstractFileByPath(`${result.folderPath}/${result.slug}.layout.json`));
    assert.ok(app.vault.getAbstractFileByPath(`${result.folderPath}/document.pdf`));
    assert.ok(result.imageFiles.length > 0);

    // Verify progress tracking reached 100%
    assert.ok(progressSteps.some((p) => p.pct === 100));
  });

  test('ADV-PIPE-4.3: Fault-Tolerance: Translation failure degrades gracefully to original text without failing import', async () => {
    const app = new MockApp();
    const mineruServer = new MockMineruCloudServer({ token: 'test-token', pollThreshold: 1 });

    globalThis.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (u.includes('mineru.net') || u.includes('oss-mock') || u.includes('openxlab.org.cn')) {
        return mineruServer.handleRequest(u, opts);
      }
      if (u.includes('api.openai.com')) {
        // Simulate LLM 401 Unauthorized during translation
        return new Response(JSON.stringify({ error: { message: 'Quota exceeded' } }), { status: 401 });
      }
      return originalFetch(url, opts);
    };

    const result = await importPaper({
      vault: app.vault,
      pdfData: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      pdfFileName: 'robust.pdf',
      metadata: { title: 'Robust Paper' },
      mineruConfig: { cloudApiToken: 'test-token', pollIntervalMs: 5 },
      llmConfig: { apiKey: 'faulty-key' }
    });

    // Pipeline must complete successfully
    assert.ok(result.indexFile);
    assert.ok(result.originalFile);
    assert.ok(result.bilingualFile);

    // Bilingual note should degrade to original text
    const biContent = await app.vault.read(result.bilingualFile);
    assert.ok(biContent.includes('---'));
    assert.ok(!biContent.includes('TypeError'));
  });

  test('ADV-PIPE-4.4: Fault-Tolerance: Reading assets generation failure continues pipeline cleanly', async () => {
    const app = new MockApp();
    const mineruServer = new MockMineruCloudServer({ token: 'test-token', pollThreshold: 1 });
    let isTranslating = true;

    globalThis.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (u.includes('mineru.net') || u.includes('oss-mock') || u.includes('openxlab.org.cn')) {
        return mineruServer.handleRequest(u, opts);
      }
      if (u.includes('api.openai.com')) {
        const body = JSON.parse(opts.body);
        if (body.messages[0].content.includes('academic translator')) {
          return new Response(JSON.stringify({
            choices: [{ message: { content: '# 译文标题\n\n翻译段落。' } }]
          }), { status: 200 });
        }
        // Fail reading assets
        return new Response(JSON.stringify({ error: { message: 'Model context limit exceeded' } }), { status: 400 });
      }
      return originalFetch(url, opts);
    };

    const result = await importPaper({
      vault: app.vault,
      pdfData: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      pdfFileName: 'assets-fail.pdf',
      metadata: { title: 'Assets Fail Paper' },
      mineruConfig: { cloudApiToken: 'test-token', pollIntervalMs: 5 },
      llmConfig: { apiKey: 'valid-llm', maxRetries: 1 }
    });

    assert.ok(result.indexFile);
    assert.ok(result.translatedFile);
    // Summary, terms, and qa notes should be undefined
    assert.equal(result.summaryFile, undefined);
    assert.equal(result.termsFile, undefined);
    assert.equal(result.qaFile, undefined);
  });

  test('ADV-PIPE-4.5: skipTranslation and skipReadingAssets flags bypass LLM requests completely', async () => {
    const app = new MockApp();
    const mineruServer = new MockMineruCloudServer({ token: 'test-token', pollThreshold: 1 });
    let llmCalled = false;

    globalThis.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (u.includes('mineru.net') || u.includes('oss-mock') || u.includes('openxlab.org.cn')) {
        return mineruServer.handleRequest(u, opts);
      }
      if (u.includes('api.openai.com')) {
        llmCalled = true;
        return new Response('Should not be called', { status: 500 });
      }
      return originalFetch(url, opts);
    };

    const result = await importPaper({
      vault: app.vault,
      pdfData: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      pdfFileName: 'skip.pdf',
      metadata: { title: 'Fast Import' },
      mineruConfig: { cloudApiToken: 'test-token', pollIntervalMs: 5 },
      llmConfig: { apiKey: 'key' },
      skipTranslation: true,
      skipReadingAssets: true
    });

    assert.equal(llmCalled, false, 'LLM endpoints must not be reached when skip flags are active');
    assert.ok(result.indexFile);
    assert.ok(result.originalFile);
    assert.equal(result.translatedFile, undefined);
    assert.equal(result.summaryFile, undefined);
  });

  test('ADV-PIPE-4.6: Deduplicates images with identical basenames from subfolders', async () => {
    const app = new MockApp();
    const customZip = generateMockMineruZip({
      markdown: '# Duplicate Images Paper',
      images: {
        'images/figure1.png': new Uint8Array([1, 2, 3]),
        'deep/nested/figure1.png': new Uint8Array([1, 2, 3]), // Duplicate basename
        'images/figure2.png': new Uint8Array([4, 5, 6])
      }
    });

    globalThis.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (u.includes('file-urls/batch')) {
        return new Response(JSON.stringify({
          code: 0,
          data: { batch_id: 'b-dup', file_urls: ['https://oss.aliyun.com/upload'] }
        }), { status: 200 });
      }
      if (opts.method === 'PUT') return new Response('OK', { status: 200 });
      if (u.includes('extract-results/batch/')) {
        return new Response(JSON.stringify({
          code: 0,
          data: { extract_result: [{ state: 'done', full_zip_url: 'https://cdn.example.com/dup.zip' }] }
        }), { status: 200 });
      }
      if (u.includes('dup.zip')) {
        return new Response(customZip, { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    };

    const result = await importPaper({
      vault: app.vault,
      pdfData: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      pdfFileName: 'dup.pdf',
      metadata: { title: 'Duplicate Images Paper' },
      mineruConfig: { cloudApiToken: 'token', pollIntervalMs: 5 },
      skipTranslation: true,
      skipReadingAssets: true
    });

    assert.equal(result.imageFiles.length, 2, 'Should only write 2 deduplicated images');
    const imageNames = result.imageFiles.map((f) => f.name);
    assert.ok(imageNames.includes('figure1.png'));
    assert.ok(imageNames.includes('figure2.png'));
  });

  test('ADV-PIPE-4.7: Custom targetFolder overrides default Papers/<slug> location', async () => {
    const app = new MockApp();
    const mineruServer = new MockMineruCloudServer({ token: 'test-token', pollThreshold: 1 });

    globalThis.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (u.includes('mineru.net') || u.includes('oss-mock') || u.includes('openxlab.org.cn')) {
        return mineruServer.handleRequest(u, opts);
      }
      return originalFetch(url, opts);
    };

    const result = await importPaper({
      vault: app.vault,
      pdfData: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      pdfFileName: 'custom.pdf',
      metadata: { title: 'Custom Destination' },
      targetFolder: 'Research/Archive/2024/Transformers',
      mineruConfig: { cloudApiToken: 'test-token', pollIntervalMs: 5 },
      skipTranslation: true,
      skipReadingAssets: true
    });

    assert.equal(result.folderPath, 'Research/Archive/2024/Transformers');
    assert.ok(app.vault.getAbstractFileByPath('Research/Archive/2024/Transformers/document.pdf'));
    assert.ok(app.vault.getAbstractFileByPath(`Research/Archive/2024/Transformers/${result.slug}.index.md`));
  });

  test('ADV-PIPE-4.8: Repeated re-import of same paper is idempotent and updates existing vault files', async () => {
    const app = new MockApp();
    const mineruServer = new MockMineruCloudServer({ token: 'test-token', pollThreshold: 1 });

    globalThis.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (u.includes('mineru.net') || u.includes('oss-mock') || u.includes('openxlab.org.cn')) {
        return mineruServer.handleRequest(u, opts);
      }
      return originalFetch(url, opts);
    };

    const input = {
      vault: app.vault,
      pdfData: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      pdfFileName: 'idempotent.pdf',
      metadata: { title: 'Idempotent Paper' },
      mineruConfig: { cloudApiToken: 'test-token', pollIntervalMs: 5 },
      skipTranslation: true,
      skipReadingAssets: true
    };

    // First import
    const res1 = await importPaper(input);
    assert.ok(res1.indexFile);

    // Second import over same path
    const res2 = await importPaper(input);
    assert.ok(res2.indexFile);
    assert.equal(res1.indexFile.path, res2.indexFile.path);
  });
});
