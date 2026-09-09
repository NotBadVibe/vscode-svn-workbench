import { render, screen, fireEvent } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import ActivityModule from "../../src/webview/features/activity/ActivityModule.svelte";
import type { ActivitySnapshot } from "../../src/protocol/workbenchProtocol";

/*
 * V024-R51 操作时间线存续语义回归（真实渲染断言）：
 * - 会话检查点徽标不得标为已写文件；
 * - 行内明示未写入工作副本、仅本次会话、重启后不恢复；
 * - 页首三态 + 重启告知 + 复制出口；
 * - 执行类记录仍标为执行（不混淆）。
 */
function buildSnapshot(): ActivitySnapshot {
  const now = new Date().toISOString();
  return {
    kind: "activity",
    generatedAt: now,
    records: [
      {
        id: "draft-1",
        capturedAt: now,
        kind: "draft-checkpoint",
        moduleId: "conflicts",
        taskId: "conflicts/resolve",
        scopeHash: "hash-a",
        repositoryUuid: "uuid-1",
        scopeLabel: "冲突草稿 src/a.ts",
        impactedCount: 1,
        previewSummary:
          "会话检查点已保留（未写入工作副本，仅本次会话；重启后不恢复，请复制或导出）",
        nextActions: [{ id: "open-output", label: "打开日志" }],
      },
      {
        id: "exec-1",
        capturedAt: now,
        kind: "operation-execution",
        moduleId: "commit",
        taskId: "commit/compose",
        scopeHash: "hash-a",
        repositoryUuid: "uuid-1",
        scopeLabel: "提交 2 个文件",
        impactedCount: 2,
        nextActions: [],
      },
    ],
  };
}

describe("V024-R51 操作时间线存续语义", () => {
  it("会话检查点徽标与行内说明不标为已写文件", () => {
    render(ActivityModule, { snapshot: buildSnapshot(), onAction: vi.fn() });
    expect(screen.getByText("会话检查点")).toBeInTheDocument();
    expect(
      screen.getByText(/未写入工作副本，仅本次会话可见/),
    ).toBeInTheDocument();
    // 行内说明与记录摘要均明示重启后不恢复（多处一致）
    expect(screen.getAllByText(/重启后不恢复/).length).toBeGreaterThanOrEqual(
      2,
    );
    // 绝不出现已写文件口径的肯定表述（页首澄清句“会话检查点不是已写文件”除外）
    expect(screen.queryByText("已写文件")).toBeNull();
    expect(screen.queryByText("已保存工作副本")).toBeNull();
    // 执行类记录不受影响
    expect(screen.getByText("执行")).toBeInTheDocument();
  });

  it("页首展示三态与重启告知及复制出口", () => {
    render(ActivityModule, { snapshot: buildSnapshot(), onAction: vi.fn() });
    expect(screen.getByText(/未同步/)).toBeInTheDocument();
    expect(screen.getByText(/仅会话保留/)).toBeInTheDocument();
    expect(screen.getByText(/已写入工作副本/)).toBeInTheDocument();
    expect(screen.getByText(/重启后草稿正文不恢复/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "复制时间线" }),
    ).toBeInTheDocument();
  });

  it("复制时间线作为可靠出口可触发", async () => {
    const onAction = vi.fn();
    render(ActivityModule, { snapshot: buildSnapshot(), onAction });
    await fireEvent.click(screen.getByRole("button", { name: "复制时间线" }));
    expect(onAction).toHaveBeenCalledWith(
      "copy-text",
      expect.objectContaining({ text: expect.any(String) }),
    );
  });

  it("空时间线不假装已恢复", () => {
    render(ActivityModule, {
      snapshot: {
        kind: "activity",
        generatedAt: new Date().toISOString(),
        records: [],
      },
      onAction: vi.fn(),
    });
    expect(screen.getByText(/暂无操作记录/)).toBeInTheDocument();
    expect(screen.queryByText(/已恢复/)).toBeNull();
  });
});
