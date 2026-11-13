/**
 * Ambient module declarations for @pdf2obsidian/obsidian-plugin.
 *
 * Provides TypeScript type definitions for non-TypeScript assets and
 * virtual modules injected by esbuild plugins.
 */

/**
 * Inlined PDF.js Web Worker script string.
 * Resolved by esbuild's `inlinePdfWorkerPlugin` in `esbuild.config.mjs`
 * from `pdfjs-dist/build/pdf.worker.min.mjs` into a text string literal.
 */
declare module 'inline-pdfjs-worker' {
  const content: string;
  export default content;
}

/**
 * Ambient typing for CSS stylesheets imported into TypeScript entry points.
 * Handled by esbuild's CSS bundling pipeline (`cssRenamerPlugin` / `styles.css`).
 */
declare module '*.css' {
  const content: string;
  export default content;
}
