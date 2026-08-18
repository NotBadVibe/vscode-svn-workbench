import { describe, expect, it } from "vitest";
import {
  applyDiffBudget,
  buildAnalysisReceipt,
  buildCandidateId,
  buildCommitDiffFragment,
  buildDiffCoverageSummary,
  buildDiffHashBinding,
  COMMIT_DRAFT_TASK,
  hashText,
  isCommitDraftEvidenceStale,
  scanSensitiveContent,
  splitDiffHunks,
  summarizeCommitDiffCollection,
  validateCommitMessageClaims,
  validateEvidenceReferences,
  type CommitDiffFragment,
  type DiffFileCoverage,
  type EvidenceReference,
} from "../../src/commit/commitDiffEvidence";

/*
 * v0.0.11 有证据的提交说明 —— 纯逻辑域服务：
 * 外发回执、逐文件覆盖率、敏感信息扫描与脱敏、预算裁剪、
 * candidate/hunk identity、证据引用校验与时效绑定。
 */

describe("hashText / buildCandidateId（身份绑定）", () => {
  it("确定性且长度固定，不暴露本地路径", () => {
    expect(hashText("abc")).toBe(hashText("abc"));
    expect(hashText("abc")).toMatch(/^[0-9a-f]{8}$/);
    expect(hashText("不同输入")).not.toBe(hashText("abc"));
    const id = buildCandidateId("/repo/code", "/repo/code/app/a.ts");
    expect(id).toBe(buildCandidateId("/repo/code", "/repo/code/app/a.ts"));
    expect(id).not.toContain("repo");
    expect(id).not.toContain("a.ts");
  });
});

describe("buildAnalysisReceipt（动作级外发回执）", () => {
  it("生成回执全部字段，dataTypes 缺省有中文说明", () => {
    const receipt = buildAnalysisReceipt({
      projectId: "proj-1",
      model: "deepseek-chat",
      files: 3,
      totalBudget: 40000,
      perFileBudget: 6000,
      historyIncluded: false,
    });
    expect(receipt.task).toBe(COMMIT_DRAFT_TASK);
    expect(receipt.projectId).toBe("proj-1");
    expect(receipt.model).toBe("deepseek-chat");
    expect(receipt.files).toBe(3);
    expect(receipt.totalBudget).toBe(40000);
    expect(receipt.perFileBudget).toBe(6000);
    expect(receipt.historyIncluded).toBe(false);
    expect(receipt.dataTypes).toContain("路径、状态、差异片段");
  });

  it("显式 dataTypes 原样保留且不去重破坏顺序", () => {
    const receipt = buildAnalysisReceipt({
      projectId: "p",
      model: "m",
      files: 1,
      totalBudget: 1,
      perFileBudget: 1,
      historyIncluded: true,
      dataTypes: ["路径", "状态", "用户草稿"],
    });
    expect(receipt.dataTypes).toEqual(["路径", "状态", "用户草稿"]);
    expect(receipt.historyIncluded).toBe(true);
  });
});

describe("scanSensitiveContent（敏感信息扫描与脱敏）", () => {
  it("识别并脱敏 API Key、令牌、密码、私钥与连接串", () => {
    const raw = [
      "const key = sk-abcdefghijklmnop123456",
      "token=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345",
      "password: hunter2secret",
      "-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----",
      "mongodb://user:pass@host:27017/db",
      "普通行保持不变",
    ].join("\n");
    const result = scanSensitiveContent(raw);
    expect(result.matches.length).toBeGreaterThanOrEqual(5);
    expect(result.redacted).toContain("[已脱敏]");
    expect(result.redacted).not.toContain("sk-abcdefghijklmnop123456");
    expect(result.redacted).not.toContain(
      "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345",
    );
    expect(result.redacted).not.toContain("hunter2secret");
    expect(result.redacted).not.toContain("BEGIN RSA PRIVATE KEY");
    expect(result.redacted).not.toContain("user:pass@host");
    expect(result.redacted).toContain("普通行保持不变");
  });

  it("无敏感内容时原样返回、无命中", () => {
    const result = scanSensitiveContent("feat: 修复登录超时\n- 调整超时阈值\n");
    expect(result.matches).toEqual([]);
    expect(result.redacted).toBe("feat: 修复登录超时\n- 调整超时阈值\n");
  });

  it("重叠命中合并为一次脱敏，不重复替换", () => {
    // password: 与 secret: 模式可能同时命中同一行，必须合并区间。
    const result = scanSensitiveContent("password: hunter2secret\n");
    const markerCount = result.redacted.split("[已脱敏]").length - 1;
    expect(markerCount).toBe(1);
  });
});

describe("splitDiffHunks（差异块身份）", () => {
  it("解析 @@ 头并生成与内容绑定的 hunkId", () => {
    const content = [
      "--- a/app/a.ts",
      "+++ b/app/a.ts",
      "@@ -1,3 +1,4 @@",
      " 第 1 行",
      "+新增行",
      "@@ -10,2 +11,2 @@",
      " 改前",
      "-删行",
    ].join("\n");
    const hunks = splitDiffHunks(content, "cand-1");
    expect(hunks).toHaveLength(2);
    expect(hunks[0].header).toBe("@@ -1,3 +1,4 @@");
    expect(hunks[1].header).toBe("@@ -10,2 +11,2 @@");
    // 同一输入同身份，不同 candidate 不同身份。
    expect(hunks[0].hunkId).toBe(splitDiffHunks(content, "cand-1")[0].hunkId);
    expect(hunks[0].hunkId).not.toBe(
      splitDiffHunks(content, "cand-2")[0].hunkId,
    );
    // 内容变化后 hunkId 变化（hunk 过期绑定）。
    const changed = content.replace("+新增行", "+其他行");
    expect(splitDiffHunks(changed, "cand-1")[0].hunkId).not.toBe(
      hunks[0].hunkId,
    );
  });

  it("无差异块时返回空数组", () => {
    expect(splitDiffHunks("--- a/x\n+++ b/x\n", "c")).toEqual([]);
  });
});

describe("buildCommitDiffFragment（逐文件片段与覆盖率）", () => {
  const base = {
    candidateId: "cand-1",
    projectRelativePath: "app/a.ts",
    status: "modified",
  };

  it("正常内容：analyzed，含 hunk 与 diff hash，且敏感信息已脱敏", () => {
    const raw = [
      "@@ -1,1 +1,2 @@",
      " key = sk-abcdefghijklmnop123456",
      "+新增配置",
    ].join("\n");
    const { fragment, coverage } = buildCommitDiffFragment({
      ...base,
      rawContent: raw,
      perFileBudget: 10000,
      binary: false,
    });
    expect(fragment).toBeDefined();
    expect(coverage.state).toBe("analyzed");
    expect(fragment?.content).not.toContain("sk-abcdefghijklmnop123456");
    expect(fragment?.content).toContain("[已脱敏]");
    expect(fragment?.hunks).toHaveLength(1);
    expect(fragment?.diffHash).toBe(hashText(fragment!.content));
    expect(coverage.diffHash).toBe(fragment?.diffHash);
    expect(coverage.charCount).toBe(fragment?.content.length);
    expect(coverage.hunkCount).toBe(1);
  });

  it("超单文件预算：截断并标记 truncated", () => {
    const raw = `@@ -1,1 +1,1 @@\n${"x".repeat(200)}`;
    const { fragment, coverage } = buildCommitDiffFragment({
      ...base,
      rawContent: raw,
      perFileBudget: 100,
      binary: false,
    });
    expect(fragment?.truncated).toBe(true);
    expect(coverage.state).toBe("truncated");
    expect(fragment?.content.length).toBeLessThanOrEqual(100);
    expect(coverage.reason).toContain("截断");
  });

  it("二进制：binary coverage，不外发内容", () => {
    const { fragment, coverage } = buildCommitDiffFragment({
      ...base,
      rawContent: "Cannot display: file marked as a binary type.",
      perFileBudget: 1000,
      binary: true,
    });
    expect(fragment).toBeUndefined();
    expect(coverage.state).toBe("binary");
    expect(coverage.charCount).toBe(0);
  });

  it("读取失败：readFailed coverage，携带中文原因", () => {
    const { fragment, coverage } = buildCommitDiffFragment({
      ...base,
      rawContent: "",
      perFileBudget: 1000,
      binary: false,
      readError: "svn diff 读取失败",
    });
    expect(fragment).toBeUndefined();
    expect(coverage.state).toBe("readFailed");
    expect(coverage.reason).toContain("读取失败");
  });
});

describe("applyDiffBudget / buildDiffCoverageSummary / summarize", () => {
  function makeFragment(id: string, size: number): CommitDiffFragment {
    return {
      candidateId: id,
      projectRelativePath: `app/${id}.ts`,
      status: "modified",
      diffHash: hashText("x".repeat(size)),
      content: "x".repeat(size),
      hunks: [],
      truncated: false,
      binary: false,
    };
  }

  it("累计超总预算后其余文件标记 budgetExcluded 且不发正文", () => {
    const { fragments, budgetExcluded } = applyDiffBudget(
      [makeFragment("a", 100), makeFragment("b", 100), makeFragment("c", 100)],
      250,
    );
    expect(fragments.map((f) => f.candidateId)).toEqual(["a", "b"]);
    expect(budgetExcluded).toHaveLength(1);
    expect(budgetExcluded[0].candidateId).toBe("c");
    expect(budgetExcluded[0].state).toBe("budgetExcluded");
    expect(budgetExcluded[0].reason).toContain("总字符预算");
  });

  it("总预算充足时全部保留", () => {
    const { fragments, budgetExcluded } = applyDiffBudget(
      [makeFragment("a", 10), makeFragment("b", 20)],
      1000,
    );
    expect(fragments).toHaveLength(2);
    expect(budgetExcluded).toEqual([]);
  });

  it("buildDiffCoverageSummary 按状态计数", () => {
    const coverage: DiffFileCoverage[] = [
      {
        candidateId: "a",
        projectRelativePath: "a",
        status: "modified",
        state: "analyzed",
        diffHash: "h",
        charCount: 1,
        hunkCount: 1,
      },
      {
        candidateId: "b",
        projectRelativePath: "b",
        status: "added",
        state: "truncated",
        diffHash: "h",
        charCount: 1,
        hunkCount: 1,
      },
      {
        candidateId: "c",
        projectRelativePath: "c",
        status: "deleted",
        state: "binary",
        diffHash: "",
        charCount: 0,
        hunkCount: 0,
      },
      {
        candidateId: "d",
        projectRelativePath: "d",
        status: "modified",
        state: "readFailed",
        diffHash: "",
        charCount: 0,
        hunkCount: 0,
        reason: "x",
      },
      {
        candidateId: "e",
        projectRelativePath: "e",
        status: "modified",
        state: "budgetExcluded",
        diffHash: "",
        charCount: 0,
        hunkCount: 0,
        reason: "x",
      },
    ];
    const summary = buildDiffCoverageSummary(coverage);
    expect(summary).toEqual({
      total: 5,
      analyzed: 1,
      truncated: 1,
      binary: 1,
      readFailed: 1,
      budgetExcluded: 1,
    });
  });

  it("summarizeCommitDiffCollection 汇总片段/覆盖率/revision/排除数", () => {
    const coverage: DiffFileCoverage[] = [
      {
        candidateId: "a",
        projectRelativePath: "a",
        status: "modified",
        state: "analyzed",
        diffHash: "h",
        charCount: 1,
        hunkCount: 1,
      },
      {
        candidateId: "b",
        projectRelativePath: "b",
        status: "modified",
        state: "budgetExcluded",
        diffHash: "",
        charCount: 0,
        hunkCount: 0,
      },
    ];
    const result = summarizeCommitDiffCollection({
      fragments: [],
      coverage,
      revision: "42",
    });
    expect(result.summary.total).toBe(2);
    expect(result.excludedCount).toBe(1);
    expect(result.revision).toBe("42");
  });
});

describe("validateEvidenceReferences（证据引用校验）", () => {
  function makeFragment(id: string, hunkId?: string): CommitDiffFragment {
    return {
      candidateId: id,
      projectRelativePath: `app/${id}.ts`,
      status: "modified",
      diffHash: hashText(id),
      content: "",
      hunks: hunkId ? [{ hunkId, header: "@@ -1,1 +1,1 @@" }] : [],
      truncated: false,
      binary: false,
    };
  }

  const fragments = [makeFragment("cand-a", "hunk-1"), makeFragment("cand-b")];

  it("有效引用全部保留", () => {
    const references: EvidenceReference[] = [
      {
        candidateId: "cand-a",
        hunkId: "hunk-1",
        projectRelativePath: "app/cand-a.ts",
      },
      { candidateId: "cand-b", projectRelativePath: "app/cand-b.ts" },
    ];
    const result = validateEvidenceReferences(references, fragments);
    expect(result.valid).toHaveLength(2);
    expect(result.invalid).toEqual([]);
  });

  it("虚构/范围外候选丢弃并计因", () => {
    const result = validateEvidenceReferences(
      [{ candidateId: "cand-ghost", projectRelativePath: "app/ghost.ts" }],
      fragments,
    );
    expect(result.valid).toEqual([]);
    expect(result.invalid).toHaveLength(1);
    expect(result.invalid[0].reason).toContain("未授权或范围外");
  });

  it("路径与回执不一致丢弃", () => {
    const result = validateEvidenceReferences(
      [
        {
          candidateId: "cand-a",
          projectRelativePath: "app/OTHER.ts",
          hunkId: "hunk-1",
        },
      ],
      fragments,
    );
    expect(result.valid).toEqual([]);
    expect(result.invalid[0].reason).toContain("不一致");
  });

  it("hunk 不在发送集合或已过期丢弃", () => {
    const result = validateEvidenceReferences(
      [
        {
          candidateId: "cand-a",
          hunkId: "stale-hunk",
          projectRelativePath: "app/cand-a.ts",
        },
      ],
      fragments,
    );
    expect(result.valid).toEqual([]);
    expect(result.invalid[0].reason).toContain("差异块");
  });

  it("文件无 hunk 时只按 candidate + 路径校验（hunkId 缺省）", () => {
    const result = validateEvidenceReferences(
      [{ candidateId: "cand-b", projectRelativePath: "app/cand-b.ts" }],
      fragments,
    );
    expect(result.valid).toHaveLength(1);
  });

  it("buildDiffHashBinding 输出 candidateId → diffHash 映射", () => {
    const binding = buildDiffHashBinding(fragments);
    expect(binding["cand-a"]).toBe(hashText("cand-a"));
  });
});

describe("isCommitDraftEvidenceStale（结果时效）", () => {
  it("scope、候选或 revision 任一变化即过期", () => {
    expect(
      isCommitDraftEvidenceStale({
        bindingScopeHash: "s1",
        currentScopeHash: "s2",
        bindingCandidateHash: "c1",
        currentCandidateHash: "c1",
        bindingRevision: "1",
        currentRevision: "1",
      }),
    ).toBe(true);
    expect(
      isCommitDraftEvidenceStale({
        bindingScopeHash: "s1",
        currentScopeHash: "s1",
        bindingCandidateHash: "c1",
        currentCandidateHash: "c2",
        bindingRevision: "1",
        currentRevision: "1",
      }),
    ).toBe(true);
    expect(
      isCommitDraftEvidenceStale({
        bindingScopeHash: "s1",
        currentScopeHash: "s1",
        bindingCandidateHash: "c1",
        currentCandidateHash: "c1",
        bindingRevision: "1",
        currentRevision: "2",
      }),
    ).toBe(true);
  });

  it("全部一致时不过期；revision 缺省时不因缺省判过期", () => {
    expect(
      isCommitDraftEvidenceStale({
        bindingScopeHash: "s1",
        currentScopeHash: "s1",
        bindingCandidateHash: "c1",
        currentCandidateHash: "c1",
        bindingRevision: "1",
        currentRevision: "1",
      }),
    ).toBe(false);
    // 当前 revision 不可用时（如 SVN 不可用）不把结果误判过期。
    expect(
      isCommitDraftEvidenceStale({
        bindingScopeHash: "s1",
        currentScopeHash: "s1",
        bindingCandidateHash: "c1",
        currentCandidateHash: "c1",
        bindingRevision: "1",
        currentRevision: undefined,
      }),
    ).toBe(false);
  });
});

describe("validateCommitMessageClaims（§5 声明逐条校验与强制降级）", () => {
  function makeFragment(id: string, hunkId?: string): CommitDiffFragment {
    return {
      candidateId: id,
      projectRelativePath: `app/${id}.ts`,
      status: "modified",
      diffHash: hashText(id),
      content: "",
      hunks: hunkId ? [{ hunkId, header: "@@ -1,1 +1,1 @@" }] : [],
      truncated: false,
      binary: false,
    };
  }
  const fragments = [makeFragment("cand-a", "hunk-1")];
  const confirmedRef = {
    candidateId: "cand-a",
    hunkId: "hunk-1",
    projectRelativePath: "app/cand-a.ts",
  };
  const ghostRef = {
    candidateId: "cand-ghost",
    projectRelativePath: "app/ghost.ts",
  };

  it("confirmed + 有效证据保持 confirmed，且证据保留有效引用", () => {
    const { claims, downgradeCount } = validateCommitMessageClaims(
      [
        {
          text: "调整登录超时阈值",
          status: "confirmed",
          evidence: [confirmedRef],
        },
      ],
      fragments,
    );
    expect(claims[0].status).toBe("confirmed");
    expect(claims[0].downgraded).toBe(false);
    expect(claims[0].evidence).toHaveLength(1);
    expect(downgradeCount).toBe(0);
  });

  it("confirmed + 无任何有效证据 → 强制降级为 toConfirm 并计降级", () => {
    const { claims, downgradeCount } = validateCommitMessageClaims(
      [{ text: "改变接口语义", status: "confirmed", evidence: [ghostRef] }],
      fragments,
    );
    expect(claims[0].status).toBe("toConfirm");
    expect(claims[0].downgraded).toBe(true);
    expect(claims[0].evidence).toEqual([]);
    expect(claims[0].invalidEvidence).toHaveLength(1);
    expect(downgradeCount).toBe(1);
  });

  it("confirmed + 至少一条有效证据即使含无效引用也保持 confirmed", () => {
    const { claims, downgradeCount } = validateCommitMessageClaims(
      [
        {
          text: "新增配置项",
          status: "confirmed",
          evidence: [confirmedRef, ghostRef],
        },
      ],
      fragments,
    );
    expect(claims[0].status).toBe("confirmed");
    expect(claims[0].evidence).toHaveLength(1);
    expect(claims[0].invalidEvidence).toHaveLength(1);
    expect(downgradeCount).toBe(0);
  });

  it("inferred / toConfirm 不因有证据而升级；无证据保持原状", () => {
    const { claims, downgradeCount } = validateCommitMessageClaims(
      [
        { text: "推断影响", status: "inferred", evidence: [confirmedRef] },
        { text: "待确认内容", status: "toConfirm" },
      ],
      fragments,
    );
    expect(claims[0].status).toBe("inferred");
    expect(claims[1].status).toBe("toConfirm");
    expect(downgradeCount).toBe(0);
  });

  it("空 claims 返回空结果不报错", () => {
    const { claims, downgradeCount } = validateCommitMessageClaims(
      [],
      fragments,
    );
    expect(claims).toEqual([]);
    expect(downgradeCount).toBe(0);
  });
});
