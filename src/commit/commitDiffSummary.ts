import * as path from "node:path";
import { OperationScope } from "../scope/operationScope";
import { isPathInScope } from "../scope/pathBoundaryGuard";
import { normalizePathIdentity } from "../scope/pathIdentity";
import { runSvnCommand } from "../svn/svnCommandRunner";

const MAX_DIFF_CHARS_PER_PATH = 160000;
const MAX_DIFF_PATHS = 80;

export interface CommitDiffSummary {
  absolutePath: string;
  relativePath: string;
  addedLines: number;
  deletedLines: number;
  hunks: number;
  binary: boolean;
  truncated: boolean;
  error?: string;
}

export async function collectCommitDiffSummaries(
  svnPath: string,
  scope: OperationScope,
  selectedPaths: string[],
): Promise<CommitDiffSummary[]> {
  const uniquePaths = uniqueNormalizedPaths(selectedPaths)
    .filter((filePath) => isPathInScope(scope, filePath))
    .slice(0, MAX_DIFF_PATHS);
  const summaries: CommitDiffSummary[] = [];

  for (const filePath of uniquePaths) {
    const result = await runSvnCommand(
      svnPath,
      ["diff", "--internal-diff", filePath],
      scope.repositoryRoot,
      { maxOutputBytes: MAX_DIFF_CHARS_PER_PATH * 4 },
    );
    if (result.exitCode !== 0 && !result.truncated) {
      summaries.push(
        createErroredSummary(
          filePath,
          scope.repositoryRoot,
          result.stderr || result.stdout || "svn diff failed",
        ),
      );
      continue;
    }

    const summary = parseSvnUnifiedDiffSummary(
      result.stdout,
      filePath,
      scope.repositoryRoot,
    );
    summaries.push({
      ...summary,
      truncated: summary.truncated || Boolean(result.truncated),
    });
  }

  return summaries.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );
}

export function parseSvnUnifiedDiffSummary(
  diffText: string,
  filePath: string,
  repositoryRoot: string,
  maxChars = MAX_DIFF_CHARS_PER_PATH,
): CommitDiffSummary {
  const absolutePath = path.resolve(filePath);
  const truncated = diffText.length > maxChars;
  const text = truncated ? diffText.slice(0, maxChars) : diffText;
  let addedLines = 0;
  let deletedLines = 0;
  let hunks = 0;
  let binary = false;

  for (const line of text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")) {
    if (line.startsWith("@@")) {
      hunks += 1;
      continue;
    }

    if (
      line.includes("Cannot display") ||
      line.includes("binary type") ||
      line.includes("svn:mime-type")
    ) {
      binary = true;
    }

    if (line.startsWith("+++") || line.startsWith("---")) {
      continue;
    }

    if (line.startsWith("+")) {
      addedLines += 1;
    } else if (line.startsWith("-")) {
      deletedLines += 1;
    }
  }

  return {
    absolutePath,
    relativePath: normalizeRelativePath(
      path.relative(repositoryRoot, absolutePath) ||
        path.basename(absolutePath),
    ),
    addedLines,
    deletedLines,
    hunks,
    binary,
    truncated,
  };
}

function createErroredSummary(
  filePath: string,
  repositoryRoot: string,
  error: string,
): CommitDiffSummary {
  const absolutePath = path.resolve(filePath);
  return {
    absolutePath,
    relativePath: normalizeRelativePath(
      path.relative(repositoryRoot, absolutePath) ||
        path.basename(absolutePath),
    ),
    addedLines: 0,
    deletedLines: 0,
    hunks: 0,
    binary: false,
    truncated: false,
    error: error.trim(),
  };
}

function uniqueNormalizedPaths(filePaths: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const filePath of filePaths) {
    const absolutePath = path.resolve(filePath);
    const key = normalizePathIdentity(absolutePath);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(absolutePath);
    }
  }

  return result;
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}
