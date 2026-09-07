/**
 * V020-R08 · 变更集应用方案指纹（纯业务逻辑，无 VS Code/Svelte/Node 依赖）。
 *
 * 意图一致性缺陷：预览只绑定了工作副本候选集合 hash（candidateHash），
 * 未绑定用户实际看到的“方案”（目标组名称 + 路径集合 + 移出/应用方向）。
 * 预览后改名、删文件、改组只改变 Webview 本地状态，旧 token 仍可执行，
 * 用户看到新方案却可能执行旧方案。
 *
 * 双防线：
 * - Webview：名称/路径与预览不一致时旧预览只读，关闭执行入口；
 * - Host：保存方案指纹，执行前用最终方案（execute-apply 携带）比对，
 *   不一致 fail-closed，不能仅依赖 UI 禁用。
 *
 * 路径只做字符串归一化（去首尾空白、排序），不做平台路径解析，
 * 断言平台无关；大小写按 SVN 语义保持原样（不折叠）。
 */

export interface ChangelistPlan {
  /** 目标组名称；移出（remove=true）时忽略。 */
  name?: string;
  /** true=移出变更集，false=应用变更集。 */
  remove: boolean;
  /** 工作副本内相对路径集合（顺序无关）。 */
  paths: string[];
}

export interface NormalizedChangelistPlan {
  /** 移出时为空串，应用时为去首尾空白后的名称。 */
  name: string;
  remove: boolean;
  /** 去空白、去重、排序后的路径。 */
  paths: string[];
}

/** 归一化方案：名称 trim（移出时置空）、路径 trim 去空去重排序。 */
export function normalizeChangelistPlan(
  plan: ChangelistPlan,
): NormalizedChangelistPlan {
  const remove = plan.remove === true;
  const name = remove ? "" : (plan.name ?? "").trim();
  const seen = new Set<string>();
  for (const raw of plan.paths ?? []) {
    const path = (raw ?? "").trim();
    if (path) seen.add(path);
  }
  return { name, remove, paths: [...seen].sort() };
}

/** FNV-1a 32 位（与 conflictDiffModel.hashText 同族，纯字符串运算）。 */
function fnv1aHex(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * 方案指纹：归一化后 JSON 的 FNV-1a。
 * 仅用于意图一致性绑定（快照携带、执行前比对），最终防线另有
 * 精确相等比较（isSameChangelistPlan），不依赖哈希抗碰撞。
 */
export function hashChangelistPlan(plan: ChangelistPlan): string {
  const normalized = normalizeChangelistPlan(plan);
  return fnv1aHex(
    JSON.stringify({
      name: normalized.name,
      remove: normalized.remove,
      paths: normalized.paths,
    }),
  );
}

/** 两个方案归一化后是否完全一致（名称、方向、路径集合）。 */
export function isSameChangelistPlan(
  left: ChangelistPlan,
  right: ChangelistPlan,
): boolean {
  const a = normalizeChangelistPlan(left);
  const b = normalizeChangelistPlan(right);
  if (a.remove !== b.remove || a.name !== b.name) return false;
  if (a.paths.length !== b.paths.length) return false;
  return a.paths.every((path, index) => path === b.paths[index]);
}
