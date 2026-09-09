import type { SvnRevision } from "../history/svnHistoryParser";
import { isSvnUrlWithinRepository, normalizeSvnUrl } from "../svn/svnUrl";

export interface RepositoryBrowserEntry {
  name: string;
  kind: "file" | "dir";
  size?: number;
  revision?: string;
  author?: string;
  date?: string;
}

export function parseSvnListXml(xml: string): RepositoryBrowserEntry[] {
  const entries: RepositoryBrowserEntry[] = [];
  const expression = /<entry\s+kind="(file|dir)"\s*>([\s\S]*?)<\/entry>/g;
  for (const match of xml.matchAll(expression)) {
    const body = match[2];
    const size = readTag(body, "size");
    const commit = /<commit\s+revision="([^"]+)"\s*>([\s\S]*?)<\/commit>/.exec(
      body,
    );
    entries.push({
      name: readTag(body, "name") ?? "",
      kind: match[1] as "file" | "dir",
      size: size && /^\d+$/.test(size) ? Number(size) : undefined,
      revision: commit?.[1],
      author: commit ? readTag(commit[2], "author") : undefined,
      date: commit ? readTag(commit[2], "date") : undefined,
    });
  }
  return entries
    .filter((entry) => entry.name)
    .sort((left, right) =>
      left.kind === right.kind
        ? left.name.localeCompare(right.name)
        : left.kind === "dir"
          ? -1
          : 1,
    );
}

export const MAX_RELEASE_NOTES_PATHS_PER_REVISION = 20;

export interface ReleaseNotesRangeInput {
  /** 原始起始输入（去空格后，空表示未填）。 */
  rawFrom?: string;
  /** 原始结束输入（去空格后，空表示未填）。 */
  rawTo?: string;
}

export interface NormalizedReleaseNotesRange {
  /** 解析后的数字下界（含）。 */
  from?: string;
  /** 解析后的数字上界（含）。 */
  to?: string;
  /** 是否请求过 HEAD（结束输入为 HEAD 时为 true，调用方需在请求开始固定解析）。 */
  headRequested: boolean;
  /** 反向范围已按含端点语义归一化（小→大）时为 true。 */
  normalized: boolean;
  issues: string[];
}

/**
 * V021-R14：发布说明范围输入归一化（纯函数，可单元测试）。
 * - 接受正整数或 HEAD（大小写不敏感，仅结束输入有意义；起始 HEAD 视为无效并提示）；
 * - 空输入保持缺省（调用方按“未填”处理，Host 侧给出确定结果）；
 * - 反向范围不拒绝，按含端点语义归一化为小→大并标记 normalized。
 */
export function normalizeReleaseNotesRange(
  fromRevision: string | undefined,
  toRevision: string | undefined,
): NormalizedReleaseNotesRange {
  const rawFrom = fromRevision?.trim() ?? "";
  const rawTo = toRevision?.trim() ?? "";
  const issues: string[] = [];
  let from: string | undefined;
  let to: string | undefined;
  let headRequested = false;
  if (rawFrom) {
    if (/^head$/i.test(rawFrom)) {
      issues.push(
        "起始修订不支持 HEAD，请填写正整数；结束修订可用 HEAD 表示远端最新。",
      );
    } else if (/^\d+$/.test(rawFrom) && BigInt(rawFrom) > 0n) {
      from = String(BigInt(rawFrom));
    } else {
      issues.push("起始修订号只能填写正整数。");
    }
  }
  if (rawTo) {
    if (/^head$/i.test(rawTo)) {
      headRequested = true;
    } else if (/^\d+$/.test(rawTo) && BigInt(rawTo) > 0n) {
      to = String(BigInt(rawTo));
    } else {
      issues.push("结束修订号只能填写正整数或 HEAD。");
    }
  }
  let normalized = false;
  if (from !== undefined && to !== undefined && BigInt(from) > BigInt(to)) {
    const swappedFrom = to;
    to = from;
    from = swappedFrom;
    normalized = true;
  }
  return { from, to, headRequested, normalized, issues };
}

export function validateRepositoryUrl(
  value: string,
  repositoryRoot?: string,
): string[] {
  const issues: string[] = [];
  let normalized: URL | undefined;
  try {
    normalized = new URL(value);
  } catch {
    issues.push("请输入完整且有效的 SVN URL。");
  }
  if (
    normalized &&
    !["http:", "https:", "svn:", "svn+ssh:", "file:"].includes(
      normalized.protocol,
    )
  ) {
    issues.push("只允许 http、https、svn、svn+ssh 或 file 仓库 URL。");
  }
  if (
    normalized &&
    repositoryRoot &&
    !stripTrailingSlash(value).startsWith(
      `${stripTrailingSlash(repositoryRoot)}/`,
    ) &&
    stripTrailingSlash(value) !== stripTrailingSlash(repositoryRoot)
  ) {
    issues.push("目标 URL 必须位于当前 SVN 仓库根地址内。");
  }
  return issues;
}

export function validatePatchText(
  value: string,
  maxBytes = 20 * 1024 * 1024,
): string[] {
  const issues: string[] = [];
  if (!value.trim()) issues.push("补丁文件为空。");
  if (Buffer.byteLength(value, "utf8") > maxBytes)
    issues.push(`补丁超过 ${Math.floor(maxBytes / 1024 / 1024)} MB 安全上限。`);
  if (value.includes("\0"))
    issues.push("补丁包含二进制空字节，工作台不自动应用。");
  const paths = value.split(/\r?\n/).flatMap((line) => {
    const match = /^(?:---|\+\+\+|Index:)\s+([^\t]+?)(?:\t.*)?$/.exec(line);
    return match ? [match[1].trim()] : [];
  });
  for (const candidate of paths) {
    const normalized = candidate.replace(/\\/g, "/").replace(/^[ab]\//, "");
    if (normalized === "/dev/null") continue;
    if (
      normalized.startsWith("/") ||
      /^[A-Za-z]:\//.test(normalized) ||
      normalized.split("/").includes("..")
    ) {
      issues.push(`补丁包含越界路径：${candidate}`);
    }
  }
  return [...new Set(issues)];
}

export interface ReleaseNotesTruncation {
  revision: string;
  omitted: number;
}

export function buildReleaseNotes(
  revisions: SvnRevision[],
  fromRevision?: string,
  toRevision?: string,
  repositoryUrl?: string,
  options: {
    /** 摘要中每修订最多展示路径数（缺省 20，完整版不受限）。 */
    maxPathsPerRevision?: number;
    /** 已读取修订条数（分页采集时传入；缺省为传入集合长度）。 */
    revisionsRead?: number;
    /** 是否完整读取目标范围（缺省 true；部分结果必须显式传 false）。 */
    complete?: boolean;
    /** 部分结果原因（取消/分页失败等，complete=false 时必填展示用）。 */
    partialReason?: string;
    /** HEAD 已在请求开始固定到的修订（展示用 rN，不参与过滤）。 */
    resolvedHeadRevision?: string;
    /** 反向范围已归一化等备注（展示用）。 */
    rangeNote?: string;
  } = {},
): {
  markdown: string;
  /** 含全部路径的完整版（导出/复制完整版用，不截断）。 */
  fullMarkdown: string;
  count: number;
  fromRevision?: string;
  toRevision?: string;
  /** 摘要中省略的路径总数。 */
  omittedPathCount: number;
  truncatedRevisions: ReleaseNotesTruncation[];
  revisionsRead: number;
  complete: boolean;
  partialReason?: string;
  resolvedHeadRevision?: string;
  rangeNote?: string;
} {
  const from = parseRevision(fromRevision);
  const to = parseRevision(toRevision);
  const lower =
    from !== undefined && to !== undefined ? Math.min(from, to) : from;
  const upper =
    from !== undefined && to !== undefined ? Math.max(from, to) : to;
  const maxPaths =
    options.maxPathsPerRevision ?? MAX_RELEASE_NOTES_PATHS_PER_REVISION;
  const selected = revisions
    .filter((item) => {
      const revision = Number(item.revision);
      return (
        Number.isFinite(revision) &&
        (lower === undefined || revision >= lower) &&
        (upper === undefined || revision <= upper)
      );
    })
    .sort((left, right) => Number(right.revision) - Number(left.revision));
  const complete = options.complete ?? true;
  const revisionsRead = options.revisionsRead ?? revisions.length;
  const headNote = options.resolvedHeadRevision
    ? `（结束 HEAD 已固定为 r${options.resolvedHeadRevision}）`
    : "";
  const rangeNote = options.rangeNote ? `（${options.rangeNote}）` : "";
  const integrityNote = complete
    ? `已读取 ${revisionsRead} 条修订，范围完整。`
    : `仅读取到 ${revisionsRead} 条修订，当前为部分结果：${options.partialReason ?? "读取未完成"}。请用“重新生成/续查”继续，重试不会重复计数。`;
  const lines = [
    "# SVN 发布说明",
    "",
    `修订范围（含两端）：${lower === undefined ? "全部已采集" : `r${lower}`} → ${upper === undefined ? "最新" : `r${upper}`}${headNote}${rangeNote}`,
    "",
    integrityNote,
    "",
  ];
  const fullLines = [...lines];
  let omittedPathCount = 0;
  const truncatedRevisions: ReleaseNotesTruncation[] = [];
  if (selected.length === 0) {
    lines.push("_所选范围没有已采集修订。_");
    fullLines.push("_所选范围没有已采集修订。_");
  }
  for (const revision of selected) {
    const source = repositoryUrl
      ? `（来源：${stripTrailingSlash(repositoryUrl)}@${revision.revision}）`
      : "";
    const shown = revision.changedPaths.slice(0, maxPaths);
    const omitted = Math.max(0, revision.changedPaths.length - shown.length);
    if (omitted > 0) {
      omittedPathCount += omitted;
      truncatedRevisions.push({ revision: revision.revision, omitted });
    }
    const omissionLine =
      omitted > 0
        ? `- …另有 ${omitted} 个路径未在摘要中显示，复制/导出完整版可查看全部 ${revision.changedPaths.length} 个路径。`
        : undefined;
    lines.push(
      `## r${revision.revision} · ${revision.author || "unknown"} ${source}`,
      "",
      revision.message || "（无提交说明）",
      "",
      `变更路径：${revision.changedPaths.length}`,
      ...shown.map((item) => `- ${item.action} ${item.path}`),
      ...(omissionLine ? [omissionLine] : []),
      "",
    );
    fullLines.push(
      `## r${revision.revision} · ${revision.author || "unknown"} ${source}`,
      "",
      revision.message || "（无提交说明）",
      "",
      `变更路径：${revision.changedPaths.length}`,
      ...revision.changedPaths.map((item) => `- ${item.action} ${item.path}`),
      "",
    );
  }
  return {
    markdown: lines.join("\n").trim(),
    fullMarkdown: fullLines.join("\n").trim(),
    count: selected.length,
    fromRevision: lower === undefined ? undefined : String(lower),
    toRevision: upper === undefined ? undefined : String(upper),
    omittedPathCount,
    truncatedRevisions,
    revisionsRead,
    complete,
    partialReason: options.partialReason,
    resolvedHeadRevision: options.resolvedHeadRevision,
    rangeNote: options.rangeNote,
  };
}

function readTag(xml: string, tag: string): string | undefined {
  const value = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`).exec(xml)?.[1];
  return value === undefined ? undefined : decodeXml(value.trim());
}

function decodeXml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

/** V026-R46：远端只读内容预览上限（内存展示用，不落盘）。 */
export const MAX_REMOTE_FILE_PREVIEW_BYTES = 256 * 1024;

/** V026-R46：远端文件历史默认读取条数上限。 */
export const MAX_REMOTE_HISTORY_ENTRIES = 50;

/** V026-R46：远端修订比较差异预览上限（字符数，超限截断只读展示）。 */
export const MAX_REMOTE_COMPARE_CHARS = 20000;

/**
 * V026-R43：结构化 URL 意图归一化（纯函数，Host/Webview/Mock 语义一致）。
 * - 空输入如实提示补填；非法 URL 沿用既有 validateRepositoryUrl 拒绝；
 * - 先逐段规范编码（中文/空格/# 正确编码，已编码不重复编码），再做仓库归属校验；
 * - crossRepository=true 表示语法合法但不在当前仓库根内（调用方就地解释，不合并执行）。
 */
export function normalizeRepositoryUrlIntent(
  rawValue: unknown,
  repositoryRoot?: string,
): { normalizedUrl: string; issues: string[]; crossRepository: boolean } {
  const raw = typeof rawValue === "string" ? rawValue.trim() : "";
  if (!raw) {
    return {
      normalizedUrl: "",
      issues: ["请输入完整且有效的 SVN URL。"],
      crossRepository: false,
    };
  }
  const normalizedUrl = normalizeSvnUrl(raw);
  const issues = validateRepositoryUrl(normalizedUrl, repositoryRoot);
  const crossRepository =
    issues.some((issue) => issue.includes("仓库根地址内")) ||
    (repositoryRoot
      ? !isSvnUrlWithinRepository(normalizedUrl, repositoryRoot)
      : false);
  return { normalizedUrl, issues, crossRepository };
}

/**
 * V026-R46：远端修订输入归一化（纯函数）。空表示未填（调用方按 HEAD/缺省处理）；
 * HEAD 大小写不敏感；正整数去前导零；其余 fail-closed 给出中文原因。
 */
export function normalizeRemoteRevisionInput(value: unknown): {
  revision?: string;
  issues: string[];
} {
  if (value === undefined || value === null) return { issues: [] };
  const raw = String(value).trim();
  if (!raw) return { issues: [] };
  if (/^head$/i.test(raw)) return { revision: "HEAD", issues: [] };
  if (/^\d+$/.test(raw)) {
    try {
      const parsed = BigInt(raw);
      if (parsed > 0n) return { revision: String(parsed), issues: [] };
    } catch {
      // 落入下方统一拒绝。
    }
  }
  return { issues: ["修订号只能填写正整数或 HEAD。"] };
}

/**
 * V026-R46：远端只读内容分类（纯函数，不触碰文件系统）。
 * - binary：含空字节即二进制，不展示正文；
 * - truncated：按 UTF-8 字节数裁剪预览，调用方必须展示截断说明与复制 URL 恢复出口。
 */
export function classifyRemoteContent(
  content: string,
  maxBytes: number = MAX_REMOTE_FILE_PREVIEW_BYTES,
): { truncated: boolean; binary: boolean; preview: string } {
  if (content.includes("\0")) {
    return { truncated: false, binary: true, preview: "" };
  }
  const encoder = new TextEncoder();
  if (encoder.encode(content).length <= maxBytes) {
    return { truncated: false, binary: false, preview: content };
  }
  let preview = content;
  while (preview.length > 0 && encoder.encode(preview).length > maxBytes) {
    preview = preview.slice(0, Math.max(0, Math.floor(preview.length / 2)));
  }
  return { truncated: true, binary: false, preview };
}

/**
 * V026-R46：从 `svn info --xml URL` 输出提取远端修订（只读展示用）。
 * 解析不到返回 undefined（调用方显示“修订未知”，不虚构）。
 */
export function extractRemoteRevisionFromInfoXml(
  xml: string,
): string | undefined {
  const commit = /<commit\s+revision="([^"]+)"/.exec(xml)?.[1];
  if (commit && /^\d+$/.test(commit)) return commit;
  const entry = /<entry[^>]*\srevision="([^"]+)"/.exec(xml)?.[1];
  if (entry && /^\d+$/.test(entry)) return entry;
  return undefined;
}

function parseRevision(value: string | undefined): number | undefined {
  return value && /^\d+$/.test(value.trim()) ? Number(value) : undefined;
}
