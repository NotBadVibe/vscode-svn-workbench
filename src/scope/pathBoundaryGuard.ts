import * as nodePath from "node:path";
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

/**
 * 按注入语义解析绝对路径：路径 resolve 必须与 PathSemantics.platform 一致，
 * 禁止使用宿主默认 node:path（合成 POSIX 路径在 Windows Runner 上会被宿主
 * 转成盘符路径，再交给 POSIX 语义比较会造成判定错误）。
 */
function resolveAbsolute(value: string, options: PathSemantics): string {
  const pathApi =
    options.platform === "win32" ? nodePath.win32 : nodePath.posix;
  return pathApi.resolve(options.cwd, value);
}

export function validatePathsInScope(
  scope: OperationScope,
  filePaths: string[],
  options: PathSemantics,
): ScopeValidationResult {
  const validItems: string[] = [];
  const outOfScopeItems: string[] = [];

  for (const filePath of filePaths) {
    // 返回路径也必须使用同一注入语义规范化，不能由测试机器决定。
    const absolutePath = resolveAbsolute(filePath, options);
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
  const absolutePath = resolveAbsolute(filePath, options);
  return scope.roots.some((root) => {
    const rootPath = resolveAbsolute(root.absolutePath, options);
    if (root.kind === "file") {
      return isSamePathIdentity(rootPath, absolutePath, options);
    }
    return isSameOrDescendantPath(absolutePath, rootPath, options);
  });
}
