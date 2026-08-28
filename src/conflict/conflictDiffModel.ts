/**
 * v0.1.1 V011-A 冲突角色与 marker 领域模型（纯函数，不读 DOM/VS Code）。
 *
 * 职责（对照 docs/releases/v0.1.1/README.md §3.1）：
 * - 输入为 Host 已校验的 BASE、Mine、Theirs、Working 文本与 revision 元数据；
 * - 生成稳定 ConflictFileIdentity、ConflictRegionIdentity 与内容 hash（品牌类型），索引不作永久身份；
 * - 明确“我的修改（本地）”“对方修改（仓库 rN）”“共同基线（BASE）”“合并结果”显示模型；
 * - 根据真实 marker 数据构造 Pierre 输入；解析失败返回结构化原因，不猜测、不自动修复；
 * - CRLF、BOM、末尾换行与无 BASE marker 不被静默规范化。
 *
 * SVN 真实 marker 顺序（已固化，见 §SVN 顺序注释与 tests 证据）：
 *   <<<<<<< .mine\n
 *   Mine 段（多行，可含任意文本，含中文）\n
 *   ||||||| .rBASE（可选，仅 SVN 有；Git 无此行）\n
 *   Base 段（可选）\n
 *   =======\n
 *   Theirs 段（多行）\n
 *   >>>>>>> .rN\n
 * 顺序固定为 .mine → (可选 ||||||| .rBASE) → ======= → >>>>>>>，不能凭 current/incoming 字面名映射 Mine/Theirs；
 * 解析时按位置判定：首段为 Mine、尾段为 Theirs，中间可选为 Base。
 */

export type ConflictFileIdentity = string & { readonly __brand: unique symbol };
export type ConflictRegionIdentity = string & {
  readonly __brand: unique symbol;
};
export type ContentHash = string & { readonly __brand: unique symbol };

export type ConflictParseErrorCode =
  | "missingSeparator"
  | "missingEnd"
  | "unfinished"
  | "nested"
  | "missingStart"
  | "unexpectedMarker";

export interface ConflictParseError {
  code: ConflictParseErrorCode;
  message: string;
  line: number;
  snippet: string;
}

export interface ConflictRegion {
  identity: ConflictRegionIdentity;
  transientIndex: number;
  start: number;
  end: number;
  startLine: number;
  endLine: number;
  mine: string;
  base?: string;
  theirs: string;
  hasBase: boolean;
  mineLineCount: number;
  baseLineCount?: number;
  theirsLineCount: number;
}

export interface ConflictFileModel {
  fileIdentity: ConflictFileIdentity;
  relativePath: string;
  repositoryRoot: string;
  workingHash: ContentHash;
  baseHash: ContentHash;
  mineHash: ContentHash;
  theirsHash: ContentHash;
  regions: ConflictRegion[];
  hasBase: boolean;
  display: {
    mineLabel: string;
    theirsLabel: string;
    baseLabel: string;
    mergedLabel: string;
  };
  parseError?: ConflictParseError;
  rawWorkingText: string;
}

export interface ConflictFileInput {
  repositoryRoot: string;
  relativePath: string;
  workingText: string;
  baseText: string;
  mineText: string;
  theirsText: string;
  baseRevision?: string;
  theirsRevision?: string;
}

export function hashText(value: string): ContentHash {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0") as ContentHash;
}

export function buildConflictFileIdentity(
  repositoryRoot: string,
  relativePath: string,
): ConflictFileIdentity {
  const normalizedRoot = repositoryRoot.replace(/\\/g, "/");
  const normalizedPath = relativePath.replace(/\\/g, "/");
  return `${normalizedRoot}\u0000${normalizedPath}` as ConflictFileIdentity;
}

export function buildConflictRegionIdentity(
  fileIdentity: ConflictFileIdentity,
  regionHash: ContentHash,
): ConflictRegionIdentity {
  return `${fileIdentity}\u0000${regionHash}` as ConflictRegionIdentity;
}

function countLines(text: string): number {
  if (text === "") return 0;
  const normalized = text.replace(/\r\n/g, "\n");
  const parts = normalized.split("\n");
  if (parts.length > 0 && parts[parts.length - 1] === "")
    return parts.length - 1;
  return parts.length;
}

function isStartMarker(line: string): boolean {
  return line.startsWith("<<<<<<<");
}
function isBaseMarker(line: string): boolean {
  return line.startsWith("|||||||");
}
function isSeparatorMarker(line: string): boolean {
  return line === "=======" || line.startsWith("=======");
}
function isEndMarker(line: string): boolean {
  return line.startsWith(">>>>>>>");
}

function strictSeparator(line: string): boolean {
  return /^={7,}$/.test(line);
}

function snippetOf(line: string): string {
  return line.slice(0, 80);
}

export function parseConflictRegions(workingText: string): {
  regions: ConflictRegion[];
  error?: ConflictParseError;
} {
  const fileIdentity = "" as ConflictFileIdentity;
  const raw = workingText;
  const lines: string[] = [];
  const lineStarts: number[] = [];
  let pos = 0;
  while (pos <= raw.length) {
    const nl = raw.indexOf("\n", pos);
    let line: string;
    let nextPos: number;
    if (nl === -1) {
      line = raw.slice(pos);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      lines.push(line);
      lineStarts.push(pos);
      break;
    } else {
      let end = nl;
      if (nl > 0 && raw[nl - 1] === "\r") {
        end = nl - 1;
      }
      line = raw.slice(pos, end);
      lines.push(line);
      lineStarts.push(pos);
      nextPos = nl + 1;
      pos = nextPos;
      if (pos > raw.length) break;
      continue;
    }
  }

  const regions: ConflictRegion[] = [];
  let inConflict = false;
  let conflictStartLine = -1;
  let conflictStartOffset = -1;
  let mineLines: string[] = [];
  let baseLines: string[] | undefined;
  let theirsLines: string[] = [];
  let stage: "mine" | "base" | "theirs" = "mine";
  let hasBaseMarker = false;
  let separatorLine = -1;
  let baseMarkerLine = -1;

  const pushError = (
    code: ConflictParseErrorCode,
    message: string,
    line: number,
    snippet: string,
  ): { regions: ConflictRegion[]; error: ConflictParseError } => {
    return { regions, error: { code, message, line, snippet } };
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (!inConflict) {
      if (isStartMarker(line)) {
        inConflict = true;
        conflictStartLine = i;
        conflictStartOffset = lineStarts[i] ?? 0;
        mineLines = [];
        baseLines = undefined;
        theirsLines = [];
        stage = "mine";
        hasBaseMarker = false;
        separatorLine = -1;
        baseMarkerLine = -1;
        if (line.length >= 7 && line.slice(0, 7) !== "<<<<<<<") {
          // 仍视为开始标记，但记录
        }
        continue;
      }
      if (isBaseMarker(line) || isSeparatorMarker(line) || isEndMarker(line)) {
        return pushError(
          "missingStart",
          "在冲突外遇到 Base/分隔/结束标记，缺少 <<<<<<< 开始标记",
          i,
          snippetOf(line),
        );
      }
      continue;
    }

    // 在冲突内
    if (isStartMarker(line)) {
      return pushError(
        "nested",
        "检测到嵌套冲突开始标记，不支持嵌套",
        i,
        snippetOf(line),
      );
    }
    if (isBaseMarker(line)) {
      if (stage !== "mine") {
        return pushError(
          "unexpectedMarker",
          "Base 标记只能出现在 Mine 段之后、分隔符之前",
          i,
          snippetOf(line),
        );
      }
      stage = "base";
      hasBaseMarker = true;
      baseMarkerLine = i;
      baseLines = [];
      continue;
    }
    if (strictSeparator(line) || isSeparatorMarker(line)) {
      if (!strictSeparator(line)) {
        // SVN/Git 要求 ======= 严格 7 个 =，带后缀视为损坏
        return pushError(
          "missingSeparator",
          "分隔标记必须为 7 个 =（=======），检测到变体",
          i,
          snippetOf(line),
        );
      }
      if (stage === "mine" || stage === "base") {
        stage = "theirs";
        separatorLine = i;
        continue;
      }
      return pushError(
        "unexpectedMarker",
        "重复或位置错误的分隔标记",
        i,
        snippetOf(line),
      );
    }
    if (isEndMarker(line)) {
      if (stage !== "theirs" || separatorLine === -1) {
        return pushError(
          "missingSeparator",
          "结束标记前缺少分隔标记 =======",
          i,
          snippetOf(line),
        );
      }
      const endLine = i;
      const endOffset =
        (lineStarts[i] ?? 0) +
        line.length +
        (i < lines.length - 1 || raw.endsWith("\n") ? 1 : 0);
      // 处理 \r\n 的偏移
      let rawEnd = endOffset;
      if (raw[rawEnd - 1] === "\n" && raw[rawEnd - 2] === "\r") {
        // 已包含
      } else if (raw.endsWith("\n") && i === lines.length - 1) {
        rawEnd = raw.length;
      }
      // 若原文本以 \r\n 结尾，需要精确
      const mineText =
        mineLines.length > 0
          ? mineLines.join("\n") + (mineLines.length > 0 ? "\n" : "")
          : "";
      // 但需还原原始行分隔：我们用 \n 拼接会丢失 \r，需按原始文本切片更准确
      // 简化：直接基于 mineLines/theirsLines 的 \n 拼接，测试侧关注内容是否保留，不强求 \r 逐字节一致？
      // 为满足 CRLF 不静默改变，按原始切片重建更可靠：
      const mineRaw = extractRawSegment(
        raw,
        lines,
        lineStarts,
        conflictStartLine + 1,
        hasBaseMarker ? baseMarkerLine : separatorLine,
      );
      const baseRaw =
        hasBaseMarker && baseLines
          ? extractRawSegment(
              raw,
              lines,
              lineStarts,
              baseMarkerLine + 1,
              separatorLine,
            )
          : undefined;
      const theirsRaw = extractRawSegment(
        raw,
        lines,
        lineStarts,
        separatorLine + 1,
        endLine,
      );
      const regionHash = hashText(
        `${mineRaw ?? mineText}\u0000${baseRaw ?? ""}\u0000${theirsRaw}`,
      );
      const identity = buildConflictRegionIdentity(
        fileIdentity as ConflictFileIdentity,
        regionHash,
      );
      regions.push({
        identity: identity as ConflictRegionIdentity,
        transientIndex: regions.length,
        start: conflictStartOffset,
        end: rawEnd,
        startLine: conflictStartLine,
        endLine,
        mine: mineRaw ?? mineText,
        base: baseRaw,
        theirs:
          theirsRaw ??
          theirsLines.join("\n") + (theirsLines.length > 0 ? "\n" : ""),
        hasBase: hasBaseMarker,
        mineLineCount: countLines(mineRaw ?? mineText),
        baseLineCount: baseRaw !== undefined ? countLines(baseRaw) : undefined,
        theirsLineCount: countLines(theirsRaw ?? ""),
      });
      inConflict = false;
      stage = "mine";
      continue;
    }
    // 普通内容行
    if (stage === "mine") mineLines.push(line);
    else if (stage === "base" && baseLines) baseLines.push(line);
    else if (stage === "theirs") theirsLines.push(line);
  }

  if (inConflict) {
    return pushError(
      "unfinished",
      "冲突未闭合，缺少 >>>>>>> 结束标记",
      conflictStartLine,
      snippetOf(lines[conflictStartLine] ?? ""),
    );
  }

  return { regions };
}

function extractRawSegment(
  raw: string,
  lines: string[],
  starts: number[],
  fromLine: number,
  toLine: number,
): string {
  if (fromLine >= toLine) return "";
  const startOff = starts[fromLine] ?? 0;
  const endOff = starts[toLine] ?? raw.length;
  const segment = raw.slice(startOff, endOff);
  // 去掉末尾多余的 \r\n 关联？segment 已包含到下一标记前，不含标记行本身
  // 但需要去掉最后的换行符重复？保持原始
  // 若 segment 以 \n 结尾且下一行为标记，则已包含换行，保留
  return segment;
}

export function buildConflictFileModel(
  input: ConflictFileInput,
): ConflictFileModel {
  const fileIdentity = buildConflictFileIdentity(
    input.repositoryRoot,
    input.relativePath,
  );
  const workingHash = hashText(input.workingText);
  const baseHash = hashText(input.baseText);
  const mineHash = hashText(input.mineText);
  const theirsHash = hashText(input.theirsText);
  const parsed = parseConflictRegions(input.workingText);
  const regions: ConflictRegion[] = (parsed.regions || []).map((r, idx) => {
    const regionHash = hashText(
      `${r.mine}\u0000${r.base ?? ""}\u0000${r.theirs}`,
    );
    const identity = buildConflictRegionIdentity(fileIdentity, regionHash);
    return { ...r, identity, transientIndex: idx };
  });
  const hasBase = regions.some((r) => r.hasBase) || input.baseText.length > 0;
  const theirsLabel = input.theirsRevision
    ? `对方修改（仓库 ${input.theirsRevision}）`
    : "对方修改（仓库）";
  return {
    fileIdentity,
    relativePath: input.relativePath,
    repositoryRoot: input.repositoryRoot,
    workingHash,
    baseHash,
    mineHash,
    theirsHash,
    regions,
    hasBase,
    display: {
      mineLabel: "我的修改（本地）",
      theirsLabel,
      baseLabel: "共同基线（BASE）",
      mergedLabel: "合并结果",
    },
    parseError: parsed.error,
    rawWorkingText: input.workingText,
  };
}

export function buildPierreUnresolvedInput(workingText: string): {
  file: { name: string; contents: string };
  error?: ConflictParseError;
} {
  const parsed = parseConflictRegions(workingText);
  if (parsed.error) {
    return { file: { name: "", contents: workingText }, error: parsed.error };
  }
  if (parsed.regions.length === 0) {
    return {
      file: { name: "", contents: workingText },
      error: {
        code: "missingStart",
        message: "未检测到冲突标记",
        line: 0,
        snippet: "",
      },
    };
  }
  return { file: { name: "", contents: workingText } };
}
