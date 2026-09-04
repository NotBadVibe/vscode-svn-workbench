/*
 * V018-D 定位器（overview/locator）纯模型（v0.1.8 规划 §4.4）。
 *
 * DiffOverview.svelte 只负责渲染与交互；块构造、行号换算、占比与中文标签
 * 全部为纯函数，可独立单测（含 100/500 块预算实测）。
 * 滚动只改变导航索引，不触碰文件目标、操作范围与快照状态。
 */
import type { DiffHunk } from "./diffHunks";
import { parseTextConflictBlocks } from "../../../conflict/conflictMerge";
import {
  expandWhitespaceForPreview,
  isWhitespaceOnlyConflictBlock,
} from "./diffWhitespace";

/** 定位器块状态：图形+文字/aria 双通道，不只用颜色区分。 */
export type OverviewBlockStatus =
  "change" | "conflict-unresolved" | "whitespace-only";

export interface OverviewBlock {
  key: string;
  /** 1-based 起始行（含），用于导航与占比。 */
  startLine: number;
  /** 1-based 结束行（含）。 */
  endLine: number;
  status: OverviewBlockStatus;
  /** 中文短标签（同时用于按钮文本与 aria-label，不只靠颜色）。 */
  label: string;
  /** 首行预览（空白已展开为 ·/→，仅提示用，不写回内容）。 */
  preview?: string;
}

/** 块在全文中的纵向占比（0..1，已钳制，供定位条分布渲染）。 */
export function blockFraction(
  startLine: number,
  endLine: number,
  totalLines: number,
): { top: number; height: number } {
  const total = Math.max(1, Math.floor(totalLines));
  const start = Math.min(Math.max(1, startLine), total);
  const end = Math.min(Math.max(start, endLine), total);
  return {
    top: (start - 1) / total,
    height: Math.max(1, end - start + 1) / total,
  };
}

/** 状态中文（图形符号 + 文字，读屏与视觉双通道）。 */
export function overviewStatusText(status: OverviewBlockStatus): string {
  switch (status) {
    case "change":
      return "● 变更";
    case "conflict-unresolved":
      return "◆ 未处理冲突";
    case "whitespace-only":
      return "○ 仅空白差异";
  }
}

/** 块按钮的完整可访问名称（位置 + 状态，不只靠颜色）。 */
export function overviewBlockAriaLabel(
  index: number,
  total: number,
  block: OverviewBlock,
): string {
  return `定位到第 ${index + 1}/${total} 块，第 ${block.startLine} 行，${overviewStatusText(block.status)}`;
}

/** 普通 Diff：由差异块构造定位块（调用方传入展示态 hunks，过滤逻辑在外）。 */
export function buildDiffOverviewBlocks(hunks: DiffHunk[]): OverviewBlock[] {
  return hunks.map((hunk, index) => {
    const firstLine =
      hunk.newLines.find((line) => line.length > 0) ??
      hunk.oldLines.find((line) => line.length > 0) ??
      "";
    return {
      key: `diff-${index}`,
      startLine: Math.max(1, hunk.newStart),
      endLine: Math.max(hunk.newStart, hunk.newEnd),
      status: "change" as const,
      label: `第 ${Math.max(1, hunk.newStart)} 行`,
      preview:
        firstLine.length > 0
          ? expandWhitespaceForPreview(firstLine.slice(0, 80))
          : undefined,
    };
  });
}

/** 冲突：由合并草稿文本直接解析块并换算行号（不切分文件，不改 marker）。 */
export function buildConflictOverviewBlocks(
  mergeDraft: string,
  ignoreWhitespace: boolean,
): OverviewBlock[] {
  let blocks: ReturnType<typeof parseTextConflictBlocks>;
  try {
    blocks = parseTextConflictBlocks(mergeDraft);
  } catch {
    return [];
  }
  if (blocks.length === 0) return [];
  const lineStarts: number[] = [0];
  for (let i = 0; i < mergeDraft.length; i += 1) {
    if (mergeDraft.charCodeAt(i) === 10) lineStarts.push(i + 1);
  }
  const lineOf = (offset: number): number => {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (lineStarts[mid] <= offset) low = mid;
      else high = mid - 1;
    }
    return low + 1;
  };
  return blocks.map((block) => {
    const whitespaceOnly = isWhitespaceOnlyConflictBlock(
      block.mine,
      block.base,
      block.theirs,
    );
    return {
      key: `conflict-${block.index}`,
      startLine: lineOf(block.start),
      endLine: lineOf(Math.max(block.start, block.end - 1)),
      status:
        whitespaceOnly && ignoreWhitespace
          ? ("whitespace-only" as const)
          : ("conflict-unresolved" as const),
      label: `第 ${lineOf(block.start)} 行`,
      preview: expandWhitespaceForPreview(
        (block.mine.split("\n")[0] ?? "").slice(0, 80),
      ),
    };
  });
}

/** 冲突草稿中的纯空白块数量（仅计数，不改文本，供横幅标注）。 */
export function countWhitespaceOnlyConflictBlocks(mergeDraft: string): number {
  let blocks: ReturnType<typeof parseTextConflictBlocks>;
  try {
    blocks = parseTextConflictBlocks(mergeDraft);
  } catch {
    return 0;
  }
  return blocks.filter((block) =>
    isWhitespaceOnlyConflictBlock(block.mine, block.base, block.theirs),
  ).length;
}

/**
 * 定位器摘要（X/Y + 未处理数，文字通道；调用方同时用 role=status 播报）。
 */
export function overviewSummaryLabel(
  currentIndex: number,
  total: number,
): string {
  if (total === 0) return "暂无可定位的变更块";
  return `定位器 ${currentIndex + 1}/${total} 块`;
}
