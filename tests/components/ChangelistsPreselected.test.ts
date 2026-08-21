import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import ChangelistsModule from "../../src/webview/features/changelists/ChangelistsModule.svelte";
import type { ChangelistsSnapshot } from "../../src/protocol/workbenchProtocol";

function snapshotWithPreselected(
  overrides: Partial<ChangelistsSnapshot> = {},
): ChangelistsSnapshot {
  return {
    kind: "changelists",
    source: "local-rule",
    aiPrivacy: {
      model: "local",
      fileLimit: 120,
      data: "metadata",
      historyIncluded: false,
    },
    groups: [
      {
        name: "ui",
        files: [
          {
            relativePath: "src/a.ts",
            selectionKey: "test-wc::src/a.ts" as never,
            status: "modified",
            selection: "selected",
          },
          {
            relativePath: "src/b.ts",
            selectionKey: "test-wc::src/b.ts" as never,
            status: "modified",
            selection: "selected",
          },
        ],
      },
    ],
    unassigned: [
      {
        relativePath: "src/c.ts",
        selectionKey: "test-wc::src/c.ts" as never,
        status: "modified",
        selection: "selected",
      },
    ],
    suggestions: [],
    warnings: [],
    preselected: { count: 2, paths: ["src/a.ts", "src/b.ts"] },
    preselectedFeedback: undefined,
    ...overrides,
  } as ChangelistsSnapshot;
}

describe("ChangelistsModule 会话共享选择（v0.0.13）", () => {
  it("preselected 存在且本地无选择时展示“已带入 N 个文件”且数量路径一致", async () => {
    render(ChangelistsModule, {
      snapshot: snapshotWithPreselected(),
      onAction: vi.fn(),
    });
    expect(screen.getByText(/已带入 2 个文件/)).toBeInTheDocument();
    expect(screen.getByText(/src\/a\.ts/)).toBeInTheDocument();
    // 自动带入：首次渲染时本地无选择，应把 preselected 的 2 个带入选中（不覆盖已有选择为 0 时）
    // 选中后“移出变更集”按钮应统计到带入的路径
    // 由于带入是异步 effect，等待下一 tick
    await new Promise((r) => setTimeout(r, 0));
    // 带入后，选中集合应包含 a.ts 与 b.ts（通过复选框 checked 验证）
    expect(
      (
        screen.getByRole("checkbox", {
          name: "选择 src/a.ts",
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);
    expect(
      (
        screen.getByRole("checkbox", {
          name: "选择 src/b.ts",
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);
  });

  it("preselectedFeedback 警告展示（筛选不扩大）", () => {
    render(ChangelistsModule, {
      snapshot: snapshotWithPreselected({
        preselectedFeedback:
          "筛选变化：1 个已带入路径已失效，已提示不静默扩大选择。",
      }),
      onAction: vi.fn(),
    });
    expect(
      screen.getByText(/筛选变化：1 个已带入路径已失效/),
    ).toBeInTheDocument();
  });

  it("已有本地选择时不覆盖", async () => {
    // 先渲染一次带本地选择的快照，再收到 preselected 不应覆盖
    const onAction = vi.fn();
    const { rerender } = render(ChangelistsModule, {
      snapshot: snapshotWithPreselected({
        preselected: { count: 1, paths: ["src/a.ts"] },
      }),
      onAction,
    });
    // 手动选择 c.ts
    await fireEvent.click(
      screen.getByRole("checkbox", { name: "选择 src/c.ts" }),
    );
    expect(
      (
        screen.getByRole("checkbox", {
          name: "选择 src/c.ts",
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);
    // 再次收到 preselected 为 b.ts，但已有选择，不应被覆盖
    await rerender({
      snapshot: snapshotWithPreselected({
        preselected: { count: 1, paths: ["src/b.ts"] },
      }),
      onAction,
    } as never);
    // c.ts 仍保持选中
    expect(
      (
        screen.getByRole("checkbox", {
          name: "选择 src/c.ts",
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);
    // b.ts 不应自动被加入（因为已有选择）
    // 由于 b.ts 之前未选中，且已有选择，rerender 后不应自动选中 b.ts
    expect(
      (
        screen.getByRole("checkbox", {
          name: "选择 src/b.ts",
        }) as HTMLInputElement
      ).checked,
    ).toBe(false);
  });

  it("数量与路径完全一致：preselected 的 count 与 paths 长度一致", () => {
    const snap = snapshotWithPreselected({
      preselected: { count: 3, paths: ["src/a.ts", "src/b.ts", "src/c.ts"] },
    });
    render(ChangelistsModule, { snapshot: snap, onAction: vi.fn() });
    expect(snap.preselected!.count).toBe(snap.preselected!.paths.length);
    expect(screen.getByText(/已带入 3 个文件/)).toBeInTheDocument();
  });
});
