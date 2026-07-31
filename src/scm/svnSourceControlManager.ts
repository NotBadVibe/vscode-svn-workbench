import * as path from 'node:path';
import * as vscode from 'vscode';
import { collectCommitCandidates } from '../commit/commitCandidateCollector';
import type { OperationScope } from '../scope/operationScope';
import { resolveWorkingCopyRoot } from '../scope/workingCopyResolver';
import { appendOutput } from '../diagnostics/outputChannel';

interface RepositoryModel {
  root: string;
  sourceControl: vscode.SourceControl;
  conflicts: vscode.SourceControlResourceGroup;
  changes: vscode.SourceControlResourceGroup;
  unversioned: vscode.SourceControlResourceGroup;
}

export class SvnSourceControlManager implements vscode.Disposable {
  private readonly repositories = new Map<string, RepositoryModel>();
  private readonly disposables: vscode.Disposable[] = [];
  private refreshTimer: NodeJS.Timeout | undefined;

  constructor(private readonly svnPath: () => Promise<string>) {}

  async initialize(): Promise<void> {
    await this.discoverRepositories();
    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => void this.discoverRepositories()),
      vscode.workspace.onDidSaveTextDocument((document) => this.scheduleRefresh(document.uri)),
      vscode.workspace.onDidCreateFiles((event) => this.scheduleRefresh(event.files[0])),
      vscode.workspace.onDidDeleteFiles((event) => this.scheduleRefresh(event.files[0])),
      vscode.workspace.onDidRenameFiles((event) => this.scheduleRefresh(event.files[0]?.newUri))
    );
  }

  async refreshAll(): Promise<void> {
    await Promise.all([...this.repositories.values()].map((repository) => this.refreshRepository(repository)));
  }

  dispose(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    for (const disposable of this.disposables) disposable.dispose();
    for (const repository of this.repositories.values()) repository.sourceControl.dispose();
    this.repositories.clear();
  }

  private async discoverRepositories(): Promise<void> {
    const svnPath = await this.svnPath();
    const roots = new Set<string>();
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const root = await resolveWorkingCopyRoot(svnPath, folder.uri.fsPath);
      if (root) roots.add(path.resolve(root));
      const metadata = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, '**/.svn/wc.db'), '**/{node_modules,.git}/**', 100);
      for (const item of metadata) roots.add(path.dirname(path.dirname(item.fsPath)));
    }
    for (const [key, repository] of this.repositories) {
      if (!roots.has(key)) {
        repository.sourceControl.dispose();
        this.repositories.delete(key);
      }
    }
    for (const root of roots) {
      if (!this.repositories.has(root)) this.repositories.set(root, this.createRepository(root));
    }
    await this.refreshAll();
  }

  private createRepository(root: string): RepositoryModel {
    const sourceControl = vscode.scm.createSourceControl('svnWorkbench', `SVN · ${path.basename(root)}`, vscode.Uri.file(root));
    sourceControl.acceptInputCommand = { command: 'svnWorkbench.commitFolder', title: '提交当前仓库', arguments: [vscode.Uri.file(root)] };
    sourceControl.statusBarCommands = [
      { command: 'svnWorkbench.updateScope', title: '$(sync) 更新', arguments: [vscode.Uri.file(root)] },
      { command: 'svnWorkbench.openWorkbench', title: '$(source-control) 变更', arguments: [vscode.Uri.file(root)] }
    ];
    const conflicts = sourceControl.createResourceGroup('conflicts', '冲突');
    const changes = sourceControl.createResourceGroup('changes', '受控变更');
    const unversioned = sourceControl.createResourceGroup('unversioned', '未版本化');
    return { root, sourceControl, conflicts, changes, unversioned };
  }

  private async refreshRepository(repository: RepositoryModel): Promise<void> {
    try {
      const scope: OperationScope = {
        id: `scm-${Date.now()}`, repositoryRoot: repository.root, source: 'scmSelection',
        roots: [{ absolutePath: repository.root, relativePath: '.', kind: 'folder' }],
        allowExpandScope: false, includeExternals: false, includeNestedWorkingCopies: false, createdAt: Date.now()
      };
      const candidates = await collectCommitCandidates(await this.svnPath(), scope);
      const states = candidates.map((candidate) => this.toResourceState(candidate));
      repository.conflicts.resourceStates = states.filter((item) => item.contextValue === 'svnWorkbench.conflicted');
      repository.unversioned.resourceStates = states.filter((item) => item.contextValue === 'svnWorkbench.unversioned');
      repository.changes.resourceStates = states.filter((item) => item.contextValue !== 'svnWorkbench.conflicted' && item.contextValue !== 'svnWorkbench.unversioned');
      repository.sourceControl.count = states.length;
    } catch (error) {
      appendOutput(`刷新 ${repository.root} 的 SCM 状态失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private toResourceState(candidate: Awaited<ReturnType<typeof collectCommitCandidates>>[number]): vscode.SourceControlResourceState {
    const uri = vscode.Uri.file(candidate.absolutePath);
    const contextValue = candidate.status === 'conflicted'
      ? 'svnWorkbench.conflicted'
      : candidate.status === 'unversioned'
        ? 'svnWorkbench.unversioned'
        : 'svnWorkbench.versioned';
    return {
      resourceUri: uri,
      contextValue,
      command: candidate.status === 'modified'
        ? { command: 'svnWorkbench.openDiff', title: '查看本地修改', arguments: [uri] }
        : { command: 'svnWorkbench.openWorkbench', title: '在 SVN 工作台中打开', arguments: [uri] },
      decorations: {
        tooltip: `${candidate.status}${candidate.reason ? ` · ${candidate.reason}` : ''}`,
        strikeThrough: candidate.status === 'deleted' || candidate.status === 'missing',
        faded: candidate.status === 'unversioned'
      }
    };
  }

  private scheduleRefresh(uri: vscode.Uri | undefined): void {
    if (!uri || uri.scheme !== 'file') return;
    if (![...this.repositories.values()].some((item) => isInside(item.root, uri.fsPath))) return;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => void this.refreshAll(), 250);
  }
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
