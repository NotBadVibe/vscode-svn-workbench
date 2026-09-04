/*
 * V018-A baseline 实测脚本（v0.1.8 规划 §4.1）。
 *
 * 内容规模基线：对基线矩阵（普通 Diff 8 格 + 冲突 9 格）逐格多轮测量
 * fixture 构建耗时（cold 首轮 / warm 后续轮），输出 P50/P95（不只平均值），
 * 记录设备/OS/VS Code/Node/缩放/主题/构建模式元数据，数据落盘
 * .validation/evidence/v0.1.8/<run>/v018-baseline.json（gitignored，不污染
 * 已发布 evidence）。
 *
 * 生成算法与 tests/performance/v018PerfFixtures.ts 同种子同口径（JS 镜像，
 * 种子 V018_FIXED_SEED=20260823）；浏览器侧首屏/高亮/输入/导航 timing
 * 在 V018-B 接 Playwright 实测，本脚本不虚构。
 * 非门禁脚本：候选预算只做信息对照，一律 exit 0，不阻断、不放宽断言。
 */
const { mkdirSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

const FIXED_SEED = 20260823;
const ROUNDS = 11; // 第 1 轮记 cold，其余 10 轮记 warm
const DIFF_LINE_TIERS = [100, 1000, 5000, 10000];
const CONFLICT_BLOCK_TIERS = [10, 100, 500];
const CONFLICT_LINE_TIERS = [1000, 5000, 10000];

function createRandom(seed) {
  let state = seed >>> 0 || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function seedOf(text, seed) {
  let hash = seed >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash || 1;
}

function pad4(index) {
  return String(index).padStart(4, "0");
}

function contentLine(language, index, variant, longLines) {
  const id = pad4(index % 10000);
  let line;
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
    default:
      line =
        `第 ${index + 1} 行：工作台处理该记录的当前状态与说明。` +
        (variant > 0 ? `（修订 ${variant}）` : "");
      break;
  }
  return longLines ? line.padEnd(300, "·") : line;
}

function generateDiff(spec) {
  const random = createRandom(
    seedOf(
      `diff-${spec.language}-${spec.lines}-${spec.changeRatio}-${spec.longLines}-${spec.eol}-${spec.noTrailingNewline}`,
      spec.seed,
    ),
  );
  const originalLines = [];
  const modifiedLines = [];
  let hunkCount = 0;
  let inHunk = false;
  for (let index = 0; index < spec.lines; index += 1) {
    const base = contentLine(spec.language, index, 0, spec.longLines);
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
      modifiedLines.push(contentLine(spec.language, index, 1, spec.longLines));
    } else if (action < 0.85) {
      modifiedLines.push(base);
      modifiedLines.push(contentLine(spec.language, index, 2, spec.longLines));
    }
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
    bytes:
      Buffer.byteLength(original, "utf8") + Buffer.byteLength(modified, "utf8"),
  };
}

const CONFLICT_BLOCK_SIZE = 7;

function generateConflict(spec) {
  const totalLines = Math.max(
    spec.lines,
    spec.conflictBlocks * CONFLICT_BLOCK_SIZE,
  );
  // 块间距叠加 ±10% 确定性抖动：同 seed 同位置（与 TS 模块同口径）。
  const random = createRandom(
    seedOf(
      `conflict-${spec.language}-${spec.lines}-${spec.conflictBlocks}-${spec.longLines}-${spec.eol}`,
      spec.seed,
    ),
  );
  const spacing = totalLines / spec.conflictBlocks;
  const starts = [];
  for (let block = 0; block < spec.conflictBlocks; block += 1) {
    const center = Math.floor(
      (block + 0.5) * spacing + (random() - 0.5) * spacing * 0.2,
    );
    starts.push(
      Math.min(Math.max(0, center - 3), totalLines - CONFLICT_BLOCK_SIZE),
    );
  }
  starts.sort((left, right) => left - right);
  for (let index = 1; index < starts.length; index += 1) {
    if (starts[index] < starts[index - 1] + CONFLICT_BLOCK_SIZE) {
      starts[index] = starts[index - 1] + CONFLICT_BLOCK_SIZE;
    }
  }
  const startSet = new Set(starts);
  const lines = [];
  let lineIndex = 0;
  let blockIndex = 0;
  while (lineIndex < totalLines && blockIndex < starts.length) {
    if (lineIndex === starts[blockIndex]) {
      lines.push(
        "<<<<<<< mine",
        contentLine(spec.language, lineIndex, 1, spec.longLines),
        "||||||| base",
        contentLine(spec.language, lineIndex, 0, spec.longLines),
        "=======",
        contentLine(spec.language, lineIndex, 2, spec.longLines),
        ">>>>>>> theirs",
      );
      lineIndex += CONFLICT_BLOCK_SIZE;
      blockIndex += 1;
      continue;
    }
    lines.push(contentLine(spec.language, lineIndex, 0, spec.longLines));
    lineIndex += 1;
  }
  while (lineIndex < totalLines) {
    lines.push(contentLine(spec.language, lineIndex, 0, spec.longLines));
    lineIndex += 1;
  }
  void startSet;
  const eol = spec.eol === "crlf" ? "\r\n" : "\n";
  const content = `${lines.join(eol)}${eol}`;
  return {
    content,
    actualLines: lines.length,
    actualBlocks: blockIndex,
    bytes: Buffer.byteLength(content, "utf8"),
  };
}

function buildMatrix() {
  const cases = [];
  for (const lines of DIFF_LINE_TIERS) {
    cases.push({
      kind: "diff",
      id: `diff-ts-${lines}-mid`,
      nominalLines: lines,
      spec: {
        language: "ts",
        lines,
        changeRatio: 0.1,
        longLines: false,
        eol: "lf",
        noTrailingNewline: false,
        seed: FIXED_SEED,
      },
    });
  }
  for (const variant of [
    { language: "json", lines: 5000 },
    { language: "xml", lines: 1000 },
    { language: "text", lines: 5000 },
  ]) {
    cases.push({
      kind: "diff",
      id: `diff-${variant.language}-${variant.lines}-mid`,
      nominalLines: variant.lines,
      spec: {
        language: variant.language,
        lines: variant.lines,
        changeRatio: 0.1,
        longLines: false,
        eol: "lf",
        noTrailingNewline: false,
        seed: FIXED_SEED,
      },
    });
  }
  cases.push({
    kind: "diff",
    id: "diff-ts-5000-mid-longline-crlf-noeol",
    nominalLines: 5000,
    spec: {
      language: "ts",
      lines: 5000,
      changeRatio: 0.1,
      longLines: true,
      eol: "crlf",
      noTrailingNewline: true,
      seed: FIXED_SEED,
    },
  });
  for (const blocks of CONFLICT_BLOCK_TIERS) {
    for (const lines of CONFLICT_LINE_TIERS) {
      cases.push({
        kind: "conflict",
        id: `conflict-ts-${blocks}blocks-${lines}lines`,
        nominalLines: lines,
        nominalBlocks: blocks,
        spec: {
          language: "ts",
          lines,
          conflictBlocks: blocks,
          eol: "lf",
          longLines: false,
          seed: FIXED_SEED,
        },
      });
    }
  }
  return cases;
}

function percentile(values, ratio) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[
    Math.min(
      sorted.length - 1,
      Math.max(0, Math.ceil(sorted.length * ratio) - 1),
    )
  ];
}

function summarize(samples) {
  const rounded = samples.map((value) => Math.round(value * 100) / 100);
  return {
    runs: rounded.length,
    p50: Math.round(percentile(rounded, 0.5) * 100) / 100,
    p95: Math.round(percentile(rounded, 0.95) * 100) / 100,
    min: Math.min(...rounded),
    max: Math.max(...rounded),
  };
}

function collectMetadata(environment) {
  const cpus = os.cpus();
  return {
    // 稳定性说明：堆/RSS 记为趋势观察，不进自动门禁。
    device:
      environment.V018_DEVICE ??
      `${cpus[0]?.model ?? "unknown"} / ${Math.round(os.totalmem() / 1024 ** 3)}GB`,
    os: environment.V018_OS ?? `${os.platform()} ${os.release()} ${os.arch()}`,
    vscodeVersion: environment.V018_VSCODE ?? "unknown",
    nodeVersion: process.version,
    zoom: environment.V018_ZOOM ?? "unknown",
    theme: environment.V018_THEME ?? "unknown",
    buildMode: environment.V018_BUILD_MODE ?? "unknown",
    measuredAt: new Date().toISOString(),
  };
}

async function main() {
  const environment = process.env;
  const metadata = collectMetadata(environment);
  const memoryBefore = process.memoryUsage();
  const matrix = buildMatrix();
  const results = [];
  for (const item of matrix) {
    const build = item.kind === "diff" ? generateDiff : generateConflict;
    // 预热一次，排除首轮模块/字符串驻留抖动之外的系统性冷启动由第 1 轮承担。
    build(item.spec);
    const samples = [];
    let blocks = 0;
    let bytes = 0;
    let actualLines = item.nominalLines;
    for (let round = 0; round < ROUNDS; round += 1) {
      const started = performance.now();
      const fixture = build(item.spec);
      samples.push(performance.now() - started);
      if (item.kind === "diff") {
        blocks = fixture.hunkCount;
        bytes = fixture.bytes;
      } else {
        blocks = fixture.actualBlocks;
        bytes = fixture.bytes;
        actualLines = fixture.actualLines;
      }
    }
    results.push({
      kind: item.kind,
      id: item.id,
      nominalLines: item.nominalLines,
      nominalBlocks: item.nominalBlocks ?? null,
      actualLines,
      blocks,
      bytes,
      // 第 1 轮记 cold（稳定门禁外，仅供对照），其余记 warm。
      coldMs: summarize(samples.slice(0, 1)),
      warmMs: summarize(samples.slice(1)),
    });
  }
  const memoryAfter = process.memoryUsage();
  const result = {
    tool: "measure-v018-baseline",
    seed: FIXED_SEED,
    rounds: ROUNDS,
    metadata,
    // 内存为趋势观察指标（易抖），不进自动门禁。
    memoryTrend: {
      heapUsedBeforeBytes: memoryBefore.heapUsed,
      heapUsedAfterBytes: memoryAfter.heapUsed,
      rssBeforeBytes: memoryBefore.rss,
      rssAfterBytes: memoryAfter.rss,
      stability: "趋势观察：易抖（GC/调度/设备），只记趋势，不直接阻断。",
    },
    results,
    budgets: {
      note: "候选预算（规划 §3）仅信息对照；V018-A 为 baseline，不设阻断门禁。",
    },
    passed: true,
  };

  const runId =
    environment.SVN_WORKBENCH_EVIDENCE_RUN ??
    `${new Date().toISOString().replace(/[:.]/g, "-")}-${Math.random().toString(16).slice(2, 10)}`;
  const artifactDirectory =
    environment.SVN_WORKBENCH_EVIDENCE_DIR != null
      ? path.resolve(environment.SVN_WORKBENCH_EVIDENCE_DIR)
      : path.join(root, ".validation", "evidence", "v0.1.8", runId);
  mkdirSync(artifactDirectory, { recursive: true });
  writeFileSync(
    path.join(artifactDirectory, "v018-baseline.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    "utf8",
  );

  const lines = [];
  lines.push("# V018-A baseline（内容规模，fixture 构建耗时 ms）");
  lines.push("");
  lines.push(`- seed=${FIXED_SEED} rounds=${ROUNDS}（首轮 cold，其余 warm）`);
  lines.push(
    `- 设备：${metadata.device}｜OS：${metadata.os}｜Node：${metadata.nodeVersion}｜VS Code：${metadata.vscodeVersion}｜缩放：${metadata.zoom}｜主题：${metadata.theme}｜构建：${metadata.buildMode}`,
  );
  lines.push("");
  lines.push("## 普通 Diff");
  lines.push("");
  lines.push("| fixture | 行数 | 块数 | 字节 | cold | warm P50 | warm P95 |");
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const item of results.filter((entry) => entry.kind === "diff")) {
    lines.push(
      `| ${item.id} | ${item.actualLines} | ${item.blocks} | ${item.bytes} | ${item.coldMs.p50} | ${item.warmMs.p50} | ${item.warmMs.p95} |`,
    );
  }
  lines.push("");
  lines.push("## 冲突");
  lines.push("");
  lines.push(
    "| fixture | 名义行/块 | 实际行/块 | 字节 | cold | warm P50 | warm P95 |",
  );
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const item of results.filter((entry) => entry.kind === "conflict")) {
    lines.push(
      `| ${item.id} | ${item.nominalLines}/${item.nominalBlocks} | ${item.actualLines}/${item.blocks} | ${item.bytes} | ${item.coldMs.p50} | ${item.warmMs.p50} | ${item.warmMs.p95} |`,
    );
  }
  lines.push("");
  lines.push(
    `内存趋势（观察）：heap ${Math.round(memoryBefore.heapUsed / 1024)}KB → ${Math.round(memoryAfter.heapUsed / 1024)}KB，RSS ${Math.round(memoryBefore.rss / 1024)}KB → ${Math.round(memoryAfter.rss / 1024)}KB`,
  );
  lines.push(`证据：${artifactDirectory}/v018-baseline.json`);
  process.stdout.write(`${lines.join("\n")}\n`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
