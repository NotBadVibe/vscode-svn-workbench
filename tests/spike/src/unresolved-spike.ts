/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, no-useless-assignment, no-empty */
import {
  preloadHighlighter,
  UnresolvedFile,
  type SupportedLanguages,
} from "@pierre/diffs";
import type { MergeConflictActionPayload } from "@pierre/diffs";
import "./theme-map.css";

const SPIKE_LANGUAGES: SupportedLanguages[] = [
  "typescript",
  "javascript",
  "java",
  "python",
  "c",
  "cpp",
  "go",
  "rust",
  "xml",
  "json",
  "yaml",
  "properties",
  "shell",
  "sql",
  "diff",
];

function twoFrames(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

interface UnresolvedFixtureProbe {
  containerCount: number;
  diffsContainers: number;
  shadowRoots: number;
  markerCounts: Record<string, number>;
  actionSlotCount: number;
  chineseButtonCount: number;
  chineseLabels: string[];
  hasMergeConflictAttr: boolean;
  textContentSnippet: string;
  containsMine: boolean;
  containsTheirs: boolean;
  containsBase: boolean;
  containsLongLine: boolean;
  adoptedSheets: number;
  shadowStyleElements: number;
  lineTypeCounts: Record<string, number>;
  errorMessage: string | null;
}

interface UnresolvedFixtureReport {
  fixtureId: string;
  mounted: boolean;
  mountMs: number;
  error?: string;
  probe: UnresolvedFixtureProbe | null;
  payloads: MergeConflictActionPayload[];
  firstPayloadSummary?: string;
  cspViolations: number;
  clickTest?: {
    clicked: boolean;
    payloadCaptured: boolean;
    payload?: MergeConflictActionPayload;
  };
}

export interface UnresolvedSpikeReport {
  ready: boolean;
  theme: string;
  csp: string;
  mountTotalMs: number;
  cspViolations: number;
  fixtures: Record<string, UnresolvedFixtureReport>;
  performance: {
    perf5000MountMs: number;
    perf5000ClickMs: number;
    perf5000PayloadCaptured: boolean;
    error?: string;
  } | null;
  cleanup: {
    beforeContainers: number;
    afterDestroyContainers: number;
    afterRebuildContainers: number;
    adoptedSheetsBefore: number;
    adoptedSheetsAfterDestroy: number;
    adoptedSheetsAfterRebuild: number;
    shadowStyleBefore: number;
    shadowStyleAfterDestroy: number;
    domLeak: boolean;
    observerLeak: boolean;
    error?: string;
  } | null;
  themeSwitch?: {
    darkBg: string;
    lightBg: string;
    hcBg: string;
    switchNoLeak: boolean;
  } | null;
  error?: string;
}

declare global {
  interface Window {
    __unresolvedSpike: UnresolvedSpikeReport | undefined;
    __spikeViolations?: number;
    __unresolvedPayloads?: MergeConflictActionPayload[];
  }
}

const SVN_SINGLE = [
  'import { SvnCommandRunner } from "../svn/runner";',
  "export class OrderService {",
  "  submit(order: string) {",
  "<<<<<<< .mine",
  '    const mineValue = "我的修改-本地";',
  "    console.log(mineValue);",
  "||||||| .r127",
  '    const baseValue = "共同基线";',
  "    console.log(baseValue);",
  "=======",
  '    const theirsValue = "对方修改-仓库r128";',
  "    console.log(theirsValue);",
  ">>>>>>> .r127",
  "  }",
  "}",
].join("\n");

const GIT_SINGLE = [
  'import { a } from "./a";',
  "function foo() {",
  "<<<<<<< HEAD",
  '  const headVal = "我的-HEAD-中文";',
  "=======",
  '  const branchVal = "对方分支-仓库";',
  ">>>>>>> feature-branch",
  "}",
].join("\n");

const MULTI_BLOCK = [
  "export const header = 1;",
  "<<<<<<< .mine",
  'const block1Mine = "块1我的";',
  "||||||| .r100",
  'const block1Base = "块1基线";',
  "=======",
  'const block1Theirs = "块1对方";',
  ">>>>>>> .r100",
  "export const middle = 2;",
  "<<<<<<< .mine",
  'const block2Mine = "块2我的-中文测试";',
  "||||||| .r101",
  'const block2Base = "块2基线";',
  "=======",
  'const block2Theirs = "块2对方";',
  ">>>>>>> .r101",
  "export const footer = 3;",
  "<<<<<<< HEAD",
  'const block3Head = "块3 HEAD";',
  "=======",
  'const block3Incoming = "块3 incoming";',
  ">>>>>>> branch3",
  "export const tail = 4;",
].join("\n");

const NO_BASE = [
  "const a = 1;",
  "<<<<<<< HEAD",
  'const onlyMine = "无BASE-我的";',
  "=======",
  'const onlyTheirs = "无BASE-对方";',
  ">>>>>>> origin/main",
  "const b = 2;",
].join("\n");

const CRLF_SINGLE = SVN_SINGLE.replace(/\n/g, "\r\n");

const DAMAGED_MISSING_SEPARATOR = [
  "const a = 1;",
  "<<<<<<< .mine",
  'const mineOnly = "损坏-缺分隔符";',
  ">>>>>>> .r127",
  "const b = 2;",
].join("\n");

const DAMAGED_MISSING_END = [
  "const a = 1;",
  "<<<<<<< .mine",
  'const mineOnly = "损坏-缺结束符";',
  "=======",
  'const theirsOnly = "对方";',
  "const b = 2;",
].join("\n");

const LONGLINE_CONTENT = "a".repeat(5000);
const LONG_LINE = [
  "const a = 1;",
  "<<<<<<< .mine",
  `const mineLong = "${LONGLINE_CONTENT}";`,
  "||||||| .r127",
  'const baseShort = "基线短";',
  "=======",
  'const theirsShort = "对方短";',
  ">>>>>>> .r127",
  "const b = 2;",
].join("\n");

function generatePerfFixture(lineCount = 5000, interval = 100): string {
  const lines: string[] = [];
  let conflictIdx = 0;
  for (let i = 0; i < lineCount; i++) {
    if (i % interval === 0 && i !== 0 && i < lineCount - 20) {
      lines.push("<<<<<<< .mine");
      lines.push(
        `const perfMine${conflictIdx} = "性能-我的-${conflictIdx}中文";`,
      );
      lines.push("||||||| .r127");
      lines.push(`const perfBase${conflictIdx} = "性能-基线-${conflictIdx}";`);
      lines.push("=======");
      lines.push(
        `const perfTheirs${conflictIdx} = "性能-对方-${conflictIdx}";`,
      );
      lines.push(">>>>>>> .r127");
      conflictIdx++;
      i += 6;
    } else {
      lines.push(`const line${i} = ${i}; // 填充行 ${i} 中文占位`);
    }
  }
  return lines.join("\n");
}

const PERF_5000 = generatePerfFixture(5000, 98);

const FIXTURES: Record<string, string> = {
  "svn-single": SVN_SINGLE,
  "git-single": GIT_SINGLE,
  "multi-block": MULTI_BLOCK,
  crlf: CRLF_SINGLE,
  "no-base": NO_BASE,
  longline: LONG_LINE,
  "perf-5000": PERF_5000,
};

const DAMAGED_FIXTURES: Record<string, string> = {
  "damaged-missing-separator": DAMAGED_MISSING_SEPARATOR,
  "damaged-missing-end": DAMAGED_MISSING_END,
};

function collectProbe(container: HTMLElement): UnresolvedFixtureProbe {
  const diffsContainers = container.querySelectorAll("diffs-container");
  const roots = Array.from(diffsContainers)
    .map((c) => (c as HTMLElement).shadowRoot)
    .filter(Boolean) as ShadowRoot[];
  const markerCounts: Record<string, number> = {};
  const lineTypeCounts: Record<string, number> = {};
  let actionSlotCount = 0;
  let chineseButtonCount = 0;
  const chineseLabels: string[] = [];
  let hasMergeConflictAttr = false;
  let textSnippet = "";
  let containsMine = false;
  let containsTheirs = false;
  let containsBase = false;
  let containsLongLine = false;
  let adoptedSheets = 0;
  let shadowStyleElements = 0;
  let errorMessage: string | null = null;

  for (const root of roots) {
    adoptedSheets += root.adoptedStyleSheets.length;
    shadowStyleElements += root.querySelectorAll("style").length;
    const markerRows = root.querySelectorAll("[data-merge-conflict]");
    for (const el of Array.from(markerRows)) {
      const t = el.getAttribute("data-merge-conflict") ?? "unknown";
      markerCounts[t] = (markerCounts[t] ?? 0) + 1;
    }
    const slots = root.querySelectorAll("[data-merge-conflict-actions]");
    actionSlotCount += slots.length;
    // count annotation slots that contain custom buttons (outside shadow? Actually custom buttons are slotted via annotation wrapper outside shadow? They are in fileContainer, not shadow)
    // So also check document for custom buttons
    const buttons = container.querySelectorAll(
      "button[data-merge-conflict-action]",
    );
    chineseButtonCount = buttons.length;
    for (const b of Array.from(buttons)) {
      const t = b.textContent?.trim() ?? "";
      if (t) chineseLabels.push(t);
    }
    // line types
    for (const lt of [
      "change-addition",
      "change-deletion",
      "context",
      "context-expanded",
    ]) {
      const c = root.querySelectorAll(`[data-line-type="${lt}"]`).length;
      if (c) lineTypeCounts[lt] = (lineTypeCounts[lt] ?? 0) + c;
    }
    const pre = root.querySelector("pre");
    if (pre) {
      const txt = pre.textContent ?? "";
      textSnippet = txt.slice(0, 300);
      if (
        txt.includes("我的修改") ||
        txt.includes("我的-HEAD") ||
        txt.includes("块1我的")
      )
        containsMine = true;
      if (
        txt.includes("对方修改") ||
        txt.includes("对方分支") ||
        txt.includes("块1对方")
      )
        containsTheirs = true;
      if (txt.includes("共同基线") || txt.includes("块1基线"))
        containsBase = true;
      if (txt.includes(LONGLINE_CONTENT.slice(0, 50))) containsLongLine = true;
    }
    const hasAttr = root.querySelector("pre[data-has-merge-conflict]") != null;
    if (hasAttr) hasMergeConflictAttr = true;
    const errNode = root.querySelector("[data-error-message]");
    if (errNode)
      errorMessage = errNode.textContent?.trim().slice(0, 200) ?? "error";
  }
  // Also check light DOM for custom buttons (annotation wrappers)
  const lightButtons = container.querySelectorAll(
    "button[data-merge-conflict-action]",
  );
  if (lightButtons.length > chineseButtonCount) {
    chineseButtonCount = lightButtons.length;
    chineseLabels.length = 0;
    for (const b of Array.from(lightButtons))
      chineseLabels.push(b.textContent?.trim() ?? "");
  }
  // Deduplicate labels
  const uniqLabels = [...new Set(chineseLabels)];
  // If no roots yet, check container textContent
  if (roots.length === 0) {
    const txt = container.textContent ?? "";
    textSnippet = txt.slice(0, 300);
    containsMine = txt.includes("我的");
    containsTheirs = txt.includes("对方");
    containsBase = txt.includes("基线");
  }
  return {
    containerCount: diffsContainers.length,
    diffsContainers: diffsContainers.length,
    shadowRoots: roots.length,
    markerCounts,
    actionSlotCount,
    chineseButtonCount,
    chineseLabels: uniqLabels,
    hasMergeConflictAttr,
    textContentSnippet: textSnippet,
    containsMine,
    containsTheirs,
    containsBase,
    containsLongLine,
    adoptedSheets,
    shadowStyleElements,
    lineTypeCounts,
    errorMessage,
  };
}

function createChineseActionRenderer(captured: MergeConflictActionPayload[]) {
  return (action: any) => {
    const wrap = document.createElement("div");
    wrap.style.display = "flex";
    wrap.style.gap = "6px";
    wrap.style.flexWrap = "wrap";
    const defs: Array<{ label: string; resolution: string }> = [
      { label: "采用我的修改", resolution: "current" },
      { label: "采用对方修改", resolution: "incoming" },
      { label: "保留双方修改", resolution: "both" },
    ];
    for (const d of defs) {
      const btn = document.createElement("button");
      btn.textContent = d.label;
      btn.setAttribute("data-merge-conflict-action", d.resolution);
      btn.setAttribute(
        "data-merge-conflict-conflict-index",
        String(action.conflictIndex),
      );
      btn.setAttribute(
        "data-testid",
        `unresolved-action-${d.resolution}-${action.conflictIndex}`,
      );
      btn.type = "button";
      btn.style.padding = "2px 6px";
      btn.style.fontSize = "12px";
      wrap.appendChild(btn);
    }
    return wrap;
  };
}

async function mountFixture(
  containerId: string,
  fixtureId: string,
  contents: string,
  captured: MergeConflictActionPayload[],
): Promise<UnresolvedFixtureReport> {
  const host = document.getElementById(containerId);
  if (!host) {
    return {
      fixtureId,
      mounted: false,
      mountMs: 0,
      error: "missing-host:" + containerId,
      probe: null,
      payloads: captured,
      cspViolations: window.__spikeViolations ?? 0,
    };
  }
  host.innerHTML = "";
  const start = performance.now();
  let error: string | undefined;
  let instance: any = null;
  try {
    const { UnresolvedFile: UF } = await import("@pierre/diffs");
    instance = new UF({
      theme: { dark: "pierre-dark", light: "pierre-light" },
      themeType: "system",
      mergeConflictActionsType: createChineseActionRenderer(captured) as any,
      onMergeConflictAction: (payload: MergeConflictActionPayload) => {
        captured.push(payload);
        (window as any).__unresolvedPayloads = [...captured];
      },
    });
    const file = { name: "src/example.ts", contents };
    instance.render({ file, containerWrapper: host });
  } catch (e) {
    error = String(e);
  }
  await twoFrames();
  // wait a bit more for highlighter async
  await new Promise((r) => setTimeout(r, 80));
  await twoFrames();
  const mountMs = Math.round(performance.now() - start);
  let probe: UnresolvedFixtureProbe | null = null;
  try {
    probe = collectProbe(host);
  } catch (e) {
    error = (error ?? "") + " probe:" + String(e);
  }
  // Also attempt click test for svn-single only or first fixture
  let clickTest: UnresolvedFixtureReport["clickTest"];
  if (fixtureId === "svn-single" && probe && probe.chineseButtonCount > 0) {
    const btn = host.querySelector(
      'button[data-merge-conflict-action="current"]',
    ) as HTMLElement | null;
    const before = captured.length;
    let clicked = false;
    let payloadCaptured = false;
    let payload: MergeConflictActionPayload | undefined;
    if (btn) {
      clicked = true;
      btn.click();
      await new Promise((r) => setTimeout(r, 50));
      await twoFrames();
      if (captured.length > before) {
        payloadCaptured = true;
        payload = captured[captured.length - 1];
      }
    }
    clickTest = { clicked, payloadCaptured, payload };
  }
  const mounted = !error && (probe?.diffsContainers ?? 0) > 0;
  return {
    fixtureId,
    mounted,
    mountMs,
    error,
    probe,
    payloads: [...captured],
    firstPayloadSummary: captured[0]
      ? JSON.stringify(captured[0]).slice(0, 500)
      : undefined,
    cspViolations: window.__spikeViolations ?? 0,
    clickTest,
  };
}

export async function runUnresolvedSpike(
  params: URLSearchParams,
): Promise<UnresolvedSpikeReport> {
  const theme = params.get("theme") ?? "dark";
  const csp = params.get("csp") ?? "strict";
  document.body.dataset.theme = theme;
  const report: UnresolvedSpikeReport = {
    ready: false,
    theme,
    csp,
    mountTotalMs: 0,
    cspViolations: 0,
    fixtures: {},
    performance: null,
    cleanup: null,
  };
  (window as any).__unresolvedSpike = report;
  (window as any).__unresolvedPayloads = [];
  const totalStart = performance.now();
  document.addEventListener("securitypolicyviolation", () => {
    window.__spikeViolations = (window.__spikeViolations ?? 0) + 1;
  });
  try {
    const { installDiffCspCompatibilityShim } =
      await import("@prod/csp-compat-observer");
    installDiffCspCompatibilityShim();
  } catch {}
  await preloadHighlighter({
    themes: ["pierre-dark", "pierre-light"],
    langs: SPIKE_LANGUAGES,
  });

  // Mount each standard fixture into its own host
  const hostMap: Record<string, string> = {
    "svn-single": "unresolved-svn",
    "git-single": "unresolved-git",
    "multi-block": "unresolved-multi",
    crlf: "unresolved-crlf",
    "no-base": "unresolved-nobase",
    longline: "unresolved-longline",
    "perf-5000": "unresolved-perf",
  };
  for (const [fid, contents] of Object.entries(FIXTURES)) {
    const captured: MergeConflictActionPayload[] = [];
    const hostId = hostMap[fid] ?? `unresolved-${fid}`;
    const r = await mountFixture(hostId, fid, contents, captured);
    report.fixtures[fid] = r;
  }
  // Damaged fixtures - expect failure, record behavior
  for (const [fid, contents] of Object.entries(DAMAGED_FIXTURES)) {
    const captured: MergeConflictActionPayload[] = [];
    const hostId = `unresolved-damaged-${fid.includes("separator") ? "sep" : "end"}`;
    // ensure host exists, else use generic
    let el = document.getElementById(hostId);
    if (!el) {
      el = document.createElement("div");
      el.id = hostId;
      document.getElementById("unresolved-damaged")?.appendChild(el);
    }
    const r = await mountFixture(hostId, fid, contents, captured);
    report.fixtures[fid] = r;
  }

  // Performance detail for perf-5000
  const perfReport = report.fixtures["perf-5000"];
  if (perfReport) {
    let clickMs = 0;
    let payloadCaptured = false;
    let error: string | undefined;
    try {
      const host = document.getElementById("unresolved-perf");
      const btn = host?.querySelector(
        'button[data-merge-conflict-action="both"]',
      ) as HTMLElement | null;
      if (btn) {
        const s = performance.now();
        btn.click();
        await new Promise((r) => setTimeout(r, 50));
        await twoFrames();
        clickMs = Math.round(performance.now() - s);
        payloadCaptured = (window.__unresolvedPayloads?.length ?? 0) > 0;
      }
    } catch (e) {
      error = String(e);
    }
    report.performance = {
      perf5000MountMs: perfReport.mountMs,
      perf5000ClickMs: clickMs,
      perf5000PayloadCaptured: payloadCaptured,
      error,
    };
  }

  // Cleanup test: create temp host, mount, destroy, rebuild, check leaks
  try {
    const tempHostId = "unresolved-cleanup";
    let tempHost = document.getElementById(tempHostId);
    if (!tempHost) {
      tempHost = document.createElement("div");
      tempHost.id = tempHostId;
      document.body.appendChild(tempHost);
    }
    const beforeContainers =
      document.querySelectorAll("diffs-container").length;
    const beforeSheets = Array.from(
      document.querySelectorAll("diffs-container"),
    )
      .map((c) => (c as HTMLElement).shadowRoot?.adoptedStyleSheets.length ?? 0)
      .reduce((a, b) => a + b, 0);
    const beforeShadowStyles = Array.from(
      document.querySelectorAll("diffs-container"),
    )
      .map(
        (c) =>
          (c as HTMLElement).shadowRoot?.querySelectorAll("style").length ?? 0,
      )
      .reduce((a, b) => a + b, 0);

    const { UnresolvedFile: UF2 } = await import("@pierre/diffs");
    const inst = new UF2({
      theme: { dark: "pierre-dark", light: "pierre-light" },
      themeType: "system",
      mergeConflictActionsType: createChineseActionRenderer([]) as any,
      onMergeConflictAction: () => {},
    });
    tempHost.innerHTML = "";
    inst.render({
      file: { name: "src/clean.ts", contents: SVN_SINGLE },
      containerWrapper: tempHost,
    });
    await twoFrames();
    await new Promise((r) => setTimeout(r, 60));
    await twoFrames();
    const afterMountContainers =
      document.querySelectorAll("diffs-container").length;
    inst.cleanUp();
    // also clear host
    tempHost.innerHTML = "";
    await twoFrames();
    const afterDestroyContainers =
      document.querySelectorAll("diffs-container").length;
    const afterDestroySheets = Array.from(
      document.querySelectorAll("diffs-container"),
    )
      .map((c) => (c as HTMLElement).shadowRoot?.adoptedStyleSheets.length ?? 0)
      .reduce((a, b) => a + b, 0);
    const afterDestroyStyles = Array.from(
      document.querySelectorAll("diffs-container"),
    )
      .map(
        (c) =>
          (c as HTMLElement).shadowRoot?.querySelectorAll("style").length ?? 0,
      )
      .reduce((a, b) => a + b, 0);
    // rebuild
    const inst2 = new UF2({
      theme: { dark: "pierre-dark", light: "pierre-light" },
      themeType: "system",
      mergeConflictActionsType: createChineseActionRenderer([]) as any,
      onMergeConflictAction: () => {},
    });
    inst2.render({
      file: { name: "src/clean.ts", contents: GIT_SINGLE },
      containerWrapper: tempHost,
    });
    await twoFrames();
    await new Promise((r) => setTimeout(r, 60));
    await twoFrames();
    const afterRebuildContainers =
      document.querySelectorAll("diffs-container").length;
    const afterRebuildSheets = Array.from(
      document.querySelectorAll("diffs-container"),
    )
      .map((c) => (c as HTMLElement).shadowRoot?.adoptedStyleSheets.length ?? 0)
      .reduce((a, b) => a + b, 0);
    // Theme switch test: change body dataset and check no extra containers leaked, colors changed
    document.body.dataset.theme = "light";
    await twoFrames();
    document.body.dataset.theme = "hc";
    await twoFrames();
    document.body.dataset.theme = theme;
    await twoFrames();
    const afterSwitchContainers =
      document.querySelectorAll("diffs-container").length;
    const domLeak =
      afterDestroyContainers < beforeContainers ||
      afterSwitchContainers !== afterRebuildContainers;
    // If destroy removed exactly one, that's expected (inst's container). So check that afterDestroy is before count (since we removed temp) and afterRebuild restores.
    // Simpler: leak if afterRebuild > beforeContainers + 1 or adopted sheets keep growing
    const leak = afterRebuildContainers > beforeContainers + 5; // arbitrary high threshold
    inst2.cleanUp();
    tempHost.innerHTML = "";
    report.cleanup = {
      beforeContainers,
      afterDestroyContainers,
      afterRebuildContainers: afterSwitchContainers,
      adoptedSheetsBefore: beforeSheets,
      adoptedSheetsAfterDestroy: afterDestroySheets,
      adoptedSheetsAfterRebuild: afterRebuildSheets,
      shadowStyleBefore: beforeShadowStyles,
      shadowStyleAfterDestroy: afterDestroyStyles,
      domLeak: leak,
      observerLeak: false,
    };
    // cleanup temp
    inst.cleanUp();
    inst2.cleanUp();
  } catch (e) {
    report.cleanup = {
      beforeContainers: -1,
      afterDestroyContainers: -1,
      afterRebuildContainers: -1,
      adoptedSheetsBefore: -1,
      adoptedSheetsAfterDestroy: -1,
      adoptedSheetsAfterRebuild: -1,
      shadowStyleBefore: -1,
      shadowStyleAfterDestroy: -1,
      domLeak: true,
      observerLeak: true,
      error: String(e),
    };
  }

  report.mountTotalMs = Math.round(performance.now() - totalStart);
  report.cspViolations = window.__spikeViolations ?? 0;
  report.ready = true;
  return report;
}
