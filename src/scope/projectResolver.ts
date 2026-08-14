import {
  isSameOrDescendantPath,
  isSamePathIdentity,
  normalizePathIdentity,
  type PathSemantics,
} from "./pathIdentity";
import { createProjectIdentity } from "./projectIdentity";
import type { OperationScopeProject } from "./operationScope";

/*
 * v0.0.7 活动项目解析契约（releases/v0.0.7 §5）。
 *
 * 纯函数实现，不依赖 vscode；Host 注入命令 URI、活动编辑器、容器内保存
 * 的项目根与 workspace folder 列表。禁止业务入口固定使用
 * workspaceFolders[0]；多根且无明确目标时返回 needsSelection，由 Host
 * 打开可搜索、键盘可用的项目选择器。
 */

export interface ProjectResolverFolder {
  name: string;
  absolutePath: string;
}

export interface ProjectCandidate {
  name: string;
  absolutePath: string;
  /** 最近使用的项目在选择器中突出，但不自动进入。 */
  isRecent: boolean;
}

export type ProjectTargetSource =
  "explicit" | "activeEditor" | "savedProject" | "singleFolder";

export type ProjectTargetResolution =
  | {
      kind: "resolved";
      /** 用于 SVN 与操作范围解析的原始目标（可能是文件或目录）。 */
      target: string;
      /**
       * 已确认项目根；undefined 表示目标不在任何 workspace folder 内，
       * 由 Host 回退到目标所属工作副本根并提示“尚未设置项目根”。
       */
      projectRoot?: string;
      /** 目标所属的最具体 workspace folder。 */
      folder?: ProjectResolverFolder;
      /** true 时提示“当前目标不在工作区项目中”。 */
      outsideWorkspace: boolean;
      source: ProjectTargetSource;
    }
  | { kind: "needsSelection"; candidates: ProjectCandidate[] }
  | { kind: "unavailable" };

export interface ResolveProjectTargetInput {
  /** 命令携带的 URI 或 Explorer 明确选择。 */
  explicitTarget?: string;
  /** 当前活动编辑器路径。 */
  activeEditorTarget?: string;
  /** 用户为当前 workspace 容器明确保存的项目根。 */
  savedProjectRoot?: string;
  /** 最近使用的项目根，用于选择器突出。 */
  recentProjectRoot?: string;
  workspaceFolders: readonly ProjectResolverFolder[];
}

/** 返回包含 target 的最具体（路径最长）workspace folder。 */
export function mostSpecificWorkspaceFolder(
  folders: readonly ProjectResolverFolder[],
  target: string,
  options: PathSemantics,
): ProjectResolverFolder | undefined {
  let best: ProjectResolverFolder | undefined;
  let bestLength = -1;
  for (const folder of folders) {
    if (!isSameOrDescendantPath(target, folder.absolutePath, options)) {
      continue;
    }
    const length = normalizePathIdentity(folder.absolutePath, options).length;
    if (length > bestLength) {
      best = folder;
      bestLength = length;
    }
  }
  return best;
}

/**
 * 按固定顺序确定命令目标与项目上下文：
 * 1. 命令携带的 URI 或 Explorer 明确选择；
 * 2. 当前活动编辑器所属的最具体 workspace folder；
 * 3. 用户为当前 workspace 容器明确保存的项目根（仍须位于某 folder 内）；
 * 4. 只有一个 workspace folder 时使用该 folder；
 * 5. 多根且没有活动目标时返回 needsSelection，由 Host 打开项目选择器；
 * 6. 明确目标不属于任何 workspace folder 时按目标解析并标记
 *    outsideWorkspace（提示“当前目标不在工作区项目中”）；
 * 7. 无工作区且无目标时返回 unavailable。
 */
export function resolveProjectTarget(
  input: ResolveProjectTargetInput,
  options: PathSemantics,
): ProjectTargetResolution {
  const folders = input.workspaceFolders;

  if (input.explicitTarget) {
    const folder = mostSpecificWorkspaceFolder(
      folders,
      input.explicitTarget,
      options,
    );
    return {
      kind: "resolved",
      target: input.explicitTarget,
      projectRoot: folder?.absolutePath,
      folder,
      outsideWorkspace: folder === undefined,
      source: "explicit",
    };
  }

  if (input.activeEditorTarget) {
    const folder = mostSpecificWorkspaceFolder(
      folders,
      input.activeEditorTarget,
      options,
    );
    if (folder) {
      return {
        kind: "resolved",
        target: input.activeEditorTarget,
        projectRoot: folder.absolutePath,
        folder,
        outsideWorkspace: false,
        source: "activeEditor",
      };
    }
  }

  if (input.savedProjectRoot) {
    const folder = mostSpecificWorkspaceFolder(
      folders,
      input.savedProjectRoot,
      options,
    );
    if (folder) {
      return {
        kind: "resolved",
        target: input.savedProjectRoot,
        projectRoot: input.savedProjectRoot,
        folder,
        outsideWorkspace: false,
        source: "savedProject",
      };
    }
  }

  if (folders.length === 1) {
    const folder = folders[0];
    return {
      kind: "resolved",
      target: folder.absolutePath,
      projectRoot: folder.absolutePath,
      folder,
      outsideWorkspace: false,
      source: "singleFolder",
    };
  }

  if (folders.length > 1) {
    const candidates: ProjectCandidate[] = folders.map((folder) => ({
      name: folder.name,
      absolutePath: folder.absolutePath,
      isRecent:
        input.recentProjectRoot !== undefined &&
        isSamePathIdentity(
          folder.absolutePath,
          input.recentProjectRoot,
          options,
        ),
    }));
    candidates.sort(
      (left, right) => Number(right.isRecent) - Number(left.isRecent),
    );
    return { kind: "needsSelection", candidates };
  }

  return { kind: "unavailable" };
}

export interface ProjectRootFinalization {
  /** 最终项目根（原始路径，用于展示与文件操作）。 */
  projectRoot: string;
  /** true 表示未能可靠确定项目根，已回退为工作副本根。 */
  projectRootIsFallback: boolean;
}

/**
 * 在工作副本根确定后完成项目根定案：
 * - 候选项目根仍位于工作副本内时采用候选；
 * - 候选缺失（目标不在工作区项目）或候选已不在工作副本内（symlink、
 *   external、嵌套工作副本归属变化）时回退到工作副本根，由界面显示
 *   “尚未设置项目根”，不静默猜测项目边界。
 */
export function finalizeProjectRoot(
  projectRootCandidate: string | undefined,
  workingCopyRoot: string,
  options: PathSemantics,
): ProjectRootFinalization {
  if (
    projectRootCandidate &&
    isSameOrDescendantPath(projectRootCandidate, workingCopyRoot, options)
  ) {
    return { projectRoot: projectRootCandidate, projectRootIsFallback: false };
  }
  return { projectRoot: workingCopyRoot, projectRootIsFallback: true };
}

/**
 * 工作副本根确定后构建 scope 项目上下文（v0.0.7）：extension 命令入口与
 * Workbench 控制器共用，保证两处产生一致的项目身份与回退标记。
 */
export function finalizeScopeProject(
  projectRootCandidate: string | undefined,
  workingCopyRoot: string,
  options: PathSemantics,
): OperationScopeProject {
  const finalization = finalizeProjectRoot(
    projectRootCandidate,
    workingCopyRoot,
    options,
  );
  const identity = createProjectIdentity({
    projectRoot: finalization.projectRoot,
    workingCopyRoot,
    options,
  });
  return {
    projectRoot: identity.projectRoot,
    projectName: identity.projectName,
    rootIsFallback: finalization.projectRootIsFallback,
    workingCopyRelativePath: identity.workingCopyRelativePath,
  };
}
