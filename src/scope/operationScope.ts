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

export interface OperationScope {
  id: string;
  repositoryRoot: string;
  source: OperationScopeSource;
  roots: OperationScopeRoot[];
  allowExpandScope: false;
  includeExternals: boolean;
  includeNestedWorkingCopies: boolean;
  createdAt: number;
}

export async function createScopeFromExplorer(
  repositoryRoot: string,
  uri: vscode.Uri,
  selectedUris?: vscode.Uri[],
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
