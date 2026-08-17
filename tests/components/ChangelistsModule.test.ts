import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import ChangelistsModule from "../../src/webview/features/changelists/ChangelistsModule.svelte";
import type {
  ChangelistsSnapshot,
  WorkbenchFileView,
} from "../../src/protocol/workbenchProtocol";

/*
 * v0.0.10 跨模块列表迁移：变更集/未分组复用共享底座——搜索、状态排序、
 * 手动多选与“选择当前筛选”、批量移入/移出走既有 preview-apply 令牌流程、
 * 分组折叠与匹配数量、路径详情。
 */

const groupFile = (
  path: string,
  overrides: Partial<WorkbenchFileView> = {},
): WorkbenchFileView => ({
  relativePath: path,
  selectionKey: `test-wc::${path}` as never,
  status: "modified",
  selection: "selected",
  ...overrides,
});

function buildSnapshot(
  overrides: Partial<ChangelistsSnapshot> = {},
): ChangelistsSnapshot {
  return {
    kind: "changelists",
    source: "local-rule",
    aiPrivacy: {
      model: "local",
      fileLimit: 120,
      data: "metadata",
      historyIncluded: false,
    },
    groups: [
      {
        name: "ui",
        files: [
          groupFile("src/webview/a.ts"),
          groupFile("src/webview/b.ts", { status: "added" }),
        ],
      },
    ],
    unassigned: [groupFile("docs/readme.md", { status: "unversioned" })],
    suggestions: [],
    warnings: [],
    ...overrides,
  };
}

describe("ChangelistsModule", () => {
  it("仅在预览通过后使用令牌应用", async () => {
    const onAction = vi.fn();
    const snapshot: ChangelistsSnapshot = {
      kind: "changelists",
      source: "local-rule",
      aiPrivacy: {
        model: "local",
        fileLimit: 120,
        data: "metadata",
        historyIncluded: false,
      },
      groups: [],
      unassigned: [],
      suggestions: [],
      warnings: [],
      preview: {
        token: "cl-1",
        name: "ui",
        remove: false,
        paths: ["src/a.ts"],
        command: 'svn changelist "ui" "src/a.ts"',
        canExecute: true,
        issues: [],
      },
    };
    render(ChangelistsModule, { snapshot, onAction });
    await fireEvent.click(
      screen.getByRole("button", { name: "确认应用变更集" }),
    );
    expect(onAction).toHaveBeenCalledWith("changelist/execute-apply", {
      previewToken: "cl-1",
    });
  });

  it("搜索过滤分组与未分组文件并播报结果数量", async () => {
    render(ChangelistsModule, {
      snapshot: buildSnapshot(),
      onAction: vi.fn(),
    });
    expect(screen.getByText("3 个结果")).toBeInTheDocument();
    const input = screen.getByRole("textbox", { name: "筛选变更集文件" });
    await fireEvent.input(input, { target: { value: "webview" } });
    expect(screen.getByText("2 个结果")).toBeInTheDocument();
    // PathCell 分两行显示文件名与父目录；未命中的未分组文件不渲染。
    expect(screen.queryByText("readme.md")).toBeNull();
    await fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
    expect(screen.getByText("3 个结果")).toBeInTheDocument();
    expect(screen.getByText("readme.md")).toBeInTheDocument();
  });

  it("多选后批量移出只提交属于变更集的路径", async () => {
    const onAction = vi.fn();
    render(ChangelistsModule, {
      snapshot: buildSnapshot(),
      onAction,
    });
    await fireEvent.click(
      screen.getByRole("checkbox", { name: "选择 src/webview/a.ts" }),
    );
    await fireEvent.click(
      screen.getByRole("checkbox", { name: "选择 docs/readme.md" }),
    );
    // 移出按钮只统计已选且属于变更集的文件（未分组文件不算）。
    const removeButton = screen.getByRole("button", {
      name: "移出变更集（1）",
    });
    await fireEvent.click(removeButton);
    expect(onAction).toHaveBeenCalledWith("changelist/preview-apply", {
      remove: true,
      paths: ["src/webview/a.ts"],
    });
  });

  it("“选择当前筛选”只选择筛选命中的可选项且幂等", async () => {
    const onAction = vi.fn();
    render(ChangelistsModule, {
      snapshot: buildSnapshot(),
      onAction,
    });
    const input = screen.getByRole("textbox", { name: "筛选变更集文件" });
    await fireEvent.input(input, { target: { value: "webview" } });
    const selectFiltered = screen.getByRole("button", {
      name: "选择当前筛选（2）",
    });
    await fireEvent.click(selectFiltered);
    expect(
      (
        screen.getByRole("checkbox", {
          name: "选择 src/webview/a.ts",
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);
    // 连按不反向清空（幂等）。
    await fireEvent.click(selectFiltered);
    expect(
      (
        screen.getByRole("checkbox", {
          name: "选择 src/webview/a.ts",
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);
    // 清除筛选后，之前筛选外的文件不因“选择当前筛选”被加入。
    await fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
    expect(
      (
        screen.getByRole("checkbox", {
          name: "选择 docs/readme.md",
        }) as HTMLInputElement
      ).checked,
    ).toBe(false);
  });

  it("已选文件加入应用栏并沿用预览确认流程", async () => {
    const onAction = vi.fn();
    render(ChangelistsModule, {
      snapshot: buildSnapshot(),
      onAction,
    });
    await fireEvent.click(
      screen.getByRole("checkbox", { name: "选择 src/webview/a.ts" }),
    );
    await fireEvent.click(
      screen.getByRole("button", { name: "加入应用栏（1）" }),
    );
    expect(screen.getByText("将分组的文件（1）")).toBeInTheDocument();
    const nameInput = screen.getByRole("textbox", {
      name: "变更集名称",
    }) as HTMLInputElement;
    await fireEvent.input(nameInput, { target: { value: "review" } });
    await fireEvent.click(screen.getByRole("button", { name: "生成应用预览" }));
    expect(onAction).toHaveBeenCalledWith("changelist/preview-apply", {
      name: "review",
      paths: ["src/webview/a.ts"],
      remove: false,
    });
  });

  it("折叠分组保留文件与选择，头部显示筛选匹配数量", async () => {
    render(ChangelistsModule, {
      snapshot: buildSnapshot(),
      onAction: vi.fn(),
    });
    // 折叠后行不渲染，但匹配数量仍可见。
    const toggle = screen.getByRole("button", { name: "ui" });
    await fireEvent.click(toggle);
    expect(screen.queryByText("a.ts")).toBeNull();
    expect(screen.getByText("2/2")).toBeInTheDocument();
    // 筛选命中 1 个时折叠头部显示 1/2。
    const input = screen.getByRole("textbox", { name: "筛选变更集文件" });
    await fireEvent.input(input, { target: { value: "a.ts" } });
    expect(screen.getByText("1/2")).toBeInTheDocument();
    await fireEvent.click(toggle);
    expect(screen.getByText("a.ts")).toBeInTheDocument();
  });

  it("路径详情按钮发送工作副本内路径", async () => {
    const onAction = vi.fn();
    render(ChangelistsModule, {
      snapshot: buildSnapshot(),
      onAction,
    });
    await fireEvent.click(
      screen.getByRole("button", { name: "查看 src/webview/a.ts 路径详情" }),
    );
    expect(onAction).toHaveBeenCalledWith("file/path-detail", {
      relativePath: "src/webview/a.ts",
    });
  });

  it("按状态排序时冲突优先且恢复默认顺序可用", async () => {
    render(ChangelistsModule, {
      snapshot: buildSnapshot({
        unassigned: [
          groupFile("docs/readme.md", { status: "unversioned" }),
          groupFile("zz-last.ts", { status: "conflicted" }),
        ],
      }),
      onAction: vi.fn(),
    });
    const sortMenu = screen.getByRole("combobox", {
      name: "排序方式",
    }) as HTMLSelectElement;
    await fireEvent.change(sortMenu, { target: { value: "status" } });
    // 未分组节内 conflicted 排在 unversioned 前。
    const sortedRows = Array.from(
      document.querySelectorAll('[aria-label="未分组"] .changelist-row'),
    );
    expect(sortedRows[0]).toHaveTextContent("zz-last.ts");
    await fireEvent.change(sortMenu, { target: { value: "" } });
    const defaultRows = Array.from(
      document.querySelectorAll('[aria-label="未分组"] .changelist-row'),
    );
    expect(defaultRows[0]).toHaveTextContent("readme.md");
  });
});
