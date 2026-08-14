import * as path from "node:path";
import type { PathIdentityKey } from "./pathBrands";

// 身份品牌在此 re-export，host 侧统一从 identity 模块取用；
// DisplayPath 属于协议/展示边界，不在此导出。
export type { PathIdentityKey } from "./pathBrands";

/**
 * 路径语义：platform + cwd 均必填。
 *
 * 领域纯函数不得自行读取 process.platform / process.cwd()；生产入口从
 * 唯一边界 `nativePathSemantics`（src/scope/nativePathSemantics.ts）注入，
 * 测试夹具必须显式注入 posix / win32。这样合成 POSIX 路径的测试在
 * Windows 开发机上也能得到确定语义，平台问题不会拖到 CI 才暴露。
 */
export interface PathSemantics {
  /** 路径规则（win32 或 posix）。 */
  platform: NodeJS.Platform;
  /** 相对路径解析基准。 */
  cwd: string;
}

function resolveOptions(options: PathSemantics): {
  pathApi: typeof path.posix;
} {
  return {
    pathApi: options.platform === "win32" ? path.win32 : path.posix,
  };
}

/**
 * 生成只用于 Map/Set、相等判断和范围比较的绝对路径身份键。
 *
 * Windows 使用 win32 路径语义并统一大小写；POSIX 保持大小写敏感。
 * 返回值是 PathIdentityKey 品牌，编译期不得赋给 DisplayPath 展示字段；
 * 调用方必须继续保留原始路径用于展示和真实文件操作，不能把身份键当作
 * 用户可见路径。
 */
export function normalizePathIdentity(
  value: string,
  options: PathSemantics,
): PathIdentityKey {
  const { pathApi } = resolveOptions(options);
  const resolved = pathApi.resolve(options.cwd, value);
  return (
    options.platform === "win32" ? resolved.toLowerCase() : resolved
  ) as PathIdentityKey;
}

export function isSamePathIdentity(
  left: string,
  right: string,
  options: PathSemantics,
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
  options: PathSemantics,
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
  options: PathSemantics,
): number {
  return normalizePathIdentity(left, options).localeCompare(
    normalizePathIdentity(right, options),
  );
}
