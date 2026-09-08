import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import ChangesModule from "../../src/webview/features/changes/ChangesModule.svelte";
import CommitModule from "../../src/webview/features/commit/CommitModule.svelte";
import ChangelistsModule from "../../src/webview/features/changelists/ChangelistsModule.svelte";
import type {
  ChangelistsSnapshot,
  CommitSnapshot,
  WorkbenchFileView,
} from "../../src/protocol/workbenchProtocol";

/*
 * V023-R24+R25+R26 三件套回归（真实行为断言，非源码扫描）。
 * - R24：复制已选路径 / 状态+路径按当前列表顺序、含隐藏计数、禁用解释、
 *   无身份键、可辨识跨项目同名，失败不改选择。
 * - R25：保存改名「保存文件类型组合」并列出保存内容；表单按需展开；
 *   应用只改视图不改选择；重名/删除/无扩展名反馈清楚。
 * - R26：移动到变更集选择器（已有组+新建入口）复用预览链；人工/AI 分区；
 *   取消不触发写操作。
 */

const key = (relativePath: string) => `test-wc::${relativePath}`;

const changesSnapshot = {
  kind: "changes" as const,
  commitDraft: "",
  files: [
    {
      relativePath: "src/b.ts",
      selectionKey: key("src/b.ts"),
      status: "modified" as const,
      selection: "selected" as const,
      reason: "本地修改",
    },
    {
      relativePath: "src/a.ts",
      selectionKey: key("src/a.ts"),
      status: "added" as const,
      selection: "selected" as const,
      reason: "本地新增",
    },
    {
      relativePath: "项目资料/空 格#1.ts",
      selectionKey: key("项目资料/空 格#1.ts"),
      status: "modified" as const,
      selection: "selected" as const,
      reason: "本地修改",
    },
  ],
  summary: { modified: 2, added: 1 },
  refreshedAt: "2026-09-08T00:00:00.000Z",
  filterPresets: [{ id: "preset-ts", name: "TS 组合", patterns: ["*.ts"] }],
};

const commitSnapshot: CommitSnapshot = {
  kind: "commit",
  files: [
    {
      relativePath: "src/b.ts",
      selectionKey: "test-wc::src/b.ts" as never,
      status: "modified",
      selection: "selected",
    },
    {
      relativePath: "src/a.ts",
      selectionKey: "test-wc::src/a.ts" as never,
      status: "added",
      selection: "selected",
    },
  ],
  summary: { total: 2, selected: 2, needsReview: 0, excluded: 0, blocked: 0 },
  selectedPaths: [],
  message: "",
  messageIssues: [],
  conventionHint: "",
  selectionAi: { configured: false, model: "未配置" },
  aiPrivacy: [],
  templates: [],
};

const groupFile = (path: string) => ({
  relativePath: path,
  selectionKey: key(path) as never,
  status: "modified" as const,
  selection: "selected" as const,
});

function changelistsSnapshot(): ChangelistsSnapshot {
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
        files: [groupFile("src/ui-a.ts"), groupFile("src/ui-b.ts")],
      },
      { name: "server", files: [groupFile("src/server-a.ts")] },
    ],
    unassigned: [groupFile("src/loose.ts")],
    suggestions: [
      {
        id: "suggest-1",
        title: "本地分组",
        summary: "按目录分组",
        reason: "同目录",
        paths: ["src/loose.ts"],
        risks: [],
      },
    ],
    warnings: [],
  };
}

describe("V023-R24 统一复制已选清单", () => {
  it("Changes：多选含隐藏时数量准确、顺序与列表一致、无身份键", async () => {
    const onAction = vi.fn();
    render(ChangesModule, { snapshot: changesSnapshot, onAction });
    await fireEvent.click(screen.getByLabelText("选择 src/b.ts"));
    await fireEvent.click(screen.getByLabelText("选择 src/a.ts"));
    await fireEvent.click(screen.getByLabelText("选择 项目资料/空 格#1.ts"));
    // 搜索藏起 a.ts，使其成为隐藏选择。
    await fireEvent.input(screen.getByLabelText("筛选变更文件"), {
      target: { value: "src/b.ts" },
    });
    // 复制收进更多菜单（R27 回归收敛）：先展开更多批量操作，菜单项保持同名可达。
    await fireEvent.click(screen.getByRole("button", { name: "更多批量操作" }));
    // 复制前显示包含隐藏选择的数量。
    expect(
      screen.getByRole("menuitem", { name: /复制已选路径（3，含隐藏 2）/ }),
    ).toBeInTheDocument();
    await fireEvent.click(
      screen.getByRole("menuitem", { name: /复制已选路径（3，含隐藏 2）/ }),
    );
    expect(onAction).toHaveBeenCalledWith(
      "copy-text",
      expect.objectContaining({ text: expect.any(String) }),
    );
    const text = onAction.mock.calls.find(
      (call) => call[0] === "copy-text",
    )?.[1].text as string;
    const lines = text.split("\n");
    expect(lines).toHaveLength(3);
    // 可见的 b.ts 在前（当前列表顺序），隐藏按相对路径稳定追加。
    expect(lines[0]).toBe("src/b.ts");
    expect(lines).toContain("src/a.ts");
    expect(lines).toContain("项目资料/空 格#1.ts");
    expect(text).not.toContain("test-wc::");
    // 选择未被改动。
    expect(screen.getByLabelText("选择 src/b.ts")).toBeChecked();
  });

  it("Changes：空选择禁用并解释；状态+路径清单中文可辨识", async () => {
    const onAction = vi.fn();
    render(ChangesModule, { snapshot: changesSnapshot, onAction });
    // 复制收进更多菜单：先展开，菜单项保持同名、禁用与 title 解释。
    await fireEvent.click(screen.getByRole("button", { name: "更多批量操作" }));
    const pathButton = screen.getByRole("menuitem", {
      name: "复制已选路径（0）",
    });
    expect(pathButton).toBeDisabled();
    expect(pathButton).toHaveAttribute("title", "先选择至少 1 个文件再复制");
    await fireEvent.click(screen.getByLabelText("选择 src/b.ts"));
    await fireEvent.click(
      screen.getByRole("menuitem", { name: /复制状态\+路径（1）/ }),
    );
    const text = onAction.mock.calls.find(
      (call) => call[0] === "copy-text",
    )?.[1].text as string;
    expect(text).toContain("src/b.ts");
  });

  it("Commit：复制按钮只读，不改选择与 Host 选择状态", async () => {
    const onAction = vi.fn();
    render(CommitModule, {
      snapshot: { ...commitSnapshot, selectedPaths: [] },
      onAction,
    });
    await fireEvent.click(screen.getByRole("button", { name: "调整文件" }));
    await fireEvent.click(screen.getByLabelText("选择 src/b.ts"));
    // 勾选本身会同步 Host 选择；清空计数后点击复制，复制必须是只读的。
    onAction.mockClear();
    await fireEvent.click(
      screen.getByRole("button", { name: /复制已选路径（1）/ }),
    );
    expect(onAction).toHaveBeenCalledWith(
      "copy-text",
      expect.objectContaining({ text: "src/b.ts" }),
    );
    // 复制不触发 commit/update-selection（只读）。
    expect(
      onAction.mock.calls.some((call) => call[0] === "commit/update-selection"),
    ).toBe(false);
  });

  it("Changelists：复制按当前列表顺序且含状态清单", async () => {
    const onAction = vi.fn();
    render(ChangelistsModule, {
      snapshot: changelistsSnapshot(),
      onAction,
    });
    await fireEvent.click(screen.getByLabelText("选择 src/ui-b.ts"));
    await fireEvent.click(screen.getByLabelText("选择 src/loose.ts"));
    await fireEvent.click(
      screen.getByRole("button", { name: /复制状态\+路径（2）/ }),
    );
    const text = onAction.mock.calls.find(
      (call) => call[0] === "copy-text",
    )?.[1].text as string;
    const lines = text.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("src/ui-b.ts");
    expect(lines[1]).toContain("src/loose.ts");
    expect(text).not.toContain("test-wc::");
  });
});

describe("V023-R25 筛选预设说明实际保存范围", () => {
  it("Changes：改名、保存内容说明、表单按需展开、应用不改选择", async () => {
    const onAction = vi.fn();
    render(ChangesModule, { snapshot: changesSnapshot, onAction });
    // 改名与保存内容说明。
    expect(
      screen.getByRole("button", { name: "保存文件类型组合" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("保存为预设")).not.toBeInTheDocument();
    expect(
      screen.getByText(/只保存文件类型组合.*不保存搜索词、状态筛选/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/完整视图预设为后续候选，本版暂不支持/),
    ).toBeInTheDocument();
    // 表单按需展开：默认无名称输入。
    expect(screen.queryByLabelText("文件类型组合名称")).not.toBeInTheDocument();
    await fireEvent.click(
      screen.getByRole("button", { name: "保存文件类型组合" }),
    );
    expect(screen.getByLabelText("文件类型组合名称")).toBeInTheDocument();

    // 应用预设只改视图，不改选择。
    await fireEvent.click(screen.getByLabelText("选择 src/b.ts"));
    await fireEvent.change(screen.getByLabelText("文件类型组合"), {
      target: { value: "preset-ts" },
    });
    expect(screen.getByLabelText("选择 src/b.ts")).toBeChecked();
    expect(
      screen.getByText(/已应用文件类型组合.*只切换视图，选择与操作范围未变/),
    ).toBeInTheDocument();
  });

  it("Changes：重名覆盖与无扩展名限制有清楚反馈", async () => {
    const onAction = vi.fn();
    render(ChangesModule, { snapshot: changesSnapshot, onAction });
    await fireEvent.click(
      screen.getByRole("button", { name: "保存文件类型组合" }),
    );
    await fireEvent.input(screen.getByLabelText("文件类型组合名称"), {
      target: { value: "TS 组合" },
    });
    // 当前为全部类型时无法保存（先选类型再保存同名）。
    await fireEvent.change(screen.getByLabelText("文件类型筛选"), {
      target: { value: ".ts" },
    });
    await fireEvent.click(
      screen.getByRole("button", { name: "保存文件类型组合" }),
    );
    expect(onAction).toHaveBeenCalledWith("list/save-filter-preset", {
      name: "TS 组合",
      patterns: ["*.ts"],
    });
    expect(screen.getByText(/覆盖同名文件类型组合/)).toBeInTheDocument();
  });

  it("Commit：保存入口同样改名并说明只含类型", async () => {
    render(CommitModule, { snapshot: commitSnapshot, onAction: vi.fn() });
    await fireEvent.click(screen.getByRole("button", { name: "调整文件" }));
    expect(
      screen.getByRole("button", { name: "保存文件类型组合" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/只保存文件类型组合.*不保存搜索词/),
    ).toBeInTheDocument();
  });

  it("Changes：小高度默认收起保存说明，一键展开保留（R27 回归收敛）", async () => {
    const onAction = vi.fn();
    const matchMedia = window.matchMedia;
    window.matchMedia = (() => ({
      matches: true,
    })) as unknown as typeof window.matchMedia;
    try {
      render(ChangesModule, { snapshot: changesSnapshot, onAction });
      // 小高度默认收起，不挤压列表首屏。
      expect(
        screen.queryByText(/完整视图预设为后续候选，本版暂不支持/),
      ).not.toBeInTheDocument();
      const toggle = screen.getByRole("button", { name: "展开保存说明" });
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      await fireEvent.click(toggle);
      expect(
        screen.getByText(/只保存文件类型组合.*不保存搜索词、状态筛选/),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "收起保存说明" }),
      ).toHaveAttribute("aria-expanded", "true");
    } finally {
      window.matchMedia = matchMedia;
    }
  });
});

describe("V023-R26 直接移动到已有变更集", () => {
  it("多选→选已有组→生成准确预览；取消不触发写操作", async () => {
    const onAction = vi.fn();
    render(ChangelistsModule, {
      snapshot: changelistsSnapshot(),
      onAction,
    });
    // 人工目标与 AI 建议分区文案。
    expect(screen.getByText("人工移动到变更集")).toBeInTheDocument();
    expect(
      screen.getByText(/人工操作入口：选择目标后走预览确认执行/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/人工移动文件请走右侧“应用到 SVN”/),
    ).toBeInTheDocument();

    await fireEvent.click(screen.getByLabelText("选择 src/loose.ts"));
    await fireEvent.click(screen.getByLabelText("选择 src/server-a.ts"));
    await fireEvent.change(screen.getByLabelText("目标变更集"), {
      target: { value: "ui" },
    });
    await fireEvent.click(
      screen.getByRole("button", { name: /移动到所选变更集（2）/ }),
    );
    // 确认目标后复用既有预览链。
    expect(onAction).toHaveBeenCalledWith(
      "changelist/preview-apply",
      expect.objectContaining({ name: "ui", remove: false }),
    );
    const previewCall = onAction.mock.calls.find(
      (call) => call[0] === "changelist/preview-apply",
    );
    expect(previewCall?.[1]).toMatchObject({ name: "ui", remove: false });
    expect([...(previewCall?.[1].paths as string[])].sort()).toEqual(
      ["src/loose.ts", "src/server-a.ts"].sort(),
    );

    // 取消只清本地草稿，不新增 Host 写动作。
    const callsBefore = onAction.mock.calls.length;
    await fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.getByText("已取消，未发起写操作。")).toBeInTheDocument();
    expect(onAction.mock.calls.length).toBe(callsBefore);
    expect(
      onAction.mock.calls.some(
        (call) => call[0] === "changelist/execute-apply",
      ),
    ).toBe(false);
  });

  it("新建入口只填应用栏、不直接预览", async () => {
    const onAction = vi.fn();
    render(ChangelistsModule, {
      snapshot: changelistsSnapshot(),
      onAction,
    });
    await fireEvent.click(screen.getByLabelText("选择 src/loose.ts"));
    await fireEvent.change(screen.getByLabelText("目标变更集"), {
      target: { value: "__new__" },
    });
    await fireEvent.click(
      screen.getByRole("button", { name: /填入应用栏（1）/ }),
    );
    expect(
      onAction.mock.calls.some(
        (call) => call[0] === "changelist/preview-apply",
      ),
    ).toBe(false);
    expect(screen.getByText("将分组的文件（1）")).toBeInTheDocument();
  });
});

describe("V023-R26 终审：新下拉路径本地拒绝（过期/未版本化/不可操作）", () => {
  const rejectFile = (
    path: string,
    overrides: Pick<WorkbenchFileView, "status" | "selection">,
  ): WorkbenchFileView => ({
    relativePath: path,
    selectionKey: key(path) as never,
    status: "modified",
    selection: "selected",
    ...overrides,
  });

  function rejectSnapshot() {
    const snapshot = changelistsSnapshot();
    return {
      ...snapshot,
      unassigned: [
        groupFile("src/ok.ts"),
        rejectFile("src/fresh.ts", { status: "unversioned" }),
        rejectFile("src/locked.ts", { selection: "blocked" }),
        rejectFile("src/stale.ts", { selection: "needsReview" }),
      ],
    };
  }

  async function refuseCase(badPath: string) {
    const onAction = vi.fn();
    render(ChangelistsModule, {
      snapshot: rejectSnapshot(),
      onAction,
    });
    await fireEvent.click(screen.getByLabelText("选择 src/ok.ts"));
    await fireEvent.click(screen.getByLabelText(`选择 ${badPath}`));
    await fireEvent.change(screen.getByLabelText("目标变更集"), {
      target: { value: "ui" },
    });
    await fireEvent.click(
      screen.getByRole("button", { name: /移动到所选变更集（2）/ }),
    );
    // 拒绝：不发预览、不发起写操作，就地中文反馈。
    expect(
      onAction.mock.calls.some(
        (call) => call[0] === "changelist/preview-apply",
      ),
    ).toBe(false);
    expect(
      screen.getByText(/不能移动到变更集“ui”.*已保留全部选择/),
    ).toBeInTheDocument();
    // 选择保留：两项仍勾选，可取消坏项后重试。
    expect(screen.getByLabelText("选择 src/ok.ts")).toBeChecked();
    expect(screen.getByLabelText(`选择 ${badPath}`)).toBeChecked();
    return onAction;
  }

  it("未纳入版本控制文件拒绝且保留选择", async () => {
    await refuseCase("src/fresh.ts");
  });

  it("阻止提交文件拒绝且保留选择", async () => {
    await refuseCase("src/locked.ts");
  });

  it("需要确认（过期）文件拒绝且保留选择", async () => {
    await refuseCase("src/stale.ts");
  });

  it("剔除坏项后同一选择器可继续生成预览", async () => {
    const onAction = vi.fn();
    render(ChangelistsModule, {
      snapshot: rejectSnapshot(),
      onAction,
    });
    await fireEvent.click(screen.getByLabelText("选择 src/ok.ts"));
    await fireEvent.click(screen.getByLabelText("选择 src/stale.ts"));
    await fireEvent.change(screen.getByLabelText("目标变更集"), {
      target: { value: "ui" },
    });
    await fireEvent.click(
      screen.getByRole("button", { name: /移动到所选变更集（2）/ }),
    );
    expect(screen.getByText(/不能移动到变更集“ui”/)).toBeInTheDocument();
    // 取消坏项选择后重试：预览正常发出且只含好项。
    await fireEvent.click(screen.getByLabelText("选择 src/stale.ts"));
    await fireEvent.click(
      screen.getByRole("button", { name: /移动到所选变更集（1）/ }),
    );
    const previewCall = onAction.mock.calls.find(
      (call) => call[0] === "changelist/preview-apply",
    );
    expect(previewCall?.[1]).toMatchObject({
      name: "ui",
      remove: false,
      paths: ["src/ok.ts"],
    });
  });
});

describe("V023-R24 终审：复制失败就地反馈且不改选择", () => {
  function failingCopyAction() {
    return vi.fn((action: string) => {
      if (action === "copy-text") throw new Error("剪贴板不可用");
      return undefined;
    });
  }

  it("Changes：copy-text 失败就地反馈，选择与候选不变", async () => {
    const onAction = failingCopyAction();
    render(ChangesModule, { snapshot: changesSnapshot, onAction });
    await fireEvent.click(screen.getByLabelText("选择 src/b.ts"));
    await fireEvent.click(screen.getByRole("button", { name: "更多批量操作" }));
    await fireEvent.click(
      screen.getByRole("menuitem", { name: /复制已选路径（1）/ }),
    );
    expect(
      screen.getByText("复制失败，请重试；选择未改动，未发起写操作。"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("选择 src/b.ts")).toBeChecked();
  });

  it("Commit：copy-text 失败就地反馈，不写 Host 选择状态", async () => {
    const onAction = failingCopyAction();
    render(CommitModule, {
      snapshot: { ...commitSnapshot, selectedPaths: [] },
      onAction,
    });
    await fireEvent.click(screen.getByRole("button", { name: "调整文件" }));
    await fireEvent.click(screen.getByLabelText("选择 src/b.ts"));
    onAction.mockClear();
    await fireEvent.click(
      screen.getByRole("button", { name: /复制已选路径（1）/ }),
    );
    expect(
      screen.getByText("复制失败，请重试；选择未改动，未发起写操作。"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("选择 src/b.ts")).toBeChecked();
    expect(
      onAction.mock.calls.some((call) => call[0] === "commit/update-selection"),
    ).toBe(false);
  });
});
