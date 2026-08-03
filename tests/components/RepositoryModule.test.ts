import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import RepositoryModule from "../../src/webview/features/repository/RepositoryModule.svelte";
import type { RepositorySnapshot } from "../../src/protocol/workbenchProtocol";

describe("RepositoryModule", () => {
  it("更新执行只携带 Host 签发的预览令牌", async () => {
    const onAction = vi.fn();
    const snapshot: RepositorySnapshot = {
      kind: "repository",
      info: { name: "repo", revision: "5" },
      properties: { available: true, target: ".", items: [] },
      cleanup: { available: true, target: "." },
      advanced: {},
      update: {
        token: "update-1",
        canExecute: true,
        localCount: 1,
        remoteCount: 0,
        risk: "low",
        overlapPaths: [],
        messages: ["没有明显风险。"],
        commands: ['svn update --accept postpone "."'],
      },
    };
    render(RepositoryModule, {
      snapshot,
      taskId: "repository/update",
      onAction,
    });
    await fireEvent.click(
      await screen.findByRole("button", { name: "确认更新当前范围" }),
    );
    expect(onAction).toHaveBeenCalledWith("repository/execute-update", {
      previewToken: "update-1",
    });
  });

  it("属性写入必须先生成预览", async () => {
    const onAction = vi.fn();
    const snapshot: RepositorySnapshot = {
      kind: "repository",
      info: { name: "repo", revision: "5" },
      properties: {
        available: true,
        target: "src",
        items: [{ name: "svn:ignore", value: "dist" }],
      },
      cleanup: { available: true, target: "src" },
      advanced: {},
    };
    render(RepositoryModule, {
      snapshot,
      taskId: "repository/properties",
      onAction,
    });
    await fireEvent.click(
      await screen.findByRole("button", { name: /svn:ignore/ }),
    );
    await fireEvent.click(screen.getByRole("button", { name: "预览设置" }));
    expect(onAction).toHaveBeenCalledWith("repository/preview-property", {
      name: "svn:ignore",
      value: "dist",
      remove: false,
    });
  });

  it("锁定恢复状态明确作废旧预览并给出人工恢复步骤", async () => {
    const snapshot: RepositorySnapshot = {
      kind: "repository",
      info: { name: "repo", revision: "5" },
      properties: { available: true, target: ".", items: [] },
      cleanup: { available: true, target: "." },
      advanced: {},
      recovery: {
        category: "working-copy-locked",
        title: "工作副本被锁定",
        detectedAt: "2026-07-30T08:30:00.000Z",
        steps: ["确认没有其他 SVN 进程正在操作该工作副本。", "执行安全清理。"],
        requiresFreshPreview: true,
      },
    };
    render(RepositoryModule, {
      snapshot,
      taskId: "repository/recovery",
      onAction: vi.fn(),
    });

    expect(
      await screen.findByRole("heading", { name: "工作副本被锁定" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/此前所有写操作预览已作废。/)).toBeInTheDocument();
    expect(
      screen.getByText(/恢复后必须重新采集状态并生成新预览/),
    ).toBeInTheDocument();
    expect(screen.getByText("执行安全清理。")).toBeInTheDocument();
  });

  it("破坏性高级操作需要二次勾选后才能使用 Host 预览令牌执行", async () => {
    const onAction = vi.fn();
    const snapshot: RepositorySnapshot = {
      kind: "repository",
      info: { name: "repo", revision: "5" },
      properties: { available: true, target: ".", items: [] },
      cleanup: { available: true, target: "." },
      advanced: {
        preview: {
          token: "switch-1",
          operation: "switch",
          title: "切换工作副本",
          commands: ["svn switch …"],
          details: ["切换工作副本 URL。"],
          issues: [],
          canExecute: true,
          destructive: true,
        },
      },
    };
    render(RepositoryModule, {
      snapshot,
      taskId: "repository/switch",
      onAction,
    });
    const execute = screen.getByRole("button", {
      name: "确认执行切换工作副本",
    });
    expect(execute).toBeDisabled();
    await fireEvent.click(screen.getByRole("checkbox"));
    expect(execute).toBeEnabled();
    await fireEvent.click(execute);
    expect(onAction).toHaveBeenCalledWith("repository/execute-advanced", {
      previewToken: "switch-1",
    });
  });

  it("仓库浏览器只把用户选择的 URL 发送给 Host", async () => {
    const onAction = vi.fn();
    const snapshot: RepositorySnapshot = {
      kind: "repository",
      info: { name: "repo", url: "file:///repo/trunk", revision: "5" },
      properties: { available: true, target: ".", items: [] },
      cleanup: { available: true, target: "." },
      advanced: {
        browser: {
          url: "file:///repo/trunk",
          entries: [{ name: "src", kind: "dir" }],
        },
      },
    };
    render(RepositoryModule, {
      snapshot,
      taskId: "repository/browse",
      onAction,
    });
    await fireEvent.click(await screen.findByRole("button", { name: /src/ }));
    expect(onAction).toHaveBeenCalledWith("repository/browse", {
      url: "file:///repo/trunk/src",
    });
  });
});
