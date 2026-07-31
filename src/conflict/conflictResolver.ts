import * as path from 'node:path';
import { OperationScope } from '../scope/operationScope';
import { isPathInScope } from '../scope/pathBoundaryGuard';
import { runSvnCommand } from '../svn/svnCommandRunner';
import { SvnCommandResult } from '../svn/svnTypes';

export interface ResolveConflictPreview {
  cwd: string;
  filePath: string;
  commands: string[];
  canResolve: boolean;
  issues: string[];
}

export interface ResolveConflictResult {
  result: SvnCommandResult;
  resolved: boolean;
}

export function buildResolveConflictPreview(scope: OperationScope, filePath: string): ResolveConflictPreview {
  const absolutePath = path.resolve(filePath);
  const issues: string[] = [];

  if (!isPathInScope(scope, absolutePath)) {
    issues.push('文件不在当前冲突处理范围内，已阻止。');
  }

  return {
    cwd: scope.repositoryRoot,
    filePath: absolutePath,
    commands: [`svn resolve --accept working ${quotePath(absolutePath)}`],
    canResolve: issues.length === 0,
    issues
  };
}

export async function resolveConflictUsingWorking(
  svnPath: string,
  scope: OperationScope,
  filePath: string
): Promise<ResolveConflictResult> {
  const preview = buildResolveConflictPreview(scope, filePath);
  if (!preview.canResolve) {
    throw new Error(preview.issues.join('\n'));
  }

  const result = await runSvnCommand(
    svnPath,
    ['resolve', '--accept', 'working', preview.filePath],
    scope.repositoryRoot
  );

  return {
    result,
    resolved: result.exitCode === 0 && isResolveSuccessful(result.stdout)
  };
}

export function isResolveSuccessful(output: string): boolean {
  return /resolved conflicted state/i.test(output) || /resolved/i.test(output);
}

function quotePath(filePath: string): string {
  return `"${filePath.replace(/"/g, '\\"')}"`;
}
