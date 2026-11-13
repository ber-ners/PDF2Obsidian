# PDF2obsidian Obsidian Native Plugin — Test Infrastructure & Philosophy

## 1. Test Philosophy & Design Principles

The testing track for `@pdf2obsidian/obsidian-plugin` adheres to four foundational principles:

1. **Opaque-Box & Requirement-Driven**:
   - Test cases are derived strictly from authoritative specifications (`ORIGINAL_REQUEST.md`, `PROJECT.md`, and architectural survey reports), not from implementation internals.
   - Tests assert observable behavior, interface contracts, error envelopes, and persistent artifacts.
2. **Headless & Zero-Desktop Execution (Progressive Testability)**:
   - The test harness runs under standard Node.js (`node:test` + `node:assert/strict`) without requiring an active Obsidian Electron desktop window, display server, or live network API keys.
   - Comprehensive headless mocks (`MockVault`, `MockWorkspaceLeaf`, `MockWorkspace`, `MockApp`, `MockMineruCloudServer`, `MockLlmServer`) provide 100% fidelity to Obsidian's runtime contracts.
3. **Four-Tier Defense-in-Depth Architecture**:
   - **Tier 1 (Feature Coverage)**: Isolated contract verification for each of the 20 features (F1 through F20), with $\ge 5$ distinct test cases per feature (minimum 100 test cases).
   - **Tier 2 (Boundary & Corner Cases)**: Extreme values, inverted bounds, coordinate clamping, malformed archives, syntax errors, and resource constraints ($\ge 5$ test cases per feature, minimum 100 test cases).
   - **Tier 3 (Cross-Feature Combinations)**: Multi-module interactions (e.g., MinerU cloud extraction $\leftrightarrow$ Vault binary write, Bbox selection $\leftrightarrow$ Bilingual scroll sync, LLM chunking $\leftrightarrow$ YAML frontmatter generation).
   - **Tier 4 (Real-World Application Scenarios)**: Complete end-to-end user workflows on realistic academic papers (arXiv Transformer paper, bilingual reading sessions, vault asset tree integrity).
4. **Deterministic & Fast Execution**:
   - Zero flaky timing loops or unhandled asynchronous background leaks.
   - Full suite execution completes in under 5 seconds on modern Node runtimes.

---

## 2. Directory Layout & Organization

All test assets, mocks, fixtures, and tier test suites are strictly isolated under `apps/obsidian-plugin/tests/`:

```
apps/obsidian-plugin/tests/
├── mocks/
│   ├── index.mjs            # Consolidated mock exports
│   ├── obsidian.mjs         # MockVault, MockWorkspaceLeaf, MockApp, MockPlugin, MockItemView
│   ├── mineru.mjs           # Synthetic content_list generator, mock ZIP builder, Cloud API v4 & HTTP server stubs
│   ├── llm.mjs              # OpenAI & DeepSeek completion mocks (translation, summary, terms, Q&A)
│   └── contracts.mjs        # Authoritative contract validation logic, geometry, bilingual pairing, vault writing
├── fixtures/
│   ├── sample-content-list.json # Sample MinerU layout block fixture
│   └── sample-paper.md          # Sample academic markdown fixture
├── tier1-feature.test.mjs   # Tier 1: 100+ tests covering F1..F20 in isolation
├── tier2-boundary.test.mjs  # Tier 2: 100+ tests covering boundaries and edge cases
├── tier3-combination.test.mjs # Tier 3: Pairwise cross-feature interactions
└── tier4-application.test.mjs # Tier 4: Real-world academic paper E2E workflows
```

---

## 3. Headless Mock Harness Architecture

### 3.1. Mock Obsidian Vault API (`MockVault`)
The in-memory vault manages POSIX-compliant paths and mirrors official Obsidian file lifecycle semantics:
- `create(path, data)`: Creates text files; throws if target already exists or parent directory is missing.
- `modify(file, data)`: Modifies existing files; throws if file does not exist.
- `createBinary(path, data)`: Accepts `ArrayBuffer` or `Uint8Array`; enforces binary storage contracts.
- `modifyBinary(file, data)`: Safely updates binary buffers.
- `read(file)` / `readBinary(file)`: Transparent decoding/encoding between strings and ArrayBuffers.
- `createFolder(path)`: Recursive directory creation; throws on duplicate or missing parent.
- `getAbstractFileByPath(path)`: Resolves `MockTFile` or `MockTFolder` with accurate names and extensions.

### 3.2. Mock Workspace & Leaf (`MockWorkspaceLeaf`, `MockWorkspace`)
- Manages view state (`setViewState`, `getViewState`), tab lifecycle, and active view focusing.
- Implements `detachLeavesOfType(viewType)` to verify clean tab closing during plugin unloading without zombie tab leaks.

### 3.3. Synthetic MinerU Datasets & ZIP Generator
- Produces realistic `content_list.json` data ranging from 0 to 1,000+ layout blocks.
- Covers all semantic roles (`title`, `body`, `equation`, `table`, `image`, `caption`, `footnote`, `reference`).
- Generates valid ZIP archives via `fflate` containing Markdown, metadata JSON, and binary PNG figures.
- `MockMineruCloudServer` emulates batch registration (`/api/v4/file-urls/batch`), OSS binary upload, status polling, and CDN failover.

### 3.4. Mock LLM Server (`MockLlmServer`)
- Supports OpenAI and DeepSeek chat completion specifications (`/chat/completions`).
- Generates high-quality responses for academic translation (1:1 paragraph alignment, LaTeX/code preservation), executive summaries (`summary.md`), terminology glossaries (`terms.md`), and in-depth Q&A (`qa.md`).
- Simulates network timeouts, authentication rejections, 429 rate limits, and token context limits.

---

## 4. Test Thresholds & Quality Gates

| Gate Metric | Requirement | Target Status |
| :--- | :--- | :--- |
| **Tier 1 (Feature Coverage)** | $\ge 5$ tests per feature across F1..F20 | $\ge 100$ tests passing |
| **Tier 2 (Boundary Cases)** | $\ge 5$ tests per feature across F1..F20 | $\ge 100$ tests passing |
| **Tier 3 (Combinations)** | Pairwise interactions across core pipeline & view | $\ge 15$ tests passing |
| **Tier 4 (Scenarios)** | Full paper import & dual-column reading workflows | $\ge 5$ tests passing |
| **Pass Rate** | 100% passing; zero skips or unhandled errors | 100% Clean Pass |
| **Execution Command** | `node --test apps/obsidian-plugin/tests/*.test.mjs` | Sub-5s runtime |

---

## 5. Verification Commands

Run all plugin test tiers:
```bash
node --test apps/obsidian-plugin/tests/*.test.mjs
```

Run specific test tier:
```bash
node --test apps/obsidian-plugin/tests/tier1-feature.test.mjs
node --test apps/obsidian-plugin/tests/tier2-boundary.test.mjs
node --test apps/obsidian-plugin/tests/tier3-combination.test.mjs
node --test apps/obsidian-plugin/tests/tier4-application.test.mjs
```
