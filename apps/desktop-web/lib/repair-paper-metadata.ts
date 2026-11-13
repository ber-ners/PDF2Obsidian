import YAML from 'yaml';
import { createCitationFormats, extractPaperAuthors } from '@pdf2obsidian/core';

/** Recover legacy author arrays from the source, including names lost to the old 30-item limit. */
export function repairPaperMetadata(note: string, original: string): string {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(note);
  if (!match) return note;
  try {
    const metadata = YAML.parse(match[1]);
    if (!Array.isArray(metadata?.authors)
      || !metadata.authors.some((author: unknown) => typeof author === 'string' && /\$|\^\{|<sup\b/i.test(author))) return note;

    const authors = extractPaperAuthors(original);
    if (!authors.length) return note;
    const citations = createCitationFormats({
      ...metadata,
      title: metadata.paperTitle || metadata.title || '',
      keywords: Array.isArray(metadata.keywords) ? metadata.keywords : [],
      authors
    });
    const body = note.slice(match[0].length).replace(/^(- 作者[：:])[^\r\n]*$/m, `$1${authors.join(', ')}`);
    return `---\n${YAML.stringify({ ...metadata, authors, ...citations })}---\n${body}`;
  } catch {
    return note;
  }
}
