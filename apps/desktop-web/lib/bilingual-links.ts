import { semanticText, type PdfRole, type PdfAnnotation } from './pdf-semantics.ts';
import type { PdfBlock } from './pdf-blocks';

export interface LinkedBilingualSegment {
  markdown: string;
  blockIds: string[];
  role?: PdfRole;
  annotations?: PdfAnnotation[];
}

// Normalize formatting only; do not guess translations or match by paragraph number.
function normalize(text: string): string {
  return text.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/^#{1,6}\s+/gm, '').replace(/\\([_*])/g, '$1')
    .replace(/\*\*/g, '').replace(/\s+/g, '');
}

export function linkBilingualSegments(segments: Array<{ source: string; markdown: string }>, blocks: PdfBlock[]): LinkedBilingualSegment[] {
  const linked: LinkedBilingualSegment[] = segments.map(({ markdown }) => ({ markdown, blockIds: [] as string[] }));
  let offset = 0;
  const ranges = segments.map(({ source }) => {
    const start = offset;
    offset += normalize(source).length;
    return { start, end: offset };
  });
  const source = segments.map(segment => normalize(segment.source)).join('');
  const occurrences = new Map<string, number>();
  for (const block of blocks) {
    if (!block.bbox || ['header', 'footer', 'page_number'].includes(block.type)) continue;
    if (block.continuationOf) {
      for (const item of linked) {
        if (item.blockIds.includes(block.continuationOf)) {
          item.blockIds.push(block.id);
        }
      }
      continue;
    }
    let key = normalize(block.sourceMarkdown ?? block.markdown);
    const heading = /^#{1,6}\s/.test(block.markdown);
    let occurrenceKey = heading ? `heading:${key}` : key;
    let start = heading
      ? ranges.find((range, index) => range.start >= (occurrences.get(occurrenceKey) ?? 0)
        && /^#{1,6}\s/.test(segments[index]!.source) && normalize(segments[index]!.source) === key)?.start ?? -1
      : key ? source.indexOf(key, occurrences.get(occurrenceKey) ?? 0) : -1;
    let length = key.length;
    if (start < 0 && block.image) {
      const fileName = block.image.split('/').pop()!;
      key = fileName;
      occurrenceKey = key;
      start = source.indexOf(fileName, occurrences.get(key) ?? 0);
      length = fileName.length;
    }
    if (start < 0) continue;
    const end = start + length;
    ranges.forEach((range, index) => {
      if (range.start < end && range.end > start) linked[index]!.blockIds.push(block.id);
    });
    occurrences.set(occurrenceKey, end);
  }
  // Captions/footnotes can be separate paragraphs or share a block with an image/table.
  // Carry their semantics to both languages without styling a whole mixed section as a note.
  const annotations = blocks.flatMap(block => block.annotations ?? []).map(annotation => ({ annotation, key: semanticText(annotation.text) }));
  for (let index = 0; index < segments.length; index++) {
    const sourceText = semanticText(segments[index]!.source);
    const matched = annotations.filter(({ key }) => key && sourceText.includes(key)).map(({ annotation }) => annotation);
    linked[index]!.annotations = matched;
    const exact = matched.find(annotation => semanticText(annotation.text) === sourceText);
    if (exact) linked[index]!.role = exact.role;
  }
  return linked;
}
