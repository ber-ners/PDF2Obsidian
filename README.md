# PDF2Obsidian · 面向医学科研的本地文献深度阅读与知识沉淀工作台

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-20+-68a063.svg?style=flat-square&logo=node.js" alt="Node.js 20+" />
  <img src="https://img.shields.io/badge/pnpm-10+-f69220.svg?style=flat-square&logo=pnpm" alt="pnpm 10+" />
  <img src="https://img.shields.io/badge/Parser-MinerU-ff6b6b.svg?style=flat-square" alt="MinerU" />
  <img src="https://img.shields.io/badge/Diagram-Pele%20%2F%20Mermaid-11a58c.svg?style=flat-square" alt="Pele Mermaid" />
  <img src="https://img.shields.io/badge/Platform-Desktop%20Web-705dcf.svg?style=flat-square" alt="Desktop Web" />
  <img src="https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square" alt="License MIT" />
</p>

**PDF2Obsidian** 是一款专为**医学科研人员与临床研究者**打造的 **Local-First（本地优先）** 学术文献研读工作台。依托 [MinerU](https://github.com/opendatalab/MinerU) 高精度版面解析与大语言模型，将复杂的医学 PDF 文献转化为**原文-双语联动阅读视图**、**可视化机制图解**与结构化 Markdown 知识资产（可直接导入 Obsidian 知识库）。

---

## ✨ 核心特性与医学科研增强

- **🎯 左侧 PDF 与右侧 Markdown 双向精准对应**
  - 基于 MinerU 版面坐标（Bounding Box）建立原版 PDF 与右侧 Markdown / 中英双语正文的区块级映射。
  - 点击左侧 PDF 识别框（正文、三线表、插图、公式等），右侧即刻平滑滚动并高亮对应译文；点击右侧任意段落，左侧 PDF 自动跳转并聚焦对应页码与区块，方便随时核对原始文献中的入排标准、给药剂量、样本量与统计学细节。
- **📊 基于 Pele 的 Mermaid 图表渲染与可视化图解**
  - 集成轻量级渲染引擎 [pele](https://www.npmjs.com/package/pele) 原生渲染 Mermaid 流程图（支持缩放、拖拽平移与源码切换，纯本地渲染无需外网依赖）。
  - 自动提炼医学文献的研究设计主线、试验流程与分子/临床机制，生成**全景阅读图解（`流程图.md`）**与辅助理解图表，帮助快速理清数十页复杂论文的逻辑脉络。
- **📋 医学三线表与复杂公式高保真还原**
  - 精准提取临床基线特征表、回归分析表、LaTeX 公式与高清插图，告别传统 PDF 复制导致的排版错乱与公式丢失。
- **🌐 医学术语对照与结构化知识沉淀**
  - 自动生成中英段落并列对照（`*.bilingual.md`）、结构化摘要、**医学专业术语对照表**及深度问答，降低长篇外文文献的阅读门槛。
- **🏛️ 期刊分区与文献元数据补全**
  - 支持 DOI / arXiv / 本地 PDF 导入，可选集成 CrossRef、OpenAlex 与 EasyScholar，直观展示中科院分区、JCR 分区与影响因子（IF）。
- **🔒 本地优先与隐私安全**
  - 所有解析缓存、PDF 渲染与笔记均在本地完成，支持对接本地 Ollama 模型，适合处理未发表课题、内部资料与敏感临床文献。

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

### 2. 启动 Desktop Web 工作台
```bash
npm run dev
```
启动后访问 **[http://127.0.0.1:3001](http://127.0.0.1:3001)**，可在界面右上角 **设置 (Settings)** 中直接配置 API 密钥与输出目录。

---

## ⚙️ 配置说明

首次运行 Web 工作台会自动生成配置文件 `pdf2obsidian.config.yaml`（可参考模板 [pdf2obsidian.config.example.yaml](pdf2obsidian.config.example.yaml)）：

- **MinerU 解析**：支持 `official`（官方云端 API，免本地显卡）或 `local`（本地服务），建议填写 `apiToken` 或配置环境变量 `MINERU_OFFICIAL_API_TOKEN`。
- **AI 翻译与图解**：支持 DeepSeek、OpenAI 兼容接口或本地 Ollama；也可将 `translation.enabled` 和 `readingAssets.enabled` 设为 `false`，零模型成本使用纯版式解析与 PDF 双向联动。
- **期刊指标（可选）**：支持配置 `EASYSCHOLAR_SECRET_KEY` 展示期刊分区与影响因子。

---

## 📂 生成的文献资产结构

每篇论文解析完成后，会在本地输出目录生成一套结构化 Markdown 笔记（可直接导入 Obsidian）：

```text
output/papers/<论文目录>/
├── <论文名>.md            # 规范化英文原文
├── <论文名>.zh.md         # 中文译文
├── <论文名>.bilingual.md  # 中英段落并列对照
├── 流程图.md              # 研究脉络与机制图解（Pele / Mermaid）
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
| `npm test` | 运行自动化测试套件 |
| `npm run dev:cli -- import <file>` | CLI 命令行导入单篇 PDF |

---

## 📄 开源协议与致谢

本项目基于 **[MIT License](LICENSE)** 开源。

感谢 [MinerU](https://github.com/opendatalab/MinerU)、[PDF.js](https://mozilla.github.io/pdf.js/)、[KaTeX](https://katex.org/)、[Pele](https://www.npmjs.com/package/pele)、[Mermaid](https://mermaid.js.org/)、[EasyScholar](https://www.easyscholar.cc/) 与 [Obsidian](https://obsidian.md/) 等优秀的开源项目与学术工具。
