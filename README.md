# PDF2Obsidian · 面向医学科研的本地文献深度阅读与知识沉淀工作台

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-20+-68a063.svg?style=flat-square&logo=node.js" alt="Node.js 20+" />
  <img src="https://img.shields.io/badge/pnpm-10+-f69220.svg?style=flat-square&logo=pnpm" alt="pnpm 10+" />
  <img src="https://img.shields.io/badge/Parser-MinerU-ff6b6b.svg?style=flat-square" alt="MinerU" />
  <img src="https://img.shields.io/badge/Platform-Desktop%20Web%20%7C%20Obsidian-705dcf.svg?style=flat-square&logo=obsidian" alt="Obsidian & Web" />
  <img src="https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square" alt="License MIT" />
</p>

**PDF2Obsidian** 是一款专为**医学科研人员与临床研究者**打造的 **Local-First（本地优先）** 学术文献研读工具。依托 [MinerU](https://github.com/opendatalab/MinerU) 高精度版面解析与大语言模型，将复杂的医学 PDF 文献转化为结构化的双语精读笔记、机制流程图与 Obsidian 知识库资产。

---

## ✨ 为什么适合医学科研

- **📋 复杂表格与多栏版式高保真还原**：精准识别医学文献中的三线表（基线特征表、回归分析表）、插图、统计公式与参考文献，告别复制乱码。
- **🎯 PDF 与双语正文双向精准联动**：左侧原版 PDF 识别框与右侧中英对照段落点击互相跳转定位，随时核对原文献的入排标准、给药剂量与统计学细节。
- **🔬 机制与研究脉络图解**：顺着论文逻辑主线自动提炼研究设计、实验路径与分子/临床机制，生成 Mermaid 流程图、结构化摘要、**医学专业术语对照表**及深度问答。
- **🏛️ 期刊分区与文献元数据补全**：支持 DOI / arXiv / 本地 PDF 导入，可选集成 CrossRef、OpenAlex 与 EasyScholar，直观显示中科院分区、JCR 分区与影响因子（IF）。
- **🔒 本地优先与隐私安全**：所有解析缓存、PDF 渲染与笔记均在本地完成，支持对接本地 Ollama 模型，适合处理未发表课题、内部资料与敏感文献。

---

## 🖥️ 两种使用方式

| 模式 | 适用场景 | 特点 |
| :--- | :--- | :--- |
| **Desktop Web 工作台** | 日常文献初筛、快速双语精读 | 浏览器打开即用，无需安装 Obsidian 与配置 Vault 目录 |
| **Obsidian 原生插件** | 长期文献沉淀、课题双链笔记管理 | 原生嵌入 Obsidian 分屏视图，笔记与配图直接写入 Vault |

---

## 🚀 快速上手

### 环境要求
- **Node.js** `>= 20.0.0`
- **pnpm** `>= 10.0.0`

### 1. 克隆并安装依赖
```bash
git clone https://github.com/ber-ners/PDF2Obsidian.git
cd PDF2Obsidian
pnpm install --frozen-lockfile
```

### 2. 方式 A：启动 Desktop Web 工作台（推荐）
```bash
npm run dev
```
启动后访问 **[http://127.0.0.1:3001](http://127.0.0.1:3001)**，可在界面右上角 **设置 (Settings)** 中直接配置 API 密钥与输出目录。

### 3. 方式 B：构建 Obsidian 插件
```bash
npm run build:plugin
```
将 `apps/obsidian-plugin/` 目录下生成的 `main.js`、`manifest.json`、`styles.css` 复制到你的知识库目录 `<Vault>/.obsidian/plugins/pdf2obsidian/`，在 Obsidian 第三方插件设置中启用即可。

---

## ⚙️ 配置说明

首次运行 Web 工作台会自动生成配置文件 `pdf2obsidian.config.yaml`（可参考模板 [pdf2obsidian.config.example.yaml](pdf2obsidian.config.example.yaml)）：

- **MinerU 解析**：支持 `official`（官方云端 API，免本地显卡）或 `local`（本地服务），建议填写 `apiToken` 或配置环境变量 `MINERU_OFFICIAL_API_TOKEN`。
- **AI 翻译与图解**：支持 DeepSeek、OpenAI 兼容接口或本地 Ollama；也可将 `translation.enabled` 和 `readingAssets.enabled` 设为 `false`，零模型成本使用纯版式解析与 PDF 双向联动。
- **期刊指标（可选）**：支持配置 `EASYSCHOLAR_SECRET_KEY` 展示期刊分区与影响因子。

---

## 📂 生成的文献资产结构

每篇论文解析完成后，会在本地输出目录或 Obsidian Vault 中生成一套完整笔记：

```text
output/papers/<论文目录>/
├── <论文名>.md            # 规范化英文原文
├── <论文名>.zh.md         # 中文译文
├── <论文名>.bilingual.md  # 中英段落并列对照
├── 流程图.md              # 研究脉络与机制图解（Mermaid）
├── 摘要.md                # 结构化核心摘要
├── 术语表.md              # 医学专业术语双语对照表
├── 问答.md                # 核心论点深度 Q&A
├── index.md              # 元数据、期刊分区与双链索引
├── <论文名>.pdf           # 原始 PDF 备份
└── images/               # 提取的论文图表
```

---

## 🛠️ 常用命令

| 命令 | 说明 |
| :--- | :--- |
| `npm run dev` | 启动 Desktop Web 开发工作台（`127.0.0.1:3001`） |
| `npm run build` | 构建 Web 工作台与全部基础包 |
| `npm run build:plugin` | 构建 Obsidian 插件产物 |
| `npm test` | 运行自动化测试套件 |
| `npm run dev:cli -- import <file>` | CLI 命令行导入单篇 PDF |

---

## 📄 开源协议与致谢

本项目基于 **[MIT License](LICENSE)** 开源。

感谢 [MinerU](https://github.com/opendatalab/MinerU)、[PDF.js](https://mozilla.github.io/pdf.js/)、[KaTeX](https://katex.org/)、[Mermaid](https://mermaid.js.org/)、[EasyScholar](https://www.easyscholar.cc/) 与 [Obsidian](https://obsidian.md/) 等优秀的开源项目与学术工具。
