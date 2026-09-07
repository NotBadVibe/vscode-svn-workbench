/*
 * V018-D 空白选项纯逻辑（v0.1.8 规划 §4.4）。
 *
 * 约束（硬约束：不动 Host/协议、不升级 @pierre/diffs）：
 * - “显示空白字符”只作用于渲染层（CSS 类、图例、备用视图符号、定位器预览），
 *   永不改变传入 FileDiff/Editor 的原始文本；
 * - “忽略空白”只改变比较呈现：归一化文本仅用于差异渲染与块导航，最终文本
 *   （草稿、保存、导出）始终使用原始文本；呈现时必须明确标注横幅；
 * - 切换永不静默删除/重写最终文本；做不到保留时只允许只读视图切换
 *   （见 canToggleIgnoreWhitespace）。
 */
import type { DiffHunk } from "./diffHunks";

/** 行级空白归一：行内空格/制表符序列折叠为单个空格，并去首尾空白。 */
export function normalizeLineForCompare(line: string): string {
  return line.replace(/[ \t]+/g, " ").trim();
}

/** 归一整段文本（保持行数不变，行号可直接映射回原始文本）。 */
export function normalizeTextForCompare(text: string): string {
  return text
    .split(/\r\n|\n/)
    .map(normalizeLineForCompare)
    .join("\n");
}

/** 两行是否仅存在空白差异。 */
export function linesEqualIgnoringWhitespace(a: string, b: string): boolean {
  return normalizeLineForCompare(a) === normalizeLineForCompare(b);
}

/**
 * 单个差异块是否仅由空白差异构成：
 * 归一化后两侧行序列完全相等（含纯空白行的增删：空序列归一后相等）。
 */
export function isWhitespaceOnlyHunk(hunk: DiffHunk): boolean {
  const oldJoined = hunk.oldLines.map(normalizeLineForCompare).join("\n");
  const newJoined = hunk.newLines.map(normalizeLineForCompare).join("\n");
  return oldJoined === newJoined;
}

/** 把差异块拆分为可见块与被忽略的纯空白块（单次 LCS，不做二次全文比较）。 */
export function splitHunksByWhitespace(hunks: DiffHunk[]): {
  visible: DiffHunk[];
  ignoredWhitespaceCount: number;
} {
  const visible = hunks.filter((hunk) => !isWhitespaceOnlyHunk(hunk));
  return { visible, ignoredWhitespaceCount: hunks.length - visible.length };
}

/** 是否存在纯空白差异（用于提示“忽略后视图会变化”）。 */
export function hasWhitespaceOnlyDifferences(hunks: DiffHunk[]): boolean {
  return hunks.some(isWhitespaceOnlyHunk);
}

/**
 * 冲突块是否仅由空白差异构成：我的/对方/基线三方归一后完全相等。
 * 文本比较，不触碰 marker/region/hash。
 */
export function isWhitespaceOnlyConflictBlock(
  mine: string,
  base: string | undefined,
  theirs: string,
): boolean {
  const mineNorm = normalizeTextForCompare(mine);
  const theirsNorm = normalizeTextForCompare(theirs);
  if (mineNorm !== theirsNorm) return false;
  if (base === undefined) return true;
  return normalizeTextForCompare(base) === mineNorm;
}

/** 忽略空白开关的只读限制契约（identity/草稿/undo 保留或只读限制）。 */
export interface WhitespaceToggleState {
  editing: boolean;
  dirty: boolean;
  /** 修订比较（patch 直渲）暂不支持忽略空白。 */
  isPatch: boolean;
  binary: boolean;
}

export type IgnoreWhitespaceBlockReason = "editing" | "patch" | "binary";

/**
 * 纯决策：当前是否允许切换“忽略空白”。
 * - 只读差异视图：直接允许（呈现层重建，不触碰身份/草稿/undo）；
 * - 页内编辑态（含干净编辑态）：拒绝——重建会丢弃 Editor 未落盘输入与 undo 栈；
 * - 修订比较/二进制：拒绝——patch 语法不可归一、二进制无文本比较。
 */
export function canToggleIgnoreWhitespace(state: WhitespaceToggleState): {
  allowed: boolean;
  reason?: IgnoreWhitespaceBlockReason;
} {
  if (state.binary) return { allowed: false, reason: "binary" };
  if (state.isPatch) return { allowed: false, reason: "patch" };
  if (state.editing) return { allowed: false, reason: "editing" };
  return { allowed: true };
}

/**
 * V020-R11 五类视图空白选项支持表（底座 @pierre/diffs 1.3.4 无逐字符空白符号 API
 * 与忽略空白 API，仅 enableTokenInteractionsOnWhitespace 交互开关）。
 * - 普通 Working/BASE（FileDiff 全文）：显示=受限（图例+定位器预览+备用 pre 符号，
 *   主代码不注入符号）；忽略=支持（归一比较呈现+横幅+计数，最终文本不变；编辑态禁用）。
 * - 历史修订比较（patch 直渲）：显示/忽略均禁用（patch 语法不可归一，符号会破坏 @@/Index 行）。
 * - 备用/降级（pre/MergeView）：显示=支持（pre 按段渲染符号，文本不变）；忽略=禁用（只读呈现不做比较过滤）。
 * - 冲突（UnresolvedFile）：显示=受限（图例+定位器，挂载文本恒原始）；忽略准确命名为
 *   「标记纯空白块」（仅横幅+定位器状态+计数，不过滤块、不改 marker/hash/行号、不自动 Resolve）。
 * - 编辑（Editor/简化编辑器）：显示=允许保持（仅图例，不改编辑文本，保存字节不含符号）；
 *   忽略=禁用（进入编辑自动退出并提示，始终原始文本）。
 */
export type WhitespaceViewKind =
  "normal" | "history" | "fallback" | "conflict" | "editing";

export interface WhitespaceViewSupport {
  kind: WhitespaceViewKind;
  label: string;
  show: string;
  ignore: string;
}

export const WHITESPACE_VIEW_SUPPORT: readonly WhitespaceViewSupport[] = [
  {
    kind: "normal",
    label: "普通 Working/BASE",
    show: "受限：图例+定位器预览+备用视图符号，主代码不注入符号",
    ignore: "支持：归一比较呈现+横幅+计数，最终文本不变；编辑态禁用",
  },
  {
    kind: "history",
    label: "历史修订比较（Patch 直渲）",
    show: "禁用：Patch 语法不可逐字符标注",
    ignore: "禁用：Patch 语法不可归一",
  },
  {
    kind: "fallback",
    label: "备用/降级（pre/MergeView）",
    show: "支持：pre 按段渲染符号，文本不变",
    ignore: "禁用：降级只做只读呈现，不做比较过滤",
  },
  {
    kind: "conflict",
    label: "冲突（UnresolvedFile）",
    show: "受限：图例+定位器，挂载文本恒为原始",
    ignore:
      "标记纯空白块：仅横幅+定位器状态+计数，不改 marker/hash/行号，不自动 Resolve",
  },
  {
    kind: "editing",
    label: "编辑（Editor/简化编辑器）",
    show: "允许保持：仅图例，不改编辑文本，保存字节不含符号",
    ignore: "禁用：进入编辑自动退出并提示，始终原始文本",
  },
] as const;

export type ShowWhitespaceBlockReason = "patch" | "binary";

/**
 * V020-R11：显示空白字符的只读门控。底座 FileDiff/patch 直渲无逐字符符号 API，
 * 修订比较（patch）与二进制禁用并解释；普通/冲突/编辑主视图允许保持（受限：
 * 仅图例+定位器+备用 pre 符号，不向 pierre 文本注入符号）。
 */
export function canToggleShowWhitespace(state: {
  isPatch: boolean;
  binary: boolean;
}): { allowed: boolean; reason?: ShowWhitespaceBlockReason } {
  if (state.binary) return { allowed: false, reason: "binary" };
  if (state.isPatch) return { allowed: false, reason: "patch" };
  return { allowed: true };
}

/**
 * 显示空白字符的行预览展开（仅用于图例/定位器提示/备用视图符号，永不写回内容）：
 * 空格→·，制表符→→，行尾标记由调用方追加 ↵。
 */
export function expandWhitespaceForPreview(line: string): string {
  return line.replace(/ /g, "·").replace(/\t/g, "→");
}

/** 备用 <pre> 视图的空白分段（无 {@html}，调用方按段渲染 span）。 */
export type WhitespaceSegmentKind = "text" | "space" | "tab";

export interface WhitespaceSegment {
  text: string;
  kind: WhitespaceSegmentKind;
}

/** 把单行切分为文本/空格/制表符段（换行符由调用方处理）。 */
export function segmentLineWhitespace(line: string): WhitespaceSegment[] {
  const segments: WhitespaceSegment[] = [];
  const pattern = /[ \t]+|[^ \t]+/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(line)) !== null) {
    const text = match[0];
    segments.push({
      text,
      kind: text[0] === " " ? "space" : text[0] === "\t" ? "tab" : "text",
    });
  }
  return segments;
}
