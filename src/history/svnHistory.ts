import { OperationScope } from "../scope/operationScope";
import { runSvnCommand } from "../svn/svnCommandRunner";
import { parseSvnLogXml, type SvnRevision } from "./svnHistoryParser";

export { parseSvnLogXml } from "./svnHistoryParser";
export type { SvnChangedPath, SvnRevision } from "./svnHistoryParser";

export async function collectSvnHistory(
  svnPath: string,
  scope: OperationScope,
  limit = 100,
): Promise<SvnRevision[]> {
  const byRevision = new Map<string, SvnRevision>();
  for (const root of scope.roots) {
    const result = await runSvnCommand(
      svnPath,
      ["log", "--xml", "-v", "--limit", String(limit), root.absolutePath],
      scope.repositoryRoot,
    );
    if (result.exitCode !== 0) {
      throw new Error(
        result.stderr || `无法读取 ${root.relativePath} 的 SVN 历史。`,
      );
    }
    for (const revision of parseSvnLogXml(result.stdout)) {
      const existing = byRevision.get(revision.revision);
      if (!existing) {
        byRevision.set(revision.revision, revision);
        continue;
      }
      const keys = new Set(
        existing.changedPaths.map((item) => `${item.action}:${item.path}`),
      );
      for (const changedPath of revision.changedPaths) {
        if (!keys.has(`${changedPath.action}:${changedPath.path}`)) {
          existing.changedPaths.push(changedPath);
        }
      }
    }
  }
  return [...byRevision.values()].sort(
    (left, right) => Number(right.revision) - Number(left.revision),
  );
}
