import type { SvnRevision } from "../history/svnHistoryParser";

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

export function buildReleaseNotes(
  revisions: SvnRevision[],
  fromRevision?: string,
  toRevision?: string,
  repositoryUrl?: string,
): {
  markdown: string;
  count: number;
  fromRevision?: string;
  toRevision?: string;
} {
  const from = parseRevision(fromRevision);
  const to = parseRevision(toRevision);
  const lower =
    from !== undefined && to !== undefined ? Math.min(from, to) : from;
  const upper =
    from !== undefined && to !== undefined ? Math.max(from, to) : to;
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
  const lines = [
    "# SVN 发布说明",
    "",
    `修订范围：${lower === undefined ? "全部已加载" : `r${lower}`} → ${upper === undefined ? "最新" : `r${upper}`}`,
    "",
  ];
  if (selected.length === 0) lines.push("_所选范围没有已加载修订。_");
  for (const revision of selected) {
    const source = repositoryUrl
      ? `（来源：${stripTrailingSlash(repositoryUrl)}@${revision.revision}）`
      : "";
    lines.push(
      `## r${revision.revision} · ${revision.author || "unknown"} ${source}`,
      "",
      revision.message || "（无提交说明）",
      "",
      `变更路径：${revision.changedPaths.length}`,
      ...revision.changedPaths
        .slice(0, 20)
        .map((item) => `- ${item.action} ${item.path}`),
      "",
    );
  }
  return {
    markdown: lines.join("\n").trim(),
    count: selected.length,
    fromRevision: lower === undefined ? undefined : String(lower),
    toRevision: upper === undefined ? undefined : String(upper),
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

function parseRevision(value: string | undefined): number | undefined {
  return value && /^\d+$/.test(value.trim()) ? Number(value) : undefined;
}
