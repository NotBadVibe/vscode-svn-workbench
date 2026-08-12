import { readFileSync } from "node:fs";
import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DiffSnapshot } from "../../src/protocol/workbenchProtocol";
import type { DiffSubsetLanguage } from "../../src/webview/features/diff/diffLanguage";
import {
  DIFF_LANGUAGE_SUBSET,
  mapToDiffLanguage,
} from "../../src/webview/features/diff/diffLanguage";
import { applyStyleDeclarations } from "../../src/webview/features/diff/cspCompatObserver";

/*
 * DiffModule/DiffView 组件测试（v0.0.4 阶段 1）。
 *
 * jsdom 限制说明：@pierre/diffs 的 FileDiff 是 Shadow DOM Web Component，
 * 构造依赖 ResizeObserver、adoptedStyleSheets 等 jsdom 不具备的浏览器能力，
 * 因此此处用 vi.mock 替换 @pierre/diffs，验证适配层的输入组装、视图切换、
 * 折叠控制与失败降级链路；真实挂载、主题映射与 CSP 垫片由
 * tests/spike（真实严格 CSP）与 tests/webview-e2e（真实 Chromium）覆盖。
 */
interface FakeRenderRecord {
  options: Record<string, unknown>;
  props: Record<string, unknown>;
}

const pierreMocks = vi.hoisted(() => {
  const records: FakeRenderRecord[] = [];
  const state = {
    failRender: null as Error | null,
    instanceCount: 0,
    cleanupCount: 0,
  };
  return { records, state };
});

vi.mock("@pierre/diffs", () => {
  class FakeFileDiff {
    readonly options: Record<string, unknown>;
    cleanedUp = false;
    constructor(options: Record<string, unknown>) {
      pierreMocks.state.instanceCount += 1;
      this.options = options;
    }
    render(props: Record<string, unknown>): boolean {
      if (pierreMocks.state.failRender !== null) {
        throw pierreMocks.state.failRender;
      }
      pierreMocks.records.push({ options: this.options, props });
      const container = props.containerWrapper as HTMLElement;
      const marker = document.createElement("div");
      marker.className = "fake-pierre-diff";
      container.appendChild(marker);
      return true;
    }
    cleanUp(): void {
      this.cleanedUp = true;
      pierreMocks.state.cleanupCount += 1;
    }
  }
  return {
    FileDiff: FakeFileDiff,
    parsePatchFiles: (text: string) =>
      text.includes("Index:")
        ? [{ files: [{ name: "src/extension.ts" }] }]
        : [],
    preloadHighlighter: () => Promise.resolve(),
  };
});

const editMock = vi.hoisted(() => {
  const instances: Array<{
    applyEdits: () => void;
    options: Record<string, unknown>;
  }> = [];
  const state = { text: "", onChangeCalls: 0, focusLine: 0 };
  return { state, instances };
});

vi.mock("@pierre/diffs/edit", () => {
  class FakeEditor {
    readonly options: Record<string, unknown>;
    constructor(options: Record<string, unknown>) {
      this.options = options;
      editMock.instances.push(this);
    }
    edit(): void {
      /* no-op */
    }
    getText(): string {
      return editMock.state.text;
    }
    focus(options?: { lineNumber?: number }): void {
      editMock.state.focusLine = options?.lineNumber ?? 0;
    }
    applyEdits(): void {
      editMock.state.onChangeCalls += 1;
      (this.options.onChange as () => void)?.();
    }
  }
  return { Editor: FakeEditor };
});

import DiffModule from "../../src/webview/features/diff/DiffModule.svelte";
import DiffModuleHarness, {
  type DiffModuleHarnessController,
} from "./harness/DiffModuleHarness.svelte";

const workingSnapshot: DiffSnapshot = {
  kind: "diff",
  relativePath: "src/extension.ts",
  original: "const a = 1;\n",
  modified: "const a = 2;\nconst b = 3;\n",
  language: "typescript",
  truncated: false,
  binary: false,
};

const svnPatch = `Index: src/extension.ts
===================================================================
--- src/extension.ts\t(revision 41)
+++ src/extension.ts\t(revision 42)
@@ -1 +1 @@
-old
+new
`;

const patchSnapshot: DiffSnapshot = {
  kind: "diff",
  relativePath: ". · r41 → r42",
  original: "",
  modified: svnPatch,
  language: "diff",
  truncated: false,
  binary: false,
  message: "修订比较 r41 → r42",
};

beforeEach(() => {
  pierreMocks.records.length = 0;
  pierreMocks.state.failRender = null;
  pierreMocks.state.instanceCount = 0;
  pierreMocks.state.cleanupCount = 0;
  editMock.instances.length = 0;
});

describe("DiffModule（@pierre/diffs 适配层）", () => {
  it("Working/BASE 场景以 old/new 全文挂载差异组件，默认分栏视图", async () => {
    render(DiffModule, { snapshot: workingSnapshot, onAction: vi.fn() });

    await waitFor(() => expect(pierreMocks.records).toHaveLength(1));
    const record = pierreMocks.records[0];
    expect(record.options.diffStyle).toBe("split");
    expect(record.options.expandUnchanged).toBe(false);
    expect(record.options.disableFileHeader).toBe(true);
    expect(record.options.diffIndicators).toBe("classic");
    const oldFile = record.props.oldFile as { name: string; contents: string };
    const newFile = record.props.newFile as { name: string; contents: string };
    expect(oldFile).toMatchObject({
      name: "src/extension.ts",
      contents: "const a = 1;\n",
      lang: "typescript",
    });
    expect(newFile).toMatchObject({
      name: "src/extension.ts",
      contents: "const a = 2;\nconst b = 3;\n",
      lang: "typescript",
    });
    expect(record.props.fileDiff).toBeUndefined();
    expect(screen.getByText("BASE ↔ 工作副本 · typescript")).toBeVisible();
  });

  it("视图切换按钮中文可达、aria 表达当前态，切换后以 unified 重新挂载", async () => {
    render(DiffModule, { snapshot: workingSnapshot, onAction: vi.fn() });
    await waitFor(() => expect(pierreMocks.records).toHaveLength(1));

    const group = screen.getByRole("group", {
      name: "差异视图切换与折叠控制",
    });
    const unifiedButton = screen.getByRole("button", { name: "统一视图" });
    const splitButton = screen.getByRole("button", { name: "分栏视图" });
    expect(group).toContainElement(unifiedButton);
    expect(splitButton).toHaveAttribute("aria-pressed", "true");
    expect(unifiedButton).toHaveAttribute("aria-pressed", "false");

    await fireEvent.click(unifiedButton);
    await waitFor(() => expect(pierreMocks.records).toHaveLength(2));
    expect(pierreMocks.records[1].options.diffStyle).toBe("unified");
    expect(unifiedButton).toHaveAttribute("aria-pressed", "true");
    expect(splitButton).toHaveAttribute("aria-pressed", "false");
  });

  it("提供键盘可达的“展开全部/折叠未变更”控制", async () => {
    render(DiffModule, { snapshot: workingSnapshot, onAction: vi.fn() });
    await waitFor(() => expect(pierreMocks.records).toHaveLength(1));

    const expandButton = screen.getByRole("button", { name: "展开全部" });
    const collapseButton = screen.getByRole("button", { name: "折叠未变更" });
    expect(collapseButton).toBeDisabled();

    await fireEvent.click(expandButton);
    await waitFor(() => expect(pierreMocks.records).toHaveLength(2));
    expect(pierreMocks.records[1].options.expandUnchanged).toBe(true);
    expect(expandButton).toBeDisabled();
    expect(collapseButton).toBeEnabled();

    await fireEvent.click(collapseButton);
    await waitFor(() => expect(pierreMocks.records).toHaveLength(3));
    expect(pierreMocks.records[2].options.expandUnchanged).toBe(false);
  });

  it("修订比较（language=diff）走 patch 直渲分支", async () => {
    render(DiffModule, { snapshot: patchSnapshot, onAction: vi.fn() });

    await waitFor(() => expect(pierreMocks.records).toHaveLength(1));
    const record = pierreMocks.records[0];
    expect(record.options.disableFileHeader).toBe(false);
    expect(record.props.oldFile).toBeUndefined();
    expect(record.props.newFile).toBeUndefined();
    expect(record.props.fileDiff).toMatchObject({ name: "src/extension.ts" });
    expect(screen.getByText("修订比较 r41 → r42")).toBeVisible();
    expect(document.querySelector(".unified-diff")).toBeNull();
  });

  it("patch 无法解析时降级为原始文本并给出中文提示", async () => {
    const badPatch: DiffSnapshot = {
      ...patchSnapshot,
      modified: "这不是合法的 unified diff 内容",
    };
    render(DiffModule, { snapshot: badPatch, onAction: vi.fn() });

    await screen.findByText("无法解析该修订比较的差异内容，已按原始文本显示。");
    const pre = document.querySelector(".unified-diff");
    expect(pre).not.toBeNull();
    expect(pre?.textContent).toContain("这不是合法的 unified diff 内容");
    expect(
      screen.queryByRole("button", { name: "统一视图" }),
    ).not.toBeInTheDocument();
  });

  it("组件挂载失败时降级到 MergeView 并显示中文降级提示", async () => {
    pierreMocks.state.failRender = new Error("模拟挂载失败");
    render(DiffModule, { snapshot: workingSnapshot, onAction: vi.fn() });

    await screen.findByText(
      "差异渲染组件加载失败，已切换为基础对比视图；语法高亮与视图切换暂不可用。",
    );
    expect(document.querySelector(".codemirror-merge-host")).not.toBeNull();
    expect(
      screen.queryByRole("button", { name: "统一视图" }),
    ).not.toBeInTheDocument();
  });

  it("挂载后把键盘焦点放入 Diff 区域", async () => {
    render(DiffModule, { snapshot: workingSnapshot, onAction: vi.fn() });
    await waitFor(() =>
      expect(document.activeElement).toHaveAttribute(
        "aria-label",
        `差异：${workingSnapshot.relativePath}`,
      ),
    );
  });

  it("Working/BASE 提供原生编辑器对比入口，修订比较不提供", async () => {
    const onAction = vi.fn();
    const { unmount } = render(DiffModule, {
      snapshot: workingSnapshot,
      onAction,
    });
    await fireEvent.click(
      screen.getByRole("button", { name: "在编辑器中对比" }),
    );
    expect(onAction).toHaveBeenCalledWith("diff/open-in-editor");
    unmount();

    render(DiffModule, { snapshot: patchSnapshot, onAction: vi.fn() });
    expect(
      screen.queryByRole("button", { name: "在编辑器中对比" }),
    ).not.toBeInTheDocument();
  });

  it("截断与二进制快照禁用原生编辑器对比入口", () => {
    const { unmount } = render(DiffModule, {
      snapshot: { ...workingSnapshot, truncated: true },
      onAction: vi.fn(),
    });
    expect(
      screen.getByRole("button", { name: "在编辑器中对比" }),
    ).toBeDisabled();
    unmount();

    render(DiffModule, {
      snapshot: { ...workingSnapshot, binary: true },
      onAction: vi.fn(),
    });
    expect(
      screen.getByRole("button", { name: "在编辑器中对比" }),
    ).toBeDisabled();
  });

  it("truncated/message 与二进制空状态行为不变", async () => {
    const truncatedSnapshot: DiffSnapshot = {
      ...workingSnapshot,
      truncated: true,
      message: "文件超过 5 MB，仅显示前 5 MB。",
    };
    const { unmount } = render(DiffModule, {
      snapshot: truncatedSnapshot,
      onAction: vi.fn(),
    });
    await screen.findByText("文件超过 5 MB，仅显示前 5 MB。");
    // 截断快照仍走组件渲染（与迁移前 MergeView 渲染截断内容行为一致）。
    await waitFor(() => expect(pierreMocks.records).toHaveLength(1));
    unmount();

    pierreMocks.records.length = 0;
    render(DiffModule, {
      snapshot: {
        ...workingSnapshot,
        binary: true,
        message: "检测到二进制内容，未向 Webview 发送文件正文。",
      },
      onAction: vi.fn(),
    });
    await screen.findByText("二进制文件无法进行文本对比");
    expect(pierreMocks.records).toHaveLength(0);
  });
});

describe("差异语言映射", () => {
  it("语言子集与规划 §10 清单一致", () => {
    expect([...DIFF_LANGUAGE_SUBSET]).toEqual([
      "typescript",
      "javascript",
      "java",
      "python",
      "c",
      "cpp",
      "go",
      "rust",
      "xml",
      "json",
      "yaml",
      "properties",
      "shell",
      "sql",
      "diff",
    ]);
  });

  it("规范名、别名与扩展名都能归一到子集语言", () => {
    const cases: Array<[string, string, DiffSubsetLanguage | "text"]> = [
      ["typescript", "src/a.ts", "typescript"],
      ["ts", "src/a.ts", "typescript"],
      ["tsx", "src/a.tsx", "typescript"],
      ["py", "src/a.py", "python"],
      ["rs", "src/a.rs", "rust"],
      ["sh", "scripts/a.sh", "shell"],
      ["yml", "ci/a.yml", "yaml"],
      ["diff", ". · r41 → r42", "diff"],
      ["unknown-lang", "src/a.go", "go"],
      ["markdown", "docs/a.md", "text"],
      ["", "README", "text"],
    ];
    for (const [language, path, expected] of cases) {
      expect(mapToDiffLanguage(language, path)).toBe(expected);
    }
  });
});

describe("主题映射层（存在性）", () => {
  it("diff-theme.css 声明 VS Code 变量到 --diffs-* 的映射", () => {
    // vitest 以仓库根为 cwd，直接按相对路径读取。
    const css = readFileSync("src/webview/styles/diff-theme.css", "utf8");
    // 行背景必须映射到不透明 gitDecoration 强调色（组件会再做 color-mix）。
    expect(css).toContain("--diffs-bg-addition-override");
    expect(css).toContain("--vscode-gitDecoration-addedResourceForeground");
    expect(css).toContain("--diffs-bg-deletion-override");
    expect(css).toContain("--vscode-gitDecoration-deletedResourceForeground");
    // High Contrast：对比边框映射存在，增删区域不只靠颜色区分。
    expect(css).toContain("--diffs-bg-separator-override");
    expect(css).toContain("--vscode-contrastBorder");
    // color-scheme 跟随 VS Code 主题类，驱动 pierre-dark/light 切换。
    expect(css).toContain("body.vscode-dark");
    expect(css).toContain("body.vscode-high-contrast");
    // 全局样式已引入映射层。
    const globalCss = readFileSync("src/webview/styles/global.css", "utf8");
    expect(globalCss).toContain('@import "./diff-theme.css"');
  });
});

describe("CSP 兼容垫片（jsdom 可覆盖部分）", () => {
  it("applyStyleDeclarations 逐条 setProperty 落地声明串", () => {
    const element = document.createElement("span");
    // 使用非 shorthand 属性，避免 jsdom 把 shorthand 展开为多条 longhand。
    applyStyleDeclarations(
      element.style,
      "color: rgb(1, 2, 3); display: block;;invalid",
    );
    expect(element.style.getPropertyValue("color")).toBe("rgb(1, 2, 3)");
    expect(element.style.getPropertyValue("display")).toBe("block");
    // 非法声明被跳过，不抛错。
    expect(element.style.length).toBe(2);
  });
});

describe("DiffModule 页内编辑（v0.0.6）", () => {
  const editSnapshot: DiffSnapshot = {
    kind: "diff",
    relativePath: "src/extension.ts",
    original: "const a = 1;\n",
    modified: "const a = 2;\nconst b = 3;\n",
    language: "typescript",
    truncated: false,
    binary: false,
    edit: { supported: true, targetId: "mock-target" },
  };

  const editSessionPayload = {
    targetId: "mock-target",
    editToken: "mock-token",
    draftRevision: 1,
    baseHash: "base",
    baseRevision: "BASE",
    rawHash: "raw",
    baseContents: "const a = 1;\n",
    message: "已进入页内编辑。",
  };

  beforeEach(() => {
    editMock.state.text = "";
    editMock.state.onChangeCalls = 0;
    editMock.state.focusLine = 0;
  });

  it("可编辑快照显示“页内编辑”，点击发起 diff/open-edit", async () => {
    const action = vi.fn();
    render(DiffModule, {
      snapshot: editSnapshot,
      onAction: action,
    });
    const button = await screen.findByRole("button", { name: "页内编辑" });
    await fireEvent.click(button);
    expect(action).toHaveBeenCalledWith("diff/open-edit");
  });

  it("存在草稿时显示恢复与导出入口", async () => {
    render(DiffModule, {
      snapshot: { ...editSnapshot, draft: { revision: 3, updatedAt: 1 } },
      onAction: vi.fn(),
    });
    expect(
      await screen.findByRole("button", { name: "恢复草稿并编辑" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "导出草稿补丁" })).toBeTruthy();
  });

  it("收到编辑会话后进入编辑态：显示保存、导航与还原块按钮", async () => {
    render(DiffModule, {
      snapshot: editSnapshot,
      onAction: vi.fn(),
      editSession: editSessionPayload,
    });
    expect(await screen.findByText("编辑模式")).toBeTruthy();
    expect(screen.getByRole("button", { name: "保存修改" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "下一个差异" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "还原当前差异块为 BASE" }),
    ).toBeTruthy();
  });

  it("编辑变化标记脏状态，Ctrl/Cmd+S 发起 diff/save-working", async () => {
    const action = vi.fn();
    render(DiffModule, {
      snapshot: editSnapshot,
      onAction: action,
      editSession: editSessionPayload,
    });
    await screen.findByText("编辑模式");
    // 真实编辑路径：DiffView onChange → 脏状态。fake editor 经
    // applyEdits（“还原此块”）触发 onChange，getText 返回编辑后文本。
    editMock.state.text = "const a = 9;\nconst b = 3;\n";
    await fireEvent.click(
      screen.getByRole("button", { name: "还原当前差异块为 BASE" }),
    );
    // 无脏状态时不允许保存（避免无谓消耗单次 token）。
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "s",
        ctrlKey: true,
        cancelable: true,
      }),
    );
    expect(action).toHaveBeenCalledWith(
      "diff/save-working",
      expect.objectContaining({
        targetId: "mock-target",
        editToken: "mock-token",
        expectedContentHash: "raw",
        content: "const a = 9;\nconst b = 3;\n",
      }),
    );
  });

  it("保存成功后用新 token 与新 hash 继续保存（连续保存不回退 diskChanged）", async () => {
    const action = vi.fn();
    const { rerender } = render(DiffModule, {
      snapshot: editSnapshot,
      onAction: action,
      editSession: { ...editSessionPayload },
    });
    await screen.findByText("编辑模式");
    editMock.state.text = "const a = 9;\nconst b = 3;\n";
    await fireEvent.click(
      screen.getByRole("button", { name: "还原当前差异块为 BASE" }),
    );
    // 第一次保存成功：Host 下发新 token 与新内容 hash；workbenchState 会
    // 把轮换后的基准应用回 editSession（此处以更新后的 props 模拟）。
    await rerender({
      snapshot: { ...editSnapshot, modified: "const a = 9;\nconst b = 3;\n" },
      onAction: action,
      editSession: {
        ...editSessionPayload,
        editToken: "token2",
        rawHash: "raw2",
        draftRevision: 5,
      },
      diffSaveResult: {
        result: {
          ok: true,
          acceptedRevision: 5,
          newContentHash: "raw2",
          newEditToken: "token2",
          snapshotVersion: 2,
        },
        snapshotVersion: 2,
      },
    });
    // 第二次编辑并保存：必须携带 token2 与 raw2，否则 Host 复验必拒绝。
    editMock.state.text = "const a = 10;\nconst b = 3;\n";
    await fireEvent.click(
      screen.getByRole("button", { name: "还原当前差异块为 BASE" }),
    );
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "s",
        ctrlKey: true,
        cancelable: true,
      }),
    );
    expect(action).toHaveBeenLastCalledWith(
      "diff/save-working",
      expect.objectContaining({
        editToken: "token2",
        expectedContentHash: "raw2",
        content: "const a = 10;\nconst b = 3;\n",
      }),
    );
  });

  it("生产消息时序：save-result 先到、snapshot 后刷新，第二次保存携带新基准", async () => {
    const action = vi.fn();
    const session = { ...editSessionPayload };
    const { rerender } = render(DiffModule, {
      snapshot: editSnapshot,
      onAction: action,
      editSession: session,
    });
    await screen.findByText("编辑模式");
    // 第一次编辑。
    editMock.state.text = "const a = 9;\nconst b = 3;\n";
    await fireEvent.click(
      screen.getByRole("button", { name: "还原当前差异块为 BASE" }),
    );
    // 时序第 1 步：仅 save-result 到达（snapshot 仍是旧内容）。
    await rerender({
      snapshot: editSnapshot,
      onAction: action,
      editSession: session,
      diffSaveResult: {
        result: {
          ok: true,
          acceptedRevision: 5,
          newContentHash: "raw2",
          newEditToken: "token2",
          snapshotVersion: 2,
        },
        snapshotVersion: 2,
      },
    });
    // 时序第 2 步：Host loadModule 刷新 snapshot（工作副本侧=新磁盘内容）；
    // workbenchState 已在 save-result 时轮换 editSession 基准。
    await rerender({
      snapshot: { ...editSnapshot, modified: "const a = 9;\nconst b = 3;\n" },
      onAction: action,
      editSession: {
        ...session,
        editToken: "token2",
        rawHash: "raw2",
        draftRevision: 5,
      },
      diffSaveResult: {
        result: {
          ok: true,
          acceptedRevision: 5,
          newContentHash: "raw2",
          newEditToken: "token2",
          snapshotVersion: 2,
        },
        snapshotVersion: 2,
      },
    });
    // 第二次真实编辑并保存：必须带 token2/raw2/acceptedRevision=5。
    editMock.state.text = "const a = 10;\nconst b = 3;\n";
    await fireEvent.click(
      screen.getByRole("button", { name: "还原当前差异块为 BASE" }),
    );
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "s",
        ctrlKey: true,
        cancelable: true,
      }),
    );
    expect(action).toHaveBeenLastCalledWith("diff/save-working", {
      targetId: "mock-target",
      editToken: "token2",
      draftRevision: 5,
      expectedContentHash: "raw2",
      content: "const a = 10;\nconst b = 3;\n",
    });
  });

  it("保存成功后内容回到刚保存文本时不误标 dirty", async () => {
    const action = vi.fn();
    const session = { ...editSessionPayload };
    const { rerender } = render(DiffModule, {
      snapshot: editSnapshot,
      onAction: action,
      editSession: session,
    });
    await screen.findByText("编辑模式");
    editMock.state.text = "const a = 9;\nconst b = 3;\n";
    await fireEvent.click(
      screen.getByRole("button", { name: "还原当前差异块为 BASE" }),
    );
    await expect(await screen.findByText(/有未保存的修改/)).toBeTruthy();
    // 保存成功（snapshot 随后刷新为新内容）。
    await rerender({
      snapshot: { ...editSnapshot, modified: "const a = 9;\nconst b = 3;\n" },
      onAction: action,
      editSession: session,
      diffSaveResult: {
        result: {
          ok: true,
          acceptedRevision: 5,
          newContentHash: "raw2",
          newEditToken: "token2",
          snapshotVersion: 2,
        },
        snapshotVersion: 2,
      },
    });
    // 编辑器内容回到刚保存的文本（用户撤销）：不应误标 dirty。
    editMock.state.text = "const a = 9;\nconst b = 3;\n";
    await fireEvent.click(
      screen.getByRole("button", { name: "还原当前差异块为 BASE" }),
    );
    expect(screen.queryByText(/有未保存的修改/)).toBeNull();
    expect(screen.getByRole("button", { name: "保存修改" })).toBeDisabled();
  });

  it("token 失效类拒绝提供“重新建立编辑会话”恢复动作", async () => {
    const action = vi.fn();
    render(DiffModule, {
      snapshot: editSnapshot,
      onAction: action,
      editSession: { ...editSessionPayload },
      diffSaveResult: {
        result: {
          ok: false,
          reason: "tokenExpired",
          message: "编辑令牌已失效。请刷新差异后重新编辑，草稿已保留。",
          recoverable: true,
          draftRevision: 2,
        },
        snapshotVersion: 1,
      },
    });
    await screen.findByText("编辑模式");
    // 编辑内容（脏）后点击恢复：先刷新检查点保留草稿，再重新 open-edit。
    editMock.state.text = "const a = 9;\nconst b = 3;\n";
    await fireEvent.click(
      screen.getByRole("button", { name: "还原当前差异块为 BASE" }),
    );
    const recover = await screen.findByRole("button", {
      name: "重新建立编辑会话（保留草稿）",
    });
    await fireEvent.click(recover);
    expect(action).toHaveBeenCalledWith(
      "diff/draft-checkpoint",
      expect.objectContaining({
        targetId: "mock-target",
        content: "const a = 9;\nconst b = 3;\n",
      }),
    );
    expect(action).toHaveBeenCalledWith("diff/open-edit");
  });

  it("保存拒绝显示中文原因与草稿版本", async () => {
    render(DiffModule, {
      snapshot: editSnapshot,
      onAction: vi.fn(),
      editSession: editSessionPayload,
      diffSaveResult: {
        result: {
          ok: false,
          reason: "writeFailed",
          message:
            "写入失败（磁盘满、权限不足或系统错误）；原文件未改动，草稿已保留。",
          recoverable: true,
          draftRevision: 2,
        },
        snapshotVersion: 1,
      },
    });
    await screen.findByText("编辑模式");
    expect(await screen.findByText(/保存被拒绝：写入失败/)).toBeTruthy();
    expect(screen.getByText(/草稿已保留，版本 2/)).toBeTruthy();
  });

  it("不支持编辑的快照给出中文原因且无编辑入口", async () => {
    render(DiffModule, {
      snapshot: {
        ...editSnapshot,
        edit: {
          supported: false,
          reason: "二进制文件不支持页内编辑；请使用原生编辑器。",
        },
      },
      onAction: vi.fn(),
    });
    expect(await screen.findByText(/二进制文件不支持页内编辑/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "页内编辑" })).toBeNull();
  });

  it("未修改的编辑会话收到切换确认时不弹对话框（自动暂存）", async () => {
    const action = vi.fn();
    render(DiffModule, {
      snapshot: editSnapshot,
      onAction: action,
      editSession: { ...editSessionPayload },
      targetSwitchRequest: {
        currentTargetId: "mock-target",
        nextRelativePath: "src/other.ts",
      },
    });
    await screen.findByText("编辑模式");
    // 无脏修改、无草稿：不出现三选一，自动回 stash。
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() =>
      expect(action).toHaveBeenCalledWith("diff/target-switch-decision", {
        decision: "stash",
        targetId: "mock-target",
      }),
    );
  });

  it("目标切换遇到脏草稿时提供三选一阻断对话框", async () => {
    const action = vi.fn();
    render(DiffModule, {
      snapshot: { ...editSnapshot, draft: { revision: 3, updatedAt: 1 } },
      onAction: action,
      editSession: { ...editSessionPayload },
      targetSwitchRequest: {
        currentTargetId: "mock-target",
        nextRelativePath: "src/other.ts",
      },
    });
    await screen.findByText("编辑模式");
    const dialog = await screen.findByRole("dialog", {
      name: "当前文件有未保存的草稿",
    });
    expect(dialog).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "保存并打开新文件" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "暂存并打开新文件" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "留在当前文件" })).toBeTruthy();
  });

  it("三选一：暂存并打开先刷新检查点再发送 stash 决定", async () => {
    const action = vi.fn();
    render(DiffModule, {
      snapshot: editSnapshot,
      onAction: action,
      editSession: { ...editSessionPayload },
      targetSwitchRequest: {
        currentTargetId: "mock-target",
        nextRelativePath: "src/other.ts",
      },
    });
    await screen.findByText("编辑模式");
    // 制造脏状态。
    editMock.state.text = "const a = 9;\nconst b = 3;\n";
    await fireEvent.click(
      screen.getByRole("button", { name: "还原当前差异块为 BASE" }),
    );
    await fireEvent.click(
      await screen.findByRole("button", { name: "暂存并打开新文件" }),
    );
    expect(action).toHaveBeenCalledWith(
      "diff/draft-checkpoint",
      expect.objectContaining({
        targetId: "mock-target",
        content: "const a = 9;\nconst b = 3;\n",
      }),
    );
    expect(action).toHaveBeenCalledWith("diff/target-switch-decision", {
      decision: "stash",
      targetId: "mock-target",
    });
  });

  it("三选一：保存并打开先刷新检查点再发送 save 决定（顺序保证最新内容）", async () => {
    const action = vi.fn();
    render(DiffModule, {
      snapshot: { ...editSnapshot, draft: { revision: 3, updatedAt: 1 } },
      onAction: action,
      editSession: { ...editSessionPayload },
      targetSwitchRequest: {
        currentTargetId: "mock-target",
        nextRelativePath: "src/other.ts",
      },
    });
    await screen.findByText("编辑模式");
    // 制造最新编辑（debounce 检查点尚未发出）立刻选择保存并打开。
    editMock.state.text = "const a = 9;\nconst b = 3;\n";
    await fireEvent.click(
      screen.getByRole("button", { name: "还原当前差异块为 BASE" }),
    );
    await fireEvent.click(
      await screen.findByRole("button", { name: "保存并打开新文件" }),
    );
    const checkpointIndex = action.mock.calls.findIndex(
      (call) => call[0] === "diff/draft-checkpoint",
    );
    const decisionIndex = action.mock.calls.findIndex(
      (call) =>
        call[0] === "diff/target-switch-decision" &&
        (call[1] as { decision?: string }).decision === "save",
    );
    // 检查点必须先于 save 决定发出，且内容是最新编辑文本。
    expect(checkpointIndex).toBeGreaterThanOrEqual(0);
    expect(decisionIndex).toBeGreaterThanOrEqual(0);
    expect(action.mock.invocationCallOrder[checkpointIndex]).toBeLessThan(
      action.mock.invocationCallOrder[decisionIndex],
    );
    expect(action.mock.calls[checkpointIndex][1]).toEqual(
      expect.objectContaining({ content: "const a = 9;\nconst b = 3;\n" }),
    );
    expect(action).toHaveBeenCalledWith("diff/target-switch-decision", {
      decision: "save",
      targetId: "mock-target",
    });
  });

  it("三选一：Escape 等同于留在当前文件", async () => {
    const action = vi.fn();
    render(DiffModule, {
      snapshot: { ...editSnapshot, draft: { revision: 3, updatedAt: 1 } },
      onAction: action,
      editSession: { ...editSessionPayload },
      targetSwitchRequest: {
        currentTargetId: "mock-target",
        nextRelativePath: "src/other.ts",
      },
    });
    const dialog = await screen.findByRole("dialog", {
      name: "当前文件有未保存的草稿",
    });
    await fireEvent.keyDown(dialog, { key: "Escape" });
    expect(action).toHaveBeenCalledWith("diff/target-switch-decision", {
      decision: "stay",
      targetId: "mock-target",
    });
  });
});

describe("DiffModule 编辑态快照刷新与 save-result 消费（v0.0.6 回归）", () => {
  const editSnapshot: DiffSnapshot = {
    kind: "diff",
    relativePath: "src/extension.ts",
    original: "const a = 1;\n",
    modified: "const a = 2;\nconst b = 3;\n",
    language: "typescript",
    truncated: false,
    binary: false,
    edit: { supported: true, targetId: "mock-target" },
  };
  const editSessionPayload = {
    targetId: "mock-target",
    editToken: "mock-token-1",
    draftRevision: 1,
    baseHash: "base",
    baseRevision: "BASE",
    rawHash: "mock-raw-hash",
    baseContents: "const a = 1;\n",
    message: "已进入页内编辑。",
  };
  const refreshed = {
    ...editSnapshot,
    modified: "const a = 2;\nconst b = 3;\n// 已保存\n",
  };

  function makeController(): DiffModuleHarnessController {
    return {
      setSnapshot: () => undefined,
      setEditSession: () => undefined,
      setDiffSaveResult: () => undefined,
    };
  }

  it("编辑态下权威快照内容刷新不重建编辑器/组件实例（挂载键保持）", async () => {
    const action = vi.fn();
    const controller = makeController();
    render(DiffModuleHarness, {
      initialSnapshot: editSnapshot,
      initialAction: action,
      initialEditSession: editSessionPayload,
      controller,
    });
    await screen.findByText("编辑模式");
    const mounts = pierreMocks.state.instanceCount;
    const cleans = pierreMocks.state.cleanupCount;
    expect(mounts).toBeGreaterThan(0);

    // Host 权威快照到达：同目标、内容变化（保存后正文）——原地更新 props。
    controller.setSnapshot(refreshed);
    await new Promise((resolve) => setTimeout(resolve, 40));
    // 编辑态：不应重建（instance/cleanup 计数不变，编辑器保持）。
    expect(pierreMocks.state.instanceCount).toBe(mounts);
    expect(pierreMocks.state.cleanupCount).toBe(cleans);
    // 编辑器实例仍保持（未重新创建）。
    expect(editMock.instances).toHaveLength(1);
  });

  it("只读态下权威快照刷新重建视图并采用新内容", async () => {
    const action = vi.fn();
    const controller = makeController();
    render(DiffModuleHarness, {
      initialSnapshot: editSnapshot,
      initialAction: action,
      controller,
    });
    await waitFor(() => expect(pierreMocks.records.length).toBeGreaterThan(0));
    controller.setSnapshot(refreshed);
    await waitFor(() =>
      expect(pierreMocks.state.instanceCount).toBeGreaterThan(1),
    );
    const last = pierreMocks.records[pierreMocks.records.length - 1];
    expect((last.props.newFile as { contents: string }).contents).toBe(
      refreshed.modified,
    );
  });

  it("旧 save-result 不因快照重渲染清除第二轮脏状态，保存用新 token/hash/revision", async () => {
    const action = vi.fn();
    const firstResult = {
      result: {
        ok: true,
        acceptedRevision: 2,
        newContentHash: "mock-hash-2",
        newEditToken: "mock-token-2",
        snapshotVersion: 1,
      },
      snapshotVersion: 1,
    };
    const controller = makeController();
    render(DiffModuleHarness, {
      initialSnapshot: editSnapshot,
      initialAction: action,
      initialEditSession: {
        ...editSessionPayload,
        editToken: "mock-token-2",
        draftRevision: 2,
        rawHash: "mock-hash-2",
      },
      initialDiffSaveResult: firstResult,
      controller,
    });
    await screen.findByText("编辑模式");
    expect(screen.queryByText(/有未保存的修改/)).toBeNull();
    // 第二轮编辑 → 脏。
    editMock.state.text = "const a = 9;\n";
    editMock.instances[0]?.applyEdits();
    // 等待 Svelte flush 后脏状态落屏。
    await waitFor(() =>
      expect(screen.queryByText(/有未保存的修改/)).toBeTruthy(),
    );

    // 同一旧 save-result 伴随权威快照重渲染：不得清除第二轮脏。
    controller.setSnapshot(refreshed);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(screen.getByText(/有未保存的修改/)).toBeTruthy();

    // 第二次保存使用轮换后的 token/hash/revision。
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "s",
        ctrlKey: true,
        cancelable: true,
      }),
    );
    expect(action).toHaveBeenCalledWith(
      "diff/save-working",
      expect.objectContaining({
        editToken: "mock-token-2",
        expectedContentHash: "mock-hash-2",
        draftRevision: 2,
      }),
    );
  });

  it("权威快照刷新清除 draft 与恢复入口", async () => {
    const action = vi.fn();
    const controller = makeController();
    const withDraft = { ...editSnapshot, draft: { revision: 1, updatedAt: 1 } };
    render(DiffModuleHarness, {
      initialSnapshot: withDraft,
      initialAction: action,
      controller,
    });
    expect(screen.getByRole("button", { name: "恢复草稿并编辑" })).toBeTruthy();
    controller.setSnapshot(refreshed);
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "恢复草稿并编辑" }),
      ).toBeNull(),
    );
  });
});
