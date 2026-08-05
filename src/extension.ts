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
import { createScopeFromExplorer } from "./scope/operationScope";
import {
  resolveWorkingCopyRoot,
  resolveWorkingCopySet,
} from "./scope/workingCopyResolver";
import { resolveSvnExecutable } from "./svn/svnExecutableResolver";
import { WorkbenchController } from "./extension/workbench/WorkbenchController";
import { SvnSourceControlManager } from "./scm/svnSourceControlManager";
import type { WorkbenchTaskId } from "./protocol/workbenchProtocol";

let cachedSvnPath: string | undefined;
let extensionContext: vscode.ExtensionContext | undefined;
let workbenchController: WorkbenchController | undefined;
let sourceControlManager: SvnSourceControlManager | undefined;

export function activate(context: vscode.ExtensionContext): void {
  extensionContext = context;
  // 统一的提交选择规则解析服务：工作台与 SCM 共享，保证所有候选入口
  // 在同一仓库解析出相同有效规则；监听配置与仓库文件变化并失效缓存。
  const commitSelectionRuleService = new CommitSelectionRuleService();
  workbenchController = new WorkbenchController(
    context,
    commitSelectionRuleService,
  );
  sourceControlManager = new SvnSourceControlManager(
    getSvnPath,
    commitSelectionRuleService,
  );
  appendOutput("SVN 工作台已激活。");

  context.subscriptions.push(
    workbenchController,
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
  workbenchController = undefined;
  sourceControlManager = undefined;
}

async function openFileOperation(
  operation: "add" | "ignore" | "revert" | "lock" | "unlock",
  resource?: unknown,
): Promise<void> {
  const uri = resourceUri(resource);
  const prepared = await prepareWorkbenchRequest(uri);
  if (!prepared || !workbenchController) return;
  await workbenchController.open({
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

async function openWorkbench(
  resource?: unknown,
  selectedResources?: unknown[],
): Promise<void> {
  const prepared = await prepareWorkbenchRequest(
    resourceUri(resource),
    resourceUris(selectedResources),
  );
  if (!prepared || !workbenchController) {
    return;
  }
  await workbenchController.open({
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
  if (!prepared || !workbenchController) {
    return;
  }
  await workbenchController.open({
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
  if (!prepared || !workbenchController) {
    return;
  }
  await workbenchController.open({
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
  if (!prepared || !workbenchController) return;
  await workbenchController.open({
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
    if (!workbenchController) {
      throw new Error("SVN 工作台控制器不可用。");
    }
    await workbenchController.open({
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
  const scope = await createScopeFromExplorer(repositoryRoot, target);
  if (!workbenchController) {
    return;
  }
  await workbenchController.open({
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
  if (!prepared || !workbenchController) {
    return;
  }
  await workbenchController.open({
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
  const target =
    uri ??
    vscode.window.activeTextEditor?.document.uri ??
    vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!target) {
    vscode.window.showWarningMessage("请先打开工作区或选择 SVN 路径。");
    return undefined;
  }
  const scopedUris =
    selectedUris && selectedUris.length > 0 ? selectedUris : [target];
  const resolution = await resolveWorkingCopySet(
    svnPath,
    scopedUris.map((current) => current.fsPath),
  );
  if (resolution.invalidTargets.length > 0) {
    vscode.window.showWarningMessage(
      "所选路径不属于 SVN 工作副本。请先检出（Checkout），或从有效工作副本内重新选择。",
    );
    return undefined;
  }
  if (resolution.mixed || !resolution.root) {
    vscode.window.showWarningMessage(
      "检测到多个 SVN 工作副本或外部工作副本（external）。一次操作不能跨仓库，请按工作副本分别执行。",
    );
    return undefined;
  }
  const repositoryRoot = resolution.root;
  const scope = await createScopeFromExplorer(
    repositoryRoot,
    target,
    selectedUris,
  );
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
  if (!prepared || !workbenchController) {
    return;
  }
  await workbenchController.open({
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
  const target =
    resourceUri(resource) ?? vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!target) {
    vscode.window.showWarningMessage("请先打开工作区或选择 SVN 路径。");
    return;
  }

  try {
    const repositoryRoot = await getRepositoryRootForTarget(
      target,
      (await getSvnPath()) ?? undefined,
    );
    const configPath = await ensureSvnWorkbenchProjectConfig(repositoryRoot);
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
  const target =
    resourceUri(resource) ?? vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!target) {
    vscode.window.showWarningMessage("请先打开工作区或选择 SVN 路径。");
    return;
  }

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
  moduleId: "settings" | "diagnostics",
  taskId: WorkbenchTaskId,
  uri?: vscode.Uri,
): Promise<void> {
  if (!workbenchController) {
    vscode.window.showErrorMessage("SVN 工作台尚未激活。");
    return;
  }
  const target =
    uri ??
    vscode.window.activeTextEditor?.document.uri ??
    vscode.workspace.workspaceFolders?.[0]?.uri ??
    extensionContext?.extensionUri;
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
    allowExpandScope: false as const,
    includeExternals: false,
    includeNestedWorkingCopies: false,
    createdAt: Date.now(),
  };
  await workbenchController.open({
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
  if (!prepared || !workbenchController) return;
  await workbenchController.open({
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
  if (!prepared || !workbenchController) return;
  await workbenchController.open({
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
  if (!prepared || !workbenchController) return;
  await workbenchController.open({
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
  if (!prepared || !workbenchController) return;
  await workbenchController.open({
    moduleId: "agent",
    taskId: "agent/plan",
    ...prepared,
  });
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
