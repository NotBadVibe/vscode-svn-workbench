import { afterEach, describe, expect, it } from 'vitest';
import { WorkbenchState } from '../../src/webview/app/workbenchState.svelte';
import { workbenchBridge } from '../../src/webview/bridge/vscodeBridge';
import { WORKBENCH_PROTOCOL_VERSION, type HostToWebviewMessage, type WebviewToHostMessage } from '../../src/protocol/workbenchProtocol';

const states: WorkbenchState[] = [];
afterEach(() => states.splice(0).forEach((state) => state.dispose()));

function createState() {
  const value = new WorkbenchState();
  states.push(value);
  return value;
}

function inject(message: HostToWebviewMessage) {
  workbenchBridge.injectMock(message);
}

describe('Workbench Webview 状态机', () => {
  it('发送 ready、忽略当前模块重复打开并为新模块生成带上下文动作', () => {
    const actions: WebviewToHostMessage[] = [];
    const listener = (event: Event) => actions.push((event as CustomEvent<WebviewToHostMessage>).detail);
    window.addEventListener('svn-workbench:mock-action', listener);
    try {
      const state = createState();
      state.ready();
      expect(actions[0]).toEqual(expect.objectContaining({ type: 'webview/ready', moduleId: 'changes' }));
      state.openModule('changes');
      expect(actions).toHaveLength(1);
      inject({
        protocolVersion: 1, type: 'scope/changed', moduleId: 'changes', repositoryUuid: 'repo', scopeHash: 'hash',
        payload: { scope: { repositoryName: 'r', roots: [], source: 'internal' } }
      });
      state.openModule('history');
      expect(state.loading).toBe(true);
      expect(actions.at(-1)).toEqual(expect.objectContaining({
        type: 'workbench/action', repositoryUuid: 'repo', scopeHash: 'hash',
        payload: { action: 'open-module', data: { moduleId: 'history', taskId: 'history/revisions' } }
      }));
    } finally {
      window.removeEventListener('svn-workbench:mock-action', listener);
    }
  });

  it('覆盖初始化、加载、快照、进度、结果、取消、错误和范围变化', () => {
    const state = createState();
    const scope = { repositoryName: 'r', roots: [{ kind: 'folder' as const, relativePath: '.' }], source: 'explorer' as const };
    const snapshot = { kind: 'changes' as const, files: [], summary: {}, refreshedAt: 'now' };
    inject({ protocolVersion: 1, type: 'app/initialize', moduleId: 'changes', payload: { scope, snapshot } });
    expect(state.snapshot).toEqual(snapshot);
    expect(state.loading).toBe(false);
    inject({ protocolVersion: 1, type: 'module/loading', moduleId: 'history', payload: { title: '加载' } });
    expect(state.loading).toBe(true);
    inject({ protocolVersion: 1, type: 'operation/progress', moduleId: 'history', payload: { title: '运行', percent: 30 } });
    expect(state.progress?.percent).toBe(30);
    inject({ protocolVersion: 1, type: 'module/snapshot', moduleId: 'changes', payload: { snapshot } });
    expect(state.progress).toBeUndefined();
    inject({ protocolVersion: 1, type: 'operation/result', moduleId: 'changes', payload: { title: '完成', message: 'ok' } });
    expect(state.notification?.tone).toBe('success');
    inject({ protocolVersion: 1, type: 'operation/cancelled', moduleId: 'changes', payload: { title: '取消', message: 'cancel' } });
    expect(state.notification?.tone).toBe('warning');
    inject({ protocolVersion: 1, type: 'operation/error', moduleId: 'changes', payload: { title: '失败', message: 'error', recoverable: true } });
    expect(state.error?.message).toBe('error');
    inject({ protocolVersion: 1, type: 'scope/changed', moduleId: 'changes', payload: { scope } });
    expect(state.scope).toEqual(scope);
  });

  it('拒绝不兼容协议，并正确表达没有初始快照', () => {
    const state = createState();
    inject({ protocolVersion: 99, type: 'module/loading', moduleId: 'changes', payload: { title: 'bad' } } as never);
    expect(state.error?.title).toBe('协议版本不兼容');
    expect(state.connected).toBe(false);
    inject({ protocolVersion: WORKBENCH_PROTOCOL_VERSION, type: 'app/initialize', moduleId: 'changes', payload: {
      scope: { repositoryName: 'r', roots: [], source: 'commandPalette' }
    } });
    expect(state.connected).toBe(true);
    expect(state.loading).toBe(true);
    expect(state.error).toBeUndefined();
  });
});
