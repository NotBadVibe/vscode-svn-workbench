import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import AdvancedTask from "../../src/webview/features/repository/tasks/AdvancedTask.svelte";
import type { RepositorySnapshot } from "../../src/protocol/workbenchProtocol";

function mergeSnapshot(
  overrides: Partial<RepositorySnapshot["advanced"]> = {},
): RepositorySnapshot {
  return {
    kind: "repository",
    info: {
      name: "repo",
      revision: "44",
      url: "file:///repo/trunk/app",
      repositoryRoot: "file:///repo",
    },
    properties: { available: true, target: ".", items: [] },
    cleanup: { available: true, target: "." },
    advanced: {
      browser: {
        url: "file:///repo/branches/feature",
        entries: [],
        lastGoodUrl: "file:///repo/branches/feature",
      },
      ...overrides,
    },
  };
}

function mergePreview(): RepositorySnapshot {
  const snapshot = mergeSnapshot({
    preview: {
      token: "merge-1",
      operation: "merge",
      title: "合并到当前工作副本",
      commands: [
        "svn merge --dry-run -c 43 <s> <w> --accept postpone",
        "svn merge -c 43 <s> <w> --accept postpone",
      ],
      details: ["源：file:///repo/branches/feature"],
      issues: [],
      canExecute: true,
      destructive: true,
      sourceUrl: "file:///repo/branches/feature",
      merge: {
        mode: "specific",
        requestedRevisions: ["43"],
        resolvedRevisions: ["43"],
        eligible: ["43", "44"],
        merged: ["42"],
        eligibleCount: 2,
        mergedCount: 1,
        mergeinfoSupported: true,
        dryRunCommand: "svn merge --dry-run -c 43 <s> <w> --accept postpone",
        dryRunFiles: ["app/a.ts"],
        dryRunConflicts: [],
        dryRunSummary: "试运行预计影响 1 个路径，未发现 C 标记冲突。",
      },
    },
  });
  // 表单源初始值取自 info.url：与预览源一致，避免身份切换重置表单。
  snapshot.info.url = "file:///repo/branches/feature";
  return snapshot;
}

describe("V026-R45 合并三模式表单", () => {
  it("提供全部符合条件/指定修订/修订范围三种明确模式", async () => {
    render(AdvancedTask, {
      snapshot: mergeSnapshot(),
      taskId: "repository/merge",
      onAction: vi.fn(),
    });
    expect(await screen.findByText(/合并修订选择/)).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: /全部符合条件/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /指定修订/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /修订范围/ })).toBeInTheDocument();
  });

  it("指定修订携带结构化意图发起预览", async () => {
    const onAction = vi.fn();
    render(AdvancedTask, {
      snapshot: mergeSnapshot(),
      taskId: "repository/merge",
      onAction,
    });
    await fireEvent.click(
      await screen.findByRole("radio", { name: /指定修订/ }),
    );
    await fireEvent.input(
      await screen.findByLabelText("指定合并修订（逗号分隔多选）"),
      { target: { value: "r43, r44" } },
    );
    await fireEvent.click(
      screen.getByRole("button", { name: /生成合并到工作副本/ }),
    );
    expect(onAction).toHaveBeenCalledWith(
      "repository/preview-advanced",
      expect.objectContaining({
        operation: "merge",
        merge: expect.objectContaining({
          mode: "specific",
          revisions: "r43, r44",
        }),
        mergeMode: "specific",
      }),
    );
  });

  it("修订范围携带起止发起预览", async () => {
    const onAction = vi.fn();
    render(AdvancedTask, {
      snapshot: mergeSnapshot(),
      taskId: "repository/merge",
      onAction,
    });
    await fireEvent.click(
      await screen.findByRole("radio", { name: /修订范围/ }),
    );
    await fireEvent.input(await screen.findByLabelText("合并范围起始修订"), {
      target: { value: "r40" },
    });
    await fireEvent.input(await screen.findByLabelText("合并范围结束修订"), {
      target: { value: "r45" },
    });
    await fireEvent.click(
      screen.getByRole("button", { name: /生成合并到工作副本/ }),
    );
    expect(onAction).toHaveBeenCalledWith(
      "repository/preview-advanced",
      expect.objectContaining({
        operation: "merge",
        merge: expect.objectContaining({
          mode: "range",
          from: "r40",
          to: "r45",
        }),
      }),
    );
  });
});

describe("V026-R45 合并预览可解释展示", () => {
  it("展示 eligible/merged 采集与试运行摘要", async () => {
    render(AdvancedTask, {
      snapshot: mergePreview(),
      taskId: "repository/merge",
      onAction: vi.fn(),
    });
    expect(await screen.findByText(/已采集合并信息/)).toBeInTheDocument();
    expect(screen.getByText(/可合并 2 个/)).toBeInTheDocument();
    expect(screen.getByText(/待合并：r43/)).toBeInTheDocument();
    expect(screen.getByText(/试运行（只读）/)).toBeInTheDocument();
  });

  it("无 mergeinfo 支持时如实说明未做已合并校验", async () => {
    const snapshot = mergePreview();
    snapshot.advanced.preview = {
      ...snapshot.advanced.preview!,
      merge: {
        mode: "eligible",
        resolvedRevisions: [],
        eligible: [],
        merged: [],
        eligibleCount: 0,
        mergedCount: 0,
        mergeinfoSupported: false,
        mergeinfoNote: "E200007：源不支持 mergeinfo",
        dryRunFiles: [],
        dryRunConflicts: [],
      },
    };
    render(AdvancedTask, {
      snapshot,
      taskId: "repository/merge",
      onAction: vi.fn(),
    });
    expect(await screen.findByText(/mergeinfo 不可用/)).toBeInTheDocument();
    expect(screen.getByText(/未做已合并校验/)).toBeInTheDocument();
  });
});

describe("V026-R45 合并输入变化作废旧预览", () => {
  it("切换模式后旧预览作废并要求重预览", async () => {
    const onAction = vi.fn();
    const aligned = mergeSnapshot();
    aligned.info.url = "file:///repo/branches/feature";
    const { rerender } = render(AdvancedTask, {
      snapshot: aligned,
      taskId: "repository/merge",
      onAction,
    });
    // 表单先与预览绑定一致（指定 r43）。
    await fireEvent.click(
      await screen.findByRole("radio", { name: /指定修订/ }),
    );
    await fireEvent.input(
      await screen.findByLabelText("指定合并修订（逗号分隔多选）"),
      { target: { value: "r43" } },
    );
    await rerender({
      snapshot: mergePreview(),
      taskId: "repository/merge",
      onAction,
    });
    await tick();
    expect(screen.queryByText(/旧预览已自动作废/)).not.toBeInTheDocument();
    // 切换为范围模式：旧预览失效。
    await fireEvent.click(screen.getByRole("radio", { name: /修订范围/ }));
    expect(await screen.findByText(/旧预览已自动作废/)).toBeInTheDocument();
    expect(onAction).toHaveBeenCalledWith(
      "repository/discard-advanced-preview",
      { operation: "merge", reason: "source-target-changed" },
    );
  });
});
