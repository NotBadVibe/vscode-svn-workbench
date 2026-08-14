import * as path from "node:path";
import * as vscode from "vscode";
import {
  AiUsageScenario,
  resolveAiProviderConfig,
} from "./ai/aiModelConfiguration";
import { OpenAiCompatibleProvider } from "./ai/openAiCompatibleProvider";
import { appendOutput, showOutput } from "./diagnostics/outputChannel";
import { ensureSvnWorkbenchProjectConfig } from "./commit/commitConvention";
import {
  CommitSelectionRuleService,
  registerCommitSelectionRuleWatchers,
} from "./commit/commitSelectionRuleService";
import {
  createScopeFromExplorer,
  type OperationScopeProject,
} from "./scope/operationScope";
import {
  finalizeScopeProject,
  mostSpecificWorkspaceFolder,
  resolveProjectTarget,
} from "./scope/projectResolver";
import { resolveWorkingCopyRoot } from "./scope/workingCopyResolver";
import {
  isSameOrDescendantPath,
  normalizePathIdentity as normalizePathKey,
} from "./scope/pathIdentity";
import { resolveSvnExecutable } from "./svn/svnExecutableResolver";
import { runSvnCommand } from "./svn/svnCommandRunner";
import { WorkbenchWindowManager } from "./extension/workbench/workbenchWindowManager";
import { SvnSourceControlManager } from "./scm/svnSourceControlManager";
import type { WorkbenchTaskId } from "./protocol/workbenchProtocol";

let cachedSvnPath: string | undefined;
let extensionContext: vscode.ExtensionContext | undefined;
let workbenchWindowManager: WorkbenchWindowManager | undefined;
let sourceControlManager: SvnSourceControlManager | undefined;

export function activate(context: vscode.ExtensionContext): void {
  extensionContext = context;
  // 统一的提交选择规则解析服务：工作台与 SCM 共享，保证所有候选入口
  // 在同一仓库解析出相同有效规则；监听配置与仓库文件变化并失效缓存。
  const commitSelectionRuleService = new CommitSelectionRuleService();
  // 0.0.5 统一模块窗口管理器：每个模块一个独立 Webview 窗口，
  // 同模块单例复用、关闭后重建；跨模块动作经管理器路由；
  // 多窗口共享按仓库身份管理的 SVN 安全上下文。
  workbenchWindowManager = new WorkbenchWindowManager(
    context,
    commitSelectionRuleService,
  );
  sourceControlManager = new SvnSourceControlManager(
    getSvnPath,
    commitSelectionRuleService,
  );
  appendOutput("SVN 工作台已激活。");

  context.subscriptions.push(
    workbenchWindowManager,
    sourceControlManager,
    commitSelectionRuleService,
    ...registerCommitSelectionRuleWatchers(commitSelectionRuleService),
    vscode.commands.registerCommand(
      "svnWorkbench.openWorkbench",
      openWorkbench,
    ),
    vscode.commands.registerCommand("svnWorkbench.showOutput", showOutput),
    vscode.commands.registerCommand(
      "svnWorkbench.checkEnvironment",
      checkEnvironment,
    ),
    vscode.commands.registerCommand(
      "svnWorkbench.refreshStatus",
      refreshStatus,
    ),
    vscode.commands.registerCommand("svnWorkbench.updateScope", updateScope),
    vscode.commands.registerCommand(
      "svnWorkbench.openProperties",
      openProperties,
    ),
    vscode.commands.registerCommand("svnWorkbench.openCleanup", openCleanup),
    vscode.commands.registerCommand(
      "svnWorkbench.openRepositoryBrowser",
      (resource?: unknown, selected?: unknown[]) =>
        openRepositoryTask("repository/browse", resource, selected),
    ),
    vscode.commands.registerCommand(
      "svnWorkbench.createBranch",
      (resource?: unknown, selected?: unknown[]) =>
        openRepositoryTask("repository/branch", resource, selected),
    ),
    vscode.commands.registerCommand(
      "svnWorkbench.createTag",
      (resource?: unknown, selected?: unknown[]) =>
        openRepositoryTask("repository/tag", resource, selected),
    ),
    vscode.commands.registerCommand(
      "svnWorkbench.switchWorkingCopy",
      (resource?: unknown, selected?: unknown[]) =>
        openRepositoryTask("repository/switch", resource, selected),
    ),
    vscode.commands.registerCommand(
      "svnWorkbench.relocateWorkingCopy",
      (resource?: unknown, selected?: unknown[]) =>
        openRepositoryTask("repository/relocate", resource, selected),
    ),
    vscode.commands.registerCommand(
      "svnWorkbench.mergeToWorkingCopy",
      (resource?: unknown, selected?: unknown[]) =>
        openRepositoryTask("repository/merge", resource, selected),
    ),
    vscode.commands.registerCommand(
      "svnWorkbench.openPatchShelf",
      (resource?: unknown, selected?: unknown[]) =>
        openRepositoryTask("repository/patch-shelf", resource, selected),
    ),
    vscode.commands.registerCommand(
      "svnWorkbench.openReleaseNotes",
      (resource?: unknown, selected?: unknown[]) =>
        openRepositoryTask("repository/release-notes", resource, selected),
    ),
    vscode.commands.registerCommand("svnWorkbench.commitFolder", commitFolder),
    vscode.commands.registerCommand(
      "svnWorkbench.openConflictCenter",
      openConflictCenter,
    ),
    vscode.commands.registerCommand("svnWorkbench.openDiff", openDiff),
    // 不贡献到命令面板；复用当前安全会话，供自动化和受控内部入口调用。
    vscode.commands.registerCommand("svnWorkbench.openDiffInEditor", () =>
      workbenchWindowManager?.openNativeDiffInEditor(),
    ),
    vscode.commands.registerCommand("svnWorkbench.openHistory", openHistory),
    vscode.commands.registerCommand(
      "svnWorkbench.openTeamConfig",
      openTeamConfig,
    ),
    vscode.commands.registerCommand(
      "svnWorkbench.configureTeamConfig",
      configureTeamConfig,
    ),
    vscode.commands.registerCommand("svnWorkbench.aiConfigure", aiConfigure),
    vscode.commands.registerCommand(
      "svnWorkbench.aiTestConnection",
      aiTestConnection,
    ),
    vscode.commands.registerCommand(
      "svnWorkbench.aiSelectScope",
      aiSelectScope,
    ),
    vscode.commands.registerCommand("svnWorkbench.aiReviewScope", openAiReview),
    vscode.commands.registerCommand("svnWorkbench.analyzeImpact", openImpact),
    vscode.commands.registerCommand(
      "svnWorkbench.openChangelists",
      openChangelists,
    ),
    vscode.commands.registerCommand("svnWorkbench.openAgent", openAgent),
    vscode.commands.registerCommand(
      "svnWorkbench.openAcceptanceChecklist",
      openAcceptanceChecklist,
    ),
    vscode.commands.registerCommand("svnWorkbench.openProjects", () =>
      openSupportModule("projects", "projects/overview"),
    ),
    vscode.commands.registerCommand("svnWorkbench.scmRefresh", () =>
      sourceControlManager?.refreshAll(),
    ),
    vscode.commands.registerCommand("svnWorkbench.add", (resource?: unknown) =>
      openFileOperation("add", resource),
    ),
    vscode.commands.registerCommand(
      "svnWorkbench.ignore",
      (resource?: unknown) => openFileOperation("ignore", resource),
    ),
    vscode.commands.registerCommand(
      "svnWorkbench.revert",
      (resource?: unknown) => openFileOperation("revert", resource),
    ),
    vscode.commands.registerCommand("svnWorkbench.lock", (resource?: unknown) =>
      openFileOperation("lock", resource),
    ),
    vscode.commands.registerCommand(
      "svnWorkbench.unlock",
      (resource?: unknown) => openFileOperation("unlock", resource),
    ),
  );
  void sourceControlManager.initialize();
}

export function deactivate(): void {
  workbenchWindowManager = undefined;
  sourceControlManager = undefined;
}

async function openFileOperation(
  operation: "add" | "ignore" | "revert" | "lock" | "unlock",
  resource?: unknown,
): Promise<void> {
  const uri = resourceUri(resource);
  const prepared = await prepareWorkbenchRequest(uri);
  if (!prepared || !workbenchWindowManager) return;
  await workbenchWindowManager.open({
    moduleId: "changes",
    initialFileOperation: { operation, ignoreMode: "directory" },
    ...prepared,
  });
}

function resourceUri(value: unknown): vscode.Uri | undefined {
  if (value instanceof vscode.Uri) return value;
  if (
    typeof value === "object" &&
    value !== null &&
    "resourceUri" in value &&
    (value as { resourceUri?: unknown }).resourceUri instanceof vscode.Uri
  ) {
    return (value as { resourceUri: vscode.Uri }).resourceUri;
  }
  return undefined;
}

function resourceUris(values: unknown[] | undefined): vscode.Uri[] | undefined {
  if (!values) return undefined;
  const uris = values
    .map(resourceUri)
    .filter((value): value is vscode.Uri => value !== undefined);
  return uris.length > 0 ? uris : undefined;
}

/*
 * v0.0.7 活动项目解析（releases/v0.0.7 §5）：命令目标与项目上下文统一
 * 经 resolveProjectTarget 确定，禁止业务入口固定使用 workspaceFolders[0]。
 * 项目根与最近项目只保存在当前 workspace 容器的本地状态。
 */
const PROJECT_ROOT_STATE_KEY = "svnWorkbench.projectRoot";
const RECENT_PROJECT_ROOT_STATE_KEY = "svnWorkbench.recentProjectRoot";

type CommandTargetResult =
  | {
      status: "resolved";
      target: vscode.Uri;
      projectRootCandidate?: string;
      outsideWorkspace: boolean;
    }
  | { status: "cancelled" }
  | { status: "unavailable" };

/** 当前工作区 folder 引用列表（项目解析与切片共用）。 */
function currentFolderRefs(): { name: string; absolutePath: string }[] {
  return (vscode.workspace.workspaceFolders ?? []).map((folder) => ({
    name: folder.name,
    absolutePath: folder.uri.fsPath,
  }));
}

async function resolveCommandTarget(
  explicitUri?: vscode.Uri,
  options: { silentUnavailable?: boolean } = {},
): Promise<CommandTargetResult> {
  const workspaceFolders = currentFolderRefs();
  const resolution = resolveProjectTarget({
    explicitTarget: explicitUri?.fsPath,
    activeEditorTarget: vscode.window.activeTextEditor?.document.uri.fsPath,
    savedProjectRoot: extensionContext?.workspaceState.get<string>(
      PROJECT_ROOT_STATE_KEY,
    ),
    recentProjectRoot: extensionContext?.workspaceState.get<string>(
      RECENT_PROJECT_ROOT_STATE_KEY,
    ),
    workspaceFolders,
  });

  if (resolution.kind === "unavailable") {
    if (!options.silentUnavailable) {
      vscode.window.showWarningMessage("请先打开工作区或选择 SVN 路径。");
    }
    return { status: "unavailable" };
  }

  if (resolution.kind === "needsSelection") {
    // 多根工作区且没有活动目标：可搜索、键盘可用的项目选择器，
    // 突出最近项目但不自动进入。
    const picked = await vscode.window.showQuickPick(
      resolution.candidates.map((candidate) => ({
        label: candidate.name,
        description: candidate.absolutePath,
        detail: candidate.isRecent ? "最近使用的项目" : undefined,
        candidate,
      })),
      {
        placeHolder: "当前工作区包含多个项目，请选择本次操作的项目",
        canPickMany: false,
      },
    );
    if (!picked) {
      return { status: "cancelled" };
    }
    const projectRoot = picked.candidate.absolutePath;
    await extensionContext?.workspaceState.update(
      PROJECT_ROOT_STATE_KEY,
      projectRoot,
    );
    await extensionContext?.workspaceState.update(
      RECENT_PROJECT_ROOT_STATE_KEY,
      projectRoot,
    );
    return {
      status: "resolved",
      target: vscode.Uri.file(projectRoot),
      projectRootCandidate: projectRoot,
      outsideWorkspace: false,
    };
  }

  return {
    status: "resolved",
    target: explicitUri ?? vscode.Uri.file(resolution.target),
    projectRootCandidate: resolution.projectRoot,
    outsideWorkspace: resolution.outsideWorkspace,
  };
}

/** 工作副本根确定后构建 scope 项目上下文；项目边界变化使旧结果失效。 */
function buildScopeProject(
  projectRootCandidate: string | undefined,
  workingCopyRoot: string,
): OperationScopeProject {
  const project = finalizeScopeProject(projectRootCandidate, workingCopyRoot);
  if (!project.rootIsFallback) {
    void extensionContext?.workspaceState.update(
      RECENT_PROJECT_ROOT_STATE_KEY,
      project.projectRoot,
    );
  }
  return project;
}

async function openWorkbench(
  resource?: unknown,
  selectedResources?: unknown[],
): Promise<void> {
  const prepared = await prepareWorkbenchRequest(
    resourceUri(resource),
    resourceUris(selectedResources),
  );
  if (!prepared || !workbenchWindowManager) {
    return;
  }
  await workbenchWindowManager.open({
    moduleId: "changes",
    taskId: "changes/overview",
    ...prepared,
  });
}

async function checkEnvironment(): Promise<void> {
  await openSupportModule("diagnostics", "diagnostics/environment");
}

async function refreshStatus(resource?: unknown): Promise<void> {
  await openWorkbench(resource);
}

async function updateScope(
  resource?: unknown,
  selectedResources?: unknown[],
): Promise<void> {
  const prepared = await prepareWorkbenchRequest(
    resourceUri(resource),
    resourceUris(selectedResources),
  );
  if (!prepared || !workbenchWindowManager) {
    return;
  }
  await workbenchWindowManager.open({
    moduleId: "repository",
    taskId: "repository/update",
    ...prepared,
  });
}

async function openProperties(
  resource?: unknown,
  selectedResources?: unknown[],
): Promise<void> {
  const prepared = await prepareWorkbenchRequest(
    resourceUri(resource),
    resourceUris(selectedResources),
  );
  if (!prepared || !workbenchWindowManager) {
    return;
  }
  await workbenchWindowManager.open({
    moduleId: "repository",
    taskId: "repository/properties",
    ...prepared,
  });
}

async function openCleanup(
  resource?: unknown,
  selectedResources?: unknown[],
): Promise<void> {
  await openRepositoryTask("repository/recovery", resource, selectedResources);
}

async function openRepositoryTask(
  taskId: Extract<WorkbenchTaskId, `repository/${string}`>,
  resource?: unknown,
  selectedResources?: unknown[],
): Promise<void> {
  const prepared = await prepareWorkbenchRequest(
    resourceUri(resource),
    resourceUris(selectedResources),
  );
  if (!prepared || !workbenchWindowManager) return;
  await workbenchWindowManager.open({
    moduleId: "repository",
    taskId,
    ...prepared,
  });
}

async function openAcceptanceChecklist(): Promise<void> {
  await openSupportModule("diagnostics", "diagnostics/acceptance");
}

async function commitFolder(
  resource?: unknown,
  selectedResources?: unknown[],
): Promise<void> {
  const prepared = await prepareWorkbenchRequest(
    resourceUri(resource),
    resourceUris(selectedResources),
  );
  if (!prepared) return;
  const roots = prepared.scope.roots
    .map((root) => `${root.kind}: ${root.relativePath}`)
    .join(", ");
  appendOutput(`OperationScope created: ${roots}`);

  if (!extensionContext) {
    vscode.window.showErrorMessage("SVN 工作台尚未激活。");
    return;
  }

  try {
    if (!workbenchWindowManager) {
      throw new Error("SVN 工作台控制器不可用。");
    }
    await workbenchWindowManager.open({
      moduleId: "commit",
      taskId: "commit/compose",
      ...prepared,
    });
  } catch (error) {
    appendOutput(
      `打开提交页面失败：${error instanceof Error ? error.message : String(error)}`,
    );
    vscode.window.showErrorMessage(
      "无法打开 SVN 提交页面，详细信息请查看“SVN 工作台”输出。",
    );
    showOutput();
  }
}

async function openDiff(resource?: unknown): Promise<void> {
  const svnPath = await getSvnPath();
  if (!svnPath) {
    return;
  }
  const filePath =
    resourceUri(resource)?.fsPath ??
    vscode.window.activeTextEditor?.document.uri.fsPath;
  if (!filePath) {
    vscode.window.showWarningMessage("请先打开或选择要比较的文件。");
    return;
  }

  const target = vscode.Uri.file(filePath);
  const repositoryRoot = await getRepositoryRootForTarget(target, svnPath);
  const folder = mostSpecificWorkspaceFolder(currentFolderRefs(), filePath);
  const scope = await createScopeFromExplorer(
    repositoryRoot,
    target,
    undefined,
    buildScopeProject(folder?.absolutePath, repositoryRoot),
  );
  if (!workbenchWindowManager) {
    return;
  }
  await workbenchWindowManager.open({
    moduleId: "diff",
    taskId: "diff/working",
    svnPath,
    scope,
    targetFile: filePath,
  });
}

async function openHistory(
  resource?: unknown,
  selectedResources?: unknown[],
): Promise<void> {
  const prepared = await prepareWorkbenchRequest(
    resourceUri(resource),
    resourceUris(selectedResources),
  );
  if (!prepared || !workbenchWindowManager) {
    return;
  }
  await workbenchWindowManager.open({
    moduleId: "history",
    taskId: "history/revisions",
    ...prepared,
  });
}

async function prepareWorkbenchRequest(
  uri?: vscode.Uri,
  selectedUris?: vscode.Uri[],
): Promise<
  | {
      svnPath: string;
      scope: Awaited<ReturnType<typeof createScopeFromExplorer>>;
    }
  | undefined
> {
  const svnPath = await getSvnPath();
  if (!svnPath) {
    return undefined;
  }
  const commandTarget = await resolveCommandTarget(uri);
  if (commandTarget.status !== "resolved") {
    return undefined;
  }
  const { target, projectRootCandidate, outsideWorkspace } = commandTarget;
  if (outsideWorkspace) {
    vscode.window.showInformationMessage(
      "当前目标不在工作区项目中，将按目标所在位置解析。",
    );
  }
  const scopedUris =
    selectedUris && selectedUris.length > 0 ? selectedUris : [target];
  /*
   * v0.0.7 §7.2：逐目标解析工作副本。非 SVN 路径排除并说明；同一工作
   * 副本内的明确跨项目多选允许形成一个 scope；跨工作副本/跨仓库的选择
   * 拆分为独立执行单元，由用户选择本次操作的范围，绝不合并为一次修订。
   */
  const perTarget = await Promise.all(
    scopedUris.map(async (current) => ({
      uri: current,
      root: await resolveWorkingCopyRoot(svnPath, current.fsPath),
    })),
  );
  const invalid = perTarget.filter((item) => !item.root);
  const valid = perTarget.filter(
    (item): item is { uri: vscode.Uri; root: string } =>
      item.root !== undefined,
  );
  if (invalid.length > 0) {
    vscode.window.showInformationMessage(
      `已排除 ${invalid.length} 个非 SVN 路径（不属于任何工作副本）：${invalid
        .map((item) => path.basename(item.uri.fsPath))
        .join("、")}。`,
    );
  }
  if (valid.length === 0) {
    vscode.window.showWarningMessage(
      "所选路径不属于 SVN 工作副本。请先检出（Checkout），或从有效工作副本内重新选择。",
    );
    return undefined;
  }
  const byRoot = new Map<string, { root: string; items: typeof valid }>();
  for (const item of valid) {
    const key = normalizePathKey(item.root);
    const group = byRoot.get(key) ?? { root: item.root, items: [] };
    group.items.push(item);
    byRoot.set(key, group);
  }
  let chosen = valid;
  if (byRoot.size > 1) {
    const folders = currentFolderRefs();
    const units = await Promise.all(
      [...byRoot.values()].map(async (group) => {
        const projects = folders.filter((folder) =>
          isSameOrDescendantPath(folder.absolutePath, group.root),
        );
        const repositoryUuid = await resolveRepositoryUuidFor(
          svnPath,
          group.root,
        );
        return { group, projects, repositoryUuid };
      }),
    );
    const sharedUuid =
      units.every(
        (unit) =>
          unit.repositoryUuid &&
          unit.repositoryUuid === units[0].repositoryUuid,
      ) && units[0].repositoryUuid;
    const picked = await vscode.window.showQuickPick(
      units.map((unit) => ({
        label:
          unit.projects.length > 0
            ? unit.projects.map((project) => project.name).join("、")
            : path.basename(unit.group.root),
        description: unit.group.root,
        detail: sharedUuid
          ? "同一仓库的不同工作副本：必须拆分为独立执行，不能合并为一次修订。"
          : `不同 SVN 仓库（UUID ${unit.repositoryUuid ?? "未知"}）：必须按仓库拆分执行。`,
        group: unit.group,
      })),
      {
        placeHolder:
          "所选内容跨多个工作副本/仓库，已拆分为独立执行单元，请选择本次操作的范围",
        canPickMany: false,
      },
    );
    if (!picked) return undefined;
    chosen = picked.group.items;
  }
  const repositoryRoot = chosen[0].root;
  const chosenUris = chosen.map((item) => item.uri);
  const scope = await createScopeFromExplorer(
    repositoryRoot,
    target,
    selectedUris && selectedUris.length > 0 ? chosenUris : undefined,
    buildScopeProject(projectRootCandidate, repositoryRoot),
  );
  // 明确跨项目多选：记录涉及的全部项目，用于文件徽标与预览分组。
  const projectRoots = new Map<string, OperationScopeProject>();
  for (const item of chosen) {
    const folder = mostSpecificWorkspaceFolder(
      currentFolderRefs(),
      item.uri.fsPath,
    );
    if (folder && isSameOrDescendantPath(folder.absolutePath, repositoryRoot)) {
      const project = finalizeScopeProject(folder.absolutePath, repositoryRoot);
      projectRoots.set(normalizePathKey(project.projectRoot), project);
    }
  }
  if (projectRoots.size > 1) {
    scope.projects = [...projectRoots.values()];
  }
  return { svnPath, scope };
}

async function openConflictCenter(
  resource?: unknown,
  selectedResources?: unknown[],
): Promise<void> {
  const prepared = await prepareWorkbenchRequest(
    resourceUri(resource),
    resourceUris(selectedResources),
  );
  if (!prepared || !workbenchWindowManager) {
    return;
  }
  await workbenchWindowManager.open({
    moduleId: "conflicts",
    taskId: "conflicts/resolve",
    ...prepared,
  });
}

async function aiTestConnection(): Promise<void> {
  const provider = await createConfiguredAiProvider("commitSelection");
  await provider.testConnection();
  vscode.window.showInformationMessage("AI 模型连接成功。");
}

async function aiConfigure(): Promise<void> {
  await openSupportModule("settings", "settings/ai");
}

async function openTeamConfig(resource?: unknown): Promise<void> {
  const commandTarget = await resolveCommandTarget(resourceUri(resource));
  if (commandTarget.status === "cancelled") {
    return;
  }
  const target =
    commandTarget.status === "resolved" ? commandTarget.target : undefined;
  if (!target) {
    return;
  }

  try {
    const repositoryRoot = await getRepositoryRootForTarget(
      target,
      (await getSvnPath()) ?? undefined,
    );
    // v0.0.7 §9：新建团队规则默认写入已确认项目根；项目根回退时仍是
    // 工作副本根，行为与既有版本一致。
    const project = finalizeScopeProject(
      commandTarget.status === "resolved"
        ? commandTarget.projectRootCandidate
        : undefined,
      repositoryRoot,
    );
    const configPath = await ensureSvnWorkbenchProjectConfig(
      repositoryRoot,
      project.projectRoot,
    );
    const document = await vscode.workspace.openTextDocument(
      vscode.Uri.file(configPath),
    );
    await vscode.window.showTextDocument(document);
  } catch (error) {
    appendOutput(
      `打开团队配置失败：${error instanceof Error ? error.message : String(error)}`,
    );
    vscode.window.showErrorMessage(
      "无法打开 SVN 团队配置，详细信息请查看“SVN 工作台”输出。",
    );
    showOutput();
  }
}

async function configureTeamConfig(resource?: unknown): Promise<void> {
  const commandTarget = await resolveCommandTarget(resourceUri(resource));
  if (commandTarget.status !== "resolved") {
    return;
  }
  const target = commandTarget.target;

  try {
    await openSupportModule("settings", "settings/team", target);
  } catch (error) {
    appendOutput(
      `配置团队规则失败：${error instanceof Error ? error.message : String(error)}`,
    );
    vscode.window.showErrorMessage(
      "无法打开 SVN 团队规则页面，详细信息请查看“SVN 工作台”输出。",
    );
    showOutput();
  }
}

async function openSupportModule(
  moduleId: "settings" | "diagnostics" | "projects",
  taskId: WorkbenchTaskId,
  uri?: vscode.Uri,
): Promise<void> {
  if (!workbenchWindowManager) {
    vscode.window.showErrorMessage("SVN 工作台尚未激活。");
    return;
  }
  const commandTarget = await resolveCommandTarget(uri, {
    silentUnavailable: true,
  });
  if (commandTarget.status === "cancelled") {
    return;
  }
  const target =
    commandTarget.status === "resolved"
      ? commandTarget.target
      : extensionContext?.extensionUri;
  if (!target) {
    vscode.window.showWarningMessage("无法确定工作台上下文。");
    return;
  }
  const executable = await resolveSvnExecutable();
  if (executable) {
    cachedSvnPath = executable.path;
  }
  const repositoryRoot = await getRepositoryRootForTarget(
    target,
    executable?.path,
  );
  const stat = await vscode.workspace.fs.stat(target);
  const absolutePath =
    stat.type === vscode.FileType.Directory
      ? target.fsPath
      : path.dirname(target.fsPath);
  const scope = {
    id: `${Date.now()}-support`,
    repositoryRoot,
    source: "commandPalette" as const,
    roots: [
      {
        absolutePath,
        relativePath: path.relative(repositoryRoot, absolutePath) || ".",
        kind: "folder" as const,
      },
    ],
    // v0.0.7：支持模块同样携带项目上下文，范围栏显示一致。
    project: buildScopeProject(
      commandTarget.status === "resolved"
        ? commandTarget.projectRootCandidate
        : undefined,
      repositoryRoot,
    ),
    allowExpandScope: false as const,
    includeExternals: false,
    includeNestedWorkingCopies: false,
    createdAt: Date.now(),
  };
  await workbenchWindowManager.open({
    moduleId,
    taskId,
    svnPath:
      executable?.path ??
      vscode.workspace
        .getConfiguration("svnWorkbench")
        .get<string>("svn.path") ??
      "svn",
    scope,
  });
}

async function aiSelectScope(resource?: unknown): Promise<void> {
  await openAiReview(resource);
}

async function openAiReview(
  resource?: unknown,
  selectedResources?: unknown[],
): Promise<void> {
  const prepared = await prepareWorkbenchRequest(
    resourceUri(resource),
    resourceUris(selectedResources),
  );
  if (!prepared || !workbenchWindowManager) return;
  await workbenchWindowManager.open({
    moduleId: "ai-review",
    taskId: "ai-review/review",
    ...prepared,
  });
}

async function openImpact(
  resource?: unknown,
  selectedResources?: unknown[],
): Promise<void> {
  const prepared = await prepareWorkbenchRequest(
    resourceUri(resource),
    resourceUris(selectedResources),
  );
  if (!prepared || !workbenchWindowManager) return;
  await workbenchWindowManager.open({
    moduleId: "impact",
    taskId: "impact/analyze",
    ...prepared,
  });
}

async function openChangelists(
  resource?: unknown,
  selectedResources?: unknown[],
): Promise<void> {
  const prepared = await prepareWorkbenchRequest(
    resourceUri(resource),
    resourceUris(selectedResources),
  );
  if (!prepared || !workbenchWindowManager) return;
  await workbenchWindowManager.open({
    moduleId: "changelists",
    taskId: "changelists/manage",
    ...prepared,
  });
}

async function openAgent(
  resource?: unknown,
  selectedResources?: unknown[],
): Promise<void> {
  const prepared = await prepareWorkbenchRequest(
    resourceUri(resource),
    resourceUris(selectedResources),
  );
  if (!prepared || !workbenchWindowManager) return;
  await workbenchWindowManager.open({
    moduleId: "agent",
    taskId: "agent/plan",
    ...prepared,
  });
}

/** 拆分执行单元时读取仓库 UUID 以区分同仓库与不同仓库；失败返回 undefined。 */
async function resolveRepositoryUuidFor(
  svnPath: string,
  workingCopyRoot: string,
): Promise<string | undefined> {
  try {
    const result = await runSvnCommand(
      svnPath,
      ["info", "--show-item", "repos-uuid", workingCopyRoot],
      workingCopyRoot,
    );
    const uuid = result.stdout.trim();
    if (result.exitCode === 0 && uuid) return uuid;
  } catch {
    // 无法识别时按未知仓库处理，拆分行为不变。
  }
  return undefined;
}

async function getSvnPath(): Promise<string> {
  if (cachedSvnPath) {
    return cachedSvnPath;
  }
  const executable = await resolveSvnExecutable();
  if (!executable) {
    const configured = vscode.workspace
      .getConfiguration("svnWorkbench")
      .get<string>("svn.path")
      ?.trim();
    vscode.window.showWarningMessage(
      "未找到 SVN CLI。工作台将打开错误与修复指引，请在设置或诊断中配置路径。",
    );
    return configured || "svn";
  }
  cachedSvnPath = executable.path;
  return cachedSvnPath;
}

async function createConfiguredAiProvider(
  scenario?: AiUsageScenario,
): Promise<OpenAiCompatibleProvider> {
  if (!extensionContext) {
    throw new Error("SVN 工作台尚未激活。");
  }

  return new OpenAiCompatibleProvider(
    await resolveAiProviderConfig(extensionContext, scenario),
  );
}

async function getRepositoryRootForTarget(
  target: vscode.Uri,
  svnPath?: string,
  allowFallback?: true,
): Promise<string>;
async function getRepositoryRootForTarget(
  target: vscode.Uri,
  svnPath: string,
  allowFallback: false,
): Promise<string | undefined>;
async function getRepositoryRootForTarget(
  target: vscode.Uri,
  svnPath?: string,
  allowFallback = true,
): Promise<string | undefined> {
  if (svnPath) {
    const root = await resolveWorkingCopyRoot(svnPath, target.fsPath);
    if (root) return root;
  }
  if (!allowFallback) return undefined;
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(target);
  if (workspaceFolder) {
    return workspaceFolder.uri.fsPath;
  }

  const stat = await vscode.workspace.fs.stat(target);
  return stat.type === vscode.FileType.Directory
    ? target.fsPath
    : path.dirname(target.fsPath);
}
