import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it } from "vitest";
import OnboardingStrip from "../../src/webview/components/ui/OnboardingStrip.svelte";
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
