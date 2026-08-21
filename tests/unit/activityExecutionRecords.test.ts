import { describe, expect, it } from "vitest";
import type {
  WorkbenchModuleId,
  WorkbenchTaskId,
} from "../../src/protocol/workbenchProtocol";
import {
  buildActivityNextActions,
  isNonRecoverableKind,
} from "../../src/activity/activityRecord";
import {
  appendActivityRecord,
  createActivityStore,
} from "../../src/activity/activityStore";

describe("activityExecutionRecords（8 个意向单执行路径）", () => {
  const scopeHash = "hash-1";
  const repositoryUuid = "uuid-1";
  it("commit/merge/switch/relocate/branch/tag 标 nonRecoverable", () => {
    expect(
      isNonRecoverableKind("operation-execution", "commit", "commit/compose"),
    ).toBe(true);
    expect(
      isNonRecoverableKind(
        "operation-execution",
        "repository",
        "repository/switch",
      ),
    ).toBe(true);
    expect(
      isNonRecoverableKind(
        "operation-execution",
        "repository",
        "repository/relocate",
      ),
    ).toBe(true);
    expect(
      isNonRecoverableKind(
        "operation-execution",
        "repository",
        "repository/merge",
      ),
    ).toBe(true);
    expect(
      isNonRecoverableKind(
        "operation-execution",
        "repository",
        "repository/branch",
      ),
    ).toBe(true);
    expect(
      isNonRecoverableKind(
        "operation-execution",
        "repository",
        "repository/tag",
      ),
    ).toBe(true);
    expect(
      isNonRecoverableKind(
        "operation-execution",
        "repository",
        "repository/update",
      ),
    ).toBe(false);
    expect(
      isNonRecoverableKind(
        "operation-execution",
        "changes",
        "changes/overview",
      ),
    ).toBe(false);
  });

  it("成功/失败记录写入时间线（8 路径各一条）", () => {
    let store = createActivityStore();
    const paths: Array<{
      moduleId: WorkbenchModuleId;
      taskId: WorkbenchTaskId;
      label: string;
    }> = [
      { moduleId: "commit", taskId: "commit/compose", label: "提交 2 个文件" },
      {
        moduleId: "conflicts",
        taskId: "conflicts/resolve",
        label: "标记解决 1 个冲突",
      },
      {
        moduleId: "repository",
        taskId: "repository/switch",
        label: "切换工作副本",
      },
      {
        moduleId: "repository",
        taskId: "repository/relocate",
        label: "重定位工作副本",
      },
      {
        moduleId: "repository",
        taskId: "repository/merge",
        label: "合并到工作副本",
      },
      {
        moduleId: "changelists",
        taskId: "changelists/manage",
        label: "应用变更集 5 个文件",
      },
      {
        moduleId: "changes",
        taskId: "changes/overview",
        label: "删除 2 个文件",
      },
      {
        moduleId: "repository",
        taskId: "repository/branch",
        label: "创建分支",
      },
    ];
    for (const p of paths) {
      store = appendActivityRecord(store, {
        id: `id-${p.taskId}`,
        capturedAt: new Date().toISOString(),
        kind: "operation-execution",
        moduleId: p.moduleId,
        taskId: p.taskId,
        scopeHash,
        repositoryUuid,
        scopeLabel: p.label,
        impactedCount: 1,
        previewSummary: "preview",
        result: "success",
        nextActions: buildActivityNextActions({
          kind: "operation-execution",
          result: "success",
        }),
        nonRecoverable: isNonRecoverableKind(
          "operation-execution",
          p.moduleId,
          p.taskId,
        ),
        nonRecoverableReason: isNonRecoverableKind(
          "operation-execution",
          p.moduleId,
          p.taskId,
        )
          ? "此操作不能在工作台中一键撤销"
          : undefined,
      });
    }
    expect(store.records.length).toBe(8);
    // 非可撤销文案仅出现在远端生效操作
    const nonRec = store.records.filter((r) => r.nonRecoverable);
    expect(nonRec.length).toBeGreaterThanOrEqual(4);
    for (const r of nonRec) {
      expect(r.nonRecoverableReason).toBe("此操作不能在工作台中一键撤销");
      expect(r.nextActions).toBeDefined();
    }
    // 成功记录不含"撤销远端提交"误导文案
    for (const r of store.records) {
      expect(r.nonRecoverableReason ?? "").not.toContain("撤销远端提交");
    }
  });

  it("失败记录携带 errorReason 与重试等下一步", () => {
    let store = createActivityStore();
    store = appendActivityRecord(store, {
      id: "fail-1",
      capturedAt: new Date().toISOString(),
      kind: "operation-execution",
      moduleId: "repository",
      taskId: "repository/update",
      scopeHash,
      repositoryUuid,
      scopeLabel: "更新当前范围",
      impactedCount: 2,
      previewSummary: "svn update",
      result: "failed",
      errorReason: "冲突：远端已更新",
      nextActions: buildActivityNextActions({
        kind: "operation-execution",
        result: "failed",
        errorReason: "冲突：远端已更新",
      }),
    });
    const rec = store.records[0];
    expect(rec.result).toBe("failed");
    expect(rec.errorReason).toContain("冲突");
    expect(rec.nextActions.map((a) => a.id)).toContain("retry");
    expect(rec.nextActions.map((a) => a.id)).toContain("view-conflicts");
  });
});
