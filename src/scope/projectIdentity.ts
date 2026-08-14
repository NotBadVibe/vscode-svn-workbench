import * as path from "node:path";
import {
  isSamePathIdentity,
  normalizePathIdentity,
  type PathIdentityOptions,
} from "./pathIdentity";

/*
 * v0.0.7 项目边界领域类型：明确区分 VS Code 工作区容器、项目、本地
 * 工作副本和 SVN 仓库身份。identity 键只用于 Map/Set、相等与范围判断；
 * 界面展示与真实文件操作继续使用原始路径，不得把 identity 键显示给用户。
 */

/** VS Code workspace folder 引用；多根工作区中一个 folder 对应一个项目。 */
export interface WorkspaceFolderRef {
  name: string;
  absolutePath: string;
  index: number;
}

/** 本地工作副本身份：workingCopyId 为不透明路径 identity 键。 */
export interface WorkingCopyIdentity {
  workingCopyId: string;
  workingCopyRoot: string;
}

/** SVN 仓库身份：revision、认证与远端 URL 的归属。 */
export interface RepositoryIdentity {
  repositoryUuid?: string;
  repositoryRootUrl?: string;
}

/**
 * 项目身份。项目根可以与工作副本根重合，也可以只是上层工作副本中的
 * 一个子目录；项目根不是独立 SVN 仓库，工作副本根也不是用户项目名。
 */
export interface ProjectIdentity {
  /** 不透明 identity：项目根的规范化路径 identity 键。 */
  projectId: string;
  /** 原始绝对路径，仅用于展示与真实文件操作。 */
  projectRoot: string;
  projectName: string;
  /** 项目根是否就是工作副本根。 */
  rootIsWorkingCopyRoot: boolean;
  /** 项目根相对工作副本根的 "/" 分隔路径；空串表示两者重合。 */
  workingCopyRelativePath: string;
}

function resolvePathApi(options: PathIdentityOptions): typeof path.posix {
  const platform = options.platform ?? process.platform;
  return platform === "win32" ? path.win32 : path.posix;
}

/** 计算 candidate 相对 root 的规范化 "/" 分隔相对路径；root 本身返回 "."。 */
function relativePathWithin(
  candidate: string,
  root: string,
  options: PathIdentityOptions,
): string | undefined {
  const pathApi = resolvePathApi(options);
  const candidateKey = normalizePathIdentity(candidate, options);
  const rootKey = normalizePathIdentity(root, options);
  const relative = pathApi.relative(rootKey, candidateKey);
  if (relative === "") return ".";
  if (
    relative === ".." ||
    relative.startsWith(`..${pathApi.sep}`) ||
    pathApi.isAbsolute(relative)
  ) {
    return undefined;
  }
  return relative.split(pathApi.sep).join("/");
}

export function createWorkingCopyIdentity(
  workingCopyRoot: string,
  options: PathIdentityOptions = {},
): WorkingCopyIdentity {
  return {
    workingCopyId: normalizePathIdentity(workingCopyRoot, options),
    workingCopyRoot,
  };
}

export function createProjectIdentity(input: {
  projectRoot: string;
  workingCopyRoot: string;
  options?: PathIdentityOptions;
}): ProjectIdentity {
  const options = input.options ?? {};
  const pathApi = resolvePathApi(options);
  const relative = relativePathWithin(
    input.projectRoot,
    input.workingCopyRoot,
    options,
  );
  const baseName = pathApi.basename(input.projectRoot);
  return {
    projectId: normalizePathIdentity(input.projectRoot, options),
    projectRoot: input.projectRoot,
    projectName: baseName || input.projectRoot,
    rootIsWorkingCopyRoot: isSamePathIdentity(
      input.projectRoot,
      input.workingCopyRoot,
      options,
    ),
    workingCopyRelativePath: relative === "." ? "" : (relative ?? ""),
  };
}

export function isSameProject(
  left: ProjectIdentity,
  right: ProjectIdentity,
): boolean {
  return left.projectId === right.projectId;
}

/**
 * 计算 absolutePath 的项目内显示路径（"/" 分隔）；位于项目外时返回
 * undefined，调用方不得用显示路径作为 Host 写操作身份。
 */
export function projectRelativePath(
  projectRoot: string,
  absolutePath: string,
  options: PathIdentityOptions = {},
): string | undefined {
  return relativePathWithin(absolutePath, projectRoot, options);
}

/**
 * Host 文件 key：working copy identity + 规范化工作副本内路径。
 * 不能只使用 projectRelativePath，避免项目内重名路径跨项目碰撞；
 * 目标不在工作副本内时返回 undefined。
 */
export function createScopedFileKey(
  workingCopyRoot: string,
  absolutePath: string,
  options: PathIdentityOptions = {},
): string | undefined {
  const relative = relativePathWithin(absolutePath, workingCopyRoot, options);
  if (relative === undefined) return undefined;
  return `${normalizePathIdentity(workingCopyRoot, options)}::${relative}`;
}
