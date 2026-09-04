/*
 * V018-A 性能基准固定 fixture 生成器（v0.1.8 规划 §4.1）。
 *
 * 只增不改：不触碰现有 Diff/冲突渲染，仅新增可重复的基准内容工厂。
 * 同一 spec（含 seed）在任何机器上产生字节级一致的内容，保证可复核。
 * 普通 Diff 与冲突 fixture 分别生成，覆盖行数档位、冲突块数、语言、
 * EOL、长行与末尾换行维度。
 */

export type V018Language = "ts" | "json" | "xml" | "text";
export type V018Eol = "lf" | "crlf";

/** 普通 Diff fixture 规格。 */
export interface V018DiffSpec {
  language: V018Language;
  /** 名义行数。 */
  lines: number;
  /** 变更行比例（0~1）。 */
  changeRatio: number;
  longLines: boolean;
  eol: V018Eol;
  noTrailingNewline: boolean;
  /** 固定种子，同 spec 同输出。 */
  seed: number;
}

/** 冲突 fixture 规格。 */
export interface V018ConflictSpec {
  language: V018Language;
  /** 名义行数；块数过多时实际行数会上浮（见 actualLines）。 */
  lines: number;
  /** 冲突块数（10/100/500 档）。 */
  conflictBlocks: number;
  eol: V018Eol;
  longLines: boolean;
  /** 固定种子，同 spec 同输出。 */
  seed: number;
}

/** 基线全局固定种子（V018-A 实测与复核共用）。 */
export const V018_FIXED_SEED = 20260823;

/** 普通 Diff 行数档位：100/1000/5000/10000。 */
export const V018_DIFF_LINE_TIERS = [100, 1000, 5000, 10000] as const;
/** 冲突块数档位：10/100/500。 */
export const V018_CONFLICT_BLOCK_TIERS = [10, 100, 500] as const;
/** 冲突行数档位：1000/5000/10000。 */
export const V018_CONFLICT_LINE_TIERS = [1000, 5000, 10000] as const;
/** 语言维度：TS/JSON/XML/text。 */
export const V018_LANGUAGES: readonly V018Language[] = [
  "ts",
  "json",
  "xml",
  "text",
];

/** 线性同余伪随机（确定性，不依赖 Math.random）。 */
export function createV018Random(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** 由文本与种子派生确定性种子（FNV-1a 混合，保证跨机器一致）。 */
export function v018SeedOf(text: string, seed: number): number {
  let hash = seed >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash || 1;
}

function pad4(index: number): string {
  return String(index).padStart(4, "0");
}

/** 按语言生成单行内容（variant>0 表示变更侧）。 */
export function v018ContentLine(
  language: V018Language,
  index: number,
  variant: number,
  longLines: boolean,
): string {
  const id = pad4(index % 10000);
  let line: string;
  switch (language) {
    case "ts":
      line =
        `export function handler${id}(input: number): number { return input + ${index}; }` +
        (variant > 0 ? ` // rev${variant}` : "");
      break;
    case "json":
      line = `  "entry${id}": { "value": ${index + variant}, "enabled": ${(index + variant) % 2 === 0} },`;
      break;
    case "xml":
      line = `  <item id="${id}" value="${index + variant}">${variant > 0 ? `rev${variant}` : "base"}</item>`;
      break;
    case "text":
      line =
        `第 ${index + 1} 行：工作台处理该记录的当前状态与说明。` +
        (variant > 0 ? `（修订 ${variant}）` : "");
      break;
  }
  return longLines ? line.padEnd(300, "·") : line;
}

export interface V018DiffFixture {
  original: string;
  modified: string;
  /** 修改/插入/删除各自聚合成块后的差异块数量。 */
  hunkCount: number;
  originalBytes: number;
  modifiedBytes: number;
}

/**
 * 生成 BASE/工作副本两侧内容。变更行按 changeRatio 命中：
 * 70% 原地修改、15% 后插入、15% 删除（相互独立的小数阈值保证确定性）。
 */
export function generateV018DiffFixture(spec: V018DiffSpec): V018DiffFixture {
  const random = createV018Random(
    v018SeedOf(
      `diff-${spec.language}-${spec.lines}-${spec.changeRatio}-${spec.longLines}-${spec.eol}-${spec.noTrailingNewline}`,
      spec.seed,
    ),
  );
  const originalLines: string[] = [];
  const modifiedLines: string[] = [];
  let hunkCount = 0;
  let inHunk = false;
  for (let index = 0; index < spec.lines; index += 1) {
    const base = v018ContentLine(spec.language, index, 0, spec.longLines);
    originalLines.push(base);
    if (random() >= spec.changeRatio) {
      modifiedLines.push(base);
      inHunk = false;
      continue;
    }
    if (!inHunk) {
      hunkCount += 1;
      inHunk = true;
    }
    const action = random();
    if (action < 0.7) {
      modifiedLines.push(
        v018ContentLine(spec.language, index, 1, spec.longLines),
      );
    } else if (action < 0.85) {
      modifiedLines.push(base);
      modifiedLines.push(
        v018ContentLine(spec.language, index, 2, spec.longLines),
      );
    }
    // 其余 15%：删除该行（不进入 modified）。
  }
  const eol = spec.eol === "crlf" ? "\r\n" : "\n";
  let original = `${originalLines.join(eol)}${eol}`;
  let modified = `${modifiedLines.join(eol)}${eol}`;
  if (spec.noTrailingNewline) {
    original = original.slice(0, -eol.length);
    modified = modified.slice(0, -eol.length);
  }
  return {
    original,
    modified,
    hunkCount,
    originalBytes: Buffer.byteLength(original, "utf8"),
    modifiedBytes: Buffer.byteLength(modified, "utf8"),
  };
}

export interface V018ConflictFixture {
  /** 含标准 7 行冲突标记块的文件内容。 */
  content: string;
  /** 实际行数（块放不下时大于名义行数，如实记录不截断）。 */
  actualLines: number;
  actualBlocks: number;
  bytes: number;
}

const V018_CONFLICT_BLOCK_SIZE = 7;

/** 生成冲突某侧内容行（mine/base/theirs 各不相同且确定）。 */
function v018ConflictSideLine(
  language: V018Language,
  index: number,
  side: "mine" | "base" | "theirs",
  longLines: boolean,
): string {
  const variant = side === "mine" ? 1 : side === "theirs" ? 2 : 0;
  return v018ContentLine(language, index, variant, longLines);
}

/**
 * 生成含 conflictBlocks 个标准冲突块的文件。块均匀散布于全文，
 * 上下文行复用同语言填充行；块过多时实际行数上浮并如实返回。
 */
export function generateV018ConflictFixture(
  spec: V018ConflictSpec,
): V018ConflictFixture {
  const totalLines = Math.max(
    spec.lines,
    spec.conflictBlocks * V018_CONFLICT_BLOCK_SIZE,
  );
  // 块间距叠加 ±10% 确定性抖动：同 seed 同位置，不同 seed 可复核区分。
  const random = createV018Random(
    v018SeedOf(
      `conflict-${spec.language}-${spec.lines}-${spec.conflictBlocks}-${spec.longLines}-${spec.eol}`,
      spec.seed,
    ),
  );
  const spacing = totalLines / spec.conflictBlocks;
  const starts: number[] = [];
  for (let block = 0; block < spec.conflictBlocks; block += 1) {
    const center = Math.floor(
      (block + 0.5) * spacing + (random() - 0.5) * spacing * 0.2,
    );
    starts.push(
      Math.min(Math.max(0, center - 3), totalLines - V018_CONFLICT_BLOCK_SIZE),
    );
  }
  starts.sort((left, right) => left - right);
  // 块起始重叠时向后顺延，保证块结构不被破坏。
  for (let index = 1; index < starts.length; index += 1) {
    if (starts[index] < starts[index - 1] + V018_CONFLICT_BLOCK_SIZE) {
      starts[index] = starts[index - 1] + V018_CONFLICT_BLOCK_SIZE;
    }
  }
  const startSet = new Set(starts);
  const lines: string[] = [];
  let lineIndex = 0;
  let blockIndex = 0;
  while (lineIndex < totalLines && blockIndex < starts.length) {
    if (lineIndex === starts[blockIndex]) {
      lines.push(
        "<<<<<<< mine",
        v018ConflictSideLine(spec.language, lineIndex, "mine", spec.longLines),
        "||||||| base",
        v018ConflictSideLine(spec.language, lineIndex, "base", spec.longLines),
        "=======",
        v018ConflictSideLine(
          spec.language,
          lineIndex,
          "theirs",
          spec.longLines,
        ),
        ">>>>>>> theirs",
      );
      lineIndex += V018_CONFLICT_BLOCK_SIZE;
      blockIndex += 1;
      continue;
    }
    if (startSet.has(lineIndex)) {
      // 被顺延让出的旧槽位按普通上下文行处理。
      lines.push(v018ContentLine(spec.language, lineIndex, 0, spec.longLines));
      lineIndex += 1;
      continue;
    }
    lines.push(v018ContentLine(spec.language, lineIndex, 0, spec.longLines));
    lineIndex += 1;
  }
  while (lineIndex < totalLines) {
    lines.push(v018ContentLine(spec.language, lineIndex, 0, spec.longLines));
    lineIndex += 1;
  }
  const eol = spec.eol === "crlf" ? "\r\n" : "\n";
  const content = `${lines.join(eol)}${eol}`;
  return {
    content,
    actualLines: lines.length,
    actualBlocks: blockIndex,
    bytes: Buffer.byteLength(content, "utf8"),
  };
}

export interface V018BaselineCase {
  kind: "diff" | "conflict";
  id: string;
  nominalLines: number;
  diffSpec?: V018DiffSpec;
  conflictSpec?: V018ConflictSpec;
}

/**
 * V018-A 基线矩阵：普通 Diff（4 行档 + 语言/EOL/长行代表变体）与
 * 冲突（3 块档 × 3 行档 = 9 格）。全集固定、可重复，供采集器逐格跑数。
 */
export function buildV018BaselineMatrix(): V018BaselineCase[] {
  const cases: V018BaselineCase[] = [];
  for (const lines of V018_DIFF_LINE_TIERS) {
    cases.push({
      kind: "diff",
      id: `diff-ts-${lines}-mid`,
      nominalLines: lines,
      diffSpec: {
        language: "ts",
        lines,
        changeRatio: 0.1,
        longLines: false,
        eol: "lf",
        noTrailingNewline: false,
        seed: V018_FIXED_SEED,
      },
    });
  }
  // 语言代表变体（5000 行档）：JSON/XML/text。
  const languageVariants: Array<{ language: V018Language; lines: number }> = [
    { language: "json", lines: 5000 },
    { language: "xml", lines: 1000 },
    { language: "text", lines: 5000 },
  ];
  for (const variant of languageVariants) {
    cases.push({
      kind: "diff",
      id: `diff-${variant.language}-${variant.lines}-mid`,
      nominalLines: variant.lines,
      diffSpec: {
        language: variant.language,
        lines: variant.lines,
        changeRatio: 0.1,
        longLines: false,
        eol: "lf",
        noTrailingNewline: false,
        seed: V018_FIXED_SEED,
      },
    });
  }
  // EOL/长行/无末尾换行组合变体（与既有长行 fixture 口径对齐）。
  cases.push({
    kind: "diff",
    id: "diff-ts-5000-mid-longline-crlf-noeol",
    nominalLines: 5000,
    diffSpec: {
      language: "ts",
      lines: 5000,
      changeRatio: 0.1,
      longLines: true,
      eol: "crlf",
      noTrailingNewline: true,
      seed: V018_FIXED_SEED,
    },
  });
  for (const blocks of V018_CONFLICT_BLOCK_TIERS) {
    for (const lines of V018_CONFLICT_LINE_TIERS) {
      cases.push({
        kind: "conflict",
        id: `conflict-ts-${blocks}blocks-${lines}lines`,
        nominalLines: lines,
        conflictSpec: {
          language: "ts",
          lines,
          conflictBlocks: blocks,
          eol: "lf",
          longLines: false,
          seed: V018_FIXED_SEED,
        },
      });
    }
  }
  return cases;
}
