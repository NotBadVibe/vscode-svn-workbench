import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { collectCommitCandidates } from "../../commit/commitCandidateCollector";
import { buildCommitPlanPreview } from "../../commit/commitPlanBuilder";
import type { HistorySnapshot } from "../../protocol/workbenchProtocol";
import type { OperationScope } from "../../scope/operationScope";
import { runSvnCommand } from "../../svn/svnCommandRunner";
import { errorMessage, normalizeRelative } from "./workbenchPresentation";

export const MAX_DIFF_BYTES = 5 * 1024 * 1024;
export const MAX_PATCH_BYTES = 20 * 1024 * 1024;

export function containsNull(buffer: Buffer): boolean {
  return buffer.includes(0);
}

export async function readFileForDiff(
  filePath: string,
): Promise<{ text: string; binary: boolean; truncated: boolean }> {
  try {
    const handle = await fs.open(filePath, "r");
    try {
      const stat = await handle.stat();
      const byteLength = Math.min(stat.size, MAX_DIFF_BYTES);
      const buffer = Buffer.alloc(byteLength);
      await handle.read(buffer, 0, byteLength, 0);
      const binary = containsNull(buffer);
      return {
        text: binary ? "" : buffer.toString("utf8"),
        binary,
        truncated: stat.size > MAX_DIFF_BYTES,
      };
    } finally {
      await handle.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { text: "", binary: false, truncated: false };
    }
    throw error;
  }
}

export function truncateUtf8(buffer: Buffer): string {
  return buffer.subarray(0, MAX_DIFF_BYTES).toString("utf8");
}

export function hashOperationScope(scope: OperationScope): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        repositoryRoot: path.resolve(scope.repositoryRoot),
        roots: scope.roots
          .map((root) => ({
            absolutePath: path.resolve(root.absolutePath),
            kind: root.kind,
          }))
          .sort((left, right) =>
            left.absolutePath.localeCompare(right.absolutePath),
          ),
        includeExternals: scope.includeExternals,
        includeNestedWorkingCopies: scope.includeNestedWorkingCopies,
      }),
    )
    .digest("hex");
}

export async function resolveRepositoryUuid(
  svnPath: string,
  scope: OperationScope,
): Promise<string> {
  try {
    const result = await runSvnCommand(
      svnPath,
      ["info", "--show-item", "repos-uuid", scope.repositoryRoot],
      scope.repositoryRoot,
    );
    const uuid = result.stdout.trim();
    if (result.exitCode === 0 && uuid) return uuid;
  } catch {
    // Settings and diagnostics remain available without a working SVN CLI.
  }
  const rootHash = createHash("sha256")
    .update(path.resolve(scope.repositoryRoot))
    .digest("hex")
    .slice(0, 16);
  return `unavailable-${rootHash}`;
}

export function hashCandidateState(
  candidates: Awaited<ReturnType<typeof collectCommitCandidates>>,
  message: string,
  selectedPaths: string[],
): string {
  const normalized = candidates
    .map((candidate) =>
      [
        candidate.relativePath,
        candidate.status,
        candidate.propStatus ?? "",
        candidate.selection,
      ].join(":"),
    )
    .sort();
  return createHash("sha256")
    .update(
      JSON.stringify({
        candidates: normalized,
        message,
        selectedPaths: [...selectedPaths].sort(),
      }),
    )
    .digest("hex");
}

export function buildRelativeCommitCommands(
  repositoryRoot: string,
  plan: ReturnType<typeof buildCommitPlanPreview>,
): string[] {
  const quote = (filePath: string) =>
    `"${normalizeRelative(path.relative(repositoryRoot, filePath)).replace(/"/g, '\\"')}"`;
  return [
    ...plan.addPaths.map((item) => `svn add ${quote(item)}`),
    ...plan.removePaths.map((item) => `svn remove ${quote(item)}`),
    ...(plan.commitPaths.length > 0
      ? [
          `svn commit ${plan.commitPaths.map(quote).join(" ")} -F <message-file> --encoding utf-8`,
        ]
      : []),
  ];
}

export function toConflictContentView(
  value:
    { content?: string; truncated: boolean; readError?: string } | undefined,
) {
  if (!value) return undefined;
  return {
    content: value.content,
    truncated: value.truncated,
    readError: value.readError,
  };
}

export async function hashFileContents(filePath: string): Promise<string> {
  try {
    return createHash("sha256")
      .update(await fs.readFile(filePath))
      .digest("hex");
  } catch (error) {
    throw new Error(`无法读取待解决文件：${errorMessage(error)}`, {
      cause: error,
    });
  }
}

export async function hashFileContentsOrMissing(
  filePath: string,
): Promise<string> {
  try {
    return createHash("sha256")
      .update(await fs.readFile(filePath))
      .digest("hex");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    throw error;
  }
}

export function getSingleFileScopeRoot(scope: OperationScope) {
  return scope.roots.length === 1 && scope.roots[0].kind === "file"
    ? scope.roots[0]
    : undefined;
}

export function getSingleScopeTarget(scope: OperationScope) {
  return scope.roots.length === 1 ? scope.roots[0] : undefined;
}

export function getSingleFolderScopeTarget(scope: OperationScope) {
  return scope.roots.length === 1 && scope.roots[0].kind === "folder"
    ? scope.roots[0]
    : undefined;
}

export function hashProperties(
  items: Array<{ name: string; value: string }>,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify(
        [...items].sort((left, right) => left.name.localeCompare(right.name)),
      ),
    )
    .digest("hex");
}

export function parseBlameOutput(
  output: string,
): NonNullable<HistorySnapshot["blame"]> {
  return output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      const match = /^\s*(\d+|-)\s+(\S+)\s?(.*)$/.exec(line);
      return {
        line: index + 1,
        revision: match?.[1] ?? "?",
        author: match?.[2] ?? "未知",
        content: match?.[3] ?? line,
      };
    });
}
