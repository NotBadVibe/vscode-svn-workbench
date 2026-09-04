/*
 * V018-B 虚拟化 spike 浏览器测量入口（非生产，仅 vite dev 测量用）。
 *
 * 查询参数：?fixture=<diffFixtureId>&mode=filediff|virtualized。
 * 同一 fixture、同一 dev 服务器下挂载当前 FileDiff（经 mountDiffView）
 * 或 VirtualizedFileDiff（经 mountV018VirtualizedSpike），只读，
 * 测量首个 plain render / 高亮就绪 / 滚动 / 内存 / DOM 规模，
 * 完成后写入 window.__v018Spike 供 Playwright 采集。
 */
/* global document, window, requestAnimationFrame */
import { FileDiff } from "@pierre/diffs";
import {
  generateDiffFixture,
  parseDiffFixtureId,
} from "../../../mocks/diffFixtures";
import {
  installDiffCspCompatibilityShim,
  observeDiffContainer,
  observeDiffShadowRoot,
} from "../cspCompatObserver";
import { mapToDiffLanguage } from "../diffLanguage";
import {
  mountV018VirtualizedSpike,
  type V018VirtualizedSpikeHandle,
} from "../v018VirtualizedSpikeAdapter";
import type { DiffViewMountHandle } from "../diffViewAdapter";

installDiffCspCompatibilityShim();

interface V018SpikeResult {
  fixture: string;
  mode: string;
  scriptStartMs: number;
  firstVisibleMs: number | null;
  highlightReadyMs: number | null;
  scrollMs: number | null;
  scrollable: boolean;
  scrollHeight: number | null;
  heapBytesAfterGc: number | null;
  domNodes: number;
  virtualizedHeight: number | null;
  error: string | null;
}

declare global {
  interface Window {
    __v018Spike?: V018SpikeResult;
  }
}

const scriptStartMs = performance.now();

function fail(fixture: string, mode: string, error: string): void {
  const status = document.querySelector("#spike-status");
  if (status) status.textContent = `失败：${error}`;
  window.__v018Spike = {
    fixture,
    mode,
    scriptStartMs,
    firstVisibleMs: null,
    highlightReadyMs: null,
    scrollMs: null,
    scrollable: false,
    scrollHeight: null,
    heapBytesAfterGc: null,
    domNodes: document.querySelectorAll("*").length,
    virtualizedHeight: null,
    error,
  };
}

/** rAF 轮询直到条件成立（超时抛错，不用固定 sleep）。 */
function waitForCondition(
  condition: () => boolean,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = performance.now() + timeoutMs;
    const tick = (): void => {
      try {
        if (condition()) {
          resolve();
          return;
        }
      } catch (error) {
        reject(error);
        return;
      }
      if (performance.now() > deadline) {
        reject(new Error("等待差异渲染超时"));
        return;
      }
      requestAnimationFrame(tick);
    };
    tick();
  });
}

async function main(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const fixture = params.get("fixture") ?? "";
  const mode = params.get("mode") ?? "";
  const spec = parseDiffFixtureId(fixture);
  if (!spec) {
    fail(fixture, mode, `非法 fixture：${fixture}`);
    return;
  }
  if (mode !== "filediff" && mode !== "virtualized") {
    fail(fixture, mode, `非法 mode：${mode}`);
    return;
  }
  const generated = generateDiffFixture(spec);
  const scrollRoot = document.querySelector<HTMLElement>("#spike-scroll");
  if (!scrollRoot) {
    fail(fixture, mode, "缺少滚动容器");
    return;
  }
  const language = mapToDiffLanguage(spec.language, `file.${spec.language}`);

  let filediffHandle: DiffViewMountHandle | undefined;
  let spikeHandle: V018VirtualizedSpikeHandle | undefined;
  // filediff 分支的 observer 随本次测量释放（与生产适配器同顺序）。
  const filediffObservers: { disconnect(): void }[] = [];
  let filediffInstance: FileDiff | undefined;
  let mountError: string | null = null;

  try {
    if (mode === "virtualized") {
      spikeHandle = mountV018VirtualizedSpike(
        scrollRoot,
        {
          relativePath: `spike/${fixture}.ts`,
          language,
          oldContents: generated.original,
          newContents: generated.modified,
        },
        {
          onError: (info) => {
            mountError = info.what;
          },
        },
      );
      if (!spikeHandle) {
        fail(fixture, mode, mountError ?? "虚拟化挂载失败");
        return;
      }
    } else {
      const content = document.createElement("div");
      scrollRoot.appendChild(content);
      filediffObservers.push(observeDiffContainer(content));
      const before = new Set(content.querySelectorAll("diffs-container"));
      const instance = new FileDiff({
        theme: { dark: "pierre-dark", light: "pierre-light" },
        themeType: "system",
        diffStyle: "split",
        expandUnchanged: false,
        overflow: "scroll",
        diffIndicators: "classic",
        disableErrorHandling: true,
      } as const);
      filediffInstance = instance;
      instance.render({
        oldFile: {
          name: `spike/${fixture}.ts`,
          contents: generated.original,
          lang: language,
        },
        newFile: {
          name: `spike/${fixture}.ts`,
          contents: generated.modified,
          lang: language,
        },
        containerWrapper: content,
      });
      for (const element of Array.from(
        content.querySelectorAll("diffs-container"),
      )) {
        if (!before.has(element) && element.shadowRoot != null) {
          filediffObservers.push(observeDiffShadowRoot(element.shadowRoot));
        }
      }
      filediffHandle = {
        container: content,
        dispose: () => {
          for (const observer of filediffObservers) observer.disconnect();
          filediffObservers.length = 0;
          try {
            filediffInstance?.cleanUp();
          } catch {
            // 测量页释放失败不阻断结果上报。
          }
          filediffInstance = undefined;
          scrollRoot.replaceChildren();
        },
      };
    }

    await waitForCondition(
      () =>
        Array.from(scrollRoot.querySelectorAll("diffs-container")).some(
          (container) =>
            container.shadowRoot != null &&
            (container.shadowRoot.textContent ?? "").trim().length > 0,
        ),
      30000,
    );
    const firstVisibleMs = performance.now() - scriptStartMs;

    const highlightStarted = performance.now();
    let highlightReadyMs: number | null = null;
    try {
      await waitForCondition(
        () =>
          Array.from(scrollRoot.querySelectorAll("diffs-container")).some(
            (container) =>
              container.shadowRoot?.querySelector(
                "[style], [data-hl-style]",
              ) !== null,
          ),
        15000,
      );
      highlightReadyMs = performance.now() - highlightStarted;
    } catch {
      highlightReadyMs = null;
    }

    const scrollOutcome = await new Promise<{
      scrollMs: number | null;
      scrollable: boolean;
      scrollHeight: number | null;
    }>((resolve) => {
      const begun = performance.now();
      scrollRoot.scrollTop = scrollRoot.scrollHeight;
      requestAnimationFrame(() =>
        requestAnimationFrame(() =>
          resolve({
            scrollMs: performance.now() - begun,
            scrollable: scrollRoot.scrollHeight > scrollRoot.clientHeight + 4,
            scrollHeight: scrollRoot.scrollHeight,
          }),
        ),
      );
    });

    if (typeof (globalThis as { gc?: () => void }).gc === "function") {
      (globalThis as { gc?: () => void }).gc?.();
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    const heapBytesAfterGc =
      (performance as { memory?: { usedJSHeapSize: number } }).memory
        ?.usedJSHeapSize ?? null;
    const domNodes = document.querySelectorAll("*").length;
    const status = document.querySelector("#spike-status");
    if (status) {
      status.textContent = `完成：${fixture} ${mode} 首屏 ${Math.round(firstVisibleMs)}ms`;
    }
    window.__v018Spike = {
      fixture,
      mode,
      scriptStartMs,
      firstVisibleMs: Math.round(firstVisibleMs * 100) / 100,
      highlightReadyMs:
        highlightReadyMs === null
          ? null
          : Math.round(highlightReadyMs * 100) / 100,
      scrollMs:
        scrollOutcome.scrollMs === null
          ? null
          : Math.round(scrollOutcome.scrollMs * 100) / 100,
      scrollable: scrollOutcome.scrollable,
      scrollHeight: scrollOutcome.scrollHeight,
      heapBytesAfterGc,
      domNodes,
      virtualizedHeight: spikeHandle?.virtualizedHeight ?? null,
      error: null,
    };
  } catch (error) {
    fail(fixture, mode, error instanceof Error ? error.message : String(error));
  } finally {
    // 连续切换无增长验证由调用方多次建页承担；此处保留实例供复核，
    // 仅释放 filediff 分支的临时 observer 引用（实例本身保留）。
    void filediffHandle;
  }
}

void main();
