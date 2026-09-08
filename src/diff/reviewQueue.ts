/**
 * V023-R18 连续多文件审阅队列纯领域模型（Host/Webview/Mock 共用）。
 *
 * 只读语义：队列只描述“按什么顺序看哪些文件”，不携带任何可写操作身份
 * （不含 token、绝对路径、凭据）。已看状态绑定内容指纹：
 * `reviewedHashes[relativePath] === currentContentHash` 才视为已看，
 * 内容变化后自动回到待审阅。
 *
 * 平台无关：只做字符串运算，不读 process、不调 node:path、不碰文件系统；
 * 范围/仓库隔离由调用方（Host）按 scopeHash + repositoryUuid 绑定后执行。
 */

/** 审阅队列 Host 会话状态（只存相对展示路径与指纹，不存绝对路径）。 */
export interface ReviewQueueState {
  /** 队列顺序 = 建立时的明确选择顺序（去重后）。 */
  queue: string[];
  /** 已看指纹：relativePath -> 建立标记时的内容指纹。 */
  reviewedHashes: Record<string, string>;
  /** 建立/刷新时的范围哈希（变化即按新范围求交）。 */
  scopeHash: string;
  /** 所属仓库 UUID（跨仓库永不共用队列）。 */
  repositoryUuid: string;
}

/** 队列单项视图（随 DiffSnapshot 下发，只读展示用）。 */
export interface ReviewQueueItemView {
  relativePath: string;
  /** 当前文件项携带权威指纹；非当前项为 ""（打开时 Host 校验）。 */
  contentHash: string;
  /** 是否为当前正在审阅的文件。 */
  current: boolean;
  /** 已看（仅当前项经指纹比对；非当前项表示曾标记，打开时复验）。 */
  reviewed: boolean;
}

/** 审阅队列视图（DiffSnapshot.review）。 */
export interface ReviewQueueView {
  queue: ReviewQueueItemView[];
  /** 当前下标（0-based；目标不在队列时为 -1，此时不展示队列条）。 */
  index: number;
  total: number;
  reviewedCount: number;
  unreviewedCount: number;
  scopeHash: string;
  repositoryUuid: string;
  /** 移除/过期/变化说明（中文，直接可播报）。 */
  notice?: string;
}

/** FNV-1a 32-bit 内容指纹（8 位 hex，平台无关，与 conflict hashText 同算法族）。 */
export function hashReviewContent(content: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** 审阅路径归一：分隔符统一为 `/`，去首尾空白与 `./` 前缀；非法返回 undefined。 */
export function normalizeReviewPath(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().replace(/\\/g, "/");
  if (trimmed.length === 0) return undefined;
  const withoutDot = trimmed.startsWith("./") ? trimmed.slice(2) : trimmed;
  if (
    withoutDot.length === 0 ||
    withoutDot === "." ||
    withoutDot.split("/").includes("..")
  ) {
    return undefined;
  }
  return withoutDot.replace(/\/{2,}/g, "/");
}

/**
 * 从明确选择建立队列：保序去重，只收合法路径（非法逐项说明）。
 * 不补、不猜、不排序——新文件永不静默加入由调用方保证（只传明确选择）。
 */
export function establishReviewQueue(requested: readonly unknown[]): {
  queue: string[];
  removed: Array<{
    path: string;
    reason: "invalid" | "duplicate";
    message: string;
  }>;
} {
  const queue: string[] = [];
  const seen = new Set<string>();
  const removed: Array<{
    path: string;
    reason: "invalid" | "duplicate";
    message: string;
  }> = [];
  for (const raw of requested) {
    const normalized = normalizeReviewPath(raw);
    const rawLabel = typeof raw === "string" ? raw : "(未知路径)";
    if (normalized === undefined) {
      removed.push({
        path: rawLabel,
        reason: "invalid",
        message: `已忽略非法路径“${rawLabel}”，未加入审阅队列。`,
      });
      continue;
    }
    if (seen.has(normalized)) {
      removed.push({
        path: normalized,
        reason: "duplicate",
        message: `“${normalized}”在选择中重复出现，队列中只保留一项。`,
      });
      continue;
    }
    seen.add(normalized);
    queue.push(normalized);
  }
  return { queue, removed };
}

/**
 * 范围刷新求交：只保留 `isAvailable` 为真的项，顺序不变，永不新增。
 * 返回 kept/removed（removed 逐项说明，供界面播报）。
 */
export function intersectReviewQueue(
  queue: readonly string[],
  isAvailable: (relativePath: string) => boolean,
  reason: (relativePath: string) => string = () =>
    "该文件已不在当前范围内（删除、移出范围或状态已变化），已从审阅队列移除。",
): {
  kept: string[];
  removed: Array<{ path: string; message: string }>;
} {
  const kept: string[] = [];
  const removed: Array<{ path: string; message: string }> = [];
  for (const item of queue) {
    if (isAvailable(item)) {
      kept.push(item);
    } else {
      removed.push({ path: item, message: `“${item}”：${reason(item)}` });
    }
  }
  return { kept, removed };
}

/** 已看判定：存储指纹与当前指纹一致才视为已看。 */
export function isReviewFresh(
  storedHash: string | undefined,
  currentHash: string,
): boolean {
  return storedHash !== undefined && storedHash === currentHash;
}

/** 队列导航：返回上一/下一项（越界返回 undefined，由调用方给出非阻塞反馈）。 */
export function navigateReviewQueue(
  queue: readonly string[],
  current: string,
  direction: -1 | 1,
): string | undefined {
  const index = queue.indexOf(current);
  if (index < 0) return undefined;
  const next = index + direction;
  if (next < 0 || next >= queue.length) return undefined;
  return queue[next];
}

/**
 * 装配下发视图。`currentHashes` 只需为当前文件提供权威指纹；
 * 非当前项的 reviewed 表示“曾标记”（打开时 Host 按指纹复验，
 * 变化即回到待审阅并给出 notice）。
 */
export function toReviewQueueView(input: {
  queue: readonly string[];
  currentRelativePath: string;
  currentContentHash: string;
  reviewedHashes: Readonly<Record<string, string>>;
  scopeHash: string;
  repositoryUuid: string;
  notice?: string;
}): ReviewQueueView {
  const items: ReviewQueueItemView[] = input.queue.map((relativePath) => {
    const current = relativePath === input.currentRelativePath;
    if (current) {
      return {
        relativePath,
        contentHash: input.currentContentHash,
        current,
        reviewed: isReviewFresh(
          input.reviewedHashes[relativePath],
          input.currentContentHash,
        ),
      };
    }
    return {
      relativePath,
      contentHash: "",
      current,
      reviewed: input.reviewedHashes[relativePath] !== undefined,
    };
  });
  const index = input.queue.indexOf(input.currentRelativePath);
  const reviewedCount = items.filter((item) => item.reviewed).length;
  return {
    queue: items,
    index,
    total: items.length,
    reviewedCount,
    unreviewedCount: items.length - reviewedCount,
    scopeHash: input.scopeHash,
    repositoryUuid: input.repositoryUuid,
    ...(input.notice !== undefined ? { notice: input.notice } : {}),
  };
}
