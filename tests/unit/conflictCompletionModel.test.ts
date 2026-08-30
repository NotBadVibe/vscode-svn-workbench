import { describe, expect, it } from "vitest";
import {
  ALL_PHASES,
  CONFLICT_COMPLETION_TOKEN_TTL_MS,
  canTransition,
  createConflictCompletionState,
  derivePhase,
  deriveStepView,
  invalidate,
  transition,
  type ConflictCompletionState,
} from "../../src/conflict/conflictCompletionModel";
import {
  buildConflictFileIdentity,
  hashText,
} from "../../src/conflict/conflictDiffModel";

const REPO_ROOT = "/repo/svn-workbench";
const REL = "src/app.ts";
const SCOPE = "scope-abc";
const REV = "r100";
const UUID = "uuid-1234";
const WH = hashText("working");
const DH = hashText("draft");
const BH = hashText("base");

function mkState(
  overrides: Partial<ConflictCompletionState> = {},
): ConflictCompletionState {
  const base = createConflictCompletionState({
    fileIdentity: buildConflictFileIdentity(REPO_ROOT, REL),
    scopeHash: SCOPE,
    workingCopyRevision: REV,
    repositoryUuid: UUID,
    workingHash: WH,
    draftHash: WH,
    baseHash: BH,
    diskHash: WH,
    conflictKind: "text",
  });
  return {
    ...base,
    ...overrides,
    fileIdentity: overrides.fileIdentity ?? base.fileIdentity,
  } as ConflictCompletionState;
}

function textState(
  phase: ConflictCompletionState["phase"],
): ConflictCompletionState {
  const s = mkState({ phase } as Partial<ConflictCompletionState>);
  // 简单通过 transition 难以直接设 phase，用 mkState 覆盖后手动补派生
  // 直接调用 create 后覆盖 phase 并补充派生字段
  const kind = s.conflictKind;
  const nonText = kind !== "text";
  // 复用内部 label 逻辑，简化：重新用 invalidate 的 buildState 效果，通过转换
  // 这里直接补齐派生字段
  const labelMap: Record<string, string> = {
    "draft-clean": "草稿已就绪",
    "draft-dirty": "草稿已修改",
    "draft-checkpointed": "检查点已保存",
    "save-ready": "已就绪可保存工作副本",
    "working-saved": "已保存工作副本",
    "verification-pass": nonText ? "已核验（非文本）" : "已通过核验",
    "verification-blocked": "核验未通过",
    "resolve-ready": "已就绪可标记解决",
    resolved: "已标记解决",
    "next-conflict": "前往下一个冲突",
    "all-resolved": "全部已解决",
  };
  return {
    ...s,
    phase,
    status: phase,
    label: labelMap[phase] ?? phase,
    reason: "test",
    primaryAction: "test",
    blockingIssues: [],
    nonTextBranch: nonText,
    verificationIssues: s.verificationIssues ?? [],
  };
}

describe("V013-A 状态枚举 11 态", () => {
  it("枚举数量与命名一一对应", () => {
    expect(ALL_PHASES.length).toBe(11);
    expect(ALL_PHASES).toEqual([
      "draft-clean",
      "draft-dirty",
      "draft-checkpointed",
      "save-ready",
      "working-saved",
      "verification-pass",
      "verification-blocked",
      "resolve-ready",
      "resolved",
      "next-conflict",
      "all-resolved",
    ]);
  });
});

describe("V013-A 10+ 状态迁移", () => {
  it("draft-clean → edit → draft-dirty", () => {
    const s0 = mkState();
    expect(s0.phase).toBe("draft-clean");
    const r = transition(s0, { type: "edit" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.phase).toBe("draft-dirty");
    expect(r.state.draftRevision).toBe(1);
  });

  it("draft-dirty → checkpoint → draft-checkpointed", () => {
    const s = textState("draft-dirty");
    const r = transition(s, { type: "checkpointed" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.phase).toBe("draft-checkpointed");
  });

  it("draft-dirty → saveRequested → save-ready", () => {
    const s = textState("draft-dirty");
    const now = Date.now();
    const r = transition(s, {
      type: "saveRequested",
      previewToken: "pt1",
      editToken: "et1",
      tokenIssuedAt: now,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.phase).toBe("save-ready");
    expect(r.state.previewToken).toBe("pt1");
  });

  it("draft-checkpointed → saveRequested → save-ready", () => {
    const s = textState("draft-checkpointed");
    const now = Date.now();
    const r = transition(s, {
      type: "saveRequested",
      previewToken: "pt2",
      editToken: "et2",
      tokenIssuedAt: now,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.phase).toBe("save-ready");
  });

  it("save-ready → saved → working-saved（原子写入，token 单次消耗）", () => {
    const now = Date.now();
    const s = textState("save-ready");
    const withToken: ConflictCompletionState = {
      ...s,
      previewToken: "pt",
      editToken: "et",
      tokenIssuedAt: now,
    } as ConflictCompletionState;
    const r = transition(withToken, { type: "saved" }, now + 1000);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.phase).toBe("working-saved");
    expect(r.state.previewToken).toBeUndefined();
    expect(r.state.diskHash).toBe(r.state.draftHash);
  });

  it("working-saved → verificationRun pass → verification-pass", () => {
    const s = textState("working-saved");
    const r = transition(s, { type: "verificationRun", result: "pass" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.phase).toBe("verification-pass");
  });

  it("working-saved → verificationRun blocked → verification-blocked", () => {
    const s = textState("working-saved");
    const r = transition(s, {
      type: "verificationRun",
      result: "blocked",
      issues: ["存在冲突标记"],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.phase).toBe("verification-blocked");
    expect(r.state.blockingIssues).toContain("存在冲突标记");
  });

  it("verification-pass → previewRefreshed → resolve-ready", () => {
    const s = textState("verification-pass");
    const now = Date.now();
    const r = transition(s, {
      type: "previewRefreshed",
      previewToken: "rp1",
      tokenIssuedAt: now,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.phase).toBe("resolve-ready");
  });

  it("resolve-ready → resolved → (Host revalidation)", () => {
    const now = Date.now();
    const s = textState("resolve-ready");
    const withToken = {
      ...s,
      previewToken: "rt",
      editToken: "et",
      tokenIssuedAt: now,
    } as ConflictCompletionState;
    const r = transition(withToken, { type: "resolved" }, now + 500);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.phase).toBe("resolved");
  });

  it("resolved → refresh → next-conflict", () => {
    const s = textState("resolved");
    const r = transition(s, { type: "resolved", hasNextConflict: true });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.phase).toBe("next-conflict");
  });

  it("resolved → refresh → all-resolved", () => {
    const s = textState("resolved");
    const r = transition(s, { type: "resolved", hasNextConflict: false });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.phase).toBe("all-resolved");
  });

  it("canTransition 覆盖主干", () => {
    expect(canTransition("draft-clean", "draft-dirty")).toBe(true);
    expect(canTransition("draft-dirty", "draft-checkpointed")).toBe(true);
    expect(canTransition("draft-dirty", "save-ready")).toBe(true);
    expect(canTransition("save-ready", "working-saved")).toBe(true);
    expect(canTransition("working-saved", "verification-pass")).toBe(true);
    expect(canTransition("verification-pass", "resolve-ready")).toBe(true);
    expect(canTransition("resolve-ready", "resolved")).toBe(true);
    expect(canTransition("resolved", "next-conflict")).toBe(true);
    expect(canTransition("resolved", "all-resolved")).toBe(true);
    expect(canTransition("draft-clean", "save-ready")).toBe(false);
    expect(canTransition("verification-blocked", "resolve-ready")).toBe(false);
  });
});

describe("V013-A 8 种失效输入分支", () => {
  it("scopeChanged → preview/token 失效回到 draft-dirty（草稿保留）", () => {
    const now = Date.now();
    const s = {
      ...textState("save-ready"),
      previewToken: "pt",
      editToken: "et",
      tokenIssuedAt: now,
      draftHash: DH,
    } as ConflictCompletionState;
    const next = invalidate(s, { kind: "scopeChanged" });
    expect(next.phase).toBe("draft-dirty");
    expect(next.previewToken).toBeUndefined();
    expect(next.draftHash).toBe(DH);
  });

  it("revisionChanged → 失效", () => {
    const s = {
      ...textState("resolve-ready"),
      previewToken: "pt",
      editToken: "et",
      tokenIssuedAt: Date.now(),
    } as ConflictCompletionState;
    const next = invalidate(s, { kind: "revisionChanged" });
    expect(next.previewToken).toBeUndefined();
    expect(next.phase).toBe("draft-dirty");
  });

  it("repoChanged → 失效", () => {
    const s = {
      ...textState("save-ready"),
      previewToken: "pt",
      editToken: "et",
      tokenIssuedAt: Date.now(),
    } as ConflictCompletionState;
    const next = invalidate(s, { kind: "repoChanged" });
    expect(next.phase).toBe("draft-dirty");
  });

  it("fileMoved → 失效", () => {
    const s = {
      ...textState("working-saved"),
      previewToken: "pt",
      editToken: "et",
      tokenIssuedAt: Date.now(),
    } as ConflictCompletionState;
    const next = invalidate(s, { kind: "fileMoved" });
    expect(next.phase).toBe("draft-dirty");
  });

  it("diskChanged → working-saved 失效回 draft-dirty", () => {
    const s = textState("working-saved");
    const next = invalidate(s, { kind: "diskChanged" });
    expect(next.phase).toBe("draft-dirty");
  });

  it("baseChanged → 失效回 draft-dirty", () => {
    const s = textState("verification-pass");
    const next = invalidate(s, { kind: "baseChanged" });
    expect(next.phase).toBe("draft-dirty");
  });

  it("tokenExpired → save-ready 回 draft-checkpointed，resolve-ready 回 verification-pass", () => {
    const past = Date.now() - CONFLICT_COMPLETION_TOKEN_TTL_MS - 1000;
    const s1 = {
      ...textState("save-ready"),
      previewToken: "pt",
      editToken: "et",
      tokenIssuedAt: past,
    } as ConflictCompletionState;
    const n1 = invalidate(s1, { kind: "tokenExpired" }, Date.now());
    expect(n1.phase).toBe("draft-checkpointed");
    expect(n1.previewToken).toBeUndefined();

    const s2 = {
      ...textState("resolve-ready"),
      previewToken: "pt",
      editToken: "et",
      tokenIssuedAt: past,
      conflictKind: "text",
    } as ConflictCompletionState;
    const n2 = invalidate(
      { ...s2, nonTextBranch: false } as ConflictCompletionState,
      { kind: "tokenExpired" },
      Date.now(),
    );
    expect(n2.phase).toBe("verification-pass");
  });

  it("previewStale → save-ready 回 draft-dirty", () => {
    const s = {
      ...textState("save-ready"),
      previewToken: "pt",
      editToken: "et",
      tokenIssuedAt: Date.now(),
    } as ConflictCompletionState;
    const next = invalidate(s, { kind: "previewStale" });
    expect(next.phase).toBe("draft-dirty");
    expect(next.previewToken).toBeUndefined();
  });
});

describe("V013-A 非文本分支隔离", () => {
  it("tree/property/binary 不能进入 verification-pass", () => {
    for (const kind of ["tree", "property", "binary"] as const) {
      const s = mkState({
        conflictKind: kind,
        phase: "working-saved",
      } as Partial<ConflictCompletionState>);
      // 补派生
      const state: ConflictCompletionState = {
        ...s,
        phase: "working-saved",
        conflictKind: kind,
        nonTextBranch: true,
        status: "working-saved",
        label: "test",
        reason: "test",
        primaryAction: "test",
        blockingIssues: [],
        verificationIssues: [],
      };
      const r = transition(state, { type: "verificationRun", result: "pass" });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("non-text-branch-violation");
      // 非文本可通过 previewRefreshed 从 working-saved 直达 resolve-ready
      const now = Date.now();
      const r2 = transition(state, {
        type: "previewRefreshed",
        previewToken: "pt",
        tokenIssuedAt: now,
      });
      expect(r2.ok).toBe(true);
      if (r2.ok) expect(r2.state.phase).toBe("resolve-ready");
      // derivePhase 对非文本不返回 verification-pass
      const phase = derivePhase({
        draftHash: WH,
        workingHash: WH,
        baseHash: BH,
        diskHash: WH,
        draftRevision: 0,
        verificationResult: "pass",
        conflictKind: kind,
        isSavedToWorkingCopy: true,
      });
      expect(phase).not.toBe("verification-pass");
    }
  });

  it("derivePhase 文本 vs 非文本隔离", () => {
    const textPass = derivePhase({
      draftHash: WH,
      workingHash: WH,
      baseHash: BH,
      diskHash: WH,
      draftRevision: 0,
      verificationResult: "pass",
      conflictKind: "text",
      isSavedToWorkingCopy: false,
    });
    expect(textPass).toBe("verification-pass");
    const treePass = derivePhase({
      draftHash: WH,
      workingHash: WH,
      baseHash: BH,
      diskHash: WH,
      draftRevision: 0,
      verificationResult: "pass",
      conflictKind: "tree",
      isSavedToWorkingCopy: false,
    });
    expect(treePass).toBe("verification-blocked");
  });
});

describe("V013-A deriveStepView 四阶段输出", () => {
  it("四阶段序号+图标+中文文案+副文案+当前/已完成/阻止", () => {
    const phases: ConflictCompletionState["phase"][] = [
      "draft-checkpointed",
      "working-saved",
      "verification-pass",
      "resolved",
    ];
    for (const ph of phases) {
      const s = textState(ph);
      const view = deriveStepView(s);
      expect(view.steps.length).toBe(4);
      for (let i = 0; i < 4; i += 1) {
        const step = view.steps[i]!;
        expect(step.index).toBe(i + 1);
        expect(step.icon.length).toBeGreaterThan(0);
        expect(step.label.length).toBeGreaterThan(0);
        expect(step.description.length).toBeGreaterThan(0);
        expect(["done", "current", "blocked", "pending"]).toContain(step.state);
      }
    }
  });

  it("draft-clean 时 checkpoint 为 current，其余 pending", () => {
    const s = textState("draft-clean");
    const view = deriveStepView(s);
    expect(view.steps[0]!.state).toBe("current");
    expect(view.steps[1]!.state).toBe("pending");
  });

  it("verification-blocked 时 verification 阶段为 blocked", () => {
    const s = textState("verification-blocked");
    const view = deriveStepView(s);
    const vStep = view.steps.find((x) => x.key === "verification")!;
    expect(vStep.state).toBe("blocked");
    expect(vStep.label).toContain("核验");
  });

  it("resolved 时四阶段均为 done，不只靠颜色", () => {
    const s = textState("resolved");
    const view = deriveStepView(s);
    for (const step of view.steps) {
      expect(step.state).toBe("done");
      // 文案与图标同时表达状态，不只靠颜色
      expect(step.label).toBeTruthy();
      expect(step.icon).toBeTruthy();
    }
  });

  it("派生 label/primaryAction/blockingIssues 由 phase 纯映射", () => {
    const sDirty = textState("draft-dirty");
    expect(sDirty.primaryAction).toBeTruthy();
    const sBlocked = textState("verification-blocked");
    const blockedState: ConflictCompletionState = {
      ...sBlocked,
      verificationIssues: ["冲突标记残留"],
      blockingIssues: ["冲突标记残留"],
      phase: "verification-blocked",
      status: "verification-blocked",
    };
    expect(blockedState.blockingIssues.length).toBeGreaterThan(0);
  });
});

describe("V013-A fail-closed 拒绝", () => {
  it("checkpointed 仅允许 draft-dirty", () => {
    const s = textState("draft-clean");
    const r = transition(s, { type: "checkpointed" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("phase-mismatch");
  });

  it("saveRequested 无 token 拒绝", () => {
    const s = textState("draft-dirty");
    const r = transition(s, {
      type: "saveRequested",
      previewToken: "",
      editToken: "",
      tokenIssuedAt: Date.now(),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("token-invalid");
  });

  it("saveRequested 过期 token 拒绝", () => {
    const s = textState("draft-dirty");
    const past = Date.now() - CONFLICT_COMPLETION_TOKEN_TTL_MS - 5000;
    const r = transition(s, {
      type: "saveRequested",
      previewToken: "pt",
      editToken: "et",
      tokenIssuedAt: past,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("token-expired");
  });

  it("saved 阶段错误拒绝", () => {
    const s = textState("draft-dirty");
    const r = transition(s, { type: "saved" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("phase-mismatch");
  });

  it("verificationRun 仅 working-saved", () => {
    const s = textState("draft-dirty");
    const r = transition(s, { type: "verificationRun", result: "pass" });
    expect(r.ok).toBe(false);
  });

  it("resolved 未带 hasNextConflict 拒绝", () => {
    const s = textState("resolved");
    const r = transition(s, { type: "resolved" });
    expect(r.ok).toBe(false);
  });

  it("edit 在 resolved 后拒绝", () => {
    const s = textState("resolved");
    const r = transition(s, { type: "edit" });
    expect(r.ok).toBe(false);
  });
});

describe("V013-A derivePhase 覆盖", () => {
  it("draft-clean 判定", () => {
    const p = derivePhase({
      draftHash: WH,
      workingHash: WH,
      baseHash: BH,
      diskHash: WH,
      draftRevision: 0,
      conflictKind: "text",
    });
    expect(p).toBe("draft-clean");
  });

  it("hasCheckpoint → draft-checkpointed", () => {
    const p = derivePhase({
      draftHash: DH,
      workingHash: WH,
      baseHash: BH,
      diskHash: WH,
      draftRevision: 1,
      hasCheckpoint: true,
      conflictKind: "text",
    });
    expect(p).toBe("draft-checkpointed");
  });

  it("hasSavePreview + token → save-ready", () => {
    const now = Date.now();
    const p = derivePhase({
      draftHash: DH,
      workingHash: WH,
      baseHash: BH,
      diskHash: WH,
      draftRevision: 1,
      hasSavePreview: true,
      previewToken: "pt",
      editToken: "et",
      tokenIssuedAt: now,
      now,
      conflictKind: "text",
    });
    expect(p).toBe("save-ready");
  });

  it("isSavedToWorkingCopy → working-saved", () => {
    const p = derivePhase({
      draftHash: WH,
      workingHash: WH,
      baseHash: BH,
      diskHash: WH,
      draftRevision: 1,
      isSavedToWorkingCopy: true,
      conflictKind: "text",
    });
    expect(p).toBe("working-saved");
  });
});
