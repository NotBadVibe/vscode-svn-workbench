import * as path from "node:path";
import { OperationScope } from "../scope/operationScope";
import { isPathInScope } from "../scope/pathBoundaryGuard";
import { normalizePathIdentity as normalizePathKey } from "../scope/pathIdentity";
import { nativePathSemantics } from "../scope/nativePathSemantics";
import { runSvnCommand } from "../svn/svnCommandRunner";
import { parseStatusXml } from "../svn/parsers/statusXmlParser";

export interface SvnConflictItem {
  absolutePath: string;
  relativePath: string;
  operation?: string;
  type?: string;
  sourceLeftRevision?: string;
  sourceRightRevision?: string;
  workingFile: string;
  mineFile?: string;
  baseFile?: string;
  theirsFile?: string;
}

export async function collectConflictItems(
  svnPath: string,
  scope: OperationScope,
): Promise<SvnConflictItem[]> {
  const byPath = new Map<string, SvnConflictItem>();

  for (const root of scope.roots) {
    const statusResult = await runSvnCommand(
      svnPath,
      ["status", "--xml", root.absolutePath],
      scope.repositoryRoot,
    );
    if (statusResult.exitCode !== 0) {
      throw new Error(
        statusResult.stderr || `无法采集 ${root.absolutePath} 的 SVN 冲突。`,
      );
    }

    const statusItems = parseStatusXml(
      statusResult.stdout,
      scope.repositoryRoot,
    );
    for (const item of statusItems.filter(
      (statusItem) => statusItem.status === "conflicted",
    )) {
      if (!isPathInScope(scope, item.absolutePath, nativePathSemantics)) {
        continue;
      }

      const infoResult = await runSvnCommand(
        svnPath,
        ["info", "--xml", item.absolutePath],
        scope.repositoryRoot,
      );
      if (infoResult.exitCode !== 0) {
        throw new Error(
          infoResult.stderr ||
            `无法读取 ${item.absolutePath} 的 SVN 冲突信息。`,
        );
      }

      const conflict = parseConflictInfoXml(
        infoResult.stdout,
        item.absolutePath,
        scope.repositoryRoot,
      );
      byPath.set(
        normalizePathKey(conflict.absolutePath, nativePathSemantics),
        conflict,
      );
    }
  }

  return [...byPath.values()].sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );
}

export function parseConflictInfoXml(
  xml: string,
  workingFile: string,
  repositoryRoot: string,
): SvnConflictItem {
  const conflictTag = /<conflict\s+([^>]+)>/.exec(xml);
  const operation = conflictTag
    ? getAttribute(conflictTag[1], "operation")
    : undefined;
  const type = conflictTag ? getAttribute(conflictTag[1], "type") : undefined;

  return {
    absolutePath: path.resolve(workingFile),
    relativePath: normalizeRelativePath(
      path.relative(repositoryRoot, workingFile) || path.basename(workingFile),
    ),
    operation,
    type,
    sourceLeftRevision: getVersionRevision(xml, "source-left"),
    sourceRightRevision: getVersionRevision(xml, "source-right"),
    workingFile: path.resolve(workingFile),
    mineFile: getConflictFile(xml, "prev-wc-file"),
    baseFile: getConflictFile(xml, "prev-base-file"),
    theirsFile: getConflictFile(xml, "cur-base-file"),
  };
}

function getVersionRevision(xml: string, side: string): string | undefined {
  const versionPattern = /<version\s+([^>]+)\/>/g;
  let match: RegExpExecArray | null;
  while ((match = versionPattern.exec(xml)) !== null) {
    if (getAttribute(match[1], "side") === side) {
      return getAttribute(match[1], "revision");
    }
  }
  return undefined;
}

function getConflictFile(xml: string, tagName: string): string | undefined {
  const match = new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`).exec(xml);
  return match ? path.resolve(decodeXml(match[1])) : undefined;
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
