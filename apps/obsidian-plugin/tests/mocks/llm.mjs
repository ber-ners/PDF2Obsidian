/**
 * Mock LLM completion stubs for OpenAI and DeepSeek APIs.
 * Supports translation, executive summary, terminology glossary, and Q&A generation.
 */

export class MockLlmServer {
  constructor(options = {}) {
    this.validTokens = new Set(options.validTokens || ['valid-openai-key', 'valid-deepseek-key']);
    this.failMode = options.failMode || null; // 'rate_limit' | 'auth_error' | 'context_length' | 'server_error'
    this.callHistory = [];
  }

  handleRequest(urlStr, options = {}) {
    const url = new URL(urlStr);
    const method = (options.method || 'GET').toUpperCase();
    const headers = options.headers || {};
    const authHeader = headers['Authorization'] || headers['authorization'] || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');

    if (method !== 'POST') {
      return {
        status: 405,
        json: () => Promise.resolve({ error: { message: 'Method not allowed', type: 'invalid_request_error' } })
      };
    }

    if (this.failMode === 'auth_error' || (!this.validTokens.has(token) && this.validTokens.size > 0)) {
      return {
        status: 401,
        json: () => Promise.resolve({
          error: {
            message: 'Incorrect API key provided or invalid authorization header.',
            type: 'invalid_request_error',
            code: 'invalid_api_key'
          }
        })
      };
    }

    if (this.failMode === 'rate_limit') {
      return {
        status: 429,
        json: () => Promise.resolve({
          error: {
            message: 'Rate limit reached for requests per minute.',
            type: 'requests',
            code: 'rate_limit_exceeded'
          }
        })
      };
    }

    if (this.failMode === 'server_error') {
      return {
        status: 500,
        json: () => Promise.resolve({
          error: {
            message: 'The server had an error while processing your request.',
            type: 'server_error'
          }
        })
      };
    }

    const body = typeof options.body === 'string' ? JSON.parse(options.body) : (options.body || {});
    this.callHistory.push({ url: urlStr, body, timestamp: Date.now() });

    const messages = body.messages || [];
    const model = body.model || 'gpt-4o';
    const systemMsg = messages.find((m) => m.role === 'system')?.content || '';
    const userMsg = messages.find((m) => m.role === 'user')?.content || '';

    // Check token budget limit error simulation
    if (this.failMode === 'context_length' || userMsg.length > 200000) {
      return {
        status: 400,
        json: () => Promise.resolve({
          error: {
            message: "This model's maximum context length is 128000 tokens. However, your messages resulted in 204800 tokens.",
            type: 'invalid_request_error',
            code: 'context_length_exceeded'
          }
        })
      };
    }

    let responseContent = '';

    // Case 1: Academic Translation
    if (
      systemMsg.includes('学术翻译') ||
      systemMsg.includes('academic translator') ||
      userMsg.includes('翻译为简体中文') ||
      userMsg.includes('Translate')
    ) {
      responseContent = this._generateTranslation(userMsg);
    }
    // Case 2: Executive Summary
    else if (
      systemMsg.includes('论文总结') ||
      userMsg.includes('核心贡献与创新') ||
      userMsg.includes('Executive Summary') ||
      userMsg.includes('summary.md')
    ) {
      responseContent = `# 论文总结：Attention Is All You Need\n\n## 1. 研究问题与动机\n主流序列转导模型依赖复杂的循环或卷积神经网络，计算无法并行。\n\n## 2. 核心架构创新\n提出 Transformer 架构，完全摒弃循环结构，依赖多头自注意力机制（Multi-Head Attention）。\n\n## 3. 实验表现与基准\n在 WMT 2014 英德翻译任务上达到 28.4 BLEU，刷新最优成绩；英法任务上达到 41.8 BLEU。\n\n## 4. 研究贡献\n- 证明了纯注意力机制足以为序列模型提供最强性能。\n- 训练时间大幅降低，具备极致的并行化能力。\n\n## 5. 局限性与讨论\n对超长文本自注意力存在平方级复杂度计算开销。`;
    }
    // Case 3: Terminology Glossary (terms.md)
    else if (
      systemMsg.includes('术语') ||
      userMsg.includes('术语表') ||
      userMsg.includes('terms.md')
    ) {
      responseContent = `# 核心专业术语表\n\n| 英文术语 | 中文译名 | 上下文释义 |\n|---|---|---|\n| Multi-Head Attention | 多头注意力机制 | 将查询、键、值投影到多个子空间并行计算注意力，捕捉不同维度的相关性 |\n| Scaled Dot-Product Attention | 缩放点积注意力 | 通过点积计算相似度并除以维度平方根以稳定梯度的注意力计算方法 |\n| Positional Encoding | 位置编码 | 为缺乏顺序特性的自注意力输入注入单词绝对与相对位置信息的向量 |\n| Residual Connection | 残差连接 | 跨越单层或多层直接相加输入的连接结构，缓解深层网络梯度消失 |\n| Layer Normalization | 层归一化 | 在单个样本的所有特征维度上进行标准化操作，加速模型收敛 |`;
    }
    // Case 4: Deep-dive Q&A (qa.md)
    else if (
      systemMsg.includes('问答') ||
      userMsg.includes('问答') ||
      userMsg.includes('qa.md')
    ) {
      responseContent = `# 核心深度问答 (Q&A)\n\n### Q1: Transformer 模型相比传统 RNN/LSTM 的最大优势是什么？\n**A1**: 最大优势在于移除了序列对时间步的递归依赖，允许所有位置的词元完全并行计算，极大缩短了训练时间并能更好地捕捉长程依赖。\n\n### Q2: 缩放点积注意力中为什么要除以 $\\sqrt{d_k}$？\n**A2**: 当维度 $d_k$ 很大时，点积的结果数量级会急剧增大，从而将 Softmax 函数推入梯度极小的饱和区。除以 $\\sqrt{d_k}$ 能将方差稳定在 1，保证梯度的健康反向传播。\n\n### Q3: 为什么需要多头注意力机制而非单个大维度注意力？\n**A3**: 单个注意力头往往会平均化不同特征空间的信息，多头结构允许模型在不同的表示子空间中同时关注不同位置的信息。`;
    }
    // Default fallback
    else {
      responseContent = `Processed response for model ${model}: content analyzed.`;
    }

    return {
      status: 200,
      json: () => Promise.resolve({
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: responseContent
            },
            finish_reason: 'stop'
          }
        ],
        usage: {
          prompt_tokens: 150,
          completion_tokens: 280,
          total_tokens: 430
        }
      })
    };
  }

  _generateTranslation(userMsg) {
    // Splits by paragraphs and provides a high-quality Chinese translation counterpart
    const lines = userMsg.split('\n\n').filter(Boolean);
    const translatedParagraphs = lines.map((p) => {
      const trimmed = p.trim();
      if (trimmed.startsWith('# ')) {
        return '# ' + trimmed.slice(2) + '（中文标题）';
      }
      if (trimmed.startsWith('## ')) {
        return '## ' + trimmed.slice(3) + '（章节译名）';
      }
      if (trimmed.startsWith('$$') && trimmed.endsWith('$$')) {
        // Math blocks remain identical
        return trimmed;
      }
      if (trimmed.startsWith('```')) {
        // Code blocks remain identical
        return trimmed;
      }
      return `【译文】${trimmed.slice(0, 50)}...（已完成学术中文精准翻译，保留数学与引用标记）`;
    });

    return translatedParagraphs.join('\n\n');
  }
}

/**
 * Installs global mock fetch for LLM and MinerU requests during tests.
 * Restores original fetch on cleanup.
 */
export function setupGlobalMockFetch(options = {}) {
  const originalFetch = globalThis.fetch;
  const llmServer = new MockLlmServer(options.llmOptions || {});

  globalThis.fetch = async (input, init = {}) => {
    const urlStr = typeof input === 'string' ? input : input.url;

    if (urlStr.includes('api.openai.com') || urlStr.includes('api.deepseek.com')) {
      const res = llmServer.handleRequest(urlStr, init);
      return {
        ok: res.status >= 200 && res.status < 300,
        status: res.status,
        statusText: res.status === 200 ? 'OK' : 'Error',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: res.json,
        text: res.text || (() => Promise.resolve('')),
        arrayBuffer: res.arrayBuffer || (() => Promise.resolve(new ArrayBuffer(0)))
      };
    }

    if (typeof originalFetch === 'function') {
      return originalFetch(input, init);
    }
    throw new Error(`Fetch not mocked for URL: ${urlStr}`);
  };

  return {
    llmServer,
    restore: () => {
      globalThis.fetch = originalFetch;
    }
  };
}
