import * as path from "node:path";
import * as vscode from "vscode";
import { collectCommitCandidates } from "../commit/commitCandidateCollector";
import type { CommitSelectionRuleService } from "../commit/commitSelectionRuleService";
import { createWorkingCopyScope } from "../scope/operationScope";
import { resolveWorkingCopyRoot } from "../scope/workingCopyResolver";
import { isSameOrDescendantPath } from "../scope/pathIdentity";
import { appendOutput } from "../diagnostics/outputChannel";
import {
  groupProjectsByWorkingCopy,
  resolveSourceControlTitles,
  scmProjectKey,
  sliceCandidatesForProject,
  type ScmProjectRef,
} from "./projectSlicing";

interface ResourceGroups {
  conflicts: vscode.SourceControlResourceGroup;
  changes: vscode.SourceControlResourceGroup;
  unversioned: vscode.SourceControlResourceGroup;
}

interface ProjectModel extends ResourceGroups {
  project: ScmProjectRef;
  title: string;
  sourceControl: vscode.SourceControl;
}

/** 未被任何 workspace folder 覆盖的工作副本（如嵌套检出）保持独立 provider。 */
interface WorkingCopyModel extends ResourceGroups {
  root: string;
  sourceControl: vscode.SourceControl;
}

type CandidateCollection = Awaited<ReturnType<typeof collectCommitCandidates>>;

/**
 * v0.0.7 §6.2：每个显式 workspace folder 一个项目级 SCM provider
 * （标题“SVN · 项目名”，同名项目补充父路径）；同一工作副本共享一次
 * 状态采集并按项目根切片；未加载的兄弟目录不进入任何项目级候选。
 * 项目级提交/更新/变更命令携带明确项目目标（folder URI）。
 */
export class SvnSourceControlManager implements vscode.Disposable {
  private readonly projects = new Map<string, ProjectModel>();
  private readonly workingCopies = new Map<string, WorkingCopyModel>();
  private readonly disposables: vscode.Disposable[] = [];
  private refreshTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly svnPath: () => Promise<string>,
    private readonly commitSelectionRuleService?: CommitSelectionRuleService,
    private readonly collectCandidates: typeof collectCommitCandidates = collectCommitCandidates,
  ) {}

  async initialize(): Promise<void> {
    await this.discoverRepositories();
    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(
        () => void this.discoverRepositories(),
      ),
      vscode.workspace.onDidSaveTextDocument((document) =>
        this.scheduleRefresh(document.uri),
      ),
      vscode.workspace.onDidCreateFiles((event) =>
        this.scheduleRefresh(event.files[0]),
      ),
      vscode.workspace.onDidDeleteFiles((event) =>
        this.scheduleRefresh(event.files[0]),
      ),
      vscode.workspace.onDidRenameFiles((event) =>
        this.scheduleRefresh(event.files[0]?.newUri),
      ),
    );
  }

  async refreshAll(): Promise<void> {
    const svnPath = await this.svnPath();
    // 同一工作副本共享一次状态采集，再按项目根切片。
    const groups = groupProjectsByWorkingCopy(
      [...this.projects.values()].map((model) => model.project),
    );
    await Promise.all(
      [...groups.entries()].map(async ([, group]) => {
        const workingCopyRoot = group[0].workingCopyRoot;
        const candidates = await this.collectForWorkingCopy(
          svnPath,
          workingCopyRoot,
        );
        if (!candidates) return;
        for (const project of group) {
          const model = this.projects.get(scmProjectKey(project.absolutePath));
          if (!model) continue;
          this.applyCandidates(
            model,
            sliceCandidatesForProject(candidates, project.absolutePath),
          );
        }
      }),
    );
    await Promise.all(
      [...this.workingCopies.values()].map(async (model) => {
        const candidates = await this.collectForWorkingCopy(
          svnPath,
          model.root,
        );
        if (candidates) this.applyCandidates(model, candidates);
      }),
    );
  }

  dispose(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    for (const disposable of this.disposables) disposable.dispose();
    for (const model of this.projects.values()) model.sourceControl.dispose();
    for (const model of this.workingCopies.values())
      model.sourceControl.dispose();
    this.projects.clear();
    this.workingCopies.clear();
  }

  async discoverRepositories(): Promise<void> {
    const svnPath = await this.svnPath();
    const folders = vscode.workspace.workspaceFolders ?? [];
    const projects: ScmProjectRef[] = [];
    for (const folder of folders) {
      const root = await resolveWorkingCopyRoot(svnPath, folder.uri.fsPath);
      // 非 SVN folder 不建立 provider（诊断模块会说明归属与原因）。
      if (!root) continue;
      projects.push({
        name: folder.name,
        absolutePath: folder.uri.fsPath,
        workingCopyRoot: path.resolve(root),
      });
    }
    const titles = resolveSourceControlTitles(projects);

    const seenProjects = new Set<string>();
    projects.forEach((project, index) => {
      const key = scmProjectKey(project.absolutePath);
      seenProjects.add(key);
      const existing = this.projects.get(key);
      if (existing) {
        existing.project = project;
        if (existing.title !== titles[index]) {
          // SourceControl label 不可变：同名冲突出现/消失时安全重建 provider。
          existing.sourceControl.dispose();
          this.projects.set(
            key,
            this.createProjectProvider(project, titles[index]),
          );
        }
        return;
      }
      this.projects.set(
        key,
        this.createProjectProvider(project, titles[index]),
      );
    });
    for (const [key, model] of this.projects) {
      if (!seenProjects.has(key)) {
        model.sourceControl.dispose();
        this.projects.delete(key);
      }
    }

    // 嵌套/额外工作副本发现：只保留未被任何 workspace folder 覆盖的根。
    const orphanRoots = new Set<string>();
    for (const folder of folders) {
      const metadata = await vscode.workspace.findFiles(
        new vscode.RelativePattern(folder, "**/.svn/wc.db"),
        "**/{node_modules,.git}/**",
        100,
      );
      for (const item of metadata) {
        const root = path.dirname(path.dirname(item.fsPath));
        const coveredByFolder = folders.some((candidate) =>
          isSameOrDescendantPath(candidate.uri.fsPath, root),
        );
        if (!coveredByFolder) orphanRoots.add(root);
      }
    }
    for (const [key, model] of this.workingCopies) {
      if (!orphanRoots.has(key)) {
        model.sourceControl.dispose();
        this.workingCopies.delete(key);
      }
    }
    for (const root of orphanRoots) {
      const key = scmProjectKey(root);
      if (!this.workingCopies.has(key)) {
        this.workingCopies.set(key, this.createWorkingCopyProvider(root));
      }
    }
    await this.refreshAll();
  }

  private createGroups(sourceControl: vscode.SourceControl): ResourceGroups {
    return {
      conflicts: sourceControl.createResourceGroup("conflicts", "冲突"),
      changes: sourceControl.createResourceGroup("changes", "受控变更"),
      unversioned: sourceControl.createResourceGroup("unversioned", "未版本化"),
    };
  }

  private bindCommands(
    sourceControl: vscode.SourceControl,
    target: vscode.Uri,
  ): void {
    sourceControl.acceptInputCommand = {
      command: "svnWorkbench.commitFolder",
      title: "提交当前项目",
      arguments: [target],
    };
    sourceControl.statusBarCommands = [
      {
        command: "svnWorkbench.updateScope",
        title: "$(sync) 更新",
        arguments: [target],
      },
      {
        command: "svnWorkbench.openWorkbench",
        title: "$(source-control) 变更",
        arguments: [target],
      },
    ];
  }

  private createProjectProvider(
    project: ScmProjectRef,
    title: string,
  ): ProjectModel {
    const sourceControl = vscode.scm.createSourceControl(
      "svnWorkbench",
      title,
      vscode.Uri.file(project.absolutePath),
    );
    // 项目级命令携带明确项目目标（folder URI），由命令入口解析为项目 scope。
    this.bindCommands(sourceControl, vscode.Uri.file(project.absolutePath));
    return {
      project,
      title,
      sourceControl,
      ...this.createGroups(sourceControl),
    };
  }

  private createWorkingCopyProvider(root: string): WorkingCopyModel {
    const sourceControl = vscode.scm.createSourceControl(
      "svnWorkbench",
      `SVN · ${path.basename(root)}`,
      vscode.Uri.file(root),
    );
    this.bindCommands(sourceControl, vscode.Uri.file(root));
    return {
      root,
      sourceControl,
      ...this.createGroups(sourceControl),
    };
  }

  /** 工作副本级状态采集；失败时记录并保留旧状态，等待下次刷新恢复。 */
  private async collectForWorkingCopy(
    svnPath: string,
    workingCopyRoot: string,
  ): Promise<CandidateCollection | undefined> {
    try {
      const scope = createWorkingCopyScope(workingCopyRoot);
      // 与工作台共享同一规则解析服务，保证 SCM 摘要与提交页分类一致（规划 7.3）。
      const rules =
        await this.commitSelectionRuleService?.getEffectiveRules(
          workingCopyRoot,
        );
      return await this.collectCandidates(
        svnPath,
        scope,
        rules ? { rules } : undefined,
      );
    } catch (error) {
      appendOutput(
        `刷新 ${workingCopyRoot} 的 SCM 状态失败：${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
  }

  private applyCandidates(
    model: ResourceGroups & { sourceControl: vscode.SourceControl },
    candidates: CandidateCollection,
  ): void {
    const states = candidates.map((candidate) =>
      this.toResourceState(candidate),
    );
    model.conflicts.resourceStates = states.filter(
      (item) => item.contextValue === "svnWorkbench.conflicted",
    );
    model.unversioned.resourceStates = states.filter(
      (item) => item.contextValue === "svnWorkbench.unversioned",
    );
    model.changes.resourceStates = states.filter(
      (item) =>
        item.contextValue !== "svnWorkbench.conflicted" &&
        item.contextValue !== "svnWorkbench.unversioned",
    );
    model.sourceControl.count = states.length;
  }

  private toResourceState(
    candidate: CandidateCollection[number],
  ): vscode.SourceControlResourceState {
    const uri = vscode.Uri.file(candidate.absolutePath);
    const contextValue =
      candidate.status === "conflicted"
        ? "svnWorkbench.conflicted"
        : candidate.status === "unversioned"
          ? "svnWorkbench.unversioned"
          : "svnWorkbench.versioned";
    return {
      resourceUri: uri,
      contextValue,
      command:
        candidate.status === "modified"
          ? {
              command: "svnWorkbench.openDiff",
              title: "查看本地修改",
              arguments: [uri],
            }
          : {
              command: "svnWorkbench.openWorkbench",
              title: "在 SVN 工作台中打开",
              arguments: [uri],
            },
      decorations: {
        tooltip: `${candidate.status}${candidate.reason ? ` · ${candidate.reason}` : ""}`,
        strikeThrough:
          candidate.status === "deleted" || candidate.status === "missing",
        faded: candidate.status === "unversioned",
      },
    };
  }

  private scheduleRefresh(uri: vscode.Uri | undefined): void {
    if (!uri || uri.scheme !== "file") return;
    const inScope =
      [...this.projects.values()].some((model) =>
        isSameOrDescendantPath(uri.fsPath, model.project.absolutePath),
      ) ||
      [...this.workingCopies.values()].some((model) =>
        isSameOrDescendantPath(uri.fsPath, model.root),
      );
    if (!inScope) return;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => void this.refreshAll(), 250);
  }
}
