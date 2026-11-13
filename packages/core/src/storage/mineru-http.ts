/** Bounded, stage-local retries. POST submissions are never replayed automatically. */
export interface MineruRequestPolicy {
  requestTimeoutMs?: number | undefined;
  maxRetries?: number | undefined;
  retryDelayMs?: number | undefined;
  signal?: AbortSignal | undefined;
  onRetry?: ((message: string) => void | Promise<void>) | undefined;
}

const retryableStatuses = new Set([408, 429, 500, 502, 503, 504]);
const permanentNetworkCodes = new Set(['ENOTFOUND', 'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'ERR_TLS_CERT_ALTNAME_INVALID']);

export async function fetchMineru(url: string | URL, options: RequestInit = {}, policy: MineruRequestPolicy = {}): Promise<Response> {
  const method = (options.method ?? 'GET').toUpperCase();
  const retries = ['GET', 'HEAD', 'PUT'].includes(method) ? (policy.maxRetries ?? 2) : 0;
  const timeoutMs = policy.requestTimeoutMs ?? 30_000;
  // Signed storage URLs contain credentials; only expose the origin in diagnostics.
  const target = new URL(url).origin;
  for (let attempt = 0; ; attempt++) {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signals = [timeout, policy.signal, options.signal].filter((s): s is AbortSignal => !!s);
    const signal = AbortSignal.any(signals);
    let retryAfterMs = 0;
    try {
      const response = await fetch(url, { ...options, signal });
      // Read the body before clearing the timeout, including JSON and zip downloads.
      const bytes = await response.arrayBuffer();
      if (!retryableStatuses.has(response.status) || attempt >= retries) {
        return new Response([204, 205, 304].includes(response.status) ? null : bytes, {
          status: response.status, statusText: response.statusText, headers: response.headers
        });
      }
      const retryAfter = response.headers.get('retry-after');
      if (retryAfter) {
        const seconds = Number(retryAfter);
        retryAfterMs = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now();
      }
    } catch (error) {
      if (policy.signal?.aborted || options.signal?.aborted) {
        throw new Error(`MinerU 任务超时或已取消 (${method} ${target})`, { cause: error });
      }
      const cause = error instanceof Error ? error.cause as { code?: string } | undefined : undefined;
      const code = cause?.code;
      const detail = timeout.aborted ? `请求超时（${timeoutMs}ms）` : `网络请求失败${code ? ` (${code})` : ''}`;
      if (attempt >= retries || (code && permanentNetworkCodes.has(code))) {
        throw new Error(`MinerU ${method} ${target} ${detail}，已尝试 ${attempt + 1} 次`, { cause: error });
      }
    }
    const waitMs = Math.min(30_000, Math.max(0, retryAfterMs || (policy.retryDelayMs ?? 1000) * 2 ** attempt));
    await policy.onRetry?.(`网络暂时不可用，${waitMs}ms 后重试当前请求（${attempt + 1}/${retries}）`);
    await new Promise<void>((resolve, reject) => {
      if (policy.signal?.aborted) { reject(new Error('MinerU 任务超时或已取消')); return; }
      const onAbort = () => { clearTimeout(timer); reject(new Error('MinerU 任务超时或已取消')); };
      const timer = setTimeout(() => { policy.signal?.removeEventListener('abort', onAbort); resolve(); }, waitMs);
      policy.signal?.addEventListener('abort', onAbort, { once: true });
    });
  }
}
