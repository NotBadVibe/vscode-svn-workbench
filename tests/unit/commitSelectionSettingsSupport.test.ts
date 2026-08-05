/**
 * commitSelectionSettingsSupport 单元测试（v0.0.3 阶段 3）：
 * 设置快照段构建、保存前完整校验（含遮蔽检测）、commitSelection 键对象级合并。
 * 规划依据：docs/releases/v0.0.3/README.md 第 4.1、5.3、6、7.4 节。
 */
import { describe, expect, it } from "vitest";
import { resolveCommitSelectionRules } from "../../src/commit/commitSelectionRuleResolver";
import type { CommitSelectionPreviewCandidate } from "../../src/commit/commitSelectionSettingsSupport";
import {
  buildCommitSelectionSettingsSection,
  mergeCommitSelectionForSave,
  validateCommitSelectionSaveInput,
} from "../../src/commit/commitSelectionSettingsSupport";

describe("validateCommitSelectionSaveInput", () => {
  it("合法输入通过校验并补齐 version", () => {
    const verdict = validateCommitSelectionSaveInput(
      {
        statusRules: { unversioned: "recommended" },
        pathRules: [
          {
            id: "team-vendor",
            enabled: true,
            pattern: "vendor/**",
            decision: "excluded",
            reason: "第三方目录",
          },
        ],
      },
      {},
    );
    expect(verdict.ok).toBe(true);
    expect(verdict.errors).toEqual([]);
    expect(verdict.config).toMatchObject({
      version: 1,
      statusRules: { unversioned: "recommended" },
    });
    expect(verdict.config?.pathRules?.[0].id).toBe("team-vendor");
  });

  it("非法决策值与重复规则 ID 拒绝保存并返回结构化中文错误", () => {
    const badDecision = validateCommitSelectionSaveInput(
      { statusRules: { modified: "blocked" } },
      {},
    );
    expect(badDecision.ok).toBe(false);
    expect(badDecision.errors.some((e) => e.includes("blocked"))).toBe(true);

    const duplicated = validateCommitSelectionSaveInput(
      {
        pathRules: [
          { id: "dup", pattern: "a/**", decision: "excluded" },
          { id: "dup", pattern: "b/**", decision: "excluded" },
        ],
      },
      {},
    );
    expect(duplicated.ok).toBe(false);
    expect(duplicated.errors.some((e) => e.includes("重复"))).toBe(true);
  });

  it("非法 Glob 与非对象数据拒绝保存", () => {
    const badGlob = validateCommitSelectionSaveInput(
      {
        pathRules: [
          { id: "bad", pattern: "C:\\abs\\**", decision: "excluded" },
        ],
      },
      {},
    );
    expect(badGlob.ok).toBe(false);
    expect(badGlob.errors.length).toBeGreaterThan(0);

    const notRecord = validateCommitSelectionSaveInput("nonsense", {});
    expect(notRecord.ok).toBe(false);
    expect(notRecord.errors).toEqual(["保存请求缺少配置数据。"]);
  });

  it("用户/工作区作用域的保存请求被拒绝", () => {
    const verdict = validateCommitSelectionSaveInput(
      { scope: "workspace", statusRules: { normal: "needsReview" } },
      {},
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.errors[0]).toContain("只支持保存仓库级规则");
  });

  it("被前置更宽规则遮蔽的规则产生警告但不阻止保存", () => {
    const verdict = validateCommitSelectionSaveInput(
      {
        pathRules: [
          { id: "wide", pattern: "logs/**", decision: "excluded" },
          { id: "narrow", pattern: "logs/debug/**", decision: "needsReview" },
        ],
      },
      {},
    );
    expect(verdict.ok).toBe(true);
    expect(
      verdict.warnings.some(
        (w) => w.includes("narrow") && w.includes("遮蔽") && w.includes("wide"),
      ),
    ).toBe(true);
  });

  it("合并用户与工作区层配置后评估遮蔽与上限警告", () => {
    const verdict = validateCommitSelectionSaveInput(
      {
        pathRules: [
          { id: "team-logs", pattern: "logs/**", decision: "excluded" },
        ],
      },
      {
        user: {
          pathRules: [
            { id: "user-logs", pattern: "logs/**", decision: "needsReview" },
          ],
        },
      },
    );
    expect(verdict.ok).toBe(true);
    // 仓库层自定义规则排在用户层之前，用户层同 pattern 规则被遮蔽。
    expect(
      verdict.warnings.some(
        (w) => w.includes("user-logs") && w.includes("遮蔽"),
      ),
    ).toBe(true);
  });
});

describe("mergeCommitSelectionForSave", () => {
  it("保留 commitSelection 内部未知字段，覆盖已知字段", () => {
    const merged = mergeCommitSelectionForSave(
      {
        version: 1,
        experimentalFutureFlag: { enabled: true },
        statusRules: { modified: "excluded" },
        pathRules: [{ id: "old", pattern: "old/**", decision: "excluded" }],
      },
      {
        version: 1,
        statusRules: { modified: "recommended" },
        pathRules: [{ id: "new", pattern: "new/**", decision: "needsReview" }],
      },
    );
    expect(merged).toEqual({
      version: 1,
      experimentalFutureFlag: { enabled: true },
      statusRules: { modified: "recommended" },
      pathRules: [{ id: "new", pattern: "new/**", decision: "needsReview" }],
    });
  });

  it("statusRules 中未识别的状态键保留，已识别键以保存内容为准", () => {
    const merged = mergeCommitSelectionForSave(
      {
        statusRules: {
          modified: "excluded",
          futureStatusKey: "needsReview",
        },
      },
      { version: 1, statusRules: { modified: "recommended" } },
    );
    expect(merged.statusRules).toEqual({
      futureStatusKey: "needsReview",
      modified: "recommended",
    });
  });

  it("保存内容缺少已知字段时删除旧值而不是残留", () => {
    const merged = mergeCommitSelectionForSave(
      {
        version: 1,
        statusRules: { modified: "excluded" },
        pathRules: [{ id: "old", pattern: "old/**", decision: "excluded" }],
      },
      { version: 1, pathRules: [] },
    );
    expect(merged.statusRules).toBeUndefined();
    expect(merged.pathRules).toEqual([]);
  });

  it("既有配置不是对象时直接采用新配置", () => {
    const merged = mergeCommitSelectionForSave("corrupted", {
      version: 1,
      statusRules: { normal: "needsReview" },
    });
    expect(merged).toEqual({
      version: 1,
      statusRules: { normal: "needsReview" },
    });
  });
});

describe("buildCommitSelectionSettingsSection", () => {
  const candidates: CommitSelectionPreviewCandidate[] = [
    {
      relativePath: "src/a.ts",
      status: "modified",
      evaluation: {
        decision: "recommended",
        reasonKey: "statusPolicy",
        statusPolicyKey: "modified",
        safetyLocked: false,
      },
    },
    {
      relativePath: "dist/app.js",
      status: "unversioned",
      evaluation: {
        decision: "excluded",
        reasonKey: "pathRule",
        matchedRuleId: "generated-dist",
        ruleSource: "builtin",
        safetyLocked: false,
      },
    },
    {
      relativePath: "src/conflict.ts",
      status: "conflicted",
      evaluation: {
        decision: "blocked",
        reasonKey: "safetyBlocked",
        safetyLocked: true,
      },
    },
    {
      relativePath: "README.md",
      status: "normal",
      propStatus: "modified",
      evaluation: {
        decision: "recommended",
        reasonKey: "statusPolicy",
        statusPolicyKey: "propertyModified",
        safetyLocked: false,
      },
    },
  ];

  it("映射作用域、分层配置、有效合并结果与预览条目", () => {
    const resolved = resolveCommitSelectionRules({
      repository: { statusRules: { unversioned: "recommended" } },
    });
    const section = buildCommitSelectionSettingsSection({
      resolved,
      candidates,
    });

    expect(section.editingScope).toBe("repository");
    expect(section.configPath).toBe(".svn-workbench.json");
    expect(section.layers.user.editable).toBe(false);
    expect(section.layers.workspace.editable).toBe(false);
    expect(section.layers.repository.editable).toBe(true);
    expect(section.layers.repository.state).toBe("applied");
    expect(section.layers.repository.config?.statusRules).toEqual({
      unversioned: "recommended",
    });
    expect(section.effective.statusRules.unversioned).toBe("recommended");
    expect(section.effective.pathRules.length).toBeGreaterThan(0);
    expect(
      section.effective.pathRules.every((rule) => Boolean(rule.source)),
    ).toBe(true);

    expect(section.preview.state).toBe("ready");
    expect(section.preview.items).toHaveLength(4);
    // 预览条目保留评估来源与安全锁定标记。
    expect(section.preview.items[1]).toMatchObject({
      relativePath: "dist/app.js",
      decision: "excluded",
      matchedRuleId: "generated-dist",
      ruleSource: "builtin",
      safetyLocked: false,
    });
    expect(section.preview.items[2]).toMatchObject({
      decision: "blocked",
      reasonKey: "safetyBlocked",
      safetyLocked: true,
    });
    // 仅属性变化候选携带 (status, propStatus) 二元组与命中策略键。
    expect(section.preview.items[3]).toMatchObject({
      status: "normal",
      propStatus: "modified",
      statusPolicyKey: "propertyModified",
    });
  });

  it("层校验失败时保留错误状态，警告与错误原样进入快照", () => {
    const resolved = resolveCommitSelectionRules({
      repository: { statusRules: { modified: "blocked" } },
    });
    const section = buildCommitSelectionSettingsSection({
      resolved,
      candidates: [],
    });
    expect(section.layers.repository.state).toBe("failed");
    expect(section.layers.repository.errors.length).toBeGreaterThan(0);
    expect(section.errors.length).toBeGreaterThan(0);
    // 配置损坏/失败时回退内置默认，快照仍给出完整有效规则。
    expect(section.effective.statusRules.modified).toBe("recommended");
  });

  it("空候选为可恢复空状态，采集失败为结构化错误状态", () => {
    const resolved = resolveCommitSelectionRules({});
    const empty = buildCommitSelectionSettingsSection({
      resolved,
      candidates: [],
    });
    expect(empty.preview).toEqual({ state: "empty", items: [] });

    const failed = buildCommitSelectionSettingsSection({
      resolved,
      previewError: "无法采集当前仓库候选文件：svn 可执行文件不可用。",
    });
    expect(failed.preview.state).toBe("error");
    expect(failed.preview.error).toContain("无法采集当前仓库候选文件");
    expect(failed.preview.items).toEqual([]);
  });

  it("反馈与保存拒绝错误按协议透传，空错误列表省略", () => {
    const resolved = resolveCommitSelectionRules({});
    const section = buildCommitSelectionSettingsSection({
      resolved,
      candidates: [],
      feedback: {
        tone: "error",
        message: "保存被拒绝：提交选择规则校验失败。",
      },
      saveErrors: ["当前仓库 commitSelection.pathRules[0] 的规则 ID 无效。"],
    });
    expect(section.feedback).toEqual({
      tone: "error",
      message: "保存被拒绝：提交选择规则校验失败。",
    });
    expect(section.saveErrors).toHaveLength(1);

    const clean = buildCommitSelectionSettingsSection({
      resolved,
      candidates: [],
      saveErrors: [],
    });
    expect(clean.saveErrors).toBeUndefined();
    expect(clean.feedback).toBeUndefined();
  });
});
