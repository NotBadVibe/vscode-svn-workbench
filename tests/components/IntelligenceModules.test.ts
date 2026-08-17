import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import AiReviewModule from "../../src/webview/features/ai-review/AiReviewModule.svelte";
import ImpactModule from "../../src/webview/features/impact/ImpactModule.svelte";
import type {
  AiReviewSnapshot,
  ImpactSnapshot,
} from "../../src/protocol/workbenchProtocol";

/*
 * v0.0.10 过渡迁移（只读）：标题/证据/路径搜索、严重度/分类筛选、
 * 风险/标题排序与路径详情；两者均不增加复选框或批量动作。
 */

const reviewSnapshot: AiReviewSnapshot = {
  kind: "ai-review",
  state: "ready",
  source: "local-rule",
  generatedAt: "2026-08-16T10:00:00.000Z",
  privacy: {
    files: 3,
    characters: 1200,
    maxCharacters: 24000,
    historyIncluded: false,
    model: "本地规则（未配置外部模型）",
  },
  summary: { critical: 1, warning: 1, note: 1 },
  findings: [
    {
      id: "f1",
      severity: "critical",
      category: "security",
      relativePath: "src/secret.ts",
      line: 3,
      title: "疑似密钥泄漏",
      evidence: "const token = 'sk-...';",
      recommendation: "改用 SecretStorage。",
      confidence: "high",
    },
    {
      id: "f2",
      severity: "warning",
      category: "debug",
      relativePath: "src/main.ts",
      title: "调试残留",
      evidence: "console.log('debug');",
      recommendation: "删除调试输出。",
      confidence: "medium",
    },
    {
      id: "f3",
      severity: "note",
      category: "testing",
      title: "缺少测试文件",
      evidence: "src/calc.ts 没有对应测试。",
      recommendation: "补充回归测试。",
      confidence: "low",
    },
  ],
  warnings: [],
};

const impactSnapshot: ImpactSnapshot = {
  kind: "impact",
  generatedAt: "2026-08-16T10:00:00.000Z",
  source: "local-rule",
  changedFiles: 3,
  areas: [
    {
      id: "a1",
      title: "Webview 界面",
      detail: "涉及共享组件。",
      paths: ["src/webview/App.svelte", "src/webview/main.ts"],
      risk: "high",
    },
    {
      id: "a2",
      title: "文档",
      detail: "README 变化。",
      paths: ["README.md"],
      risk: "low",
    },
  ],
  tests: [],
  observations: [],
  warnings: [],
};

describe("AiReviewModule 过渡迁移（v0.0.10）", () => {
  it("标题/证据/路径搜索过滤发现并播报数量", async () => {
    render(AiReviewModule, { snapshot: reviewSnapshot, onAction: vi.fn() });
    expect(screen.getByText("3 条发现")).toBeInTheDocument();
    const input = screen.getByRole("textbox", { name: "筛选检查发现" });
    await fireEvent.input(input, { target: { value: "secret" } });
    expect(screen.getByText("1 条发现")).toBeInTheDocument();
    expect(screen.getByText("疑似密钥泄漏")).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
    expect(screen.getByText("3 条发现")).toBeInTheDocument();
  });

  it("严重度与分类筛选可组合", async () => {
    render(AiReviewModule, { snapshot: reviewSnapshot, onAction: vi.fn() });
    // 严重度摘要按钮名称含计数（“1 高风险”）。
    await fireEvent.click(screen.getByRole("button", { name: /高风险/ }));
    expect(screen.getByText("1 条发现")).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "全部分类" }));
    // 严重度 + 分类组合：高风险中没有 testing 分类。
    const input = screen.getByRole("textbox", { name: "筛选检查发现" });
    await fireEvent.input(input, { target: { value: "测试" } });
    expect(screen.getByText("0 条发现")).toBeInTheDocument();
  });

  it("保持只读：不提供复选框或批量动作", () => {
    render(AiReviewModule, { snapshot: reviewSnapshot, onAction: vi.fn() });
    expect(document.querySelectorAll("input[type=checkbox]")).toHaveLength(0);
    expect(
      screen.queryByRole("button", { name: /批量|全选/ }),
    ).not.toBeInTheDocument();
  });
});

describe("ImpactModule 过渡迁移（v0.0.10）", () => {
  it("影响区域按标题/说明/路径搜索并播报数量", async () => {
    render(ImpactModule, { snapshot: impactSnapshot, onAction: vi.fn() });
    expect(screen.getByText("2 个区域")).toBeInTheDocument();
    const input = screen.getByRole("textbox", { name: "筛选影响区域与路径" });
    await fireEvent.input(input, { target: { value: "README.md" } });
    expect(screen.getByText("1 个区域")).toBeInTheDocument();
    expect(screen.getByText("文档")).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
    expect(screen.getByText("2 个区域")).toBeInTheDocument();
  });

  it("按风险排序高风险在前，可恢复默认顺序", async () => {
    render(ImpactModule, { snapshot: impactSnapshot, onAction: vi.fn() });
    const sortMenu = screen.getByRole("combobox", {
      name: "影响区域排序",
    }) as HTMLSelectElement;
    const firstTitle = () =>
      document.querySelector(".impact-areas article strong")?.textContent;
    expect(firstTitle()).toBe("Webview 界面");
    await fireEvent.change(sortMenu, { target: { value: "title" } });
    expect(firstTitle()).toBe("Webview 界面");
    await fireEvent.change(sortMenu, { target: { value: "risk" } });
    expect(firstTitle()).toBe("Webview 界面");
    await fireEvent.change(sortMenu, { target: { value: "default" } });
    expect(firstTitle()).toBe("Webview 界面");
  });

  it("影响路径行提供路径详情入口并复用 Host 动作", async () => {
    const onAction = vi.fn();
    render(ImpactModule, { snapshot: impactSnapshot, onAction });
    await fireEvent.click(
      screen.getByRole("button", { name: "查看 README.md 路径详情" }),
    );
    expect(onAction).toHaveBeenCalledWith("file/path-detail", {
      relativePath: "README.md",
    });
  });

  it("保持只读：不提供复选框或批量动作", () => {
    render(ImpactModule, { snapshot: impactSnapshot, onAction: vi.fn() });
    expect(document.querySelectorAll("input[type=checkbox]")).toHaveLength(0);
    expect(
      screen.queryByRole("button", { name: /批量|全选/ }),
    ).not.toBeInTheDocument();
  });
});
