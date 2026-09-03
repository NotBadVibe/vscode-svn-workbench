import { fireEvent, render, screen, within } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import RepositoryModule from "../../src/webview/features/repository/RepositoryModule.svelte";
import { saveListPreferences } from "../../src/webview/app/listPreferences";
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
    // v0.1.5 V015-C3b 应修 5：复述框 placeholder 用缺省文案，不透传答案。
    expect(challenge).toHaveAttribute(
      "placeholder",
      "与预览目标完全一致，含协议与路径",
    );
    // 尾斜杠 + 主机大小写归一化后放行（路径保持小写一致）。
    await fireEvent.input(challenge, {
      target: { value: "HTTPS://SVN.EXAMPLE.TEST/repos/workbench/" },
    });
    expect(confirm!).toBeEnabled();
    // v0.1.5 V015-C3b 应修 6：路径大小写不一致拒绝。
    await fireEvent.input(challenge, {
      target: { value: "https://svn.example.test/Repos/workbench" },
    });
    expect(confirm!).toBeDisabled();
    await fireEvent.input(challenge, {
      target: { value: target },
    });
    expect(confirm!).toBeEnabled();
    await fireEvent.click(confirm!);
    expect(onAction).toHaveBeenCalledWith("repository/execute-advanced", {
      previewToken: "relocate-1",
    });
  });

  it("V015-C3b 应修 4：Relocate 无新根期望目标显式禁执行", async () => {
    const missingSnapshot: RepositorySnapshot = {
      kind: "repository",
      info: { name: "repo", revision: "5" },
      properties: { available: true, target: ".", items: [] },
      cleanup: { available: true, target: "." },
      advanced: {
        preview: {
          token: "relocate-missing",
          operation: "relocate",
          title: "重定位仓库根地址",
          commands: ["svn switch --relocate …"],
          details: ["旧根：https://old.example.test/repo"],
          issues: [],
          canExecute: true,
          destructive: true,
        },
      },
    };
    const onAction = vi.fn();
    render(RepositoryModule, {
      snapshot: missingSnapshot,
      taskId: "repository/relocate",
      onAction,
    });
    await fireEvent.click(
      screen.getByRole("button", { name: "确认执行重定位仓库地址" }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "重定位仓库根地址",
    });
    // 无复述挑战（解析不到目标），且意向单显式禁执行并提示重新预览。
    expect(within(dialog).queryByLabelText("复述新的仓库根 URL")).toBeNull();
    expect(
      within(dialog).getByText(/未解析到新根地址，请重新预览/),
    ).toBeInTheDocument();
    const confirm = within(dialog)
      .getAllByRole("button")
      .find((b) => b.textContent?.includes("确认执行重定位仓库地址")) as
      HTMLElement | undefined;
    expect(confirm).toBeDefined();
    expect(confirm!).toBeDisabled();
  });

  it("V015-C3a 高级操作意向单提供重新检查：关闭后用既有输入重发预览", async () => {
    const onAction = vi.fn();
    const sourceUrl = "https://svn.example.test/repos/workbench/trunk";
    const targetUrl = "https://svn.example.test/repos/workbench/branches/next";
    type AdvancedPreview = NonNullable<
      RepositorySnapshot["advanced"]["preview"]
    >;
    const branchPreview = (
      overrides: Partial<AdvancedPreview> = {},
    ): AdvancedPreview => ({
      token: "branch-1",
      operation: "branch",
      title: "创建分支",
      commands: ["svn copy …"],
      details: [
        `源：${sourceUrl}`,
        `目标：${targetUrl}`,
        "直接在仓库端创建，不包含未提交的本地修改。",
      ],
      issues: [],
      canExecute: true,
      destructive: false,
      ...overrides,
    });
    const baseSnapshot: RepositorySnapshot = {
      kind: "repository",
      info: { name: "repo", revision: "5" },
      properties: { available: true, target: ".", items: [] },
      cleanup: { available: true, target: "." },
      advanced: { preview: branchPreview() },
    };
    const { rerender } = render(RepositoryModule, {
      snapshot: baseSnapshot,
      taskId: "repository/branch",
      onAction,
    });
    await fireEvent.click(
      screen.getByRole("button", { name: "确认执行创建分支" }),
    );
    expect(
      screen.getByRole("dialog", { name: "创建分支" }),
    ).toBeInTheDocument();
    // 可执行时不提供重新检查；快照变脏（不可执行）后出现（§3.3 过期只读）。
    expect(screen.queryByRole("button", { name: "重新检查" })).toBeNull();
    await rerender({
      snapshot: {
        ...baseSnapshot,
        advanced: {
          preview: branchPreview({
            canExecute: false,
            issues: ["目标 URL 已被占用，请更换后重新检查。"],
          }),
        },
      },
      taskId: "repository/branch",
      onAction,
    });
    await fireEvent.click(screen.getByRole("button", { name: "重新检查" }));
    // 用既有输入（operation + 源/目标）重发预览，不直接执行。
    expect(onAction).toHaveBeenCalledWith("repository/preview-advanced", {
      operation: "branch",
      sourceUrl,
      targetUrl,
    });
    expect(onAction).not.toHaveBeenCalledWith(
      "repository/execute-advanced",
      expect.anything(),
    );
  });

  // v0.1.5 V015-D2：页内 H1 与 ScopeBar H1 逐字重复已删（任务标题由 ScopeBar 表达）。
  it("页内不重复任务 H1；子任务标题保持 h2 层级", async () => {
    render(RepositoryModule, {
      snapshot: {
        kind: "repository",
        info: { name: "repo", revision: "5" },
        properties: { available: true, target: ".", items: [] },
        cleanup: { available: true, target: "." },
        advanced: {},
      },
      taskId: "repository/browse",
      onAction: vi.fn(),
    });
    // 子任务异步加载完成后，页内只有 h2（仓库浏览器），没有第二个 H1。
    await screen.findByRole("heading", { name: "仓库浏览器" });
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(screen.getByRole("heading", { name: "仓库浏览器" }).tagName).toBe(
      "H2",
    );
  });

  // v0.1.5 V015-D2：hero 卡不再重复仓库名与工作副本 rN（ScopeBar 已表达）。
  it("hero 卡仅保留仓库地址与复制出口，不重复仓库名/rN", async () => {
    render(RepositoryModule, {
      snapshot: {
        kind: "repository",
        info: {
          name: "workbench-repo",
          url: "https://svn.example.test/repos/workbench",
          revision: "42",
        },
        properties: { available: true, target: ".", items: [] },
        cleanup: { available: true, target: "." },
        advanced: {},
      },
      taskId: "repository/browse",
      onAction: vi.fn(),
    });
    await screen.findByRole("heading", { name: "仓库浏览器" });
    expect(screen.queryByText("workbench-repo")).toBeNull();
    expect(screen.queryByText(/工作副本 r42/)).toBeNull();
    expect(
      screen.getByText("https://svn.example.test/repos/workbench"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "复制仓库 URL" }),
    ).toBeInTheDocument();
  });

  // v0.1.5 V015-D2：默认入口为 Browse；当前 task 所在组始终可见。
  it("默认入口为浏览仓库；折叠偏好下当前任务所在组仍强制可见", async () => {
    const browseSnapshot: RepositorySnapshot = {
      kind: "repository",
      info: { name: "repo", revision: "5" },
      properties: { available: true, target: ".", items: [] },
      cleanup: { available: true, target: "." },
      advanced: {},
    };
    // 省略 taskId：默认进入浏览仓库。
    const first = render(RepositoryModule, {
      snapshot: browseSnapshot,
      onAction: vi.fn(),
    });
    expect(
      await first.findByRole("button", { name: "浏览仓库" }),
    ).toHaveAttribute("aria-current", "page");
    first.unmount();
    // 即使偏好折叠了危险操作组，当前任务（重定位）所在组仍强制展开。
    saveListPreferences("repository", { expandedGroups: ["integration"] });
    render(RepositoryModule, {
      snapshot: browseSnapshot,
      taskId: "repository/relocate",
      onAction: vi.fn(),
    });
    const dangerous = screen.getByRole("group", {
      name: /危险操作（2 个任务）/,
    });
    expect(
      dangerous
        .querySelector(".task-group__toggle")
        ?.getAttribute("aria-expanded"),
    ).toBe("true");
    expect(
      within(dangerous).getByRole("button", { name: "重定位" }),
    ).toHaveAttribute("aria-current", "page");
  });

  // v0.1.5 V015-D2：危险操作不被“最近使用”提升为全局主动作（无此类机制）。
  it("危险操作无最近使用提升：分组内直达，无全局主动作", async () => {
    const onAction = vi.fn();
    render(RepositoryModule, {
      snapshot: {
        kind: "repository",
        info: { name: "repo", revision: "5" },
        properties: { available: true, target: ".", items: [] },
        cleanup: { available: true, target: "." },
        advanced: {},
      },
      taskId: "repository/browse",
      onAction,
    });
    await screen.findByRole("heading", { name: "仓库浏览器" });
    expect(screen.queryByText(/最近使用/)).toBeNull();
    // 切换/重定位只出现在危险操作分组内，不在分组外另设主动作。
    const outsideDangerous = screen
      .queryAllByRole("button", { name: "切换" })
      .filter((button) => !button.closest('[data-task-group="dangerous"]'));
    expect(outsideDangerous).toHaveLength(0);
  });
});
