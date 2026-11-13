import { copyFile, readFile, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { loadConfig, type AppConfig } from '@pdf2obsidian/core';
import YAML from 'yaml';
import { exists, getConfigPath, getDesktopPipelineDir, getExampleConfigPath, getWorkspaceRoot } from './paths.ts';

export type LocalConfigData = Record<string, unknown>;

export const SECRET_MASK = '••••••••';

export interface LocalConfigResponse {
  raw: string;
  data: LocalConfigData;
  path: string;
  exists: boolean;
  valid: boolean;
  error?: string;
}

export function isMasked(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return value === SECRET_MASK || /^•{4,}$/.test(value) || value.includes('••••');
}

export function maskConfigData(data: LocalConfigData): LocalConfigData {
  const masked = structuredClone(data);
  if (isRecord(masked.mineru) && typeof masked.mineru.apiToken === 'string' && masked.mineru.apiToken.trim()) {
    masked.mineru.apiToken = SECRET_MASK;
  }
  if (isRecord(masked.translation) && typeof masked.translation.apiKey === 'string' && masked.translation.apiKey.trim()) {
    masked.translation.apiKey = SECRET_MASK;
  }
  return masked;
}

export function maskRawYaml(raw: string): string {
  return raw
    .replace(/^(\s*apiToken:\s*).+$/gm, `$1"${SECRET_MASK}"`)
    .replace(/^(\s*apiKey:\s*).+$/gm, `$1"${SECRET_MASK}"`);
}

export async function readLocalConfig(): Promise<LocalConfigResponse> {
  const configPath = await getConfigPath();
  let configExists = await exists(configPath);
  if (!configExists) {
    const defaults = await normalizeConfigData(parseConfigData(await readFile(await getExampleConfigPath(), 'utf8')));
    try {
      await writeFile(configPath, YAML.stringify(defaults), { encoding: 'utf8', flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    configExists = true;
  }
  const raw = await readFile(configExists ? configPath : await getExampleConfigPath(), 'utf8');
  const data = await normalizeConfigData(parseConfigData(raw));

  try {
    if (configExists) {
      await loadLocalAppConfig();
    }

    return {
      raw: maskRawYaml(raw),
      data: maskConfigData(data),
      path: configPath,
      exists: configExists,
      valid: configExists
    };
  } catch (error) {
    return {
      raw: maskRawYaml(raw),
      data: maskConfigData(data),
      path: configPath,
      exists: configExists,
      valid: false,
      error: formatConfigError(error)
    };
  }
}

export async function writeLocalConfig(raw: string): Promise<LocalConfigResponse> {
  return writeLocalConfigRaw(raw);
}

export async function writeLocalConfigData(data: LocalConfigData): Promise<LocalConfigResponse> {
  return writeLocalConfigRaw(YAML.stringify(data));
}

function restoreSecretsIfMasked(incoming: LocalConfigData, existing: LocalConfigData): void {
  if (isRecord(incoming.mineru) && isRecord(existing.mineru)) {
    if (isMasked(incoming.mineru.apiToken)) {
      if (typeof existing.mineru.apiToken === 'string' && existing.mineru.apiToken.trim()) {
        incoming.mineru.apiToken = existing.mineru.apiToken;
      } else {
        delete incoming.mineru.apiToken;
      }
    }
  }
  if (isRecord(incoming.translation) && isRecord(existing.translation)) {
    if (isMasked(incoming.translation.apiKey)) {
      if (typeof existing.translation.apiKey === 'string' && existing.translation.apiKey.trim()) {
        incoming.translation.apiKey = existing.translation.apiKey;
      } else {
        delete incoming.translation.apiKey;
      }
    }
  }
}

async function writeLocalConfigRaw(raw: string): Promise<LocalConfigResponse> {
  const configPath = await getConfigPath();
  const tempPath = join(await getDesktopPipelineDir(), `config-${randomUUID()}.yaml`);

  let existingData: LocalConfigData = {};
  if (await exists(configPath)) {
    try {
      existingData = parseConfigData(await readFile(configPath, 'utf8'));
    } catch {
      existingData = {};
    }
  }

  const incomingData = parseConfigData(raw);
  restoreSecretsIfMasked(incomingData, existingData);

  const data = await normalizeConfigData(incomingData, existingData);
  await writeFile(tempPath, YAML.stringify(data), 'utf8');

  try {
    await loadConfig(tempPath);
  } catch (error) {
    await unlink(tempPath).catch(() => undefined);
    return {
      raw: maskRawYaml(YAML.stringify(data)),
      data: maskConfigData(data),
      path: configPath,
      exists: await exists(configPath),
      valid: false,
      error: formatConfigError(error)
    };
  }

  if (await exists(configPath)) {
    await writeFile(configPath, YAML.stringify(data), 'utf8');
  } else {
    await copyFile(tempPath, configPath);
  }

  await unlink(tempPath).catch(() => undefined);
  return readLocalConfig();
}

export async function loadLocalAppConfig() {
  const configPath = await getConfigPath();
  if (!(await exists(configPath))) {
    throw new Error('配置文件不存在。请先在设置中保存配置。');
  }

  const config = await loadConfig(configPath);
  config.mineru.outputDir = resolve(await getWorkspaceRoot(), config.mineru.outputDir);
  // The web workspace always owns its output; legacy Vault paths are never used.
  config.vault = { path: join(await getWorkspaceRoot(), 'output'), documentDir: 'papers', imageDirName: 'images' };
  config.obsidian.autoLink.enabled = false;
  config.obsidian.database.enabled = false;
  return config;
}

export function validateLocalRuntimeConfig(config: AppConfig): void {
  const issues: string[] = [];
  validateMineruRuntimeConfig(config, issues);
  validateTranslationRuntimeConfig(config, issues);

  if (issues.length > 0) {
    throw new Error(`配置预检失败：${issues.join('；')}`);
  }
}

interface ValidationIssue {
  path?: Array<string | number>;
  message?: string;
  code?: string;
  values?: unknown[];
}

function formatConfigError(error: unknown): string {
  const issues = extractIssues(error);
  if (issues.length === 0) {
    return error instanceof Error ? error.message : String(error);
  }

  return issues.map(formatIssue).join('\n');
}

function extractIssues(error: unknown): ValidationIssue[] {
  if (typeof error !== 'object' || error === null) {
    return [];
  }

  const candidate = error as { issues?: unknown };
  if (!Array.isArray(candidate.issues)) {
    return [];
  }

  return candidate.issues.filter((issue): issue is ValidationIssue => {
    return typeof issue === 'object' && issue !== null;
  });
}

function formatIssue(issue: ValidationIssue): string {
  const path = issue.path?.length ? issue.path.join('.') : '配置';

  if (issue.code === 'invalid_value' && issue.values?.length) {
    return `${path} 的值不受支持。当前可用值：${issue.values.join('、')}。`;
  }

  return `${path}: ${issue.message ?? '配置不合法'}`;
}

function validateTranslationRuntimeConfig(config: AppConfig, issues: string[]): void {
  const translation = config.translation;
  const needsAi = translation.enabled !== false || config.readingAssets.enabled;

  if (!needsAi) return;

  if (translation.provider === 'ollama') {
    validateBaseUrl('translation.baseUrl', translation.baseUrl, issues);
    return;
  }

  validateBaseUrl('translation.baseUrl', translation.baseUrl, issues);
  validatePlaceholder('translation.baseUrl', translation.baseUrl, issues);
  validateOpenAiCompatibleEndpoint(translation.baseUrl, issues);
  validateApiKey('translation.apiKeyEnv', translation.apiKey, translation.apiKeyEnv, issues);
}

function validateMineruRuntimeConfig(config: AppConfig, issues: string[]): void {
  const mineru = config.mineru;

  if (mineru.mode === 'cli') {
    issues.push('Web 工作台不支持本地 CLI 命令行模式，请在设置中选择“本地服务”或“官方 API”');
    return;
  }

  if (mineru.mode === 'official') {
    const token = mineru.apiTokenEnv ?? 'MINERU_OFFICIAL_API_TOKEN';
    if (!mineru.apiToken?.trim() && !(token.startsWith('eyJ') || token.includes('.'))) {
      validateApiKey('mineru.apiTokenEnv', undefined, token, issues);
    }
  }

  if (mineru.mode === 'local' && mineru.apiUrl) {
    validateBaseUrl('mineru.apiUrl', mineru.apiUrl, issues);
    validatePlaceholder('mineru.apiUrl', mineru.apiUrl, issues);
  }
}

function validateBaseUrl(path: string, value: string, issues: string[]): void {
  try {
    new URL(value);
  } catch {
    issues.push(`${path} 不是有效 URL，请在设置页重新选择服务或填写完整地址`);
  }
}

function validatePlaceholder(path: string, value: string, issues: string[]): void {
  if (/[<>{}]|YOUR_|REPLACE_|example\.com/i.test(value)) {
    issues.push(`${path} 仍包含占位符，请替换为真实服务地址`);
  }
}

function validateOpenAiCompatibleEndpoint(baseUrl: string, issues: string[]): void {
  if (/\/chat\/completions\/?$/i.test(baseUrl)) {
    issues.push('translation.baseUrl 不要包含 /chat/completions，程序会自动拼接接口路径');
  }

  if (!/api\.cloudflare\.com/i.test(baseUrl)) return;

  if (!/\/accounts\/[^/]+\/ai\/v1\/?$/i.test(baseUrl)) {
    issues.push('Cloudflare Workers AI 地址应为 https://api.cloudflare.com/client/v4/accounts/你的_ACCOUNT_ID/ai/v1');
  }
}

function validateApiKey(path: string, apiKey: string | undefined, apiKeyEnv: string | undefined, issues: string[]): void {
  if (apiKey?.trim()) return;

  const envName = apiKeyEnv?.trim();
  if (!envName) {
    issues.push(`${path} 未配置，请在设置页选择或填写环境变量名`);
    return;
  }

  if (!isEnvironmentVariableName(envName)) {
    issues.push(`${path} 应填写环境变量名，不要填写 Key 或 Token 原文`);
    return;
  }

  if (!process.env[envName]) {
    issues.push(`环境变量 ${envName} 未设置，请在终端设置后重新启动本地 Web`);
  }
}

function isEnvironmentVariableName(value: string): boolean {
  return /^[A-Z_][A-Z0-9_]*$/i.test(value) && value.length <= 80;
}

function parseConfigData(raw: string): LocalConfigData {
  const parsed = YAML.parse(raw);
  return isRecord(parsed) ? parsed : {};
}

async function normalizeConfigData(data: LocalConfigData, existingData?: LocalConfigData): Promise<LocalConfigData> {
  const next = structuredClone(data);

  // Preserve existing vault and obsidian configuration for CLI compatibility
  if (existingData?.vault) {
    next.vault = existingData.vault;
  }
  if (existingData?.obsidian) {
    next.obsidian = existingData.obsidian;
  }
  if (!next.output && !next.vault) {
    next.output = { path: join(await getWorkspaceRoot(), 'output') };
  }

  const mineru = ensureRecord(next, 'mineru');

  // Security: Disallow 'cli' mode from web interface, and disallow arbitrary custom mineru.command
  if (mineru.mode === 'cli') {
    mineru.mode = 'local';
  }
  if (existingData?.mineru && isRecord(existingData.mineru) && typeof existingData.mineru.command === 'string') {
    mineru.command = existingData.mineru.command;
  } else if (typeof mineru.command !== 'string' || !mineru.command.trim()) {
    mineru.command = 'magic-pdf';
  }
  delete mineru.allowLocalMode;

  const legacyToken = typeof mineru.apiTokenEnv === 'string' ? mineru.apiTokenEnv.trim() : '';
  if (legacyToken && (legacyToken.startsWith('eyJ') || legacyToken.includes('.') || !/^[A-Z_][A-Z0-9_]{0,79}$/i.test(legacyToken))) {
    if (!mineru.apiToken) mineru.apiToken = legacyToken;
    mineru.apiTokenEnv = 'MINERU_OFFICIAL_API_TOKEN';
  }
  if (typeof mineru.apiToken === 'string') {
    mineru.apiToken = mineru.apiToken.trim();
    if (!mineru.apiToken) delete mineru.apiToken;
  }
  const translation = ensureRecord(next, 'translation');
  if (translation.provider === 'deepseek') {
    translation.provider = 'openai-compatible';
    translation.preset = translation.preset ?? 'deepseek';
  }
  const metadata = ensureRecord(next, 'metadata');
  const online = ensureRecord(metadata, 'online');
  const providers = Array.isArray(online.providers) ? online.providers : ['crossref', 'openalex'];
  const supportedProviders = providers.filter((provider) => provider === 'crossref' || provider === 'openalex');
  online.providers = supportedProviders;
  if (supportedProviders.length === 0) {
    online.providers = ['crossref', 'openalex'];
  }
  return next;
}

function ensureRecord(target: LocalConfigData, key: string): LocalConfigData {
  if (!isRecord(target[key])) {
    target[key] = {};
  }
  return target[key] as LocalConfigData;
}

function isRecord(value: unknown): value is LocalConfigData {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
