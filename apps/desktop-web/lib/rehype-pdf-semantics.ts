import { semanticText, type PdfRole, type PdfAnnotation } from './pdf-semantics.ts';

interface Node {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: Node[];
}
function text(node: Node): string {
  return node.value ?? node.children?.map(text).join('') ?? '';
}
function mark(node: Node, role: PdfRole) {
  node.properties = { ...node.properties, dataPdfRole: role, className: [`md-semantic-${role}`] };
}

/** Runs after sanitizing external HTML, before KaTeX expands math text. */
export function rehypePdfSemantics(options: { role?: PdfRole; annotations?: PdfAnnotation[] } = {}) {
  return (tree: Node) => {
    const annotations = (options.annotations ?? []).map(annotation => ({ ...annotation, key: semanticText(annotation.text) }));
    function visit(node: Node) {
      if (node.type === 'element' && node.tagName === 'p' && node.children?.some(child => child.tagName === 'img')) {
        const images = node.children.filter(child => child.tagName === 'img');
        const caption = node.children.filter(child => child.tagName !== 'img');
        while (caption.length && (caption[0].tagName === 'br' || !text(caption[0]).trim())) caption.shift();
        node.tagName = 'figure';
        node.children = [...images, ...(caption.some(child => text(child).trim()) ? [{ type: 'element', tagName: 'figcaption', children: caption }] : [])];
        mark(node, 'image');
      }
      if (node.type === 'element' && ['p', 'figcaption', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(node.tagName ?? '')) {
        const key = semanticText(text(node));
        const annotation = annotations.find(item => item.key && item.key === key);
        const role = node.tagName === 'figcaption' ? 'caption' : /^h[1-6]$/.test(node.tagName ?? '') ? 'title' : annotation?.role ?? options.role ?? 'body';
        if (role === 'title' && node.tagName === 'p') node.tagName = `h${Math.max(1, Math.min(6, annotation?.level ?? 2))}`;
        mark(node, role);
      }
      node.children?.forEach(visit);
    }
    visit(tree);
  };
}
