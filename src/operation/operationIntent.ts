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
  | "file-operation"
  | "history-restore";

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
  "history-restore",
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
  "history-restore": "历史恢复",
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
  if (kind === "history-restore") return `历史恢复 ${count} 个文件`;
  if (kind === "branch") return `创建分支`;
  if (kind === "tag") return `创建标签`;
  if (kind === "relocate") return `重定位`;
  if (kind === "merge") return `合并 ${count} 个路径`;
  // 通用回退：动作 + 数量
  return `${action} ${count} ${count === 1 ? "个文件" : "个文件"}`;
}

/**
 * v0.1.5 V015-C2：极高风险白名单确认挑战（仅 Relocate 使用）。
 * - Relocate 一旦绑定错误地址即失去恢复出口，且 SVN 不提供安全一键恢复，
 *   因此在通用一次确认之外要求用户复述新仓库根 URL。
 * - 这是展示层附加守卫，最终防线仍是 Host 的 token/scopeHash/candidateHash
 *   执行前复验；挑战不改变 stale/重新检查契约。
 */
export interface OperationIntentConfirmationChallenge {
  /** 输入框前的中文说明（含期望目标的用途，不直接给出答案的复制按钮）。 */
  prompt: string;
  /** 与预览目标精确比对的期望值（Host 预览 details 的“新根”行）。 */
  expected: string;
  /** 不一致时展示的中文错误（说明发生了什么与恢复动作）。 */
  mismatchMessage: string;
  /** 输入框占位文案（可选）。 */
  placeholder?: string;
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
  /** 工作副本 revision，变化后失效（可选）；意向单展示“修订版本”行。 */
  revision?: string;
  /** 人类可读的项目/仓库 + scope 摘要（各调用方按领域填充，缺省不行，不虚构）。 */
  scopeText?: string;
  /** 可恢复性说明（各调用方按领域填充，复用各领域现有文案，缺省不行）。 */
  recoverability?: string;
  repositoryUuid?: string;
  createdAt: string;
  canExecute: boolean;
  issues: string[];
  commands?: string[];
  /** Host 已判定为过期的只读意向单（仍可查看/复制，不可确认）。 */
  stale?: boolean;
  /**
   * v0.1.5 V015-C2：可选确认挑战（白名单，仅 relocate 填充）。
   * 缺省时保持原一次确认；有值时确认按钮需先通过挑战。
   */
  confirmationChallenge?: OperationIntentConfirmationChallenge;
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

/**
 * v0.1.5 V015-C3b 应修 6：确认挑战目标归一化（去首尾空白 + 去尾斜杠，
 * 仅 scheme + host 小写，path 保持原样）。
 * - 去尾斜杠：`https://host/repo/` 与 `https://host/repo` 视为同一目标；
 * - scheme/host 小写：避免因协议/主机大小写拼写差异误拒；
 * - path 保持原样：SVN 路径大小写敏感，大小写不一致必须拒绝；
 *   最终目标仍以 Host 预览的原始值为准执行。
 */
export function normalizeConfirmationTarget(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  const schemeEnd = trimmed.indexOf("://");
  // 无 scheme 时不折叠大小写（fail-closed，宁可误拒一次复述）。
  if (schemeEnd < 0) return trimmed;
  const scheme = trimmed.slice(0, schemeEnd).toLowerCase();
  const rest = trimmed.slice(schemeEnd + 3);
  const slash = rest.indexOf("/");
  // 只有主机没有路径：主机整体小写。
  if (slash < 0) return `${scheme}://${rest.toLowerCase()}`;
  const host = rest.slice(0, slash).toLowerCase();
  // 路径保持原样（含查询串，不做大小写折叠）。
  const pathPart = rest.slice(slash);
  return `${scheme}://${host}${pathPart}`;
}

/** 确认挑战是否通过（归一化后精确比对，不一致禁止确认）。 */
export function isConfirmationChallengeSatisfied(
  expected: string,
  actual: string,
): boolean {
  if (!expected.trim() || !actual.trim()) return false;
  return (
    normalizeConfirmationTarget(expected) ===
    normalizeConfirmationTarget(actual)
  );
}

/** 从 Relocate 预览 details 提取“新根：<url>”行的期望目标（缺省返回 undefined，不虚构）。 */
export function extractRelocateTarget(
  details: readonly string[] | undefined,
): string | undefined {
  if (!details) return undefined;
  for (const line of details) {
    const prefix = "新根：";
    const index = line.indexOf(prefix);
    if (index >= 0) {
      const target = line.slice(index + prefix.length).trim();
      if (target && target !== "未填写") return target;
    }
  }
  return undefined;
}
