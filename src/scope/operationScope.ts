import * as path from "node:path";
import { randomUUID } from "node:crypto";
import * as vscode from "vscode";

export type OperationScopeSource =
  | "explorerFile"
  | "explorerFolder"
  | "explorerMultiSelection"
  | "editorFile"
  | "scmSelection"
  | "workspace"
  | "commitBasket"
  | "commandPalette";

export interface OperationScopeRoot {
  absolutePath: string;
  relativePath: string;
  kind: "file" | "folder";
}

/**
 * v0.0.7 项目上下文：项目根可以与工作副本根重合，也可以是其子目录。
 * 只作为显示与失效绑定的上下文；操作范围仍由 roots 决定，不得扩大。
 */
export interface OperationScopeProject {
  projectRoot: string;
  projectName: string;
  /** true 表示未能可靠确定项目根，已回退为工作副本根。 */
  rootIsFallback: boolean;
  /** 项目根相对工作副本根的 "/" 分隔路径；空串表示两者重合。 */
  workingCopyRelativePath: string;
}

export interface OperationScope {
  id: string;
  repositoryRoot: string;
  source: OperationScopeSource;
  roots: OperationScopeRoot[];
  /** 当前项目上下文（v0.0.7）；旧调用方未提供时缺省。 */
  project?: OperationScopeProject;
  /**
   * v0.0.7：用户明确跨项目多选时涉及的全部项目；仅当跨越多个项目时
   * 设置，用于文件徽标与预览分组。跨项目 scope 只能由明确选择产生。
   */
  projects?: OperationScopeProject[];
  allowExpandScope: false;
  includeExternals: boolean;
  includeNestedWorkingCopies: boolean;
  createdAt: number;
}

export async function createScopeFromExplorer(
  repositoryRoot: string,
  uri: vscode.Uri,
  selectedUris?: vscode.Uri[],
  project?: OperationScopeProject,
): Promise<OperationScope> {
  const uris = selectedUris && selectedUris.length > 0 ? selectedUris : [uri];
  const roots: OperationScopeRoot[] = [];

  for (const current of uris) {
    const stat = await vscode.workspace.fs.stat(current);
    const absolutePath = path.resolve(current.fsPath);
    roots.push({
      absolutePath,
      relativePath:
        path.relative(repositoryRoot, absolutePath) ||
        path.basename(absolutePath),
      kind: stat.type === vscode.FileType.Directory ? "folder" : "file",
    });
  }

  return {
    id: randomUUID(),
    repositoryRoot: path.resolve(repositoryRoot),
    source:
      roots.length > 1
        ? "explorerMultiSelection"
        : roots[0].kind === "folder"
          ? "explorerFolder"
          : "explorerFile",
    roots: mergeParentChildRoots(roots),
    ...(project ? { project } : {}),
    allowExpandScope: false,
    includeExternals: false,
    includeNestedWorkingCopies: false,
    createdAt: Date.now(),
  };
}

/**
 * v0.0.7：整个工作副本的采集 scope（SCM 共享采集、项目总览统计共用），
 * 只用于状态采集，不携带项目上下文。
 */
export function createWorkingCopyScope(repositoryRoot: string): OperationScope {
  return {
    id: `wc-${Date.now()}`,
    repositoryRoot: path.resolve(repositoryRoot),
    source: "workspace",
    roots: [
      {
        absolutePath: path.resolve(repositoryRoot),
        relativePath: ".",
        kind: "folder",
      },
    ],
    allowExpandScope: false,
    includeExternals: false,
    includeNestedWorkingCopies: false,
    createdAt: Date.now(),
  };
}

function mergeParentChildRoots(
  roots: OperationScopeRoot[],
): OperationScopeRoot[] {
  const sorted = [...roots].sort(
    (a, b) => a.absolutePath.length - b.absolutePath.length,
  );
  const result: OperationScopeRoot[] = [];

  for (const root of sorted) {
    const covered = result.some((existing) => {
      if (existing.kind !== "folder") {
        return false;
      }
      const relative = path.relative(existing.absolutePath, root.absolutePath);
      return (
        relative === "" ||
        (!relative.startsWith("..") && !path.isAbsolute(relative))
      );
    });
    if (!covered) {
      result.push(root);
    }
  }

  return result;
}
