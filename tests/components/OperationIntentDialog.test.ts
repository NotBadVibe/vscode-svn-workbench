import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/svelte";
import OperationIntentDialog from "../../src/webview/components/operation/OperationIntentDialog.svelte";
import type { OperationIntentView } from "../../src/operation/operationIntent";

const baseIntent: OperationIntentView = {
  token: "tok-1",
  kind: "commit",
  title: "提交 2 个文件",
  summary: "提交 2 个文件 · 范围：项目 A",
  paths: ["src/a.ts", "src/b.ts"],
  scopeHash: "s1",
  candidateHash: "c1",
  repositoryUuid: "r1",
  createdAt: new Date().toISOString(),
  canExecute: true,
  issues: [],
  commands: ["svn commit src/a.ts src/b.ts -F msg.txt"],
};

describe("OperationIntentDialog", () => {
  it("可搜索/复制的影响清单（复用 PreviewPathList）", async () => {
    const onAction = vi.fn();
    render(OperationIntentDialog, {
      props: {
        intent: baseIntent,
        open: true,
        confirmLabel: "确认提交（2）",
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
        onAction,
        pathDetail: undefined,
      },
    });
    // 标题包含数量（标题与摘要均含数量前缀，分别校验）
    expect(screen.getAllByText("提交 2 个文件").length).toBeGreaterThanOrEqual(
      1,
    );
    expect(
      screen.getByText("提交 2 个文件 · 范围：项目 A"),
    ).toBeInTheDocument();
    // 影响清单可搜索：PreviewPathList 提供搜索框
    expect(screen.getByPlaceholderText("路径…")).toBeInTheDocument();
    // 复制清单按钮
    expect(screen.getByText("复制清单（2）")).toBeInTheDocument();
    // 命令预览
    expect(screen.getByText(/svn commit/)).toBeInTheDocument();
  });

  it("失效时只读、确认禁用", async () => {
    const staleIntent: OperationIntentView = {
      ...baseIntent,
      stale: true,
      canExecute: false,
      issues: ["范围已变化，请重新预览。"],
    };
    render(OperationIntentDialog, {
      props: {
        intent: staleIntent,
        open: true,
        confirmLabel: "确认提交（2）",
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
        onAction: vi.fn(),
      },
    });
    expect(screen.getByText("已失效（只读）")).toBeInTheDocument();
    expect(screen.getByText(/范围已变化/)).toBeInTheDocument();
    const confirm = screen.getByText(/确认提交（2）/);
    expect(confirm).toBeDisabled();
  });

  it("Esc 与取消按钮触发 onCancel，确认按钮携带 token", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const { container } = render(OperationIntentDialog, {
      props: {
        intent: baseIntent,
        open: true,
        confirmLabel: "确认提交（2）",
        onConfirm,
        onCancel,
        onAction: vi.fn(),
      },
    });
    const dialog = container.querySelector("dialog") as HTMLDialogElement;
    expect(dialog).toBeInTheDocument();
    // 点击取消
    await fireEvent.click(screen.getByText("取消"));
    expect(onCancel).toHaveBeenCalled();
    // 点击确认（非失效）
    await fireEvent.click(screen.getByText("确认提交（2）"));
    expect(onConfirm).toHaveBeenCalledWith("tok-1");
    // Esc 应触发取消（dialog keydown）
    await fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  // v0.1.5 V015-C1：九要素补齐行（范围 / 修订版本 / 可恢复性，有则展示）
  it("展示范围、修订版本与可恢复性行；缺省时不行", async () => {
    const fullIntent: OperationIntentView = {
      ...baseIntent,
      scopeText: "项目 A",
      revision: "r42",
      recoverability: "覆盖工作副本文件，原内容不可自动恢复。",
    };
    const { unmount } = render(OperationIntentDialog, {
      props: {
        intent: fullIntent,
        open: true,
        confirmLabel: "确认提交（2）",
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
        onAction: vi.fn(),
      },
    });
    expect(screen.getByText("范围：")).toBeInTheDocument();
    expect(screen.getByText("项目 A")).toBeInTheDocument();
    expect(screen.getByText("修订版本：")).toBeInTheDocument();
    expect(screen.getByText("r42")).toBeInTheDocument();
    expect(screen.getByText("可恢复性：")).toBeInTheDocument();
    expect(
      screen.getByText("覆盖工作副本文件，原内容不可自动恢复。"),
    ).toBeInTheDocument();
    unmount();
    // 缺省时不行，不虚构
    render(OperationIntentDialog, {
      props: {
        intent: baseIntent,
        open: true,
        confirmLabel: "确认提交（2）",
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
        onAction: vi.fn(),
      },
    });
    expect(screen.queryByText("范围：")).not.toBeInTheDocument();
    expect(screen.queryByText("修订版本：")).not.toBeInTheDocument();
    expect(screen.queryByText("可恢复性：")).not.toBeInTheDocument();
  });

  // v0.1.5 V015-C1：stale/不可执行态的“重新检查”次级按钮
  it("失效时显示重新检查并透传页面动作；可执行时不显示", async () => {
    const onRecheck = vi.fn();
    const onConfirm = vi.fn();
    const staleIntent: OperationIntentView = {
      ...baseIntent,
      stale: true,
      canExecute: false,
      issues: ["范围已变化，请重新预览。"],
    };
    const { unmount } = render(OperationIntentDialog, {
      props: {
        intent: staleIntent,
        open: true,
        confirmLabel: "确认提交（2）",
        onConfirm,
        onCancel: vi.fn(),
        onAction: vi.fn(),
        recheckLabel: "重新检查",
        onRecheck,
      },
    });
    // 未 open 的 <dialog> 不在可访问树中，role 查询需 hidden:true（setup polyfill 约定）。
    const recheck = screen.getByRole("button", {
      name: "重新检查",
      hidden: true,
    });
    expect(recheck).toBeInTheDocument();
    expect(recheck).not.toBeDisabled();
    await fireEvent.click(recheck);
    expect(onRecheck).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    unmount();
    // 未提供 onRecheck 时不渲染
    render(OperationIntentDialog, {
      props: {
        intent: staleIntent,
        open: true,
        confirmLabel: "确认提交（2）",
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
        onAction: vi.fn(),
        recheckLabel: "重新检查",
      },
    });
    expect(
      screen.queryByRole("button", { name: "重新检查", hidden: true }),
    ).not.toBeInTheDocument();
  });

  it("可执行意向单不显示重新检查按钮", async () => {
    render(OperationIntentDialog, {
      props: {
        intent: baseIntent,
        open: true,
        confirmLabel: "确认提交（2）",
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
        onAction: vi.fn(),
        recheckLabel: "重新检查",
        onRecheck: vi.fn(),
      },
    });
    expect(
      screen.queryByRole("button", { name: "重新检查", hidden: true }),
    ).not.toBeInTheDocument();
  });

  // v0.1.5 V015-C1：Tab 焦点循环回归锁定
  it("Tab 在对话框内首尾循环", async () => {
    const { container } = render(OperationIntentDialog, {
      props: {
        intent: baseIntent,
        open: true,
        confirmLabel: "确认提交（2）",
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
        onAction: vi.fn(),
      },
    });
    const dialog = container.querySelector("dialog") as HTMLDialogElement;
    // 等待 showModal effect 落定：未 open 的 dialog 内元素为 inert，焦点行为与真实不一致。
    await waitFor(() => expect(dialog).toHaveAttribute("open"));
    // 首个可聚焦元素是影响清单搜索框（PreviewPathList 底座），末尾是确认按钮
    const search = screen.getByPlaceholderText("路径…");
    const confirm = screen.getByRole("button", { name: /确认提交/ });
    // 真实按键事件的目标是焦点元素（冒泡到 dialog 处理器），测试同样从焦点元素派发。
    // 焦点在末尾确认按钮时 Tab 回到首个可聚焦元素
    confirm.focus();
    await fireEvent.keyDown(confirm, { key: "Tab" });
    expect(document.activeElement).toBe(search);
    // Shift+Tab 在首个元素时回到末尾确认按钮
    search.focus();
    await fireEvent.keyDown(search, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(confirm);
  });

  it("IME 候选阶段 Enter 不触发确认", async () => {
    const onConfirm = vi.fn();
    const { container } = render(OperationIntentDialog, {
      props: {
        intent: baseIntent,
        open: true,
        confirmLabel: "确认提交（2）",
        onConfirm,
        onCancel: vi.fn(),
        onAction: vi.fn(),
      },
    });
    const dialog = container.querySelector("dialog") as HTMLDialogElement;
    // 模拟 compositionstart 后 Enter
    await fireEvent.compositionStart(dialog);
    await fireEvent.keyDown(dialog, { key: "Enter" });
    expect(onConfirm).not.toHaveBeenCalled();
    await fireEvent.compositionEnd(dialog);
  });
});
