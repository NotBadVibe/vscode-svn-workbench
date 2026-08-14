import { createHash } from "node:crypto";
import {
  isSameOrDescendantPath,
  isSamePathIdentity,
  type PathSemantics,
} from "../scope/pathIdentity";
import {
  serializeSvnWorkbenchConfig,
  type SvnWorkbenchConfigObject,
} from "./svnWorkbenchConfig";

/*
 * v0.0.7 §9 团队规则迁移：把工作副本根的既有团队规则迁移到已确认项目根。
 * 纯函数计划构建 + 哈希校验；Host 负责读写文件。只迁移白名单键
 * （commitConvention、commitSelection），不触碰密钥、凭据或任何私密材料；
 * 既有工作副本根配置在执行前复验，绝不静默移动、复制或覆盖。
 */

export const MIGRATABLE_TEAM_CONFIG_KEYS = [
  "commitConvention",
  "commitSelection",
] as const;

export interface TeamConfigMigrationPlan {
  /** 将迁移的顶层键。 */
  keys: string[];
  /** 目标文件内容（仅含迁移键）。 */
  targetContent: string;
  /** 迁移后源文件内容（保留其余键）。 */
  sourceContentAfter: string;
  /** 非空时禁止执行，界面展示原因与恢复动作。 */
  issues: string[];
}

export interface TeamConfigMigrationInput {
  /** 源（工作副本根）配置解析结果；文件不存在或损坏时为 undefined。 */
  sourceRaw: SvnWorkbenchConfigObject | undefined;
  /** 源文件是否存在。 */
  sourceExists: boolean;
  /** 目标（项目根）配置文件是否已存在。 */
  targetExists: boolean;
  projectRoot: string;
  workingCopyRoot: string;
  options: PathSemantics;
}

export function planTeamConfigMigration(
  input: TeamConfigMigrationInput,
): TeamConfigMigrationPlan {
  const issues: string[] = [];
  if (
    isSamePathIdentity(input.projectRoot, input.workingCopyRoot, input.options)
  ) {
    issues.push("项目根与工作副本根重合，无需迁移。");
  }
  if (
    !isSameOrDescendantPath(
      input.projectRoot,
      input.workingCopyRoot,
      input.options,
    )
  ) {
    issues.push("项目根不在当前工作副本内，边界校验未通过，已拒绝迁移。");
  }
  if (!input.sourceExists || !input.sourceRaw) {
    issues.push(
      "工作副本根没有可继承的有效团队规则配置（文件不存在或已损坏），无可迁移内容。",
    );
  }
  if (input.targetExists) {
    issues.push(
      "项目根已存在 .svn-workbench.json，为避免覆盖已有配置已拒绝迁移；请手动合并后重试。",
    );
  }
  const sourceRaw = input.sourceRaw ?? {};
  const keys = MIGRATABLE_TEAM_CONFIG_KEYS.filter((key) => key in sourceRaw);
  if (input.sourceRaw && keys.length === 0) {
    issues.push("工作副本根配置中没有可迁移的团队规则键。");
  }
  const targetRaw: SvnWorkbenchConfigObject = {};
  const sourceAfter: SvnWorkbenchConfigObject = { ...sourceRaw };
  for (const key of keys) {
    targetRaw[key] = sourceRaw[key];
    delete sourceAfter[key];
  }
  return {
    keys: [...keys],
    targetContent: serializeSvnWorkbenchConfig(targetRaw),
    sourceContentAfter: serializeSvnWorkbenchConfig(sourceAfter),
    issues,
  };
}

/** 源配置内容哈希：执行前复验源未变化。 */
export function hashTeamConfigContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}
