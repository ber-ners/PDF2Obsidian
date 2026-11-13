import { unzipSync } from 'fflate';
import type {
  MineruClientConfig,
  MineruContentItem,
  MineruExtractResult,
  NormalizedBbox
} from '../types/pipeline';

/**
 * Sanitizes and normalizes raw MinerU bounding box coordinates to integers in [0, 1000].
 */
export function sanitizeBbox(raw: unknown): NormalizedBbox | undefined {
  if (!Array.isArray(raw) || raw.length !== 4) return undefined;
  if (!raw.every((n) => typeof n === 'number' && Number.isFinite(n))) return undefined;
  const [x0, y0, x1, y1] = raw.map((n) => Math.min(1000, Math.max(0, Math.round(n))));
  if (x1 <= x0 || y1 <= y0) return undefined;
  return [x0, y0, x1, y1];
}

/**
 * Parses a ZIP archive buffer in-memory using fflate.
 * Returns a mapping of filename to byte buffer.
 */
export function parseZipArchive(buffer: ArrayBuffer | Uint8Array): Record<string, Uint8Array> {
  const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  try {
    return unzipSync(u8);
  } catch (err: unknown) {
    return {};
  }
}

/**
 * Extracts structured layout content, markdown, and images from parsed ZIP entries.
 */
export function extractFromZipEntries(entries: Record<string, Uint8Array>): MineruExtractResult {
  let markdown = '';
  let contentList: MineruContentItem[] = [];
  const images: Record<string, Uint8Array> = {};

  for (const [name, data] of Object.entries(entries)) {
    if (!name || name.endsWith('/') || !name.trim()) continue;

    const cleanName = name.replace(/\\/g, '/');
    if (cleanName.endsWith('/') || !cleanName.trim()) continue;

    const lower = cleanName.toLowerCase();

    // 1. Markdown content
    if (lower === 'full.md' || lower.endsWith('/full.md')) {
      markdown = new TextDecoder('utf-8').decode(data);
    } else if (!markdown && lower.endsWith('.md')) {
      markdown = new TextDecoder('utf-8').decode(data);
    }

    // 2. Layout content list
    if (lower.includes('content_list') && lower.endsWith('.json')) {
      try {
        const parsed = JSON.parse(new TextDecoder('utf-8').decode(data));
        if (Array.isArray(parsed)) {
          contentList = parsed as MineruContentItem[];
        }
      } catch (err) {
        console.warn('[MinerU Client] Failed to parse content_list.json:', err);
      }
    }

    // 3. Extracted images and figures
    if (
      lower.startsWith('images/') ||
      lower.includes('/images/') ||
      lower.endsWith('.png') ||
      lower.endsWith('.jpg') ||
      lower.endsWith('.jpeg') ||
      lower.endsWith('.webp') ||
      lower.endsWith('.svg')
    ) {
      const filename = cleanName.split('/').pop() || '';
      if (filename && filename !== 'images' && !filename.endsWith('/')) {
        images[filename] = data;
        // Also preserve original path for direct mapping
        images[cleanName] = data;
      }
    }
  }

  return {
    markdown,
    contentList,
    images
  };
}

function isResponseOk(res: { ok?: boolean; status?: number }): boolean {
  if (typeof res.ok === 'boolean') return res.ok;
  if (typeof res.status === 'number') return res.status >= 200 && res.status < 300;
  return false;
}

async function getResponseErrorText(res: { text?: () => Promise<string>; json?: () => Promise<unknown>; status?: number }): Promise<string> {
  if (typeof res.text === 'function') {
    try {
      return await res.text();
    } catch {}
  }
  if (typeof res.json === 'function') {
    try {
      const j = await res.json();
      return typeof j === 'string' ? j : JSON.stringify(j);
    } catch {}
  }
  return `HTTP ${res.status || 'unknown'}`;
}

/**
 * MinerU Client providing full support for:
 * 1. Cloud API v4 batch upload, signed PUT upload, status polling, and zip download
 * 2. Remote HTTP runner submitting to POST /tasks
 */
export class MineruClient {
  private config: MineruClientConfig;

  constructor(config: MineruClientConfig = {}) {
    this.config = {
      cloudApiUrl: 'https://mineru.net/api/v4',
      remoteApiUrl: 'http://127.0.0.1:30000',
      modelVersion: 'vlm',
      enableFormula: true,
      enableTable: true,
      enableImageAnalysis: true,
      pollIntervalMs: 2000,
      timeoutMs: 600_000,
      ...config
    };
  }

  /**
   * Main entry point to extract layout and text from a PDF binary.
   */
  async extractPdf(
    pdfData: ArrayBuffer | Uint8Array,
    fileName: string,
    dataId?: string
  ): Promise<MineruExtractResult> {
    const mode = this.config.mode ?? (this.config.cloudApiToken ? 'official' : 'remote');

    if (mode === 'official') {
      return await this.extractViaCloudApi(pdfData, fileName, dataId);
    } else {
      return await this.extractViaRemoteHttp(pdfData, fileName);
    }
  }

  /**
   * Official Cloud API v4 batch upload, signed PUT, status polling, and zip download.
   */
  async extractViaCloudApi(
    pdfData: ArrayBuffer | Uint8Array,
    fileName: string,
    dataId?: string
  ): Promise<MineruExtractResult> {
    const token = this.config.cloudApiToken;
    if (!token) {
      throw new Error('MinerU Cloud API requires cloudApiToken configuration.');
    }

    const baseUrl = (this.config.cloudApiUrl ?? 'https://mineru.net/api/v4').replace(/\/+$/, '');
    const bytes = pdfData instanceof Uint8Array ? pdfData : new Uint8Array(pdfData);

    this.config.onProgress?.('正在注册 MinerU 批量解析任务...');

    // Step 1: POST /api/v4/file-urls/batch
    const regUrl = `${baseUrl}/file-urls/batch`;
    const regRes = await fetch(regUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        files: [{ name: fileName, data_id: dataId || fileName }],
        model_version: this.config.modelVersion ?? 'vlm',
        enable_formula: this.config.enableFormula ?? true,
        enable_table: this.config.enableTable ?? true
      })
    });

    if (!isResponseOk(regRes)) {
      const errText = await getResponseErrorText(regRes);
      throw new Error(`MinerU batch registration failed (${regRes.status}): ${errText}`);
    }

    const regData = (await regRes.json()) as {
      code?: number;
      msg?: string;
      data?: { batch_id?: string; file_urls?: string[] };
    };

    if (regData.code !== 0 || !regData.data?.batch_id || !regData.data.file_urls?.length) {
      throw new Error(`MinerU batch registration returned error: ${regData.msg || JSON.stringify(regData)}`);
    }

    const batchId = regData.data.batch_id;
    const uploadUrl = regData.data.file_urls[0];

    // Step 2: PUT binary upload to signed OSS URL
    this.config.onProgress?.('正在上传 PDF 二进制文件...');
    const uploadBuffer = (bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer);
    const putRes = await fetch(uploadUrl, {
      method: 'PUT',
      body: uploadBuffer
    });

    if (!isResponseOk(putRes)) {
      const errText = await getResponseErrorText(putRes);
      throw new Error(`MinerU signed upload failed (${putRes.status}): ${errText}`);
    }

    // Step 3: Poll batch status until done
    this.config.onProgress?.('正在等待 MinerU 解析完成...');
    const pollUrl = `${baseUrl}/extract-results/batch/${batchId}`;
    const startTime = Date.now();
    const timeoutMs = this.config.timeoutMs ?? 600_000;
    const intervalMs = this.config.pollIntervalMs ?? 2000;

    let fullZipUrl = '';
    let consecutive5xx = 0;
    while (Date.now() - startTime < timeoutMs) {
      let pollRes: Response;
      try {
        pollRes = await fetch(pollUrl, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`
          }
        });
      } catch (networkErr: unknown) {
        const msg = networkErr instanceof Error ? networkErr.message : String(networkErr);
        console.warn(`[MinerU Client] Transient network error during polling: ${msg}`);
        consecutive5xx++;
        const backoff = Math.min(intervalMs * Math.pow(1.5, consecutive5xx), 10_000);
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }

      if (!isResponseOk(pollRes)) {
        if (pollRes.status >= 500 && pollRes.status <= 599) {
          consecutive5xx++;
          const errText = await getResponseErrorText(pollRes);
          console.warn(`[MinerU Client] Transient HTTP ${pollRes.status} during polling: ${errText}, retrying...`);
          const backoff = Math.min(intervalMs * Math.pow(1.5, consecutive5xx), 10_000);
          await new Promise((r) => setTimeout(r, backoff));
          continue;
        }
        const errText = await getResponseErrorText(pollRes);
        throw new Error(`MinerU poll request failed (${pollRes.status}): ${errText}`);
      }

      consecutive5xx = 0;

      const pollData = (await pollRes.json()) as {
        code?: number;
        data?: {
          extract_result?: Array<{
            state?: string;
            full_zip_url?: string;
            err_msg?: string;
          }>;
        };
      };

      const resultItem = pollData.data?.extract_result?.[0];
      const state = resultItem?.state;

      if (state === 'done') {
        fullZipUrl = resultItem?.full_zip_url || '';
        break;
      }

      if (state === 'failed') {
        throw new Error(`MinerU extraction failed: ${resultItem?.err_msg || 'unknown error'}`);
      }

      this.config.onProgress?.(`MinerU 解析中 (状态: ${state || 'running'})...`);
      await new Promise((r) => setTimeout(r, intervalMs));
    }

    if (!fullZipUrl) {
      throw new Error(`MinerU batch polling timed out after ${timeoutMs / 1000}s`);
    }

    // Step 4: Download result ZIP (with OSS failover)
    this.config.onProgress?.('正在下载 MinerU 解析结果包...');
    let zipBuffer: ArrayBuffer;

    try {
      const zipRes = await fetch(fullZipUrl, { method: 'GET' });
      if (!isResponseOk(zipRes)) {
        throw new Error(`HTTP ${zipRes.status}`);
      }
      zipBuffer = await zipRes.arrayBuffer();
    } catch (err: unknown) {
      // Failover from CDN to official OSS bucket if needed
      if (fullZipUrl.includes('cdn-mineru.openxlab.org.cn')) {
        const ossUrl = fullZipUrl.replace(
          'cdn-mineru.openxlab.org.cn',
          'mineru.oss-cn-shanghai.aliyuncs.com'
        );
        this.config.onProgress?.('CDN 下载异常，尝试直接从 OSS 存储下载...');
        const ossRes = await fetch(ossUrl, { method: 'GET' });
        if (!isResponseOk(ossRes)) {
          throw new Error(`MinerU OSS fallback download failed (${ossRes.status})`);
        }
        zipBuffer = await ossRes.arrayBuffer();
      } else {
        throw err;
      }
    }

    // Step 5: Extract zip entries in memory
    this.config.onProgress?.('正在解压解析结果与提取图片...');
    const entries = parseZipArchive(zipBuffer);
    const result = extractFromZipEntries(entries);
    result.rawZipBuffer = zipBuffer;

    return result;
  }

  /**
   * Remote HTTP runner: Submits task to POST /tasks and receives layout content.
   */
  async extractViaRemoteHttp(
    pdfData: ArrayBuffer | Uint8Array,
    fileName: string
  ): Promise<MineruExtractResult> {
    const baseUrl = (this.config.remoteApiUrl ?? 'http://127.0.0.1:30000').replace(/\/+$/, '');
    const endpoint = `${baseUrl}/tasks`;
    const bytes = pdfData instanceof Uint8Array ? pdfData : new Uint8Array(pdfData);

    this.config.onProgress?.('正在提交解析任务到 MinerU 本地服务...');

    const form = new FormData();
    const arrayBuf = (bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer);
    const blob = new Blob([arrayBuf], { type: 'application/pdf' });
    form.append('files', blob, fileName);
    form.append('backend', this.config.modelVersion ?? 'vlm');
    form.append('parse_method', 'auto');
    form.append('formula_enable', String(this.config.enableFormula ?? true));
    form.append('table_enable', String(this.config.enableTable ?? true));
    form.append('image_analysis', String(this.config.enableImageAnalysis ?? true));
    form.append('return_md', 'true');
    form.append('return_content_list', 'true');
    form.append('return_images', 'true');

    let response = await fetch(endpoint, {
      method: 'POST',
      body: form
    }).catch(async () => {
      // Fallback: try raw JSON body if multipart is not supported by mock server
      return await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: fileName })
      });
    });

    if (!response.ok && response.status !== 202) {
      const errText = await response.text();
      throw new Error(`MinerU remote service failed (${response.status}): ${errText}`);
    }

    const payload = (await response.json()) as {
      status?: string;
      task_id?: string;
      result?: {
        markdown?: string;
        md_content?: string;
        content_list?: MineruContentItem[];
        images?: Record<string, string | Uint8Array>;
      };
      markdown?: string;
      content_list?: MineruContentItem[];
      images?: Record<string, string | Uint8Array>;
    };

    // If server returned synchronous result
    if (payload.status === 'done' || payload.result || payload.markdown) {
      const resObj = payload.result || payload;
      const md = resObj.markdown || (resObj as Record<string, unknown>).md_content || '';
      const contentList = resObj.content_list || [];
      const images: Record<string, Uint8Array> = {};

      if (resObj.images && typeof resObj.images === 'object') {
        for (const [k, v] of Object.entries(resObj.images)) {
          if (v instanceof Uint8Array) {
            images[k] = v;
          } else if (typeof v === 'string') {
            images[k] = new TextEncoder().encode(v);
          }
        }
      }

      return {
        markdown: String(md),
        contentList,
        images
      };
    }

    // If asynchronous task_id returned, poll /tasks/:id
    if (payload.task_id) {
      const taskId = payload.task_id;
      const statusUrl = `${baseUrl}/tasks/${taskId}`;
      const resultUrl = `${baseUrl}/tasks/${taskId}/result`;
      const startTime = Date.now();
      const timeoutMs = this.config.timeoutMs ?? 600_000;

      let consecutive5xx = 0;
      while (Date.now() - startTime < timeoutMs) {
        let pollRes: Response;
        try {
          pollRes = await fetch(statusUrl, { method: 'GET' });
        } catch (networkErr: unknown) {
          const msg = networkErr instanceof Error ? networkErr.message : String(networkErr);
          console.warn(`[MinerU Client] Transient network error during remote task polling: ${msg}`);
          consecutive5xx++;
          const backoff = Math.min((this.config.pollIntervalMs ?? 2000) * Math.pow(1.5, consecutive5xx), 10_000);
          await new Promise((r) => setTimeout(r, backoff));
          continue;
        }

        if (!pollRes.ok) {
          if (pollRes.status >= 500 && pollRes.status <= 599) {
            consecutive5xx++;
            console.warn(`[MinerU Client] Transient HTTP ${pollRes.status} during remote polling, retrying...`);
            const backoff = Math.min((this.config.pollIntervalMs ?? 2000) * Math.pow(1.5, consecutive5xx), 10_000);
            await new Promise((r) => setTimeout(r, backoff));
            continue;
          }
          throw new Error(`Remote task poll failed (${pollRes.status})`);
        }

        consecutive5xx = 0;
        const statusData = (await pollRes.json()) as { status?: string; error?: string };

        if (statusData.status === 'completed' || statusData.status === 'done') {
          const resRes = await fetch(resultUrl, { method: 'GET' });
          if (!resRes.ok) throw new Error(`Remote task result failed (${resRes.status})`);
          const resJson = (await resRes.json()) as {
            markdown?: string;
            content_list?: MineruContentItem[];
            images?: Record<string, Uint8Array>;
          };
          return {
            markdown: resJson.markdown || '',
            contentList: resJson.content_list || [],
            images: resJson.images || {}
          };
        }

        if (statusData.status === 'failed') {
          throw new Error(statusData.error || 'MinerU remote task failed');
        }

        await new Promise((r) => setTimeout(r, this.config.pollIntervalMs ?? 2000));
      }
      throw new Error(`Remote MinerU task timed out: ${taskId}`);
    }

    throw new Error('MinerU remote service did not return a valid layout result');
  }
}
