/*
 * V018-B 虚拟化 spike 适配器生命周期单测（v0.1.8 规划 §4.2）。
 *
 * jsdom 无法构造真实 @pierre/diffs 组件，此处以 vi.mock 替换
 * VirtualizedFileDiff/Virtualizer，验证只读挂载（old/new 与 patch 双分支）、
 * observer 回收、幂等 dispose 与连续切换无增长；真实浏览器行为由
 * scripts/measure-v018-spike.js 采集（证据见 diffPerformancePolicy）。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const spikeMocks = vi.hoisted(() => ({
  renderProps: [] as Array<Record<string, unknown>>,
  instances: [] as Array<{ cleanedUp: boolean }>,
  virtualizers: [] as Array<{
    setupCalls: number;
    connectCalls: number;
    disconnectCalls: number;
    cleanedUp: boolean;
  }>,
  failRender: null as Error | null,
  errorInfos: [] as unknown[],
}));

vi.mock("@pierre/diffs", () => {
  class FakeVirtualizer {
    setupCalls = 0;
    connectCalls = 0;
    disconnectCalls = 0;
    cleanedUp = false;
    constructor() {
      spikeMocks.virtualizers.push(this);
    }
    setup(): void {
      this.setupCalls += 1;
    }
    connect(): () => void {
      this.connectCalls += 1;
      return () => undefined;
    }
    disconnect(): void {
      this.disconnectCalls += 1;
    }
    cleanUp(): void {
      this.cleanedUp = true;
    }
  }
  class FakeVirtualizedFileDiff {
    cleanedUp = false;
    constructor(readonly options: Record<string, unknown>) {}
    render(props: Record<string, unknown>): boolean {
      if (spikeMocks.failRender !== null) throw spikeMocks.failRender;
      spikeMocks.renderProps.push(props);
      spikeMocks.instances.push(this as { cleanedUp: boolean });
      const container = props.containerWrapper as HTMLElement;
      const marker = document.createElement("div");
      marker.appendChild(document.createElement("diffs-container"));
      container.appendChild(marker);
      return true;
    }
    getVirtualizedHeight(): number {
      return 1234;
    }
    cleanUp(): void {
      this.cleanedUp = true;
    }
  }
  return {
    VirtualizedFileDiff: FakeVirtualizedFileDiff,
    Virtualizer: FakeVirtualizer,
    parsePatchFiles: (text: string) =>
      text.includes("Index:") ? [{ files: [{ name: "src/a.ts" }] }] : [],
  };
});

import { mountV018VirtualizedSpike } from "../../src/webview/features/diff/v018VirtualizedSpikeAdapter";

function makeRoot(): HTMLElement {
  const root = document.createElement("div");
  root.style.height = "600px";
  document.body.appendChild(root);
  return root;
}

beforeEach(() => {
  document.body.replaceChildren();
  spikeMocks.renderProps.length = 0;
  spikeMocks.instances.length = 0;
  spikeMocks.virtualizers.length = 0;
  spikeMocks.failRender = null;
  spikeMocks.errorInfos.length = 0;
});

describe("mountV018VirtualizedSpike 只读挂载", () => {
  it("old/new 分支挂载并返回虚拟化高度", () => {
    const root = makeRoot();
    const handle = mountV018VirtualizedSpike(
      root,
      {
        relativePath: "src/a.ts",
        language: "typescript",
        oldContents: "a\n",
        newContents: "b\n",
      },
      { onError: (info) => spikeMocks.errorInfos.push(info) },
    );
    expect(handle).toBeDefined();
    expect(handle?.virtualizedHeight).toBe(1234);
    expect(spikeMocks.renderProps).toHaveLength(1);
    expect(spikeMocks.errorInfos).toHaveLength(0);
    handle?.dispose();
  });

  it("patch 分支解析后逐文件渲染（无编辑耦合）", () => {
    const root = makeRoot();
    const handle = mountV018VirtualizedSpike(
      root,
      {
        relativePath: "src/a.ts",
        language: "diff",
        oldContents: "",
        newContents: "",
        patch: "Index: src/a.ts\n@@ -1 +1 @@\n-a\n+b\n",
      },
      { onError: (info) => spikeMocks.errorInfos.push(info) },
    );
    expect(handle).toBeDefined();
    expect(spikeMocks.renderProps).toHaveLength(1);
    expect(spikeMocks.renderProps[0].fileDiff).toBeDefined();
    handle?.dispose();
  });

  it("空 patch 结构化失败且不残留半挂载", () => {
    const root = makeRoot();
    const handle = mountV018VirtualizedSpike(
      root,
      {
        relativePath: "src/a.ts",
        language: "diff",
        oldContents: "",
        newContents: "",
        patch: "空",
      },
      { onError: (info) => spikeMocks.errorInfos.push(info) },
    );
    expect(handle).toBeUndefined();
    expect(spikeMocks.errorInfos).toHaveLength(1);
    expect(root.childElementCount).toBe(0);
  });

  it("渲染异常经结构化错误上报并清理容器", () => {
    spikeMocks.failRender = new Error("boom");
    const root = makeRoot();
    const handle = mountV018VirtualizedSpike(
      root,
      {
        relativePath: "src/a.ts",
        language: "typescript",
        oldContents: "a\n",
        newContents: "b\n",
      },
      { onError: (info) => spikeMocks.errorInfos.push(info) },
    );
    expect(handle).toBeUndefined();
    expect(spikeMocks.errorInfos).toHaveLength(1);
    expect(root.childElementCount).toBe(0);
  });
});

describe("mountV018VirtualizedSpike 生命周期回收", () => {
  it("dispose 幂等：实例与虚拟化器各清理一次", () => {
    const root = makeRoot();
    const handle = mountV018VirtualizedSpike(
      root,
      {
        relativePath: "src/a.ts",
        language: "typescript",
        oldContents: "a\n",
        newContents: "b\n",
      },
      { onError: () => undefined },
    );
    handle?.dispose();
    handle?.dispose();
    handle?.dispose();
    expect(spikeMocks.instances).toHaveLength(1);
    expect(spikeMocks.instances[0].cleanedUp).toBe(true);
    expect(spikeMocks.virtualizers).toHaveLength(1);
    expect(spikeMocks.virtualizers[0].cleanedUp).toBe(true);
    expect(spikeMocks.virtualizers[0].disconnectCalls).toBe(1);
    expect(root.childElementCount).toBe(0);
  });

  it("连续切换 20 次无增长：挂载数 == 清理数，容器无残留", () => {
    for (let index = 0; index < 20; index += 1) {
      const root = document.createElement("div");
      document.body.appendChild(root);
      const handle = mountV018VirtualizedSpike(
        root,
        {
          relativePath: `src/file${index}.ts`,
          language: "typescript",
          oldContents: "a\n",
          newContents: "b\n",
        },
        { onError: () => undefined },
      );
      handle?.dispose();
      root.remove();
    }
    expect(spikeMocks.instances).toHaveLength(20);
    expect(spikeMocks.instances.every((instance) => instance.cleanedUp)).toBe(
      true,
    );
    expect(spikeMocks.virtualizers).toHaveLength(20);
    expect(
      spikeMocks.virtualizers.every((virtualizer) => virtualizer.cleanedUp),
    ).toBe(true);
    expect(document.body.childElementCount).toBe(0);
  });
});
