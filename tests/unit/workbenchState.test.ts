import { afterEach, describe, expect, it } from "vitest";
import { WorkbenchState } from "../../src/webview/app/workbenchState.svelte";
import { workbenchBridge } from "../../src/webview/bridge/vscodeBridge";
import {
  WORKBENCH_PROTOCOL_VERSION,
  type HostToWebviewMessage,
  type WebviewToHostMessage,
} from "../../src/protocol/workbenchProtocol";
import { toDisplayPath } from "../../src/scope/pathBrands";

const SESSION_ID = "session-a";
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

describe("Workbench Webview 状态机", () => {
  it("发送 ready、忽略当前模块重复打开并为新模块生成带上下文动作", () => {
    const actions: WebviewToHostMessage[] = [];
    const listener = (event: Event) =>
      actions.push((event as CustomEvent<WebviewToHostMessage>).detail);
    window.addEventListener("svn-workbench:mock-action", listener);
    try {
      const state = createState();
      state.ready();
      expect(actions[0]).toEqual(
        expect.objectContaining({ type: "webview/ready", moduleId: "changes" }),
      );
      state.openModule("changes");
      expect(actions).toHaveLength(1);
      inject({
        protocolVersion: WORKBENCH_PROTOCOL_VERSION,
        type: "app/initialize",
        moduleId: "changes",
        sessionId: SESSION_ID,
        repositoryUuid: "repo",
        scopeHash: "hash",
        payload: {
          moduleId: "changes",
          scope: { repositoryName: "r", roots: [], source: "internal" },
        },
      });
      state.openModule("history");
      expect(state.loading).toBe(true);
      expect(actions.at(-1)).toEqual(
        expect.objectContaining({
          type: "workbench/action",
          sessionId: SESSION_ID,
          repositoryUuid: "repo",
          scopeHash: "hash",
          payload: {
            action: "open-module",
            data: { moduleId: "history", taskId: "history/revisions" },
          },
        }),
      );
    } finally {
      window.removeEventListener("svn-workbench:mock-action", listener);
    }
  });

  it("覆盖初始化、加载、快照、进度、结果、取消、错误和范围变化", () => {
    const state = createState();
    const scope = {
      repositoryName: "r",
      roots: [{ kind: "folder" as const, relativePath: toDisplayPath(".") }],
      source: "explorer" as const,
    };
    const snapshot = {
      kind: "changes" as const,
      files: [],
      summary: {},
      refreshedAt: "now",
    };
    inject({
      protocolVersion: WORKBENCH_PROTOCOL_VERSION,
      type: "app/initialize",
      moduleId: "changes",
      sessionId: SESSION_ID,
      payload: { scope, snapshot },
    });
    expect(state.snapshot).toEqual(snapshot);
    expect(state.loading).toBe(false);
    inject({
      protocolVersion: WORKBENCH_PROTOCOL_VERSION,
      type: "module/loading",
      moduleId: "history",
      sessionId: SESSION_ID,
      payload: { title: "加载" },
    });
    expect(state.loading).toBe(true);
    inject({
      protocolVersion: WORKBENCH_PROTOCOL_VERSION,
      type: "operation/progress",
      moduleId: "history",
      sessionId: SESSION_ID,
      payload: { title: "运行", percent: 30 },
    });
    expect(state.progress?.percent).toBe(30);
    inject({
      protocolVersion: WORKBENCH_PROTOCOL_VERSION,
      type: "module/snapshot",
      moduleId: "changes",
      sessionId: SESSION_ID,
      payload: { snapshot },
    });
    expect(state.progress).toBeUndefined();
    inject({
      protocolVersion: WORKBENCH_PROTOCOL_VERSION,
      type: "operation/result",
      moduleId: "changes",
      sessionId: SESSION_ID,
      payload: { title: "完成", message: "ok" },
    });
    expect(state.notification?.tone).toBe("success");
    inject({
      protocolVersion: WORKBENCH_PROTOCOL_VERSION,
      type: "operation/cancelled",
      moduleId: "changes",
      sessionId: SESSION_ID,
      payload: { title: "取消", message: "cancel" },
    });
    expect(state.notification?.tone).toBe("warning");
    inject({
      protocolVersion: WORKBENCH_PROTOCOL_VERSION,
      type: "operation/error",
      moduleId: "changes",
      sessionId: SESSION_ID,
      payload: { title: "失败", message: "error", recoverable: true },
    });
    expect(state.error?.message).toBe("error");
    inject({
      protocolVersion: WORKBENCH_PROTOCOL_VERSION,
      type: "scope/changed",
      moduleId: "changes",
      sessionId: SESSION_ID,
      payload: { scope },
    });
    expect(state.scope).toEqual(scope);
  });

  it("保存成功后更新编辑会话基准（rawHash/token/draftRevision）", () => {
    const state = createState();
    inject({
      protocolVersion: WORKBENCH_PROTOCOL_VERSION,
      type: "app/initialize",
      moduleId: "diff",
      sessionId: SESSION_ID,
      repositoryUuid: "repo",
      scopeHash: "hash",
      payload: {
        moduleId: "diff",
        scope: { repositoryName: "r", roots: [], source: "internal" },
      },
    });
    inject({
      protocolVersion: WORKBENCH_PROTOCOL_VERSION,
      type: "diff/edit-opened",
      moduleId: "diff",
      sessionId: SESSION_ID,
      repositoryUuid: "repo",
      scopeHash: "hash",
      payload: {
        targetId: "t1",
        editToken: "tok1",
        draftRevision: 1,
        baseHash: "b",
        baseRevision: "BASE",
        rawHash: "raw1",
        baseContents: "x",
        message: "已进入页内编辑。",
      },
    });
    inject({
      protocolVersion: WORKBENCH_PROTOCOL_VERSION,
      type: "diff/save-result",
      moduleId: "diff",
      sessionId: SESSION_ID,
      repositoryUuid: "repo",
      scopeHash: "hash",
      payload: {
        targetId: "t1",
        result: {
          ok: true,
          acceptedRevision: 5,
          newContentHash: "raw2",
          newEditToken: "tok2",
          snapshotVersion: 2,
        },
        snapshotVersion: 2,
      },
    });
    // 组件因 module/loading 重挂载后只认 editSession：基准必须已更新。
    expect(state.editSession).toEqual(
      expect.objectContaining({
        editToken: "tok2",
        rawHash: "raw2",
        draftRevision: 5,
      }),
    );
  });

  it("拒绝不兼容协议，并正确表达没有初始快照", () => {
    const state = createState();
    inject({
      protocolVersion: 99,
      type: "module/loading",
      moduleId: "changes",
      payload: { title: "bad" },
    } as never);
    expect(state.error?.title).toBe("协议版本不兼容");
    expect(state.connected).toBe(false);
    inject({
      protocolVersion: WORKBENCH_PROTOCOL_VERSION,
      type: "app/initialize",
      moduleId: "changes",
      sessionId: "session-empty",
      payload: {
        scope: { repositoryName: "r", roots: [], source: "commandPalette" },
      },
    });
    expect(state.connected).toBe(true);
    expect(state.loading).toBe(true);
    expect(state.error).toBeUndefined();
  });

  it("新会话接管后拒绝旧会话延迟快照", () => {
    const state = createState();
    const scope = {
      repositoryName: "r",
      roots: [],
      source: "internal" as const,
    };
    const staleSnapshot = {
      kind: "changes" as const,
      files: [],
      summary: {},
      refreshedAt: "stale",
    };
    const currentSnapshot = { ...staleSnapshot, refreshedAt: "current" };

    inject({
      protocolVersion: WORKBENCH_PROTOCOL_VERSION,
      type: "app/initialize",
      moduleId: "changes",
      sessionId: "session-a",
      payload: { scope, snapshot: staleSnapshot },
    });
    inject({
      protocolVersion: WORKBENCH_PROTOCOL_VERSION,
      type: "app/initialize",
      moduleId: "changes",
      sessionId: "session-b",
      payload: { scope, snapshot: currentSnapshot },
    });
    inject({
      protocolVersion: WORKBENCH_PROTOCOL_VERSION,
      type: "module/snapshot",
      moduleId: "changes",
      sessionId: "session-a",
      payload: { snapshot: staleSnapshot },
    });

    expect(state.sessionId).toBe("session-b");
    expect(state.snapshot).toEqual(currentSnapshot);
  });
});
