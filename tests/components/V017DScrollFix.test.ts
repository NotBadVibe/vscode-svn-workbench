import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import ActivityModule from "../../src/webview/features/activity/ActivityModule.svelte";
import type { ActivitySnapshot } from "../../src/protocol/workbenchProtocol";

/* V017-D 小视口、缩放与滚动修复（A3 滚动图驱动）：平台无关的 CSS/结构回归断言，不动 Host/协议。 */

const snapshot: ActivitySnapshot = {
  kind: "activity",
  generatedAt: new Date().toISOString(),
  records: [
    {
      id: "1",
      capturedAt: new Date().toISOString(),
      kind: "operation-execution",
      moduleId: "commit",
      taskId: "commit/compose",
      scopeHash: "hash-a",
      repositoryUuid: "uuid-1",
      scopeLabel: "提交 3 个文件",
      impactedCount: 3,
      previewSummary: "svn commit 3 files",
      result: "success",
      nextActions: [],
    },
  ],
};

function bulkActionBarBlock(css: string): string {
  const start = css.indexOf(".bulk-action-bar {");
  expect(start).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("}", start) + 1);
}

describe("V017-D 滚动修复回归", () => {
  it("P0-1：Activity 滚动选择器命中自身（ScrollArea class 透传到同一节点）", () => {
    render(ActivityModule, { snapshot, onAction: vi.fn() });
    const region = screen.getByRole("region", { name: "操作时间线" });
    // ScrollArea 把 class 透传到同一节点：必须同时带 scroll-region 与 activity-list，后代选择器永不命中。
    expect(region.classList.contains("scroll-region")).toBe(true);
    expect(region.classList.contains("activity-list")).toBe(true);
  });

  it("P0-2/P1-3/P1-4/P2-7：global.css 滚动关键修复落地", () => {
    const css = readFileSync("src/webview/styles/global.css", "utf8");

    // P0-2：workbench-content 预留 sticky 底栏空间，对齐 ScrollArea scroll-padding-block 模式。
    expect(css).toContain("scroll-padding-bottom: 72px;");

    // P1-3：BulkActionBar 改文档流尾置，不再声明 sticky（祖先 .table-card{overflow:hidden} 会截断吸附链）。
    expect(bulkActionBarBlock(css)).not.toContain("position: sticky");

    // P1-4：窄带 721～754px 不横向溢出——三组 grid 下限之和（+gap）须小于 721。
    expect(css).toContain("minmax(320px, 1.1fr) minmax(280px, 0.9fr)");
    expect(css).toContain("minmax(320px, 1.15fr) minmax(260px, 0.85fr)");
    expect(css).toContain("minmax(300px, 0.9fr) minmax(320px, 1.1fr)");

    // P2-7：Projects 页最小布局——module-card 补容器 padding。
    expect(css).toContain(".module-card {");
    expect(css).toContain(".projects-module {");
  });

  it("硬约束：根 Shell 仍 overflow:hidden，且无全局 overflow:auto !important", () => {
    const css = readFileSync("src/webview/styles/global.css", "utf8");
    expect(css).toContain(".workbench-shell {");
    // 两层滚动上限不破坏：workbench-shell / table-card / changelist-page 等 overflow 约束仍在。
    expect(css).toMatch(/\.workbench-shell \{[^}]*overflow:\s*hidden/);
    expect(css).not.toContain("overflow: auto !important");
    expect(css).not.toContain("overflow:auto !important");
  });
});
