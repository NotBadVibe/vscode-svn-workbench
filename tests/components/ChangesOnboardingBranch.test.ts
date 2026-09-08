import { render, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ChangesModule from "../../src/webview/features/changes/ChangesModule.svelte";
import { onboarding } from "../../src/webview/app/onboarding.svelte";

/*
 * V024-R41：干净/冲突分支集成。Changes 模块渲染即推进第 2 步（不再要求
 * files.length > 0），并按候选/冲突重算分支；刷新与引导推进不丢手工草稿，
 * 全程不发起写操作（只断言 onAction 未收到写动作）。
 */

const cleanSnapshot = {
  kind: "changes" as const,
  commitDraft: "",
  files: [],
  summary: {},
  refreshedAt: "2026-09-07T10:00:00.000Z",
};

const conflictSnapshot = {
  kind: "changes" as const,
  commitDraft: "",
  files: [
    {
      relativePath: "src/conflict.ts",
      selectionKey: "test-wc::src/conflict.ts",
      status: "conflicted" as const,
      selection: "blocked" as const,
      reason: "存在冲突",
    },
  ],
  summary: { conflicted: 1 },
  refreshedAt: "2026-09-07T10:00:00.000Z",
};

describe("Changes 引导分支（V024-R41）", () => {
  beforeEach(() => {
    onboarding.restart();
  });

  it("干净仓库渲染即完成第 2 步并切到干净分支（无须制造修改）", async () => {
    onboarding.recordStep("open-workbench");
    render(ChangesModule, { snapshot: cleanSnapshot, onAction: vi.fn() });
    await waitFor(() => expect(onboarding.state.completedSteps).toBe(2));
    expect(onboarding.branch).toBe("clean");
    // 空态本身解释“干净是正常状态”。
    expect(await screen.findByText("工作副本很干净")).toBeInTheDocument();
  });

  it("有冲突时切到冲突分支", async () => {
    onboarding.recordStep("open-workbench");
    render(ChangesModule, { snapshot: conflictSnapshot, onAction: vi.fn() });
    await waitFor(() => expect(onboarding.state.completedSteps).toBe(2));
    expect(onboarding.branch).toBe("conflict");
  });

  it("中途刷新不丢手工草稿，引导推进不发起写操作", async () => {
    onboarding.recordStep("open-workbench");
    const onAction = vi.fn();
    const draft = "手工草稿：本次只改文案";
    const { rerender } = render(ChangesModule, {
      snapshot: { ...cleanSnapshot, commitDraft: draft },
      onAction,
    });
    const draftBox = await screen.findByLabelText("共享提交草稿");
    expect(draftBox).toHaveValue(draft);
    // 引导推进（第 2 步）后草稿仍在。
    await waitFor(() => expect(onboarding.state.completedSteps).toBe(2));
    expect(screen.getByLabelText("共享提交草稿")).toHaveValue(draft);
    // 模拟刷新：新快照到达（同草稿），手工输入不受影响。
    await rerender({
      snapshot: {
        ...cleanSnapshot,
        commitDraft: draft,
        refreshedAt: "2026-09-07T10:05:00.000Z",
      },
      onAction,
    });
    expect(screen.getByLabelText("共享提交草稿")).toHaveValue(draft);
    // 全程无写操作：只有渲染，无预览/执行/commit 动作。
    for (const [action] of onAction.mock.calls) {
      expect(String(action)).not.toMatch(
        /execute|preview-operation|commit\/|resolve/,
      );
    }
  });
});
