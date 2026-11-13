/**
 * Contract validation and reference implementations for PDF2obsidian Obsidian plugin specifications.
 * Strictly derived from ORIGINAL_REQUEST.md, PROJECT.md, and survey reports.
 */

import { MockTFile } from './obsidian.mjs';

/**
 * Validates plugin manifest schema and constraints (F2).
 */
export function validateManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object') {
    return { valid: false, errors: ['Manifest must be an object'] };
  }

  // ID validation
  if (!manifest.id || typeof manifest.id !== 'string') {
    errors.push('Manifest "id" is required and must be a string');
  } else {
    if (!/^[a-z0-9-]+$/.test(manifest.id)) {
      errors.push('Manifest "id" must contain only lowercase alphanumeric characters and hyphens');
    }
    if (manifest.id === 'obsidian' || manifest.id.startsWith('obsidian-') || manifest.id.endsWith('-obsidian')) {
      errors.push('Manifest "id" must not start or end with the reserved word "obsidian"');
    }
    if (manifest.id.endsWith('plugin')) {
      errors.push('Manifest "id" must not end with the redundant suffix "plugin"');
    }
  }

  // Name validation
  if (!manifest.name || typeof manifest.name !== 'string' || manifest.name.trim().length === 0) {
    errors.push('Manifest "name" is required and must be non-empty');
  }

  // Version validation
  if (!manifest.version || !/^\d+\.\d+\.\d+/.test(manifest.version)) {
    errors.push('Manifest "version" must be a valid semantic version string (e.g. 0.1.0)');
  }

  // minAppVersion validation
  if (!manifest.minAppVersion || !/^\d+\.\d+\.\d+/.test(manifest.minAppVersion)) {
    errors.push('Manifest "minAppVersion" must be a valid semantic version string (e.g. 1.5.0)');
  }

  // Description validation
  if (!manifest.description || typeof manifest.description !== 'string') {
    errors.push('Manifest "description" is required and must be a string');
  } else if (manifest.description.length > 250) {
    errors.push(`Manifest "description" exceeds 250 characters limit (${manifest.description.length})`);
  }

  // isDesktopOnly validation
  if (manifest.isDesktopOnly !== true) {
    errors.push('Manifest "isDesktopOnly" must be strictly boolean true for desktop PDF worker and canvas support');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

export {
  sanitizeBbox,
  calculateBboxStyles,
  classifyBlockRole,
  parseMineruBlocks,
  DEFAULT_STORAGE_KEY,
  DEFAULT_SPLIT_STORAGE_KEY,
  DEFAULT_SPLIT_RATIO,
  MIN_SPLIT_RATIO,
  MAX_SPLIT_RATIO,
  clampSplitRatio,
  clampRatio,
  stepSplitRatio,
  stepRatio,
  handleSplitterKey,
  calculateCanvasDimensions,
  getPageNumbers,
  generatePageNumbers,
  groupBlocksByPage,
  createInitialSelectionState,
  updateSelectionState,
  updateReaderSelection,
  updateSelection,
  clearSelectionState,
  clearReaderSelection,
  clearSelection,
  isSegmentActive
} from '../../src/utils/coordinates.ts';

import {
  createBilingualMarkdown,
  linkBilingualSegments,
  parseBilingualMarkdown as baseParseBilingualMarkdown,
  isInvariantBlock,
  escapeHtml,
  renderMathSafely as baseRenderMathSafely,
  hasChinese,
  splitIntoSections
} from '../../src/utils/bilingual.ts';

export function renderMathSafely(tex, displayMode) {
  const rendered = baseRenderMathSafely(tex, displayMode);
  return typeof rendered === 'string' ? rendered.replace(/<annotation[^>]*>[\s\S]*?<\/annotation>/g, '') : rendered;
}

export function parseBilingualMarkdown(bilingualMarkdown) {
  if (typeof bilingualMarkdown === 'string') {
    bilingualMarkdown = bilingualMarkdown.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n)?/, '');
  }
  return baseParseBilingualMarkdown(bilingualMarkdown);
}

export {
  createBilingualMarkdown,
  linkBilingualSegments,
  isInvariantBlock,
  escapeHtml,
  hasChinese,
  splitIntoSections
};


/**
 * Recursively ensures all directories exist in the vault (F18).
 */
export async function ensureVaultDirectory(vault, folderPath) {
  const normalized = folderPath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  if (!normalized) return;

  const parts = normalized.split('/').filter(Boolean);
  let current = '';

  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    const existing = vault.getAbstractFileByPath(current);
    if (!existing) {
      try {
        await vault.createFolder(current);
      } catch (err) {
        if (!err.message?.includes('already exists')) {
          throw err;
        }
      }
    }
  }
}

/**
 * Safely creates or modifies a text note in the vault (F18).
 */
export async function safeWriteVaultNote(vault, notePath, content) {
  const norm = notePath.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  const dirIdx = norm.lastIndexOf('/');
  if (dirIdx >= 0) {
    const dir = norm.slice(0, dirIdx);
    await ensureVaultDirectory(vault, dir);
  }

  const existing = vault.getAbstractFileByPath(norm);
  if (existing instanceof MockTFile) {
    return await vault.modify(existing, content);
  }
  return await vault.create(norm, content);
}

/**
 * Safely creates or modifies a binary file in the vault (F18, F20).
 */
export async function safeWriteVaultBinary(vault, filePath, data) {
  const norm = filePath.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  const dirIdx = norm.lastIndexOf('/');
  if (dirIdx >= 0) {
    const dir = norm.slice(0, dirIdx);
    await ensureVaultDirectory(vault, dir);
  }

  let buffer;
  if (data instanceof ArrayBuffer) {
    buffer = data;
  } else if (ArrayBuffer.isView(data)) {
    buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  } else {
    throw new TypeError(`Expected ArrayBuffer or TypedArray, got ${typeof data}`);
  }

  const existing = vault.getAbstractFileByPath(norm);
  if (existing instanceof MockTFile) {
    await vault.modifyBinary(existing, buffer);
    return existing;
  }
  return await vault.createBinary(norm, buffer);
}

/**
 * Serializes PaperMetadata into formatted YAML frontmatter (F19).
 */
export function createPaperFrontmatter(metadata) {
  const lines = ['---'];
  for (const [key, value] of Object.entries(metadata)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) {
        lines.push(`  - ${JSON.stringify(item)}`);
      }
    } else if (typeof value === 'object') {
      lines.push(`${key}:`);
      for (const [subKey, subVal] of Object.entries(value)) {
        lines.push(`  ${subKey}: ${JSON.stringify(subVal)}`);
      }
    } else if (typeof value === 'string' && (value.includes(':') || value.includes('[') || value.includes('{') || value.includes('#'))) {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  lines.push('---');
  return lines.join('\n');
}

/**
 * Parses YAML frontmatter and separates it from the markdown body (F19).
 */
export function parsePaperFrontmatter(content) {
  if (!content.startsWith('---')) {
    return { frontmatter: {}, body: content };
  }
  const endIdx = content.indexOf('\n---', 3);
  if (endIdx === -1) {
    return { frontmatter: {}, body: content };
  }
  const rawYaml = content.slice(4, endIdx).trim();
  const body = content.slice(endIdx + 4).trim();

  const frontmatter = {};
  for (const line of rawYaml.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      let val = line.slice(colonIdx + 1).trim();
      if (val.startsWith('"') && val.endsWith('"')) {
        val = val.slice(1, -1);
      }
      frontmatter[key] = val;
    }
  }

  return { frontmatter, body };
}

/**
 * Splits markdown into semantic chunks respecting headings and fences (F17).
 */
export function chunkMarkdown(markdown, chunkCharLimit = 2000) {
  const sections = splitIntoSections(markdown);
  const chunks = [];
  let currentChunk = '';
  let currentHeadingPath = [];

  for (const sec of sections) {
    const secHeading = sec.heading ? sec.heading.replace(/^#+\s*/, '') : '';
    if ((currentChunk.length + sec.raw.length) > chunkCharLimit && currentChunk.length > 0) {
      chunks.push({
        headingPath: [...currentHeadingPath],
        content: currentChunk.trim()
      });
      currentChunk = '';
    }
    if (secHeading) {
      currentHeadingPath = [secHeading];
    }
    currentChunk += (currentChunk ? '\n\n' : '') + sec.raw;
  }

  if (currentChunk.trim()) {
    chunks.push({
      headingPath: currentHeadingPath,
      content: currentChunk.trim()
    });
  }

  return chunks;
}
