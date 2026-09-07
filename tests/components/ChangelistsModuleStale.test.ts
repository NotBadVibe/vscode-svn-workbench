import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import ChangelistsModule from "../../src/webview/features/changelists/ChangelistsModule.svelte";
import type {
  ChangelistsSnapshot,
  WorkbenchFileView,
} from "../../src/protocol/workbenchProtocol";

/*
 * V020-R08 · 变更集方案更改后旧预览仍可确认（Webview 漂移只读防线）。
 * - 预览后改名、删应用栏文件、改组立即让旧预览只读并关闭执行入口；
 * - 显示「方案已更改」及重新预览入口，新预览产生新令牌（Host 回执）；
 * - 旧响应晚到不得恢复旧预览可执行状态。
 */

const groupFile = (
  path: string,
  overrides: Partial<WorkbenchFileView> = {},
): WorkbenchFileView => ({
  relativePath: path,
  selectionKey: `test-wc::${path}` as never,
  status: "modified",
  selection: "selected",
  ...overrides,
});

function baseSnapshot(): ChangelistsSnapshot {
  return {
    kind: "changelists",
    source: "local-rule",
    aiPrivacy: {
      model: "local",
      fileLimit: 120,
      data: "metadata",
      historyIncluded: false,
    },
    groups: [{ name: "ui", files: [groupFile("src/a.ts")] }],
    unassigned: [groupFile("src/b.ts")],
    suggestions: [],
    warnings: [],
  };
}

function withPreview(
  snapshot: ChangelistsSnapshot,
  preview: NonNullable<ChangelistsSnapshot["preview"]>,
): ChangelistsSnapshot {
  return { ...snapshot, preview };
}

function applyPreview(
  token: string,
  name: string,
  paths: string[],
): NonNullable<ChangelistsSnapshot["preview"]> {
  return {
    token,
    name,
    remove: false,
    paths,
    command: `svn changelist "${name}" ${paths.map((p) => `"${p}"`).join(" ")}`,
    canExecute: true,
    issues: [],
  };
}

function removePreview(
  token: string,
  paths: string[],
): NonNullable<ChangelistsSnapshot["preview"]> {
  return {
    token,
    remove: true,
    paths,
    command: `svn changelist --remove ${paths.map((p) => `"${p}"`).join(" ")}`,
    canExecute: true,
    issues: [],
  };
}

/** 按真实操作流建立“编辑器方案 == 预览方案”的可执行态。 */
async function buildExecutableApplyState(onAction: ReturnType<typeof vi.fn>) {
  await fireEvent.click(
    screen.getByRole("checkbox", { name: "选择 src/a.ts" }),
  );
  await fireEvent.click(
    screen.getByRole("button", { name: "加入应用栏（1）" }),
  );
  await fireEvent.input(screen.getByRole("textbox", { name: "变更集名称" }), {
    target: { value: "ui" },
  });
  await fireEvent.click(screen.getByRole("button", { name: "生成应用预览" }));
  expect(onAction).toHaveBeenCalledWith("changelist/preview-apply", {
    name: "ui",
    paths: ["src/a.ts"],
    remove: false,
  });
}

describe("ChangelistsModule 方案漂移只读（V020-R08）", () => {
  it("预览后改名立即只读并提供重新预览入口", async () => {
    const onAction = vi.fn();
    const { rerender } = render(ChangelistsModule, {
      snapshot: baseSnapshot(),
      onAction,
    });
    await buildExecutableApplyState(onAction);
    await rerender({
      snapshot: withPreview(
        baseSnapshot(),
        applyPreview("cl-1", "ui", ["src/a.ts"]),
      ),
      onAction,
    });
    // 新预览与编辑器一致时可执行。
    expect(
      screen.getByRole("button", { name: "确认应用变更集" }),
    ).not.toBeDisabled();

    // 预览后改名：旧预览只读，关闭执行入口。
    await fireEvent.input(screen.getByRole("textbox", { name: "变更集名称" }), {
      target: { value: "ui-renamed" },
    });
    expect(screen.getByText(/方案已更改/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "确认应用变更集" }),
    ).toBeDisabled();
    await fireEvent.click(screen.getByRole("button", { name: "重新生成预览" }));
    expect(onAction).toHaveBeenCalledWith("changelist/preview-apply", {
      name: "ui-renamed",
      paths: ["src/a.ts"],
      remove: false,
    });

    // 新预览（新令牌、新名称、精确路径）到达后恢复可执行。
    await rerender({
      snapshot: withPreview(
        baseSnapshot(),
        applyPreview("cl-2", "ui-renamed", ["src/a.ts"]),
      ),
      onAction,
    });
    expect(screen.queryByText(/方案已更改/)).toBeNull();
    const confirm = screen.getByRole("button", { name: "确认应用变更集" });
    expect(confirm).not.toBeDisabled();
    // 新预览展示新名称和精确路径（命令预览含新名称与新路径）。
    expect(screen.getAllByText(/ui-renamed/).length).toBeGreaterThan(0);
  });

  it("预览后从应用栏删文件立即只读，旧令牌不发出执行", async () => {
    const onAction = vi.fn();
    const { rerender } = render(ChangelistsModule, {
      snapshot: baseSnapshot(),
      onAction,
    });
    // 两个文件进入应用栏后预览。
    await fireEvent.click(
      screen.getByRole("checkbox", { name: "选择 src/a.ts" }),
    );
    await fireEvent.click(
      screen.getByRole("checkbox", { name: "选择 src/b.ts" }),
    );
    await fireEvent.click(
      screen.getByRole("button", { name: "加入应用栏（2）" }),
    );
    await fireEvent.input(screen.getByRole("textbox", { name: "变更集名称" }), {
      target: { value: "ui" },
    });
    await fireEvent.click(screen.getByRole("button", { name: "生成应用预览" }));
    await rerender({
      snapshot: withPreview(
        baseSnapshot(),
        applyPreview("cl-1", "ui", ["src/a.ts", "src/b.ts"]),
      ),
      onAction,
    });
    expect(
      screen.getByRole("button", { name: "确认应用变更集" }),
    ).not.toBeDisabled();

    // 删应用栏文件：旧预览只读。
    await fireEvent.click(
      screen.getByRole("button", { name: "移除 src/b.ts" }),
    );
    expect(screen.getByText(/方案已更改/)).toBeInTheDocument();
    const confirm = screen.getByRole("button", { name: "确认应用变更集" });
    expect(confirm).toBeDisabled();
    await fireEvent.click(confirm);
    expect(onAction).not.toHaveBeenCalledWith(
      "changelist/execute-apply",
      expect.anything(),
    );
  });

  it("旧响应晚到不得恢复旧预览可执行状态", async () => {
    const onAction = vi.fn();
    const { rerender } = render(ChangelistsModule, {
      snapshot: withPreview(
        baseSnapshot(),
        removePreview("cl-rm-1", ["src/a.ts"]),
      ),
      onAction,
    });
    expect(
      screen.getByRole("button", { name: "确认移出变更集" }),
    ).not.toBeDisabled();

    // 新预览到达成为最新。
    await rerender({
      snapshot: withPreview(
        baseSnapshot(),
        removePreview("cl-rm-2", ["src/a.ts"]),
      ),
      onAction,
    });
    expect(
      screen.getByRole("button", { name: "确认移出变更集" }),
    ).not.toBeDisabled();

    // 旧响应晚到（旧令牌快照重复到达）：仍只读，不恢复可执行。
    await rerender({
      snapshot: withPreview(
        baseSnapshot(),
        removePreview("cl-rm-1", ["src/a.ts"]),
      ),
      onAction,
    });
    expect(screen.getByText(/方案已更改/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "确认移出变更集" }),
    ).toBeDisabled();
  });

  it("确认时回传最终方案，执行失败恢复后无过期确认", async () => {
    const onAction = vi.fn();
    const { rerender } = render(ChangelistsModule, {
      snapshot: baseSnapshot(),
      onAction,
    });
    await buildExecutableApplyState(onAction);
    await rerender({
      snapshot: withPreview(
        baseSnapshot(),
        applyPreview("cl-1", "ui", ["src/a.ts"]),
      ),
      onAction,
    });
    await fireEvent.click(
      screen.getByRole("button", { name: "确认应用变更集" }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "应用变更集到 1 个文件",
    });
    const confirmInDialog = Array.from(dialog.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("确认应用变更集"),
    ) as HTMLElement;
    await fireEvent.click(confirmInDialog);
    // 确认携带最终方案，Host 可比对方案指纹。
    expect(onAction).toHaveBeenCalledWith("changelist/execute-apply", {
      previewToken: "cl-1",
      name: "ui",
      paths: ["src/a.ts"],
      remove: false,
    });

    // 执行失败后 Host 清除预览并下发无预览快照：无过期确认入口。
    await rerender({ snapshot: baseSnapshot(), onAction });
    expect(screen.queryByRole("button", { name: "确认应用变更集" })).toBeNull();
    expect(screen.queryByText(/方案已更改/)).toBeNull();
  });
});
