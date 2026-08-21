import type {
  WorkbenchModuleId,
  WorkbenchTaskId,
} from "../protocol/workbenchProtocol";

/**
 * 操作时间线记录（v0.0.16 批次 A）
 * - 仅会话内（纯内存，不写磁盘）
 * - 按时间倒序展示；不承诺远端 commit/merge/switch/relocate 可一键撤销
 */
export type ActivityRecordKind =
  "draft-checkpoint" | "understanding-confirmation" | "operation-execution";

export type ActivityRecordResult = "success" | "failed" | "pending";

export interface ActivityNextAction {
  id:
    | "retry"
    | "view-conflicts"
    | "open-output"
    | "copy-diagnostics"
    | "view-history";
  label: string;
  /**
   * 恢复动作必须走 v0.0.14 意向单（新预览 + 新确认），不复用旧 token。
   * params 仅携带必要标识，不含凭据或私密材料。
   */
  params?: Record<string, unknown>;
}

export interface ActivityRecord {
  id: string;
  capturedAt: string;
  kind: ActivityRecordKind;
  moduleId: WorkbenchModuleId;
  taskId: WorkbenchTaskId;
  projectName?: string;
  scopeHash: string;
  repositoryUuid: string;
  capturedRevision?: string;
  scopeLabel: string;
  impactedCount: number;
  previewSummary?: string;
  result?: ActivityRecordResult;
  errorReason?: string;
  nextActions: ActivityNextAction[];
  /**
   * true 表示该操作在 SVN 侧无安全本地恢复方式，只能通过新的状态检查与预览重做。
   * 文案固定为“此操作不能在工作台中一键撤销”，不出现“撤销远端提交”类误导。
   */
  nonRecoverable?: boolean;
  nonRecoverableReason?: string;
}

export function isNonRecoverableKind(
  kind: ActivityRecordKind,
  moduleId: WorkbenchModuleId,
  taskId: WorkbenchTaskId,
): boolean {
  // 远端已生效的操作不承诺一键撤销；仅提示需通过新预览重做
  if (kind !== "operation-execution") return false;
  const nonRecoverableTasks: WorkbenchTaskId[] = [
    "commit/compose",
    "repository/switch",
    "repository/relocate",
    "repository/merge",
    "repository/branch",
    "repository/tag",
  ];
  return nonRecoverableTasks.includes(taskId);
}

export function buildActivityScopeLabel(
  moduleId: WorkbenchModuleId,
  taskId: WorkbenchTaskId,
  projectName?: string,
): string {
  const base = `${moduleId}/${taskId}`;
  return projectName ? `${projectName} · ${base}` : base;
}

export function buildActivityNextActions(
  record: Pick<ActivityRecord, "kind" | "result" | "errorReason">,
): ActivityNextAction[] {
  const actions: ActivityNextAction[] = [];
  if (record.kind === "operation-execution" && record.result === "failed") {
    actions.push({ id: "retry", label: "重试" });
    actions.push({ id: "open-output", label: "打开日志" });
    actions.push({ id: "copy-diagnostics", label: "复制诊断信息" });
    if (record.errorReason?.includes("冲突")) {
      actions.push({ id: "view-conflicts", label: "查看冲突" });
    }
  }
  if (record.kind === "operation-execution" && record.result === "success") {
    actions.push({ id: "view-history", label: "查看历史" });
  }
  if (record.kind === "draft-checkpoint") {
    actions.push({ id: "open-output", label: "打开日志" });
  }
  return actions;
}
