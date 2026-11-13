import type {
  GenerateTextInput,
  TextGenerationClient,
  TextGenerationClientConfig
} from '../types.js';

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  error?: {
    message?: string;
  };
}

export class OpenAICompatibleClient implements TextGenerationClient {
  constructor(private readonly config: TextGenerationClientConfig) {}

  async generateText(input: GenerateTextInput): Promise<string> {
    const apiKey = this.resolveApiKey();
    if (!apiKey) {
      throw new Error('缺少 AI 服务 API Key，请配置 translation.apiKeyEnv 或 translation.apiKey。');
    }

    const url = `${this.config.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const timeoutMs = this.config.timeoutMs ?? 120_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [
            { role: 'system', content: input.systemPrompt },
            { role: 'user', content: input.userPrompt }
          ],
          stream: false
        }),
        signal: controller.signal
      });
    } catch (error: unknown) {
      if (controller.signal.aborted) {
        throw new Error(`OpenAI 兼容服务请求超时（超过 ${timeoutMs / 1000} 秒，url=${url}，model=${this.config.model}）`);
      }
      const cause = error instanceof Error && error.cause ? error.cause : undefined;
      const detail = cause instanceof Error
        ? cause.message
        : cause && typeof cause === 'object' && 'code' in cause
          ? String((cause as { code: unknown }).code)
          : '';
      const causeSuffix = detail ? `（${detail}）` : '';
      const baseMsg = error instanceof Error ? error.message : String(error);
      throw new Error(`无法连接至 AI 服务 API：${baseMsg}${causeSuffix}，请检查网络连接、代理或服务地址（url=${url}）`, { cause: error });
    } finally {
      clearTimeout(timer);
    }

    const payload = await parseResponse(response);
    if (!response.ok) {
      const detail = payload.error?.message ?? `HTTP ${response.status}`;
      throw new Error(`OpenAI 兼容服务请求失败：${detail}（url=${url}，model=${this.config.model}）`);
    }

    const content = payload.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new Error(payload.error?.message ?? 'OpenAI 兼容服务返回了空内容');
    }

    return content;
  }

  private resolveApiKey(): string | undefined {
    if (this.config.apiKey) return this.config.apiKey;
    if (this.config.apiKeyEnv) return process.env[this.config.apiKeyEnv];
    return undefined;
  }
}

async function parseResponse(response: Response): Promise<ChatCompletionResponse> {
  const body = await response.text();
  if (!body) return {};

  try {
    return JSON.parse(body) as ChatCompletionResponse;
  } catch {
    throw new Error(`OpenAI 兼容服务返回了非 JSON 响应：HTTP ${response.status} ${body.slice(0, 500)}`);
  }
}
