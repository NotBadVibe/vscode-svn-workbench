import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import ChangelistsModule from "../../src/webview/features/changelists/ChangelistsModule.svelte";
import UnderstandingModule from "../../src/webview/features/understanding/UnderstandingModule.svelte";
import type {
  ChangelistsSnapshot,
  ChangeUnderstandingSnapshot,
  WorkbenchFileView,
} from "../../src/protocol/workbenchProtocol";

/*
 * v0.1.6 V016-D：Changelists + Understanding 迁移 AssistancePanel。
 * - 页头 primary 收敛至页面级 1 个；模型入口 ≤1（面板模型组）。
 * - 本地主路径（自动整理 / 只运行本地检查）不依赖模型配置。
 * - 回执 token 链、覆盖率、证据、stale/待复核逻辑保持（协议/Host 零改动）。
 */

const groupFile = (path: string): WorkbenchFileView => ({
  relativePath: path,
  selectionKey: `test-wc::${path}` as never,
  status: "modified",
  selection: "selected",
});

function buildChangelists(
  overrides: Partial<ChangelistsSnapshot> = {},
): ChangelistsSnapshot {
  return {
    kind: "changelists",
    source: "local-rule",
    aiPrivacy: {
      model: "deepseek-v4-flash",
      fileLimit: 120,
      data: "文件相对路径、状态、类型和模块分组；不发送文件正文",
      historyIncluded: false,
    },
    groups: [],
    unassigned: [groupFile("src/a.ts")],
    suggestions: [],
    warnings: [],
    ...overrides,
  };
}

const understandingBase: ChangeUnderstandingSnapshot = {
  kind: "change-understanding",
  state: "idle",
  source: "local-rule",
  binding: {
    repositoryUuid: "uuid-1",
    scopeHash: "scope-1",
    candidateHash: "candidates-1",
    revision: "7",
    generatedAt: "2026-08-18T10:00:00.000Z",
  },
  receipt: {
    task: "understand-changes",
    projectId: "project-1",
    model: "deepseek-v4-flash",
    dataTypes: ["项目内相对路径、SVN 状态、脱敏差异片段"],
    files: 1,
    totalBudget: 40000,
    perFileBudget: 6000,
    historyIncluded: false,
  },
  coverage: {
    total: 1,
    analyzed: 1,
    truncated: 0,
    binary: 0,
    readFailed: 0,
    budgetExcluded: 0,
  },
  coverageFiles: [],
  changes: [],
  findings: [],
  verification: [],
  userConfirmations: [],
  limitations: [],
  warnings: [],
};

describe("V016-D Changelists 帮助迁移", () => {
  it("页头唯一动作为次级「自动整理」（去 sparkle），语义拆分只在面板内", async () => {
    const onAction = vi.fn();
    render(ChangelistsModule, { snapshot: buildChangelists(), onAction });
    const autoTidy = screen.getByRole("button", { name: "自动整理" });
    expect(autoTidy.classList.contains("button--secondary")).toBe(true);
    expect(autoTidy.classList.contains("button--primary")).toBe(false);
    expect(screen.queryByRole("button", { name: "生成分组建议" })).toBeNull();
    // 面板默认折叠：语义拆分入口不可见。
    expect(screen.queryByRole("button", { name: /按改动意图拆分/ })).toBeNull();
    await fireEvent.click(screen.getByRole("button", { name: "需要帮助" }));
    expect(
      screen.getByRole("button", { name: /按改动意图拆分/ }),
    ).toBeInTheDocument();
  });

  it("「自动整理」直接按元数据分组，不走回执链", async () => {
    const onAction = vi.fn();
    render(ChangelistsModule, { snapshot: buildChangelists(), onAction });
    await fireEvent.click(screen.getByRole("button", { name: "自动整理" }));
    expect(onAction).toHaveBeenCalledWith("changelist/suggest", {
      mode: "metadata",
    });
    expect(onAction).not.toHaveBeenCalledWith(
      "changelist/preview-receipt",
      expect.anything(),
    );
  });

  it("页面级唯一 primary=意向单入口（确认应用变更集）", () => {
    const onAction = vi.fn();
    render(ChangelistsModule, {
      snapshot: buildChangelists({
        preview: {
          token: "cl-1",
          name: "ui",
          remove: false,
          paths: ["src/a.ts"],
          command: 'svn changelist "ui" "src/a.ts"',
          canExecute: true,
          issues: [],
        },
      }),
      onAction,
    });
    // 生成应用预览已降为次级；确认应用保持唯一 primary。
    const previewButton = screen.getByRole("button", {
      name: "生成应用预览",
    });
    expect(previewButton.classList.contains("button--secondary")).toBe(true);
    const confirmButton = screen.getByRole("button", {
      name: "确认应用变更集",
    });
    expect(confirmButton.classList.contains("button--primary")).toBe(true);
  });

  it("AI 未配置时语义拆分禁用，自动整理主路径仍可用", async () => {
    const onAction = vi.fn();
    render(ChangelistsModule, {
      snapshot: buildChangelists({
        aiPrivacy: {
          model: "本地规则（未配置外部模型）",
          fileLimit: 120,
          data: "文件相对路径、状态、类型和模块分组；不发送文件正文",
          historyIncluded: false,
        },
      }),
      onAction,
    });
    await fireEvent.click(screen.getByRole("button", { name: "需要帮助" }));
    expect(
      screen.getByRole("button", { name: /按改动意图拆分/ }),
    ).toBeDisabled();
    // 本地主路径锁定：自动整理不受影响。
    await fireEvent.click(screen.getByRole("button", { name: "自动整理" }));
    expect(onAction).toHaveBeenCalledWith("changelist/suggest", {
      mode: "metadata",
    });
  });
});

describe("V016-D Understanding 帮助迁移", () => {
  it("页头只保留本地主路径；模型入口收进面板且默认折叠", async () => {
    const onAction = vi.fn();
    render(UnderstandingModule, { snapshot: understandingBase, onAction });
    const localButton = screen.getByRole("button", {
      name: "只运行本地检查",
    });
    expect(localButton.classList.contains("button--secondary")).toBe(true);
    expect(
      screen.queryByRole("button", { name: /查看并开始分析|重新分析/ }),
    ).toBeNull();
    await fireEvent.click(screen.getByRole("button", { name: "需要帮助" }));
    await fireEvent.click(
      screen.getByRole("button", { name: "查看并开始分析（1）" }),
    );
    expect(onAction).toHaveBeenCalledWith("understanding/preview-receipt", {});
    expect(onAction).not.toHaveBeenCalledWith(
      "understanding/run-model",
      expect.anything(),
    );
  });

  it("AI 未配置时模型分析禁用，本地检查主路径仍可用", async () => {
    const onAction = vi.fn();
    render(UnderstandingModule, {
      snapshot: {
        ...understandingBase,
        receipt: {
          ...understandingBase.receipt,
          model: "本地规则（未配置外部模型）",
        },
      },
      onAction,
    });
    await fireEvent.click(screen.getByRole("button", { name: "需要帮助" }));
    expect(
      screen.getByRole("button", { name: /查看并开始分析|重新分析/ }),
    ).toBeDisabled();
    await fireEvent.click(
      screen.getByRole("button", { name: "只运行本地检查" }),
    );
    expect(onAction).toHaveBeenCalledWith("understanding/run-local", {});
  });

  it("页面级 primary 只剩会话内确认「确认」", () => {
    render(UnderstandingModule, {
      // idle 空态不渲染确认区：给一条本地结论进入结果分支。
      snapshot: {
        ...understandingBase,
        state: "ready",
        changes: [
          {
            id: "local-1",
            statement: "修改了 1 个文件：src/a.ts。",
            source: "local-rule",
            status: "confirmed",
            evidence: [],
            invalidEvidence: [],
            limitations: [],
          },
        ],
      },
      onAction: vi.fn(),
    });
    const confirmButton = screen.getByRole("button", { name: "确认" });
    expect(confirmButton.classList.contains("button--primary")).toBe(true);
    // 页头本地按钮为次级。
    expect(
      screen
        .getByRole("button", { name: "只运行本地检查" })
        .classList.contains("button--secondary"),
    ).toBe(true);
  });
});
