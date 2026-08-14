/*
 * v0.0.7 SVN URL 工具（§7.1 路径详情）。
 *
 * 约束：SVN URL 只能由“工作副本根 URL + 逐段 percent-encode 的工作副本内
 * 相对路径”推导；禁止把 repos-root 直接拼接工作副本内路径（工作副本可能
 * 检出自仓库子目录，如 …/Code2/trunk/app）。未版本化文件按同一规则推导
 * 其检出后 URL。任何信息不可得时如实缺省，不伪造 URL。
 */

/** 单个路径段的 URL 编码（空格、中文、#、% 等）。 */
export function encodeSvnUrlSegment(segment: string): string {
  return encodeURIComponent(segment);
}

/**
 * 由基础 URL 与 "/" 分隔相对路径推导目标 URL；相对路径逐段编码，
 * 空段与 "." 忽略。relativePath 为空或 "." 时返回基础 URL 本身。
 */
export function joinSvnUrl(baseUrl: string, relativePath: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  const segments = relativePath
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== ".");
  if (segments.length === 0) return base;
  return `${base}/${segments.map(encodeSvnUrlSegment).join("/")}`;
}

/**
 * 推导仓库内路径（相对 repository root URL）。工作副本根 URL 必须位于
 * repository root URL 之下，否则返回 undefined（如实缺省，不猜测）。
 * 返回解码后的可读路径。
 */
export function deriveRepositoryRelativePath(
  repositoryRootUrl: string,
  workingCopyUrl: string,
  workingCopyRelativePath: string,
): string | undefined {
  const root = repositoryRootUrl.replace(/\/+$/, "");
  const wcUrl = workingCopyUrl.replace(/\/+$/, "");
  let wcPart: string;
  if (wcUrl === root) {
    wcPart = "";
  } else if (wcUrl.startsWith(`${root}/`)) {
    wcPart = decodeURIComponent(wcUrl.slice(root.length + 1));
  } else {
    return undefined;
  }
  const relative =
    workingCopyRelativePath === "." ? "" : workingCopyRelativePath;
  const joined = [wcPart, relative].filter((part) => part.length > 0).join("/");
  return joined.length > 0 ? joined : undefined;
}
