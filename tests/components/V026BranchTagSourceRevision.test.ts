import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import RepositoryModule from "../../src/webview/features/repository/RepositoryModule.svelte";
import type { RepositorySnapshot } from "../../src/protocol/workbenchProtocol";

function branchSnapshot(
  overrides: Partial<RepositorySnapshot["advanced"]> = {},
): RepositorySnapshot {
  return {
    kind: "repository",
    info: {
      name: "repo",
      revision: "40",
      url: "https://svn.example/r/trunk",
      repositoryRoot: "https://svn.example/r",
    },
    properties: { available: true, target: ".", items: [] },
    cleanup: { available: true, target: "." },
    advanced: {
      browser: {
        url: "https://svn.example/r/trunk",
        entries: [],
      },
      ...overrides,
    },
  };
}

describe("V026-R44 分支与标签显式源修订版本", () => {
  it("表单提供 HEAD/指定模式，默认以 HEAD 预览", async () => {
    const onAction = vi.fn();
    render(RepositoryModule, {
      snapshot: branchSnapshot(),
      taskId: "repository/tag",
      onAction,
    });
    expect(
      await screen.findByText(/源修订版本.*预览时固定/),
    ).toBeInTheDocument();
    const headRadio = screen.getByRole("radio", {
      name: /远端 HEAD/,
    });
    expect((headRadio as HTMLInputElement).checked).toBe(true);
    await fireEvent.click(screen.getByRole("button", { name: /生成创建标签/ }));
    expect(onAction).toHaveBeenCalledWith(
      "repository/preview-advanced",
      expect.objectContaining({
        operation: "tag",
        sourceRevision: "HEAD",
        sourceRevisionMode: "HEAD",
        source: expect.objectContaining({ revision: "HEAD" }),
      }),
    );
  });

  it("指定模式携带修订号，旧预览缺冻结字段即失效", async () => {
    const onAction = vi.fn();
    render(RepositoryModule, {
      snapshot: branchSnapshot({
        preview: {
          token: "old-no-rev",
          operation: "tag",
          title: "创建标签",
          commands: ["svn copy …"],
          details: ["源：https://svn.example/r/trunk"],
          issues: [],
          canExecute: true,
          destructive: false,
          sourceUrl: "https://svn.example/r/trunk",
          targetUrl: "https://svn.example/r/tags/v1",
        },
      }),
      taskId: "repository/tag",
      onAction,
    });
    // 旧预览无 sourceRevision/sourceResolvedRevision：按新契约视为失效。
    expect(await screen.findByText(/旧预览已自动作废/)).toBeInTheDocument();
    // 切换到指定模式并填写 r41 后预览携带指定版本。
    await fireEvent.click(screen.getByRole("radio", { name: /指定修订版本/ }));
    await fireEvent.input(screen.getByLabelText("指定源修订版本"), {
      target: { value: "r41" },
    });
    await fireEvent.click(screen.getByRole("button", { name: /生成创建标签/ }));
    expect(onAction).toHaveBeenCalledWith(
      "repository/preview-advanced",
      expect.objectContaining({
        sourceRevision: "r41",
        sourceRevisionMode: "revision",
      }),
    );
  });

  it("源修订版本变化作废旧预览，重查携带已确认版本", async () => {
    const onAction = vi.fn();
    const preview = {
      token: "tag-frozen",
      operation: "tag",
      title: "创建标签",
      commands: ["svn copy -r 42 …"],
      details: [
        "源：https://svn.example/r/trunk@r42（远端 HEAD 已固定为 r42，执行时不会跟随新的 HEAD）",
        "目标：https://svn.example/r/tags/v1",
        "当前工作副本无本地未提交修改；远端 copy 仍只复制源 URL@revision，不会夹带本地内容。",
      ],
      issues: ["目标 URL 已被占用，请更换后重新检查。"],
      canExecute: false,
      destructive: false,
      sourceUrl: "https://svn.example/r/trunk",
      targetUrl: "https://svn.example/r/tags/v1",
      sourceRevision: "HEAD",
      sourceResolvedRevision: "42",
      sourceRevisionMode: "HEAD",
    } as const;
    render(RepositoryModule, {
      snapshot: branchSnapshot({ preview: { ...preview } }),
      taskId: "repository/tag",
      onAction,
    });
    await fireEvent.click(
      screen.getByRole("button", { name: "确认执行创建标签" }),
    );
    await fireEvent.click(screen.getByRole("button", { name: "重新检查" }));
    expect(onAction).toHaveBeenCalledWith(
      "repository/preview-advanced",
      expect.objectContaining({
        operation: "tag",
        sourceRevision: "HEAD",
        sourceRevisionMode: "HEAD",
      }),
    );
    // 重查回填的源 URL 已剥离 @r42 固定后缀。
    const payload = onAction.mock.calls.find(
      (call) => call[0] === "repository/preview-advanced",
    )?.[1] as Record<string, unknown>;
    expect(payload.sourceUrl).toBe("https://svn.example/r/trunk");
  });
});
