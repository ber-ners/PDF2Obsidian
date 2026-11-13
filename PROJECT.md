# Project: PDF2obsidian Obsidian Native Plugin (`apps/obsidian-plugin`)

## Architecture
The PDF2obsidian Obsidian Native Plugin is established as a monorepo sub-package at `apps/obsidian-plugin`. It exposes native Obsidian commands, ribbon icons, and a custom `ItemView` hosting a React 19 academic paper dual-column reading interface, coupled with an automated import pipeline powered by MinerU and LLMs (OpenAI/DeepSeek) that persists structured academic assets directly into the user's Obsidian vault via `app.vault`.

### Architectural Modules
1. **Build & Bundle System**:
   - Bundles TypeScript, React 19, and `pdfjs-dist` into `apps/obsidian-plugin/main.js` (CJS target for Obsidian Electron runtime).
   - Inlines `pdf.worker.min.mjs` as a string resource and initializes it via an in-memory `Blob` URL (`URL.createObjectURL(new Blob([code], { type: 'application/javascript' }))`), achieving 100% self-contained offline worker execution with zero external network requests.
   - Compiles and bundles CSS including KaTeX stylesheets and fonts into `apps/obsidian-plugin/styles.css`.
   - Packages `manifest.json` with plugin metadata (`isDesktopOnly: true`).
2. **Obsidian Plugin & Dual-Column Reader View**:
   - `PDF2ObsidianPlugin extends Plugin`: Manages plugin lifecycle (`onload`, `onunload`), command palette registrations, ribbon icon (`book-open`), and file context menu integrations.
   - `AcademicReaderView extends ItemView`: Obsidian custom view type `pdf2obsidian-academic-reader` mounting a React 19 root (`createRoot(this.contentEl)`).
   - **Left Column (PDF Viewport)**: Canvas-rendered PDF pages with overlaid MinerU bounding boxes. Normalized MinerU coordinates (`0..1000`) scale directly to CSS percentages (`x / 10 %`), providing zoom-invariant, DPR-independent overlay positioning. Semantic categorization of blocks (title, body, equation, table, image, caption, footnote) and multi-page continuation link tracking (`continuationOf`).
   - **Right Column (Bilingual Viewport)**: Aligned bilingual text (Chinese/English) paired per section/paragraph, with KaTeX mathematical formula rendering (`remark-math` + `rehype-katex`), academic section hierarchy, and lazy viewport rendering.
   - **Synchronized Navigation**: Bi-directional click-to-locate and smooth scrolling between PDF bounding boxes and aligned bilingual paragraphs.
   - **Resizable Splitter**: Draggable split pane with pointer capture and persisted ratio.
3. **MinerU & LLM Import Pipeline with Vault Integration**:
   - **MinerU Integration**: Official Cloud API v4 batch upload/polling (`/api/v4/file-urls/batch`, OSS PUT upload, batch status polling, CDN/OSS zip download) and remote HTTP API (`/tasks`).
   - **LLM Processing**: OpenAI and DeepSeek (`deepseek-chat`, `deepseek-reasoner`) streaming/completion support, semantic chunking respecting markdown structure and math blocks, translation, and academic reading assets generation (`summary.md`, `terms.md`, `qa.md`).
   - **Vault Writer**: Official `app.vault` API integration (`create`, `modify`, `createBinary`, `modifyBinary`, recursive directory creation) outputting YAML frontmatter metadata, bidirectional wikilinks (`[[...]]`), and extracted image assets.

---

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| F1 | Monorepo Workspace Configuration | Establish `@pdf2obsidian/obsidian-plugin` under `apps/obsidian-plugin` in `pnpm-workspace.yaml` | M1 | R1, Survey 1 |
| F2 | Plugin Manifest Specification | Create valid `manifest.json` with `id`, `name`, `version`, `minAppVersion`, `description`, `isDesktopOnly: true` | M1 | R1, Survey 2 |
| F3 | esbuild CJS Bundler Setup | Configure esbuild targeting `format: 'cjs'`, `platform: 'browser'`, `target: 'es2022'`, with `external: ['obsidian', 'electron']` | M1 | R1, Survey 2 |
| F4 | Inlined PDF.js Worker via Blob URL | Inlining `pdf.worker.min.mjs` into `main.js` and creating worker URL via `URL.createObjectURL(new Blob(...))` | M1 | R1, Survey 2, Survey 3 |
| F5 | CSS & KaTeX Bundle Generation | Bundle reader CSS and KaTeX styling/fonts into `apps/obsidian-plugin/styles.css` | M1 | R1, Survey 2 |
| F6 | Monorepo Scripts Integration | Add typecheck, build, and test scripts to `apps/obsidian-plugin/package.json` and root `package.json` / `build-packages.mjs` | M1 | R4, Survey 1 |
| F7 | Plugin Class Lifecycle | Implement `Plugin` subclass with `onload()`, `onunload()`, leaf detach, and Blob URL revocation | M2 | R2, Survey 2 |
| F8 | Command Palette & Ribbon Integration | Register ribbon icon (`book-open`) and command palette command to open/focus reader view | M2 | R2, Survey 2 |
| F9 | Custom ItemView Implementation | Implement `ItemView` subclass (`AcademicReaderView`) hosting React 19 root lifecycle | M2 | R2, Survey 2, Survey 3 |
| F10 | Dual-Column Resizable Splitter | Split pane container with drag resizing, keyboard accessibility, and state persistence | M2 | R2, Survey 3 |
| F11 | PDF Viewport & Canvas Rendering | HiDPI PDF page rendering using `pdfjs-dist` with inlined worker | M2 | R2, Survey 3 |
| F12 | MinerU Bounding Box Overlays | Normalized `0..1000` coordinate mapping to CSS `x / 10 %`, role classification, and continuation block linking | M2 | R2, Survey 1, Survey 3 |
| F13 | Aligned Bilingual Text Presentation | Section- and paragraph-paired bilingual markdown display preserving code and math blocks | M2 | R2, Survey 1, Survey 3 |
| F14 | KaTeX Mathematical Formula Rendering | Full KaTeX formula rendering for inline (`$...$`) and display (`$$...$$`) math with error resilience | M2 | R2, Survey 3 |
| F15 | Bi-Directional Synchronized Navigation | Click PDF bbox -> scroll to bilingual paragraph; click bilingual paragraph -> scroll to PDF bbox | M2 | R2, Survey 3 |
| F16 | MinerU Client (Cloud v4 & Remote HTTP) | Cloud API v4 batch upload/polling and remote HTTP runner for paper extraction | M3 | R3, Survey 1, Survey 3 |
| F17 | LLM Translation & Reading Assets | OpenAI/DeepSeek translation and generation of `summary.md`, `terms.md`, `qa.md` | M3 | R3, Survey 1, Survey 3 |
| F18 | Vault Writer Engine (`app.vault`) | Safe idempotent creation/modification of notes and directories via `app.vault` APIs | M3 | R3, Survey 2, Survey 3 |
| F19 | YAML Frontmatter & Wikilink Formatting | Format structured frontmatter, bidirectional links (`[[...]]`), and image references (`![[...]]`) | M3 | R3, Survey 2, Survey 3 |
| F20 | Extracted Binary Assets Storage | Store extracted figures, tables, and source PDF into vault folders via `app.vault.createBinary` | M3 | R3, Survey 2, Survey 3 |
| F21 | Comprehensive Opaque-Box E2E Test Suite | 4-tier requirement-driven test suite with mock MinerU and LLM stubs published via `TEST_READY.md` | E2E Track | Verification Resources |
| F22 | Full E2E Test Suite Pass (Tiers 1-4) | Pass 100% of all E2E test cases across feature, boundary, combinatorial, and workflow tiers | Final (Phase 1) | Acceptance Criteria |
| F23 | Adversarial Coverage Hardening (Tier 5) | White-box challenger gap analysis and test coverage hardening | Final (Phase 2) | Dual Track Protocol |

---

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Plugin Package Setup & esbuild Build System | Package layout, manifest, esbuild configuration, PDF.js worker inlining, styles bundling, monorepo scripts (F1, F2, F3, F4, F5, F6) | none | DONE |
| M2 | Dual-Column Academic Paper Reader View | Plugin class, ItemView, Ribbon & Command palette, React 19 reader view, PDF canvas, bbox overlays, bilingual aligned KaTeX text, synchronized navigation (F7, F8, F9, F10, F11, F12, F13, F14, F15) | M1 | DONE |
| M3 | MinerU & LLM Import Pipeline with Vault Integration | MinerU API client, LLM translation/summary runner, app.vault note writer, YAML frontmatter, wikilinks, binary image storage (F16, F17, F18, F19, F20) | M1 | DONE |
| E2E | E2E Testing Track | Independent opaque-box test harness, mock datasets, 4-tier test cases, publishes TEST_READY.md (F21) | M1 (build ready) | DONE |
| Final | 100% E2E Pass & Coverage Hardening | Phase 1: 100% pass on Tiers 1-4. Phase 2: Adversarial white-box hardening (F22, F23) | M2, M3, E2E | DONE |

---

## Interface Contracts

### 1. Build Outputs ↔ Obsidian Plugin Loader
- `apps/obsidian-plugin/manifest.json`:
  ```json
  {
    "id": "pdf2obsidian",
    "name": "PDF2obsidian",
    "version": "0.1.0",
    "minAppVersion": "1.5.0",
    "description": "Academic paper dual-column reader with MinerU and LLM processing.",
    "author": "PDF2obsidian",
    "isDesktopOnly": true
  }
  ```
- `apps/obsidian-plugin/main.js`: CommonJS module exporting default class extending `obsidian.Plugin`.
- `apps/obsidian-plugin/styles.css`: Complete concatenated CSS for plugin UI and KaTeX formula styling.

### 2. PDF.js Worker Contract
- Inlined string loaded by esbuild loader.
- Runtime setup:
  ```ts
  export function initializePdfWorker(): string {
    const blob = new Blob([workerScriptText], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    pdfjsLib.GlobalWorkerOptions.workerSrc = url;
    return url;
  }
  ```

### 3. Coordinate Contract (MinerU ↔ PDF Viewport Overlay)
- Input: `bbox: [x0, y0, x1, y1]` with integers `0 <= x0 < x1 <= 1000`, `0 <= y0 < y1 <= 1000`.
- Position styles:
  - `left: ${x0 / 10}%`
  - `top: ${y0 / 10}%`
  - `width: ${(x1 - x0) / 10}%`
  - `height: ${(y1 - y0) / 10}%`

### 4. Reader Navigation Contract
- Shared state:
  ```ts
  export interface ReaderSelectionState {
    activeBlockId: string | null;
    source: 'pdf' | 'markdown' | null;
    sequence: number;
  }
  ```
- Selection updates trigger `scrollIntoView({ behavior: 'smooth', block: 'center' })` on corresponding elements.

### 5. Vault Writer Contract
- `ensureVaultDirectory(vault: Vault, folderPath: string): Promise<void>`
- `writeVaultNote(vault: Vault, path: string, content: string): Promise<TFile>`
- `writeVaultBinary(vault: Vault, path: string, data: ArrayBuffer): Promise<TFile>`
- Generated note frontmatter adheres to `PaperMetadata` serialized into YAML.

---

## Code Layout
```
apps/obsidian-plugin/
├── package.json
├── tsconfig.json
├── manifest.json
├── esbuild.config.mjs
├── main.js                          (Build output)
├── styles.css                       (Build output)
├── styles/
│   └── styles.css                   (Source CSS)
├── src/
│   ├── main.ts                      (Plugin entry point)
│   ├── view/
│   │   ├── AcademicReaderView.ts    (ItemView subclass)
│   │   └── components/
│   │       ├── AcademicReaderRoot.tsx
│   │       ├── PdfViewport.tsx
│   │       ├── BilingualColumn.tsx
│   │       ├── Splitter.tsx
│   │       └── BboxOverlay.tsx
│   ├── pipeline/
│   │   ├── mineru-client.ts
│   │   ├── llm-client.ts
│   │   ├── vault-writer.ts
│   │   └── import-adapter.ts
│   └── utils/
│       ├── pdf-worker.ts
│       ├── coordinates.ts
│       └── bilingual.ts
└── tests/
    ├── mocks/
    │   ├── mock-vault.ts
    │   └── mock-data.ts
    ├── tier1-feature.test.mjs
    ├── tier2-boundary.test.mjs
    ├── tier3-combination.test.mjs
    ├── tier4-application.test.mjs
    ├── tier5-adversarial-pipeline.test.mjs
    └── tier5-adversarial-view.test.mjs
```
