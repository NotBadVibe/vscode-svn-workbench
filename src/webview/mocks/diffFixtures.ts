/*
 * v0.1.0（V010-A）Diff 性能 fixture 生成器。
 *
 * 为 before/after baseline 提供确定性的 Working Copy ↔ BASE 内容：
 * 100/1000/5000/10000 行 × 小/中/大变更比例，覆盖超长行、CRLF、
 * 无末尾换行与 TypeScript/JSON/XML/text。生成结果只由 fixture ID 决定，
 * 同一 ID 在任何机器上产生字节级一致的内容，保证测量可复核。
 *
 * fixture ID 格式：<language>-<lines>-<ratio>[-longline][-crlf][-noeol]
 * 例：ts-5000-mid-longline-crlf
 */

export type DiffFixtureLanguage = "ts" | "json" | "xml" | "text";
export type DiffFixtureRatio = "small" | "mid" | "large";

export interface DiffFixtureSpec {
  language: DiffFixtureLanguage;
  lines: number;
  ratio: DiffFixtureRatio;
  longLines: boolean;
  crlf: boolean;
  noTrailingNewline: boolean;
}

const RATIO_VALUES: Record<DiffFixtureRatio, number> = {
  small: 0.01,
  mid: 0.1,
  large: 0.4,
};

const VALID_LANGUAGES = new Set<DiffFixtureLanguage>([
  "ts",
  "json",
  "xml",
  "text",
]);
const VALID_RATIOS = new Set<DiffFixtureRatio>(["small", "mid", "large"]);

/** 解析 fixture ID；非法返回 undefined（调用方回退默认 mock 内容）。 */
export function parseDiffFixtureId(id: string): DiffFixtureSpec | undefined {
  const parts = id.split("-");
  if (parts.length < 3) return undefined;
  const [language, linesText, ratio, ...flags] = parts;
  if (!VALID_LANGUAGES.has(language as DiffFixtureLanguage)) return undefined;
  const lines = Number(linesText);
  if (!Number.isInteger(lines) || lines < 1 || lines > 50000) {
    return undefined;
  }
  if (!VALID_RATIOS.has(ratio as DiffFixtureRatio)) return undefined;
  const flagSet = new Set(flags);
  for (const flag of flagSet) {
    if (flag !== "longline" && flag !== "crlf" && flag !== "noeol") {
      return undefined;
    }
  }
  return {
    language: language as DiffFixtureLanguage,
    lines,
    ratio: ratio as DiffFixtureRatio,
    longLines: flagSet.has("longline"),
    crlf: flagSet.has("crlf"),
    noTrailingNewline: flagSet.has("noeol"),
  };
}

/** 由 spec 派生确定性种子（FNV-1a），保证同一 fixture 跨机器一致。 */
function seedOf(spec: DiffFixtureSpec): number {
  const text = `${spec.language}-${spec.lines}-${spec.ratio}-${spec.longLines}-${spec.crlf}-${spec.noTrailingNewline}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash || 1;
}

/** 线性同余伪随机（确定性，不依赖 Math.random）。 */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function pad4(index: number): string {
  return String(index).padStart(4, "0");
}

function fixtureLine(
  spec: DiffFixtureSpec,
  index: number,
  variant: number,
): string {
  const id = pad4(index);
  const suffix = variant > 0 ? ` // rev${variant}` : "";
  let line: string;
  switch (spec.language) {
    case "ts":
      line = `export function handler${id}(input: number): number { return input + ${index}; }${variant > 0 ? ` // rev${variant}` : ""}`;
      break;
    case "json":
      line = `  "entry${id}": { "value": ${index + variant}, "enabled": ${(index + variant) % 2 === 0} },`;
      break;
    case "xml":
      line = `  <item id="${id}" value="${index + variant}">${variant > 0 ? `rev${variant}` : "base"}</item>`;
      break;
    case "text":
      line = `第 ${index + 1} 行：工作台处理该记录的当前状态与说明${suffix}。`;
      break;
  }
  if (spec.longLines) {
    line = line.padEnd(300, "·");
  }
  return line;
}

export interface DiffFixtureContent {
  original: string;
  modified: string;
  /** 修改后的差异块数量（修改/插入/删除各自聚合成块）。 */
  hunkCount: number;
}

/**
 * 生成 BASE/工作副本两侧内容。变更行按 ratio 命中：
 * 70% 原地修改、15% 后插入、15% 删除（相互独立的小数阈值保证确定性）。
 */
export function generateDiffFixture(spec: DiffFixtureSpec): DiffFixtureContent {
  const random = createRandom(seedOf(spec));
  const ratio = RATIO_VALUES[spec.ratio];
  const originalLines: string[] = [];
  const modifiedLines: string[] = [];
  let hunkCount = 0;
  let inHunk = false;
  const markChanged = (): void => {
    if (!inHunk) {
      hunkCount += 1;
      inHunk = true;
    }
  };
  const markClean = (): void => {
    inHunk = false;
  };

  for (let index = 0; index < spec.lines; index += 1) {
    const base = fixtureLine(spec, index, 0);
    originalLines.push(base);
    const roll = random();
    if (roll >= ratio) {
      modifiedLines.push(base);
      markClean();
      continue;
    }
    markChanged();
    const action = random();
    if (action < 0.7) {
      modifiedLines.push(fixtureLine(spec, index, 1));
    } else if (action < 0.85) {
      modifiedLines.push(base);
      modifiedLines.push(fixtureLine(spec, index, 2));
    }
    // 其余 15%：删除该行（不进入 modified）。
  }

  const eol = spec.crlf ? "\r\n" : "\n";
  let original = originalLines.join(eol) + eol;
  let modified = modifiedLines.join(eol) + eol;
  if (spec.noTrailingNewline) {
    original = original.slice(0, -eol.length);
    modified = modified.slice(0, -eol.length);
  }
  return { original, modified, hunkCount };
}
