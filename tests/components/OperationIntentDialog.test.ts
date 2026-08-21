import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
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
