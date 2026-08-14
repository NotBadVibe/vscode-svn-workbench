import { render, screen } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import type { WorkbenchScopeView } from "../../src/protocol/workbenchProtocol";
import ScopeBar from "../../src/webview/components/svn/ScopeBar.svelte";
import { toDisplayPath } from "../../src/scope/pathBrands";

/*
 * v0.0.7 范围栏项目上下文：多根工作区与上层工作副本场景下项目名是
 * 主显示，工作副本名退为次级；项目根回退时必须提示“尚未设置项目根”，
 * 不得静默把工作副本根当作项目。
 */

const baseScope: WorkbenchScopeView = {
  repositoryName: "code",
  roots: [{ kind: "folder", relativePath: toDisplayPath("src") }],
  source: "explorer",
};

function renderScopeBar(scope?: WorkbenchScopeView) {
  return render(ScopeBar, {
    props: { scope, taskId: "changes/overview", onRefresh: () => undefined },
  });
}

describe("范围栏项目显示（v0.0.7）", () => {
  it("有项目上下文时项目名为主显示，工作副本名为次级", () => {
    renderScopeBar({
      ...baseScope,
      projectName: "bchd-front-Dev3.0",
      projectWorkingCopyRelativePath: toDisplayPath(
        "2024Project/bchd-front-Dev3.0",
      ),
    });
    const eyebrow = document.querySelector(".eyebrow");
    expect(eyebrow?.textContent).toBe("bchd-front-Dev3.0");
    expect(screen.getByText("工作副本：code")).toBeInTheDocument();
  });

  it("项目名与工作副本名重合时不重复显示次级信息", () => {
    renderScopeBar({
      ...baseScope,
      repositoryName: "app",
      projectName: "app",
    });
    expect(screen.queryByText("工作副本：app")).not.toBeInTheDocument();
  });

  it("项目根回退为工作副本根时明确提示，不静默猜测", () => {
    renderScopeBar({
      ...baseScope,
      projectName: "code",
      projectRootIsFallback: true,
    });
    expect(
      screen.getByText("尚未设置项目根，当前按工作副本根显示"),
    ).toBeInTheDocument();
  });

  it("无项目上下文时回退显示工作副本名，不出现项目提示", () => {
    renderScopeBar(baseScope);
    const eyebrow = document.querySelector(".eyebrow");
    expect(eyebrow?.textContent).toBe("code");
    expect(screen.queryByText(/尚未设置项目根/)).not.toBeInTheDocument();
  });

  it("缺少范围信息时显示工作台占位名", () => {
    renderScopeBar(undefined);
    const eyebrow = document.querySelector(".eyebrow");
    expect(eyebrow?.textContent).toBe("SVN 工作台");
  });
});
