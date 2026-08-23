import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import UpdateModule from "../../src/webview/features/update/UpdateModule.svelte";
import type { UpdateSnapshot } from "../../src/protocol/workbenchProtocol";

/*
 * v0.0.17 批次 A/B：Update 独立模块——预览令牌契约、常驻冲突 CTA（U-06）、
 * 空态三要素（C-02）。
 */

function updateSnapshot(
  overrides: Partial<UpdateSnapshot> = {},
): UpdateSnapshot {
  return {
    kind: "update",
    info: { name: "repo", revision: "5" },
    conflicts: { count: 0, paths: [] },
    ...overrides,
  };
}

describe("UpdateModule", () => {
  it("更新执行只携带 Host 签发的预览令牌", async () => {
    const onAction = vi.fn();
    render(UpdateModule, {
      snapshot: updateSnapshot({
        preview: {
          token: "update-1",
          canExecute: true,
          localCount: 1,
          remoteCount: 0,
          risk: "low",
          overlapPaths: [],
          messages: ["没有明显风险。"],
          commands: ['svn update --accept postpone "."'],
        },
      }),
      onAction,
    });
    await fireEvent.click(
      await screen.findByRole("button", { name: "确认更新当前范围" }),
    );
    // v0.0.14：确认更新先打开通用操作意向单对话框。
    const dialog = screen.getByRole("dialog", {
      name: "更新 0 个远端变更",
    });
    const confirmInDialog = Array.from(dialog.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("确认更新（0）"),
    ) as HTMLElement;
    await fireEvent.click(confirmInDialog);
    expect(onAction).toHaveBeenCalledWith("update/execute", {
      previewToken: "update-1",
    });
  });

  it("常驻冲突 CTA：显示数量、可展开清单并直达冲突模块", async () => {
    const onAction = vi.fn();
    render(UpdateModule, {
      snapshot: updateSnapshot({
        conflicts: {
          count: 2,
          paths: ["src/conflict/OrderList.tsx", "src/conflict/README.md"],
        },
        result: {
          ok: true,
          revision: "43",
          hasConflicts: true,
          message: "已更新到 r43",
        },
      }),
      onAction,
    });
    expect(screen.getByText("当前范围有 2 个冲突")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "处理 2 个冲突" }),
    ).toBeInTheDocument();
    // 冲突文件清单可展开核对。
    await fireEvent.click(screen.getByText(/查看冲突文件（2）/));
    expect(screen.getByText("src/conflict/OrderList.tsx")).toBeInTheDocument();
    // 直达冲突模块：范围不变，只打开目标模块。
    await fireEvent.click(
      screen.getByRole("button", { name: "处理 2 个冲突" }),
    );
    expect(onAction).toHaveBeenCalledWith("open-module", {
      moduleId: "conflicts",
      taskId: "conflicts/resolve",
    });
  });

  it("冲突采集失败时如实提示且不展示 CTA", () => {
    render(UpdateModule, {
      snapshot: updateSnapshot({
        conflicts: { count: 0, paths: [], error: "svn status 失败" },
      }),
      onAction: vi.fn(),
    });
    expect(screen.getByText(/未能采集当前范围冲突状态/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /处理 \d+ 个冲突/ }),
    ).toBeNull();
  });

  it("空态回答发生了什么、是否正常与现在能做什么（C-02）", async () => {
    const onAction = vi.fn();
    render(UpdateModule, { snapshot: updateSnapshot(), onAction });
    expect(screen.getByText("尚未生成更新预览")).toBeInTheDocument();
    expect(screen.getByText(/这是正常状态/)).toBeInTheDocument();
    expect(screen.getByText(/不会修改工作副本/)).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "生成更新预览" }));
    expect(onAction).toHaveBeenCalledWith("update/preview");
  });

  it("recovery 状态提供进入清理与恢复的入口", async () => {
    const onAction = vi.fn();
    render(UpdateModule, {
      snapshot: updateSnapshot({
        recovery: {
          category: "working-copy-locked",
          title: "工作副本被锁定",
          detectedAt: "2026-08-20T08:30:00.000Z",
          steps: ["确认没有其他 SVN 进程。"],
          requiresFreshPreview: true,
        },
      }),
      onAction,
    });
    expect(screen.getByText(/工作副本被锁定/)).toBeInTheDocument();
    await fireEvent.click(
      screen.getByRole("button", { name: "进入清理与恢复" }),
    );
    expect(onAction).toHaveBeenCalledWith("open-module", {
      moduleId: "repository",
      taskId: "repository/recovery",
    });
  });
});
