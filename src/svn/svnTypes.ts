export type SvnStatus =
  | 'normal'
  | 'modified'
  | 'added'
  | 'deleted'
  | 'missing'
  | 'unversioned'
  | 'conflicted'
  | 'ignored'
  | 'external'
  | 'obstructed'
  | 'replaced'
  | 'incomplete'
  | 'unknown';

export interface SvnExecutable {
  path: string;
  version: string;
}

export interface SvnRepositoryInfo {
  workingCopyRoot: string;
  url?: string;
  repositoryRoot?: string;
  revision?: string;
}

export interface SvnStatusItem {
  absolutePath: string;
  relativePath: string;
  status: SvnStatus;
  propStatus?: SvnStatus;
}

export interface SvnCommandResult {
  command: string;
  args: string[];
  cwd?: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  cancelled?: boolean;
  truncated?: boolean;
}
