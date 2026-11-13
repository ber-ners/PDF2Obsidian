import { Plugin, TFile, WorkspaceLeaf, Notice } from 'obsidian';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerCode from 'inline-pdfjs-worker';
import { AcademicReaderView, VIEW_TYPE_ACADEMIC_READER } from './view/AcademicReaderView';
import { PDF2ObsidianSettingTab, PDF2ObsidianSettings, DEFAULT_SETTINGS } from './settings';
import { importPaper } from './pipeline/import-adapter';
import '../styles/styles.css';

export { VIEW_TYPE_ACADEMIC_READER, AcademicReaderView };

/**
 * Global or module-level worker blob URL cache.
 */
let currentWorkerBlobUrl: string | null = null;

/**
 * Initializes the PDF.js Web Worker using an in-memory Blob URL created from
 * the inlined worker script string. Returns the created Blob URL.
 */
export function initializePdfWorker(): string {
  if (currentWorkerBlobUrl) {
    return currentWorkerBlobUrl;
  }
  currentWorkerBlobUrl = URL.createObjectURL(new Blob([pdfWorkerCode], { type: 'application/javascript' }));
  pdfjsLib.GlobalWorkerOptions.workerSrc = currentWorkerBlobUrl;
  return currentWorkerBlobUrl;
}

/**
 * Revokes the active PDF.js worker Blob URL to release allocated memory.
 */
export function cleanupPdfWorker(): void {
  if (currentWorkerBlobUrl) {
    URL.revokeObjectURL(currentWorkerBlobUrl);
    currentWorkerBlobUrl = null;
  }
}

/**
 * PDF2obsidian Obsidian Native Plugin entry point.
 */
export default class PDF2ObsidianPlugin extends Plugin {
  private workerBlobUrl: string | null = null;
  public settings: PDF2ObsidianSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    console.log('[PDF2obsidian] Initializing plugin...');

    // 0. Load user settings
    await this.loadSettings();

    // 1. Initialize PDF.js worker with inlined Blob URL
    try {
      this.workerBlobUrl = initializePdfWorker();
      console.log('[PDF2obsidian] PDF.js worker initialized via Blob URL');
    } catch (err) {
      console.error('[PDF2obsidian] Failed to initialize PDF.js worker:', err);
    }

    // 2. Register Custom Academic Reader ItemView
    if (typeof this.registerView === 'function') {
      this.registerView(
        VIEW_TYPE_ACADEMIC_READER,
        (leaf: WorkspaceLeaf) => new AcademicReaderView(leaf, this)
      );
    }

    // 3. Register Settings Tab
    if (typeof this.addSettingTab === 'function') {
      this.addSettingTab(new PDF2ObsidianSettingTab(this.app, this));
    }

    // 4. Register Left Ribbon Icon
    if (typeof this.addRibbonIcon === 'function') {
      this.addRibbonIcon('book-open', '打开 PDF2obsidian 学术双栏阅读器', () => {
        this.activateReaderView();
      });
    }

    // 5. Register Command Palette Commands
    if (typeof this.addCommand === 'function') {
      this.addCommand({
        id: 'open-dual-column-reader',
        name: '打开学术双栏阅读器 (Open Dual-Column Academic Reader)',
        callback: () => {
          this.activateReaderView();
        }
      });

      this.addCommand({
        id: 'parse-active-paper',
        name: '一键解析当前选中的 PDF 论文 (Parse Active PDF Paper)',
        checkCallback: (checking: boolean) => {
          const active = this.app?.workspace?.getActiveFile?.();
          if (active && active.extension === 'pdf') {
            if (!checking) {
              void this.parseAndOpenPaper(active);
            }
            return true;
          }
          return false;
        }
      });
    }

    // 6. Register File Explorer Context Menu
    if (typeof this.registerEvent === 'function') {
      this.registerEvent(
        this.app.workspace.on('file-menu', (menu, file) => {
          if (file instanceof TFile) {
            if (file.extension === 'pdf') {
              menu.addItem((item) => {
                item
                  .setTitle('PDF2obsidian: 🚀 一键解析并生成双语笔记')
                  .setIcon('sparkles')
                  .onClick(() => {
                    void this.parseAndOpenPaper(file);
                  });
              });

              menu.addItem((item) => {
                item
                  .setTitle('PDF2obsidian: 打开学术双栏阅读器')
                  .setIcon('book-open')
                  .onClick(() => {
                    this.activateReaderView(file);
                  });
              });
            } else if (file.name.endsWith('.bilingual.md') || file.name.endsWith('.index.md')) {
              menu.addItem((item) => {
                item
                  .setTitle('PDF2obsidian: 打开学术双栏阅读器')
                  .setIcon('book-open')
                  .onClick(() => {
                    this.activateReaderView(file);
                  });
              });
            }
          }
        })
      );
    }

    console.log('[PDF2obsidian] Plugin loaded successfully');
  }

  onunload(): void {
    console.log('[PDF2obsidian] Unloading plugin...');

    // 1. Detach all open reader leaves to prevent zombie tabs
    if (typeof this.app?.workspace?.detachLeavesOfType === 'function') {
      this.app.workspace.detachLeavesOfType(VIEW_TYPE_ACADEMIC_READER);
    }

    // 2. Clean up worker Blob URL to prevent memory leaks
    if (this.workerBlobUrl) {
      cleanupPdfWorker();
      this.workerBlobUrl = null;
    }

    console.log('[PDF2obsidian] Plugin unloaded');
  }

  async loadSettings(): Promise<void> {
    if (typeof this.loadData === 'function') {
      try {
        const loaded = await this.loadData();
        this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);
      } catch (err) {
        console.warn('[PDF2obsidian] Failed to load data, using default settings:', err);
      }
    }
  }

  async saveSettings(): Promise<void> {
    if (typeof this.saveData === 'function') {
      await this.saveData(this.settings);
    }
  }

  /**
   * Runs the full MinerU extraction + LLM translation pipeline on a target PDF file,
   * writes the complete 6 notes & assets to the Vault, and opens the reader view.
   */
  async parseAndOpenPaper(
    file: TFile,
    onProgressUpdate?: (message: string, progress: number) => void
  ): Promise<void> {
    if (!this.settings.mineruToken) {
      if (typeof Notice !== 'undefined') {
        new Notice('⚠️ 请先在插件设置中配置 MinerU API Token！');
      }
      return;
    }

    if (typeof Notice !== 'undefined') {
      new Notice(`🚀 开始解析论文: ${file.basename}`);
    }

    try {
      const pdfBuffer = await this.app.vault.readBinary(file);
      const targetFolder = file.parent ? file.parent.path : this.settings.targetFolder;

      onProgressUpdate?.('正在向 MinerU 提交版面解析任务...', 0.1);

      const result = await importPaper({
        vault: this.app.vault,
        pdfData: pdfBuffer,
        pdfFileName: file.name,
        targetFolder: targetFolder || 'Papers',
        mineruConfig: {
          cloudApiToken: this.settings.mineruToken,
          modelVersion: this.settings.mineruModel
        },
        llmConfig: {
          apiKey: this.settings.llmApiKey,
          baseUrl: this.settings.llmBaseUrl,
          model: this.settings.llmModel,
          provider: 'openai-compatible'
        },
        onProgress: (status, pct) => {
          onProgressUpdate?.(status, typeof pct === 'number' ? pct / 100 : 0.5);
        }
      });

      onProgressUpdate?.('解析完成！', 1.0);

      if (typeof Notice !== 'undefined') {
        new Notice(`🎉 论文解析成功！已生成精读笔记。`);
      }

      // Open the reader view on the newly created bilingual note or original PDF
      if (result.bilingualFile instanceof TFile) {
        await this.activateReaderView(result.bilingualFile);
      } else {
        await this.activateReaderView(file);
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error('[PDF2obsidian] Error during parseAndOpenPaper:', err);
      if (typeof Notice !== 'undefined') {
        new Notice(`❌ 论文解析失败: ${errorMsg}`);
      }
      throw err;
    }
  }

  /**
   * Activates or reveals the Academic Paper Reader view.
   */
  async activateReaderView(file?: TFile): Promise<WorkspaceLeaf | null> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = null;
    const leaves = workspace.getLeavesOfType(VIEW_TYPE_ACADEMIC_READER);

    if (leaves.length > 0) {
      leaf = leaves[0];
    } else {
      leaf = workspace.getLeaf(true);
      await leaf.setViewState({
        type: VIEW_TYPE_ACADEMIC_READER,
        active: true
      });
    }

    if (leaf) {
      workspace.revealLeaf(leaf);

      const targetFile = file || workspace.getActiveFile();
      if (
        targetFile &&
        (targetFile.extension === 'pdf' ||
          targetFile.name.endsWith('.bilingual.md') ||
          targetFile.name.endsWith('.index.md'))
      ) {
        if (leaf.view && 'setFile' in leaf.view) {
          await (leaf.view as { setFile: (f: TFile) => Promise<void> }).setFile(targetFile);
        }
      }
    }

    return leaf;
  }
}
