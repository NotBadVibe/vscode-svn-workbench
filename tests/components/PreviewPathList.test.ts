import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import PreviewPathList from "../../src/webview/components/list/PreviewPathList.svelte";

/*
 * v0.0.10 共享写操作预览路径清单：搜索、结果数量、复制整份清单、
 * 逐条复制与路径详情；清单不可勾选（确认页不能二次改变范围）。
 */

const paths = ["src/b.ts", "src/a.ts", "docs/说明.md"];

describe("PreviewPathList", () => {
  it("渲染全部路径并支持搜索过滤与数量播报", async () => {
    render(PreviewPathList, { paths, onAction: vi.fn() });
    expect(screen.getByText("3 条路径")).toBeInTheDocument();
    expect(screen.getByText("docs/说明.md")).toBeInTheDocument();
    const input = screen.getByRole("textbox", { name: "筛选预览路径清单" });
    await fireEvent.input(input, { target: { value: "src" } });
    expect(screen.getByText("2 条路径")).toBeInTheDocument();
    expect(screen.queryByText("docs/说明.md")).toBeNull();
    await fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
    expect(screen.getByText("3 条路径")).toBeInTheDocument();
  });

  it("复制清单发送当前筛选命中的路径", async () => {
    const onAction = vi.fn();
    render(PreviewPathList, { paths, onAction });
    await fireEvent.click(
      screen.getByRole("button", { name: "复制清单（3）" }),
    );
    expect(onAction).toHaveBeenCalledWith("copy-text", {
      // 清单按自然排序复制，便于与预览核对。
      text: "docs/说明.md\nsrc/a.ts\nsrc/b.ts",
    });
  });

  it("逐条复制与路径详情复用共享 Host 动作", async () => {
    const onAction = vi.fn();
    render(PreviewPathList, { paths, onAction });
    await fireEvent.click(
      screen.getByRole("button", { name: "复制路径 src/a.ts" }),
    );
    expect(onAction).toHaveBeenCalledWith("copy-text", {
      text: "src/a.ts",
    });
    await fireEvent.click(
      screen.getByRole("button", { name: "查看 src/a.ts 路径详情" }),
    );
    expect(onAction).toHaveBeenCalledWith("file/path-detail", {
      relativePath: "src/a.ts",
    });
  });

  it("Host 路径详情结果到达时展开并可关闭", async () => {
    const onAction = vi.fn();
    const { rerender } = render(PreviewPathList, {
      paths,
      onAction,
    });
    await fireEvent.click(
      screen.getByRole("button", { name: "查看 src/a.ts 路径详情" }),
    );
    rerender({
      paths,
      onAction,
      pathDetail: {
        relativePath: "src/a.ts",
        detail: {
          workingCopyRelativePath: "src/a.ts" as never,
          absolutePath: "/wc/src/a.ts" as never,
        },
      },
    });
    expect(screen.getByText("工作副本内路径")).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "关闭路径详情" }));
    expect(screen.queryByText("工作副本内路径")).toBeNull();
  });

  it("清单不提供任何选择控件（确认页不可二次勾选范围）", () => {
    render(PreviewPathList, { paths, onAction: vi.fn() });
    expect(document.querySelectorAll("input[type=checkbox]")).toHaveLength(0);
  });
});
