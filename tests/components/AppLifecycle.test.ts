import { render, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it } from "vitest";
import { WORKBENCH_PROTOCOL_VERSION } from "../../src/protocol/workbenchProtocol";
import type {
  ChangesSnapshot,
  HostToWebviewMessage,
} from "../../src/protocol/workbenchProtocol";
import App from "../../src/webview/App.svelte";
import { WorkbenchState } from "../../src/webview/app/workbenchState.svelte";
import { workbenchBridge } from "../../src/webview/bridge/vscodeBridge";
import { toDisplayPath } from "../../src/scope/pathBrands";

/*
 * App 生命周期回归（v0.0.6 连续保存 flake 根因）：
 * 已有快照时发生 module/loading（保存后 Host 重新读取）必须保持 FeatureRouter
 * 挂载（编辑会话/输入不被卸载打断），显示轻量刷新条，而不是回到全屏
 * “正在读取工作副本”。旧实现（外层 `{#if state.loading}` 先吞掉 loading，
 * 快照分支内的刷新条不可达）在此测试下必然失败。
 */

const changesSnapshot: ChangesSnapshot = {
  kind: "changes",
  commitDraft: "",
  files: [
    {
      relativePath: "src/extension.ts",
      status: "modified",
    },
  ],
  summary: { modified: 1 },
  refreshedAt: new Date().toISOString(),
};

function envelope(
  type: HostToWebviewMessage["type"],
  payload: Record<string, unknown>,
): HostToWebviewMessage {
  return {
    protocolVersion: WORKBENCH_PROTOCOL_VERSION,
    type,
    moduleId: "changes",
    taskId: "changes/overview",
    sessionId: "mock-session-id",
    repositoryUuid: "mock-repository-uuid",
    scopeHash: "mock-scope-hash",
    payload,
  } as HostToWebviewMessage;
}

describe("App 生命周期：快照刷新不卸载模块（v0.0.6 回归）", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  // 注：测试断言为确定性回归；显式超时仅为容纳覆盖率插桩 + 全量并行的真实 CI 慢环境。
  it("已有快照 + module/loading：模块保持挂载、轻量刷新条出现、全屏加载不出现", async () => {
    const state = new WorkbenchState();
    render(App, { state });

    // 手动注入 app/initialize 带快照（mock 已禁用，无定时器干扰），
    // 进入 Changes 模块。“SVN 变更文件”列表是 ChangesModule 专属节点
    // （ScopeBar 不渲染），以此证明模块真实挂载。
    workbenchBridge.injectMock(
      envelope("app/initialize", {
        moduleId: "changes",
        scope: {
          repositoryName: "test-repo",
          roots: [{ kind: "folder", relativePath: toDisplayPath(".") }],
          source: "explorer",
        },
        snapshot: changesSnapshot,
      }),
    );
    await waitFor(
      () =>
        expect(screen.getByRole("list", { name: "SVN 变更文件" })).toBeTruthy(),
      { timeout: 10000 },
    );
    expect(screen.queryByText("正在刷新当前范围…")).toBeNull();

    // 保存后 Host 重新读取：module/loading。
    workbenchBridge.injectMock(
      envelope("module/loading", { moduleId: "changes" }),
    );
    // 模块仍挂载：变更文件列表仍在（未被卸载到全屏 loading）。
    expect(screen.getByRole("list", { name: "SVN 变更文件" })).toBeTruthy();
    // 轻量刷新条出现（Svelte 状态更新后异步渲染）。
    await waitFor(
      () => expect(screen.getByText("正在刷新当前范围…")).toBeTruthy(),
      { timeout: 10000 },
    );
    // 全屏加载屏不出现（模块未被卸载）。
    expect(screen.queryByText("正在读取工作副本")).toBeNull();

    // 快照到达 → 刷新条消失、模块仍在。
    workbenchBridge.injectMock(
      envelope("module/snapshot", { snapshot: changesSnapshot }),
    );
    await waitFor(
      () => expect(screen.queryByText("正在刷新当前范围…")).toBeNull(),
      { timeout: 10000 },
    );
    expect(screen.getByRole("list", { name: "SVN 变更文件" })).toBeTruthy();
  }, 15000);

  it("初始加载（无快照）仍显示全屏加载屏", async () => {
    const state = new WorkbenchState();
    render(App, { state });
    expect(screen.getByText("正在读取工作副本")).toBeTruthy();
    expect(screen.queryByText("正在刷新当前范围…")).toBeNull();
  });
});
