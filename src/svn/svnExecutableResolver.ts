import * as fs from 'node:fs';
import * as os from 'node:os';
import * as vscode from 'vscode';
import { runSvnCommand } from './svnCommandRunner';
import { SvnExecutable } from './svnTypes';

export async function resolveSvnExecutable(): Promise<SvnExecutable | undefined> {
  const config = vscode.workspace.getConfiguration('svnWorkbench');
  const configured = config.get<string | null>('svn.path');
  const candidates = buildSvnExecutableCandidates(configured);

  for (const candidate of candidates) {
    try {
      const result = await runSvnCommand(candidate, ['--version', '--quiet']);
      const version = result.stdout.trim();
      if (result.exitCode === 0 && version) {
        return { path: candidate, version };
      }
    } catch {
      // Try the next candidate.
    }
  }

  return undefined;
}

export function buildSvnExecutableCandidates(
  configured?: string | null,
  platform: NodeJS.Platform = os.platform(),
  pathExists: (candidate: string) => boolean = fs.existsSync
): string[] {
  const candidates: string[] = [];
  if (configured) {
    candidates.push(configured);
  }

  candidates.push(platform === 'win32' ? 'svn.exe' : 'svn');

  if (platform === 'win32') {
    candidates.push(
      'C:\\Program Files\\TortoiseSVN\\bin\\svn.exe',
      'C:\\Program Files\\SlikSvn\\bin\\svn.exe',
      'C:\\Program Files\\VisualSVN\\bin\\svn.exe',
      'C:\\Program Files\\VisualSVN Server\\bin\\svn.exe'
    );
  } else if (platform === 'darwin') {
    candidates.push('/opt/homebrew/bin/svn', '/usr/local/bin/svn', '/usr/bin/svn');
  }

  return [...new Set(candidates)].filter((candidate) => {
    if (candidate === 'svn' || candidate === 'svn.exe') {
      return true;
    }
    return pathExists(candidate);
  });
}
