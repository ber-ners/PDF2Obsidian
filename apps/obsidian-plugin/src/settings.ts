import * as obsidian from 'obsidian';
import type { App } from 'obsidian';
import type PDF2ObsidianPlugin from './main';

export interface PDF2ObsidianSettings {
  mineruToken: string;
  mineruModel: 'vlm' | 'pipeline';
  llmApiKey: string;
  llmBaseUrl: string;
  llmModel: string;
  targetFolder: string;
}

export const DEFAULT_SETTINGS: PDF2ObsidianSettings = {
  mineruToken: '',
  mineruModel: 'vlm',
  llmApiKey: '',
  llmBaseUrl: 'https://api.deepseek.com/v1',
  llmModel: 'deepseek-chat',
  targetFolder: 'Papers'
};

const BasePluginSettingTab: new (app: App, plugin: PDF2ObsidianPlugin) => obsidian.PluginSettingTab =
  ((obsidian as unknown as { PluginSettingTab?: new (app: App, plugin: PDF2ObsidianPlugin) => obsidian.PluginSettingTab })
    .PluginSettingTab ||
  (class {
    app: App;
    plugin: PDF2ObsidianPlugin;
    containerEl: HTMLElement;
    constructor(app: App, plugin: PDF2ObsidianPlugin) {
      this.app = app;
      this.plugin = plugin;
      this.containerEl =
        typeof document !== 'undefined' ? document.createElement('div') : ({} as HTMLElement);
    }
    display(): void {}
    hide(): void {}
  })) as unknown as new (app: App, plugin: PDF2ObsidianPlugin) => obsidian.PluginSettingTab;

const SafeSetting: new (containerEl: HTMLElement) => obsidian.Setting =
  ((obsidian as unknown as { Setting?: new (containerEl: HTMLElement) => obsidian.Setting }).Setting ||
  (class {
    constructor(_el: HTMLElement) {}
    setName(_n: string) { return this; }
    setDesc(_d: string) { return this; }
    addText(cb: (text: unknown) => unknown) {
      cb({
        setPlaceholder: () => ({ setValue: () => ({ onChange: () => {} }) }),
        setValue: () => ({ onChange: () => {} }),
        inputEl: { type: 'text' }
      });
      return this;
    }
    addDropdown(cb: (drop: unknown) => unknown) {
      cb({
        addOption: () => {},
        setValue: () => ({ onChange: () => {} })
      });
      return this;
    }
  })) as unknown as new (containerEl: HTMLElement) => obsidian.Setting;

export class PDF2ObsidianSettingTab extends BasePluginSettingTab {
  plugin: PDF2ObsidianPlugin;

  constructor(app: App, plugin: PDF2ObsidianPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    if (typeof containerEl.empty === 'function') {
      containerEl.empty();
    } else {
      containerEl.innerHTML = '';
    }

    const titleEl = containerEl.createEl ? containerEl.createEl('h2', { text: 'PDF2obsidian 学术论文配置' }) : null;
    if (!titleEl && typeof document !== 'undefined') {
      const h2 = document.createElement('h2');
      h2.textContent = 'PDF2obsidian 学术论文配置';
      containerEl.appendChild(h2);
    }

    // MinerU Token
    new SafeSetting(containerEl)
      .setName('MinerU API Token')
      .setDesc('用于 MinerU 云端版面解析与公式、图表识别。可在 mineru.net 免费申请。')
      .addText((text: any) => {
        text
          .setPlaceholder('sk-...')
          .setValue(this.plugin.settings.mineruToken)
          .onChange(async (value: string) => {
            this.plugin.settings.mineruToken = value.trim();
            await this.plugin.saveSettings();
          });
        if (text.inputEl) {
          text.inputEl.type = 'password';
        }
      });

    // MinerU Model Version
    new SafeSetting(containerEl)
      .setName('MinerU 模型版本')
      .setDesc('选择解析模型版本。推荐使用 vlm（视觉大语言模型，公式与表格还原最佳）。')
      .addDropdown((drop: any) => {
        drop.addOption('vlm', 'VLM (视觉多模态大模型 - 推荐)');
        drop.addOption('pipeline', 'Pipeline (经典版面分析)');
        drop.setValue(this.plugin.settings.mineruModel);
        drop.onChange(async (val: 'vlm' | 'pipeline') => {
          this.plugin.settings.mineruModel = val;
          await this.plugin.saveSettings();
        });
      });

    // LLM API Key (DeepSeek / OpenAI compatible)
    new SafeSetting(containerEl)
      .setName('DeepSeek / LLM API Key')
      .setDesc('用于论文中英双语对齐翻译、核心速读总结、术语库提取及深度问答。')
      .addText((text: any) => {
        text
          .setPlaceholder('sk-...')
          .setValue(this.plugin.settings.llmApiKey)
          .onChange(async (value: string) => {
            this.plugin.settings.llmApiKey = value.trim();
            await this.plugin.saveSettings();
          });
        if (text.inputEl) {
          text.inputEl.type = 'password';
        }
      });

    // LLM Base URL
    new SafeSetting(containerEl)
      .setName('LLM Base URL')
      .setDesc('兼容 OpenAI 接口规范的 API 地址。默认为 DeepSeek 官方地址 https://api.deepseek.com/v1')
      .addText((text: any) => {
        text
          .setPlaceholder('https://api.deepseek.com/v1')
          .setValue(this.plugin.settings.llmBaseUrl)
          .onChange(async (value: string) => {
            this.plugin.settings.llmBaseUrl = value.trim();
            await this.plugin.saveSettings();
          });
      });

    // LLM Model Name
    new SafeSetting(containerEl)
      .setName('LLM 模型名称')
      .setDesc('指定调用的模型名称。例如 deepseek-chat, deepseek-reasoner, gpt-4o 等。')
      .addText((text: any) => {
        text
          .setPlaceholder('deepseek-chat')
          .setValue(this.plugin.settings.llmModel)
          .onChange(async (value: string) => {
            this.plugin.settings.llmModel = value.trim();
            await this.plugin.saveSettings();
          });
      });

    // Vault Target Folder
    new SafeSetting(containerEl)
      .setName('导出存储根目录')
      .setDesc('解析生成的一整套 6 张精读卡片笔记与配图存放的目录相对路径（默认为 Papers/）。')
      .addText((text: any) => {
        text
          .setPlaceholder('Papers')
          .setValue(this.plugin.settings.targetFolder)
          .onChange(async (value: string) => {
            this.plugin.settings.targetFolder = value.trim() || 'Papers';
            await this.plugin.saveSettings();
          });
      });
  }
}
