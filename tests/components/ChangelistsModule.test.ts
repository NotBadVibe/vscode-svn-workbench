import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import ChangelistsModule from '../../src/webview/features/changelists/ChangelistsModule.svelte';
import type { ChangelistsSnapshot } from '../../src/protocol/workbenchProtocol';

describe('ChangelistsModule', () => {
  it('仅在预览通过后使用令牌应用', async () => {
    const onAction = vi.fn();
    const snapshot: ChangelistsSnapshot = {
      kind: 'changelists', source: 'local-rule', aiPrivacy: { model: 'local', fileLimit: 120, data: 'metadata', historyIncluded: false }, groups: [], unassigned: [], suggestions: [], warnings: [],
      preview: { token: 'cl-1', name: 'ui', remove: false, paths: ['src/a.ts'], command: 'svn changelist "ui" "src/a.ts"', canExecute: true, issues: [] }
    };
    render(ChangelistsModule, { snapshot, onAction });
    await fireEvent.click(screen.getByRole('button', { name: '确认应用变更集' }));
    expect(onAction).toHaveBeenCalledWith('changelist/execute-apply', { previewToken: 'cl-1' });
  });
});
