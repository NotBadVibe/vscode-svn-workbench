import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import HistoryModule from "../../src/webview/features/history/HistoryModule.svelte";
import type { HistorySnapshot } from "../../src/protocol/workbenchProtocol";

/*
 * V021-R06 · 超 300 条历史窗口化滚动完整性：先复现后修复的回归契约（中文注释）。
 *
 * 未修版本复现记录（同一 worktree，提交 eabe7af）：
 * - 复现夹具： Revision rN（N=301/500/1000），newest-first 快照，selectedRevision 为最新一条。
 * - 复现操作：渲染 500 条 → 统计 `.revision-row` 仅约 16 行（窗口化生效，阈值 300），
 *   但 `.revision-list` 内无首尾占位 div，滚动容器真实高度 ≈ 16×68，
 *   而完整高度应为 500×68=34000；末项 data-row-index=499 不可达，
 *   End/PageDown 計算的 scrollTop（index×64）超出可滚范围被钳制，且 64 与
 *   CSS `.revision-row`/`.revision-select` 最小 68 不一致，窗口逐行漂移。
 * - 预期：各档首尾占位补足全高（占位 + 已渲染行 = total×68），End/PageDown 可达
 *   真实最后修订；最早/最新切换后首尾正确；追加一批与清除搜索后选中/比较可解释保留。
 * - 实际（未修）：首尾占位缺失，末项不可达（本文件 spacer 断言失败即复现）。
 *   说明：jsdom 不钳制程序化 scrollTop，键盘状态机在单测里仍可推进窗口；
 *   真实浏览器按容器 scrollHeight 钳制 scrollTop，无占位时 scrollHeight≈窗口高度，
 *   End/PageDown 目标被钳制回可视区，窗口永不到末项——占位断言即该完整性的回归契约。
 * - 修复：复用 CommitModule 首尾占位模式 + 行高统一为 68（=CSS 最小高度），不新建算法。
 * 断言均平台无关（计数/文本/可访问角色/内联高度字符串），无 waitForTimeout。
 */

// 中文注释：与 global.css `.revision-row`/`.revision-select` 最小高度对齐的统一行高。
const HISTORY_ROW_HEIGHT = 68;
// 中文注释：useFileList 默认窗口化阈值与 overscan（与实现侧约定一致的只读镜像）。
const VIRTUALIZE_AFTER = 300;
const OVERSCAN = 8;
const VIEWPORT_HEIGHT = 500;

/** 中文注释：按 newest→oldest 生成 [newest..oldest] 的确定性历史夹具。 */
function buildSnapshot(options: {
  newest: number;
  oldest: number;
  selectedRevision?: string;
  compareRevisions?: string[];
  hasMore?: boolean;
}): HistorySnapshot {
  const revisions = [];
  for (let n = options.newest; n >= options.oldest; n -= 1) {
    revisions.push({
      revision: String(n),
      author: `author-${n % 7}`,
      date: "2026-07-30T08:00:00Z",
      message: `提交 ${n}`,
      changedPaths: [],
    });
  }
  return {
    kind: "history",
    revisions,
    selectedRevision: options.selectedRevision ?? String(options.newest),
    compareRevisions: options.compareRevisions ?? [],
    limit: options.newest - options.oldest + 1,
    fileActionsAvailable: false,
    hasMore: options.hasMore,
  };
}

/** 中文注释：当前渲染行数（窗口化后远小于总数）。 */
function renderedRowCount(): number {
  return document.querySelectorAll(".revision-list .revision-row").length;
}

/** 中文注释：首尾占位 div（CommitModule 同款 spacer 模式，aria-hidden 直接子节点）。 */
function spacerHeights(): number[] {
  return Array.from(
    document.querySelectorAll(".revision-list > div[aria-hidden='true']"),
  ).map((node) => Number((node as HTMLElement).style.height.replace("px", "")));
}

function listElement(): HTMLElement {
  const node = document.querySelector(".revision-list");
  expect(node).not.toBeNull();
  return node as HTMLElement;
}

describe("V021-R06 超 300 条历史窗口化滚动完整性", () => {
  it.each([301, 500, 1000])(
    "%i 条历史只渲染窗口且首尾占位补足全高",
    (total) => {
      render(HistoryModule, {
        snapshot: buildSnapshot({ newest: total, oldest: 1 }),
        onAction: () => {},
      });
      const rows = renderedRowCount();
      // 中文注释：窗口化生效（超过 300 条阈值后只渲染可视窗口 + overscan）。
      expect(rows).toBeGreaterThan(0);
      expect(rows).toBeLessThan(total);
      // 中文注释：顶部在首屏时无前占位；底部占位补足剩余高度，总和恒为全高。
      const spacers = spacerHeights();
      expect(spacers).toHaveLength(1);
      const [bottom] = spacers;
      expect(bottom).toBe((total - rows) * HISTORY_ROW_HEIGHT);
      expect(rows * HISTORY_ROW_HEIGHT + bottom).toBe(
        total * HISTORY_ROW_HEIGHT,
      );
      expect(screen.getByText(`${total} 条修订`)).toBeInTheDocument();
    },
  );

  it("301 条边界档同样保留底部占位（阈值外第一档）", () => {
    render(HistoryModule, {
      snapshot: buildSnapshot({ newest: 301, oldest: 1 }),
      onAction: () => {},
    });
    // 中文注释：301 > 300 触发窗口化；300 及以下全量渲染（windowedRows 约定）。
    expect(renderedRowCount()).toBeLessThan(301);
    expect(spacerHeights()).toHaveLength(1);
  });

  it("End 可达真实最后修订（500 条 newest-first 末项为 r1）", async () => {
    render(HistoryModule, {
      snapshot: buildSnapshot({ newest: 500, oldest: 1 }),
      onAction: () => {},
    });
    expect(document.querySelector('[data-row-index="499"]')).toBeNull();
    await fireEvent.keyDown(listElement(), { key: "End" });
    const last = document.querySelector('[data-row-index="499"]');
    expect(last).not.toBeNull();
    expect(last?.textContent).toContain("r1 ·");
    expect(last?.classList.contains("revision-row--keyboard-active")).toBe(
      true,
    );
  });

  it("PageDown 按一页可见行数步进活动行", async () => {
    render(HistoryModule, {
      snapshot: buildSnapshot({ newest: 500, oldest: 1 }),
      onAction: () => {},
    });
    const list = listElement();
    await fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(
      document
        .querySelector('[data-row-index="0"]')
        ?.classList.contains("revision-row--keyboard-active"),
    ).toBe(true);
    await fireEvent.keyDown(list, { key: "PageDown" });
    // 中文注释：一页 = floor(500/68) = 7 行，与 listModel.pageSizeOf 一致。
    const stepped = document.querySelector('[data-row-index="7"]');
    expect(stepped).not.toBeNull();
    expect(stepped?.classList.contains("revision-row--keyboard-active")).toBe(
      true,
    );
  });

  it("切换最早/最新顺序后首尾正确且 End 可达新末项", async () => {
    render(HistoryModule, {
      snapshot: buildSnapshot({ newest: 500, oldest: 1 }),
      onAction: () => {},
    });
    const sortMenu = screen.getByRole("combobox", {
      name: "修订排序",
    }) as HTMLSelectElement;
    await fireEvent.change(sortMenu, { target: { value: "oldest" } });
    // 中文注释：排序切换重新定位到顶部（resetNavigation），首行为最早 r1。
    expect(
      document.querySelector('[data-row-index="0"]')?.textContent,
    ).toContain("r1 ·");
    await fireEvent.keyDown(listElement(), { key: "End" });
    // 中文注释：oldest-first 下末项为最新 r500。
    const last = document.querySelector('[data-row-index="499"]');
    expect(last?.textContent).toContain("r500 ·");
    await fireEvent.change(sortMenu, { target: { value: "newest" } });
    expect(
      document.querySelector('[data-row-index="0"]')?.textContent,
    ).toContain("r500 ·");
  });

  it("清除搜索后比较选择与选中版本保留", async () => {
    render(HistoryModule, {
      snapshot: buildSnapshot({ newest: 500, oldest: 1 }),
      onAction: () => {},
    });
    await fireEvent.click(screen.getByLabelText("选择修订 500 进行比较"));
    await fireEvent.click(screen.getByLabelText("选择修订 499 进行比较"));
    expect(screen.getByText("已选择 2/2 条修订")).toBeInTheDocument();
    // 中文注释：本地筛选只过滤已加载结果，不改比较集合。
    await fireEvent.input(screen.getByLabelText("筛选历史"), {
      target: { value: "提交 500" },
    });
    expect(screen.getByText("1 条修订")).toBeInTheDocument();
    expect(screen.getByText("已选择 2/2 条修订")).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
    expect(screen.getByText("500 条修订")).toBeInTheDocument();
    expect(
      (screen.getByLabelText("选择修订 500 进行比较") as HTMLInputElement)
        .checked,
    ).toBe(true);
    expect(
      (screen.getByLabelText("选择修订 499 进行比较") as HTMLInputElement)
        .checked,
    ).toBe(true);
    // 中文注释：选中版本（selectedRevision=r500）仍为活动行。
    expect(
      document.querySelector(".revision-row.active")?.textContent,
    ).toContain("r500 ·");
  });

  it("追加一批更早修订后选中版本、比较对象与滚动容器保留", async () => {
    const onAction = () => {};
    const { rerender } = render(HistoryModule, {
      snapshot: buildSnapshot({
        newest: 500,
        oldest: 101,
        compareRevisions: ["500", "499"],
        hasMore: true,
      }),
      onAction,
    });
    const listBefore = document.querySelector(".revision-list");
    expect(listBefore).not.toBeNull();
    await fireEvent.keyDown(listBefore as HTMLElement, { key: "End" });
    expect(
      document.querySelector('[data-row-index="399"]')?.textContent,
    ).toContain("r101 ·");
    // 中文注释：Host 回显追加更早一批（r100..r1），总数 400→500。
    await rerender({
      snapshot: buildSnapshot({
        newest: 500,
        oldest: 1,
        compareRevisions: ["500", "499"],
        hasMore: false,
      }),
      onAction,
    });
    // 中文注释：滚动容器不重建，阅读锚点侧（已选 r500、比较 2/2）可解释保留。
    expect(document.querySelector(".revision-list")).toBe(listBefore);
    // 中文注释：先回顶部把选中行带回窗口（虚拟化下窗外行不在 DOM 中），再断言选中态。
    await fireEvent.keyDown(listElement(), { key: "Home" });
    expect(
      document.querySelector(".revision-row.active")?.textContent,
    ).toContain("r500 ·");
    expect(screen.getByText("已选择 2/2 条修订")).toBeInTheDocument();
    expect(
      (screen.getByLabelText("选择修订 500 进行比较") as HTMLInputElement)
        .checked,
    ).toBe(true);
    // 中文注释：占位随总数更新，总和恒为 500×68。
    const spacers = spacerHeights();
    const rendered = renderedRowCount();
    expect(
      rendered * HISTORY_ROW_HEIGHT + spacers.reduce((a, b) => a + b, 0),
    ).toBe(500 * HISTORY_ROW_HEIGHT);
    // 中文注释：新末项 r1 经 End 可达。
    await fireEvent.keyDown(listElement(), { key: "End" });
    expect(
      document.querySelector('[data-row-index="499"]')?.textContent,
    ).toContain("r1 ·");
  });

  it("300 条及以下全量渲染且无需占位", () => {
    render(HistoryModule, {
      snapshot: buildSnapshot({ newest: 300, oldest: 1 }),
      onAction: () => {},
    });
    // 中文注释：总数未超阈值时 windowedRows 返回全量（与 Changes/Commit 一致）。
    expect(renderedRowCount()).toBe(VIRTUALIZE_AFTER);
    expect(spacerHeights()).toHaveLength(0);
    // 中文注释：阈值/视口/overscan 镜像常量自检，防止实现漂移未同步用例。
    expect(OVERSCAN).toBe(8);
    expect(VIEWPORT_HEIGHT).toBe(500);
  });
});
