import { fireEvent, render, screen, within } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import RepositoryModule from "../../src/webview/features/repository/RepositoryModule.svelte";
import type { RepositorySnapshot } from "../../src/protocol/workbenchProtocol";

describe("RepositoryModule", () => {
  it("任务导航按三组展示；危险操作默认折叠、点击展开（v0.0.17 批次 D）", async () => {
    const onAction = vi.fn();
    const snapshot: RepositorySnapshot = {
      kind: "repository",
      info: { name: "repo", revision: "5" },
      properties: { available: true, target: ".", items: [] },
      cleanup: { available: true, target: "." },
      advanced: {},
    };
    render(RepositoryModule, {
      snapshot,
      taskId: "repository/browse",
      onAction,
    });
    // 三组都以组标签呈现，页面保持单一主标题层级。
    expect(
      screen.getByRole("group", { name: /分支与集成（3 个任务）/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: /维护与迁移（5 个任务）/ }),
    ).toBeInTheDocument();
    const dangerous = screen.getByRole("group", {
      name: /危险操作（2 个任务）/,
    });
    // 默认展开“分支与集成”，危险操作折叠但可展开。
    expect(
      dangerous
        .querySelector(".task-group__toggle")
        ?.getAttribute("aria-expanded"),
    ).toBe("false");
    await fireEvent.click(
      within(dangerous).getByRole("button", { name: /危险操作/ }),
    );
    expect(
      dangerous
        .querySelector(".task-group__toggle")
        ?.getAttribute("aria-expanded"),
    ).toBe("true");
    // 分组内点击任务直达对应 module/task（范围不变）。
    await fireEvent.click(
      within(dangerous).getByRole("button", { name: "切换" }),
    );
    expect(onAction).toHaveBeenCalledWith("open-module", {
      moduleId: "repository",
      taskId: "repository/switch",
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

  it("Switch/Merge 无前置复选框：预览后直开意向单一次确认", async () => {
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
    // V015-C2：前置复选框已移除（Switch/Merge/Branch/Tag/Patch/Shelf 直开意向单）。
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(execute).toBeEnabled();
    await fireEvent.click(execute);
    // 批次 D：确认执行先打开通用操作意向单对话框
    expect(
      screen.getByRole("dialog", { name: "切换工作副本" }),
    ).toBeInTheDocument();
    const dialog = screen.getByRole("dialog", { name: "切换工作副本" });
    const confirmInDialog = Array.from(dialog.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("确认执行切换工作副本"),
    ) as HTMLElement;
    await fireEvent.click(confirmInDialog);
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

  it("Relocate 白名单：复述正确放行、错误拒绝、尾斜杠/大小写归一化", async () => {
    const target = "https://svn.example.test/repos/workbench";
    const relocateSnapshot: RepositorySnapshot = {
      kind: "repository",
      info: { name: "repo", revision: "5" },
      properties: { available: true, target: ".", items: [] },
      cleanup: { available: true, target: "." },
      advanced: {
        preview: {
          token: "relocate-1",
          operation: "relocate",
          title: "重定位仓库根地址",
          commands: ["svn switch --relocate …"],
          details: ["旧根：https://old.example.test/repo", `新根：${target}`],
          issues: [],
          canExecute: true,
          destructive: true,
        },
      },
    };
    const onAction = vi.fn();
    render(RepositoryModule, {
      snapshot: relocateSnapshot,
      taskId: "repository/relocate",
      onAction,
    });
    // 预览侧无复选框，直开意向单。
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    await fireEvent.click(
      screen.getByRole("button", { name: "确认执行重定位仓库地址" }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "重定位仓库根地址",
    });
    const challenge = within(dialog).getByLabelText("复述新的仓库根 URL");
    const confirm = within(dialog)
      .getAllByRole("button")
      .find((b) => b.textContent?.includes("确认执行重定位仓库地址")) as
      HTMLElement | undefined;
    expect(confirm).toBeDefined();
    // 初始未复述禁止确认。
    expect(confirm!).toBeDisabled();
    // 错误复述拒绝。
    await fireEvent.input(challenge, {
      target: { value: "https://wrong.example.test/other" },
    });
    expect(confirm!).toBeDisabled();
    expect(
      within(dialog).getByText(/复述目标与预览的新根地址不一致/),
    ).toBeInTheDocument();
    // 尾斜杠 + 大小写归一化后放行。
    await fireEvent.input(challenge, {
      target: { value: `${target.toUpperCase()}/` },
    });
    expect(confirm!).toBeEnabled();
    await fireEvent.click(confirm!);
    expect(onAction).toHaveBeenCalledWith("repository/execute-advanced", {
      previewToken: "relocate-1",
    });
  });
});
