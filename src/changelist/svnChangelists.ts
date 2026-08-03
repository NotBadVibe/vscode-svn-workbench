import * as path from "node:path";
import type { OperationScope } from "../scope/operationScope";
import { validatePathsInScope } from "../scope/pathBoundaryGuard";
import { runSvnCommand } from "../svn/svnCommandRunner";
import {
  parseSvnChangelistsXml,
  type SvnChangelistGroup,
} from "./svnChangelistParser";

export { parseSvnChangelistsXml } from "./svnChangelistParser";
export type { SvnChangelistGroup } from "./svnChangelistParser";

export async function collectSvnChangelists(
  svnPath: string,
  scope: OperationScope,
): Promise<SvnChangelistGroup[]> {
  const result = await runSvnCommand(
    svnPath,
    ["status", "--xml", ...scope.roots.map((root) => root.absolutePath)],
    scope.repositoryRoot,
  );
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || "无法读取 SVN Changelist。");
  }
  return parseSvnChangelistsXml(result.stdout, scope.repositoryRoot);
}

export async function applySvnChangelist(
  svnPath: string,
  scope: OperationScope,
  name: string | undefined,
  relativePaths: string[],
) {
  const absolutePaths = relativePaths.map((item) =>
    path.resolve(scope.repositoryRoot, item),
  );
  const validation = validatePathsInScope(scope, absolutePaths);
  if (validation.outOfScopeItems.length > 0) {
    throw new Error("Changelist 包含当前右键范围外路径。");
  }
  if (absolutePaths.length === 0) {
    throw new Error("请选择至少一个文件。");
  }
  const args = name
    ? ["changelist", name, ...absolutePaths]
    : ["changelist", "--remove", ...absolutePaths];
  return runSvnCommand(svnPath, args, scope.repositoryRoot);
}
