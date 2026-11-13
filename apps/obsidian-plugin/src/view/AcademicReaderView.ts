import * as obsidian from 'obsidian';
import type { WorkspaceLeaf, TFile, IconName } from 'obsidian';
import { createRoot, type Root } from 'react-dom/client';
import React from 'react';
import { AcademicReaderRoot } from './components/AcademicReaderRoot';

export const VIEW_TYPE_ACADEMIC_READER = 'pdf2obsidian-academic-reader';

// Guard against minimal mocks in unit tests where ItemView is omitted from obsidian mock
const BaseItemView: abstract new (leaf: WorkspaceLeaf) => obsidian.ItemView =
  ((obsidian as unknown as { ItemView?: abstract new (leaf: WorkspaceLeaf) => obsidian.ItemView }).ItemView ||
  (class {
    leaf: WorkspaceLeaf;
    contentEl: HTMLElement;
    app: obsidian.App;
    constructor(leaf: WorkspaceLeaf) {
      this.leaf = leaf;
      this.contentEl = (leaf as unknown as { containerEl?: HTMLElement })?.containerEl || ({} as HTMLElement);
      this.app = (leaf as unknown as { app?: obsidian.App })?.app || ({} as obsidian.App);
    }
  })) as unknown as abstract new (leaf: WorkspaceLeaf) => obsidian.ItemView;

/**
 * AcademicReaderView is the custom ItemView hosting the React 19 Dual-Column
 * Academic Paper Reader within Obsidian workspace leaves.
 */
export class AcademicReaderView extends BaseItemView {
  private root: Root | null = null;
  public currentFile: TFile | null = null;
  public plugin?: any;

  constructor(leaf: WorkspaceLeaf, plugin?: any) {
    super(leaf);
    this.plugin = plugin;
  }

  /**
   * Unique view type identifier conforming to Obsidian ItemView API.
   */
  getViewType(): string {
    return VIEW_TYPE_ACADEMIC_READER;
  }

  /**
   * Title displayed in tab header and pane title.
   */
  getDisplayText(): string {
    return this.currentFile ? `Reader: ${this.currentFile.basename}` : 'Academic Paper Reader';
  }

  /**
   * Lucide icon displayed on the tab header.
   */
  getIcon(): IconName {
    return 'book-open';
  }

  /**
   * Indicates whether the React 19 root is currently mounted.
   */
  get isRootMounted(): boolean {
    return this.root !== null;
  }

  /**
   * Mounts the React 19 root into this.contentEl on view opening.
   */
  async onOpen(): Promise<void> {
    const container = this.contentEl;
    container.empty();
    container.addClass('pdf2obsidian-reader-container');

    this.root = createRoot(container);
    this.render();
  }

  /**
   * Cleanly unmounts React 19 root and releases DOM nodes on view closing.
   */
  async onClose(): Promise<void> {
    if (this.root) {
      this.root.unmount();
      this.root = null;
    }
    this.contentEl.empty();
  }

  /**
   * Updates the active file being displayed in the reader view.
   */
  async setFile(file: TFile | null): Promise<void> {
    this.currentFile = file;
    this.render();
  }

  /**
   * Renders the React root with current state.
   */
  private render(): void {
    if (!this.root) return;

    this.root.render(
      React.createElement(AcademicReaderRoot, {
        app: this.app,
        leaf: this.leaf,
        file: this.currentFile,
        plugin: this.plugin,
        onClose: () => this.leaf.detach()
      })
    );
  }
}
