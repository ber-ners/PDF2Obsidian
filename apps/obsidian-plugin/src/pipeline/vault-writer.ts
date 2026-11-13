import type { TFile, Vault } from 'obsidian';
import type { PaperMetadata } from '../types/pipeline';

/**
 * Normalizes vault file and directory POSIX paths:
 * - Replaces backslashes with forward slashes
 * - Collapses consecutive forward slashes
 * - Trims leading and trailing slashes and whitespace
 */
export function normalizeVaultPath(rawPath: string): string {
  if (!rawPath) return '';
  return rawPath
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
}

/**
 * Recursively creates all intermediate directories in the vault if they do not exist.
 * Conforms strictly to Obsidian app.vault.createFolder.
 */
export async function ensureVaultDirectory(vault: Vault, folderPath: string): Promise<void> {
  const normalized = normalizeVaultPath(folderPath);
  if (!normalized || normalized === '.') return;

  const parts = normalized.split('/').filter(Boolean);
  let current = '';

  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    const existing = vault.getAbstractFileByPath(current);
    if (!existing) {
      try {
        await vault.createFolder(current);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.toLowerCase().includes('already exists')) {
          throw err;
        }
      }
    }
  }
}

/**
 * Safely creates or modifies a text note in the vault.
 * Automatically creates parent directories if missing.
 * Idempotently updates existing files via modify, or creates a new file.
 */
export async function writeVaultNote(vault: Vault, path: string, content: string): Promise<TFile> {
  const norm = normalizeVaultPath(path);
  const dirIdx = norm.lastIndexOf('/');
  if (dirIdx >= 0) {
    const dir = norm.slice(0, dirIdx);
    await ensureVaultDirectory(vault, dir);
  }

  const existing = vault.getAbstractFileByPath(norm);
  if (existing) {
    if ('basename' in existing && 'path' in existing) {
      await vault.modify(existing as TFile, content);
      return existing as TFile;
    }
  }

  return await vault.create(norm, content);
}

/**
 * Alias for writeVaultNote ensuring full contract compatibility.
 */
export const safeWriteVaultNote = writeVaultNote;

/**
 * Safely creates or modifies a binary file in the vault (images, PDF binaries).
 * Accepts ArrayBuffer, Uint8Array, or Node Buffer.
 * Converts typed views to native ArrayBuffer before passing to app.vault.createBinary.
 */
export async function writeVaultBinary(
  vault: Vault,
  path: string,
  data: ArrayBuffer | Uint8Array | ArrayBufferView
): Promise<TFile> {
  const norm = normalizeVaultPath(path);
  const dirIdx = norm.lastIndexOf('/');
  if (dirIdx >= 0) {
    const dir = norm.slice(0, dirIdx);
    await ensureVaultDirectory(vault, dir);
  }

  let buffer: ArrayBuffer;
  if (data instanceof ArrayBuffer) {
    buffer = data;
  } else if (ArrayBuffer.isView(data)) {
    buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  } else {
    throw new TypeError(`Expected ArrayBuffer or TypedArray, got ${typeof data}`);
  }

  const existing = vault.getAbstractFileByPath(norm);
  if (existing) {
    if ('basename' in existing && 'path' in existing) {
      await vault.modifyBinary(existing as TFile, buffer);
      return existing as TFile;
    }
  }

  return await vault.createBinary(norm, buffer);
}

/**
 * Alias for writeVaultBinary ensuring full contract compatibility.
 */
export const safeWriteVaultBinary = writeVaultBinary;

/**
 * Serializes paper metadata into formatted YAML frontmatter enclosed in triple dashes.
 * Safely handles string quoting, arrays, numbers, and boolean values.
 * Omits undefined and null fields.
 */
export function createPaperFrontmatter(metadata: Record<string, unknown> | Partial<PaperMetadata>): string {
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
      for (const [subKey, subVal] of Object.entries(value as Record<string, unknown>)) {
        if (subVal !== undefined && subVal !== null) {
          lines.push(`  ${subKey}: ${JSON.stringify(subVal)}`);
        }
      }
    } else if (
      typeof value === 'string' &&
      (value.includes(':') ||
        value.includes('[') ||
        value.includes(']') ||
        value.includes('{') ||
        value.includes('}') ||
        value.includes('#') ||
        value.includes('"') ||
        value.includes('\n') ||
        value.trim() !== value)
    ) {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }

  lines.push('---');
  return lines.join('\n');
}

/**
 * Parses YAML frontmatter and separates it from the markdown body.
 */
export function parsePaperFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
  if (!content.startsWith('---')) {
    return { frontmatter: {}, body: content };
  }

  const endIdx = content.indexOf('\n---', 3);
  if (endIdx === -1) {
    return { frontmatter: {}, body: content };
  }

  const rawYaml = content.slice(4, endIdx).trim();
  const body = content.slice(endIdx + 4).trim();

  const frontmatter: Record<string, string> = {};
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
 * Formats an image reference as an Obsidian Wikilink embed.
 * Example: ![[fig_1.png]]
 */
export function formatImageWikilink(imageName: string): string {
  const clean = imageName.replace(/\\/g, '/');
  const base = clean.split('/').pop() || clean;
  return `![[${base}]]`;
}

/**
 * Formats an image reference as standard Markdown.
 * Example: ![Figure 1](images/fig_1.png)
 */
export function formatImageMarkdown(alt: string, relativePath: string): string {
  const clean = relativePath.replace(/\\/g, '/');
  return `![${alt}](${clean})`;
}

/**
 * Formats an internal Obsidian note Wikilink.
 * Example: [[note_name]] or [[note_name|Display Title]]
 */
export function formatNoteWikilink(targetNote: string, alias?: string): string {
  if (alias && alias !== targetNote) {
    return `[[${targetNote}|${alias}]]`;
  }
  return `[[${targetNote}]]`;
}
