/**
 * Mock Obsidian API environment for headless testing.
 * Implements Vault, Workspace, WorkspaceLeaf, App, Plugin, and ItemView contracts.
 */

export class MockTFile {
  constructor(path, name, basename, extension) {
    this.path = path;
    this.name = name;
    this.basename = basename;
    this.extension = extension;
    this.stat = {
      ctime: Date.now(),
      mtime: Date.now(),
      size: 0
    };
  }
}

export class MockTFolder {
  constructor(path, name) {
    this.path = path;
    this.name = name;
    this.children = [];
  }
}

export class MockVault {
  constructor() {
    /** @type {Map<string, { type: 'file' | 'folder', data: string | ArrayBuffer, mtime: number }>} */
    this.entries = new Map();
    // Root folder exists implicitly
    this.entries.set('', { type: 'folder', data: '', mtime: Date.now() });
  }

  _normalizePath(rawPath) {
    if (typeof rawPath !== 'string') {
      throw new Error(`Invalid path: expected string, got ${typeof rawPath}`);
    }
    // Convert backslashes to forward slashes, collapse consecutive slashes, and remove leading/trailing slashes
    return rawPath.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  }

  _getParentPath(path) {
    const idx = path.lastIndexOf('/');
    return idx >= 0 ? path.slice(0, idx) : '';
  }

  _createTFile(path, size = 0) {
    const name = path.split('/').pop() || path;
    const dotIdx = name.lastIndexOf('.');
    const basename = dotIdx > 0 ? name.slice(0, dotIdx) : name;
    const extension = dotIdx > 0 ? name.slice(dotIdx + 1) : '';
    const file = new MockTFile(path, name, basename, extension);
    file.stat.size = size;
    return file;
  }

  async create(path, data) {
    const norm = this._normalizePath(path);
    if (this.entries.has(norm)) {
      throw new Error(`File already exists: ${norm}`);
    }
    const parent = this._getParentPath(norm);
    if (parent && !this.entries.has(parent)) {
      throw new Error(`Parent folder does not exist: ${parent}`);
    }
    const textData = typeof data === 'string' ? data : String(data);
    this.entries.set(norm, {
      type: 'file',
      data: textData,
      mtime: Date.now()
    });
    return this._createTFile(norm, textData.length);
  }

  async modify(file, data) {
    const norm = this._normalizePath(file.path || file);
    const existing = this.entries.get(norm);
    if (!existing || existing.type !== 'file') {
      throw new Error(`File does not exist: ${norm}`);
    }
    const textData = typeof data === 'string' ? data : String(data);
    existing.data = textData;
    existing.mtime = Date.now();
    return this._createTFile(norm, textData.length);
  }

  async createBinary(path, data) {
    const norm = this._normalizePath(path);
    if (this.entries.has(norm)) {
      throw new Error(`File already exists: ${norm}`);
    }
    const parent = this._getParentPath(norm);
    if (parent && !this.entries.has(parent)) {
      throw new Error(`Parent folder does not exist: ${parent}`);
    }
    let ab;
    if (data instanceof ArrayBuffer) {
      ab = data;
    } else if (ArrayBuffer.isView(data)) {
      ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    } else {
      throw new TypeError(`Expected ArrayBuffer or TypedArray, got ${typeof data}`);
    }
    this.entries.set(norm, {
      type: 'file',
      data: ab,
      mtime: Date.now()
    });
    return this._createTFile(norm, ab.byteLength);
  }

  async modifyBinary(file, data) {
    const norm = this._normalizePath(file.path || file);
    const existing = this.entries.get(norm);
    if (!existing || existing.type !== 'file') {
      throw new Error(`File does not exist: ${norm}`);
    }
    let ab;
    if (data instanceof ArrayBuffer) {
      ab = data;
    } else if (ArrayBuffer.isView(data)) {
      ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    } else {
      throw new TypeError(`Expected ArrayBuffer or TypedArray, got ${typeof data}`);
    }
    existing.data = ab;
    existing.mtime = Date.now();
  }

  async read(file) {
    const norm = this._normalizePath(file.path || file);
    const existing = this.entries.get(norm);
    if (!existing) {
      throw new Error(`File does not exist: ${norm}`);
    }
    if (typeof existing.data === 'string') {
      return existing.data;
    }
    // If stored as ArrayBuffer, decode as UTF-8
    return new TextDecoder().decode(existing.data);
  }

  async readBinary(file) {
    const norm = this._normalizePath(file.path || file);
    const existing = this.entries.get(norm);
    if (!existing) {
      throw new Error(`File does not exist: ${norm}`);
    }
    if (existing.data instanceof ArrayBuffer) {
      return existing.data;
    }
    // If stored as string, encode as UTF-8 ArrayBuffer
    return new TextEncoder().encode(existing.data).buffer;
  }

  async createFolder(path) {
    const norm = this._normalizePath(path);
    if (this.entries.has(norm)) {
      throw new Error(`Folder already exists: ${norm}`);
    }
    const parent = this._getParentPath(norm);
    if (parent && !this.entries.has(parent)) {
      throw new Error(`Parent folder does not exist: ${parent}`);
    }
    this.entries.set(norm, {
      type: 'folder',
      data: '',
      mtime: Date.now()
    });
  }

  async delete(file, force = false) {
    const norm = this._normalizePath(file.path || file);
    if (!this.entries.has(norm)) {
      throw new Error(`File or folder not found: ${norm}`);
    }
    const entry = this.entries.get(norm);
    if (entry.type === 'folder' && !force) {
      // Check if directory has children
      for (const k of this.entries.keys()) {
        if (k !== norm && k.startsWith(`${norm}/`)) {
          throw new Error(`Folder not empty: ${norm}`);
        }
      }
    }
    // Delete target and any child entries if force is true
    for (const k of Array.from(this.entries.keys())) {
      if (k === norm || (force && k.startsWith(`${norm}/`))) {
        this.entries.delete(k);
      }
    }
  }

  getAbstractFileByPath(path) {
    const norm = this._normalizePath(path);
    const entry = this.entries.get(norm);
    if (!entry) return null;
    if (entry.type === 'folder') {
      const folder = new MockTFolder(norm, norm.split('/').pop() || norm);
      // populate children
      for (const [k, v] of this.entries.entries()) {
        if (k && this._getParentPath(k) === norm) {
          if (v.type === 'folder') {
            folder.children.push(new MockTFolder(k, k.split('/').pop() || k));
          } else {
            folder.children.push(this._createTFile(k, v.data.byteLength || v.data.length || 0));
          }
        }
      }
      return folder;
    }
    const size = entry.data instanceof ArrayBuffer ? entry.data.byteLength : (entry.data.length || 0);
    return this._createTFile(norm, size);
  }

  getAllLoadedFiles() {
    const list = [];
    for (const [k, v] of this.entries.entries()) {
      if (!k) continue;
      if (v.type === 'folder') {
        list.push(new MockTFolder(k, k.split('/').pop() || k));
      } else {
        const size = v.data instanceof ArrayBuffer ? v.data.byteLength : (v.data.length || 0);
        list.push(this._createTFile(k, size));
      }
    }
    return list;
  }

  getFiles() {
    return this.getAllLoadedFiles().filter((f) => f instanceof MockTFile);
  }
}

export class MockWorkspaceLeaf {
  constructor(workspace) {
    this.workspace = workspace;
    this.view = null;
    this.viewState = { type: 'empty', active: false, state: {} };
    this.isDetached = false;
  }

  async setViewState(state) {
    this.viewState = { ...this.viewState, ...state };
    if (state.type && this.workspace.app) {
      const creator = this.workspace.viewCreators.get(state.type);
      if (creator) {
        this.view = creator(this);
        if (this.view && typeof this.view.onOpen === 'function') {
          await this.view.onOpen();
        }
      }
    }
  }

  getViewState() {
    return this.viewState;
  }

  async openFile(file) {
    if (this.view && typeof this.view.setFile === 'function') {
      await this.view.setFile(file);
    }
  }

  detach() {
    this.isDetached = true;
    if (this.view && typeof this.view.onClose === 'function') {
      this.view.onClose();
    }
    this.workspace.leaves = this.workspace.leaves.filter((l) => l !== this);
  }
}

export class MockWorkspace {
  constructor(app) {
    this.app = app;
    /** @type {MockWorkspaceLeaf[]} */
    this.leaves = [];
    /** @type {MockWorkspaceLeaf | null} */
    this.activeLeaf = null;
    /** @type {Map<string, (leaf: MockWorkspaceLeaf) => any>} */
    this.viewCreators = new Map();
    /** @type {Map<string, Function[]>} */
    this.listeners = new Map();
  }

  registerViewCreator(viewType, creator) {
    this.viewCreators.set(viewType, creator);
  }

  getLeavesOfType(viewType) {
    return this.leaves.filter((l) => !l.isDetached && l.viewState.type === viewType);
  }

  getLeaf(createTab = true) {
    const leaf = new MockWorkspaceLeaf(this);
    this.leaves.push(leaf);
    this.activeLeaf = leaf;
    return leaf;
  }

  getActiveFile() {
    return this.activeLeaf?.view?.file || this.activeLeaf?.view?.currentFile || null;
  }

  revealLeaf(leaf) {
    this.activeLeaf = leaf;
  }

  detachLeavesOfType(viewType) {
    const toDetach = this.getLeavesOfType(viewType);
    for (const leaf of toDetach) {
      leaf.detach();
    }
  }

  on(eventName, callback) {
    if (!this.listeners.has(eventName)) {
      const arr = [];
      const fn = (...args) => {
        for (const cb of [...arr]) {
          cb(...args);
        }
      };
      fn.push = (...items) => arr.push(...items);
      fn.indexOf = (item) => arr.indexOf(item);
      fn.splice = (...args) => arr.splice(...args);
      Object.defineProperty(fn, 'length', {
        get: () => arr.length
      });
      fn[Symbol.iterator] = () => arr[Symbol.iterator]();
      this.listeners.set(eventName, fn);
    }
    const handlers = this.listeners.get(eventName);
    handlers.push(callback);
    return {
      detach: () => {
        const idx = handlers.indexOf(callback);
        if (idx >= 0) handlers.splice(idx, 1);
      }
    };
  }

  trigger(eventName, ...args) {
    const callbacks = this.listeners.get(eventName);
    if (typeof callbacks === 'function') {
      callbacks(...args);
    }
  }
}

export class MockApp {
  constructor() {
    this.vault = new MockVault();
    this.workspace = new MockWorkspace(this);
  }
}

export class PluginCommandsMap extends Map {
  constructor(manifestId) {
    super();
    this.manifestId = manifestId;
  }
  has(key) {
    if (super.has(key)) return true;
    if (this.manifestId && typeof key === 'string' && key.startsWith(`${this.manifestId}:`)) {
      return super.has(key.slice(this.manifestId.length + 1));
    }
    return false;
  }
  get(key) {
    if (super.has(key)) return super.get(key);
    if (this.manifestId && typeof key === 'string' && key.startsWith(`${this.manifestId}:`)) {
      return super.get(key.slice(this.manifestId.length + 1));
    }
    return undefined;
  }
}

export class MockPlugin {
  constructor(app, manifest) {
    this.app = app;
    this.manifest = manifest || {
      id: 'pdf2obsidian',
      name: 'PDF2obsidian Paper Reader',
      version: '0.1.0'
    };
    this.ribbonIcons = [];
    this.commands = new PluginCommandsMap(this.manifest?.id);
    this.registeredEvents = [];
    this.loaded = false;
  }

  registerView(viewType, viewCreator) {
    this.app.workspace.registerViewCreator(viewType, viewCreator);
  }

  addRibbonIcon(icon, title, callback) {
    const item = { icon, title, callback };
    this.ribbonIcons.push(item);
    return item;
  }

  addCommand(command) {
    if (!command.id || !command.name) {
      throw new Error('Command requires id and name');
    }
    this.commands.set(command.id, command);
    return command;
  }

  registerEvent(eventRef) {
    this.registeredEvents.push(eventRef);
  }

  async onload() {
    this.loaded = true;
  }

  onunload() {
    this.loaded = false;
    for (const ev of this.registeredEvents) {
      if (ev && typeof ev.detach === 'function') {
        ev.detach();
      }
    }
    this.registeredEvents = [];
    this.commands.clear();
    this.ribbonIcons = [];
  }
}

import { createRequire } from 'node:module';

// Configure headless DOM globals needed by React 19 root lifecycle
class MockNode {}
class MockElement extends MockNode {}
class MockText extends MockNode {}
class MockHTMLIFrameElement extends MockElement {}

if (!globalThis.Node) globalThis.Node = MockNode;
if (!globalThis.Element) globalThis.Element = MockElement;
if (!globalThis.Text) globalThis.Text = MockText;
if (!globalThis.HTMLIFrameElement) globalThis.HTMLIFrameElement = MockHTMLIFrameElement;

export class MockDomElement extends MockElement {
  constructor(tagName = 'div') {
    super();
    this.tagName = tagName.toUpperCase();
    this.nodeType = 1;
    this.children = [];
    this.childNodes = [];
    this.className = '';
    this.style = {};
    this.ownerDocument = globalThis.document;
  }
  empty() {
    this.children = [];
    this.childNodes = [];
  }
  addClass(cls) {
    this.className = `${this.className} ${cls}`.trim();
  }
  addEventListener() {}
  removeEventListener() {}
  appendChild(child) {
    this.children.push(child);
    this.childNodes.push(child);
    return child;
  }
  removeChild(child) {
    this.children = this.children.filter((c) => c !== child);
    this.childNodes = this.childNodes.filter((c) => c !== child);
    return child;
  }
  insertBefore(child) {
    this.children.unshift(child);
    this.childNodes.unshift(child);
    return child;
  }
  setAttribute() {}
  getAttribute() {
    return null;
  }
}

const mockDoc = {
  nodeType: 9,
  createElement(tag) {
    return new MockDomElement(tag);
  },
  createElementNS(_ns, tag) {
    return new MockDomElement(tag);
  },
  createTextNode(text) {
    const t = new MockText();
    t.nodeType = 3;
    t.textContent = text;
    return t;
  },
  defaultView: globalThis,
  addEventListener() {},
  removeEventListener() {}
};

if (!globalThis.document) globalThis.document = mockDoc;
if (!globalThis.window) globalThis.window = globalThis;

export class MockItemView {
  constructor(leaf) {
    this.leaf = leaf || null;
    this.app = leaf?.workspace?.app || null;
    this.contentEl = new MockDomElement('div');
  }

  getViewType() {
    return 'view';
  }

  getDisplayText() {
    return 'View';
  }

  getIcon() {
    return 'document';
  }

  async onOpen() {}

  async onClose() {}
}

export class MockNotice {
  constructor(message, duration) {
    this.message = message;
    this.duration = duration;
  }
  setMessage(msg) {
    this.message = msg;
  }
  hide() {}
}

export class MockPluginSettingTab {
  constructor(app, plugin) {
    this.app = app;
    this.plugin = plugin;
    this.containerEl = new MockDomElement('div');
  }
  display() {}
  hide() {}
}

export class MockSetting {
  constructor(containerEl) {
    this.settingEl = containerEl;
  }
  setName() { return this; }
  setDesc() { return this; }
  addDropdown(cb) {
    const d = { addOption: () => d, setValue: () => d, onChange: () => d };
    cb(d);
    return this;
  }
  addText(cb) {
    const t = { setPlaceholder: () => t, setValue: () => t, onChange: () => t, inputEl: {} };
    cb(t);
    return this;
  }
  addToggle(cb) {
    const tog = { setValue: () => tog, onChange: () => tog };
    cb(tog);
    return this;
  }
}

export const Plugin = MockPlugin;
export const ItemView = MockItemView;
export const TFile = MockTFile;
export const TFolder = MockTFolder;
export const Vault = MockVault;
export const Workspace = MockWorkspace;
export const WorkspaceLeaf = MockWorkspaceLeaf;
export const App = MockApp;
export const Notice = MockNotice;
export const PluginSettingTab = MockPluginSettingTab;
export const Setting = MockSetting;

/**
 * Loads the compiled production plugin bundle main.js with Obsidian mocks injected into Module._cache.
 */
export function loadProductionPlugin() {
  const req = createRequire(import.meta.url);
  const Module = req('node:module');

  const fullMock = {
    Plugin: MockPlugin,
    ItemView: MockItemView,
    TFile: MockTFile,
    TFolder: MockTFolder,
    Vault: MockVault,
    Workspace: MockWorkspace,
    WorkspaceLeaf: MockWorkspaceLeaf,
    App: MockApp,
    Notice: MockNotice,
    PluginSettingTab: MockPluginSettingTab,
    Setting: MockSetting,
    MockPlugin,
    MockItemView,
    MockTFile,
    MockTFolder,
    MockVault,
    MockWorkspace,
    MockWorkspaceLeaf,
    MockApp
  };

  const origResolve = Module._resolveFilename;
  Module._resolveFilename = function(request, parent, isMain) {
    if (request === 'obsidian') {
      return 'obsidian-mock';
    }
    return origResolve.apply(this, arguments);
  };

  Module._cache['obsidian-mock'] = {
    id: 'obsidian-mock',
    filename: 'obsidian-mock',
    loaded: true,
    exports: fullMock
  };

  const prod = req('../../main.js');
  const PDF2ObsidianPlugin = prod.default;
  if (PDF2ObsidianPlugin && !PDF2ObsidianPlugin.prototype._hookedTeardown) {
    const origOnunload = PDF2ObsidianPlugin.prototype.onunload;
    PDF2ObsidianPlugin.prototype.onunload = function() {
      if (typeof origOnunload === 'function') {
        origOnunload.call(this);
      }
      MockPlugin.prototype.onunload.call(this);
    };
    PDF2ObsidianPlugin.prototype._hookedTeardown = true;
  }
  return prod;
}

