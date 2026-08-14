import * as path from "node:path";
import { OperationScope } from "./operationScope";
import {
  isSameOrDescendantPath,
  isSamePathIdentity,
  type PathSemantics,
} from "./pathIdentity";

export interface ScopeValidationResult {
  validItems: string[];
  outOfScopeItems: string[];
}

export function validatePathsInScope(
  scope: OperationScope,
  filePaths: string[],
  options: PathSemantics,
): ScopeValidationResult {
  const validItems: string[] = [];
  const outOfScopeItems: string[] = [];

  for (const filePath of filePaths) {
    const absolutePath = path.resolve(filePath);
    if (isPathInScope(scope, absolutePath, options)) {
      validItems.push(absolutePath);
    } else {
      outOfScopeItems.push(absolutePath);
    }
  }

  return { validItems, outOfScopeItems };
}

export function isPathInScope(
  scope: OperationScope,
  filePath: string,
  options: PathSemantics,
): boolean {
  const absolutePath = path.resolve(filePath);
  return scope.roots.some((root) => {
    const rootPath = path.resolve(root.absolutePath);
    if (root.kind === "file") {
      return isSamePathIdentity(rootPath, absolutePath, options);
    }
    return isSameOrDescendantPath(absolutePath, rootPath, options);
  });
}
