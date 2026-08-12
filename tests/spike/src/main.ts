import {
  FileDiff,
  parsePatchFiles,
  preloadHighlighter,
  type SupportedLanguages,
} from "@pierre/diffs";
import { MergeView } from "@codemirror/merge";
import type { EditSpikeReport } from "./edit-spike";
import "./theme-map.css";

/*
 * Spike：在复制生产 CSP 的环境下挂载 @pierre/diffs，验证：
 * 1. 样式注入通道是否在严格 CSP（style-src 无 'unsafe-inline'）下存活；
 * 2. VS Code 变量 → --diffs-* 映射在三主题下的表现；
 * 3. CodeMirror MergeView 在同等 CSP 下的对照表现。
 * 探测结果挂到 window.__spike 供 Playwright 断言。
 */

// v0.0.4 规划建议的语言子集（§10 待决策项）
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

interface CspViolationRecord {
  blockedURI: string;
  effectiveDirective: string;
  disposition: string;
  sample: string;
}

/*
 * CSP 兼容垫片（?shim=1 时启用）：在不放松 style-src 的前提下恢复被拦截的两处注入。
 * 前提证据（见 ?selftest=1 自测用例）：Chromium 在 style-src 无 'unsafe-inline' 时
 * 只拦截“HTML 解析期的 style 属性”与 setAttribute("style", …)，不拦截
 * CSSStyleDeclaration 的 cssText 赋值与逐条 setProperty——因此 createSpanNodeFromToken
 * 的 `element.style = …` 写法天然存活，垫片只需处理下面两条通道。
 *
 * 1. token 着色主通道：DiffHunksRenderer 用 hast-util-to-html 序列化后经
 *    `columns.content.innerHTML = …` 注入（FileDiff.js:1160 等），span 上的
 *    style="…" 属性在解析期被 style-src-attr 拦截。垫片包装 innerHTML setter：
 *    写入前把 style="…" 改写为 data-hl-style="…"，写入后逐元素 setProperty
 *    落地颜色并移除暂存属性，全程不触发 CSP。
 * 2. 主题 `:host` 变量：FileDiff.js 经 hostTheme.js 向 shadowRoot 插入
 *    内联 `<style data-theme-css>`（被 style-src-elem 拦截）。垫片包装
 *    ShadowRoot.prototype.appendChild，把该节点内容改写为 Constructable
 *    Stylesheet（adoptedStyleSheets 不受 style-src 限制）。
 * 注意：库内部仍持有被拦截节点的引用并通过 textContent 更新（滚动条测量），
 * 垫片用 MutationObserver 把后续文本变化同步到 sheet（断连节点也可观察）。
 */
function installCspCompatibilityShim(): void {
  /*
   * 逐条 setProperty 应用 "prop:value;…" 声明串（CSP 安全通道）。
   */
  const applyDeclarations = (
    target: CSSStyleDeclaration,
    value: string,
  ): void => {
    for (const declaration of value.split(";")) {
      const colon = declaration.indexOf(":");
      if (colon <= 0) continue;
      const property = declaration.slice(0, colon).trim();
      const propertyValue = declaration.slice(colon + 1).trim();
      if (property !== "") target.setProperty(property, propertyValue);
    }
  };

  /*
   * token 着色的主要通道：DiffHunksRenderer 用 hast-util-to-html 序列化后经
   * `columns.content.innerHTML = …` 注入（FileDiff.js:1160 等），span 上的
   * style="…" 属性在解析期即被 style-src-attr 拦截（属性保留但不应用）。
   * 垫片包装 innerHTML setter：写入前把 style="…" 改写为 data-hl-style="…"，
   * 写入后逐元素用 setProperty 落地颜色并移除暂存属性，全程不触发 CSP。
   */
  const launderStyledNodes = (root: ParentNode): void => {
    for (const node of Array.from(root.querySelectorAll("[data-hl-style]"))) {
      applyDeclarations(
        (node as HTMLElement).style,
        node.getAttribute("data-hl-style") ?? "",
      );
      node.removeAttribute("data-hl-style");
    }
  };
  const innerHTMLDescriptor = Object.getOwnPropertyDescriptor(
    Element.prototype,
    "innerHTML",
  );
  if (innerHTMLDescriptor?.set != null && innerHTMLDescriptor.get != null) {
    const originalSetter = innerHTMLDescriptor.set;
    const originalGetter = innerHTMLDescriptor.get;
    Object.defineProperty(Element.prototype, "innerHTML", {
      configurable: true,
      get: originalGetter,
      set(this: Element, value: string) {
        const rewritten =
          value.includes('style="') || value.includes("style='")
            ? value.replace(/style=(["'])([^"']*)\1/gi, 'data-hl-style="$2"')
            : value;
        originalSetter.call(this, rewritten);
        if (rewritten !== value) launderStyledNodes(this);
      },
    });
  }

  /*
   * gutter 等部分 HTML 经 insertAdjacentHTML 注入（v0.0.6 edit mode Spike
   * 定位：DiffHunksRenderer/FileRenderer 的 gutter.properties.style 走此通道），
   * 同样在解析期被 style-src-attr 拦截。与 innerHTML 同通道改写后再落地。
   */
  const insertAdjacentHTMLDescriptor = Object.getOwnPropertyDescriptor(
    Element.prototype,
    "insertAdjacentHTML",
  );
  if (insertAdjacentHTMLDescriptor?.value != null) {
    const original = insertAdjacentHTMLDescriptor.value as (
      position: string,
      value: string,
    ) => void;
    Object.defineProperty(Element.prototype, "insertAdjacentHTML", {
      configurable: true,
      value(this: Element, position: string, value: string) {
        const rewritten =
          value.includes('style="') || value.includes("style='")
            ? value.replace(/style=(["'])([^"']*)\1/gi, 'data-hl-style="$2"')
            : value;
        original.call(this, position, rewritten);
        if (rewritten !== value) launderStyledNodes(this);
      },
    });
  }

  const originalAppendChild = ShadowRoot.prototype.appendChild;
  ShadowRoot.prototype.appendChild = function <T extends Node>(node: T): T {
    const isShimmedStyle =
      node instanceof HTMLStyleElement &&
      (node.hasAttribute("data-theme-css") ||
        node.hasAttribute("data-editor-css") ||
        node.hasAttribute("data-editor-theme-css"));
    if (isShimmedStyle) {
      const styleNode = node;
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(styleNode.textContent ?? "");
      const observer = new MutationObserver(() => {
        sheet.replaceSync(styleNode.textContent ?? "");
      });
      observer.observe(styleNode, {
        characterData: true,
        childList: true,
        subtree: true,
      });
      this.adoptedStyleSheets = [...this.adoptedStyleSheets, sheet];
      return node;
    }
    return originalAppendChild.call(this, node);
  };

  /*
   * 编辑器全局样式（data-editor-global-css）经 light DOM appendChild 注入
   * （非 ShadowRoot），严格 CSP 下同属 style-src-elem 被拦截。转接到
   * document.adoptedStyleSheets（构造式样式表不受 style-src 限制）。
   * 内容仅为 `[data-annotation-slot] { user-select: none }` 的轻量规则。
   */
  const originalElementAppendChild = Element.prototype.appendChild;
  Element.prototype.appendChild = function <T extends Node>(node: T): T {
    if (
      node instanceof HTMLStyleElement &&
      node.hasAttribute("data-editor-global-css")
    ) {
      const styleNode = node;
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(styleNode.textContent ?? "");
      const observer = new MutationObserver(() => {
        sheet.replaceSync(styleNode.textContent ?? "");
      });
      observer.observe(styleNode, {
        characterData: true,
        childList: true,
        subtree: true,
      });
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
      return node;
    }
    return originalElementAppendChild.call(this, node);
  };
}

interface PierreProbe {
  containerCount: number;
  adoptedSheets: number;
  shadowStyleElements: number;
  rowCounts: { addition: number; deletion: number; context: number };
  additionRowBg: string;
  deletionRowBg: string;
  contextRowBg: string;
  additionIndicator: string;
  preHeights: number[];
  patchErrors: string[];
  gutterAdditionMarker: string;
  tokenSpanCount: number;
  tokenInlineStyleCount: number;
  firstTokenInlineStyle: string;
  firstTokenComputedColor: string;
  headerFontFamily: string;
  expandButtons: {
    count: number;
    tagName: string;
    role: string | null;
    tabIndex: number;
    ariaLabel: string | null;
    textContent: string;
  };
}

interface CmProbe {
  hasEditor: boolean;
  headStyleElements: number;
  headStyleSnippet: string;
  documentAdoptedSheets: number;
  contentPaddingLeft: string;
  contentMinHeight: string;
  gutterVisible: boolean;
}

interface CspSelfTest {
  setPropertyColor: string;
  cssTextColor: string;
  setAttributeColor: string;
  innerHtmlColor: string;
}

interface SpikeReport {
  ready: boolean;
  theme: string;
  view: string;
  cspViolations: CspViolationRecord[];
  patchStatus: string;
  patchGitStatus: string;
  pierre: PierreProbe | null;
  cm: CmProbe | null;
  cspSelfTest: CspSelfTest | null;
}

declare global {
  interface Window {
    __spike: SpikeReport;
    __spikeEdit?: EditSpikeReport | undefined;
    __spikeViolations?: number;
  }
}

const OLD_TS = `import { SvnCommandRunner } from "../svn/runner";

export interface OrderLine {
  sku: string;
  quantity: number;
  price: number;
}

export class OrderService {
  private readonly runner: SvnCommandRunner;

  constructor(runner: SvnCommandRunner) {
    this.runner = runner;
  }

  async submit(order: OrderLine[]): Promise<void> {
    const total = order.reduce((sum, line) => sum + line.price, 0);
    console.log("提交订单，总额", total);
    await this.runner.run(["commit", "-m", "order"]);
  }

  // 以下为一段足够长的未变更代码，用于触发折叠分隔行
  private pad00(): number { return 0; }
  private pad01(): number { return 1; }
  private pad02(): number { return 2; }
  private pad03(): number { return 3; }
  private pad04(): number { return 4; }
  private pad05(): number { return 5; }
  private pad06(): number { return 6; }
  private pad07(): number { return 7; }
  private pad08(): number { return 8; }
  private pad09(): number { return 9; }
  private pad10(): number { return 10; }
  private pad11(): number { return 11; }
  private pad12(): number { return 12; }
  private pad13(): number { return 13; }
  private pad14(): number { return 14; }
  private pad15(): number { return 15; }
  private pad16(): number { return 16; }
  private pad17(): number { return 17; }
  private pad18(): number { return 18; }

  discount(order: OrderLine[]): number {
    return order.length > 3 ? 0.9 : 1;
  }
}
`;

const NEW_TS = `import { SvnCommandRunner } from "../svn/runner";

export interface OrderLine {
  sku: string;
  quantity: number;
  price: number;
}

export class OrderService {
  private readonly runner: SvnCommandRunner;
  private static readonly MAX_QUANTITY = 999;

  constructor(runner: SvnCommandRunner) {
    this.runner = runner;
  }

  async submit(order: OrderLine[]): Promise<void> {
    const total = order.reduce(
      (sum, line) => sum + line.price * line.quantity,
      0,
    );
    console.log("提交订单，总额", total, "共", order.length, "行");
    await this.runner.run(["commit", "-m", "order"]);
  }

  // 以下为一段足够长的未变更代码，用于触发折叠分隔行
  private pad00(): number { return 0; }
  private pad01(): number { return 1; }
  private pad02(): number { return 2; }
  private pad03(): number { return 3; }
  private pad04(): number { return 4; }
  private pad05(): number { return 5; }
  private pad06(): number { return 6; }
  private pad07(): number { return 7; }
  private pad08(): number { return 8; }
  private pad09(): number { return 9; }
  private pad10(): number { return 10; }
  private pad11(): number { return 11; }
  private pad12(): number { return 12; }
  private pad13(): number { return 13; }
  private pad14(): number { return 14; }
  private pad15(): number { return 15; }
  private pad16(): number { return 16; }
  private pad17(): number { return 17; }
  private pad18(): number { return 18; }

  discount(order: OrderLine[]): number {
    if (order.some((line) => line.quantity > OrderService.MAX_QUANTITY)) {
      throw new Error("超出单SKU最大数量");
    }
    return order.length > 3 ? 0.85 : 1;
  }
}
`;

const SVN_PATCH = `Index: src/order/service.ts
===================================================================
--- src/order/service.ts\t(revision 127)
+++ src/order/service.ts\t(working copy)
@@ -8,9 +8,12 @@

 export class OrderService {
   private readonly runner: SvnCommandRunner;
+  private static readonly MAX_QUANTITY = 999;
${" "}
  async submit(order: OrderLine[]): Promise<void> {
-    const total = order.reduce((sum, line) => sum + line.price, 0);
+    const total = order.reduce(
+      (sum, line) => sum + line.price * line.quantity,
+      0,
+    );
     console.log("提交订单，总额", total);
     await this.runner.run(["commit", "-m", "order"]);
   }
`;

const GIT_PATCH = `diff --git a/src/order/service.ts b/src/order/service.ts
index 1111111..2222222 100644
--- a/src/order/service.ts
+++ b/src/order/service.ts
@@ -8,9 +8,12 @@

 export class OrderService {
   private readonly runner: SvnCommandRunner;
+  private static readonly MAX_QUANTITY = 999;
${" "}
  async submit(order: OrderLine[]): Promise<void> {
-    const total = order.reduce((sum, line) => sum + line.price, 0);
+    const total = order.reduce(
+      (sum, line) => sum + line.price * line.quantity,
+      0,
+    );
     console.log("提交订单，总额", total);
     await this.runner.run(["commit", "-m", "order"]);
   }
`;

function firstRowOfType(
  roots: (ShadowRoot | null)[],
  type: string,
): Element | null {
  for (const root of roots) {
    const row = root?.querySelector(`[data-line][data-line-type="${type}"]`);
    if (row != null) return row;
  }
  return null;
}

function collectPierreProbe(): PierreProbe | null {
  const containers = Array.from(document.querySelectorAll("diffs-container"));
  if (containers.length === 0) return null;
  const roots = containers.map((container) => container.shadowRoot);
  const rowCounts = { addition: 0, deletion: 0, context: 0 };
  let tokenSpanCount = 0;
  let tokenInlineStyleCount = 0;
  let firstTokenInlineStyle = "";
  let firstTokenComputedColor = "";
  let adoptedSheets = 0;
  let shadowStyleElements = 0;
  for (const root of roots) {
    if (root == null) continue;
    adoptedSheets += root.adoptedStyleSheets.length;
    shadowStyleElements += root.querySelectorAll("style").length;
    for (const [key, lineType] of [
      ["addition", "change-addition"],
      ["deletion", "change-deletion"],
      ["context", "context"],
    ] as const) {
      rowCounts[key] += root.querySelectorAll(
        `[data-line][data-line-type="${lineType}"]`,
      ).length;
    }
    const spans = root.querySelectorAll("[data-code] span");
    tokenSpanCount += spans.length;
    for (const span of Array.from(spans)) {
      const inline = span.getAttribute("style") ?? "";
      if (inline !== "") {
        tokenInlineStyleCount += 1;
        if (firstTokenInlineStyle === "") {
          firstTokenInlineStyle = inline;
          firstTokenComputedColor = getComputedStyle(span).color;
        }
      }
    }
  }
  const additionRow = firstRowOfType(roots, "change-addition");
  const deletionRow = firstRowOfType(roots, "change-deletion");
  const contextRow = firstRowOfType(roots, "context");
  const expandButton = roots[0]?.querySelector("[data-expand-button]") ?? null;
  const header = roots[0]?.querySelector("[data-diffs-header]") ?? null;
  const preHeights: number[] = [];
  const patchErrors: string[] = [];
  for (const root of roots) {
    const pre = root?.querySelector("pre");
    if (pre != null)
      preHeights.push(Math.round(pre.getBoundingClientRect().height));
    const errorNode = root?.querySelector("[data-error-message]");
    if (errorNode != null)
      patchErrors.push(errorNode.textContent?.trim().slice(0, 120) ?? "");
  }
  return {
    containerCount: containers.length,
    adoptedSheets,
    shadowStyleElements,
    rowCounts,
    additionRowBg:
      additionRow == null ? "" : getComputedStyle(additionRow).backgroundColor,
    deletionRowBg:
      deletionRow == null ? "" : getComputedStyle(deletionRow).backgroundColor,
    contextRowBg:
      contextRow == null ? "" : getComputedStyle(contextRow).backgroundColor,
    additionIndicator:
      additionRow == null
        ? ""
        : getComputedStyle(additionRow, "::before").content,
    preHeights,
    patchErrors,
    gutterAdditionMarker:
      roots[0]
        ?.querySelector("[data-gutter] [data-line-type='change-addition']")
        ?.textContent?.trim() ?? "",
    tokenSpanCount,
    tokenInlineStyleCount,
    firstTokenInlineStyle,
    firstTokenComputedColor,
    headerFontFamily: header == null ? "" : getComputedStyle(header).fontFamily,
    expandButtons: {
      count:
        (roots[0]?.querySelectorAll("[data-expand-button]").length ?? 0) +
        (roots[1]?.querySelectorAll("[data-expand-button]").length ?? 0),
      tagName: expandButton?.tagName ?? "",
      role: expandButton?.getAttribute("role") ?? null,
      tabIndex:
        expandButton instanceof HTMLElement ? expandButton.tabIndex : -1,
      ariaLabel: expandButton?.getAttribute("aria-label") ?? null,
      textContent: expandButton?.textContent?.trim() ?? "",
    },
  };
}

function collectCmProbe(): CmProbe {
  const editor = document.querySelector("#cm-merge .cm-editor");
  const content = document.querySelector("#cm-merge .cm-content");
  const gutters = document.querySelector("#cm-merge .cm-gutters");
  const contentStyle = content == null ? null : getComputedStyle(content);
  const headStyle = document.head.querySelector("style");
  return {
    hasEditor: editor != null,
    headStyleElements: document.head.querySelectorAll("style").length,
    headStyleSnippet: headStyle?.textContent?.slice(0, 120) ?? "",
    documentAdoptedSheets: document.adoptedStyleSheets.length,
    contentPaddingLeft: contentStyle?.paddingLeft ?? "",
    contentMinHeight: contentStyle?.minHeight ?? "",
    gutterVisible:
      gutters != null &&
      gutters instanceof HTMLElement &&
      gutters.offsetWidth > 0,
  };
}

/*
 * CSP 行为自测（?selftest=1）：在同一严格 CSP 下对比三种样式写入通道，
 * 为垫片设计提供浏览器级证据：
 * - setProperty 与 cssText 字符串赋值（CSSOM 通道）：预期放行；
 * - setAttribute("style", …) 与 innerHTML 中的 style 属性：预期被 style-src 拦截。
 */
function runCspSelfTest(): CspSelfTest {
  const host = document.createElement("div");
  host.style.display = "none";
  document.body.appendChild(host);
  const bySetProperty = document.createElement("span");
  bySetProperty.style.setProperty("color", "rgb(1, 2, 3)");
  const byCssText = document.createElement("span");
  byCssText.style.cssText = "color: rgb(4, 5, 6)";
  const bySetAttribute = document.createElement("span");
  bySetAttribute.setAttribute("style", "color: rgb(7, 8, 9)");
  const byInnerHtml = document.createElement("div");
  byInnerHtml.innerHTML = '<span style="color: rgb(10, 11, 12)"></span>';
  host.append(bySetProperty, byCssText, bySetAttribute, byInnerHtml);
  return {
    setPropertyColor: getComputedStyle(bySetProperty).color,
    cssTextColor: getComputedStyle(byCssText).color,
    setAttributeColor: getComputedStyle(bySetAttribute).color,
    innerHtmlColor: getComputedStyle(byInnerHtml.firstElementChild as Element)
      .color,
  };
}

async function main(): Promise<void> {
  const params = new URLSearchParams(window.location.search);

  // CSP 违规计数必须在所有分支之前注册（edit 分支早退，此前漏注册导致
  // 编辑态“零违规”断言恒真——v0.0.6 验收发现）。
  document.addEventListener("securitypolicyviolation", () => {
    window.__spikeViolations = (window.__spikeViolations ?? 0) + 1;
  });

  // v0.0.6 edit mode Spike：独立报告，不执行只读 spike 逻辑。
  if (params.get("edit") === "1") {
    // 直接安装生产垫片（src/webview/features/diff/cspCompatObserver.ts）：
    // Spike 与生产跑同一份适配代码，结论可回推到生产路径。
    const { installDiffCspCompatibilityShim } = await import(
      "@prod/csp-compat-observer"
    );
    installDiffCspCompatibilityShim();
    const { runEditSpike } = await import("./edit-spike");
    await runEditSpike(params);
    return;
  }

  const theme = params.get("theme") ?? "dark";
  const view = params.get("view") === "unified" ? "unified" : "split";
  document.body.dataset.theme = theme;
  if (params.get("shim") === "1") installCspCompatibilityShim();

  const report: SpikeReport = {
    ready: false,
    theme,
    view,
    cspViolations: [],
    patchStatus: "pending",
    patchGitStatus: "pending",
    pierre: null,
    cm: null,
    cspSelfTest: null,
  };
  window.__spike = report;

  document.addEventListener("securitypolicyviolation", (event) => {
    report.cspViolations.push({
      blockedURI: event.blockedURI,
      effectiveDirective: event.effectiveDirective,
      disposition: event.disposition,
      sample: event.sample ?? "",
    });
  });

  if (params.get("selftest") === "1") {
    report.cspSelfTest = runCspSelfTest();
  }

  await preloadHighlighter({
    themes: ["pierre-dark", "pierre-light"],
    langs: SPIKE_LANGUAGES,
  });

  const options = {
    theme: { dark: "pierre-dark", light: "pierre-light" },
    themeType: "system",
    diffStyle: view,
    overflow: "scroll",
    // 规划 §5 P1：状态不能只靠颜色，保留 +/- 指示符（默认为 "bars" 色条）
    diffIndicators: "classic",
  } as const;

  const fileHost = document.getElementById("pierre-file");
  if (fileHost != null) {
    const fileDiff = new FileDiff({ ...options });
    fileDiff.render({
      oldFile: { name: "src/order/service.ts", contents: OLD_TS },
      newFile: { name: "src/order/service.ts", contents: NEW_TS },
      containerWrapper: fileHost,
    });
  }

  const patchHost = document.getElementById("pierre-patch");
  if (patchHost != null) {
    try {
      const parsed = parsePatchFiles(SVN_PATCH);
      const fileDiffMetadata = parsed[0]?.files[0];
      if (fileDiffMetadata == null) {
        report.patchStatus = "parse-empty";
      } else {
        const patchDiff = new FileDiff({ ...options });
        patchDiff.render({
          fileDiff: fileDiffMetadata,
          containerWrapper: patchHost,
        });
        report.patchStatus = `rendered:${fileDiffMetadata.name}`;
      }
    } catch (error) {
      report.patchStatus = `error:${String(error)}`;
    }
  }

  const patchGitHost = document.getElementById("pierre-patch-git");
  if (patchGitHost != null) {
    try {
      const parsed = parsePatchFiles(GIT_PATCH);
      const fileDiffMetadata = parsed[0]?.files[0];
      if (fileDiffMetadata == null) {
        report.patchGitStatus = "parse-empty";
      } else {
        const patchDiff = new FileDiff({ ...options });
        patchDiff.render({
          fileDiff: fileDiffMetadata,
          containerWrapper: patchGitHost,
        });
        report.patchGitStatus = `rendered:${fileDiffMetadata.name}`;
      }
    } catch (error) {
      report.patchGitStatus = `error:${String(error)}`;
    }
  }

  const cmHost = document.getElementById("cm-merge");
  if (cmHost != null && params.get("cm") !== "0") {
    new MergeView({
      a: { doc: OLD_TS },
      b: { doc: NEW_TS },
      parent: cmHost,
    });
  }

  // 等两帧，让可能的异步高亮重渲染与样式注入完成后再探测。
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      report.pierre = collectPierreProbe();
      report.cm = collectCmProbe();
      report.ready = true;
    });
  });
}

void main();
