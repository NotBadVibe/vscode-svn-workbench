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
