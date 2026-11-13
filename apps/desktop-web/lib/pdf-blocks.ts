import { pdfRole, type PdfRole, type PdfAnnotation } from './pdf-semantics.ts';

/** MinerU content_list coordinates are normalized to 0..1000 (top-left origin). */
export interface PdfBlock {
  id: string;
  page: number;
  bbox?: [number, number, number, number];
  markdown: string;
  sourceMarkdown?: string;
  image?: string;
  type: string;
  role?: PdfRole;
  headingLevel?: number;
  parts?: Array<{ role: PdfRole; markdown?: string; image?: string }>;
  annotations?: PdfAnnotation[];
  continuationOf?: string;
}

export function parsePdfBlocks(value: unknown): PdfBlock[] {
  if (!Array.isArray(value)) return [];
  let lastTextBlock: PdfBlock | undefined;
  const blocks = value.flatMap((item, index) => {
    if (!item || typeof item !== 'object' || !Number.isInteger(item.page_idx) || item.page_idx < 0) return [];
    const strings = (v: unknown): string[] => Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];
    const text = typeof item.text === 'string' ? item.text : '';
    const level = Number.isInteger(item.text_level) ? Math.min(6, Math.max(0, item.text_level)) : 0;
    const type = String(item.type ?? 'text');
    const role = pdfRole(type, level);
    const markdown = [
      ...strings(item.table_caption),
      level ? `${'#'.repeat(level)} ${text}` : text,
      ...strings(item.image_caption),
      ...strings(item.table_footnote), ...strings(item.image_footnote),
      ...strings(item.list_items).map((s) => `- ${s}`)
    ].filter(Boolean).join('\n\n');
    const image = typeof item.img_path === 'string' && item.img_path ? item.img_path : undefined;
    let bbox: PdfBlock['bbox'];
    if (Array.isArray(item.bbox) && item.bbox.length === 4 && item.bbox.every((n: unknown) => typeof n === 'number' && Number.isFinite(n))) {
      const [x0, y0, x1, y1] = item.bbox.map((n: number) => Math.min(1000, Math.max(0, n)));
      if (x1 > x0 && y1 > y0) bbox = [x0, y0, x1, y1];
    }
    if (!markdown && !image && !(typeof item.table_body === 'string' && item.table_body.trim())) {
      if (bbox && lastTextBlock && ['text', 'paragraph'].includes(type)) {
        return [{
          role: lastTextBlock.role,
          headingLevel: lastTextBlock.headingLevel,
          parts: lastTextBlock.parts,
          annotations: lastTextBlock.annotations,
          sourceMarkdown: lastTextBlock.sourceMarkdown,
          id: `block-${index}`,
          page: item.page_idx + 1,
          bbox,
          markdown: lastTextBlock.markdown,
          type: 'text',
          continuationOf: lastTextBlock.id
        }];
      }
      return [];
    }
    const sourceMarkdown = typeof item.table_body === 'string' && item.table_body.trim()
      ? [...strings(item.table_caption), item.table_body, ...strings(item.table_footnote)].join('\n\n')
      : undefined;
    const parts: NonNullable<PdfBlock['parts']> = [];
    const annotations: PdfAnnotation[] = [];
    const addText = (markdown: string, partRole: PdfRole) => {
      if (!markdown) return;
      parts.push({ role: partRole, markdown });
      annotations.push({ text: markdown, role: partRole, level: level || undefined });
    };
    strings(item.table_caption).forEach(text => addText(text, 'caption'));
    if (type === 'table' && typeof item.table_body === 'string' && item.table_body.trim()) addText(item.table_body, 'table');
    else if (image) parts.push({ role: role === 'table' ? 'table' : 'image', image });
    addText(level ? `${'#'.repeat(level)} ${text}` : text, role);
    strings(item.image_caption).forEach(text => addText(text, 'caption'));
    [...strings(item.table_footnote), ...strings(item.image_footnote)].forEach(text => addText(text, 'footnote'));
    const list = strings(item.list_items).map(text => `- ${text}`).join('\n');
    addText(list, role);
    const parsedBlock: PdfBlock = { role, headingLevel: level || undefined, parts, annotations, sourceMarkdown, id: `block-${index}`, page: item.page_idx + 1, bbox, markdown, image, type };
    if (['text', 'paragraph'].includes(type)) {
      if (!level) {
        lastTextBlock = parsedBlock;
      } else {
        lastTextBlock = undefined;
      }
    }
    return [parsedBlock];
  });
  const ordered: PdfBlock[] = [];
  for (let i = 0; i < blocks.length;) {
    const page = blocks[i]!.page;
    let end = i + 1;
    while (end < blocks.length && blocks[end]!.page === page) end++;
    const pageBlocks = blocks.slice(i, end);
    ordered.push(
      ...pageBlocks.filter((block) => block.role === 'header'),
      ...pageBlocks.filter((block) => block.role !== 'header')
    );
    i = end;
  }
  return ordered;
}
