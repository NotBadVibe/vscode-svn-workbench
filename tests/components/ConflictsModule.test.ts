import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import ConflictsModule from '../../src/webview/features/conflicts/ConflictsModule.svelte';
import type { ConflictSnapshot } from '../../src/protocol/workbenchProtocol';

const snapshot: ConflictSnapshot = {
  kind: 'conflicts',
  conflicts: [{ relativePath: 'src/a.ts', type: 'text' }],
  selected: {
    relativePath: 'src/a.ts',
    contents: {
      working: { content: 'merged', truncated: false },
      theirs: { content: 'remote', truncated: false }
    },
    mergeEditor: { token: 'edit-1', editable: true, issues: [] }
  },
  resolvePreview: {
    token: 'resolve-1',
    relativePath: 'src/a.ts',
    command: 'svn resolve --accept working "src/a.ts"',
    canResolve: true,
    issues: []
  }
};

describe('ConflictsModule', () => {
  it('只使用 Host 生成的预览令牌确认解决', async () => {
    const onAction = vi.fn();
    render(ConflictsModule, { snapshot, onAction });

    await fireEvent.click(screen.getByRole('button', { name: '确认使用当前工作副本内容并标记解决' }));
    expect(onAction).toHaveBeenCalledWith('conflict/resolve', { previewToken: 'resolve-1' });
  });

  it('允许逐块采用远端结果并用编辑令牌保存 Working', async () => {
    const onAction = vi.fn();
    const mergeSnapshot: ConflictSnapshot = {
      kind: 'conflicts', conflicts: [{ relativePath: 'src/a.ts', type: 'text' }],
      selected: {
        relativePath: 'src/a.ts',
        contents: { working: { content: '<<<<<<< .mine\nlocal\n=======\nremote\n>>>>>>> .r5\n', truncated: false } },
        mergeEditor: { token: 'edit-2', editable: true, issues: [] }
      }
    };
    render(ConflictsModule, { snapshot: mergeSnapshot, onAction });
    await fireEvent.click(screen.getByRole('button', { name: '采用对方修改' }));
    await fireEvent.click(screen.getByRole('button', { name: '保存工作副本合并结果' }));
    expect(onAction).toHaveBeenCalledWith('conflict/save-working', { editToken: 'edit-2', content: 'remote\n' });
  });
});
