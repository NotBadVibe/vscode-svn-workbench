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
    // v0.0.10：行是“属性名 + 值”按钮（读屏名无分隔拼接），另有行内
    // 复制按钮；用属性名文本定位所在行按钮避免歧义。
    const propertyNameText = await screen.findByText("svn:ignore");
    const itemButton = propertyNameText.closest("button");
    expect(itemButton).not.toBeNull();
    await fireEvent.click(itemButton!);
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
    await fireEvent.click(
      await screen.findByRole("button", { name: "打开目录" }),
    );
    expect(onAction).toHaveBeenCalledWith("repository/browse", {
      url: "file:///repo/trunk/src",
    });
  });

  it("面包屑区分仓库根与项目根并可点击导航（v0.0.10）", async () => {
    const onAction = vi.fn();
    const snapshot: RepositorySnapshot = {
      kind: "repository",
      info: {
        name: "repo",
        url: "file:///repo/trunk/app",
        repositoryRoot: "file:///repo",
        revision: "5",
      },
      properties: { available: true, target: ".", items: [] },
      cleanup: { available: true, target: "." },
      advanced: {
        browser: {
          url: "file:///repo/trunk/app/src",
          entries: [],
        },
      },
    };
    render(RepositoryModule, {
      snapshot,
      taskId: "repository/browse",
      onAction,
    });
    // 仓库根与项目根都有文字标记，不只靠位置。
    expect(await screen.findByText("仓库根")).toBeInTheDocument();
    expect(screen.getByText("项目根")).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: /项目根/ }));
    expect(onAction).toHaveBeenCalledWith("repository/browse", {
      url: "file:///repo/trunk/app",
    });
  });

  it("仓库条目支持名称筛选与目录优先排序（v0.0.10）", async () => {
    const onAction = vi.fn();
    const snapshot: RepositorySnapshot = {
      kind: "repository",
      info: { name: "repo", url: "file:///repo/trunk", revision: "5" },
      properties: { available: true, target: ".", items: [] },
      cleanup: { available: true, target: "." },
      advanced: {
        browser: {
          url: "file:///repo/trunk",
          entries: [
            { name: "zeta.ts", kind: "file", size: 12, revision: "9" },
            { name: "alpha", kind: "dir", revision: "8" },
            { name: "beta.ts", kind: "file", size: 40, revision: "7" },
          ],
        },
      },
    };
    render(RepositoryModule, {
      snapshot,
      taskId: "repository/browse",
      onAction,
    });
    expect(await screen.findByText("3 个条目")).toBeInTheDocument();
    // 目录优先：目录排在文件前。
    const firstRow = document.querySelector(".browser-entry");
    expect(firstRow).toHaveTextContent("alpha");
    const input = screen.getByRole("textbox", { name: "筛选仓库条目" });
    await fireEvent.input(input, { target: { value: "ts" } });
    expect(screen.getByText("2 个条目")).toBeInTheDocument();
    expect(screen.queryByText("alpha")).toBeNull();
    await fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
    expect(screen.getByText("3 个条目")).toBeInTheDocument();
  });
});
