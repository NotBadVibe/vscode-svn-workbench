import * as path from "node:path";

export interface PathIdentityOptions {
  /** 默认使用当前 Node.js 平台；测试可显式传入 win32。 */
  platform?: NodeJS.Platform;
  /** 相对路径解析基准；默认使用当前进程目录。 */
  cwd?: string;
}

function resolveOptions(options: PathIdentityOptions): {
  platform: NodeJS.Platform;
  cwd: string;
  pathApi: typeof path.posix;
} {
  const platform = options.platform ?? process.platform;
  return {
    platform,
    cwd: options.cwd ?? process.cwd(),
    pathApi: platform === "win32" ? path.win32 : path.posix,
  };
}

/**
 * 生成只用于 Map/Set、相等判断和范围比较的绝对路径身份键。
 *
 * Windows 使用 win32 路径语义并统一大小写；POSIX 保持大小写敏感。
 * 调用方必须继续保留原始路径用于展示和真实文件操作，不能把身份键当作
 * 用户可见路径。
 */
export function normalizePathIdentity(
  value: string,
  options: PathIdentityOptions = {},
): string {
  const { platform, cwd, pathApi } = resolveOptions(options);
  const resolved = pathApi.resolve(cwd, value);
  return platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function isSamePathIdentity(
  left: string,
  right: string,
  options: PathIdentityOptions = {},
): boolean {
  return (
    normalizePathIdentity(left, options) ===
    normalizePathIdentity(right, options)
  );
}

/**
 * 判断 candidate 是否等于 root 或位于 root 内部。
 * 使用 path.relative 避免 `/repo/a` 错误覆盖 `/repo/ab`，同时允许名为
 * `..cache` 的合法子目录。
 */
export function isSameOrDescendantPath(
  candidate: string,
  root: string,
  options: PathIdentityOptions = {},
): boolean {
  const { pathApi } = resolveOptions(options);
  const candidateKey = normalizePathIdentity(candidate, options);
  const rootKey = normalizePathIdentity(root, options);
  const relative = pathApi.relative(rootKey, candidateKey);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${pathApi.sep}`) &&
      !pathApi.isAbsolute(relative))
  );
}

export function comparePathIdentity(
  left: string,
  right: string,
  options: PathIdentityOptions = {},
): number {
  return normalizePathIdentity(left, options).localeCompare(
    normalizePathIdentity(right, options),
  );
}
