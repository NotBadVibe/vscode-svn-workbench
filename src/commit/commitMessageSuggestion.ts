import { validateCommitMessage } from "./commitMessageTemplates";

/*
 * v0.0.9 §4 提交说明建议草稿纯逻辑：
 * - 生成（模型或本地回退）、失败、超时、取消、降级、过期均不覆盖用户草稿；
 * - 采用必须显式（插入空白字段 / 替换）并在替换前展示字符数；
 * - 替换提供撤销（调用方保留替换前草稿）；用户已填写的字段不得被
 *   插入动作改写。
 */

/** 提交说明字符上限（与 validateCommitMessage 一致）。 */
export const COMMIT_MESSAGE_MAX_LENGTH = 2000;

/**
 * 插入空白字段：把建议中的空白字段（值为空的“标签: ”行）插入当前草稿，
 * 只补充、不删除、不改写用户已有内容。返回新草稿与说明。
 */
export function insertSuggestionBlankFields(
  currentMessage: string,
  suggestionMessage: string,
): { message: string; inserted: string[] } {
  if (!currentMessage.trim()) {
    return { message: suggestionMessage, inserted: [] };
  }
  const currentFields = new Set(collectFieldLabels(currentMessage));
  const inserted: string[] = [];
  const currentLines = normalizeLines(currentMessage);
  const blankLines = normalizeLines(suggestionMessage).filter((line) => {
    const field = parseBlankFieldLine(line);
    return field !== undefined && !currentFields.has(field.label);
  });
  if (blankLines.length === 0) {
    return { message: currentMessage, inserted };
  }
  const message = [...currentLines, ...blankLines].join("\n");
  return { message, inserted: blankLines };
}

/**
 * 替换前检查：超过字符上限或与当前草稿相同时拒绝替换，
 * 返回中文原因；成功返回替换后的草稿。
 */
export function replaceDraftWithSuggestion(
  currentMessage: string,
  suggestionMessage: string,
): { ok: true; message: string } | { ok: false; reason: string } {
  const next = suggestionMessage.trim();
  if (!next) {
    return { ok: false, reason: "建议内容为空，未替换当前草稿。" };
  }
  if (next === currentMessage.trim()) {
    return {
      ok: false,
      reason: "建议内容与当前草稿相同，未重复替换。",
    };
  }
  const validation = validateCommitMessage(next);
  if (!validation.valid) {
    return { ok: false, reason: validation.issues.join(" ") };
  }
  return { ok: true, message: next };
}

/** 与当前草稿的结构化差异（行级）：供建议区展示对比。 */
export function diffDraftAgainstSuggestion(
  currentMessage: string,
  suggestionMessage: string,
): {
  /** 相对当前草稿新增的行。 */
  added: string[];
  /** 当前草稿中不存在于建议里的行（将被替换动作移除）。 */
  removed: string[];
  /** 完全相同的行数量。 */
  unchanged: number;
} {
  const currentLines = normalizeLines(currentMessage);
  const suggestionLines = normalizeLines(suggestionMessage);
  const currentCount = countLines(currentLines);
  const suggestionCount = countLines(suggestionLines);
  const added: string[] = [];
  const removed: string[] = [];
  let unchanged = 0;
  for (const line of suggestionLines) {
    if ((currentCount.get(line) ?? 0) > 0) {
      unchanged += 1;
      currentCount.set(line, (currentCount.get(line) ?? 1) - 1);
    } else {
      added.push(line);
    }
  }
  for (const line of currentLines) {
    if ((suggestionCount.get(line) ?? 0) > 0) {
      suggestionCount.set(line, (suggestionCount.get(line) ?? 1) - 1);
    } else {
      removed.push(line);
    }
  }
  return { added, removed, unchanged };
}

function collectFieldLabels(message: string): string[] {
  const labels: string[] = [];
  for (const line of normalizeLines(message)) {
    const match = /^(\s*[^:：]+)\s*[:：]\s*(.*)$/.exec(line);
    if (match) labels.push(match[1].trim());
  }
  return labels;
}

/** 仅识别“标签:”且值为空的行（空白字段）。 */
function parseBlankFieldLine(line: string): { label: string } | undefined {
  const match = /^(\s*[^:：]+)\s*[:：]\s*$/.exec(line);
  if (!match) return undefined;
  const label = match[1].trim();
  return label ? { label } : undefined;
}

function normalizeLines(value: string): string[] {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

function countLines(lines: string[]): Map<string, number> {
  const count = new Map<string, number>();
  for (const line of lines) {
    count.set(line, (count.get(line) ?? 0) + 1);
  }
  return count;
}
