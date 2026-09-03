import { describe, expect, it } from "vitest";
import {
  WORKBENCH_PROTOCOL_VERSION,
  isChangesSnapshot,
  isCommitHandoffView,
  isCommitSnapshot,
  isContinuityRestoreView,
  isWebviewToHostMessage,
} from "../../src/protocol/workbenchProtocol";

const validRestore = {
  contextVersion: 1,
  originModule: "changes",
  changesView: {},
  selectedKeys: [],
  removedEntries: [],
  notices: [],
  restoredAt: "2026-08-20T10:00:00.000Z",
};

const validChanges = {
  kind: "changes",
  commitDraft: "",
  files: [],
  summary: {},
  refreshedAt: "2026-08-20T10:00:00.000Z",
};

const validHandoff = {
  source: "changes",
  selectionVersion: 1,
  requestedCount: 1,
  keptCount: 1,
  removedEntries: [],
  receivedAt: "2026-09-03T00:00:00.000Z",
};

const validCommit = {
  kind: "commit",
  files: [],
  summary: {},
  selectedPaths: [],
  message: "",
};

function actionMessage(overrides: Record<string, unknown> = {}): unknown {
  return {
    protocolVersion: WORKBENCH_PROTOCOL_VERSION,
    type: "workbench/action",
    moduleId: "changes",
    sessionId: "session-id",
    repositoryUuid: "repo-uuid",
    scopeHash: "scope-hash",
    payload: { action: "refresh" },
    ...overrides,
  };
}

describe("workbenchProtocolGuards: isContinuityRestoreView 逐字段拒绝分支", () => {
  it("接受最小与完整合法视图（含 comfortable/scrollAssistPixels）", () => {
    expect(isContinuityRestoreView(validRestore)).toBe(true);
    expect(
      isContinuityRestoreView({
        ...validRestore,
        changesView: {
          activeStatus: "modified",
          activeFileType: "text",
          activePresetId: "preset",
          query: "foo",
          sort: "name:asc",
          density: "comfortable",
          onlySelected: true,
        },
        activeFileKey: "k1",
        scrollAnchorKey: "k2",
        scrollAssistPixels: 12,
        commitDraft: "草稿",
      }),
    ).toBe(true);
    expect(
      isContinuityRestoreView({
        ...validRestore,
        changesView: { density: "compact", onlySelected: false },
      }),
    ).toBe(true);
  });

  it("拒绝非 record 与首屏身份/集合字段非法", () => {
    expect(isContinuityRestoreView(null)).toBe(false);
    expect(isContinuityRestoreView([])).toBe(false);
    expect(isContinuityRestoreView("x")).toBe(false);
    expect(
      isContinuityRestoreView({ ...validRestore, contextVersion: "1" }),
    ).toBe(false);
    expect(
      isContinuityRestoreView({ ...validRestore, contextVersion: NaN }),
    ).toBe(false);
    expect(
      isContinuityRestoreView({ ...validRestore, contextVersion: Infinity }),
    ).toBe(false);
    expect(
      isContinuityRestoreView({ ...validRestore, changesView: null }),
    ).toBe(false);
    expect(isContinuityRestoreView({ ...validRestore, changesView: [] })).toBe(
      false,
    );
    expect(
      isContinuityRestoreView({ ...validRestore, selectedKeys: "x" }),
    ).toBe(false);
    expect(
      isContinuityRestoreView({ ...validRestore, removedEntries: {} }),
    ).toBe(false);
    expect(isContinuityRestoreView({ ...validRestore, notices: "x" })).toBe(
      false,
    );
    expect(isContinuityRestoreView({ ...validRestore, notices: [42] })).toBe(
      false,
    );
    expect(isContinuityRestoreView({ ...validRestore, restoredAt: 42 })).toBe(
      false,
    );
  });

  it("拒绝 changesView 每个可选字段非法", () => {
    expect(
      isContinuityRestoreView({
        ...validRestore,
        changesView: { activeStatus: 42 },
      }),
    ).toBe(false);
    expect(
      isContinuityRestoreView({
        ...validRestore,
        changesView: { activeFileType: 42 },
      }),
    ).toBe(false);
    expect(
      isContinuityRestoreView({
        ...validRestore,
        changesView: { activePresetId: 42 },
      }),
    ).toBe(false);
    expect(
      isContinuityRestoreView({ ...validRestore, changesView: { query: 42 } }),
    ).toBe(false);
    expect(
      isContinuityRestoreView({ ...validRestore, changesView: { sort: 42 } }),
    ).toBe(false);
    expect(
      isContinuityRestoreView({
        ...validRestore,
        changesView: { density: "wide" },
      }),
    ).toBe(false);
    expect(
      isContinuityRestoreView({
        ...validRestore,
        changesView: { onlySelected: "yes" },
      }),
    ).toBe(false);
  });

  it("拒绝顶层可选恢复字段非法（含 scrollAssistPixels) ", () => {
    expect(
      isContinuityRestoreView({ ...validRestore, activeFileKey: 42 }),
    ).toBe(false);
    expect(
      isContinuityRestoreView({ ...validRestore, scrollAnchorKey: 42 }),
    ).toBe(false);
    expect(
      isContinuityRestoreView({ ...validRestore, scrollAssistPixels: "x" }),
    ).toBe(false);
    expect(
      isContinuityRestoreView({ ...validRestore, scrollAssistPixels: NaN }),
    ).toBe(false);
    expect(
      isContinuityRestoreView({
        ...validRestore,
        scrollAssistPixels: Infinity,
      }),
    ).toBe(false);
    expect(isContinuityRestoreView({ ...validRestore, commitDraft: 42 })).toBe(
      false,
    );
  });

  it("拒绝 removedEntries 逐项非法", () => {
    const good = {
      key: "k",
      path: "p",
      reason: "disappeared",
      message: "m",
    };
    expect(
      isContinuityRestoreView({ ...validRestore, removedEntries: ["x"] }),
    ).toBe(false);
    expect(
      isContinuityRestoreView({ ...validRestore, removedEntries: [null] }),
    ).toBe(false);
    expect(
      isContinuityRestoreView({
        ...validRestore,
        removedEntries: [{ ...good, key: 42 }],
      }),
    ).toBe(false);
    expect(
      isContinuityRestoreView({
        ...validRestore,
        removedEntries: [{ ...good, path: 42 }],
      }),
    ).toBe(false);
    expect(
      isContinuityRestoreView({
        ...validRestore,
        removedEntries: [{ ...good, reason: 42 }],
      }),
    ).toBe(false);
    expect(
      isContinuityRestoreView({
        ...validRestore,
        removedEntries: [{ ...good, reason: "invented" }],
      }),
    ).toBe(false);
    expect(
      isContinuityRestoreView({
        ...validRestore,
        removedEntries: [{ key: "k", path: "p", reason: "disappeared" }],
      }),
    ).toBe(false);
    expect(
      isContinuityRestoreView({
        ...validRestore,
        removedEntries: [{ ...good, message: 42 }],
      }),
    ).toBe(false);
  });
});

describe("workbenchProtocolGuards: isChangesSnapshot 全字段拒绝分支", () => {
  it("拒绝非 record 与各字段非法", () => {
    expect(isChangesSnapshot(null)).toBe(false);
    expect(isChangesSnapshot([])).toBe(false);
    expect(isChangesSnapshot({ ...validChanges, kind: "commit" })).toBe(false);
    expect(isChangesSnapshot({ ...validChanges, commitDraft: 42 })).toBe(false);
    expect(isChangesSnapshot({ ...validChanges, files: "x" })).toBe(false);
    expect(isChangesSnapshot({ ...validChanges, summary: null })).toBe(false);
    expect(isChangesSnapshot({ ...validChanges, summary: [] })).toBe(false);
    expect(isChangesSnapshot({ ...validChanges, refreshedAt: 42 })).toBe(false);
  });

  it("无 continuityRestore 接受、合法接受、非法整快照拒绝", () => {
    expect(isChangesSnapshot(validChanges)).toBe(true);
    expect(
      isChangesSnapshot({ ...validChanges, continuityRestore: validRestore }),
    ).toBe(true);
    expect(
      isChangesSnapshot({
        ...validChanges,
        continuityRestore: { ...validRestore, restoredAt: 42 },
      }),
    ).toBe(false);
  });
});

describe("workbenchProtocolGuards: isCommitHandoffView 全字段拒绝分支", () => {
  it("拒绝非 record 与数量/版本/集合字段非法", () => {
    expect(isCommitHandoffView(null)).toBe(false);
    expect(isCommitHandoffView([])).toBe(false);
    expect(isCommitHandoffView({ ...validHandoff, source: "diff" })).toBe(
      false,
    );
    expect(
      isCommitHandoffView({ ...validHandoff, selectionVersion: "1" }),
    ).toBe(false);
    expect(
      isCommitHandoffView({ ...validHandoff, selectionVersion: Infinity }),
    ).toBe(false);
    expect(isCommitHandoffView({ ...validHandoff, requestedCount: NaN })).toBe(
      false,
    );
    expect(
      isCommitHandoffView({ ...validHandoff, requestedCount: Infinity }),
    ).toBe(false);
    expect(isCommitHandoffView({ ...validHandoff, keptCount: "1" })).toBe(
      false,
    );
    expect(isCommitHandoffView({ ...validHandoff, keptCount: NaN })).toBe(
      false,
    );
    expect(isCommitHandoffView({ ...validHandoff, removedEntries: {} })).toBe(
      false,
    );
    expect(isCommitHandoffView({ ...validHandoff, receivedAt: 42 })).toBe(
      false,
    );
  });

  it("拒绝 removedEntries 逐项非法", () => {
    const good = { path: "p", reason: "blocked", message: "m" };
    expect(
      isCommitHandoffView({ ...validHandoff, removedEntries: ["x"] }),
    ).toBe(false);
    expect(
      isCommitHandoffView({
        ...validHandoff,
        removedEntries: [{ ...good, path: 42 }],
      }),
    ).toBe(false);
    expect(
      isCommitHandoffView({
        ...validHandoff,
        removedEntries: [{ ...good, reason: 42 }],
      }),
    ).toBe(false);
    expect(
      isCommitHandoffView({
        ...validHandoff,
        removedEntries: [{ ...good, reason: "invented" }],
      }),
    ).toBe(false);
    expect(
      isCommitHandoffView({
        ...validHandoff,
        removedEntries: [{ path: "p", reason: "blocked" }],
      }),
    ).toBe(false);
    expect(
      isCommitHandoffView({
        ...validHandoff,
        removedEntries: [{ ...good, message: 42 }],
      }),
    ).toBe(false);
  });
});

describe("workbenchProtocolGuards: isCommitSnapshot 全字段拒绝分支", () => {
  it("拒绝非 record 与各字段非法", () => {
    expect(isCommitSnapshot(null)).toBe(false);
    expect(isCommitSnapshot([])).toBe(false);
    expect(isCommitSnapshot({ ...validCommit, kind: "changes" })).toBe(false);
    expect(isCommitSnapshot({ ...validCommit, files: "x" })).toBe(false);
    expect(isCommitSnapshot({ ...validCommit, summary: null })).toBe(false);
    expect(isCommitSnapshot({ ...validCommit, selectedPaths: "x" })).toBe(
      false,
    );
    expect(isCommitSnapshot({ ...validCommit, message: 42 })).toBe(false);
  });

  it("无 handoff 接受、合法 handoff 接受、非法 handoff 整快照拒绝", () => {
    expect(isCommitSnapshot(validCommit)).toBe(true);
    expect(isCommitSnapshot({ ...validCommit, handoff: validHandoff })).toBe(
      true,
    );
    expect(
      isCommitSnapshot({
        ...validCommit,
        handoff: { ...validHandoff, source: "diff" },
      }),
    ).toBe(false);
  });
});

describe("workbenchProtocolGuards: isWebviewToHostMessage 未覆盖分支", () => {
  it("正确版本下拒绝非法 moduleId", () => {
    expect(
      isWebviewToHostMessage({
        protocolVersion: WORKBENCH_PROTOCOL_VERSION,
        type: "webview/ready",
        moduleId: "invented",
        payload: {},
      }),
    ).toBe(false);
  });

  it("正确版本下 ready payload 非 record 拒绝", () => {
    expect(
      isWebviewToHostMessage({
        protocolVersion: WORKBENCH_PROTOCOL_VERSION,
        type: "webview/ready",
        moduleId: "changes",
        payload: null,
      }),
    ).toBe(false);
    expect(
      isWebviewToHostMessage({
        protocolVersion: WORKBENCH_PROTOCOL_VERSION,
        type: "webview/ready",
        moduleId: "changes",
        payload: [],
      }),
    ).toBe(false);
  });

  it("正确版本下未知 type 与 action 非 record 拒绝", () => {
    expect(
      isWebviewToHostMessage({
        protocolVersion: WORKBENCH_PROTOCOL_VERSION,
        type: "unknown",
        moduleId: "changes",
        payload: {},
      }),
    ).toBe(false);
    expect(
      isWebviewToHostMessage({
        protocolVersion: WORKBENCH_PROTOCOL_VERSION,
        type: "workbench/action",
        moduleId: "changes",
        sessionId: "s",
        repositoryUuid: "r",
        scopeHash: "h",
        payload: [],
      }),
    ).toBe(false);
  });

  it("正确版本下四元缺字段逐项拒绝", () => {
    expect(isWebviewToHostMessage(actionMessage({ sessionId: 42 }))).toBe(
      false,
    );
    expect(isWebviewToHostMessage(actionMessage({ repositoryUuid: 42 }))).toBe(
      false,
    );
    expect(isWebviewToHostMessage(actionMessage({ scopeHash: 42 }))).toBe(
      false,
    );
    expect(
      isWebviewToHostMessage(actionMessage({ payload: { action: 42 } })),
    ).toBe(false);
    expect(isWebviewToHostMessage(actionMessage({ payload: {} }))).toBe(false);
    expect(
      isWebviewToHostMessage(
        actionMessage({ payload: { action: "invented/action" } }),
      ),
    ).toBe(false);
  });

  it("正确版本下 taskId 非法拒绝、合法接受", () => {
    expect(
      isWebviewToHostMessage({
        protocolVersion: WORKBENCH_PROTOCOL_VERSION,
        type: "webview/ready",
        moduleId: "commit",
        taskId: "settings/selection",
        payload: {},
      }),
    ).toBe(false);
    expect(
      isWebviewToHostMessage({
        protocolVersion: WORKBENCH_PROTOCOL_VERSION,
        type: "webview/ready",
        moduleId: "settings",
        taskId: "settings/selection",
        payload: {},
      }),
    ).toBe(true);
  });
});
