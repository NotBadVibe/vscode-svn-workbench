import { OperationScope } from "../scope/operationScope";
import { runSvnCommand } from "../svn/svnCommandRunner";
import { parseSvnLogXml, type SvnRevision } from "./svnHistoryParser";

export { parseSvnLogXml } from "./svnHistoryParser";
export type { SvnChangedPath, SvnRevision } from "./svnHistoryParser";

/**
 * 历史读取条件只限制 `svn log` 的只读请求和返回集合，不改变工作副本或
 * 操作范围。revisionFrom 表示较早修订，revisionTo 表示较晚修订。
 */
export interface SvnHistoryQuery {
  revisionFrom?: string;
  revisionTo?: string;
  author?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface SvnHistoryPage {
  revisions: SvnRevision[];
  /** true 仅表示本次请求碰到了上限，可能仍有更早的记录。 */
  hasMore: boolean;
}

export interface NormalizedSvnHistoryQuery {
  query: SvnHistoryQuery;
  issues: string[];
}

/**
 * Webview 输入不能直接进入 SVN 参数。这里统一裁剪、限制长度并校验修订号和
 * ISO 日期，调用方有 issues 时必须拒绝执行本次读取请求。
 */
export function normalizeSvnHistoryQuery(
  input: Record<string, unknown>,
): NormalizedSvnHistoryQuery {
  const issues: string[] = [];
  const revisionFrom = readHistoryRevision(
    input.revisionFrom,
    "较早修订号",
    issues,
  );
  const revisionTo = readHistoryRevision(
    input.revisionTo,
    "较晚修订号",
    issues,
  );
  const author = readHistoryAuthor(input.author, issues);
  const dateFrom = readHistoryDate(input.dateFrom, "开始日期", issues);
  const dateTo = readHistoryDate(input.dateTo, "结束日期", issues);

  if (revisionFrom && revisionTo && BigInt(revisionFrom) > BigInt(revisionTo)) {
    issues.push("较早修订号不能大于较晚修订号。");
  }
  if (dateFrom && dateTo && dateFrom > dateTo) {
    issues.push("开始日期不能晚于结束日期。");
  }

  return {
    query: compactHistoryQuery({
      revisionFrom,
      revisionTo,
      author,
      dateFrom,
      dateTo,
    }),
    issues,
  };
}

/** 采集带有来源上限信息的一页历史，供“加载更早”正确判断是否可能还有记录。 */
export async function collectSvnHistoryPage(
  svnPath: string,
  scope: OperationScope,
  limit = 100,
  query: SvnHistoryQuery = {},
  signal?: AbortSignal,
): Promise<SvnHistoryPage> {
  const byRevision = new Map<string, SvnRevision>();
  let hasMore = false;
  for (const root of scope.roots) {
    const result = await runSvnCommand(
      svnPath,
      buildSvnLogArguments(limit, query, root.absolutePath),
      scope.repositoryRoot,
      signal ? { signal } : undefined,
    );
    if (result.exitCode !== 0) {
      throw new Error(
        result.stderr || `无法读取 ${root.relativePath} 的 SVN 历史。`,
      );
    }
    const parsed = parseSvnLogXml(result.stdout);
    hasMore ||= parsed.length >= limit;
    for (const revision of parsed) {
      const existing = byRevision.get(revision.revision);
      if (!existing) {
        byRevision.set(revision.revision, revision);
        continue;
      }
      const keys = new Set(
        existing.changedPaths.map((item) => `${item.action}:${item.path}`),
      );
      for (const changedPath of revision.changedPaths) {
        if (!keys.has(`${changedPath.action}:${changedPath.path}`)) {
          existing.changedPaths.push(changedPath);
        }
      }
    }
  }
  return {
    revisions: filterSvnHistoryRevisions(
      [...byRevision.values()].sort(
        (left, right) => Number(right.revision) - Number(left.revision),
      ),
      query,
    ),
    hasMore,
  };
}

export interface SvnHistoryRangeResult {
  revisions: SvnRevision[];
  /** 去重后已读取修订数（重试合并时不重复计数）。 */
  revisionsRead: number;
  /** 请求分页次数。 */
  pagesRead: number;
  complete: boolean;
  cancelled: boolean;
  /** 部分结果原因（取消/分页失败，展示用中文）。 */
  partialReason?: string;
  /** 失败页的修订上界（续查入口用）。 */
  failedUpperBound?: string;
}

/**
 * V021-R14：在请求开始把 HEAD 固定为数字修订（rN），避免分页期间 HEAD
 * 漂移导致范围不一致。优先 `svn info -r HEAD --xml`，失败时回退
 * `svn log --limit 1` 首条；均失败返回 undefined（调用方按“未填”处理
 * 并如实提示，不得虚构 HEAD）。
 */
export async function resolveHeadRevision(
  svnPath: string,
  scope: OperationScope,
): Promise<string | undefined> {
  try {
    const info = await runSvnCommand(
      svnPath,
      ["info", "--xml", "-r", "HEAD", scope.repositoryRoot],
      scope.repositoryRoot,
    );
    if (info.exitCode === 0) {
      const revision = /revision="(\d+)"/.exec(info.stdout)?.[1];
      if (revision) return revision;
    }
  } catch {
    // 忽略并尝试 log 回退。
  }
  try {
    const log = await runSvnCommand(
      svnPath,
      ["log", "--xml", "--limit", "1", scope.repositoryRoot],
      scope.repositoryRoot,
    );
    if (log.exitCode === 0) {
      const revision = /logentry\s+revision="(\d+)"/.exec(log.stdout)?.[1];
      if (revision) return revision;
    }
  } catch {
    // 忽略，调用方如实提示。
  }
  return undefined;
}

/**
 * V021-R14：按用户指定修订范围只读分页采集（端点包含）。
 * - 按窗口从新到旧倒序拉取（每页 pageSize，缺省 200），窗口上界逐页下移；
 * - 以 Map 按修订去重合并，重试/续查不重复计数；
 * - 取消（AbortSignal）或分页失败时返回已采集部分并标记 complete=false；
 * - 空范围（from>to 不可能出现，调用方已归一化；from/to 缺省表示开端）
 *   与反向范围由调用方归一化后传入，本函数只处理包含语义。
 */
export async function collectSvnHistoryRange(
  svnPath: string,
  scope: OperationScope,
  range: { fromRevision?: string; toRevision?: string },
  options: {
    pageSize?: number;
    signal?: AbortSignal;
    onPage?: (read: number, upperBound: string) => void;
  } = {},
): Promise<SvnHistoryRangeResult> {
  const pageSize = options.pageSize ?? 200;
  const lower = range.fromRevision;
  const upper = range.toRevision;
  const byRevision = new Map<string, SvnRevision>();
  let pagesRead = 0;
  let currentUpper = upper;
  let cancelled = false;
  let partialReason: string | undefined;
  let failedUpperBound: string | undefined;
  // 无上界时先取一次最新页以确定上界（仍走分页语义，首轮即定界）。
  for (;;) {
    if (options.signal?.aborted) {
      cancelled = true;
      partialReason = "已取消";
      break;
    }
    let page: SvnHistoryPage;
    try {
      page = await collectSvnHistoryPage(
        svnPath,
        scope,
        pageSize,
        currentUpper || lower
          ? {
              revisionFrom: lower,
              revisionTo: currentUpper,
            }
          : {},
        options.signal,
      );
    } catch (error) {
      if (
        options.signal?.aborted ||
        (error instanceof Error && /abort|cancel/i.test(error.message))
      ) {
        cancelled = true;
        partialReason = "已取消";
      } else {
        partialReason = error instanceof Error ? error.message : "分页读取失败";
        failedUpperBound = currentUpper;
      }
      break;
    }
    pagesRead += 1;
    for (const revision of page.revisions) {
      if (!byRevision.has(revision.revision))
        byRevision.set(revision.revision, revision);
    }
    options.onPage?.(byRevision.size, currentUpper ?? "HEAD");
    const numbers = [...byRevision.keys()].map(Number).filter(Number.isFinite);
    const minRead = numbers.length > 0 ? Math.min(...numbers) : undefined;
    const reachedLower =
      lower !== undefined && minRead !== undefined && minRead <= Number(lower);
    // 本页未填满 → 该窗口内无更多记录；已触及下界 → 完整。
    if (page.revisions.length < pageSize || reachedLower) break;
    if (minRead === undefined) break;
    if (lower !== undefined && minRead - 1 < Number(lower)) break;
    currentUpper = String(minRead - 1);
    // 无下界的全量采集同样分页直到填不满为止。
  }
  const revisions = [...byRevision.values()].sort(
    (left, right) => Number(right.revision) - Number(left.revision),
  );
  const complete = !cancelled && partialReason === undefined;
  return {
    revisions,
    revisionsRead: revisions.length,
    pagesRead,
    complete,
    cancelled,
    partialReason,
    failedUpperBound,
  };
}

export async function collectSvnHistory(
  svnPath: string,
  scope: OperationScope,
  limit = 100,
  /**
   * v0.0.18 批次 C（C-06）：加载更早修订属于可能耗时的长任务，支持取消；
   * 取消后由调用方重新采集状态再重试。
   */
  signal?: AbortSignal,
): Promise<SvnRevision[]> {
  return (await collectSvnHistoryPage(svnPath, scope, limit, {}, signal))
    .revisions;
}

export function filterSvnHistoryRevisions(
  revisions: SvnRevision[],
  query: SvnHistoryQuery,
): SvnRevision[] {
  const author = query.author?.toLocaleLowerCase();
  return revisions.filter((revision) => {
    if (author && !revision.author.toLocaleLowerCase().includes(author)) {
      return false;
    }
    const date = revision.date.slice(0, 10);
    if (query.dateFrom && date < query.dateFrom) return false;
    if (query.dateTo && date > query.dateTo) return false;
    return true;
  });
}

function buildSvnLogArguments(
  limit: number,
  query: SvnHistoryQuery,
  absolutePath: string,
): string[] {
  const args = ["log", "--xml", "-v", "--limit", String(limit)];
  const revisionRange = toSvnRevisionRange(query);
  if (revisionRange) args.push("--revision", revisionRange);
  args.push(absolutePath);
  return args;
}

function toSvnRevisionRange(query: SvnHistoryQuery): string | undefined {
  if (query.revisionFrom || query.revisionTo) {
    return `${query.revisionTo ?? "HEAD"}:${query.revisionFrom ?? "1"}`;
  }
  if (query.dateFrom || query.dateTo) {
    const newer = query.dateTo ? `{${query.dateTo}}` : "HEAD";
    const older = query.dateFrom ? `{${query.dateFrom}}` : "1";
    return `${newer}:${older}`;
  }
  return undefined;
}

function compactHistoryQuery(query: SvnHistoryQuery): SvnHistoryQuery {
  return Object.fromEntries(
    Object.entries(query).filter(([, value]) => value !== undefined),
  ) as SvnHistoryQuery;
}

function readHistoryRevision(
  value: unknown,
  label: string,
  issues: string[],
): string | undefined {
  const text = readHistoryText(value, label, issues);
  if (!text) return undefined;
  if (!/^[1-9]\d*$/.test(text)) {
    issues.push(`${label}必须是大于 0 的整数。`);
    return undefined;
  }
  return text;
}

function readHistoryAuthor(
  value: unknown,
  issues: string[],
): string | undefined {
  const text = readHistoryText(value, "作者", issues);
  if (text && text.length > 120) {
    issues.push("作者筛选不能超过 120 个字符。");
    return undefined;
  }
  return text;
}

function readHistoryDate(
  value: unknown,
  label: string,
  issues: string[],
): string | undefined {
  const text = readHistoryText(value, label, issues);
  if (!text) return undefined;
  const date = new Date(`${text}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(text) ||
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== text
  ) {
    issues.push(`${label}必须是有效的 YYYY-MM-DD 日期。`);
    return undefined;
  }
  return text;
}

function readHistoryText(
  value: unknown,
  label: string,
  issues: string[],
): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    issues.push(`${label}必须是文本。`);
    return undefined;
  }
  return value.trim() || undefined;
}
