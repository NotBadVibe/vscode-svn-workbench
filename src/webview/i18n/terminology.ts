import type {
  WorkbenchFileStatus,
  WorkbenchTaskId,
} from "@protocol/workbenchProtocol";
import type {
  CommitSelectionDecision,
  CommitSelectionExplanation,
  CommitSelectionReasonKey,
  CommitSelectionRuleSource,
  CommitSelectionStatusKey,
} from "../../commit/commitSelectionRules";

export const fileStatusLabels: Record<WorkbenchFileStatus, string> = {
  normal: "正常",
  modified: "已修改",
  added: "已新增",
  deleted: "已删除",
  missing: "文件缺失",
  unversioned: "未版本化",
  conflicted: "存在冲突",
  ignored: "已忽略",
  external: "外部工作副本",
  obstructed: "路径受阻",
  replaced: "已替换",
  incomplete: "状态不完整",
  unknown: "未知状态",
};

export const sourceLabels = {
  "local-rule": "本地规则",
  "configured-model": "已配置模型",
  "local-rule-fallback": "本地规则降级",
} as const;

export const confidenceLabels = {
  low: "低置信度",
  medium: "中置信度",
  high: "高置信度",
} as const;

export const riskLabels = {
  low: "低风险",
  medium: "中风险",
  high: "高风险",
} as const;

export const findingCategoryLabels = {
  security: "安全",
  debug: "调试残留",
  generated: "生成文件",
  quality: "代码质量",
  testing: "测试覆盖",
} as const;

export const taskLabels: Record<WorkbenchTaskId, string> = {
  "changes/overview": "工作副本修改",
  "commit/compose": "提交当前范围",
  "diff/working": "查看本地修改",
  "history/revisions": "查看历史记录",
  "conflicts/resolve": "处理文件冲突",
  "changelists/manage": "管理变更集",
  "ai-review/review": "AI 变更审查",
  "impact/analyze": "分析影响与测试",
  "agent/plan": "受控 AI 任务代理",
  "repository/update": "更新当前范围",
  "repository/recovery": "清理与恢复工作副本",
  "repository/browse": "浏览 SVN 仓库",
  "repository/branch": "创建 SVN 分支",
  "repository/tag": "创建 SVN 标签",
  "repository/switch": "切换工作副本",
  "repository/relocate": "重定位仓库地址",
  "repository/merge": "合并到工作副本",
  "repository/patch-shelf": "补丁与本地搁置",
  "repository/release-notes": "生成发布说明",
  "repository/properties": "查看与编辑 SVN 属性",
  "settings/ai": "AI 模型设置",
  "settings/team": "团队提交规范",
  "settings/svn": "SVN 安全设置",
  "settings/selection": "提交选择规则",
  "diagnostics/environment": "环境诊断",
  "diagnostics/acceptance": "验收清单",
};

export function fileStatusLabel(status: WorkbenchFileStatus): string {
  return fileStatusLabels[status];
}

/** 提交选择规则的最终决策（v0.0.3）。界面只显示中文决策，不暴露内部枚举值。 */
export const commitSelectionDecisionLabels: Record<
  CommitSelectionDecision,
  string
> = {
  recommended: "推荐提交",
  needsReview: "需要确认",
  excluded: "排除",
  blocked: "阻止提交",
};

/** 提交选择规则的来源层级。 */
export const commitSelectionRuleSourceLabels: Record<
  CommitSelectionRuleSource,
  string
> = {
  builtin: "内置默认",
  user: "用户默认",
  workspace: "当前工作区",
  repository: "当前仓库",
};

/** 可配置状态策略键的中文名称；propertyModified 表示仅 SVN 属性变化。 */
export const commitSelectionStatusKeyLabels: Record<
  CommitSelectionStatusKey,
  string
> = {
  modified: "已修改",
  added: "已新增",
  deleted: "已删除",
  replaced: "已替换",
  propertyModified: "仅 SVN 属性变更",
  missing: "文件缺失",
  unversioned: "未纳入版本控制",
  unknown: "未知状态",
  normal: "无修改（normal）",
};

/** 预览条目最终决策的原因说明。 */
export const commitSelectionReasonKeyLabels: Record<
  CommitSelectionReasonKey,
  string
> = {
  safetyBlocked: "安全规则：始终阻止提交",
  safetyExternal: "安全规则：外部工作副本不能进入当前仓库提交",
  safetyIgnored: "安全规则：已忽略路径不能通过建议选择隐式加入 SVN",
  pathRule: "命中路径规则",
  statusPolicy: "按状态默认策略",
};

/** 不可覆盖的安全结果标记（规划 4.3：安全锁定不只靠颜色表达）。 */
export const commitSelectionSafetyLockedLabel = "安全锁定";

/** 提交页 AI 选择建议的来源状态文案（规划 4.2、6.3）。 */
export const commitSelectionAiSourceLabels = {
  failed: "AI 失败",
  staleBadge: "结果已过期",
  staleHint:
    "范围或候选已变化，该结果只能查看，不能直接采用；请重新获取 AI 建议。",
} as const;

/**
 * 提交页候选决策依据的完整中文描述（规划 4.3）：
 * 最终决策 · 决策原因（命中规则及来源 / 状态默认策略 / 安全规则）· 安全锁定。
 * 文案统一收口在此处，提交页与设置预览不各自拼字符串。
 */
export function describeCommitSelectionEvaluation(
  evaluation: CommitSelectionExplanation,
): string {
  const parts: string[] = [commitSelectionDecisionLabels[evaluation.decision]];
  if (evaluation.reasonKey === "pathRule") {
    const source = evaluation.ruleSource
      ? commitSelectionRuleSourceLabels[evaluation.ruleSource]
      : "未知来源";
    parts.push(
      `${commitSelectionReasonKeyLabels.pathRule} ${evaluation.matchedRuleId ?? ""}（${source}）`.trim(),
    );
  } else if (evaluation.reasonKey === "statusPolicy") {
    const statusLabel = evaluation.statusPolicyKey
      ? commitSelectionStatusKeyLabels[evaluation.statusPolicyKey]
      : "未知状态";
    parts.push(
      `${commitSelectionReasonKeyLabels.statusPolicy}：${statusLabel}`,
    );
  } else {
    parts.push(commitSelectionReasonKeyLabels[evaluation.reasonKey]);
  }
  if (evaluation.safetyLocked) {
    parts.push(commitSelectionSafetyLockedLabel);
  }
  return parts.join(" · ");
}
