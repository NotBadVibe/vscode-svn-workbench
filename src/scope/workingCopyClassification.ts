import {
  isSameOrDescendantPath,
  isSamePathIdentity,
  type PathIdentityOptions,
} from "./pathIdentity";

/*
 * v0.0.7 工作副本归属分类（releases/v0.0.7 §6.3）。
 *
 * Diagnostics 必须复用工作副本解析结果，不能只检查项目根是否直接包含
 * `.svn`：位于上层工作副本的项目（如 EM.code-workspace 的三个 folder）
 * 不得被误报为非 SVN。svn 不可用时无法读取 svn:externals，external 与
 * 嵌套工作副本统一按嵌套工作副本报告。
 */

export type WorkingCopyBinding =
  | "workingCopyRoot"
  | "parentWorkingCopy"
  | "nestedWorkingCopy"
  | "external"
  | "notSvn"
  | "missing";

export const workingCopyBindingLabels: Record<WorkingCopyBinding, string> = {
  workingCopyRoot: "独立工作副本根",
  parentWorkingCopy: "位于上层工作副本",
  nestedWorkingCopy: "嵌套工作副本",
  external: "外部引用（svn:externals）",
  notSvn: "非 SVN 目录",
  missing: "路径不存在",
};

export interface WorkingCopyBindingInput {
  /** folder 路径是否仍存在。 */
  exists: boolean;
  folderPath: string;
  /** folder 所属工作副本根（含向上层目录查找）。 */
  workingCopyRoot?: string;
  /** folder 父级所属工作副本根，用于识别嵌套工作副本与 external。 */
  parentWorkingCopyRoot?: string;
  /** 父工作副本的 svn:externals 是否声明了该目录；未检测时传 undefined。 */
  isExternalsTarget?: boolean;
}

export function classifyWorkingCopyBinding(
  input: WorkingCopyBindingInput,
  options: PathIdentityOptions = {},
): WorkingCopyBinding {
  if (!input.exists) return "missing";
  const { folderPath, workingCopyRoot, parentWorkingCopyRoot } = input;
  if (
    !workingCopyRoot ||
    !isSameOrDescendantPath(folderPath, workingCopyRoot, options)
  ) {
    return "notSvn";
  }
  if (!isSamePathIdentity(folderPath, workingCopyRoot, options)) {
    return "parentWorkingCopy";
  }
  if (
    parentWorkingCopyRoot &&
    !isSamePathIdentity(parentWorkingCopyRoot, workingCopyRoot, options)
  ) {
    return input.isExternalsTarget === true ? "external" : "nestedWorkingCopy";
  }
  return "workingCopyRoot";
}

/** 该归属是否属于某个 SVN 工作副本（用于诊断统计）。 */
export function isSvnBound(binding: WorkingCopyBinding): boolean {
  return binding !== "notSvn" && binding !== "missing";
}
