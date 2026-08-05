/**
 * 提交选择规则设置页的领域支撑逻辑（v0.0.3 阶段 3：协议与 Host 动作）。
 *
 * 本模块为纯函数集合，不依赖 VS Code、不做 I/O：
 * - buildCommitSelectionSettingsSection：把解析结果与候选评估映射为协议快照段；
 * - validateCommitSelectionSaveInput：保存前的完整校验（含遮蔽检测）；
 * - mergeCommitSelectionForSave：写回 .svn-workbench.json 时对 commitSelection 键做
 *   对象级合并，保留其内部未知字段（规划 6：未识别字段应保留）。
 *
 * Host 侧 IO 编排（读-合并-写回、失效）在 commitSelectionRuleService.ts，
 * 文件级键删除在 config/svnWorkbenchConfig.ts。规划依据见
 * docs/releases/v0.0.3/README.md 第 4.1、5、6、7.4 节。
 */

import { SVN_WORKBENCH_CONFIG_FILE } from "../config/svnWorkbenchConfig";
import type {
  CommitSelectionSettingsLayerView,
  CommitSelectionPreviewItem,
  CommitSelectionSettingsSection,
} from "../protocol/workbenchProtocol";
import type { SvnStatus } from "../svn/svnTypes";
import {
  COMMIT_SELECTION_CONFIG_VERSION,
  CommitSelectionExplanation,
  CommitSelectionLayerConfig,
  isCommitSelectionStatusKey,
  isRecord,
  validateCommitSelectionLayerConfig,
} from "./commitSelectionRules";
import {
  CommitSelectionLayerResolution,
  ResolvedCommitSelectionRules,
  resolveCommitSelectionRules,
} from "./commitSelectionRuleResolver";

/** 设置页预览使用的候选输入：采集结果中与本模块相关的字段子集。 */
export interface CommitSelectionPreviewCandidate {
  relativePath: string;
  status: SvnStatus;
  propStatus?: SvnStatus;
  evaluation: CommitSelectionExplanation;
}

export interface CommitSelectionSettingsSectionInput {
  resolved: ResolvedCommitSelectionRules;
  /** 当前仓库候选；采集失败时传 previewError。 */
  candidates?: readonly CommitSelectionPreviewCandidate[];
  previewError?: string;
  feedback?: CommitSelectionSettingsSection["feedback"];
  saveErrors?: string[];
}

/**
 * 构建设置快照的提交选择规则段：当前编辑作用域、各层原始配置、有效合并结果、
 * 校验错误与警告（含遮蔽）、当前候选文件的规则预览。
 */
export function buildCommitSelectionSettingsSection(
  input: CommitSelectionSettingsSectionInput,
): CommitSelectionSettingsSection {
  const { resolved } = input;
  return {
    // 当前版本设置页表单只编辑仓库级；用户/工作区级只读展示（规划 4.1）。
    editingScope: "repository",
    configPath: SVN_WORKBENCH_CONFIG_FILE,
    layers: {
      user: toLayerView(resolved.layers.user, false),
      workspace: toLayerView(resolved.layers.workspace, false),
      repository: toLayerView(resolved.layers.repository, true),
    },
    effective: {
      statusRules: { ...resolved.statusRules },
      pathRules: resolved.pathRules.map((rule) => ({ ...rule })),
    },
    errors: [...resolved.errors],
    warnings: [...resolved.warnings],
    preview: buildPreview(input),
    feedback: input.feedback,
    saveErrors:
      input.saveErrors && input.saveErrors.length > 0
        ? [...input.saveErrors]
        : undefined,
  };
}

export interface CommitSelectionSaveValidation {
  ok: boolean;
  /** 校验通过的仓库层配置（含 version），可直接写回配置文件。 */
  config?: CommitSelectionLayerConfig;
  /** 拒绝保存的结构化中文错误。 */
  errors: string[];
  /** 不阻止保存的警告（含遮蔽警告与合并上限警告）。 */
  warnings: string[];
}

/**
 * 保存前完整校验：作用域、单层配置合法性（ID/Glob/决策/重复项），
 * 并在用户、工作区层之上重新合并以产出遮蔽等警告。校验失败必须拒绝保存。
 * baseLayers 传入当前已解析的用户/工作区层配置（validation 失败的层传 undefined）。
 */
export function validateCommitSelectionSaveInput(
  data: unknown,
  baseLayers: { user?: unknown; workspace?: unknown },
): CommitSelectionSaveValidation {
  if (!isRecord(data)) {
    return { ok: false, errors: ["保存请求缺少配置数据。"], warnings: [] };
  }
  if (data.scope !== undefined && data.scope !== "repository") {
    return {
      ok: false,
      errors: [
        "当前版本设置页只支持保存仓库级规则；用户与工作区级请在 VS Code 设置中编辑。",
      ],
      warnings: [],
    };
  }

  const candidate: Record<string, unknown> = {
    version: COMMIT_SELECTION_CONFIG_VERSION,
  };
  if (data.statusRules !== undefined) {
    candidate.statusRules = data.statusRules;
  }
  if (data.pathRules !== undefined) {
    candidate.pathRules = data.pathRules;
  }
  const validation = validateCommitSelectionLayerConfig(candidate, "当前仓库");
  if (!validation.config) {
    return {
      ok: false,
      errors: validation.errors,
      warnings: validation.warnings,
    };
  }

  // 在真实用户/工作区层之上重跑合并，得到遮蔽检测与数量上限等保存期警告。
  const resolved = resolveCommitSelectionRules({
    user: baseLayers.user,
    workspace: baseLayers.workspace,
    repository: validation.config,
  });
  return {
    ok: true,
    config: validation.config,
    errors: [],
    warnings: [...validation.warnings, ...resolved.warnings],
  };
}

/**
 * 写回前对 commitSelection 键做对象级合并：
 * - 保留 commitSelection 内部的未知字段（例如更高版本写入的实验区配置）；
 * - version/statusRules/pathRules 为已知字段，由本次保存内容接管；
 * - statusRules 内未识别的状态键同样保留（前向兼容），已识别键以保存内容为准；
 * - pathRules 为有序数组，整体替换。
 */
export function mergeCommitSelectionForSave(
  existingSection: unknown,
  next: CommitSelectionLayerConfig,
): Record<string, unknown> {
  const existing = isRecord(existingSection) ? existingSection : {};
  const merged: Record<string, unknown> = { ...existing };
  merged.version = next.version ?? COMMIT_SELECTION_CONFIG_VERSION;

  if (next.statusRules !== undefined) {
    const preserved: Record<string, unknown> = {};
    if (isRecord(existing.statusRules)) {
      for (const [key, value] of Object.entries(existing.statusRules)) {
        if (!isCommitSelectionStatusKey(key)) {
          preserved[key] = value;
        }
      }
    }
    merged.statusRules = { ...preserved, ...next.statusRules };
  } else {
    delete merged.statusRules;
  }

  if (next.pathRules !== undefined) {
    merged.pathRules = next.pathRules;
  } else {
    delete merged.pathRules;
  }
  return merged;
}

function toLayerView(
  resolution: CommitSelectionLayerResolution,
  editable: boolean,
): CommitSelectionSettingsLayerView {
  return {
    editable,
    state: resolution.state,
    config: resolution.config,
    errors: [...resolution.errors],
    warnings: [...resolution.warnings],
  };
}

function buildPreview(
  input: CommitSelectionSettingsSectionInput,
): CommitSelectionSettingsSection["preview"] {
  if (input.previewError) {
    return { state: "error", error: input.previewError, items: [] };
  }
  const items = (input.candidates ?? []).map(toPreviewItem);
  return { state: items.length > 0 ? "ready" : "empty", items };
}

function toPreviewItem(
  candidate: CommitSelectionPreviewCandidate,
): CommitSelectionPreviewItem {
  const { evaluation } = candidate;
  return {
    relativePath: candidate.relativePath,
    status: candidate.status,
    propStatus: candidate.propStatus,
    decision: evaluation.decision,
    reasonKey: evaluation.reasonKey,
    statusPolicyKey: evaluation.statusPolicyKey,
    matchedRuleId: evaluation.matchedRuleId,
    ruleSource: evaluation.ruleSource,
    safetyLocked: evaluation.safetyLocked,
  };
}
