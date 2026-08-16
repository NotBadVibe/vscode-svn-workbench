import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import AgentModule from "../../src/webview/features/agent/AgentModule.svelte";
import type { AgentSnapshot } from "../../src/protocol/workbenchProtocol";

describe("AgentModule", () => {
  it("只允许执行 Host 标记的下一步", async () => {
    const onAction = vi.fn();
    const snapshot: AgentSnapshot = {
      kind: "agent",
      status: "planned",
      objective: "检查变更",
      guardrails: [],
      nextStepId: "status",
      steps: [
        {
          id: "status",
          title: "读取状态",
          detail: "只读",
          capability: "svn-read",
          scope: "当前范围",
          risk: "低",
          reversibility: "无修改",
          status: "pending",
          requiresApproval: true,
        },
        {
          id: "review",
          title: "审查",
          detail: "本地",
          capability: "local-analysis",
          scope: "当前范围",
          risk: "低",
          reversibility: "可丢弃",
          status: "pending",
          requiresApproval: true,
        },
      ],
    };
    render(AgentModule, { snapshot, onAction });
    const buttons = screen.getAllByRole("button", { name: "执行此步" });
    expect(buttons[0]).toBeEnabled();
    expect(buttons[1]).toBeDisabled();
    await fireEvent.click(buttons[0]);
    expect(onAction).toHaveBeenCalledWith("agent/approve-step", {
      stepId: "status",
    });
  });

  it("中文输入法选词期间 Ctrl+Enter 不生成代理计划", async () => {
    const onAction = vi.fn();
    const snapshot: AgentSnapshot = {
      kind: "agent",
      status: "idle",
      objective: "检查中文路径",
      guardrails: [],
      steps: [],
    };
    render(AgentModule, { snapshot, onAction });
    const input = screen.getByRole("textbox", { name: /任务目标/ });
    const composing = new KeyboardEvent("keydown", {
      key: "Enter",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(composing, "isComposing", { value: true });
    input.dispatchEvent(composing);
    expect(onAction).not.toHaveBeenCalledWith(
      "agent/create-plan",
      expect.anything(),
    );
    await fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    expect(onAction).toHaveBeenCalledWith("agent/create-plan", {
      objective: "检查中文路径",
    });
  });
});
