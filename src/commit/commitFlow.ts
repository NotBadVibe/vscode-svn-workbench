import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { runSvnCommand } from '../svn/svnCommandRunner';
import { SvnCommandResult } from '../svn/svnTypes';

export interface CommitFlowPlan {
  cwd: string;
  commitPaths: string[];
  addPaths: string[];
  removePaths: string[];
  message: string;
}

export interface CommitFlowResult {
  addResults: SvnCommandResult[];
  removeResults: SvnCommandResult[];
  commitResult: SvnCommandResult;
  revision?: string;
}

export async function runCommitFlow(svnPath: string, plan: CommitFlowPlan, options: { signal?: AbortSignal } = {}): Promise<CommitFlowResult> {
  const addResults: SvnCommandResult[] = [];
  const removeResults: SvnCommandResult[] = [];
  const messageDir = await getCommitMessageTempDir();
  const messageFile = path.join(messageDir, `svn-workbench-commit-${randomUUID()}.txt`);

  try {
    for (const addPath of plan.addPaths) {
      const result = await runSvnCommand(svnPath, ['add', addPath], plan.cwd, options);
      addResults.push(result);
      throwIfFailed(result, `svn add failed for ${addPath}`);
    }

    for (const removePath of plan.removePaths) {
      const result = await runSvnCommand(svnPath, ['remove', removePath], plan.cwd, options);
      removeResults.push(result);
      throwIfFailed(result, `svn remove failed for ${removePath}`);
    }

    await fs.writeFile(messageFile, normalizeCommitMessage(plan.message), 'utf8');
    const commitResult = await runSvnCommand(
      svnPath,
      ['commit', ...plan.commitPaths, '-F', messageFile, '--encoding', 'utf-8'],
      plan.cwd,
      options
    );
    return { addResults, removeResults, commitResult, revision: parseCommittedRevision(commitResult.stdout) };
  } finally {
    await fs.rm(messageFile, { force: true });
  }
}

export function parseCommittedRevision(output: string): string | undefined {
  return /Committed revision\s+(\d+)/i.exec(output)?.[1];
}

function throwIfFailed(result: SvnCommandResult, fallbackMessage: string): void {
  if (result.exitCode === 0) {
    return;
  }

  throw new Error(result.stderr || fallbackMessage);
}

function normalizeCommitMessage(message: string): string {
  return message.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

async function getCommitMessageTempDir(): Promise<string> {
  if (process.platform !== 'win32') {
    return os.tmpdir();
  }

  // SlikSVN can fail to read -F files under non-ASCII user temp paths.
  const publicDir = process.env.PUBLIC || 'C:\\Users\\Public';
  const messageDir = path.join(publicDir, 'SVNWorkbench', 'Temp');
  await fs.mkdir(messageDir, { recursive: true });
  return messageDir;
}
