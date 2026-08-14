import { describe, expect, it } from "vitest";
import {
  collectUnfinishedContent,
  resolveProjectSwitchDecision,
} from "../../src/extension/workbench/projectSwitchGuard";
import {
  deleteProjectDraft,
  projectDraftKey,
  readProjectDraft,
  writeProjectDraft,
  type ProjectDraftMap,
} from "../../src/extension/workbench/projectDraftStore";

const win = { platform: "win32" as const, cwd: "C:\\" };
const posix = { platform: "linux" as const, cwd: "/" };

describe("项目切换未完成内容检查（v0.0.7 §8）", () => {
  it("空白会话不拦截切换", () => {
    expect(collectUnfinishedContent({}).hasContent).toBe(false);
    expect(collectUnfinishedContent({ commitMessage: "   " }).hasContent).toBe(
      false,
    );
  });

  it("提交说明草稿、手动选择、AI 结果与各类预览都被识别", () => {
    const result = collectUnfinishedContent({
      commitMessage: "feat: x",
      hasManualSelection: true,
      hasCommitAiResult: true,
      hasCommitPreview: true,
      hasChangesPreview: true,
      hasHistoryRestorePreview: true,
      hasConflictResolvePreview: true,
      hasConflictAdvice: true,
      hasDiffDraft: true,
    });
    expect(result.hasContent).toBe(true);
    expect(result.reasons).toEqual([
      "提交说明草稿",
      "手动文件选择",
      "提交选择 AI 结果",
      "待确认的提交预览",
      "待确认的文件操作预览",
      "待确认的历史恢复预览",
      "待确认的冲突解决预览",
      "冲突 AI 建议",
      "Diff 编辑草稿",
    ]);
  });

  it("三选一决定解析：取消按留在当前项目处理", () => {
    expect(resolveProjectSwitchDecision("保留为当前项目草稿并切换")).toBe(
      "stash",
    );
    expect(resolveProjectSwitchDecision("放弃内容并切换")).toBe("discard");
    expect(resolveProjectSwitchDecision("留在当前项目")).toBe("stay");
    expect(resolveProjectSwitchDecision(undefined)).toBe("stay");
  });
});

describe("项目草稿存储（按项目 + 模块 + 范围隔离）", () => {
  const draft = {
    message: "feat: a",
    selectedPaths: ["src/a.ts"],
    scopeHash: "hash-a",
    savedAt: 1,
  };

  it("草稿键使用项目根 identity、模块与 scopeHash", () => {
    expect(projectDraftKey("C:\\Repo\\Code\\App", "commit", "h1", win)).toBe(
      "c:\\repo\\code\\app::commit::h1",
    );
  });

  it("同项目同模块但 scopeHash 不同的草稿互不串用", () => {
    let store: ProjectDraftMap = {};
    store = writeProjectDraft(
      store,
      projectDraftKey("/repo/a", "commit", "scope-1", posix),
      { ...draft, message: "范围一草稿", scopeHash: "scope-1" },
    );
    store = writeProjectDraft(
      store,
      projectDraftKey("/repo/a", "commit", "scope-2", posix),
      { ...draft, message: "范围二草稿", scopeHash: "scope-2" },
    );
    expect(
      readProjectDraft(
        store,
        projectDraftKey("/repo/a", "commit", "scope-1", posix),
      )?.message,
    ).toBe("范围一草稿");
    expect(
      readProjectDraft(
        store,
        projectDraftKey("/repo/a", "commit", "scope-2", posix),
      )?.message,
    ).toBe("范围二草稿");
    expect(
      readProjectDraft(
        store,
        projectDraftKey("/repo/a", "commit", "scope-3", posix),
      ),
    ).toBeUndefined();
  });

  it("不同项目、不同模块的草稿互不串用", () => {
    let store: ProjectDraftMap = {};
    store = writeProjectDraft(
      store,
      projectDraftKey("/repo/a", "commit", "scope-1", posix),
      { ...draft, message: "A 项目草稿" },
    );
    store = writeProjectDraft(
      store,
      projectDraftKey("/repo/b", "commit", "scope-1", posix),
      { ...draft, message: "B 项目草稿" },
    );
    store = writeProjectDraft(
      store,
      projectDraftKey("/repo/a", "changes", "scope-1", posix),
      { ...draft, message: "A 变更草稿" },
    );
    expect(
      readProjectDraft(
        store,
        projectDraftKey("/repo/a", "commit", "scope-1", posix),
      )?.message,
    ).toBe("A 项目草稿");
    expect(
      readProjectDraft(
        store,
        projectDraftKey("/repo/b", "commit", "scope-1", posix),
      )?.message,
    ).toBe("B 项目草稿");
    expect(
      readProjectDraft(
        store,
        projectDraftKey("/repo/a", "changes", "scope-1", posix),
      )?.message,
    ).toBe("A 变更草稿");
    expect(
      readProjectDraft(
        store,
        projectDraftKey("/repo/b", "changes", "scope-1", posix),
      ),
    ).toBeUndefined();
  });

  it("删除幂等且超出容量时淘汰最旧草稿", () => {
    let store: ProjectDraftMap = {};
    for (let index = 0; index < 33; index += 1) {
      store = writeProjectDraft(store, `p${index}::commit::h`, {
        ...draft,
        savedAt: index,
      });
    }
    expect(Object.keys(store)).toHaveLength(32);
    expect(readProjectDraft(store, "p0::commit::h")).toBeUndefined();
    expect(readProjectDraft(store, "p32::commit::h")).toBeDefined();
    expect(deleteProjectDraft(store, "missing")).toBe(store);
    const after = deleteProjectDraft(store, "p32::commit::h");
    expect(readProjectDraft(after, "p32::commit::h")).toBeUndefined();
  });
});
