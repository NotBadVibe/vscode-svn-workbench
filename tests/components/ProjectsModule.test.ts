import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import ProjectsModule from "../../src/webview/features/projects/ProjectsModule.svelte";
import type {
  ProjectOverviewItem,
  ProjectsSnapshot,
} from "../../src/protocol/workbenchProtocol";

/*
 * v0.0.7 项目总览（§6.1）：只读展示与带明确项目目标的入口。
 * V024-R39：统计状态显式建模（ready 全 0/ error 无 counts / stale 保留旧值），
 * 单项重试只发目标项目，旧序号快照晚到不覆盖新状态。
 * V024-R40：搜索、只看有修改、冲突优先排序、冲突数直达该项目冲突任务、
 * 完整路径复制。
 * V024-R42：空/非 SVN/路径丢失各态均有可执行的下一步。
 */

function item(
  overrides: Partial<ProjectOverviewItem> & { absolutePath: string },
): ProjectOverviewItem {
  return {
    name: "app",
    exists: true,
    binding: "workingCopyRoot",
    bindingLabel: "独立工作副本根",
    workingCopyRoot: "/repo/app",
    current: false,
    statsStatus: "ready",
    ...overrides,
  } as ProjectOverviewItem;
}

function snapshot(projects: ProjectOverviewItem[], seq = 1): ProjectsSnapshot {
  return {
    kind: "projects",
    projects,
    generatedAt: "2026-08-13T10:00:00.000Z",
    statsSeq: seq,
  };
}

const baseline = snapshot([
  item({
    name: "EmApi",
    absolutePath: "/repo/code/EmApi",
    binding: "parentWorkingCopy",
    bindingLabel: "位于上层工作副本",
    workingCopyRoot: "/repo/code",
    counts: { changes: 2, conflicts: 1, unversioned: 3 },
    statsUpdatedAt: "2026-08-13T09:00:00.000Z",
    current: true,
  }),
  item({
    name: "notes",
    absolutePath: "/repo/notes",
    binding: "notSvn",
    bindingLabel: "非 SVN 目录",
    workingCopyRoot: undefined,
  }),
  item({
    name: "gone",
    absolutePath: "/repo/gone",
    exists: false,
    binding: "missing",
    bindingLabel: "路径不存在",
    workingCopyRoot: undefined,
  }),
]);

describe("项目总览（v0.0.7）", () => {
  it("展示项目名、归属分类、工作副本与聚合计数", () => {
    render(ProjectsModule, { snapshot: baseline, onAction: vi.fn() });
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
    render(ProjectsModule, { snapshot: baseline, onAction });
    const row = screen.getByText("EmApi").closest(".project-row")!;
    const within = (label: string) =>
      Array.from(row.querySelectorAll("button")).find(
        (button) => button.textContent === label,
      )!;
    await fireEvent.click(within("打开变更"));
    expect(onAction).toHaveBeenCalledWith("projects/open-task", {
      projectRoot: "/repo/code/EmApi",
      task: "changes",
    });
    await fireEvent.click(within("提交"));
    expect(onAction).toHaveBeenCalledWith("projects/open-task", {
      projectRoot: "/repo/code/EmApi",
      task: "commit",
    });
    await fireEvent.click(within("更新"));
    expect(onAction).toHaveBeenCalledWith("projects/open-task", {
      projectRoot: "/repo/code/EmApi",
      task: "update",
    });
  });

  it("非 SVN 与路径不存在的项目禁用 SVN 任务并说明原因", () => {
    render(ProjectsModule, { snapshot: baseline, onAction: vi.fn() });
    const notesRow = screen.getByText("notes").closest(".project-row")!;
    expect(
      Array.from(
        notesRow.querySelectorAll(".project-row__actions button"),
      ).every((button) => (button as HTMLButtonElement).disabled),
    ).toBe(true);
    expect(notesRow.textContent).toContain("非 SVN 目录");
    const goneRow = screen.getByText("gone").closest(".project-row")!;
    expect(goneRow.textContent).toContain("路径不可用");
  });

  it("空工作区显示空态并提供打开文件夹与环境诊断", async () => {
    const onAction = vi.fn();
    render(ProjectsModule, {
      snapshot: snapshot([], 2),
      onAction,
    });
    expect(screen.getByText("没有打开的工作区项目")).toBeInTheDocument();
    await fireEvent.click(screen.getByText("打开文件夹"));
    expect(onAction).toHaveBeenCalledWith("diagnostics/open-folder", {});
    await fireEvent.click(screen.getByText("查看环境诊断"));
    expect(onAction).toHaveBeenCalledWith("open-module", {
      moduleId: "diagnostics",
      taskId: "diagnostics/environment",
    });
  });
});

describe("项目总览统计状态（V024-R39）", () => {
  it("零修改明确显示 0，不与失败等同", () => {
    render(ProjectsModule, {
      snapshot: snapshot([
        item({
          name: "clean",
          absolutePath: "/repo/clean",
          counts: { changes: 0, conflicts: 0, unversioned: 0 },
          statsUpdatedAt: "2026-08-13T09:00:00.000Z",
        }),
      ]),
      onAction: vi.fn(),
    });
    expect(screen.getByText("变更 0")).toBeInTheDocument();
    expect(screen.queryByText(/统计失败/)).not.toBeInTheDocument();
  });

  it("失败项目原地显示原因与重试，不阻塞其他项目", async () => {
    const onAction = vi.fn();
    render(ProjectsModule, {
      snapshot: snapshot([
        item({
          name: "broken",
          absolutePath: "/repo/broken",
          statsStatus: "error",
          statsError: "工作副本统计失败：超时",
        }),
        item({
          name: "healthy",
          absolutePath: "/repo/healthy",
          counts: { changes: 1, conflicts: 0, unversioned: 0 },
          statsUpdatedAt: "2026-08-13T09:00:00.000Z",
        }),
      ]),
      onAction,
    });
    const brokenRow = screen.getByText("broken").closest(".project-row")!;
    expect(brokenRow.textContent).toContain("统计失败");
    expect(brokenRow.textContent).toContain("超时");
    await fireEvent.click(screen.getByText("重试统计"));
    expect(onAction).toHaveBeenCalledWith("projects/retry-stats", {
      projectRoot: "/repo/broken",
    });
    // 其他项目仍显示可信统计。
    expect(screen.getByText("healthy")).toBeInTheDocument();
    expect(screen.getByText("变更 1")).toBeInTheDocument();
  });

  it("重试后按钮进入等待态并可跳转诊断", async () => {
    const onAction = vi.fn();
    render(ProjectsModule, {
      snapshot: snapshot([
        item({
          name: "broken",
          absolutePath: "/repo/broken",
          statsStatus: "error",
          statsError: "工作副本统计失败",
        }),
      ]),
      onAction,
    });
    await fireEvent.click(screen.getByText("重试统计"));
    expect(screen.getByText("正在重新统计…")).toBeInTheDocument();
    await fireEvent.click(screen.getByText("查看环境诊断"));
    expect(onAction).toHaveBeenCalledWith("open-module", {
      moduleId: "diagnostics",
      taskId: "diagnostics/environment",
    });
  });

  it("过期项目保留上一成功值并说明原因与时间", () => {
    render(ProjectsModule, {
      snapshot: snapshot([
        item({
          name: "stale-app",
          absolutePath: "/repo/stale-app",
          counts: { changes: 4, conflicts: 2, unversioned: 1 },
          statsStatus: "stale",
          statsError: "工作副本统计失败：连接重置",
          statsUpdatedAt: "2026-08-12T10:00:00.000Z",
          staleReason: "工作副本统计失败，已保留上次成功值。",
        }),
      ]),
      onAction: vi.fn(),
    });
    expect(screen.getByText("变更 4")).toBeInTheDocument();
    expect(screen.getByText("冲突 2")).toBeInTheDocument();
    expect(screen.getByText("已过期")).toBeInTheDocument();
    expect(screen.getByText(/上次成功于/)).toBeInTheDocument();
    expect(
      screen.getByText(/工作副本统计失败，已保留上次成功值/),
    ).toBeInTheDocument();
  });

  it("旧序号快照晚到不覆盖新状态", () => {
    const rendered = render(ProjectsModule, {
      snapshot: snapshot(
        [
          item({
            name: "v8",
            absolutePath: "/repo/app",
            counts: { changes: 8, conflicts: 0, unversioned: 0 },
            statsUpdatedAt: "2026-08-13T09:00:00.000Z",
          }),
        ],
        8,
      ),
      onAction: vi.fn(),
    });
    expect(screen.getByText("v8")).toBeInTheDocument();
    rendered.rerender({
      snapshot: snapshot(
        [
          item({
            name: "v6",
            absolutePath: "/repo/app",
            counts: { changes: 6, conflicts: 0, unversioned: 0 },
            statsUpdatedAt: "2026-08-13T08:00:00.000Z",
          }),
        ],
        6,
      ),
      onAction: vi.fn(),
    });
    expect(screen.getByText("v8")).toBeInTheDocument();
    expect(screen.queryByText("v6")).not.toBeInTheDocument();
  });
});

describe("项目总览筛选直达（V024-R40）", () => {
  const multi = () =>
    snapshot(
      [
        item({
          name: "app",
          absolutePath: "/repo/a/app",
          counts: { changes: 1, conflicts: 3, unversioned: 0 },
          statsUpdatedAt: "2026-08-13T09:00:00.000Z",
        }),
        item({
          name: "app",
          absolutePath: "/repo/b/app",
          counts: { changes: 5, conflicts: 0, unversioned: 0 },
          statsUpdatedAt: "2026-08-13T09:00:00.000Z",
        }),
        item({
          name: "clean",
          absolutePath: "/repo/clean",
          counts: { changes: 0, conflicts: 0, unversioned: 0 },
          statsUpdatedAt: "2026-08-13T09:00:00.000Z",
        }),
        item({
          name: "broken",
          absolutePath: "/repo/broken",
          statsStatus: "error",
          statsError: "工作副本统计失败",
        }),
      ],
      3,
    );

  it("同名项目以路径消歧，按路径搜索可定位", async () => {
    render(ProjectsModule, { snapshot: multi(), onAction: vi.fn() });
    expect(screen.getAllByText("app")).toHaveLength(2);
    const search = screen.getByLabelText("按项目名称或路径搜索项目");
    await fireEvent.input(search, { target: { value: "/repo/b/app" } });
    expect(screen.getByText("/repo/b/app")).toBeInTheDocument();
    expect(screen.queryByText("/repo/a/app")).not.toBeInTheDocument();
    expect(screen.getByText("1 个项目")).toBeInTheDocument();
  });

  it("只看有修改隐藏干净项目但保留失败项目（未知不隐藏）", async () => {
    render(ProjectsModule, { snapshot: multi(), onAction: vi.fn() });
    await fireEvent.click(screen.getByRole("checkbox", { name: "只看有修改" }));
    expect(screen.queryByText("clean")).not.toBeInTheDocument();
    expect(screen.getByText("broken")).toBeInTheDocument();
  });

  it("默认冲突优先排序，失败统计不当作 0 置底并保留标记", () => {
    render(ProjectsModule, { snapshot: multi(), onAction: vi.fn() });
    const rows = Array.from(document.querySelectorAll(".project-row")).map(
      (row) => row.querySelector(".project-path")?.textContent,
    );
    expect(rows[0]).toBe("/repo/a/app");
    expect(rows[rows.length - 1]).toBe("/repo/broken");
    expect(screen.getByText(/统计失败/)).toBeInTheDocument();
  });

  it("点击某项目冲突数只打开该项目的冲突任务", async () => {
    const onAction = vi.fn();
    render(ProjectsModule, { snapshot: multi(), onAction });
    await fireEvent.click(
      screen.getByLabelText("打开该项目的冲突处理（3 个冲突）"),
    );
    expect(onAction).toHaveBeenCalledWith("projects/open-task", {
      projectRoot: "/repo/a/app",
      task: "conflicts",
    });
    expect(onAction).not.toHaveBeenCalledWith(
      "projects/open-task",
      expect.objectContaining({ projectRoot: "/repo/b/app" }),
    );
  });

  it("完整路径可复制", async () => {
    const onAction = vi.fn();
    render(ProjectsModule, { snapshot: multi(), onAction });
    await fireEvent.click(
      screen.getByLabelText("复制项目完整路径 /repo/a/app"),
    );
    expect(onAction).toHaveBeenCalledWith("copy-text", {
      text: "/repo/a/app",
    });
  });
});

describe("项目空态恢复（V024-R42）", () => {
  it("非 SVN 项目给出检出说明与可执行下一步（不承诺检出向导）", async () => {
    const onAction = vi.fn();
    render(ProjectsModule, { snapshot: baseline, onAction });
    const notesRow = screen.getByText("notes").closest(".project-row")!;
    expect(notesRow.textContent).toContain("本版工作台不提供检出向导");
    await fireEvent.click(
      Array.from(notesRow.querySelectorAll("button")).find(
        (button) => button.textContent === "打开文件夹",
      )!,
    );
    expect(onAction).toHaveBeenCalledWith("diagnostics/open-folder", {});
    await fireEvent.click(
      Array.from(notesRow.querySelectorAll("button")).find(
        (button) => button.textContent === "查看环境诊断",
      )!,
    );
    expect(onAction).toHaveBeenCalledWith("open-module", {
      moduleId: "diagnostics",
      taskId: "diagnostics/environment",
    });
  });

  it("路径丢失项目提供重新选择与复制原路径", async () => {
    const onAction = vi.fn();
    render(ProjectsModule, { snapshot: baseline, onAction });
    const goneRow = screen.getByText("gone").closest(".project-row")!;
    await fireEvent.click(
      Array.from(goneRow.querySelectorAll("button")).find(
        (button) => button.textContent === "重新选择文件夹",
      )!,
    );
    expect(onAction).toHaveBeenCalledWith("diagnostics/open-folder", {});
    await fireEvent.click(
      Array.from(goneRow.querySelectorAll("button")).find(
        (button) => button.textContent === "复制原路径",
      )!,
    );
    expect(onAction).toHaveBeenCalledWith("copy-text", {
      text: "/repo/gone",
    });
  });
});
