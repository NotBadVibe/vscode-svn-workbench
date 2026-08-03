import { describe, expect, it } from "vitest";
import {
  WORKBENCH_PROTOCOL_VERSION,
  createRequestId,
  defaultWorkbenchTask,
  isWebviewToHostMessage,
  isWorkbenchModuleId,
  isWorkbenchTaskForModule,
  isWorkbenchTaskId,
} from "../../src/protocol/workbenchProtocol";

describe("workbench protocol validation", () => {
  it("accepts known modules and rejects invented modules", () => {
    expect(isWorkbenchModuleId("changes")).toBe(true);
    expect(isWorkbenchModuleId("invented")).toBe(false);
  });

  it("校验具体任务深链接与所属模块", () => {
    expect(defaultWorkbenchTask("repository")).toBe("repository/update");
    expect(isWorkbenchTaskId("repository/properties")).toBe(true);
    expect(isWorkbenchTaskId("repository/unknown")).toBe(false);
    expect(
      isWorkbenchTaskForModule("repository/properties", "repository"),
    ).toBe(true);
    expect(isWorkbenchTaskForModule("settings/ai", "repository")).toBe(false);
    expect(
      isWebviewToHostMessage({
        protocolVersion: 1,
        type: "webview/ready",
        moduleId: "repository",
        taskId: "settings/ai",
        payload: {},
      }),
    ).toBe(false);
  });

  it("accepts a valid action message", () => {
    expect(
      isWebviewToHostMessage({
        protocolVersion: WORKBENCH_PROTOCOL_VERSION,
        type: "workbench/action",
        requestId: "test-1",
        moduleId: "changes",
        repositoryUuid: "repo-uuid",
        scopeHash: "scope-hash",
        payload: { action: "refresh" },
      }),
    ).toBe(true);
  });

  it("rejects unknown actions and incompatible versions", () => {
    expect(
      isWebviewToHostMessage({
        protocolVersion: 999,
        type: "workbench/action",
        moduleId: "changes",
        payload: { action: "commit-without-confirmation" },
      }),
    ).toBe(false);
  });

  it("rejects an action without repository and scope identity", () => {
    expect(
      isWebviewToHostMessage({
        protocolVersion: WORKBENCH_PROTOCOL_VERSION,
        type: "workbench/action",
        moduleId: "changes",
        payload: { action: "refresh" },
      }),
    ).toBe(false);
  });

  it("覆盖 ready、非法形状、类型和模块的协议分支", () => {
    expect(isWebviewToHostMessage(null)).toBe(false);
    expect(isWebviewToHostMessage([])).toBe(false);
    expect(
      isWebviewToHostMessage({
        protocolVersion: 1,
        moduleId: "missing",
        type: "webview/ready",
        payload: {},
      }),
    ).toBe(false);
    expect(
      isWebviewToHostMessage({
        protocolVersion: 1,
        moduleId: "changes",
        type: "webview/ready",
        payload: {},
      }),
    ).toBe(true);
    expect(
      isWebviewToHostMessage({
        protocolVersion: 1,
        moduleId: "changes",
        type: "webview/ready",
        payload: null,
      }),
    ).toBe(false);
    expect(
      isWebviewToHostMessage({
        protocolVersion: 1,
        moduleId: "changes",
        type: "unknown",
        payload: {},
      }),
    ).toBe(false);
    expect(
      isWebviewToHostMessage({
        protocolVersion: 1,
        moduleId: "changes",
        type: "workbench/action",
        payload: [],
      }),
    ).toBe(false);
    expect(
      isWebviewToHostMessage({
        protocolVersion: 1,
        moduleId: "changes",
        type: "workbench/action",
        repositoryUuid: 1,
        scopeHash: "s",
        payload: { action: "refresh" },
      }),
    ).toBe(false);
    expect(
      isWebviewToHostMessage({
        protocolVersion: 1,
        moduleId: "changes",
        type: "workbench/action",
        repositoryUuid: "r",
        scopeHash: 1,
        payload: { action: "refresh" },
      }),
    ).toBe(false);
    expect(createRequestId("安全操作")).toMatch(
      /^安全操作-[a-z0-9]+-[a-f0-9]{32}$/,
    );
  });
});
