/* eslint-disable @typescript-eslint/no-unused-vars */
import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import ConflictsModule from "../../src/webview/features/conflicts/ConflictsModule.svelte";
import type { ConflictSnapshot } from "../../src/protocol/workbenchProtocol";

// ConflictDiffView 的差异引擎在 jsdom 不可用；本文件聚焦解释回执等页面行为，用 stub 避免触发 V011-E 降级警告。
vi.mock("@pierre/diffs", () => ({
  UnresolvedFile: class {
    render() {
      return true;
    }
    cleanUp() {}
  },
  File: class {
    render() {
      return true;
    }
    cleanUp() {}
  },
}));
vi.mock("@pierre/diffs/edit", () => ({
  Editor: class {
    constructor(_opts: unknown) {}
    edit() {
      return () => {};
    }
    getText() {
      return "";
    }
    applyEdits() {}
    cleanUp() {}
    canUndo() {
      return false;
    }
    canRedo() {
      return false;
    }
    undo() {}
    redo() {}
    focus() {}
  },
}));
vi.mock("../../src/webview/features/diff/cspCompatObserver", () => ({
  observeDiffContainer: () => ({ disconnect: () => {} }),
  observeDiffShadowRoot: () => ({ disconnect: () => {} }),
  installDiffCspCompatibilityShim: () => {},
}));

const snapshot: ConflictSnapshot = {
  kind: "conflicts",
  conflicts: [{ relativePath: "src/a.ts", type: "text" }],
  selected: {
    relativePath: "src/a.ts",
    contents: {
      working: { content: "merged", truncated: false },
      theirs: { content: "remote", truncated: false },
    },
    mergeEditor: { token: "edit-1", editable: true, issues: [] },
  },
  resolvePreview: {
    token: "resolve-1",
    relativePath: "src/a.ts",
    command: 'svn resolve --accept working "src/a.ts"',
    canResolve: true,
    issues: [],
  },
};

describe("ConflictsModule", () => {
  it("只使用 Host 生成的预览令牌确认解决", async () => {
    const onAction = vi.fn();
    render(ConflictsModule, { snapshot, onAction });

    await fireEvent.click(
      screen.getByRole("button", {
        name: "确认使用当前工作副本内容并标记解决",
      }),
    );
    // 批次 C：标记解决先打开通用操作意向单对话框
    expect(
      screen.getByRole("dialog", { name: "标记解决 1 个冲突" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "标记解决 src/a.ts · 当前状态：工作副本已保存，待标记解决 · 不可逆：执行 svn resolve --accept working 将清除冲突标记，需确认后不可自动撤销",
      ),
    ).toBeInTheDocument();
    const dialog = screen.getByRole("dialog", { name: "标记解决 1 个冲突" });
    const confirmInDialog = Array.from(dialog.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("确认标记解决"),
    ) as HTMLElement;
    await fireEvent.click(confirmInDialog);
    expect(onAction).toHaveBeenCalledWith("conflict/resolve", {
      previewToken: "resolve-1",
    });
  });

  it("允许逐块采用远端结果并用编辑令牌保存 Working", async () => {
    const onAction = vi.fn();
    const mergeSnapshot: ConflictSnapshot = {
      kind: "conflicts",
      conflicts: [{ relativePath: "src/a.ts", type: "text" }],
      selected: {
        relativePath: "src/a.ts",
        contents: {
          working: {
            content: "<<<<<<< .mine\nlocal\n=======\nremote\n>>>>>>> .r5\n",
            truncated: false,
          },
        },
        mergeEditor: { token: "edit-2", editable: true, issues: [] },
      },
    };
    render(ConflictsModule, { snapshot: mergeSnapshot, onAction });
    await fireEvent.click(screen.getByRole("button", { name: "采用对方修改" }));
    await fireEvent.click(
      screen.getByRole("button", { name: "保存工作副本合并结果" }),
    );
    expect(onAction).toHaveBeenCalledWith("conflict/save-working", {
      editToken: "edit-2",
      content: "remote\n",
    });
  });

  it("未配置外部模型时按钮与隐私文案如实指向本地建议（v0.0.9）", async () => {
    const onAction = vi.fn();
    const unconfigured: ConflictSnapshot = {
      ...snapshot,
      aiPrivacy: {
        model: "本地规则（未配置外部模型）",
        characters: 86,
        maxCharacters: 32000,
        data: "基础版本、我的版本、对方版本、工作副本的截断文本与修订元数据",
        historyIncluded: false,
      },
    };
    render(ConflictsModule, { snapshot: unconfigured, onAction });
    // 不标“AI”，如实指向本地建议（AI09-TRUTH-01）。
    expect(
      screen.getByRole("button", { name: "本地建议" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "AI 分析" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/不会外发/)).toBeInTheDocument();
  });

  it("配置外部模型时按钮保留“AI 分析”（AI09-TRUTH-01）", async () => {
    const onAction = vi.fn();
    const configured: ConflictSnapshot = {
      ...snapshot,
      aiPrivacy: {
        model: "deepseek-v4-flash",
        characters: 86,
        maxCharacters: 32000,
        data: "基础版本、我的版本、对方版本、工作副本的截断文本与修订元数据",
        historyIncluded: false,
      },
    };
    render(ConflictsModule, { snapshot: configured, onAction });
    expect(screen.getByRole("button", { name: "AI 分析" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "本地建议" }),
    ).not.toBeInTheDocument();
  });
});

describe("ConflictsModule 列表迁移（v0.0.10）", () => {
  const multiSnapshot: ConflictSnapshot = {
    kind: "conflicts",
    conflicts: [
      { relativePath: "api/b.ts", type: "tree", operation: "merge" },
      { relativePath: "src/a.ts", type: "text", operation: "update" },
      { relativePath: "docs/c.md", type: "text", operation: "update" },
    ],
    progress: { initialCount: 5, remaining: 3, resolvedCount: 2 },
    selected: {
      relativePath: "src/a.ts",
      contents: {
        working: { content: "merged", truncated: false },
      },
      mergeEditor: { token: "edit-1", editable: true, issues: [] },
    },
  };

  it("显示处理进度并支持路径搜索与清除", async () => {
    render(ConflictsModule, { snapshot: multiSnapshot, onAction: vi.fn() });
    expect(screen.getByText(/剩余 3 个，已处理 2 \/ 5/)).toBeInTheDocument();
    expect(screen.getByText("3 个冲突")).toBeInTheDocument();
    const input = screen.getByRole("textbox", { name: "筛选冲突文件" });
    await fireEvent.input(input, { target: { value: "docs" } });
    expect(screen.getByText("1 个冲突")).toBeInTheDocument();
    // 筛选只作用于列表；右侧详情头部仍显示当前选中冲突。
    const listRows = Array.from(document.querySelectorAll(".conflict-row"));
    expect(listRows.length).toBe(1);
    expect(listRows[0]).toHaveTextContent("docs/c.md");
    await fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
    expect(screen.getByText("3 个冲突")).toBeInTheDocument();
  });

  it("冲突类型与产生操作筛选组合生效", async () => {
    render(ConflictsModule, { snapshot: multiSnapshot, onAction: vi.fn() });
    const typeMenu = screen.getByRole("combobox", {
      name: "冲突类型筛选",
    }) as HTMLSelectElement;
    await fireEvent.change(typeMenu, { target: { value: "tree" } });
    expect(screen.getByText("1 个冲突")).toBeInTheDocument();
    expect(screen.getByText("api/b.ts")).toBeInTheDocument();
    const operationMenu = screen.getByRole("combobox", {
      name: "产生操作筛选",
    }) as HTMLSelectElement;
    // 树冲突来自 merge；再筛 update 应为空并给出恢复指引。
    await fireEvent.change(operationMenu, { target: { value: "update" } });
    expect(screen.getByText("0 个冲突")).toBeInTheDocument();
    expect(screen.getByText(/没有匹配的冲突/)).toBeInTheDocument();
    await fireEvent.change(typeMenu, { target: { value: "all" } });
    expect(screen.getByText("2 个冲突")).toBeInTheDocument();
  });

  it("按路径自然排序且可按冲突类型排序", async () => {
    render(ConflictsModule, { snapshot: multiSnapshot, onAction: vi.fn() });
    let rows = Array.from(document.querySelectorAll(".conflict-row"));
    expect(rows[0]).toHaveTextContent("api/b.ts");
    const sortMenu = screen.getByRole("combobox", {
      name: "冲突排序",
    }) as HTMLSelectElement;
    await fireEvent.change(sortMenu, { target: { value: "type" } });
    rows = Array.from(document.querySelectorAll(".conflict-row"));
    // text 类型在前（docs/c.md、src/a.ts 按路径稳定兜底），tree 随后。
    expect(rows[0]).toHaveTextContent("docs/c.md");
    expect(rows[1]).toHaveTextContent("src/a.ts");
    expect(rows[2]).toHaveTextContent("api/b.ts");
  });

  it("上一个/下一个在未解决冲突之间切换并播报", async () => {
    const onAction = vi.fn();
    render(ConflictsModule, { snapshot: multiSnapshot, onAction });
    // 路径排序后顺序为 api/b.ts、docs/c.md、src/a.ts；当前选中 src/a.ts。
    await fireEvent.click(screen.getByRole("button", { name: "下一个未解决" }));
    expect(onAction).toHaveBeenCalledWith("conflict/select", {
      relativePath: "api/b.ts",
    });
    // 中文注释：V013-G 步骤条透传已解决播报，导致同一文本在 StepBar 与原播报中各出现一次，改用 getAllByText 兼容精确条件
    expect(
      screen.getAllByText(/已切换到 api\/b\.ts（剩余 3 个未解决冲突）/).length,
    ).toBeGreaterThan(0);
  });

  it("上一个从排序末尾的选中冲突回退", async () => {
    const onAction = vi.fn();
    render(ConflictsModule, {
      snapshot: {
        ...multiSnapshot,
        selected: { ...multiSnapshot.selected!, relativePath: "src/a.ts" },
      },
      onAction,
    });
    await fireEvent.click(screen.getByRole("button", { name: "上一个未解决" }));
    expect(onAction).toHaveBeenCalledWith("conflict/select", {
      relativePath: "docs/c.md",
    });
  });

  it("行内路径详情与仓库定位复用共享 Host 动作", async () => {
    const onAction = vi.fn();
    render(ConflictsModule, { snapshot: multiSnapshot, onAction });
    await fireEvent.click(
      screen.getByRole("button", { name: "查看 src/a.ts 路径详情" }),
    );
    expect(onAction).toHaveBeenCalledWith("file/path-detail", {
      relativePath: "src/a.ts",
    });
    await fireEvent.click(
      screen.getByRole("button", {
        name: "在仓库浏览器中显示 src/a.ts",
      }),
    );
    expect(onAction).toHaveBeenCalledWith("changes/show-in-repository", {
      relativePath: "src/a.ts",
    });
  });

  it("不提供批量 Resolve；解决仍逐文件预览确认", () => {
    render(ConflictsModule, { snapshot: multiSnapshot, onAction: vi.fn() });
    // 列表为单选导航，不存在批量选择或批量解决入口。
    expect(
      screen.queryByRole("checkbox", { name: /选择/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /批量|全部解决/ }),
    ).not.toBeInTheDocument();
  });
});

describe("ConflictsModule 冲突意图解释（v0.0.12 批次 C）", () => {
  const interpretation = {
    myIntent: "我的版本调整了初始化顺序。",
    theirIntent: "对方版本修改了挂载逻辑。",
    commonPoints: ["两侧均在入口文件同一区域修改。"],
    conflictPoints: ["初始化顺序与挂载逻辑相互影响。"],
    recommendedHandling: {
      summary: "建议人工合并，保留两侧意图。",
      recommendation: "manualMerge" as const,
      evidence: ["我的版本：初始化顺序", "对方版本：挂载逻辑"],
    },
    businessUnknowns: ["哪个初始化顺序符合当前业务需求。"],
    postSaveVerification: [
      { title: "完成工作副本合并" },
      { title: "运行类型检查", command: "npm run check" },
    ],
    warnings: [],
    source: "configured-model" as const,
    binding: {
      scopeHash: "scope-1",
      conflictHash: "conflict-1",
      revision: "7",
      generatedAt: "2026-08-18T00:00:00.000Z",
    },
  };
  const receipt = {
    token: "conflict-receipt-1",
    receipt: {
      task: "conflict-interpret" as const,
      projectId: "p",
      model: "deepseek-v4-flash",
      dataTypes: ["冲突文件受限正文（base/mine/theirs/working）"],
      files: 4,
      totalBudget: 32000,
      perFileBudget: 8000,
      historyIncluded: false,
    },
    files: [
      { name: "base", characters: 1200, maxCharacters: 8000, truncated: false },
      { name: "mine", characters: 1500, maxCharacters: 8000, truncated: false },
    ],
    notSent: ["本地绝对路径（只发送项目内相对路径）"],
    retentionNote:
      "数据保留策略由模型服务商策略决定，本插件无法证明其保留期限。",
  };

  it("展示六段解释（意图/共同点/冲突点/证据/未知/验证命令仅展示）", () => {
    const { container } = render(ConflictsModule, {
      snapshot: { ...snapshot, interpretation },
      onAction: vi.fn(),
    });
    expect(
      container.querySelector('[aria-label="冲突意图解释"]'),
    ).toBeInTheDocument();
    expect(screen.getByText("我的修改意图")).toBeInTheDocument();
    expect(screen.getByText("对方修改意图")).toBeInTheDocument();
    expect(screen.getByText("无法判断的业务选择")).toBeInTheDocument();
    expect(
      screen.getByText("哪个初始化顺序符合当前业务需求。"),
    ).toBeInTheDocument();
    // 验证命令以 <code> 展示，不执行。
    expect(container.querySelector("code.conflict-command")?.textContent).toBe(
      "npm run check",
    );
  });

  it("回执展示任务/预算，确认后发送 conflict/interpret", async () => {
    const onAction = vi.fn();
    render(ConflictsModule, {
      snapshot,
      onAction,
      conflictReceipt: receipt,
    });
    expect(
      screen.getByRole("region", { name: "冲突意图解释回执" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("冲突意图解释（conflict-interpret）"),
    ).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "开始解释" }));
    expect(onAction).toHaveBeenCalledWith("conflict/interpret", {
      receiptToken: "conflict-receipt-1",
    });
  });
});
