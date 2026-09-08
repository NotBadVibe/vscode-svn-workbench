import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OnboardingStrip, {
  RECOVERY_TARGETS,
} from "../../src/webview/components/ui/OnboardingStrip.svelte";
import { onboarding } from "../../src/webview/app/onboarding.svelte";

/*
 * v0.0.18 批次 A（C-03）：引导条交互——步骤展示、跳过、最后一步只读结束；
 * 完成/跳过后引导条完全隐藏（重新打开走命令面板 svnWorkbench.openGuide）。
 */

describe("OnboardingStrip（v0.0.18）", () => {
  beforeEach(() => {
    onboarding.restart();
  });

  it("展示当前步骤与进度；可跳过且跳过后无痕隐藏", async () => {
    render(OnboardingStrip);
    expect(
      screen.getByText(/引导步骤 1\/5：从右键打开一个范围/),
    ).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "跳过引导" }));
    expect(screen.queryByRole("region", { name: "新手引导" })).toBeNull();
  });

  it("推进到第 2 步由事件驱动展示新说明", async () => {
    render(OnboardingStrip);
    onboarding.recordStep("open-workbench");
    expect(
      await screen.findByText(/引导步骤 2\/5：查看范围与本地修改/),
    ).toBeInTheDocument();
  });

  it("最后一步只提供完成引导，不出现任何执行提交的按钮", async () => {
    onboarding.recordStep("open-workbench");
    onboarding.recordStep("view-changes");
    onboarding.recordStep("select-files");
    onboarding.recordStep("preview-commit");
    render(OnboardingStrip);
    expect(
      screen.getByText(/引导步骤 5\/5：最终确认前结束/),
    ).toBeInTheDocument();
    const finish = screen.getByRole("button", {
      name: "完成引导（未执行任何提交）",
    });
    expect(finish).toBeInTheDocument();
    await fireEvent.click(finish);
    // 完成后无痕隐藏；全程没有出现执行提交的动作。
    expect(screen.queryByRole("region", { name: "新手引导" })).toBeNull();
    expect(screen.queryByRole("button", { name: /确认提交/ })).toBeNull();
  });

  it("五态恢复目标只含只读模块导航，不含任何写操作", () => {
    // 断言平台无关：只检查模块/任务标识，不涉及路径与平台。
    const readonlyModules = ["history", "update", "conflicts", "diagnostics"];
    for (const targets of Object.values(RECOVERY_TARGETS)) {
      for (const target of targets) {
        expect(readonlyModules).toContain(target.moduleId);
        expect(target.taskId).not.toMatch(
          /execute|commit\/|resolve\/|revert|delete/,
        );
      }
    }
    expect(RECOVERY_TARGETS.modified).toEqual([]);
    expect(RECOVERY_TARGETS.clean.length).toBeGreaterThan(0);
    expect(RECOVERY_TARGETS.conflict.length).toBeGreaterThan(0);
    expect(RECOVERY_TARGETS["non-svn"].length).toBeGreaterThan(0);
    expect(RECOVERY_TARGETS["cli-missing"].length).toBeGreaterThan(0);
  });

  it("干净分支：解释正常状态并可直接完成，无须选择与预览", async () => {
    onboarding.recordStep("open-workbench");
    onboarding.recordStep("view-changes");
    onboarding.setBranch("clean");
    const onNavigate = vi.fn();
    render(OnboardingStrip, { branch: "clean", onNavigate });
    expect(
      await screen.findByText(/引导步骤 3\/3：最终确认前结束/),
    ).toBeInTheDocument();
    expect(screen.getByText(/这是正常状态/)).toBeInTheDocument();
    // 恢复按钮只做只读导航。
    await fireEvent.click(screen.getByRole("button", { name: "查看历史" }));
    expect(onNavigate).toHaveBeenCalledWith(
      expect.objectContaining({ moduleId: "history" }),
    );
    await fireEvent.click(screen.getByRole("button", { name: "检查远端更新" }));
    expect(onNavigate).toHaveBeenCalledWith(
      expect.objectContaining({ moduleId: "update" }),
    );
    // 完成引导：只翻转引导状态，不触发任何导航与写操作。
    const navigateCalls = onNavigate.mock.calls.length;
    await fireEvent.click(
      screen.getByRole("button", { name: "完成引导（未执行任何提交）" }),
    );
    expect(onNavigate.mock.calls.length).toBe(navigateCalls);
    expect(screen.queryByRole("region", { name: "新手引导" })).toBeNull();
  });

  it("冲突分支：先处理冲突，恢复按钮直达冲突模块", async () => {
    onboarding.recordStep("open-workbench");
    onboarding.recordStep("view-changes");
    const onNavigate = vi.fn();
    render(OnboardingStrip, { branch: "conflict", onNavigate });
    expect(
      await screen.findByText(/引导步骤 3\/3：最终确认前结束/),
    ).toBeInTheDocument();
    expect(screen.getByText(/冲突解决前不能提交/)).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "处理冲突" }));
    expect(onNavigate).toHaveBeenCalledWith(
      expect.objectContaining({ moduleId: "conflicts" }),
    );
  });

  it("非 SVN/CLI 缺失分支：首步后即有明确恢复与完成路径", async () => {
    onboarding.recordStep("open-workbench");
    const onNavigate = vi.fn();
    render(OnboardingStrip, { branch: "non-svn", onNavigate });
    expect(
      await screen.findByText(/引导步骤 2\/2：最终确认前结束/),
    ).toBeInTheDocument();
    expect(screen.getByText(/不是 SVN 工作副本/)).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "打开环境诊断" }));
    expect(onNavigate).toHaveBeenCalledWith(
      expect.objectContaining({ moduleId: "diagnostics" }),
    );
  });

  it("store restart 后可从头再次渲染引导", async () => {
    render(OnboardingStrip);
    onboarding.recordStep("open-workbench");
    onboarding.skip();
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "新手引导" })).toBeNull(),
    );
    onboarding.restart();
    expect(
      await screen.findByText(/引导步骤 1\/5：从右键打开一个范围/),
    ).toBeInTheDocument();
  });
});
