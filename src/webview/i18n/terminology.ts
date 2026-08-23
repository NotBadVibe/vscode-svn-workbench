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

/**
 * v0.0.18 批次 B（C-05）：状态词就地解释——每个状态词说明“这意味着
 * 什么、对提交/更新有什么影响”，一条一句话，不引入平行术语。
 */
export const statusExplanations: Record<WorkbenchFileStatus, string> = {
  normal: "文件内容与 SVN 记录一致，没有本地修改。",
  modified: "文件已在本地修改，尚未提交到仓库。",
  added: "文件已加入版本控制，下次提交时进入仓库。",
  deleted: "文件已标记删除，下次提交会从仓库移除。",
  missing:
    "SVN 记录中有此文件，但工作副本里找不到；可能被外部删除或移动，可还原恢复。",
  unversioned: "文件不在版本控制内；需要先加入版本控制才能提交。",
  conflicted:
    "更新或合并时双方修改了同一处，需要人工解决冲突后才能提交或更新。",
  ignored: "路径命中忽略规则（svn:ignore），不会进入常规提交候选。",
  external:
    "路径来自 svn:externals 引用的另一个仓库，是独立的工作副本边界，不能并入当前仓库的提交。",
  obstructed:
    "工作副本中该路径被不同类型的对象阻挡（例如文件占住了目录位置），SVN 操作无法继续。",
  replaced: "文件先删除后又重新加入版本控制，下次提交按“替换”记录。",
  incomplete:
    "上次检出或更新未完成，该目录的子项可能缺失；建议先更新补全再操作。",
  unknown: "未能识别的 SVN 状态；请刷新状态，持续出现可运行环境诊断。",
};

/** 选择建议（决策）的就地解释；键与协议 selection 字面量一致。 */
export const selectionDecisionExplanations = {
  selected: "本地规则按状态策略推荐提交该文件。",
  needsReview:
    "本地规则无法单独判断（例如未版本化或仅属性变化），请人工确认后再决定。",
  excluded: "命中排除规则（路径规则或状态策略），默认不进入提交。",
  blocked:
    "安全规则阻止提交（例如冲突未解决、外部工作副本）；该结果不可被建议覆盖。",
} as const;

/** 更新风险等级的就地解释。 */
export const riskExplanations = {
  low: "未发现本地修改与远端更新的同路径重叠，更新通常安全。",
  medium: "存在同路径重叠或其他风险信号，更新前请核对重叠路径清单。",
  high: "本地修改与远端更新高度重叠，冲突可能性大；建议先处理本地修改再更新。",
} as const;

/**
 * 结果来源统一文案（v0.0.9 §3.1）：
 * - local-rule：未外发、可重复验证的本地规则，统一称“本地检查”；
 * - configured-model：基于明确回执中的数据生成，称“模型建议”；
 * - local-rule-fallback：模型不可用时保留本地结果，必须完整标注，不得简称“AI 分析”。
 */
export const sourceLabels = {
  "local-rule": "本地检查",
  "configured-model": "模型建议",
  "local-rule-fallback": "模型不可用，已保留本地结果",
} as const;

/** v0.0.9 §5：页面首屏“运行本地规则还是外部模型”的统一说明。 */
export const localOnlyEngineLabel = "本地规则引擎";

/** v0.0.9 §5：纯本地能力不得表述为“AI 已审查 / 智能分析”。 */
export const localPurposeHeading = {
  split: "按目录和文件类型分组",
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

/** v0.0.12：变更解读专项术语。 */
export const understandingLabels = {
  task: "变更解读",
  action: "解读所选变更",
  purpose: "理解当前修改、找出需要确认的风险，并准备验证与提交说明。",
  changes: "这次改了什么",
  findings: "需要你确认",
  verification: "影响与验证",
  draft: "准备提交",
  runLocal: "只运行本地检查",
  startAnalysis: "查看并开始分析",
  aiNoWrite: "AI 不会修改文件或执行提交。",
  confirmed: "已证实",
  inferred: "推断",
  toConfirm: "待确认",
  needsReview: "待复核",
  localRule: "本地检查",
  configuredModel: "模型建议",
  localFallback: "模型不可用，已保留本地结果",
  user: "用户确认",
  mixed: "混合来源",
} as const;

export const taskLabels: Record<WorkbenchTaskId, string> = {
  "changes/overview": "工作副本修改",
  "commit/compose": "提交当前范围",
  "diff/working": "查看本地修改",
  "history/revisions": "查看历史记录",
  "conflicts/resolve": "处理文件冲突",
  "changelists/manage": "管理变更集",
  "understanding/analyze": "变更解读",
  "update/preview": "更新当前范围",
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
  "projects/overview": "项目总览",
  "activity/timeline": "操作时间线",
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
 * 差异视图工具栏与区域文案（v0.0.4 @pierre/diffs 迁移）。
 * 视图当前态通过 aria-pressed 与文字同时表达，不只靠颜色。
 */
export const diffViewLabels = {
  switchGroup: "差异视图切换与折叠控制",
  unified: "统一视图",
  split: "分栏视图",
  expandAll: "展开全部",
  collapseUnchanged: "折叠未变更",
  contentRegion: "差异内容",
} as const;

/** 差异渲染组件失败时的中文降级提示。 */
export const diffFallbackNotices = {
  mergeView:
    "差异渲染组件加载失败，已切换为基础对比视图；语法高亮与视图切换暂不可用。",
  rawPatch: "无法解析该修订比较的差异内容，已按原始文本显示。",
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
