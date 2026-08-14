import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import ProjectsModule from "../../src/webview/features/projects/ProjectsModule.svelte";
import type { ProjectsSnapshot } from "../../src/protocol/workbenchProtocol";

/* v0.0.7 项目总览（§6.1）：只读展示与带明确项目目标的入口。 */

const snapshot: ProjectsSnapshot = {
  kind: "projects",
  projects: [
    {
      name: "EmApi",
      absolutePath: "/repo/code/EmApi",
      exists: true,
      binding: "parentWorkingCopy",
      bindingLabel: "位于上层工作副本",
      workingCopyRoot: "/repo/code",
      counts: { changes: 2, conflicts: 1, unversioned: 3 },
      current: true,
    },
    {
      name: "notes",
      absolutePath: "/repo/notes",
      exists: true,
      binding: "notSvn",
      bindingLabel: "非 SVN 目录",
      current: false,
    },
    {
      name: "gone",
      absolutePath: "/repo/gone",
      exists: false,
      binding: "missing",
      bindingLabel: "路径不存在",
      current: false,
    },
  ],
  generatedAt: "2026-08-13T10:00:00.000Z",
};

describe("项目总览（v0.0.7）", () => {
  it("展示项目名、归属分类、工作副本与聚合计数", () => {
    render(ProjectsModule, { snapshot, onAction: vi.fn() });
    expect(screen.getByText("EmApi")).toBeInTheDocument();
    expect(screen.getByText("当前项目")).toBeInTheDocument();
    expect(screen.getByText("位于上层工作副本")).toBeInTheDocument();
    expect(screen.getByText(/工作副本：\/repo\/code/)).toBeInTheDocument();
    expect(screen.getByText("变更 2")).toBeInTheDocument();
    expect(screen.getByText("冲突 1")).toBeInTheDocument();
    expect(screen.getByText("未版本化 3")).toBeInTheDocument();
  });

  it("行内动作携带明确项目目标，不合成跨项目范围", async () => {
    const onAction = vi.fn();
    render(ProjectsModule, { snapshot, onAction });
    const row = screen.getByText("EmApi").closest(".project-row")!;
    const buttons = Array.from(row.querySelectorAll("button"));
    await fireEvent.click(buttons[0]);
    expect(onAction).toHaveBeenCalledWith("projects/open-task", {
      projectRoot: "/repo/code/EmApi",
      task: "changes",
    });
    await fireEvent.click(buttons[1]);
    expect(onAction).toHaveBeenCalledWith("projects/open-task", {
      projectRoot: "/repo/code/EmApi",
      task: "commit",
    });
    await fireEvent.click(buttons[2]);
    expect(onAction).toHaveBeenCalledWith("projects/open-task", {
      projectRoot: "/repo/code/EmApi",
      task: "update",
    });
  });

  it("非 SVN 与路径不存在的项目禁用 SVN 任务并说明原因", () => {
    render(ProjectsModule, { snapshot, onAction: vi.fn() });
    const notesRow = screen.getByText("notes").closest(".project-row")!;
    expect(notesRow.querySelectorAll("button[disabled]")).toHaveLength(3);
    expect(notesRow.textContent).toContain("非 SVN 目录");
    const goneRow = screen.getByText("gone").closest(".project-row")!;
    expect(goneRow.textContent).toContain("路径不可用");
  });

  it("空工作区显示空态", () => {
    render(ProjectsModule, {
      snapshot: { kind: "projects", projects: [], generatedAt: "" },
      onAction: vi.fn(),
    });
    expect(screen.getByText("没有打开的工作区项目")).toBeInTheDocument();
  });
});
