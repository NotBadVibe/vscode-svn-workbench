import { fireEvent, render, screen, within } from "@testing-library/svelte";
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
      await screen.findByRole("button", { name: "确认更新（0）" }),
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

  it("V015-B2 骨架：同页 full 摘要至多 1 个，冲突摘要随 recovery 降级", () => {
    const { unmount } = render(UpdateModule, {
      snapshot: updateSnapshot({
        recovery: {
          category: "working-copy-locked",
          title: "工作副本被锁定",
          detectedAt: "2026-08-20T08:30:00.000Z",
          steps: ["确认没有其他 SVN 进程。"],
          requiresFreshPreview: true,
        },
        conflicts: { count: 2, paths: [] },
      }),
      onAction: vi.fn(),
    });
    // recovery 占 full，冲突摘要降级 compact，全页仍只有 1 个 full。
    expect(document.querySelectorAll(".task-summary--full")).toHaveLength(1);
    expect(screen.getByText("工作副本被锁定")).toBeInTheDocument();
    expect(screen.getByText("当前范围有 2 个冲突")).toBeInTheDocument();
    unmount();
    render(UpdateModule, {
      snapshot: updateSnapshot({
        conflicts: { count: 1, paths: [] },
      }),
      onAction: vi.fn(),
    });
    expect(document.querySelectorAll(".task-summary--full")).toHaveLength(1);
  });

  it("V015-B2 骨架：风险摘要为 compact 且 tone 随等级切换", () => {
    render(UpdateModule, {
      snapshot: updateSnapshot({
        preview: {
          token: "update-risk",
          canExecute: true,
          localCount: 4,
          remoteCount: 2,
          risk: "medium",
          overlapPaths: [],
          messages: [],
          commands: ['svn update --accept postpone "."'],
        },
      }),
      onAction: vi.fn(),
    });
    const summary = document.querySelector(
      ".task-summary--compact.task-summary--warning",
    );
    expect(summary).not.toBeNull();
    expect(summary).toHaveTextContent("中风险");
  });

  it("V015-B2 骨架：每个操作栏有且仅有 1 个 primary", () => {
    render(UpdateModule, {
      snapshot: updateSnapshot({
        conflicts: { count: 2, paths: [] },
        preview: {
          token: "update-bar",
          canExecute: true,
          localCount: 1,
          remoteCount: 2,
          risk: "low",
          overlapPaths: [],
          messages: [],
          commands: ['svn update --accept postpone "."'],
        },
      }),
      onAction: vi.fn(),
    });
    // 冲突栏 + 预览栏各唯一 primary（组件级唯一性，页面不虚构合并）。
    const toolbars = screen.getAllByRole("toolbar");
    expect(toolbars.length).toBe(2);
    for (const toolbar of toolbars) {
      expect(
        within(toolbar as HTMLElement).getAllByRole("button", {
          name: /处理 2 个冲突|确认更新（2）/,
        }),
      ).toHaveLength(1);
    }
    expect(
      screen.getByRole("button", { name: "重新检查" }),
    ).toBeInTheDocument();
  });

  it("V015-B2 结果出口：成功无冲突时查看本地修改与返回编辑透传", async () => {
    const onAction = vi.fn();
    render(UpdateModule, {
      snapshot: updateSnapshot({
        result: {
          ok: true,
          revision: "43",
          hasConflicts: false,
          message: "已更新到 r43",
        },
      }),
      onAction,
    });
    const resultRegion = screen.getByRole("status", {
      name: "任务结果与下一步",
    });
    await fireEvent.click(
      within(resultRegion).getByRole("button", { name: "查看本地修改" }),
    );
    expect(onAction).toHaveBeenCalledWith("open-module", {
      moduleId: "diff",
      taskId: "diff/working",
    });
    await fireEvent.click(
      within(resultRegion).getByRole("button", { name: "返回编辑" }),
    );
    expect(onAction).toHaveBeenCalledWith("open-module", {
      moduleId: "changes",
      taskId: "changes/overview",
    });
  });

  it("V015-B2 结果出口：成功有冲突时主动作透传处理冲突", async () => {
    const onAction = vi.fn();
    render(UpdateModule, {
      snapshot: updateSnapshot({
        conflicts: { count: 2, paths: [] },
        result: {
          ok: true,
          revision: "43",
          hasConflicts: true,
          message: "已更新到 r43",
        },
      }),
      onAction,
    });
    const resultRegion = screen.getByRole("status", {
      name: "任务结果与下一步",
    });
    await fireEvent.click(
      within(resultRegion).getByRole("button", { name: "处理 2 个冲突" }),
    );
    expect(onAction).toHaveBeenCalledWith("open-module", {
      moduleId: "conflicts",
      taskId: "conflicts/resolve",
    });
  });

  it("V015-B2 结果出口：失败给三要素与重试/复制诊断透传", async () => {
    const onAction = vi.fn();
    const message = "SVN 更新失败：connection refused。";
    render(UpdateModule, {
      snapshot: updateSnapshot({
        result: { ok: false, hasConflicts: false, message },
      }),
      onAction,
    });
    const resultRegion = screen.getByRole("alert", {
      name: "任务结果与下一步",
    });
    expect(resultRegion).toHaveTextContent(message);
    expect(resultRegion).toHaveTextContent(/不复用旧确认/);
    await fireEvent.click(
      within(resultRegion).getByRole("button", { name: "重新检查" }),
    );
    expect(onAction).toHaveBeenCalledWith("update/preview");
    await fireEvent.click(
      within(resultRegion).getByRole("button", { name: "复制诊断信息" }),
    );
    expect(onAction).toHaveBeenCalledWith("copy-text", { text: message });
  });

  it("V015-B2 结果出口：取消后说明重新采集不复用半完成结果", () => {
    render(UpdateModule, {
      snapshot: updateSnapshot({
        result: {
          ok: false,
          hasConflicts: false,
          message: "更新已取消；请重新检查工作副本状态。",
        },
      }),
      onAction: vi.fn(),
    });
    expect(screen.getByText(/不复用半完成结果/)).toBeInTheDocument();
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
