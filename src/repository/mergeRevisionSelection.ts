/**
 * V026-R45：合并修订选择领域模型（纯函数，平台无关，不触碰文件系统与进程）。
 *
 * 三种明确模式（不做反向合并/重积分，向后延期）：
 * - `eligible`：全部符合条件（SVN 完整合并 `svn merge SOURCE WC`，不带 -c/-r）；
 * - `specific`：指定修订（单个/不连续多选，映射为 `-c M[,N...]`）；
 * - `range`：修订范围（连续区间，映射为 `-r (from-1):to` 的 SVN 含端点差集语义）。
 *
 * Host/Webview/Mock 共用同一语义；Host 执行前仍以会话内 input 为准复验，
 * 不信任 Webview 回传。
 */

export type MergeRevisionMode = "eligible" | "specific" | "range";

/** 合并修订选择快照上限（防超大区间展开；超出 fail-closed 要求缩小范围）。 */
export const MAX_MERGE_RANGE_REVISIONS = 200;

/** 快照下发时 eligible/merged 列表上限（超出截断并标记，不冒充完整）。 */
export const MAX_MERGE_MERGEINFO_ENTRIES = 200;

/** dry-run 解析后快照下发的文件/冲突清单上限（超出截断并注明省略数）。 */
export const MAX_MERGE_DRYRUN_PATHS = 20;

export interface NormalizedMergeRevisionSelection {
  mode: MergeRevisionMode;
  /** 去重排序后的数字修订（specific 模式的请求集合；range/eligible 为空）。 */
  requestedRevisions: string[];
  fromRevision?: string;
  toRevision?: string;
  issues: string[];
}

/**
 * V026-R45：合并模式与修订输入归一化（纯函数）。
 * - 空模式缺省为 `eligible`（全部符合条件）；
 * - 修订号接受可选 r/R 前缀并去前导零；零/负数/非数字 fail-closed；
 * - range 模式要求起止均为正整数；起大于止视为反向合并，本版不支持，
 *   直接拒绝（不做归一化、不静默执行）；
 * - specific 模式空输入要求补填，不静默回落为全部符合条件。
 */
export function normalizeMergeRevisionSelection(
  mode: unknown,
  rawRevisions: unknown,
  rawFrom: unknown,
  rawTo: unknown,
): NormalizedMergeRevisionSelection {
  const normalizedMode: MergeRevisionMode =
    mode === "specific" || mode === "range" || mode === "eligible"
      ? mode
      : "eligible";
  if (normalizedMode === "eligible") {
    return { mode: "eligible", requestedRevisions: [], issues: [] };
  }
  if (normalizedMode === "specific") {
    const parsed = parseMergeRevisionList(rawRevisions);
    if (parsed.revisions.length === 0 && parsed.issues.length === 0) {
      return {
        mode: "specific",
        requestedRevisions: [],
        issues: [
          "已选择指定修订，请填写至少一个正整数修订号（例如 r42，或 r42, r45）。",
        ],
      };
    }
    return {
      mode: "specific",
      requestedRevisions: parsed.revisions,
      issues: parsed.issues,
    };
  }
  const from = parseSingleRevision(rawFrom);
  const to = parseSingleRevision(rawTo);
  const issues: string[] = [];
  if (from.issue) issues.push(`起始修订：${from.issue}`);
  if (to.issue) issues.push(`结束修订：${to.issue}`);
  if (issues.length > 0) {
    return { mode: "range", requestedRevisions: [], issues };
  }
  const fromRevision = from.revision as string;
  const toRevision = to.revision as string;
  if (BigInt(fromRevision) > BigInt(toRevision)) {
    return {
      mode: "range",
      requestedRevisions: [],
      fromRevision,
      toRevision,
      issues: [
        "反向合并（起始大于结束）本版不支持，已拒绝；如需撤销已合并内容请改用历史恢复或命令行单独处理。",
      ],
    };
  }
  const size = BigInt(toRevision) - BigInt(fromRevision) + 1n;
  if (size > BigInt(MAX_MERGE_RANGE_REVISIONS)) {
    return {
      mode: "range",
      requestedRevisions: [],
      fromRevision,
      toRevision,
      issues: [
        `修订范围共 ${size} 个修订，超过单次 ${MAX_MERGE_RANGE_REVISIONS} 个上限，请缩小范围后重新预览。`,
      ],
    };
  }
  return {
    mode: "range",
    requestedRevisions: [],
    fromRevision,
    toRevision,
    issues: [],
  };
}

/**
 * V026-R45：解析逗号/空白分隔的修订列表（接受 r 前缀，去重排序）。
 */
export function parseMergeRevisionList(value: unknown): {
  revisions: string[];
  issues: string[];
} {
  const raw =
    typeof value === "string" ? value : value == null ? "" : String(value);
  const tokens = raw
    .split(/[,;\s]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  const issues: string[] = [];
  const found: bigint[] = [];
  for (const token of tokens) {
    const parsed = parseSingleRevision(token);
    if (!parsed.revision || parsed.issue) {
      issues.push(
        `修订“${token}”无效，只能填写正整数修订号（例如 r42，可用逗号分隔多选）。`,
      );
      continue;
    }
    found.push(BigInt(parsed.revision));
  }
  const unique = [...new Set(found.map(String))].sort((a, b) =>
    BigInt(a) < BigInt(b) ? -1 : 1,
  );
  if (unique.length > MAX_MERGE_RANGE_REVISIONS) {
    return {
      revisions: [],
      issues: [
        `指定修订共 ${unique.length} 个，超过单次 ${MAX_MERGE_RANGE_REVISIONS} 个上限，请缩小选择后重新预览。`,
      ],
    };
  }
  return { revisions: unique, issues: [...new Set(issues)] };
}

function parseSingleRevision(value: unknown): {
  revision?: string;
  issue?: string;
} {
  const raw =
    typeof value === "string"
      ? value.trim()
      : value == null
        ? ""
        : String(value).trim();
  if (!raw) return { issue: "请填写正整数修订号（例如 r42）。" };
  const digits =
    /^r(\d+)$/i.exec(raw)?.[1] ?? (/^\d+$/.test(raw) ? raw : undefined);
  if (digits === undefined) {
    return { issue: "只能填写正整数修订号（例如 r42）。" };
  }
  try {
    const parsed = BigInt(digits);
    if (parsed > 0n) return { revision: String(parsed) };
  } catch {
    // 落入下方统一拒绝。
  }
  return { issue: "只能填写正整数修订号（例如 r42）。" };
}

/**
 * V026-R45：把归一化选择展开为待合并的单个修订集合（字符串数字，去重排序）。
 * - eligible：展开为全部 eligible（调用方传入已采集集合）；
 * - specific：请求集合本身；
 * - range：起止闭区间逐个展开。
 */
export function expandMergeSelection(
  selection: NormalizedMergeRevisionSelection,
  eligible: string[] = [],
): string[] {
  if (selection.mode === "specific") return [...selection.requestedRevisions];
  if (selection.mode === "range") {
    if (!selection.fromRevision || !selection.toRevision) return [];
    const result: string[] = [];
    for (
      let current = BigInt(selection.fromRevision);
      current <= BigInt(selection.toRevision);
      current += 1n
    ) {
      result.push(String(current));
    }
    return result;
  }
  return sortRevisions(eligible);
}

function sortRevisions(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1));
}

export interface MergeSelectionClassification {
  /** 可合并（在 eligible 内且未合并）。 */
  valid: string[];
  /** 已合并（在 merged 内）：必须阻止执行，要求重新选择。 */
  alreadyMerged: string[];
  /**
   * 不在 eligible 也不在 merged 内（无此修订/源无变更/超出范围）：
   * 有 mergeinfo 时阻止执行，无 mergeinfo 时不产生（调用方跳过校验）。
   */
  notEligible: string[];
  issues: string[];
}

/**
 * V026-R45：对照 eligible/merged 集合解释选择（纯函数）。
 * - mergeinfo 不可用（mergeinfoSupported=false）时不做已合并校验，
 *   调用方必须在详情中明示“未做已合并校验”；
 * - 已合并修订与范围外修订一律阻止执行（issues 非空 → canExecute=false）。
 */
export function classifyMergeSelection(
  selected: string[],
  eligible: string[],
  merged: string[],
  mergeinfoSupported: boolean,
): MergeSelectionClassification {
  if (!mergeinfoSupported) {
    return {
      valid: [...selected],
      alreadyMerged: [],
      notEligible: [],
      issues: [],
    };
  }
  const eligibleSet = new Set(eligible);
  const mergedSet = new Set(merged);
  const valid: string[] = [];
  const alreadyMerged: string[] = [];
  const notEligible: string[] = [];
  for (const revision of selected) {
    if (mergedSet.has(revision)) alreadyMerged.push(revision);
    else if (eligibleSet.has(revision)) valid.push(revision);
    else notEligible.push(revision);
  }
  const issues: string[] = [];
  if (alreadyMerged.length > 0) {
    issues.push(
      `所选 r${alreadyMerged.join("、r")} 已合并到当前工作副本，无需重复合并；请移除后重新预览。`,
    );
  }
  if (notEligible.length > 0) {
    issues.push(
      `所选 r${notEligible.join("、r")} 不在可合并集合内（源无此修订变更或超出 eligible 范围），已阻止执行；请核对源分支与修订号后重新预览。`,
    );
  }
  return { valid, alreadyMerged, notEligible, issues };
}

/**
 * V026-R45：解析 `svn mergeinfo --show-revs` 输出（每行一个 rN，容忍前后空白）。
 */
export function parseMergeinfoRevisions(stdout: string): string[] {
  const found: string[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^\s*r(\d+)\s*$/.exec(line);
    if (match) {
      try {
        if (BigInt(match[1]) > 0n) found.push(String(BigInt(match[1])));
      } catch {
        // 非法行跳过，不虚构。
      }
    }
  }
  return sortRevisions(found);
}

/**
 * V026-R45：把最终修订集合映射为 SVN 参数（不含 source/WC/dry-run）。
 * - 空集合（eligible 全量模式）返回 []，即完整合并 `svn merge SOURCE WC`；
 * - 单个修订返回 ["-c", N]；
 * - 连续区间返回 ["-r", "(from-1):to"]（SVN 含端点差集语义，from=1 时起点为 0）；
 * - 不连续多选返回 ["-c", "a,b,c"]（svn merge -c 支持逗号分隔多修订）。
 */
export function buildMergeRevisionArgs(resolvedRevisions: string[]): string[] {
  const sorted = sortRevisions(resolvedRevisions);
  if (sorted.length === 0) return [];
  if (sorted.length === 1) return ["-c", sorted[0]];
  const first = BigInt(sorted[0]);
  const last = BigInt(sorted[sorted.length - 1]);
  if (last - first + 1n === BigInt(sorted.length)) {
    return ["-r", `${String(first - 1n)}:${sorted[sorted.length - 1]}`];
  }
  return ["-c", sorted.join(",")];
}

/**
 * V026-R45：解释最终修订集合的 SVN 范围语义（中文，供预览详情展示）。
 */
export function describeMergeRevisionMapping(
  resolvedRevisions: string[],
): string {
  const sorted = sortRevisions(resolvedRevisions);
  if (sorted.length === 0) {
    return "全部符合条件模式：不带 -c/-r，按 mergeinfo 把源分支尚未合并的变更一次合并（完整合并）。";
  }
  if (sorted.length === 1) {
    return `单修订 r${sorted[0]}：以 -c ${sorted[0]} 精确合并该修订的变更（等价于 -r ${String(BigInt(sorted[0]) - 1n)}:${sorted[0]}）。`;
  }
  const first = BigInt(sorted[0]);
  const last = BigInt(sorted[sorted.length - 1]);
  if (last - first + 1n === BigInt(sorted.length)) {
    return `连续范围 r${sorted[0]}→r${sorted[sorted.length - 1]}（共 ${sorted.length} 个修订）：以 -r ${String(first - 1n)}:${sorted[sorted.length - 1]} 合并该区间变更（SVN 含端点差集语义，左端为起始减一）。`;
  }
  return `不连续选择（${sorted.length} 个修订：r${sorted.join("、r")}）：以 -c ${sorted.join(",")} 合并所选修订的变更，不含未选修订。`;
}

export interface MergeDryRunSummary {
  files: string[];
  conflicts: string[];
  truncated: boolean;
  omittedCount: number;
  summary: string;
}

/**
 * V026-R45：解析 `svn merge --dry-run` 输出（纯函数，平台无关）。
 * - 以行首动作字母判定（A 新增/U 更新/G 已合并/C 冲突/D 删除/R 替换/E 存在性检查）；
 * - `C ` 开头行计入冲突；`Skipped ` 行计入文件但不计冲突；
 * - `--- Merging rX ...` 等信息行不计入文件；
 * - 二进制空字节视为不可解析，给出中文原因而不虚构清单。
 */
export function parseMergeDryRunOutput(
  stdout: string,
  maxPaths: number = MAX_MERGE_DRYRUN_PATHS,
): MergeDryRunSummary {
  if (stdout.includes("\0")) {
    return {
      files: [],
      conflicts: [],
      truncated: false,
      omittedCount: 0,
      summary:
        "试运行输出含二进制内容，无法解析文件清单；请在命令行复核后再决定。",
    };
  }
  const files: string[] = [];
  const conflicts: string[] = [];
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line.trim()) continue;
    if (/^---\s+Merging\b/.test(line.trim())) continue;
    const conflictMatch = /^C\s+(.+)$/.exec(line);
    if (conflictMatch) {
      conflicts.push(conflictMatch[1].trim());
      files.push(conflictMatch[1].trim());
      continue;
    }
    const actionMatch = /^([AUGDER])\s+(.+)$/.exec(line);
    if (actionMatch) {
      files.push(actionMatch[2].trim());
      continue;
    }
    const skippedMatch = /^Skipped\s+'?([^']+)'?/.exec(line.trim());
    if (skippedMatch) {
      files.push(skippedMatch[1].trim());
      continue;
    }
  }
  const uniqueFiles = [...new Set(files)];
  const uniqueConflicts = [...new Set(conflicts)];
  const omittedCount = Math.max(0, uniqueFiles.length - maxPaths);
  const shownFiles = uniqueFiles.slice(0, maxPaths);
  const summary =
    uniqueFiles.length === 0
      ? "试运行未报告文件变更（所选修订与工作副本无差异，或试运行无输出）。"
      : `试运行预计影响 ${uniqueFiles.length} 个路径${uniqueConflicts.length > 0 ? `，其中 ${uniqueConflicts.length} 个可能冲突（C 标记，执行后请进入冲突模块处理）` : "，未发现 C 标记冲突"}。` +
        (omittedCount > 0
          ? `清单仅展示前 ${maxPaths} 个，另有 ${omittedCount} 个未展示。`
          : "");
  return {
    files: shownFiles,
    conflicts: uniqueConflicts,
    truncated: omittedCount > 0,
    omittedCount,
    summary,
  };
}

/**
 * V026-R45：读取 Webview 发来的合并修订意图（兼容新结构化 merge 与旧扁平字段）。
 * origin/模式仅作请求输入；Host 一律归一化复验，不信任 Webview 断言。
 */
export function readMergeRevisionIntent(data: Record<string, unknown>): {
  mode: unknown;
  revisions: unknown;
  fromRevision: unknown;
  toRevision: unknown;
} {
  const structured = data.merge;
  if (
    structured !== null &&
    typeof structured === "object" &&
    !Array.isArray(structured)
  ) {
    const record = structured as Record<string, unknown>;
    return {
      mode: record.mode,
      revisions: record.revisions ?? data.mergeRevisions,
      fromRevision:
        record.from ??
        record.fromRevision ??
        data.mergeRangeFrom ??
        data.mergeFromRevision,
      toRevision:
        record.to ??
        record.toRevision ??
        data.mergeRangeTo ??
        data.mergeToRevision,
    };
  }
  return {
    mode: data.mergeMode,
    revisions: data.mergeRevisions,
    fromRevision: data.mergeRangeFrom ?? data.mergeFromRevision,
    toRevision: data.mergeRangeTo ?? data.mergeToRevision,
  };
}
