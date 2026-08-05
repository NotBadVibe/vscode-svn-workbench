/**
 * 提交选择规则合并器（v0.0.3 阶段 1）。
 *
 * 输入用户、工作区、仓库三层原始配置（均可选）与内置默认，输出有效规则：
 * 状态策略、有序路径规则、校验错误/警告与各层来源信息。纯函数，不依赖 VS Code。
 *
 * 合并语义（规划 5.3）：
 * - 优先级：不可覆盖的安全规则 > 仓库 > 工作区 > 用户 > 内置默认。
 * - 路径规则按稳定 ID 覆盖：高优先级层的同 ID 规则替换低优先级定义并继承其位置；
 *   高优先级层新增的自定义规则排在内置规则之前（仓库新增 > 工作区新增 > 用户新增）。
 * - 禁用覆盖（enabled:false）只影响同 ID 规则，不删除低层配置数据。
 * - 单层解析/校验失败时该层整体回退，保留错误与警告，不静默吞掉。
 */

import {
  CommitSelectionLayerConfig,
  CommitSelectionPathRule,
  CommitSelectionRuleSource,
  CommitSelectionStatusPolicies,
  MAX_COMMIT_SELECTION_PATH_RULES,
  ResolvedCommitSelectionPathRule,
  defaultCommitSelectionStatusRules,
  builtinCommitSelectionPathRules,
  detectShadowedCommitSelectionPathRules,
  normalizeCommitSelectionPattern,
  validateCommitSelectionLayerConfig,
} from "./commitSelectionRules";

export interface CommitSelectionRuleLayers {
  user?: unknown;
  workspace?: unknown;
  repository?: unknown;
}

export type CommitSelectionLayerState = "empty" | "applied" | "failed";

export interface CommitSelectionLayerResolution {
  source: CommitSelectionRuleSource;
  state: CommitSelectionLayerState;
  errors: string[];
  warnings: string[];
  statusRuleCount: number;
  pathRuleCount: number;
  /** 该层已校验的原始配置（state 为 applied 时存在），供设置快照与保存流程复用。 */
  config?: CommitSelectionLayerConfig;
}

export interface ResolvedCommitSelectionRules {
  statusRules: CommitSelectionStatusPolicies;
  /** 有序路径规则（第一条命中生效），含禁用规则，附来源与规范化 pattern。 */
  pathRules: ResolvedCommitSelectionPathRule[];
  errors: string[];
  warnings: string[];
  layers: Record<
    "user" | "workspace" | "repository",
    CommitSelectionLayerResolution
  >;
}

const layerLabels: Record<"user" | "workspace" | "repository", string> = {
  user: "用户默认",
  workspace: "当前工作区",
  repository: "当前仓库",
};

interface ValidatedLayer {
  source: "user" | "workspace" | "repository";
  config?: CommitSelectionLayerConfig;
  resolution: CommitSelectionLayerResolution;
}

export function resolveCommitSelectionRules(
  layers: CommitSelectionRuleLayers,
): ResolvedCommitSelectionRules {
  const validated: ValidatedLayer[] = (
    ["user", "workspace", "repository"] as const
  ).map((source) => validateLayer(source, layers[source]));

  const statusRules: CommitSelectionStatusPolicies = {
    ...defaultCommitSelectionStatusRules,
  };
  for (const layer of validated) {
    if (!layer.config?.statusRules) {
      continue;
    }
    Object.assign(statusRules, layer.config.statusRules);
  }

  const merged = mergePathRules(validated);
  const warnings = validated.flatMap((layer) => layer.resolution.warnings);
  if (merged.droppedCount > 0) {
    warnings.push(
      `合并后的路径规则超过 ${MAX_COMMIT_SELECTION_PATH_RULES} 条上限，已丢弃 ${merged.droppedCount} 条最低优先级自定义规则。`,
    );
  }
  warnings.push(...detectShadowedCommitSelectionPathRules(merged.rules));

  return {
    statusRules,
    pathRules: merged.rules,
    errors: validated.flatMap((layer) => layer.resolution.errors),
    warnings,
    layers: {
      user: validated[0].resolution,
      workspace: validated[1].resolution,
      repository: validated[2].resolution,
    },
  };
}

function validateLayer(
  source: "user" | "workspace" | "repository",
  raw: unknown,
): ValidatedLayer {
  const resolution: CommitSelectionLayerResolution = {
    source,
    state: "empty",
    errors: [],
    warnings: [],
    statusRuleCount: 0,
    pathRuleCount: 0,
  };
  if (raw === undefined) {
    return { source, resolution };
  }

  const validation = validateCommitSelectionLayerConfig(
    raw,
    layerLabels[source],
  );
  resolution.warnings = validation.warnings;
  if (!validation.config) {
    resolution.state = "failed";
    resolution.errors = validation.errors;
    return { source, resolution };
  }

  resolution.state = "applied";
  resolution.config = validation.config;
  resolution.statusRuleCount = Object.keys(
    validation.config.statusRules ?? {},
  ).length;
  resolution.pathRuleCount = validation.config.pathRules?.length ?? 0;
  return { source, config: validation.config, resolution };
}

/**
 * 路径规则合并：以内置规则槽位为底，按 用户 → 工作区 → 仓库 顺序应用同 ID
 * 覆盖（原位替换，来源记为覆盖层）；各层新增规则进入本层自定义区。最终顺序为
 * [仓库新增, 工作区新增, 用户新增, ...内置槽位]，配合“第一条命中生效”实现优先级。
 */
function mergePathRules(validated: ValidatedLayer[]): {
  rules: ResolvedCommitSelectionPathRule[];
  droppedCount: number;
} {
  const builtinSlots: ResolvedCommitSelectionPathRule[] =
    builtinCommitSelectionPathRules.map((rule) => toResolved(rule, "builtin"));
  const customSections: Record<
    "user" | "workspace" | "repository",
    ResolvedCommitSelectionPathRule[]
  > = { user: [], workspace: [], repository: [] };

  const builtinIndexById = new Map(
    builtinSlots.map((rule, index) => [rule.id, index] as const),
  );
  // 记录自定义规则首次出现的位置；同 ID 覆盖原位替换定义，不移动位置。
  const customIndexById = new Map<
    string,
    { source: "user" | "workspace" | "repository"; index: number }
  >();

  for (const layer of validated) {
    for (const rule of layer.config?.pathRules ?? []) {
      const resolved = toResolved(rule, layer.source);
      const builtinIndex = builtinIndexById.get(rule.id);
      if (builtinIndex !== undefined) {
        builtinSlots[builtinIndex] = resolved;
        continue;
      }
      const customPosition = customIndexById.get(rule.id);
      if (customPosition) {
        customSections[customPosition.source][customPosition.index] = resolved;
        continue;
      }
      customIndexById.set(rule.id, {
        source: layer.source,
        index: customSections[layer.source].length,
      });
      customSections[layer.source].push(resolved);
    }
  }

  // 数量上限保护实时预览性能：超出时从最低优先级自定义规则（用户层末尾）
  // 开始丢弃，内置规则始终保留。
  const customs = [
    ...customSections.repository,
    ...customSections.workspace,
    ...customSections.user,
  ];
  const allowedCustoms = Math.max(
    0,
    MAX_COMMIT_SELECTION_PATH_RULES - builtinSlots.length,
  );
  const droppedCount = Math.max(0, customs.length - allowedCustoms);
  customs.length = Math.min(customs.length, allowedCustoms);
  return { rules: [...customs, ...builtinSlots], droppedCount };
}

function toResolved(
  rule: CommitSelectionPathRule,
  source: CommitSelectionRuleSource,
): ResolvedCommitSelectionPathRule {
  return {
    ...rule,
    source,
    normalizedPattern: normalizeCommitSelectionPattern(rule.pattern),
  };
}
