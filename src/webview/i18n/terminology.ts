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
 * 差异视图工具栏与区域文案（v0.0.4 @pierre/diffs 迁移；v0.1.0 统一工具区）。
 * 视图当前态通过 aria-pressed 与文字同时表达，不只靠颜色。
 */
export const diffViewLabels = {
  switchGroup: "差异视图切换与折叠控制",
  unified: "统一视图",
  split: "分栏视图",
  expandAll: "展开全部",
  collapseUnchanged: "折叠未变更",
  contentRegion: "差异内容",
  /** v0.1.0：显示设置聚合入口（split/unified 与展开控制不再各自平铺）。 */
  viewSettings: "显示设置",
  viewSettingsRegion: "差异显示设置",
  expandUnchangedLabel: "展开未变更的上下文行",
  /** v0.1.0：差异块导航（只读与编辑态一致）。 */
  prevHunk: "上一处差异",
  nextHunk: "下一处差异",
  hunkNavGroup: "差异块导航",
  noHunks: "没有可导航的差异块",
  firstHunkReached: "已经是第一处差异",
  lastHunkReached: "已经是最后一处差异",
  /** v0.1.0：编辑与保存状态（不只靠颜色）。 */
  editingBadge: "正在编辑工作副本",
  saveToWorkingCopy: "保存到工作副本",
  saving: "正在保存到工作副本…",
  /** v0.1.0：降级视图来源与恢复入口。 */
  simplifiedView: "当前为简化视图",
  retryRender: "重试渲染",
  retryHighlight: "重试加载语法高亮",
  /**
   * v0.1.0：@pierre/diffs@1.3.4 统一视图下页内编辑不可用（V010-B 能力矩阵
   * 记录为“受限”）；进入编辑时临时切换为分栏并在退出后恢复。
   */
  editForcesSplit:
    "统一视图暂不支持页内编辑，已临时切换为分栏视图；回到审阅后恢复统一视图。",
  unifiedDisabledWhileEditing: "页内编辑期间仅支持分栏视图",
} as const;

/** 差异块当前位置指示（X/Y）。 */
export function diffHunkPositionLabel(current: number, total: number): string {
  return `变更块 ${current}/${total}`;
}

/**
 * V018-D 空白选项与定位器文案（v0.1.8 规划 §4.4）。
 * 全部中文复用此处，不在单页面创造同义文案；最终文本永不被空白选项改写。
 */
export const whitespaceLabels = {
  showWhitespace: "显示空白字符",
  showWhitespaceHint:
    "仅改变渲染层呈现（图例与备用视图符号），不改变文件内容与最终文本。",
  showWhitespaceLegend:
    "空白字符图例：空格 · ／制表符 → ／行尾 ↵（仅渲染层标记，最终文本不受影响）。",
  ignoreWhitespace: "忽略空白差异",
  ignoreWhitespaceHint:
    "只改变比较呈现：归一化文本仅用于差异渲染与块导航，草稿、保存与导出始终使用原始文本。",
  ignoreBanner: "比较视图：已忽略空白差异",
  ignoreBannerDetail: "最终文本不受影响；退出编辑后可切换。",
  editForcesOriginal:
    "进入页内编辑已恢复原始文本比较；编辑始终作用于原始工作副本内容。",
  editBlocksIgnore:
    "页内编辑期间仅显示原始文本比较，请先回到审阅再切换忽略空白。",
  patchBlocksIgnore: "修订比较暂不支持忽略空白差异。",
  binaryBlocksIgnore: "二进制文件不支持忽略空白差异。",
} as const;

/** V018-D 定位器忽略计数（参数化标签，页面不各自拼字符串）。 */
export function whitespaceIgnoredLabel(count: number): string {
  return `已忽略 ${count} 处仅空白差异`;
}

/**
 * V018-D 定位器（overview/locator）文案。
 * 状态图形+文字/aria 双通道，不只用颜色表达。
 */
export const overviewLabels = {
  region: "差异定位器",
  toggleExpand: "展开定位器",
  toggleCollapse: "收起定位器",
  listGroup: "变更块定位列表",
  railGroup: "变更分布条",
  current: "当前",
  gotoBlockHint: "选择后滚动到对应块，不改变文件与操作范围。",
  overThresholdNote:
    "块数较多，定位器已默认收起；如需展开，导航可能较慢（实测 100 块约 132ms、500 块约 1340ms）。",
} as const;

/**
 * V018-D 定位器门控成本提示（参数化标签，页面不各自拼字符串）。
 * 引用实测：100 块 P95 约 132ms 略超 100ms 预算、500 块 P95 约 1428ms。
 */
export function overviewGateHint(count: number, threshold: number): string {
  return `共 ${count} 块，超过 ${threshold} 块阈值，定位器已默认收起；展开后导航可能较慢（实测 100 块约 132ms、500 块约 1340ms）。`;
}

/** 差异渲染组件失败时的中文降级提示。 */
export const diffFallbackNotices = {
  mergeView:
    "差异渲染组件加载失败，已切换为基础对比视图（简化视图）；语法高亮与视图切换暂不可用。",
  rawPatch: "无法解析该修订比较的差异内容，已按原始文本显示（简化视图）。",
} as const;

/**
 * 提交页候选决策依据的完整中文描述（规划 4.3）：
 * 最终决策 · 决策原因（命中规则及来源 / 状态默认策略 / 安全规则）· 安全锁定。
 * 文案统一收口在此处，提交页与设置预览不各自拼字符串。
 */
/** v0.1.3 V013-G：冲突解决步骤条文案（五阶段，不从按钮反推） */
export const conflictStepLabels = {
  barTitle: "冲突解决步骤",
  edit: "编辑",
  saveWorking: "保存工作副本",
  verify: "核验",
  resolve: "标记解决",
  next: "下一个",
  stateDone: "已完成",
  stateCurrent: "进行中",
  stateBlocked: "已阻止",
  statePending: "待处理",
  blockedReason: "阻止原因",
  nextAction: "下一步",
  toggleExpand: "展开",
  toggleCollapse: "折叠",
} as const;

/**
 * v0.1.5 V015-B2：Update / History 共享任务骨架迁移的页面文案。
 * 全部复用既有术语（冲突数量、确认更新、重新检查等），不生造同义文案；
 * 参数化标签由函数生成，避免页面各自拼字符串。
 */
export function updateConflictStatus(count: number): string {
  return `当前范围有 ${count} 个冲突`;
}

export function updateConflictPrimaryLabel(count: number): string {
  return `处理 ${count} 个冲突`;
}

export function updateConflictFilesSummary(count: number): string {
  return `查看冲突文件（${count}）`;
}

export function updateConfirmLabel(remoteCount?: number): string {
  return typeof remoteCount === "number"
    ? `确认更新（${remoteCount}）`
    : "确认更新当前范围";
}

/**
 * v0.1.5 V015-D1：ScopeBar 数量口径——写操作页面（Commit/Update 预览态）
 * 显示「最终候选数」，普通浏览页显示「范围数」，两者文案不混用。
 */
export function scopeFinalCandidateLabel(count: number): string {
  return `最终候选数 ${count} 个`;
}

export function scopeRangeCountLabel(count: number): string {
  return `范围数 ${count} 个`;
}

/** 写操作任务（ScopeBar 显示最终候选数，其余任务显示范围数）。 */
export function isScopeFinalCandidateTask(taskId: WorkbenchTaskId): boolean {
  return taskId === "commit/compose" || taskId === "update/preview";
}

export function historyLoadedStatus(count: number, hasMore?: boolean): string {
  return `已加载最近 ${count} 条修订${hasMore ? "（可能还有更早修订）" : "（已是全部历史）"}`;
}

export function historyCompareCount(selected: number, total = 2): string {
  return `已选择 ${selected}/${total} 条修订`;
}

/**
 * v0.1.5 V015-E：十状态三句话统一文案（只负责状态表达层）。
 * - 每个状态回答“发生了什么 / 是否正常或原因 / 现在能做什么”，结果先行。
 * - 错误态必须配可执行恢复或诊断出口；成功态下一步与当前来路相关，不用通用“完成”。
 * - 页面优先复用以下通用三句；领域差异（如更新回退、历史恢复）由页面在 props 中覆盖。
 */
export const taskStateCopy = {
  initialLoading: {
    what: "正在加载当前任务状态…",
    whyNormal: "首次打开需要读取工作副本，这是正常等待。",
    whatNow: "请稍候，加载完成后可继续操作；长时间无响应可重新打开任务。",
  },
  backgroundRefresh: {
    what: "正在刷新当前范围…",
    whyNormal: "已有内容保持可读，后台刷新不会打断输入。",
    whatNow: "可继续浏览；如需最新结果可等待刷新完成或手动重新检查。",
  },
  emptyClean: {
    what: "工作副本很干净",
    whyNormal: "当前范围没有本地修改，这是正常状态。",
    whatNow: "下一步可检查远端更新，或查看历史确认最新进展。",
  },
  emptyNoCandidate: {
    what: "当前范围没有可提交的候选文件",
    whyNormal: "工作副本很干净时没有可提交项，这是正常状态。",
    whatNow: "可回到“本地修改”确认范围，或检查远端更新。",
  },
  emptyUnselected: {
    what: "尚未选择可提交文件",
    whyNormal: "未选择时无法生成预览，这是预期状态。",
    whatNow: "请先选择至少 1 个可提交文件，或使用“选择推荐项”补全选择。",
  },
  filterNoMatch: {
    what: "没有匹配的文件",
    whyNormal: "当前筛选没有匹配文件，原始数据不受影响。",
    whatNow: "可调整搜索词、状态或类型筛选即可，或清除筛选后重试。",
  },
  filterSelectedHidden: {
    what: "已选文件不在当前筛选中",
    whyNormal: "已选文件被当前筛选隐藏，选择本身仍保留。",
    whatNow: "可关闭“只看已选”或调整筛选即可看到。",
  },
  loadFailed: {
    what: "任务状态加载失败",
    cause: "可能是工作副本被占用、路径变化或 SVN 服务暂不可用。",
    recovery: "可重新打开此任务重试；问题持续时请运行环境诊断并复制诊断信息。",
  },
  cancelled: {
    what: "操作已取消",
    whyNormal: "取消不会修改工作副本，半完成结果不会被复用。",
    whatNow: "确认无残留修改后，可重新生成预览再试。",
  },
  stale: {
    what: "结果已过期",
    whyNormal: "范围、候选或修订版本已变化，旧结果只能查看。",
    whatNow: "请重新检查生成最新结果后再决定下一步。",
  },
  partial: {
    what: "部分完成：部分文件已处理，另有失败项",
    whyNormal: "成功部分已生效，失败项未被应用。",
    whatNow: "可只重试失败项；全部成功后再继续下一步。",
  },
  recoverOk: {
    what: "恢复成功",
    whyNormal: "工作副本已回到可用状态。",
    whatNow: "下一步可重新生成预览，确认状态后再继续原任务。",
  },
  recoverFailed: {
    what: "恢复失败",
    cause: "可能是锁定残留、工作副本被占用或权限不足。",
    recovery: "可重试恢复，或复制诊断信息后运行环境诊断排查。",
  },
  aiUnconfigured: {
    what: "未配置外部模型，当前为本地检查",
    whyNormal: "本地规则与人工流程不受影响，这是可选增强缺失。",
    whatNow: "可继续使用本地检查，或前往设置配置模型后再试。",
  },
} as const;

/** v0.1.5 V015-B：共享任务骨架组件的默认文案（组件内不生造领域文案）。 */
export const taskSkeletonLabels = {
  summary: "任务状态摘要",
  actionBar: "任务操作栏",
  result: "任务结果与下一步",
  emptyState: "空状态说明",
  errorState: "错误说明",
  busyFallback: "正在处理，请稍候…",
  staleFallback: "结果已过期，请重新检查。",
  diagnosticBlocked:
    "诊断信息疑似包含密钥，已隐藏以保护安全。请复制前自行脱敏。",
} as const;

/**
 * v0.1.6 V016-F1：骨架动作溢出提示（次级 >2 / 主要 >1 时渲染文字说明，
 * 不再仅 DEV 日志静默截断；渲染侧仍只缩小不扩大）。
 */
export function taskSecondaryOverflowLabel(hiddenCount: number): string {
  return `另有 ${hiddenCount} 个次要操作未显示`;
}

export function taskExtraPrimaryLabel(extraCount: number): string {
  return `另有 ${extraCount} 个主要操作未显示，仅展示首个`;
}

/**
 * v0.1.6 V016-B：共享帮助容器统一文案（AssistancePanel 专用）。
 * - 组件内不生造领域文案：入口、分组、外发说明、过期、错误出口全部收口此处。
 * - 本地结果禁止显示 AI 字样：本地分组与未配置提示均不含“AI/智能”。
 */
export const assistanceLabels = {
  needHelp: "需要帮助",
  collapse: "收起帮助",
  localGroup: "本地检查",
  modelGroup: "模型辅助（需确认后外发）",
  unconfiguredHint: "未配置外部模型，本地检查仍可用；模型辅助需先配置。",
  modelExplainPrefix: "已选择“",
  modelExplainSuffix: "”，将按外发回执确认后才外发；本地动作不会外发。",
  staleAdoptHint:
    "范围或候选已变化，该结果只能查看，不能直接采用；请重新获取建议。",
  errorActions: "错误恢复操作",
  retry: "重试",
  discard: "放弃",
} as const;

/**
 * v0.1.6 V016-C：Commit 提交说明帮助面板领域文案。
 * - 提交说明旁只保留一个“生成建议草稿”模型入口；模式选择收进面板展开区。
 * - 选择辅助降级为本地规则默认：此处不出现“AI/智能”字样，结果进本地检查摘要。
 */
export const commitAssistanceLabels = {
  panelTitle: "提交说明帮助",
  panelSummary: "生成建议草稿、查看外发回执与证据；建议不覆盖已填提交说明。",
  generateModeLabel: "生成输入模式",
  metadataOnly: "仅文件信息",
  limitedDiff: "含差异（需确认）",
  limitedDiffNote:
    "受限差异模式：生成前会先展示外发回执（数据类型、文件数、预算与排除项），确认后才发送脱敏差异正文；不会发送本地绝对路径、范围外内容或凭据。",
  selectionDemotedHint:
    "选择建议默认使用本地规则，结果见下方本地检查摘要；模型选择已收起。",
  unconfiguredDisabledReason: "未配置外部模型，本地检查仍可用",
} as const;

/**
 * v0.1.6 V016-C2：Conflicts 冲突帮助面板领域文案。
 * - 「本地建议 / AI 分析 / 解释冲突意图」统一收进 AssistancePanel 单一入口。
 * - 未配置模型时只启用本地建议，不标 AI；模型动作禁用并如实说明原因。
 * v0.1.6 V016-C3b（必修 3，选①）：「AI 分析」走 conflict/advise（轻量建议动作，
 * 无独立回执设计），kind 归为 local，提示文案不得承诺“回执确认后才外发”；
 * 只有「解释冲突意图」走 conflict/preview-receipt 回执链（kind:model）。
 */
export const conflictAssistanceLabels = {
  panelTitle: "冲突帮助",
  panelSummary:
    "合并建议与解释：本地建议默认可用；模型辅助需确认后外发，不会自动标记解决。",
  localHint: "不会外发",
  modelAdviseHint: "直接生成建议，不单独确认",
  interpretHint: "含差异，需确认后外发",
  unconfiguredDisabledReason:
    "未配置外部模型，本地检查仍可用；请先配置模型后再试。",
  adoptAdvice: "采用合并建议到草稿",
  adoptAdviceHint: "仅写入合并草稿，不保存也不标记解决",
  adoptAdviceManualReason: "该建议需要人工合并，无法一键采用",
  adoptAdviceNoBlocksReason: "当前草稿无冲突标记块，无需一键采用",
  adviceExpiredNotice:
    "合并建议已过期（已切换冲突文件，只能查看）；请重新获取建议。",
} as const;

/**
 * v0.1.6 V016-D：Changelists 分组帮助面板领域文案。
 * - 「自动整理」为页头次级轻量动作（去 sparkle，不弹回执预告）：未配置模型时走
 *   本地目录/类型分组；Host `changelist/suggest mode:metadata` 在模型可用时实际可调
 *   用模型（`runAiScenario commitSplit`），此时建议来源如实标为“模型建议”。
 * - 「按改动意图拆分」是唯一模型入口，收进 AssistancePanel 模型组（kind:model），
 *   走 `changelist/preview-receipt` 回执链；未配置时禁用并如实说明。
 */
export const changelistAssistanceLabels = {
  panelTitle: "分组帮助",
  panelSummary:
    "自动整理按目录与类型快速分组；按改动意图拆分需确认后外发，建议须经预览确认才写入。",
  autoTidy: "自动整理",
  semanticSplit: "按改动意图拆分（含差异需确认）",
  semanticSplitHint: "含差异，需确认后外发",
  unconfiguredDisabledReason: "未配置外部模型，本地检查仍可用",
} as const;

/**
 * v0.1.6 V016-D：Understanding 分析帮助面板领域文案。
 * - 本地检查是默认可用主路径，页头保留次级入口。
 * - 模型分析是唯一模型入口，收进 AssistancePanel 模型组（kind:model），
 *   走 `understanding/preview-receipt` 回执链；未配置时禁用并如实说明。
 */
export const understandingAssistanceLabels = {
  panelTitle: "分析帮助",
  panelSummary:
    "本地检查默认可用；模型分析需确认后外发，不会修改文件或执行提交。",
  analysisHint: "含差异，需确认后外发",
  unconfiguredDisabledReason:
    "未配置外部模型，可先运行本地检查；请先配置模型后再试。",
} as const;

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
