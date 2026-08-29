/**
 * V011-C 受控就地三动作领域逻辑（纯函数，不读 DOM/VS Code）。
 *
 * - 三动作 resolution 固定：current=采用我的修改、incoming=采用对方修改、both=保留双方修改（先我的后对方，另一顺序延期 v0.1.2，Tooltip 已说明）
 * - 按 parseConflictRegions 位置信息就地替换对应冲突块，返回新文本；损坏/越界 fail-closed 抛 ConflictParseError
 * - 过期校验：identity 与 hash 不匹配即 stale，不得基于旧快照继续
 */
import {
  hashText,
  parseConflictRegions,
  type ConflictParseError,
  type ConflictRegion,
  type ConflictFileIdentity,
  type ContentHash,
} from "./conflictDiffModel";

export type ConflictResolution = "current" | "incoming" | "both";

export interface ConflictResolutionSuccess {
  newText: string;
  appliedRegion: ConflictRegion;
  newHash: ContentHash;
}

export interface ConflictResolutionFailure {
  error: ConflictParseError;
}

export type ConflictResolutionResult =
  ConflictResolutionSuccess | ConflictResolutionFailure;

function joinBoth(mine: string, theirs: string): string {
  if (!mine) return theirs;
  if (!theirs) return mine;
  const needsNewline = !mine.endsWith("\n") && !theirs.startsWith("\n");
  return needsNewline ? `${mine}\n${theirs}` : `${mine}${theirs}`;
}

export function applyConflictResolution(
  workingText: string,
  conflictIndex: number,
  resolution: ConflictResolution,
): ConflictResolutionResult {
  const parsed = parseConflictRegions(workingText);
  if (parsed.error) {
    return { error: parsed.error };
  }
  const regions = parsed.regions;
  if (conflictIndex < 0 || conflictIndex >= regions.length) {
    return {
      error: {
        code: "missingStart",
        message: `冲突块索引越界：${conflictIndex}，当前共 ${regions.length} 块`,
        line: 0,
        snippet: String(conflictIndex),
      },
    };
  }
  const region = regions[conflictIndex]!;
  let replacement: string;
  if (resolution === "current") replacement = region.mine;
  else if (resolution === "incoming") replacement = region.theirs;
  else replacement = joinBoth(region.mine, region.theirs);
  const newText =
    workingText.slice(0, region.start) +
    replacement +
    workingText.slice(region.end);
  return { newText, appliedRegion: region, newHash: hashText(newText) };
}

export function isStaleConflictAction(
  expectedFileIdentity: ConflictFileIdentity,
  expectedHash: ContentHash,
  currentFileIdentity: ConflictFileIdentity,
  currentHash: ContentHash,
): boolean {
  return (
    expectedFileIdentity !== currentFileIdentity || expectedHash !== currentHash
  );
}

export function isStaleByText(
  expectedFileIdentity: ConflictFileIdentity,
  expectedHash: ContentHash,
  currentFileIdentity: ConflictFileIdentity,
  currentText: string,
): boolean {
  return isStaleConflictAction(
    expectedFileIdentity,
    expectedHash,
    currentFileIdentity,
    hashText(currentText),
  );
}
