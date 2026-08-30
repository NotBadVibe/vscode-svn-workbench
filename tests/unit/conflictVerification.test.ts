/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import {
  MANUAL_CHECKS,
  runDeterministicVerification,
  verificationToCompletionEvent,
  type DeterministicVerificationInput,
} from "../../src/conflict/conflictVerification";
import { CONFLICT_COMPLETION_TOKEN_TTL_MS } from "../../src/conflict/conflictCompletionModel";

function baseInput(
  overrides: Partial<DeterministicVerificationInput> = {},
): DeterministicVerificationInput {
  const now = Date.now();
  return {
    workingText: "hello world\n",
    fileMeta: { isRegularFile: true, isWritable: true, isDecodableText: true },
    scopeMeta: { inScope: true, inWorkingCopy: true, inRepository: true },
    diskHash: "hash-abc",
    savedHash: "hash-abc",
    svnMeta: { isConflicted: true, canResolve: true },
    previewMeta: { tokenIssuedAt: now - 1000, now, hasPreview: true },
    draftMeta: { hasUnsavedInput: false },
    checkedAt: now,
    ...overrides,
  };
}

describe("V013-C 确定性核验 7 项全部通过", () => {
  it("7 项皆 pass 时整体 pass 且无阻断", () => {
    const result = runDeterministicVerification(baseInput());
    expect(result.pass).toBe(true);
    expect(result.issues.length).toBe(7);
    for (const iss of result.issues) {
      expect(iss.pass).toBe(true);
      expect(iss.reason.length).toBeGreaterThan(0);
    }
    expect(result.checkedAt).toBeDefined();
  });
});

describe("V013-C 逐项阻断", () => {
  it("1 marker 残留阻断（非空 regions）", () => {
    const markerText = "a\n<<<<<<< .mine\nmy\n=======\ntheirs\n>>>>>>> .r10\n";
    const result = runDeterministicVerification(
      baseInput({ workingText: markerText }),
    );
    const m = result.issues.find((x) => x.id === "marker")!;
    expect(m.pass).toBe(false);
    expect(m.reason).toContain("冲突标记");
    expect(result.pass).toBe(false);
  });

  it("1 marker 解析错误阻断", () => {
    const bad = "<<<<<<< .mine\nno separator\n>>>>>>> .r1\n";
    const result = runDeterministicVerification(
      baseInput({ workingText: bad }),
    );
    const m = result.issues.find((x) => x.id === "marker")!;
    expect(m.pass).toBe(false);
    expect(result.pass).toBe(false);
  });

  it("2 文件类型：非普通文件阻断", () => {
    const result = runDeterministicVerification(
      baseInput({
        fileMeta: {
          isRegularFile: false,
          isWritable: true,
          isDecodableText: true,
          detail: "symlink",
        },
      }),
    );
    const f = result.issues.find((x) => x.id === "fileType")!;
    expect(f.pass).toBe(false);
    expect(f.reason).toContain("普通文件");
    expect(result.pass).toBe(false);
  });

  it("2 文件类型：不可写阻断", () => {
    const result = runDeterministicVerification(
      baseInput({
        fileMeta: {
          isRegularFile: true,
          isWritable: false,
          isDecodableText: true,
        },
      }),
    );
    expect(result.issues.find((x) => x.id === "fileType")!.pass).toBe(false);
    expect(result.pass).toBe(false);
  });

  it("2 文件类型：不可解码文本阻断", () => {
    const result = runDeterministicVerification(
      baseInput({
        fileMeta: {
          isRegularFile: true,
          isWritable: true,
          isDecodableText: false,
          detail: "二进制",
        },
      }),
    );
    const f = result.issues.find((x) => x.id === "fileType")!;
    expect(f.pass).toBe(false);
    expect(f.reason).toContain("可解码");
    expect(result.pass).toBe(false);
  });

  it("3 scope 移出阻断", () => {
    const result = runDeterministicVerification(
      baseInput({
        scopeMeta: { inScope: false, inWorkingCopy: true, inRepository: true },
      }),
    );
    expect(result.issues.find((x) => x.id === "scope")!.pass).toBe(false);
    expect(result.pass).toBe(false);
  });

  it("3 working copy 变化阻断", () => {
    const result = runDeterministicVerification(
      baseInput({
        scopeMeta: { inScope: true, inWorkingCopy: false, inRepository: true },
      }),
    );
    expect(result.issues.find((x) => x.id === "scope")!.pass).toBe(false);
  });

  it("3 repository 变化阻断", () => {
    const result = runDeterministicVerification(
      baseInput({
        scopeMeta: { inScope: true, inWorkingCopy: true, inRepository: false },
      }),
    );
    expect(result.issues.find((x) => x.id === "scope")!.pass).toBe(false);
  });

  it("4 diskHash 不一致阻断", () => {
    const result = runDeterministicVerification(
      baseInput({ diskHash: "a", savedHash: "b" }),
    );
    const d = result.issues.find((x) => x.id === "diskHash")!;
    expect(d.pass).toBe(false);
    expect(d.reason).toContain("磁盘");
    expect(result.pass).toBe(false);
  });

  it("5 SVN 状态非冲突阻断", () => {
    const result = runDeterministicVerification(
      baseInput({ svnMeta: { isConflicted: false, canResolve: true } }),
    );
    expect(result.issues.find((x) => x.id === "svnStatus")!.pass).toBe(false);
    expect(result.pass).toBe(false);
  });

  it("5 SVN 状态不可 resolve 阻断", () => {
    const result = runDeterministicVerification(
      baseInput({ svnMeta: { isConflicted: true, canResolve: false } }),
    );
    expect(result.issues.find((x) => x.id === "svnStatus")!.pass).toBe(false);
  });

  it("6 preview 过期阻断（token 超时）", () => {
    const now = Date.now();
    const past = now - CONFLICT_COMPLETION_TOKEN_TTL_MS - 1000;
    const result = runDeterministicVerification(
      baseInput({
        previewMeta: { tokenIssuedAt: past, now, hasPreview: true },
      }),
    );
    expect(result.issues.find((x) => x.id === "preview")!.pass).toBe(false);
    expect(result.pass).toBe(false);
  });

  it("6 preview 缺失阻断", () => {
    const now = Date.now();
    const result = runDeterministicVerification(
      baseInput({ previewMeta: { now, hasPreview: false } }),
    );
    expect(result.issues.find((x) => x.id === "preview")!.pass).toBe(false);
  });

  it("6 preview token 缺失阻断", () => {
    const now = Date.now();
    const result = runDeterministicVerification(
      baseInput({ previewMeta: { now, hasPreview: true } as any }),
    );
    expect(result.issues.find((x) => x.id === "preview")!.pass).toBe(false);
  });

  it("7 草稿未保存阻断", () => {
    const result = runDeterministicVerification(
      baseInput({ draftMeta: { hasUnsavedInput: true } }),
    );
    expect(result.issues.find((x) => x.id === "draft")!.pass).toBe(false);
    expect(result.issues.find((x) => x.id === "draft")!.reason).toContain(
      "未保存",
    );
    expect(result.pass).toBe(false);
  });
});

describe("V013-C 任一失败整体 blocked 且中文原因", () => {
  it("多项失败时 issues 列全部中文原因", () => {
    const now = Date.now();
    const past = now - CONFLICT_COMPLETION_TOKEN_TTL_MS - 1000;
    const result = runDeterministicVerification(
      baseInput({
        workingText: "<<<<<<< .mine\nx\n=======\ny\n>>>>>>> .r1\n",
        diskHash: "a",
        savedHash: "b",
        previewMeta: { tokenIssuedAt: past, now, hasPreview: true },
        draftMeta: { hasUnsavedInput: true },
      }),
    );
    expect(result.pass).toBe(false);
    const blocked = result.issues.filter((x) => !x.pass);
    expect(blocked.length).toBeGreaterThanOrEqual(4);
    for (const b of blocked) {
      expect(b.reason.length).toBeGreaterThan(0);
    }
  });
});

describe("V013-C manualChecks 独立不混入", () => {
  it("manualChecks 固定且不混入 issues", () => {
    const result = runDeterministicVerification(baseInput());
    expect(result.manualChecks.length).toBeGreaterThan(0);
    for (const m of result.manualChecks) {
      expect(m.label).toBe("需人工确认");
      expect(m.description.length).toBeGreaterThan(0);
    }
    // 不混入：issues 的 id 仅 7 项确定性检查
    const issueIds = new Set(result.issues.map((x) => x.id));
    for (const mc of result.manualChecks) {
      expect(issueIds.has(mc.id as any)).toBe(false);
    }
  });

  it("即使全部 deterministic pass，manualChecks 仍存在且不影响 pass", () => {
    const result = runDeterministicVerification(baseInput());
    expect(result.pass).toBe(true);
    expect(result.manualChecks.length).toBe(MANUAL_CHECKS.length);
  });

  it("阻断时 manualChecks 仍独立", () => {
    const result = runDeterministicVerification(
      baseInput({ draftMeta: { hasUnsavedInput: true } }),
    );
    expect(result.pass).toBe(false);
    expect(result.manualChecks.length).toBe(MANUAL_CHECKS.length);
  });
});

describe("V013-C verificationToCompletionEvent 转换", () => {
  it("pass → verification-pass 事件", () => {
    const r = runDeterministicVerification(baseInput());
    const ev = verificationToCompletionEvent(r);
    expect(ev.type).toBe("verificationRun");
    expect(ev.result).toBe("pass");
    expect(ev.issues).toBeUndefined();
  });

  it("blocked → verification-blocked 且携带中文原因", () => {
    const result = runDeterministicVerification(
      baseInput({ workingText: "<<<<<<< .mine\nx\n=======\ny\n>>>>>>> .r1\n" }),
    );
    const ev = verificationToCompletionEvent(result);
    expect(ev.result).toBe("blocked");
    expect(ev.issues).toBeDefined();
    expect(ev.issues!.length).toBeGreaterThan(0);
    for (const s of ev.issues!) expect(s.length).toBeGreaterThan(0);
  });

  it("多项 blocked 时 issues 为所有未通过项 reason", () => {
    const result = runDeterministicVerification(
      baseInput({
        diskHash: "a",
        savedHash: "b",
        draftMeta: { hasUnsavedInput: true },
      }),
    );
    const ev = verificationToCompletionEvent(result);
    expect(ev.result).toBe("blocked");
    const blockedReasons = result.issues
      .filter((x) => !x.pass)
      .map((x) => x.reason);
    expect(ev.issues).toEqual(blockedReasons);
  });
});

describe("V013-C fail-closed", () => {
  it("输入缺失时拒绝通过", () => {
    const result = runDeterministicVerification(undefined as any);
    expect(result.pass).toBe(false);
    expect(result.issues.some((x) => !x.pass)).toBe(true);
  });

  it("workingText 非字符串 fail-closed", () => {
    const result = runDeterministicVerification(
      baseInput({ workingText: null as any }),
    );
    expect(result.pass).toBe(false);
    expect(result.issues.find((x) => x.id === "marker")!.pass).toBe(false);
  });

  it("关键 fact 缺失时各对应项阻断", () => {
    const input = {
      workingText: "ok\n",
      fileMeta: undefined as any,
      scopeMeta: undefined as any,
      diskHash: undefined as any,
      savedHash: undefined as any,
      svnMeta: undefined as any,
      previewMeta: undefined as any,
      draftMeta: undefined as any,
    } as any;
    const result = runDeterministicVerification(input);
    expect(result.pass).toBe(false);
    // 7 项应均为 block（marker 可能因文本正常而 pass，但其余缺失必 block）
    const blocked = result.issues.filter((x) => !x.pass);
    expect(blocked.length).toBeGreaterThanOrEqual(5);
  });
});

describe("V013-C 性能 ≤300ms", () => {
  it("纯计算在 300ms 内完成", () => {
    const start = Date.now();
    for (let i = 0; i < 100; i += 1) {
      runDeterministicVerification(baseInput());
    }
    const elapsed = Date.now() - start;
    // 100 次在 300ms 内说明单次远小于 300ms（纯计算）
    expect(elapsed).toBeLessThan(300);
  });
});
