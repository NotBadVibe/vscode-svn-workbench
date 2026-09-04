/**
 * V018-F · 外部合并工具纯领域契约（无 VS Code / Svelte / fs 依赖）
 *
 * - 命令路径来自用户显式配置或 PATH 白名单探测已知工具，不自造绝对路径；
 * - 参数一律数组传递（spawn 无 shell），本模块只构造数组，不拼接命令字符串；
 * - 路径校验 fail-closed：范围外、空值、含 NUL/换行一律拒绝；
 * - 不携带凭据、token、AI 上下文，只传递冲突四角色文件路径。
 */

export type ExternalMergeRole = "mine" | "theirs" | "base" | "result";

export const EXTERNAL_MERGE_ROLES: readonly ExternalMergeRole[] = [
  "mine",
  "theirs",
  "base",
  "result",
] as const;

export function isExternalMergeRole(
  value: unknown,
): value is ExternalMergeRole {
  return (
    typeof value === "string" &&
    (EXTERNAL_MERGE_ROLES as readonly string[]).includes(value)
  );
}

/** 中文角色标签（与冲突四角色显示模型一致，不只依赖颜色表达）。 */
export const EXTERNAL_MERGE_ROLE_LABELS: Record<ExternalMergeRole, string> = {
  mine: "我的修改（本地）",
  theirs: "对方修改（仓库）",
  base: "共同基线（BASE）",
  result: "合并结果（工作副本）",
};

/** 外部进程超时上限：15 分钟，超时即终止并提示重新采集状态。 */
export const EXTERNAL_MERGE_TOOL_TIMEOUT_MS = 15 * 60 * 1000;

/** 参数模板占位符（用户在 svnWorkbench.mergeTool.args 中按需使用）。 */
export const EXTERNAL_MERGE_PLACEHOLDERS = [
  "{mine}",
  "{theirs}",
  "{base}",
  "{result}",
] as const;

export interface ExternalMergeRoleFiles {
  mine?: string;
  theirs?: string;
  base?: string;
  result: string;
}

/**
 * PATH 白名单探测的已知工具基名（平台过滤后使用，不硬编码唯一产品）。
 * Windows 额外识别 TortoiseMerge；macOS/Linux 保持通用配置，
 * 不显示 Windows 专属承诺（见 knownExternalMergeToolBasenames）。
 */
const GENERIC_MERGE_TOOL_BASENAMES = [
  "meld",
  "kdiff3",
  "p4merge",
  "bcomp",
  "opendiff",
  "tortoisemerge",
] as const;

const WINDOWS_MERGE_TOOL_BASENAMES = [
  "TortoiseMerge.exe",
  "TortoiseMerge",
  ...GENERIC_MERGE_TOOL_BASENAMES,
] as const;

/** Windows 下可识别的 TortoiseMerge 绝对路径（存在才采用，不自造执行）。 */
export const WINDOWS_TORTOISE_MERGE_ABSOLUTE =
  "C:\\Program Files\\TortoiseSVN\\bin\\TortoiseMerge.exe";

/**
 * 平台相关的已知工具基名清单。
 * 非 Windows 平台不返回 .exe / TortoiseMerge 绝对路径承诺。
 */
export function knownExternalMergeToolBasenames(
  platform: NodeJS.Platform = process.platform,
): string[] {
  if (platform === "win32") return [...WINDOWS_MERGE_TOOL_BASENAMES];
  return [...GENERIC_MERGE_TOOL_BASENAMES];
}

/**
 * 构建候选命令清单（只返回用户显式配置或白名单探测结果）。
 * - configured 非空时只返回该值（存在性由 Host 用 fs 复验）；
 * - 未配置时返回 PATH 解析用的白名单基名；Windows 附加已存在的
 *   TortoiseMerge 绝对路径（pathExists 为 true 才附加）；
 * - macOS/Linux 绝不自造绝对路径。
 */
export function buildExternalMergeCandidates(
  configured: string | null | undefined,
  platform: NodeJS.Platform = process.platform,
  pathExists: (candidate: string) => boolean = () => false,
): string[] {
  const trimmed = (configured ?? "").trim();
  if (trimmed) return [trimmed];
  const candidates = [...knownExternalMergeToolBasenames(platform)];
  if (
    platform === "win32" &&
    pathExists(WINDOWS_TORTOISE_MERGE_ABSOLUTE) &&
    !candidates.includes(WINDOWS_TORTOISE_MERGE_ABSOLUTE)
  ) {
    candidates.unshift(WINDOWS_TORTOISE_MERGE_ABSOLUTE);
  }
  return candidates;
}

/**
 * 命令字符串法校验（fail-closed，不触及 fs）。
 * 存在性与可执行性由 Host 复验；此处只拒绝明显非法输入。
 */
export function validateExternalMergeCommand(
  command: string | null | undefined,
): { ok: true } | { ok: false; issues: string[] } {
  const trimmed = (command ?? "").trim();
  if (!trimmed) {
    return {
      ok: false,
      issues: ["尚未配置外部合并工具，请选择可执行文件或在设置中配置。"],
    };
  }
  const issues: string[] = [];
  if (trimmed.length > 500) {
    issues.push("外部合并工具路径过长（超过 500 个字符），已拒绝执行。");
  }
  if (trimmed.includes("\0") || /[\r\n]/.test(trimmed)) {
    issues.push("外部合并工具路径包含非法字符，已拒绝执行。");
  }
  return issues.length > 0 ? { ok: false, issues } : { ok: true };
}

function substitutePlaceholders(
  template: string,
  files: ExternalMergeRoleFiles,
): string {
  return template
    .replaceAll("{mine}", files.mine ?? "")
    .replaceAll("{theirs}", files.theirs ?? "")
    .replaceAll("{base}", files.base ?? "")
    .replaceAll("{result}", files.result);
}

/**
 * 构造 spawn 参数数组（无 shell，逐项传递）。
 * - 模板非空时逐项替换占位符；替换后为空的项丢弃（fail-closed，不传空串）；
 * - 模板为空时按 [base?, mine?, theirs?, result] 默认顺序传递存在项；
 * - 路径中的空格/引号/分号保持为单个数组元素，不做任何转义拼接。
 */
export function buildExternalMergeArgs(
  templateArgs: readonly string[] | undefined,
  files: ExternalMergeRoleFiles,
): string[] {
  const templates = (templateArgs ?? []).filter(
    (item) => typeof item === "string" && item.trim().length > 0,
  );
  if (templates.length > 0) {
    return templates
      .map((item) => substitutePlaceholders(item, files))
      .filter((item) => item.length > 0);
  }
  return [files.base, files.mine, files.theirs, files.result].filter(
    (item): item is string => typeof item === "string" && item.length > 0,
  );
}

/**
 * 传递路径范围校验（fail-closed）。
 * 全部绝对路径必须落在 repositoryRoot 内；任一越界即拒绝整组。
 */
export function areExternalMergePathsInScope(
  absolutePaths: readonly string[],
  repositoryRoot: string,
): boolean {
  if (absolutePaths.length === 0) return false;
  const root = repositoryRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!root) return false;
  for (const raw of absolutePaths) {
    if (typeof raw !== "string" || raw.length === 0) return false;
    if (raw.includes("\0") || /[\r\n]/.test(raw)) return false;
    const normalized = raw.replace(/\\/g, "/");
    if (normalized !== root && !normalized.startsWith(`${root}/`)) {
      return false;
    }
    const rest = normalized.slice(root.length);
    if (rest.split("/").includes("..")) return false;
  }
  return true;
}

/**
 * 展示用命令预览（仅展示，不执行；执行仍走 spawn 数组）。
 * 含空格的参数用双引号包裹展示，不改变实际传递。
 */
export function formatExternalMergeCommandPreview(
  command: string,
  args: readonly string[],
): string {
  const parts = [command, ...args].map((item) =>
    /[\s"]/.test(item) ? `"${item.replace(/"/g, '\\"')}"` : item,
  );
  return parts.join(" ");
}

/** 打开前确认摘要：动作 + 文件角色 + 将传递的路径 + 外部修改警告。 */
export function buildExternalMergeConfirmSummary(
  relativePath: string,
  toolLabel: string,
): string {
  return (
    `在外部合并工具（${toolLabel}）中打开 ${relativePath}。` +
    `将传递我的修改、对方修改、共同基线与合并结果路径。` +
    `外部工具可能修改工作副本，退出后请重新打开/比较，不会自动标记解决。`
  );
}

/** 工具展示名：取配置基名，未配置时返回通用文案（不承诺 Windows 产品）。 */
export function describeExternalMergeTool(
  command: string | null | undefined,
  platform: NodeJS.Platform = process.platform,
): string {
  const trimmed = (command ?? "").trim();
  if (!trimmed) {
    return platform === "win32"
      ? "未配置（可选 TortoiseMerge 或其他合并工具）"
      : "未配置（通用外部合并工具）";
  }
  const base = trimmed.replace(/\\/g, "/").split("/").pop() ?? trimmed;
  return base || "外部合并工具";
}
