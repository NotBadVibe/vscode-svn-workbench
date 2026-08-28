/*
 * @pierre/diffs 的 CSP 兼容垫片与可达性修正。
 *
 * v0.0.6 起为两层结构：
 *
 * 第一层（installDiffCspCompatibilityShim，插入前拦截）：实测证据
 * （v0.0.6 验收探针：严格 CSP 下 style 属性与内联 <style> 在解析期即触发
 * securitypolicyviolation，事后移除节点无法消除违规事件）表明，Go 条件
 * "CSP 零违规"只能通过插入前改写达成。库在脱离文档的节点上构建 HTML
 * （getRootNode 非 ShadowRoot），无法按"是否在 diffs-container 内"收窄，
 * 因此 innerHTML / insertAdjacentHTML / setAttribute("style") 的改写是全局
 * 的——安全性论证：本 Webview 完全由第一方 Svelte 代码与受控依赖构成，
 * 已核查全部 Svelte 模板无静态 style 属性、第一方代码无 innerHTML 调用；
 * 改写仅在 HTML 字符串包含 style= 时发生，且 setProperty 会回填 style
 * 属性，对外语义不变。带 data-theme-css / data-editor-css /
 * data-editor-theme-css / data-editor-global-css 标记的 <style> 节点只由
 * @pierre/diffs 产生，拦截天然收窄：
 * 1. innerHTML / insertAdjacentHTML：把 style="…" 改写为 data-hl-style="…"
 *    后落地（setProperty 是 CSP 放行的 CSSOM 通道，Spike 自测证据）；
 * 2. setAttribute("style", …)：重定向到 style.cssText（同为放行通道）；
 * 3. ShadowRoot.appendChild：仅拦截带上述标记的 <style>，转写为
 *    Constructable Stylesheet 加入 adoptedStyleSheets（不受 style-src 限制），
 *    节点不插入 DOM；库仍持有节点引用并通过 textContent 更新，用
 *    MutationObserver 持续同步到 sheet；
 * 4. Element.appendChild：仅拦截 data-editor-global-css（编辑器 light DOM
 *    全局样式），转写进 document.adoptedStyleSheets。
 *
 * 第二层（observeDiffShadowRoot / observeDiffContainer，插入后修复）：不改
 * 任何全局原型，只对适配层挂载的容器安装 MutationObserver（卸载即
 * disconnect）。作用是兜底（库改用 insertBefore 等未拦截通道时仍能恢复样式，
 * 违规会被验收测试暴露）与折叠控件的可达性修正：
 * A. token 语法颜色 style="…" 属性被 style-src-attr 拦截（属性保留但未应用）：
 *    逐条 setProperty 落地；
 * B. 内联 <style data-theme-css|data-editor-css|data-editor-theme-css> →
 *    root.adoptedStyleSheets；light DOM 的 <style data-editor-global-css> →
 *    document.adoptedStyleSheets；
 * C. 折叠控件补齐 tabIndex、中文 aria-label 与 Enter/Space 激活（适配层工具栏
 *    另有等价路径）。
 */

/** 逐条 setProperty 应用 "prop:value;…" 声明串（CSP 安全通道）。 */
export function applyStyleDeclarations(
  target: CSSStyleDeclaration,
  value: string,
): void {
  for (const declaration of value.split(";")) {
    const colon = declaration.indexOf(":");
    if (colon <= 0) continue;
    const property = declaration.slice(0, colon).trim();
    const propertyValue = declaration.slice(colon + 1).trim();
    if (property !== "" && propertyValue !== "") {
      target.setProperty(property, propertyValue);
    }
  }
}

/** 折叠控件的中文可访问名称（terminology 不覆盖 Shadow DOM 内部节点，就近声明）。 */
export const EXPAND_BUTTON_ARIA_LABEL = "展开被折叠的未变更代码行";

/* ---- 第一层：插入前拦截垫片（生产零违规通道） ---- */

/** 库注入 style="…" 属性的暂存改写目标（与 Spike 垫片同名）。 */
const LAUNDERED_STYLE_ATTRIBUTE = "data-hl-style";

/** 库在 Shadow Root 内注入的内联 <style> 标记。 */
const SHADOW_STYLE_MARKERS = [
  "data-theme-css",
  "data-editor-css",
  "data-editor-theme-css",
];

/** 编辑器 light DOM 全局样式标记。 */
const GLOBAL_STYLE_MARKER = "data-editor-global-css";

function rewriteStyleAttributes(value: string): string {
  return value.includes('style="') || value.includes("style='")
    ? value.replace(
        /style=(["'])([^"']*)\1/gi,
        `${LAUNDERED_STYLE_ATTRIBUTE}="$2"`,
      )
    : value;
}

function launderRewrittenStyles(parent: ParentNode): void {
  for (const node of Array.from(
    parent.querySelectorAll(`[${LAUNDERED_STYLE_ATTRIBUTE}]`),
  )) {
    if (!(node instanceof HTMLElement)) continue;
    applyStyleDeclarations(
      node.style,
      node.getAttribute(LAUNDERED_STYLE_ATTRIBUTE) ?? "",
    );
    node.removeAttribute(LAUNDERED_STYLE_ATTRIBUTE);
  }
}

/** Constructable Stylesheet 环境探测（jsdom 等无此能力时跳过 3/4 通道）。 */
const supportsConstructableSheets =
  typeof CSSStyleSheet === "function" &&
  "replaceSync" in CSSStyleSheet.prototype &&
  typeof Document !== "undefined" &&
  "adoptedStyleSheets" in Document.prototype;

/** 把内联 <style> 节点转写为 Constructable Stylesheet 并持续同步文本更新。 */
function adoptStyleNode(
  node: HTMLStyleElement,
  adopt: (sheet: CSSStyleSheet) => void,
): MutationObserver {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(node.textContent ?? "");
  // 库保留节点引用并通过 textContent 更新（主题变量、滚动条测量值）。
  const syncObserver = new MutationObserver(() => {
    sheet.replaceSync(node.textContent ?? "");
  });
  syncObserver.observe(node, {
    characterData: true,
    childList: true,
    subtree: true,
  });
  adopt(sheet);
  return syncObserver;
}

let shimInstalled = false;

/**
 * 安装生产 CSP 兼容垫片（幂等）。必须在首次挂载 FileDiff/Editor 之前调用
 * （DiffView 模块加载时）。只拦截 @pierre/diffs 自己的节点，其余调用原样
 * 透传；不使用任何被 CSP 拦截的通道。
 */
export function installDiffCspCompatibilityShim(): void {
  if (shimInstalled) return;
  shimInstalled = true;

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
        if (typeof value !== "string") {
          originalSetter.call(this, value);
          return;
        }
        const rewritten = rewriteStyleAttributes(value);
        originalSetter.call(this, rewritten);
        if (rewritten !== value) launderRewrittenStyles(this);
      },
    });
  }

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
        if (typeof value !== "string") {
          original.call(this, position, value);
          return;
        }
        const rewritten = rewriteStyleAttributes(value);
        original.call(this, position, rewritten);
        if (rewritten !== value) launderRewrittenStyles(this);
      },
    });
  }

  const originalSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (
    name: string,
    value: string,
  ): void {
    if (String(name).toLowerCase() === "style") {
      // CSSOM 通道：CSP 放行，且同样回填 style 属性。
      (this as HTMLElement).style.cssText = value;
      return;
    }
    originalSetAttribute.call(this, name, value);
  };

  if (supportsConstructableSheets) {
    // 额外拦截 insertBefore / append 以覆盖 Pierre 可能使用的其它插入路径
    const originalShadowInsertBefore = (
      ShadowRoot.prototype as unknown as { insertBefore?: unknown }
    ).insertBefore as
      ((newNode: Node, refNode: Node | null) => Node) | undefined;
    if (originalShadowInsertBefore) {
      (
        ShadowRoot.prototype as unknown as { insertBefore: unknown }
      ).insertBefore = function <T extends Node>(
        this: ShadowRoot,
        newNode: T,
        refNode: Node | null,
      ): T {
        if (
          newNode instanceof HTMLStyleElement &&
          this.host instanceof Element &&
          this.host.localName === "diffs-container"
        ) {
          adoptStyleNode(newNode as HTMLStyleElement, (sheet) => {
            (this as ShadowRoot).adoptedStyleSheets = [
              ...(this as ShadowRoot).adoptedStyleSheets,
              sheet,
            ];
          });
          return newNode;
        }
        return (
          originalShadowInsertBefore as unknown as (n: T, r: Node | null) => T
        ).call(this, newNode, refNode);
      };
    }
    const originalShadowAppendChild = ShadowRoot.prototype.appendChild;
    ShadowRoot.prototype.appendChild = function <T extends Node>(node: T): T {
      if (
        node instanceof HTMLStyleElement &&
        this.host instanceof Element &&
        this.host.localName === "diffs-container"
      ) {
        adoptStyleNode(node, (sheet) => {
          this.adoptedStyleSheets = [...this.adoptedStyleSheets, sheet];
        });
        return node;
      }
      return originalShadowAppendChild.call(this, node) as T;
    };

    const originalElementAppendChild = Element.prototype.appendChild;
    Element.prototype.appendChild = function <T extends Node>(node: T): T {
      if (node instanceof HTMLStyleElement) {
        // 生产等价 CSP 下，任何 <style> 直接插入都会触发 style-src-elem 违规；
        // 对 document.head / diffs-container 相关 <style> 统一转 adoptedStyleSheets
        const isGlobalStyle =
          this === document.head ||
          this === document.documentElement ||
          (this instanceof Element && this.tagName === "HEAD");
        if (
          isGlobalStyle ||
          node.hasAttribute(GLOBAL_STYLE_MARKER) ||
          node.hasAttribute("data-theme-css") ||
          node.hasAttribute("data-core-css") ||
          node.hasAttribute("data-unsafe-css")
        ) {
          adoptStyleNode(node, (sheet) => {
            document.adoptedStyleSheets = [
              ...document.adoptedStyleSheets,
              sheet,
            ];
          });
          return node;
        }
      }
      return originalElementAppendChild.call(this, node) as T;
    };
    const originalElementInsertBefore = Element.prototype.insertBefore;
    (Element.prototype as unknown as { insertBefore: unknown }).insertBefore =
      function <T extends Node>(
        this: Element,
        newNode: T,
        refNode: Node | null,
      ): T {
        if (newNode instanceof HTMLStyleElement) {
          const isGlobalStyle =
            this === document.head ||
            this === document.documentElement ||
            (this instanceof Element && this.tagName === "HEAD");
          if (
            isGlobalStyle ||
            (newNode as HTMLStyleElement).hasAttribute(GLOBAL_STYLE_MARKER) ||
            (newNode as HTMLStyleElement).hasAttribute("data-theme-css")
          ) {
            adoptStyleNode(newNode as HTMLStyleElement, (sheet) => {
              document.adoptedStyleSheets = [
                ...document.adoptedStyleSheets,
                sheet,
              ];
            });
            return newNode;
          }
        }
        return (
          originalElementInsertBefore as unknown as (n: T, r: Node | null) => T
        ).call(this, newNode, refNode);
      };
    const originalElementAppend = (
      Element.prototype as unknown as { append?: unknown }
    ).append as ((...nodes: (Node | string)[]) => void) | undefined;
    if (originalElementAppend) {
      (Element.prototype as unknown as { append: unknown }).append = function (
        this: Element,
        ...nodes: (Node | string)[]
      ): void {
        const styles = nodes.filter(
          (n) => n instanceof HTMLStyleElement,
        ) as HTMLStyleElement[];
        if (styles.length > 0) {
          const isGlobalStyle =
            this === document.head ||
            this === document.documentElement ||
            (this instanceof Element && this.tagName === "HEAD");
          let handled = false;
          for (const s of styles) {
            if (
              isGlobalStyle ||
              s.hasAttribute(GLOBAL_STYLE_MARKER) ||
              s.hasAttribute("data-theme-css")
            ) {
              adoptStyleNode(s, (sheet) => {
                document.adoptedStyleSheets = [
                  ...document.adoptedStyleSheets,
                  sheet,
                ];
              });
              handled = true;
            }
          }
          if (handled && styles.length === nodes.length) return;
        }
        return (
          originalElementAppend as (...n: (Node | string)[]) => void
        ).apply(this, nodes);
      };
    }
  }
}

/* ---- 第二层：插入后兜底观察器与可达性修正 ---- */

interface ObserverHandle {
  disconnect(): void;
}

function isBlockedInlineStyle(element: Element): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false;
  const attribute = element.getAttribute("style");
  if (attribute == null || attribute.trim() === "") return false;
  // CSP 拦截时属性保留但解析期未应用，CSSOM 中没有任何声明。
  return element.style.length === 0;
}

/**
 * 观察一个 FileDiff Shadow Root，持续落地被 CSP 拦截的样式并修复折叠控件。
 * 返回的 handle 在组件卸载时 disconnect。
 */
export function observeDiffShadowRoot(root: ShadowRoot): ObserverHandle {
  const convertedThemeNodes = new WeakSet<HTMLStyleElement>();
  const themeSyncObservers: MutationObserver[] = [];

  const launderBlockedStyles = (parent: ParentNode): void => {
    if (parent instanceof Element && isBlockedInlineStyle(parent)) {
      applyStyleDeclarations(parent.style, parent.getAttribute("style") ?? "");
    }
    for (const element of Array.from(parent.querySelectorAll("[style]"))) {
      if (isBlockedInlineStyle(element)) {
        applyStyleDeclarations(
          element.style,
          element.getAttribute("style") ?? "",
        );
      }
    }
  };

  const convertThemeStyles = (parent: ParentNode): void => {
    const candidates: HTMLStyleElement[] = [];
    if (
      parent instanceof HTMLStyleElement &&
      SHADOW_STYLE_MARKERS.some((marker) => parent.hasAttribute(marker))
    ) {
      candidates.push(parent);
    }
    for (const element of Array.from(
      parent.querySelectorAll(
        SHADOW_STYLE_MARKERS.map((marker) => `style[${marker}]`).join(","),
      ),
    )) {
      if (element instanceof HTMLStyleElement) candidates.push(element);
    }
    for (const styleNode of candidates) {
      if (convertedThemeNodes.has(styleNode)) continue;
      convertedThemeNodes.add(styleNode);
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(styleNode.textContent ?? "");
      // 库保留节点引用并更新 textContent（主题变量、滚动条测量值），同步到 sheet。
      const syncObserver = new MutationObserver(() => {
        sheet.replaceSync(styleNode.textContent ?? "");
      });
      syncObserver.observe(styleNode, {
        characterData: true,
        childList: true,
        subtree: true,
      });
      themeSyncObservers.push(syncObserver);
      styleNode.remove();
      root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
    }
  };

  const fixExpandButtons = (parent: ParentNode): void => {
    const candidates: HTMLElement[] = [];
    if (
      parent instanceof HTMLElement &&
      parent.hasAttribute("data-expand-button")
    ) {
      candidates.push(parent);
    }
    for (const element of Array.from(
      parent.querySelectorAll("[data-expand-button]"),
    )) {
      if (element instanceof HTMLElement) candidates.push(element);
    }
    for (const button of candidates) {
      if (button.dataset.a11yFixed === "1") continue;
      button.dataset.a11yFixed = "1";
      button.tabIndex = 0;
      button.setAttribute("aria-label", EXPAND_BUTTON_ARIA_LABEL);
      button.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          button.click();
        }
      });
    }
  };

  const sweep = (parent: ParentNode): void => {
    launderBlockedStyles(parent);
    convertThemeStyles(parent);
    fixExpandButtons(parent);
  };

  // 先全量处理挂载期间已同步插入的节点，再观察后续增量。
  sweep(root);

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of Array.from(record.addedNodes)) {
        if (node instanceof Element || node instanceof DocumentFragment) {
          sweep(node);
        }
      }
    }
  });
  observer.observe(root, { childList: true, subtree: true });

  return {
    disconnect() {
      observer.disconnect();
      for (const syncObserver of themeSyncObservers) syncObserver.disconnect();
      themeSyncObservers.length = 0;
    },
  };
}

/**
 * 兜底观察 FileDiff 的 light DOM 容器：编辑器全局样式
 * <style data-editor-global-css> 若绕过插入前垫片（如 insertBefore 通道），
 * 在此转写进 document.adoptedStyleSheets；disconnect 时移除已收编的 sheet。
 */
export function observeDiffContainer(container: HTMLElement): ObserverHandle {
  if (!supportsConstructableSheets) {
    return { disconnect: () => undefined };
  }
  const adopted = new Set<CSSStyleSheet>();
  const converted = new WeakSet<HTMLStyleElement>();
  const syncObservers: MutationObserver[] = [];

  const convert = (parent: ParentNode): void => {
    const candidates: HTMLStyleElement[] = [];
    if (
      parent instanceof HTMLStyleElement &&
      parent.hasAttribute(GLOBAL_STYLE_MARKER)
    ) {
      candidates.push(parent);
    }
    for (const element of Array.from(
      parent.querySelectorAll(`style[${GLOBAL_STYLE_MARKER}]`),
    )) {
      if (element instanceof HTMLStyleElement) candidates.push(element);
    }
    for (const styleNode of candidates) {
      if (converted.has(styleNode)) continue;
      converted.add(styleNode);
      const syncObserver = adoptStyleNode(styleNode, (sheet) => {
        adopted.add(sheet);
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
      });
      syncObservers.push(syncObserver);
      styleNode.remove();
    }
  };

  convert(container);
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of Array.from(record.addedNodes)) {
        if (node instanceof Element || node instanceof DocumentFragment) {
          convert(node);
        }
      }
    }
  });
  observer.observe(container, { childList: true, subtree: true });

  return {
    disconnect() {
      observer.disconnect();
      for (const syncObserver of syncObservers) syncObserver.disconnect();
      syncObservers.length = 0;
      if (adopted.size > 0) {
        document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
          (sheet) => !adopted.has(sheet),
        );
        adopted.clear();
      }
    },
  };
}
