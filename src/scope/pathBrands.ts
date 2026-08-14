/*
 * v0.0.8 路径身份与展示边界品牌（零依赖，可安全进入 Webview 包）。
 *
 * 归属：身份领域（src/scope/）。协议层经 type-only import 引用
 * DisplayPath，Host 展示边界引用 toDisplayPath；scope 领域不反向依赖
 * protocol，避免层级耦合。
 *
 * PathIdentityKey：只由 src/scope/pathIdentity.ts 的 normalizePathIdentity
 * 产生，只能用于 Map/Set、相等、排序、缓存键与范围判断。Windows 下它是
 * 小写化的身份键，绝不能作为展示文本、协议字段或真实文件/SVN 操作路径。
 *
 * DisplayPath：协议快照与界面展示路径字段的类型。两个品牌都是 string 的
 * 结构化子类型且互不兼容，因此 identity 键在编译期无法直接赋给展示字段；
 * toDisplayPath 是展示边界唯一显式转换入口，其参数约束（DisplayPathSource）
 * 在类型层面拒绝 PathIdentityKey —— 直接传入 identity 键是编译错误。
 *
 * 本模块不得 import 任何 node:* 或 src 内其他模块。
 */

/** 不透明路径身份键；只用于比较、Map/Set、排序、缓存与范围判断。 */
export type PathIdentityKey = string & {
  readonly __pathIdentityKey: unique symbol;
};

/** 协议/界面展示路径；禁止使用 identity 键直接填充。 */
export type DisplayPath = string & {
  readonly __displayPath: unique symbol;
};

/**
 * toDisplayPath 的参数类型：普通展示字符串（含字面量与宽泛 string）可接受；
 * PathIdentityKey 会被条件类型折叠为 never，使直接传入 identity 键成为
 * 编译错误。这是对“品牌 string 是 string 子类型”逃生口的类型级封堵。
 */
export type DisplayPathSource<T extends string> = T &
  (T extends PathIdentityKey ? never : unknown);

/**
 * 展示边界的显式转换：把调用方持有的原始展示路径标记为 DisplayPath。
 * 直接传入 PathIdentityKey 会在编译期被拒绝；identity 键不得作为参数。
 */
export function toDisplayPath<T extends string>(
  value: DisplayPathSource<T>,
): DisplayPath {
  // 受审计的展示边界构造器。DisplayPathSource 已排除 PathIdentityKey；
  // 不能对条件类型直接断言（TS2352），先经超类型 string（widening 合法）
  // 再做单层品牌断言，不经过 unknown。
  const raw: string = value;
  return raw as DisplayPath;
}

type Assert<T extends true> = T;

/**
 * 品牌互斥契约（被 npm run check 的 tsc 与 svelte-check 检查）：
 * PathIdentityKey 不得赋值给 DisplayPath，反之亦然。任一方向品牌变得可
 * 互相赋值时，条件类型解析为 false，无法满足 `T extends true`，编译失败。
 */
export type PathIdentityNotDisplayPath = Assert<
  [PathIdentityKey] extends [DisplayPath] ? false : true
>;
export type DisplayPathNotPathIdentity = Assert<
  [DisplayPath] extends [PathIdentityKey] ? false : true
>;

/**
 * toDisplayPath 参数约束契约：DisplayPathSource<PathIdentityKey> 必须折叠
 * 为 never。若未来参数约束被放宽（例如改回 string），本类型解析为 false，
 * 编译失败。
 */
export type DisplayPathRejectsIdentityKey = Assert<
  DisplayPathSource<PathIdentityKey> extends never ? true : false
>;
