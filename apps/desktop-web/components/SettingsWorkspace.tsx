'use client';

import { Close, Content, Description, Overlay, Portal, Root, Title } from '@radix-ui/react-dialog';
import { useEffect, useMemo, useState } from 'react';
import {
  applyWorkflowMode,
  getEnabledCapabilityLabels,
  getSupportedMineruBackend,
  getWorkflowMode,
  getValue,
  setNestedValue,
  updateProvider,
  workflowModes,
  type ConfigData,
  type StepProps
} from './shared/config-utils';
import { ModeCard, SecretField, SelectField, TextField, ToggleField } from './shared/form-fields';
import { aiServiceOptions, aiServicePresets, applyAiService, getAiServiceId } from './shared/ai-service-presets';
import { ThemeToggle } from './ThemeToggle';

export type SettingsSectionKey = 'workflow' | 'mineru' | 'ai' | 'output';

interface SectionDef {
  key: SettingsSectionKey;
  label: string;
  title: string;
  desc: string;
}

const sections: SectionDef[] = [
  {
    key: 'workflow',
    label: '处理能力',
    title: '选择处理深度',
    desc: '系统会根据选定的能力自动调整翻译、阅读材料和在线元数据开关。'
  },
  {
    key: 'mineru',
    label: 'PDF 解析',
    title: '配置 MinerU 解析服务',
    desc: '支持连接本地 MinerU HTTP 服务或使用 MinerU 官方云端 API。'
  },
  {
    key: 'ai',
    label: 'AI 服务',
    title: '配置 AI 模型与接口',
    desc: '论文正文翻译与阅读材料（摘要、术语表、问答）共用此处的 AI 模型。'
  },
  {
    key: 'output',
    label: '输出增强',
    title: '输出与元数据配置',
    desc: '配置文献在线元数据补全及辅助阅读资产生成。'
  }
];

export interface SettingsConfigResponse {
  data?: ConfigData;
  raw?: string;
  exists?: boolean;
  valid?: boolean;
  error?: string;
}

export interface SettingsWorkspaceProps {
  asModal?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onSaved?: () => Promise<void> | void;
  config?: SettingsConfigResponse;
}

export function getSectionIssues(data: ConfigData, section: SettingsSectionKey): string[] {
  const issues: string[] = [];

  if (section === 'mineru') {
    const mode = getValue<string>(data, 'mineru.mode', 'local');
    if (mode === 'official') {
      const token = getValue(data, 'mineru.apiToken', '').trim();
      const tokenEnv = getValue(data, 'mineru.apiTokenEnv', '').trim();
      if (!token && !tokenEnv) {
        issues.push('填写 MinerU 云端 Token 或环境变量名');
      }
    } else {
      const url = getValue(data, 'mineru.apiUrl', '').trim();
      if (!url) {
        issues.push('填写 MinerU 本地服务地址');
      }
    }
  }

  if (section === 'ai') {
    const translationEnabled = getValue(data, 'translation.enabled', true);
    const readingEnabled = getValue(data, 'readingAssets.enabled', true);
    const needsAi = translationEnabled || readingEnabled;
    const provider = getValue(data, 'translation.provider', 'openai-compatible');

    if (needsAi) {
      if (!getValue(data, 'translation.model', '').trim()) {
        issues.push('填写 AI 模型名称');
      }
      if (!getValue(data, 'translation.baseUrl', '').trim()) {
        issues.push('填写 AI 服务 Base URL');
      }
      if (provider === 'openai-compatible') {
        const apiKey = getValue(data, 'translation.apiKey', '').trim();
        const apiKeyEnv = getValue(data, 'translation.apiKeyEnv', '').trim();
        if (!apiKey && !apiKeyEnv) {
          issues.push('填写 AI 服务 API Key 或环境变量名');
        }
      }
    }
  }

  if (section === 'output') {
    const onlineEnabled = getValue(data, 'metadata.online.enabled', false);
    if (onlineEnabled) {
      const providers = getValue<string[]>(data, 'metadata.online.providers', []);
      if (providers.length === 0) {
        issues.push('至少选择一个元数据来源 (CrossRef 或 OpenAlex)');
      }
    }
  }

  return issues;
}

export function getAllSettingsIssues(data: ConfigData): string[] {
  return sections.flatMap((s) => getSectionIssues(data, s.key));
}

export function normalizeSettingsData(data: ConfigData): ConfigData {
  let next = structuredClone(data);
  const mode = getValue<string>(next, 'mineru.mode', 'local');
  const backend = getSupportedMineruBackend(getValue<string>(next, 'mineru.backend', 'pipeline'));
  next = setNestedValue(next, 'mineru.mode', mode === 'official' ? 'official' : 'local');
  next = setNestedValue(next, 'mineru.backend', backend);
  next = setNestedValue(
    next,
    'metadata.online.providers',
    getValue<string[]>(next, 'metadata.online.providers', []).filter((item) => item === 'crossref' || item === 'openalex')
  );
  return next;
}

export function SettingsWorkspace({
  asModal = false,
  open = false,
  onOpenChange,
  onSaved,
  config
}: SettingsWorkspaceProps) {
  const [data, setData] = useState<ConfigData>(config?.data ?? {});
  const [loadedConfig, setLoadedConfig] = useState<SettingsConfigResponse | undefined>(config);
  const [sectionIndex, setSectionIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | undefined>();

  useEffect(() => {
    if (config?.data) {
      setData(config.data);
      setLoadedConfig(config);
    } else {
      void fetchConfig();
    }
  }, [config?.data]);

  async function fetchConfig() {
    try {
      const response = await fetch('/api/config', { cache: 'no-store' });
      const next = (await response.json()) as SettingsConfigResponse;
      setLoadedConfig(next);
      if (next.data) setData(next.data);
    } catch {
      // ignore
    }
  }

  function updateConfig(path: string, value: unknown) {
    setData((current) => setNestedValue(current, path, value));
  }

  function handleClose(nextOpen: boolean) {
    if (!nextOpen) {
      window.localStorage.setItem('pdf2obsidian.settings.dismissed', 'true');
      window.localStorage.setItem('pdf2obsidian.onboarding.dismissed', 'true');
    }
    onOpenChange?.(nextOpen);
  }

  async function saveConfig() {
    setSaving(true);
    setMessage(undefined);
    const dataToSave = normalizeSettingsData(data);
    try {
      const response = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: dataToSave })
      });
      const payload = (await response.json()) as SettingsConfigResponse;
      if (!response.ok || !payload.valid) {
        setMessage(payload.error ?? '配置校验未通过，请检查标红项目。');
        return;
      }

      setLoadedConfig(payload);
      setData(payload.data ?? dataToSave);
      window.localStorage.setItem('pdf2obsidian.settings.configured', 'true');
      window.localStorage.setItem('pdf2obsidian.onboarding.completed', 'true');
      window.localStorage.removeItem('pdf2obsidian.settings.dismissed');
      window.localStorage.removeItem('pdf2obsidian.onboarding.dismissed');
      setMessage('设置已保存');
      await onSaved?.();
      if (asModal) {
        onOpenChange?.(false);
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '保存失败，请重试');
    } finally {
      setSaving(false);
    }
  }

  const activeSection = sections[sectionIndex] ?? sections[0];
  const stepIssues = useMemo(() => getSectionIssues(data, activeSection.key), [data, activeSection.key]);
  const allIssues = useMemo(() => getAllSettingsIssues(data), [data]);
  const isConfigValid = (loadedConfig?.valid ?? false) && allIssues.length === 0;

  const sidebarContent = (
    <aside className="wizard-steps" aria-label="设置导航">
      <div>
        <p className="eyebrow">Settings</p>
        {asModal ? (
          <>
            <Title asChild>
              <h2>本地设置</h2>
            </Title>
            <Description>
              配置解析引擎与 AI 服务，设置将保存在本地配置文件中。
            </Description>
          </>
        ) : (
          <>
            <h2>本地设置</h2>
            <p>配置解析引擎与 AI 服务，设置将保存在本地配置文件中。</p>
          </>
        )}
      </div>

      <ol>
        {sections.map((item, index) => {
          const secIssues = getSectionIssues(data, item.key);
          const hasIssue = secIssues.length > 0;
          return (
            <li
              data-active={index === sectionIndex ? 'true' : 'false'}
              data-done={index < sectionIndex ? 'true' : 'false'}
              key={item.key}
            >
              <button type="button" onClick={() => setSectionIndex(index)}>
                <span>{index + 1}</span>
                <strong>{item.label}</strong>
                {hasIssue ? <i className="step-issue-dot" title={`还有 ${secIssues.length} 项待完善`} /> : null}
              </button>
            </li>
          );
        })}
      </ol>

      <div className="wizard-checklist">
        <div className="check-list">
          {allIssues.length === 0 ? (
            <span data-state="ok">必要信息已完整</span>
          ) : (
            allIssues.map((issue) => (
              <span data-state="todo" key={issue}>{issue}</span>
            ))
          )}
        </div>
      </div>
    </aside>
  );

  const mainPanelContent = (
    <section className="wizard-content">
      <div className="wizard-header">
        <div>
          <span>分类 {sectionIndex + 1} / {sections.length} · {activeSection.label}</span>
          <h3>{activeSection.title}</h3>
          <p className="section-subtitle">{activeSection.desc}</p>
        </div>
        {asModal ? (
          <Close className="wizard-close" type="button" aria-label="关闭设置">×</Close>
        ) : null}
      </div>

      <div className="wizard-body">
        {activeSection.key === 'workflow' ? <WorkflowSection data={data} onChange={updateConfig} /> : null}
        {activeSection.key === 'mineru' ? <MineruSection data={data} onChange={updateConfig} /> : null}
        {activeSection.key === 'ai' ? <AiSection data={data} onChange={updateConfig} /> : null}
        {activeSection.key === 'output' ? <OutputSection data={data} onChange={updateConfig} /> : null}
      </div>

      <div className="wizard-issues">
        {stepIssues.length === 0 ? (
          <span data-state="ok">当前分类已完整</span>
        ) : (
          stepIssues.map((issue) => <span data-state="todo" key={issue}>{issue}</span>)
        )}
      </div>

      {message ? (
        <p className={message === '设置已保存' ? 'success-text' : 'error-text'}>{message}</p>
      ) : null}

      <footer className="wizard-actions">
        <button
          className="ghost-button"
          type="button"
          onClick={() => setSectionIndex((prev) => Math.max(prev - 1, 0))}
          disabled={sectionIndex === 0 || saving}
        >
          上一步
        </button>
        {sectionIndex < sections.length - 1 ? (
          <button
            className="ghost-button"
            type="button"
            onClick={() => setSectionIndex((prev) => Math.min(prev + 1, sections.length - 1))}
            disabled={saving}
          >
            下一步
          </button>
        ) : null}
        <button
          className="primary-button compact"
          type="button"
          onClick={() => void saveConfig()}
          disabled={saving || allIssues.length > 0}
        >
          {saving ? '保存中...' : allIssues.length === 0 ? '保存设置' : `保存设置 (${allIssues.length} 项待完善)`}
        </button>
      </footer>
    </section>
  );

  if (asModal) {
    return (
      <Root open={open} onOpenChange={handleClose}>
        <Portal>
          <Overlay className="wizard-overlay" />
          <Content className="wizard-dialog glass-panel">
            <div className="wizard-shell">
              {sidebarContent}
              {mainPanelContent}
            </div>
          </Content>
        </Portal>
      </Root>
    );
  }

  return (
    <main className="settings-page">
      <header className="settings-header glass-toolbar">
        <div>
          <p className="eyebrow">Settings</p>
          <h1>本地设置</h1>
          <p className="topbar-subtitle">设置只保存在当前电脑，用于本地 Web 和 CLI 共用。</p>
        </div>
        <div className="settings-header-actions">
          <ThemeToggle />
          <span className="status-badge" data-valid={isConfigValid ? 'true' : 'false'}>
            {isConfigValid ? '可用' : '待完善'}
          </span>
          <a className="ghost-link" href="/">返回工作台</a>
        </div>
      </header>

      <div className="wizard-shell glass-panel settings-shell">
        {sidebarContent}
        {mainPanelContent}
      </div>
    </main>
  );
}

function WorkflowSection({ data, onChange }: StepProps) {
  const workflowMode = getWorkflowMode(data);
  const enabledCapabilities = getEnabledCapabilityLabels(data);

  return (
    <div className="wizard-form">
      <div className="mode-grid workflow-grid">
        {workflowModes.map((item) => (
          <ModeCard
            active={workflowMode === item.mode}
            desc={item.desc}
            key={item.mode}
            title={item.title}
            onClick={() => applyWorkflowMode(item.mode, data, onChange)}
          />
        ))}
      </div>
      <div className="capability-strip settings-capabilities">
        {enabledCapabilities.map((item) => (
          <span key={item}>{item}</span>
        ))}
      </div>
      {workflowMode === 'custom' ? (
        <p className="muted-note">当前是自定义能力组合，保存后会按各配置项具体开关执行。</p>
      ) : null}
    </div>
  );
}

function MineruSection({ data, onChange }: StepProps) {
  const mode = getValue<string>(data, 'mineru.mode', 'local');

  return (
    <div className="wizard-form">
      <div className="mode-grid compact-modes">
        <ModeCard
          title="本地服务"
          desc="连接本地 MinerU HTTP 服务"
          active={mode !== 'official'}
          onClick={() => onChange('mineru.mode', 'local')}
        />
        <ModeCard
          title="MinerU 官方 API"
          desc="使用 MinerU 官方高精度解析接口"
          active={mode === 'official'}
          onClick={() => onChange('mineru.mode', 'official')}
        />
      </div>

      {mode === 'official' ? (
        <div className="field-grid">
          <SelectField
            label="云端模型"
            value={getValue(data, 'mineru.modelVersion', 'vlm')}
            options={[
              { value: 'vlm', label: 'VLM 高精度' },
              { value: 'pipeline', label: 'Pipeline 常规解析' }
            ]}
            onChange={(value) => onChange('mineru.modelVersion', value)}
          />
          <SecretField
            label="MinerU API Token"
            placeholder="粘贴官方 API Token"
            value={getValue(data, 'mineru.apiToken', '')}
            onChange={(value) => onChange('mineru.apiToken', value)}
          />
          <TextField
            label="或 Token 环境变量名"
            placeholder="MINERU_OFFICIAL_API_TOKEN"
            value={getValue(data, 'mineru.apiTokenEnv', '')}
            onChange={(value) => onChange('mineru.apiTokenEnv', value)}
          />
        </div>
      ) : (
        <>
          <TextField
            label="MinerU API 地址"
            placeholder="http://127.0.0.1:30000"
            value={getValue(data, 'mineru.apiUrl', '')}
            onChange={(value) => onChange('mineru.apiUrl', value)}
          />
          <details className="advanced-fields">
            <summary>高级设置</summary>
            <TextField
              label="MinerU 命令路径"
              placeholder="./.venv-mineru/bin/mineru"
              value={getValue(data, 'mineru.command', '')}
              onChange={(value) => onChange('mineru.command', value)}
            />
          </details>
        </>
      )}

      <div className="field-grid">
        <SelectField
          label="解析后端"
          value={getSupportedMineruBackend(getValue(data, 'mineru.backend', 'pipeline'))}
          options={[
            { value: 'pipeline', label: 'Pipeline' },
            { value: 'vlm-http-client', label: 'VLM' }
          ]}
          onChange={(value) => onChange('mineru.backend', value)}
        />
        <SelectField
          label="解析方案"
          value={getValue(data, 'mineru.method', 'auto')}
          options={[
            { value: 'auto', label: '自动选择' },
            { value: 'txt', label: '文字层提取' },
            { value: 'ocr', label: '强制 OCR' }
          ]}
          onChange={(value) => onChange('mineru.method', value)}
        />
      </div>

      <div className="toggle-grid">
        <ToggleField
          label="表格识别"
          checked={getValue(data, 'mineru.table', true)}
          onChange={(value) => onChange('mineru.table', value)}
        />
        <ToggleField
          label="公式识别"
          checked={getValue(data, 'mineru.formula', true)}
          onChange={(value) => onChange('mineru.formula', value)}
        />
        <ToggleField
          label="图片分析"
          checked={getValue(data, 'mineru.imageAnalysis', false)}
          onChange={(value) => onChange('mineru.imageAnalysis', value)}
        />
      </div>
    </div>
  );
}

function AiSection({ data, onChange }: StepProps) {
  const serviceId = getAiServiceId(data);
  const service = aiServicePresets[serviceId];
  const translationEnabled = getValue(data, 'translation.enabled', true);
  const readingEnabled = getValue(data, 'readingAssets.enabled', true);
  const needsAiConfig = translationEnabled || readingEnabled;

  return (
    <div className="wizard-form">
      <ToggleField
        label="启用正文翻译"
        checked={translationEnabled}
        onChange={(value) => onChange('translation.enabled', value)}
      />

      {needsAiConfig ? (
        <>
          <div className="field-grid">
            <SelectField
              label="AI 服务"
              value={serviceId}
              options={aiServiceOptions}
              onChange={(value) => applyAiService(value, onChange)}
            />
            <TextField
              label="模型"
              placeholder={service.modelPlaceholder}
              value={getValue(data, 'translation.model', '')}
              onChange={(value) => onChange('translation.model', value)}
            />
          </div>
          <TextField
            label="Base URL"
            placeholder={service.baseUrlPlaceholder}
            value={getValue(data, 'translation.baseUrl', '')}
            onChange={(value) => onChange('translation.baseUrl', value)}
          />
          {service.provider === 'openai-compatible' ? (
            <div className="field-grid">
              <SecretField
                label={service.apiKeyLabel}
                placeholder="sk-..."
                value={getValue(data, 'translation.apiKey', '')}
                onChange={(value) => onChange('translation.apiKey', value)}
              />
              <TextField
                label="或环境变量名"
                placeholder={service.apiKeyEnvPlaceholder}
                value={getValue(data, 'translation.apiKeyEnv', '')}
                onChange={(value) => onChange('translation.apiKeyEnv', value)}
              />
            </div>
          ) : null}
        </>
      ) : (
        <p className="wizard-note">正文翻译与阅读材料均已关闭，当前不会调用外部 AI 服务。</p>
      )}

      {!translationEnabled && readingEnabled ? (
        <p className="cost-note">正文翻译已关闭，但阅读材料生成仍会调用 AI 模型。</p>
      ) : null}
    </div>
  );
}

function OutputSection({ data, onChange }: StepProps) {
  const providers = getValue<string[]>(data, 'metadata.online.providers', []);
  const metadataOnlineEnabled = getValue(data, 'metadata.online.enabled', false);
  const readingAssetsEnabled = getValue(data, 'readingAssets.enabled', true);

  return (
    <div className="wizard-form">
      <div className="toggle-grid">
        <ToggleField
          label="在线补全元数据"
          checked={metadataOnlineEnabled}
          onChange={(value) => onChange('metadata.online.enabled', value)}
        />
        <ToggleField
          label="生成阅读材料"
          checked={readingAssetsEnabled}
          onChange={(value) => onChange('readingAssets.enabled', value)}
        />
      </div>

      {metadataOnlineEnabled ? (
        <div className="checkbox-row">
          <label>
            <input
              type="checkbox"
              checked={providers.includes('crossref')}
              onChange={(event) =>
                onChange('metadata.online.providers', updateProvider(providers, 'crossref', event.target.checked))
              }
            />
            CrossRef
          </label>
          <label>
            <input
              type="checkbox"
              checked={providers.includes('openalex')}
              onChange={(event) =>
                onChange('metadata.online.providers', updateProvider(providers, 'openalex', event.target.checked))
              }
            />
            OpenAlex
          </label>
        </div>
      ) : null}

      {readingAssetsEnabled ? (
        <p className="cost-note">
          阅读材料会调用 AI 额外生成摘要、核心术语表和问答，有助于深入理解论文。
        </p>
      ) : null}

      <div className="wizard-note">
        论文处理结果默认保存在项目 <code>output/papers/</code>，源文件与状态保存在 <code>.pipeline/</code>，无需手动指定保存路径。
      </div>
    </div>
  );
}
