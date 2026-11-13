export type PdfRole = 'body' | 'title' | 'image' | 'table' | 'caption' | 'footnote' | 'header' | 'footer' | 'page-number' | 'equation' | 'reference';
export interface PdfAnnotation { text: string; role: PdfRole; level?: number }

export function pdfRole(type: string, level = 0): PdfRole {
  if (level > 0 || ['title', 'heading'].includes(type)) return 'title';
  if (['image', 'chart', 'image_body'].includes(type)) return 'image';
  if (['table', 'table_body'].includes(type)) return 'table';
  if (['image_caption', 'table_caption', 'figure_caption', 'caption'].includes(type)) return 'caption';
  if (['page_footnote', 'image_footnote', 'table_footnote', 'footnote', 'annotation'].includes(type)) return 'footnote';
  if (type === 'header') return 'header';
  if (type === 'footer') return 'footer';
  if (['page_number', 'page-number'].includes(type)) return 'page-number';
  if (['equation', 'interline_equation'].includes(type)) return 'equation';
  if (type === 'ref_text') return 'reference';
  return 'body';
}

export const pdfRoleLabels: Record<PdfRole, string> = {
  body: '正文', title: '标题', image: '图片', table: '表格', caption: '图表注释', footnote: '脚注',
  header: '页眉', footer: '页脚', 'page-number': '页码', equation: '公式', reference: '参考文献'
};

export function semanticText(text: string): string {
  return text.replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/<[^>]*>/g, '')
    .replace(/^#{1,6}\s+/gm, '').replace(/\\([_*])/g, '$1').replace(/[*$`]/g, '').replace(/\s+/g, '');
}
