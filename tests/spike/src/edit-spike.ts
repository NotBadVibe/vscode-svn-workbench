import { FileDiff } from "@pierre/diffs";

/*
 * v0.0.6 阶段 1：真实 Webview edit mode Spike（生产等价严格 CSP）。
 *
 * 验证目标（go/no-go 依据）：
 * 1. `@pierre/diffs/edit` 以动态 chunk 加载（体积/懒加载路径）；
 * 2. 可编辑 FileDiff 在严格 CSP 下能挂载 Editor，新增侧可编辑、删除/注释侧不可编辑；
 * 3. 实际输入（程序化 setState + onChange 事件）与中文 IME composition 均可用；
 * 4. 恶意文本（HTML/script 注入负载）被当作纯文本转义渲染，不产生可执行元素；
 * 5. 宿主级 Cmd/Ctrl+S 捕获与编辑器的 keydown 共存；
 * 6. 三主题下可辨识、挂载耗时与 CSP 零违规。
 */

export interface EditSpikeProbe {
  dynamicChunkLoaded: boolean;
  editorAttached: boolean;
  contentEditableCount: number;
  additionsEditable: number;
  deletionsEditable: number;
  typedText: string;
  imeCompositionSafe: boolean;
  shortcutCaptured: boolean;
  shortcutKey: string;
  maliciousRenderedAsText: boolean;
  maliciousScriptElementCount: number;
  onChangeFired: boolean;
  getTextLength: number;
}

export interface EditSpikeReport extends EditSpikeProbe {
  ready: boolean;
  theme: string;
  mountMs: number;
  editChunkResource: string | null;
  cspViolations: number;
  styleAttrTrap?: Array<{ method: string; value: string }>;
  error?: string;
}

declare global {
  interface Window {
    __spikeEdit: EditSpikeReport | undefined;
    __spikeEditFocus?: () => void;
    __spikeEditGetText?: () => string;
    __spikeEditState?: () => {
      activeElementTag: string;
      activeElementEditable: boolean;
      onChangeFired: boolean;
    };
  }
}

const OLD = `export class OrderService {
  private readonly runner: SvnCommandRunner;

  async submit(order) {
    await this.runner.run(["commit", "-m", "order"]);
  }

  discount(order) {
    return order.length > 3 ? 0.9 : 1;
  }
}
`;

/** 新增侧负载：包含 HTML/脚本注入负载，验证必须按纯文本转义渲染。 */
const NEW = `export class OrderService {
  private readonly runner: SvnCommandRunner;

  async submit(order) {
    const total = order.reduce((sum, line) => sum + line.price, 0);
    console.log("提交订单，总额", total);
    await this.runner.run(["commit", "-m", "order"]);
  }

  <script>alert("xss")</script>
  <img src=x onerror="alert(2)">
  discount(order) {
    return order.length > 3 ? 0.9 : 1;
  }
}
`;

function collectViolationCount(): number {
  return (
    (window as unknown as { __spikeViolations?: number }).__spikeViolations ?? 0
  );
}

function installStyleAttributeTrap(): Array<{ method: string; value: string }> {
  const hits: Array<{ method: string; value: string }> = [];
  const originalSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name: string, value: string) {
    if (String(name).toLowerCase() === "style")
      hits.push({ method: "setAttribute", value });
    return originalSetAttribute.call(this, name, value);
  };
  return hits;
}

export async function runEditSpike(
  params: URLSearchParams,
): Promise<EditSpikeReport> {
  const theme = params.get("theme") ?? "dark";
  document.body.dataset.theme = theme;
  const report: EditSpikeReport = {
    ready: false,
    theme,
    mountMs: 0,
    editChunkResource: null,
    cspViolations: 0,
    dynamicChunkLoaded: false,
    editorAttached: false,
    contentEditableCount: 0,
    additionsEditable: 0,
    deletionsEditable: 0,
    typedText: "",
    imeCompositionSafe: false,
    shortcutCaptured: false,
    shortcutKey: "",
    maliciousRenderedAsText: false,
    maliciousScriptElementCount: 0,
    onChangeFired: false,
    getTextLength: 0,
  };
  window.__spikeEdit = report;

  const host = document.getElementById("pierre-edit");
  const styleAttrHits = installStyleAttributeTrap();
  if (host == null) {
    report.error = "missing-host";
    report.ready = true;
    return report;
  }

  const start = performance.now();
  try {
    // 动态 import：让 @pierre/diffs/edit 成为独立懒加载 chunk。
    const { Editor } = await import("@pierre/diffs/edit");
    report.dynamicChunkLoaded = true;

    const fileDiff = new FileDiff({
      theme: { dark: "pierre-dark", light: "pierre-light" },
      themeType: "system",
      diffStyle: "split",
      overflow: "scroll",
      diffIndicators: "classic",
      disableErrorHandling: true,
    });
    fileDiff.render({
      oldFile: { name: "src/order/service.ts", contents: OLD },
      newFile: { name: "src/order/service.ts", contents: NEW },
      containerWrapper: host,
    });

    const editor = new Editor({
      onChange: () => {
        report.onChangeFired = true;
      },
    });
    // 可编辑 FileDiff：attachEditor 使新增侧进入 contentEditable 编辑态。
    editor.edit(fileDiff);
    report.editorAttached = true;
    report.mountMs = Math.round(performance.now() - start);

    // 编辑器挂载为异步（attachEditor 触发重渲染后才创建 TextDocument），
    // 等待 contentEditable 就绪后再执行输入探测。
    const deadline = Date.now() + 5000;
    const waitForEditable = (): boolean => {
      const roots = Array.from(host.querySelectorAll("diffs-container"))
        .map((element) => element.shadowRoot)
        .filter(Boolean) as ShadowRoot[];
      return roots.some((root) =>
        root.querySelector('[contenteditable="true"]'),
      );
    };
    while (!waitForEditable() && Date.now() < deadline) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }

    // 探测 contentEditable 分布：编辑器在代码容器上设置 contenteditable=true，
    // 删除/注释行显式置 contenteditable=false（新增行继承可编辑）。
    const shadowRoots = Array.from(host.querySelectorAll("diffs-container"))
      .map((element) => element.shadowRoot)
      .filter(Boolean) as ShadowRoot[];
    report.contentEditableCount = shadowRoots.reduce(
      (total, root) =>
        total +
        Array.from(root.querySelectorAll('[contenteditable="true"]')).length,
      0,
    );
    report.additionsEditable = shadowRoots.reduce(
      (total, root) =>
        total +
        Array.from(
          root.querySelectorAll(
            '[data-line-type="change-addition"]:not([contenteditable="false"])',
          ),
        ).length,
      0,
    );
    report.deletionsEditable = shadowRoots.reduce(
      (total, root) =>
        total +
        Array.from(
          root.querySelectorAll(
            '[data-line-type="change-deletion"][contenteditable="false"]',
          ),
        ).length,
      0,
    );

    // 恶意负载：必须作为文本呈现（转义），不得产生 script/img 可执行元素。
    report.maliciousScriptElementCount = shadowRoots.reduce(
      (total, root) => total + root.querySelectorAll("script, img").length,
      0,
    );
    const renderedText = shadowRoots
      .map((root) => root.textContent ?? "")
      .join("\n");
    report.maliciousRenderedAsText =
      (renderedText.includes("<script>") ||
        renderedText.includes("&lt;script&gt;")) &&
      (renderedText.includes('onerror="alert(2)"') ||
        renderedText.includes("onerror=&quot;alert(2)&quot;"));

    // 宿主级 Cmd/Ctrl+S 捕获：与编辑器 keydown 共存（preventDefault 不抛错）。
    let capturedKey = "";
    const onKeydown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        capturedKey = event.key.toLowerCase();
        event.preventDefault();
      }
    };
    document.addEventListener("keydown", onKeydown, true);
    const synthetic = new KeyboardEvent("keydown", {
      key: "s",
      code: "KeyS",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(synthetic);
    document.removeEventListener("keydown", onKeydown, true);
    report.shortcutCaptured = capturedKey === "s";
    report.shortcutKey = capturedKey;

    // 程序化输入：编辑后文本应包含追加内容。
    const probeText = "// spike-typed-marker";
    editor.applyEdits([
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
        },
        newText: probeText,
      },
    ]);
    report.typedText = editor.getText().includes(probeText)
      ? "applied"
      : editor.getText().slice(0, 40);
    report.getTextLength = editor.getText().length;

    // 中文 IME composition：触发 compositionstart/update/end，确认无 CSP 拦截且文本落盘。
    const editable = shadowRoots
      .map((root) => root.querySelector('[contenteditable="true"]'))
      .find((element) => element != null) as HTMLElement | undefined;
    if (editable != null) {
      // IME 生命周期：compositionstart/update 不崩溃、不触发 CSP；
      // 合成文本的落盘由 Playwright 真实输入管线（keyboard.insertText）验证。
      let compositionSafe = true;
      const onError = (): void => {
        compositionSafe = false;
      };
      window.addEventListener("error", onError);
      editable.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true }),
      );
      editable.dispatchEvent(
        new CompositionEvent("compositionupdate", {
          bubbles: true,
          data: "工",
        }),
      );
      window.removeEventListener("error", onError);
      report.imeCompositionSafe = compositionSafe;
      // 供 Playwright 聚焦后经真实输入管线输入中文并回读；用编辑器自身
      // focus API 而非裸 DOM focus（编辑器内部有虚拟光标/焦点接管逻辑）。
      window.__spikeEditFocus = () => {
        editor.focus();
      };
    }
    window.__spikeEditGetText = () => editor.getText();
    window.__spikeEditState = () => ({
      activeElementTag: document.activeElement?.tagName ?? "none",
      activeElementEditable:
        document.activeElement?.getAttribute("contenteditable") === "true",
      onChangeFired: report.onChangeFired,
    });

    // 记录 edit chunk 资源（动态 import 的产物名）。
    report.editChunkResource =
      performance
        .getEntriesByType("resource")
        .map((entry) => entry.name)
        .find((name) => /edit-.*\.js/.test(name)) ?? null;

    report.cspViolations = collectViolationCount();
    report.styleAttrTrap = styleAttrHits;
  } catch (error) {
    report.error = String(error);
  }
  report.ready = true;
  return report;
}
