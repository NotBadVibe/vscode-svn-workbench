import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import type {
  WorkbenchScopeView,
  WorkbenchTaskId,
} from "../../src/protocol/workbenchProtocol";
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

function renderScopeBar(
  scope?: WorkbenchScopeView,
  taskId: WorkbenchTaskId = "changes/overview",
  onCopyText?: (text: string) => void,
) {
  return render(ScopeBar, {
    props: {
      scope,
      taskId,
      onRefresh: () => undefined,
      ...(onCopyText ? { onCopyText } : {}),
    },
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

/*
 * v0.1.5 V015-D1：数量口径——写操作（Commit/Update）显示「最终候选数」，
 * 普通浏览显示「范围数」，两者文案不混用。
 */
describe("范围栏数量口径（v0.1.5 V015-D1）", () => {
  const scoped: WorkbenchScopeView = { ...baseScope, candidateCount: 4 };

  it.each([["commit/compose"], ["update/preview"]] as Array<[WorkbenchTaskId]>)(
    "写操作任务 %s 显示最终候选数",
    (taskId) => {
      const { unmount } = renderScopeBar(scoped, taskId);
      expect(screen.getByText("最终候选数 4 个")).toBeInTheDocument();
      expect(screen.queryByText(/范围数/)).not.toBeInTheDocument();
      unmount();
    },
  );

  it.each([
    ["changes/overview"],
    ["history/revisions"],
    ["diff/working"],
  ] as Array<[WorkbenchTaskId]>)("浏览任务 %s 显示范围数", (taskId) => {
    const { unmount } = renderScopeBar(scoped, taskId);
    expect(screen.getByText("范围数 4 个")).toBeInTheDocument();
    expect(screen.queryByText(/最终候选/)).not.toBeInTheDocument();
    unmount();
  });

  it("无候选数时不显示数量行", () => {
    const { unmount } = renderScopeBar(baseScope, "update/preview");
    expect(screen.queryByText(/最终候选数/)).not.toBeInTheDocument();
    expect(screen.queryByText(/范围数/)).not.toBeInTheDocument();
    unmount();
  });
});

/*
 * v0.1.5 V015-D1：长路径键盘展开与复制——收起态 title 提供悬停 Tooltip；
 * 原生 button 保证键盘可展开，展开后逐条复制；Esc 关闭并返回触发点焦点。
 */
describe("范围栏长路径展开与复制（v0.1.5 V015-D1）", () => {
  const longPath =
    "packages/very-long-directory-name/src/features/deeply/nested/OrderList.tsx";

  it("收起态长路径带完整 title，展开后可逐条复制", async () => {
    const onCopyText = vi.fn();
    renderScopeBar(
      {
        ...baseScope,
        roots: [{ kind: "file", relativePath: toDisplayPath(longPath) }],
      },
      "changes/overview",
      onCopyText,
    );
    const chip = screen.getByRole("button", { name: longPath });
    // 原生 button：键盘 Enter/Space 可激活，不依赖鼠标。
    expect(chip instanceof HTMLButtonElement).toBe(true);
    expect(chip.getAttribute("aria-expanded")).toBe("false");
    // 截断收起态以 title 提供完整值（设计基线 §2.3）。
    expect(chip.getAttribute("title")).toBe(longPath);
    await fireEvent.click(chip);
    expect(chip.getAttribute("aria-expanded")).toBe("true");
    expect(
      screen.getByRole("region", { name: "操作范围清单" }),
    ).toBeInTheDocument();
    await fireEvent.click(
      screen.getByRole("button", { name: `复制范围路径 ${longPath}` }),
    );
    expect(onCopyText).toHaveBeenCalledWith(longPath);
  });

  it("多范围可复制全部路径，Esc 关闭并返回触发点焦点", async () => {
    const onCopyText = vi.fn();
    renderScopeBar(
      {
        ...baseScope,
        roots: [
          { kind: "folder", relativePath: toDisplayPath("src") },
          { kind: "folder", relativePath: toDisplayPath("docs") },
        ],
      },
      "changes/overview",
      onCopyText,
    );
    const chip = screen.getByRole("button", { name: "2 个操作范围" });
    chip.focus();
    await fireEvent.click(chip);
    expect(
      screen.getByRole("region", { name: "操作范围清单" }),
    ).toBeInTheDocument();
    await fireEvent.click(
      screen.getByRole("button", { name: "复制全部范围路径" }),
    );
    expect(onCopyText).toHaveBeenCalledWith("src\ndocs");
    await fireEvent.keyDown(chip, { key: "Escape" });
    expect(
      screen.queryByRole("region", { name: "操作范围清单" }),
    ).not.toBeInTheDocument();
    expect(document.activeElement).toBe(chip);
  });
});
