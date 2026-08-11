/*
 * @pierre/diffs 的 CSP 兼容垫片与可达性修正（v0.0.4 阶段 1）。
 *
 * 与阶段 0 Spike 垫片的差异——作用域收窄论证：
 * Spike 版永久改写 `Element.prototype.innerHTML` setter 与
 * `ShadowRoot.prototype.appendChild` 两个全局原型，影响面是整个 Webview 页面。
 * 本实现不改任何全局原型，改为只对适配层自己挂载的 FileDiff Shadow Root 安装
 * MutationObserver（组件卸载即 disconnect）：
 *
 * 1. 影响面收窄到组件 Shadow DOM 内部；页面上其他代码（含第三方库）的
 *    innerHTML / appendChild 行为完全不受影响，不存在原型改写的全局副作用。
 * 2. 生效窗口与组件生命周期一致，卸载后页面恢复原状，无残留行为变化。
 * 3. 落地通道只用 CSP 明确放行的 CSSOM 写（setProperty、adoptedStyleSheets），
 *    与 Spike 自测证据一致（tests/spike `?selftest=1`：setProperty/cssText 放行，
 *    style 属性与内联 <style> 被拦截）；不引入任何新的绕 CSP 手段。
 * 4. 观察者对被拦截内容只做"原样落地"：逐条转发声明值，不解析、不执行、
 *    不生成新样式规则，不改变库本来意图之外的任何渲染结果。
 *
 * 处理的两条被拦通道（Spike 实测，见 docs/releases/v0.0.4/README.md §11）：
 * A. token 语法颜色：hast-util-to-html 序列化后经 innerHTML 注入，span 上的
 *    style="…" 属性被 style-src-attr 拦截（属性保留但不应用）。修正：读出
 *    属性值，逐条 setProperty 落地（CSSOM 写会回填 style 属性，无需移除）。
 *    判定"被拦截"的依据：属性非空而 el.style 没有任何声明（解析期未应用）。
 *    非 CSP 环境（dev server / vite preview）属性已正常应用，el.style.length
 *    大于 0，直接跳过，零额外工作。
 * B. 主题 `:host` 变量：库向 shadowRoot 插入内联 <style data-theme-css>，
 *    被 style-src-elem 拦截。修正：把文本内容转写为 Constructable Stylesheet
 *    加入 adoptedStyleSheets（不受 style-src 限制）并移除原节点；库仍持有
 *    该节点引用并通过 textContent 更新，故对已移除节点继续观察并同步。
 *    主题变更若产生新的 style 节点会再次转换，后加入的 sheet 级联靠后生效。
 *
 * 附带可达性修正（规划 §10 必修项）：组件折叠控件为
 * `DIV role="button" tabIndex="-1"` 且无 aria-label，键盘不可达。统一补齐
 * tabIndex、中文 aria-label 与 Enter/Space 激活；适配层工具栏另提供
 * "展开全部/折叠未变更"按钮作为不依赖这些控件的路径。
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
      parent.hasAttribute("data-theme-css")
    ) {
      candidates.push(parent);
    }
    for (const element of Array.from(
      parent.querySelectorAll("style[data-theme-css]"),
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
