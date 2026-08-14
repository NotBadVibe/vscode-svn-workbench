import * as path from "node:path";
import {
  isSameOrDescendantPath,
  normalizePathIdentity,
  type PathIdentityOptions,
} from "../scope/pathIdentity";

/*
 * v0.0.7 SCM 项目切片（releases/v0.0.7 §6.2）：
 * 每个显式 workspace folder 建立项目级 SCM provider；同一工作副本共享
 * 一次状态采集，再按项目根切片；未加载的兄弟目录不进入任何项目级
 * provider。同名项目补充可辨识父路径，不依赖显示名作为 identity。
 */

export interface ScmProjectRef {
  /** workspace folder 显示名。 */
  name: string;
  /** 项目根（即 workspace folder 根）原始绝对路径。 */
  absolutePath: string;
  /** 项目所属工作副本根。 */
  workingCopyRoot: string;
}

/** 项目/工作副本的 Map 键：不透明路径 identity。 */
export function scmProjectKey(
  absolutePath: string,
  options: PathIdentityOptions = {},
): string {
  return normalizePathIdentity(absolutePath, options);
}

/**
 * 计算项目级 provider 标题：`SVN · 项目名`；同名项目补充可辨识父路径。
 * 返回与输入同序的标题数组。
 */
export function resolveSourceControlTitles(
  projects: readonly { name: string; absolutePath: string }[],
  options: PathIdentityOptions = {},
): string[] {
  const pathApi = options.platform === "win32" ? path.win32 : path.posix;
  const nameCounts = new Map<string, number>();
  for (const project of projects) {
    const key =
      options.platform === "win32" ? project.name.toLowerCase() : project.name;
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }
  return projects.map((project) => {
    const key =
      options.platform === "win32" ? project.name.toLowerCase() : project.name;
    if ((nameCounts.get(key) ?? 0) <= 1) {
      return `SVN · ${project.name}`;
    }
    const parent = pathApi.basename(pathApi.dirname(project.absolutePath));
    return parent ? `SVN · ${parent}/${project.name}` : `SVN · ${project.name}`;
  });
}

/** 按工作副本根分组项目，同组共享一次状态采集。 */
export function groupProjectsByWorkingCopy<
  T extends { workingCopyRoot: string },
>(projects: readonly T[], options: PathIdentityOptions = {}): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const project of projects) {
    const key = normalizePathIdentity(project.workingCopyRoot, options);
    const group = groups.get(key);
    if (group) {
      group.push(project);
    } else {
      groups.set(key, [project]);
    }
  }
  return groups;
}

/**
 * 把工作副本级候选按项目根切片：只保留位于项目根内的候选；未加载的
 * 兄弟目录候选不会进入任何项目 provider。
 */
export function sliceCandidatesForProject<T extends { absolutePath: string }>(
  candidates: readonly T[],
  projectRoot: string,
  options: PathIdentityOptions = {},
): T[] {
  return candidates.filter((candidate) =>
    isSameOrDescendantPath(candidate.absolutePath, projectRoot, options),
  );
}

/** 判断候选路径属于哪个项目根；不属于任何已加载项目时返回 undefined。 */
export function findOwningProject<T extends { absolutePath: string }>(
  projects: readonly T[],
  candidatePath: string,
  options: PathIdentityOptions = {},
): T | undefined {
  let best: T | undefined;
  let bestLength = -1;
  for (const project of projects) {
    if (!isSameOrDescendantPath(candidatePath, project.absolutePath, options)) {
      continue;
    }
    const length = normalizePathIdentity(project.absolutePath, options).length;
    if (length > bestLength) {
      best = project;
      bestLength = length;
    }
  }
  return best;
}
