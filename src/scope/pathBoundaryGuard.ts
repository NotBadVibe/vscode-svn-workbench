import * as path from "node:path";
import { OperationScope } from "./operationScope";

export interface ScopeValidationResult {
  validItems: string[];
  outOfScopeItems: string[];
}

export function validatePathsInScope(
  scope: OperationScope,
  filePaths: string[],
): ScopeValidationResult {
  const validItems: string[] = [];
  const outOfScopeItems: string[] = [];

  for (const filePath of filePaths) {
    const absolutePath = path.resolve(filePath);
    if (isPathInScope(scope, absolutePath)) {
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
): boolean {
  const absolutePath = path.resolve(filePath);
  return scope.roots.some((root) => {
    const rootPath = path.resolve(root.absolutePath);
    if (root.kind === "file") {
      return comparePlatformPath(rootPath, absolutePath) === 0;
    }

    const relative = path.relative(rootPath, absolutePath);
    return (
      relative === "" ||
      (!relative.startsWith("..") && !path.isAbsolute(relative))
    );
  });
}

function comparePlatformPath(left: string, right: string): number {
  if (process.platform === "win32") {
    return left.toLocaleLowerCase().localeCompare(right.toLocaleLowerCase());
  }
  return left.localeCompare(right);
}
