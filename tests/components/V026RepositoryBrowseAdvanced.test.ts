import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import RepositoryModule from "../../src/webview/features/repository/RepositoryModule.svelte";
import AdvancedTask from "../../src/webview/features/repository/tasks/AdvancedTask.svelte";
import type { RepositorySnapshot } from "../../src/protocol/workbenchProtocol";

function browseSnapshot(
  overrides: Partial<RepositorySnapshot["advanced"]> = {},
): RepositorySnapshot {
  return {
    kind: "repository",
    info: {
      name: "repo",
      revision: "5",
      url: "file:///repo/trunk/app",
      repositoryRoot: "file:///repo",
    },
    properties: { available: true, target: ".", items: [] },
    cleanup: { available: true, target: "." },
    advanced: {
      browser: {
        url: "file:///repo/trunk/app",
        parentUrl: "file:///repo/trunk",
        entries: [
          { name: "main.ts", kind: "file", revision: "42", author: "dev" },
          { name: "lib", kind: "dir", revision: "41", author: "dev" },
        ],
        revision: "42",
        repositoryRoot: "file:///repo",
        projectUrl: "file:///repo/trunk/app",
        lastGoodUrl: "file:///repo/trunk/app",
      },
      ...overrides,
    },
  };
}

describe("V026-R46 仓库浏览只读出口", () => {
  it("展示远端修订与本地工作副本关系", async () => {
    render(RepositoryModule, {
      snapshot: browseSnapshot(),
      taskId: "repository/browse",
      onAction: vi.fn(),
    });
    expect(await screen.findByText(/正在浏览远端/)).toBeInTheDocument();
    expect(screen.getByText(/本地工作副本 r5/)).toBeInTheDocument();
  });

  it("文件行提供查看内容/历史/比较修订与复制 URL", async () => {
    const onAction = vi.fn();
    render(RepositoryModule, {
      snapshot: browseSnapshot(),
      taskId: "repository/browse",
      onAction,
    });
    await screen.findByRole("button", { name: "查看内容" });
    await fireEvent.click(
      screen.getAllByRole("button", { name: "查看内容" })[0],
    );
    expect(onAction).toHaveBeenCalledWith("repository/preview-remote-file", {
      url: "file:///repo/trunk/app/main.ts",
      revision: "42",
    });
    await fireEvent.click(
      screen.getAllByRole("button", { name: "查看历史" })[0],
    );
    expect(onAction).toHaveBeenCalledWith("repository/query-remote-history", {
      url: "file:///repo/trunk/app/main.ts",
    });
    // 复制 URL 恢复出口保留。
    await fireEvent.click(
      screen.getAllByRole("button", { name: "复制 URL" })[0],
    );
    expect(onAction).toHaveBeenCalledWith("copy-text", {
      text: "file:///repo/trunk/app/main.ts",
    });
  });

  it("远端内容/历史/比较只读展示且无本地写操作", async () => {
    render(RepositoryModule, {
      snapshot: browseSnapshot({
        remoteFile: {
          url: "file:///repo/trunk/app/main.ts",
          revision: "42",
          sourceLabel:
            "远端只读：file:///repo/trunk/app/main.ts@r42（未写入本地）",
          contentPreview: "console.log(1);",
        },
        remoteHistory: {
          url: "file:///repo/trunk/app/main.ts",
          revisions: [{ revision: "42", author: "dev", message: "fix" }],
        },
        remoteCompare: {
          url: "file:///repo/trunk/app/main.ts",
          fromRevision: "41",
          toRevision: "42",
          diffPreview: "--- a\n+++ b\n",
        },
      }),
      taskId: "repository/browse",
      onAction: vi.fn(),
    });
    expect(await screen.findByText("远端内容（只读）")).toBeInTheDocument();
    expect(screen.getByText("console.log(1);")).toBeInTheDocument();
    expect(screen.getByText(/远端历史（只读/)).toBeInTheDocument();
    expect(screen.getByText("远端修订比较（只读）")).toBeInTheDocument();
    // 比较区明确只读、无本地路径操作。
    expect(screen.getByText(/只读，无本地路径操作/)).toBeInTheDocument();
  });

  it("二进制与失败保留导航状态并给出返回出口", async () => {
    const onAction = vi.fn();
    render(RepositoryModule, {
      snapshot: browseSnapshot({
        browser: {
          url: "file:///repo/trunk/missing",
          entries: [{ name: "main.ts", kind: "file", revision: "42" }],
          error: "无法读取仓库目录：权限不足。",
          lastGoodUrl: "file:///repo/trunk/app",
        },
        remoteFile: {
          url: "file:///repo/trunk/app/bin.dat",
          sourceLabel: "远端只读：file:///repo/trunk/app/bin.dat",
          binary: true,
          error:
            "二进制文件不在工作台内预览正文，可复制 URL 后用外部工具打开。",
        },
      }),
      taskId: "repository/browse",
      onAction,
    });
    expect(await screen.findByText(/权限不足/)).toBeInTheDocument();
    // 旧条目保留（导航状态未丢）。
    expect(screen.getByText("main.ts")).toBeInTheDocument();
    await fireEvent.click(
      screen.getByRole("button", { name: "返回上次有效位置" }),
    );
    expect(onAction).toHaveBeenCalledWith("repository/browse", {
      url: "file:///repo/trunk/app",
    });
    expect(screen.getByText(/二进制文件不在工作台内预览/)).toBeInTheDocument();
  });
});

describe("V026-R43 高级操作对象选择", () => {
  it("可用当前浏览位置填充源/目标并组合常用路径", async () => {
    const onAction = vi.fn();
    render(RepositoryModule, {
      snapshot: browseSnapshot(),
      taskId: "repository/branch",
      onAction,
    });
    const useSource = await screen.findByRole("button", {
      name: "使用当前浏览位置填入源",
    });
    await fireEvent.click(useSource);
    const preview = screen.getByRole("button", { name: /生成创建分支/ });
    await fireEvent.click(preview);
    expect(onAction).toHaveBeenCalledWith(
      "repository/preview-advanced",
      expect.objectContaining({
        operation: "branch",
        source: expect.objectContaining({ origin: "browse" }),
      }),
    );
    // 常用路径组合。
    const nameInput = screen.getByLabelText("分支名称");
    await fireEvent.input(nameInput, { target: { value: "feature-1" } });
    await fireEvent.click(
      screen.getByRole("button", { name: "组合为目标 URL" }),
    );
    await fireEvent.click(preview);
    expect(onAction).toHaveBeenCalledWith(
      "repository/preview-advanced",
      expect.objectContaining({
        target: expect.objectContaining({ origin: "shortcut" }),
      }),
    );
  });

  it("源/目标变化后旧预览立即作废", async () => {
    const onAction = vi.fn();
    const snapshot = browseSnapshot({
      preview: {
        token: "branch-old",
        operation: "branch",
        title: "创建分支",
        commands: ["svn copy …"],
        details: ["源：file:///repo/trunk/app"],
        issues: [],
        canExecute: true,
        destructive: false,
        sourceUrl: "file:///repo/trunk/app",
        targetUrl: "file:///repo/branches/old",
      },
    });
    const { rerender } = render(RepositoryModule, {
      snapshot,
      taskId: "repository/branch",
      onAction,
    });
    // 表单初始源与预览一致时不作废；改动目标后自动作废旧预览。
    const targetInput = await screen.findByPlaceholderText(
      "…/branches/feature-name",
    );
    await fireEvent.input(targetInput, {
      target: { value: "file:///repo/branches/new" },
    });
    expect(await screen.findByText(/旧预览已自动作废/)).toBeInTheDocument();
    expect(onAction).toHaveBeenCalledWith(
      "repository/discard-advanced-preview",
      expect.objectContaining({ operation: "branch" }),
    );
    await rerender({ snapshot, taskId: "repository/branch", onAction });
  });
});

describe("V026-R43 Switch 预览失效只看真实改动", () => {
  const switchTarget =
    "https://svn.example.test/repos/workbench/branches/feature";
  function switchPreview(): RepositorySnapshot {
    return browseSnapshot({
      preview: {
        token: "switch-1",
        operation: "switch",
        title: "切换工作副本",
        commands: ["svn switch …"],
        details: [
          `目标：${switchTarget}`,
          "只修改当前工作副本；不会自动提交。",
        ],
        issues: [],
        canExecute: true,
        destructive: true,
        targetUrl: switchTarget,
      },
    });
  }

  it("归一化等价输入（尾斜杠）不误伤旧预览", async () => {
    const onAction = vi.fn();
    const { rerender } = render(AdvancedTask, {
      snapshot: browseSnapshot(),
      taskId: "repository/switch",
      onAction,
    });
    await fireEvent.input(await screen.findByLabelText("目标 URL"), {
      target: { value: `${switchTarget}/` },
    });
    // 模拟预览生成后快照到达：表单值与绑定归一化一致，不得作废。
    await rerender({
      snapshot: switchPreview(),
      taskId: "repository/switch",
      onAction,
    });
    await tick();
    expect(screen.queryByText(/旧预览已自动作废/)).not.toBeInTheDocument();
    expect(onAction).not.toHaveBeenCalledWith(
      "repository/discard-advanced-preview",
      expect.anything(),
    );
  });

  it("真实改动目标后旧预览作废并要求重预览", async () => {
    const onAction = vi.fn();
    const { rerender } = render(AdvancedTask, {
      snapshot: browseSnapshot(),
      taskId: "repository/switch",
      onAction,
    });
    await fireEvent.input(await screen.findByLabelText("目标 URL"), {
      target: { value: switchTarget },
    });
    await rerender({
      snapshot: switchPreview(),
      taskId: "repository/switch",
      onAction,
    });
    await tick();
    expect(onAction).not.toHaveBeenCalledWith(
      "repository/discard-advanced-preview",
      expect.anything(),
    );
    await fireEvent.input(screen.getByLabelText("目标 URL"), {
      target: { value: `${switchTarget}-v2` },
    });
    expect(await screen.findByText(/旧预览已自动作废/)).toBeInTheDocument();
    expect(onAction).toHaveBeenCalledWith(
      "repository/discard-advanced-preview",
      { operation: "switch", reason: "source-target-changed" },
    );
  });
});
