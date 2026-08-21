/**
 * v0.0.14 通用操作意向单领域契约（纯业务逻辑，无 VS Code/ Svelte 依赖）
 *
 * - 意图摘要：动作 + 数量 + 范围，数量来自最终候选集合，执行前重新校验
 * - 影响清单：候选路径集合，可搜索/复制（复用 PreviewPathList / list 底座）
 * - 确认 token、范围/revision 变化自动失效只读，且不得凭旧 token 执行
 * - 不改变写操作的 预览→确认→执行前复验 契约，不引入一键撤销承诺
 */

export type OperationIntentKind =
  | "commit"
  | "resolve"
  | "update"
  | "revert"
  | "delete"
  | "switch"
  | "branch"
  | "tag"
  | "relocate"
  | "merge"
  | "cleanup"
  | "property"
  | "changelist-apply"
  | "file-operation";

export const OPERATION_INTENT_KINDS: readonly OperationIntentKind[] = [
  "commit",
  "resolve",
  "update",
  "revert",
  "delete",
  "switch",
  "branch",
  "tag",
  "relocate",
  "merge",
  "cleanup",
  "property",
  "changelist-apply",
  "file-operation",
] as const;

export function isOperationIntentKind(
  value: unknown,
): value is OperationIntentKind {
  return (
    typeof value === "string" &&
    (OPERATION_INTENT_KINDS as readonly string[]).includes(value)
  );
}

export const OPERATION_INTENT_ACTION_LABELS: Record<
  OperationIntentKind,
  string
> = {
  commit: "提交",
  resolve: "标记解决",
  update: "更新",
  revert: "还原",
  delete: "删除",
  switch: "切换",
  branch: "创建分支",
  tag: "创建标签",
  relocate: "重定位",
  merge: "合并",
  cleanup: "清理",
  property: "修改属性",
  "changelist-apply": "应用变更集",
  "file-operation": "文件操作",
};

/**
 * 中文标题：动作 + 数量（数量来自最终候选集合，执行前重新校验）
 * 例：提交 3 个文件、还原 2 个文件、标记解决 1 个冲突
 */
export function operationIntentTitle(
  kind: OperationIntentKind,
  count: number,
): string {
  const action = OPERATION_INTENT_ACTION_LABELS[kind];
  if (kind === "commit") return `提交 ${count} 个文件`;
  if (kind === "resolve") return `标记解决 ${count} 个冲突`;
  if (kind === "update") return `更新 ${count} 个路径`;
  if (kind === "property") return `修改属性`;
  if (kind === "cleanup") return `清理工作副本`;
  if (kind === "changelist-apply") return `应用变更集 ${count} 个文件`;
  if (kind === "file-operation") return `${action} ${count} 个文件`;
  if (kind === "branch") return `创建分支`;
  if (kind === "tag") return `创建标签`;
  if (kind === "relocate") return `重定位`;
  if (kind === "merge") return `合并 ${count} 个路径`;
  // 通用回退：动作 + 数量
  return `${action} ${count} ${count === 1 ? "个文件" : "个文件"}`;
}

/**
 * 通用操作意向单视图（协议/快照与 Webview 共用）
 * - 承载 Host 下发的 token 与绑定信息
 * - scopeHash / candidateHash / revision 用于自动失效判定
 * - stale 由 Host 计算或 Webview 根据当前 scope/revision 判定，只读
 */
export interface OperationIntentView {
  /** 一次性确认令牌（执行时回传，Host 校验）。 */
  token: string;
  kind: OperationIntentKind;
  title: string;
  /** 意图摘要：动作 + 数量 + 范围（中文）。 */
  summary: string;
  /** 影响清单：最终候选集合（相对路径），执行前重新校验数量一致。 */
  paths: string[];
  /** 操作范围 hash（hashOperationScope），范围变化后失效；展示态可选，Host 侧校验必填。 */
  scopeHash?: string;
  /** 候选集合 hash（hashCandidateState 等），候选变化后失效。 */
  candidateHash?: string;
  /** 工作副本 revision，变化后失效（可选）。 */
  revision?: string;
  repositoryUuid?: string;
  createdAt: string;
  canExecute: boolean;
  issues: string[];
  commands?: string[];
  /** Host 已判定为过期的只读意向单（仍可查看/复制，不可确认）。 */
  stale?: boolean;
}

export interface OperationIntentBinding {
  repositoryUuid: string;
  scopeHash: string;
  candidateHash?: string;
  revision?: string;
}

export function isOperationIntentStale(
  intent: Pick<
    OperationIntentView,
    "scopeHash" | "candidateHash" | "revision" | "repositoryUuid"
  >,
  current: OperationIntentBinding,
): boolean {
  if (
    intent.repositoryUuid !== undefined &&
    intent.repositoryUuid !== current.repositoryUuid
  )
    return true;
  if (intent.scopeHash !== undefined && intent.scopeHash !== current.scopeHash)
    return true;
  if (
    intent.candidateHash !== undefined &&
    current.candidateHash !== undefined &&
    intent.candidateHash !== current.candidateHash
  ) {
    return true;
  }
  if (
    intent.revision !== undefined &&
    current.revision !== undefined &&
    intent.revision !== current.revision
  ) {
    return true;
  }
  return false;
}

/**
 * 构建意图摘要（动作 + 数量 + 范围）
 * scopeText 为人类可读范围描述（如 "项目 my-app · src/components"），
 * 已由 Host 经 toScopeView 生成；Webview 如需再次拼接可用 displayPath。
 */
export function buildOperationIntentSummary(
  kind: OperationIntentKind,
  count: number,
  scopeText?: string,
): string {
  const title = operationIntentTitle(kind, count);
  if (scopeText) return `${title} · 范围：${scopeText}`;
  return title;
}

export function validateOperationIntentForExecute(
  intent: OperationIntentView | undefined,
  token: string | undefined,
  current: OperationIntentBinding,
): { ok: true } | { ok: false; reason: string } {
  if (!intent || !token || intent.token !== token) {
    return { ok: false, reason: "操作意向单已失效，请重新生成预览。" };
  }
  if (intent.stale || isOperationIntentStale(intent, current)) {
    return {
      ok: false,
      reason: "范围或候选已变化，旧意向单已只读失效，请重新预览后再确认。",
    };
  }
  if (!intent.canExecute || intent.issues.length > 0) {
    return {
      ok: false,
      reason: `意向单存在未解决的校验问题：${intent.issues.slice(0, 3).join("；")}。`,
    };
  }
  return { ok: true };
}
