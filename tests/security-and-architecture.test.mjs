import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import YAML from '../packages/core/node_modules/yaml/dist/index.js';
import { loadConfig } from '../packages/core/dist/config/load-config.js';
import { assertSafeRemoteUrl, looksLikeRemoteSource } from '../packages/pipeline/dist/resolve-pdf-source.js';
import {
  maskConfigData,
  isMasked,
  SECRET_MASK,
  writeLocalConfigData,
  readLocalConfig
} from '../apps/desktop-web/lib/config.ts';

test('SSRF defense: assertSafeRemoteUrl blocks private IPs, metadata endpoints and unsafe schemes', () => {
  // Loopback and internal
  assert.throws(() => assertSafeRemoteUrl('http://127.0.0.1/admin'), /禁止访问/);
  assert.throws(() => assertSafeRemoteUrl('http://localhost:8080/secret'), /禁止访问/);
  assert.throws(() => assertSafeRemoteUrl('http://0.0.0.0:3000'), /禁止访问/);

  // Cloud metadata
  assert.throws(() => assertSafeRemoteUrl('http://169.254.169.254/latest/meta-data'), /禁止访问/);
  assert.throws(() => assertSafeRemoteUrl('http://metadata.google.internal/computeMetadata'), /禁止访问/);

  // Private IPv4 ranges
  assert.throws(() => assertSafeRemoteUrl('http://10.0.0.1/config'), /禁止访问/);
  assert.throws(() => assertSafeRemoteUrl('http://192.168.1.1/router'), /禁止访问/);
  assert.throws(() => assertSafeRemoteUrl('http://172.16.0.5/api'), /禁止访问/);
  assert.throws(() => assertSafeRemoteUrl('http://172.31.255.255/api'), /禁止访问/);

  // Unsafe schemes
  assert.throws(() => assertSafeRemoteUrl('file:///etc/passwd'), /不支持的协议/);
  assert.throws(() => assertSafeRemoteUrl('ftp://example.com/paper.pdf'), /不支持的协议/);
  assert.throws(() => assertSafeRemoteUrl('javascript:alert(1)'), /不支持的协议/);

  // Allowed public URLs
  assert.doesNotThrow(() => assertSafeRemoteUrl('https://arxiv.org/pdf/2301.12345.pdf'));
  assert.doesNotThrow(() => assertSafeRemoteUrl('https://example.com/deeplearning.pdf'));
});

test('Remote source identification: looksLikeRemoteSource accurately distinguishes remote inputs from local files', () => {
  assert.equal(looksLikeRemoteSource('2301.12345'), true);
  assert.equal(looksLikeRemoteSource('2301.12345v2'), true);
  assert.equal(looksLikeRemoteSource('arxiv:2301.12345'), true);
  assert.equal(looksLikeRemoteSource('https://arxiv.org/abs/2301.12345'), true);
  assert.equal(looksLikeRemoteSource('10.1145/3372278.3390670'), true);
  assert.equal(looksLikeRemoteSource('https://example.com/paper.pdf'), true);

  // Local files
  assert.equal(looksLikeRemoteSource('./paper.pdf'), false);
  assert.equal(looksLikeRemoteSource('papers/attention.pdf'), false);
  assert.equal(looksLikeRemoteSource('/tmp/test.pdf'), false);
});

test('Path unification: loadConfig resolves relative paths relative to config file directory', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pdf2obsidian-config-test-'));
  const configPath = join(dir, 'custom.config.yaml');

  const content = YAML.stringify({
    vault: {
      path: './my-vault',
      documentDir: 'papers',
      imageDirName: 'images'
    },
    mineru: {
      command: 'magic-pdf',
      outputDir: './pipeline-mineru',
      mode: 'official',
      backend: 'hybrid-http-client'
    },
    translation: {
      enabled: false,
      provider: 'ollama',
      model: 'qwen',
      baseUrl: 'http://127.0.0.1:11434',
      systemPrompt: 'test',
      cacheDir: './pipeline-cache'
    },
    tasks: {
      stateDir: './pipeline-tasks',
      inboxDir: './pipeline-inbox'
    }
  });

  await writeFile(configPath, content, 'utf8');

  try {
    const config = await loadConfig(configPath);

    assert.equal(config.vault.path, join(dir, 'my-vault'));
    assert.equal(config.mineru.outputDir, join(dir, 'pipeline-mineru'));
    assert.equal(config.tasks.stateDir, join(dir, 'pipeline-tasks'));
    assert.equal(config.tasks.inboxDir, join(dir, 'pipeline-inbox'));
    assert.equal(config.translation.cacheDir, join(dir, 'pipeline-cache'));
    assert.equal(config.readingAssets.cacheDir, join(dir, '.pipeline/core-assets-cache'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Secret masking: maskConfigData and isMasked properly protect tokens', () => {
  const data = {
    mineru: {
      mode: 'official',
      apiToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secret'
    },
    translation: {
      provider: 'openai-compatible',
      apiKey: 'sk-1234567890abcdef'
    }
  };

  const masked = maskConfigData(data);
  assert.equal(masked.mineru.apiToken, SECRET_MASK);
  assert.equal(masked.translation.apiKey, SECRET_MASK);
  assert.equal(isMasked(SECRET_MASK), true);
  assert.equal(isMasked('••••••••'), true);
  assert.equal(isMasked('sk-1234567890abcdef'), false);
});
