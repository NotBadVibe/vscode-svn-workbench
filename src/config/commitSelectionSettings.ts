import * as vscode from "vscode";
import { CommitSelectionRuleLayers } from "../commit/commitSelectionRuleResolver";

/**
 * 用户/工作区级提交选择规则的 VS Code 配置适配层（v0.0.3 阶段 1）。
 *
 * 从 `svnWorkbench.commitSelection.statusRules/pathRules` 的 inspect 结果中拆出
 * 用户（global）与工作区（workspace）两层原始配置，作为
 * commitSelectionRuleResolver 的输入；合并、校验与评估全部在纯领域模块完成。
 */

export interface CommitSelectionConfigurationInspection {
  globalValue?: unknown;
  workspaceValue?: unknown;
}

/** 结构化最小接口，便于测试注入；vscode.WorkspaceConfiguration 天然满足。 */
export interface CommitSelectionConfigurationSource {
  inspect(key: string): CommitSelectionConfigurationInspection | undefined;
}

export function readCommitSelectionVscodeLayers(
  source?: CommitSelectionConfigurationSource,
): CommitSelectionRuleLayers {
  const config =
    source ?? vscode.workspace.getConfiguration("svnWorkbench.commitSelection");
  const statusRules = config.inspect("statusRules");
  const pathRules = config.inspect("pathRules");
  return {
    user: buildLayer(statusRules?.globalValue, pathRules?.globalValue),
    workspace: buildLayer(
      statusRules?.workspaceValue,
      pathRules?.workspaceValue,
    ),
  };
}

function buildLayer(
  statusRules: unknown,
  pathRules: unknown,
): Record<string, unknown> | undefined {
  if (statusRules === undefined && pathRules === undefined) {
    return undefined;
  }
  const layer: Record<string, unknown> = {};
  if (statusRules !== undefined) {
    layer.statusRules = statusRules;
  }
  if (pathRules !== undefined) {
    layer.pathRules = pathRules;
  }
  return layer;
}
