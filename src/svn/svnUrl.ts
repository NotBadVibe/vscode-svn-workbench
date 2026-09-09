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
 * V026-R43：安全解码单个 URL 路径段。已编码输入（如 %20）还原一次，
 * 裸字符（含中文/空格/#/%) 保持原样；畸形 % 序列不断言失败，直接返回原文。
 */
export function decodeSvnUrlSegmentSafe(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * V026-R43：单段规范编码（先解一次再编码，避免 %20 → %2520 重复编码）。
 * Windows 盘符段（如 `C:`，含已误编码 `C%3A` 解码后形态）保持原样：file URL 盘符
 * 冒号是路径语法的一部分（`file:///C:/...`），编码成 `C%3A` 会导致与 svn
 * 返回的仓库根 URL 前缀比对失败（Windows file 仓库归属误判为跨仓库）及
 * 后续 svn 调用使用非规范 URL。纯字符串判断，不读 process。
 */
export function encodeSvnUrlSegmentOnce(segment: string): string {
  const decoded = decodeSvnUrlSegmentSafe(segment);
  if (/^[A-Za-z]:$/.test(decoded)) return decoded;
  return encodeURIComponent(decoded);
}

/**
 * V026-R43：规范化完整 SVN URL（逐段解后重编）。
 * - 去首尾空白与多余尾斜杠；非法 URL 返回裁剪后原文（调用方用 validate 拒绝）；
 * - SVN URL 不承载 query/hash 语义：`?`/`#` 视为路径字符逐段编码（未编码 `#`
 *   不得被 URL 解析吞成 fragment）；已编码输入先解一次，不重复编码；
 * - 中文/空格/# 正确编码；Windows file URL 盘符段（`C:`）冒号保留不编码；
 *   平台无关（纯字符串处理，不读 process）。
 */
export function normalizeSvnUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s/]*)(\/.*)?$/.exec(trimmed);
  if (!match) return trimmed;
  const [, authority, rest = ""] = match;
  const segments = rest
    .split("/")
    .filter((segment) => segment.length > 0)
    .map(encodeSvnUrlSegmentOnce);
  if (segments.length === 0) return authority;
  return `${authority}/${segments.join("/")}`;
}

/**
 * V026-R43：由已规范父 URL 与子条目名推导子 URL（浏览进入下级/复制 URL 用）。
 * 子名可能是 svn list 返回的解码名或手填编码串，统一解后重编一次。
 */
export function buildRepositoryChildUrl(
  parentUrl: string,
  childName: string,
): string {
  const base = normalizeSvnUrl(parentUrl).replace(/\/+$/, "");
  const segments = childName
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== ".")
    .map(encodeSvnUrlSegmentOnce);
  if (segments.length === 0) return base;
  return `${base}/${segments.join("/")}`;
}

/**
 * V026-R43：常用 branches/tags 路径与名称组合。name 可含多段（如 feature/xxx），
 * 逐段规范编码；root 非法时返回 undefined（调用方如实缺省，不猜测）。
 */
export function composeBranchTagUrl(
  repositoryRoot: string,
  family: "branches" | "tags" | "trunk",
  name: string,
): string | undefined {
  const trimmedRoot = repositoryRoot.trim();
  if (!trimmedRoot) return undefined;
  try {
    void new URL(trimmedRoot);
  } catch {
    return undefined;
  }
  const base = normalizeSvnUrl(trimmedRoot).replace(/\/+$/, "");
  if (family === "trunk") return `${base}/trunk`;
  const segments = name
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && segment !== ".")
    .map(encodeSvnUrlSegmentOnce);
  if (segments.length === 0) return undefined;
  return `${base}/${family}/${segments.join("/")}`;
}

/**
 * V026-R43：候选 URL 是否位于当前仓库根内（含等于根）。比较前两侧统一规范化，
 * 避免已编码/未编码书写差异造成误判；任一非法返回 false（fail-closed）。
 */
export function isSvnUrlWithinRepository(
  candidateUrl: string,
  repositoryRoot: string,
): boolean {
  const candidate = normalizeSvnUrl(candidateUrl).replace(/\/+$/, "");
  const root = normalizeSvnUrl(repositoryRoot).replace(/\/+$/, "");
  try {
    void new URL(candidate);
    void new URL(root);
  } catch {
    return false;
  }
  return candidate === root || candidate.startsWith(`${root}/`);
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
