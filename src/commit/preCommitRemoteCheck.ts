import * as path from "node:path";
import { OperationScope } from "../scope/operationScope";
import { isPathInScope } from "../scope/pathBoundaryGuard";
import { runSvnCommand } from "../svn/svnCommandRunner";

export interface RemoteUpdateItem {
  absolutePath: string;
  relativePath: string;
  repositoryStatus: string;
}

export interface PreCommitRemoteCheckResult {
  checkedRevision?: string;
  outOfDateItems: RemoteUpdateItem[];
}

export async function checkPreCommitRemoteUpdates(
  svnPath: string,
  scope: OperationScope,
  commitPaths: string[],
): Promise<PreCommitRemoteCheckResult> {
  if (commitPaths.length === 0) {
    return { outOfDateItems: [] };
  }

  const result = await runSvnCommand(
    svnPath,
    ["status", "--show-updates", "--xml", ...commitPaths],
    scope.repositoryRoot,
  );
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || "提交前检查远端 SVN 更新失败。");
  }

  return parseRemoteUpdateStatusXml(result.stdout, scope);
}

export function parseRemoteUpdateStatusXml(
  xml: string,
  scope: OperationScope,
): PreCommitRemoteCheckResult {
  const outOfDateItems: RemoteUpdateItem[] = [];
  const checkedRevision = /<against\s+revision="([^"]+)"\s*\/>/.exec(xml)?.[1];
  const entryPattern = /<entry\s+path="([^"]+)"\s*>([\s\S]*?)<\/entry>/g;
  let entryMatch: RegExpExecArray | null;

  while ((entryMatch = entryPattern.exec(xml)) !== null) {
    const entryPath = decodeXml(entryMatch[1]);
    const absolutePath = path.resolve(scope.repositoryRoot, entryPath);
    if (!isPathInScope(scope, absolutePath)) {
      continue;
    }

    const repositoryStatus = getRepositoryStatus(entryMatch[2]);
    if (
      !repositoryStatus ||
      repositoryStatus === "none" ||
      repositoryStatus === "normal"
    ) {
      continue;
    }

    outOfDateItems.push({
      absolutePath,
      relativePath: normalizeRelativePath(
        path.relative(scope.repositoryRoot, absolutePath) ||
          path.basename(absolutePath),
      ),
      repositoryStatus,
    });
  }

  return { checkedRevision, outOfDateItems };
}

function getRepositoryStatus(entryBody: string): string | undefined {
  const reposStatus = /<repos-status\s+([^>]+)>?/.exec(entryBody);
  if (!reposStatus) {
    return undefined;
  }

  return getAttribute(reposStatus[1], "item");
}

function getAttribute(source: string, name: string): string | undefined {
  const match = new RegExp(`${name}="([^"]+)"`).exec(source);
  return match ? decodeXml(match[1]) : undefined;
}

function decodeXml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}
