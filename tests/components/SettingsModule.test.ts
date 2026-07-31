import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import SettingsModule from '../../src/webview/features/settings/SettingsModule.svelte';
import type { SettingsSnapshot } from '../../src/protocol/workbenchProtocol';

const snapshot: SettingsSnapshot = {
  kind: 'settings',
  svnSecurity: { authenticationActive: true, hasStoredAuthentication: true, passwordTransport: 'stdin', certificateTrust: 'explicit-svn-cache' },
  ai: {
    presets: [{ id: 'custom', label: '自定义', baseUrl: '', model: '', description: '' }],
    scenarios: [], providerPreset: 'custom', baseUrl: 'https://ai.example/v1', model: 'model-a', scenarioModels: {}, hasApiKey: true, includeCommitHistory: false, historyLimit: 10, models: []
  },
  team: {
    configPath: '.svn-workbench.json', enabled: false, requiredIssueId: false, issueIdPattern: '', requiredModule: false,
    allowedModulesText: '', requiredPrefix: false, allowedPrefixesText: '', warnings: [],
    memory: { source: '当前仓库成功提交', count: 1, maxEntries: 50, externallyShared: false, recent: [{ revision: '8', summary: 'feat: workbench', recordedAt: '2026-07-30T08:00:00.000Z' }] }
  }
};

describe('SettingsModule', () => {
  it('不把已保存密钥回填到密码输入框，并把新密钥只作为保存动作发送', async () => {
    const onAction = vi.fn();
    render(SettingsModule, { snapshot, onAction });
    const key = screen.getByLabelText('API 密钥');
    expect(key).toHaveValue('');
    await fireEvent.input(key, { target: { value: 'new-secret' } });
    await fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
    expect(onAction).toHaveBeenCalledWith('settings/save-ai', expect.objectContaining({ apiKey: 'new-secret' }));
  });

  it('只显示 SVN 凭据状态并通过 Host 安全动作配置或清除', async () => {
    const onAction = vi.fn();
    render(SettingsModule, { snapshot, onAction });
    await fireEvent.click(screen.getByRole('tab', { name: 'SVN 安全' }));
    expect(screen.queryByLabelText('SVN 密码')).not.toBeInTheDocument();
    expect(screen.getByText('VS Code 安全存储 / 系统凭据存储')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: '配置 SVN 认证' }));
    expect(onAction).toHaveBeenCalledWith('security/configure-authentication');
  });

  it('显示团队记忆来源、数量并由 Host 清除', async () => {
    const onAction = vi.fn();
    render(SettingsModule, { snapshot, onAction });
    await fireEvent.click(screen.getByRole('tab', { name: '团队提交规范' }));
    expect(screen.getByText('feat: workbench')).toBeInTheDocument();
    expect(screen.getByText(/当前仓库成功提交/)).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: '清除团队记忆' }));
    expect(onAction).toHaveBeenCalledWith('settings/clear-team-memory');
  });
});
