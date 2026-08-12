import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import * as vscode from "vscode";
import {
  buildCommitMessageAiRequest,
  createMockCommitMessageResult,
} from "../../ai/commitMessageAiGenerator";
import {
  buildCommitSelectionAiRequest,
  createLocalCommitSelectionResult,
} from "../../ai/commitSelectionAi";
import {
  enforceAiSelectionLocalBoundary,
  validateAiSelectionResult,
} from "../../ai/aiResultValidator";
import {
  buildLocalChangeReview,
  buildLocalImpactAnalysis,
} from "../../ai/changeIntelligence";
import {
  buildConflictAiRequest,
  containsSvnConflictMarkers,
  createMockConflictAdvice,
} from "../../ai/conflictAiAdvisor";
import {
  AI_API_KEY_SECRET_KEY,
  AI_PROVIDER_PRESETS,
  AI_USAGE_SCENARIOS,
  normalizeAiBaseUrl,
  readStoredAiConfiguration,
  saveAiConfiguration,
  validateAiProviderConfig,
  type AiUsageScenario,
} from "../../ai/aiModelConfiguration";
import { OpenAiCompatibleProvider } from "../../ai/openAiCompatibleProvider";
import {
  buildTeamRulesAiRequest,
  createLocalTeamRulesRecommendation,
} from "../../ai/teamRulesAiRecommender";
import {
  appendTeamMemory,
  clearTeamMemory,
  readTeamMemory,
} from "../../ai/teamMemory";
import {
  buildCommitSplitAiRequest,
  createLocalCommitSplitResult,
  validateCommitSplitResult,
} from "../../ai/commitSplitAi";
import {
  applySvnChangelist,
  collectSvnChangelists,
} from "../../changelist/svnChangelists";
import {
  collectCommitCandidates,
  summarizeCommitCandidates,
} from "../../commit/commitCandidateCollector";
import type { CommitCandidate } from "../../commit/commitCandidateCollector";
import {
  CommitSelectionRuleService,
  type CommitSelectionRulesInvalidationEvent,
} from "../../commit/commitSelectionRuleService";
import {
  buildCommitSelectionSettingsSection,
  validateCommitSelectionSaveInput,
} from "../../commit/commitSelectionSettingsSupport";
import { collectCommitDiffSummaries } from "../../commit/commitDiffSummary";
import {
  formatCommitConventionList,
  readCommitConventionEditState,
  resolveCommitConventionConfig,
  saveProjectCommitConventionConfig,
  ensureSvnWorkbenchProjectConfig,
  toAiCommitConventionHint,
  validateCommitConventionConfig,
  validateCommitMessageConvention,
} from "../../commit/commitConvention";
import { runCommitFlow } from "../../commit/commitFlow";
import { SVN_WORKBENCH_CONFIG_FILE } from "../../config/svnWorkbenchConfig";
import {
  buildCommitPlanPreview,
  toCommitFlowPlan,
} from "../../commit/commitPlanBuilder";
import {
  applyCommitMessageTemplate,
  defaultCommitMessageTemplates,
  validateCommitMessage,
} from "../../commit/commitMessageTemplates";
import { checkPreCommitRemoteUpdates } from "../../commit/preCommitRemoteCheck";
import {
  acceptanceChecklistSections,
  formatAcceptanceChecklistMarkdown,
  summarizeAcceptanceChecklist,
} from "../../diagnostics/acceptanceChecklist";
import {
  buildEnvironmentDiagnosticReport,
  formatEnvironmentDiagnosticReport,
} from "../../diagnostics/environmentDiagnostics";
import {
  appendOutput,
  sanitizeDiagnostic,
  showOutput,
} from "../../diagnostics/outputChannel";
import { collectSvnHistory } from "../../history/svnHistory";
import { collectConflictItems } from "../../conflict/conflictCollector";
import {
  buildResolveConflictPreview,
  resolveConflictUsingWorking,
} from "../../conflict/conflictResolver";
import {
  WORKBENCH_PROTOCOL_VERSION,
  defaultWorkbenchTask,
  isWebviewToHostMessage,
  isWorkbenchModuleId,
  isWorkbenchTaskForModule,
  type DiffSnapshot,
  type CommitPlanView,
  type CommitSnapshot,
  type DiagnosticsSnapshot,
  type HostToWebviewMessage,
  type SettingsSnapshot,
  type WebviewToHostMessage,
  type WorkbenchModuleId,
  type WorkbenchModuleSnapshot,
} from "../../protocol/workbenchProtocol";
import { validatePathsInScope } from "../../scope/pathBoundaryGuard";
import {
  deleteStoredSvnCredential,
  readStoredSvnCredential,
  storeSvnCredential,
} from "../../security/svnCredentialStore";
import {
  clearSvnSecurityContext,
  resolveSvnSecurityContext,
  setSvnSecurityContext,
} from "../../security/svnSecurityContext";
import {
  collectSvnProperties,
  validatePropertyEdit,
} from "../../properties/svnProperties";
import { runSvnCommand } from "../../svn/svnCommandRunner";
import {
  classifySvnFailure,
  extractSvnCertificateDetails,
} from "../../svn/svnErrorClassifier";
import { resolveSvnExecutable } from "../../svn/svnExecutableResolver";
import { runUpdateScope } from "../../update/updateFlow";
import { readWebviewAssets } from "./WebviewAssetManifest";
import {
  renderWebviewBuildError,
  renderWebviewShell,
} from "./renderWebviewShell";
import type {
  CommitSessionState,
  OpenWorkbenchRequest,
  WorkbenchSession,
} from "./workbenchSession";
import {
  applyIgnoreOperation,
  asFileOperation,
  buildFileOperationArgs,
  buildWorkbenchFileViews,
  fileOperationConsequences,
  fileOperationRecoverability,
  fileOperationSuccess,
  formatFileOperationCommand,
  validateFileOperation,
} from "./workbenchFileOperations";
import {
  aiConventionToTeamConfig,
  asNumber,
  asRevision,
  asRevisionArray,
  asString,
  asStringAllowEmpty,
  asStringArray,
  buildScenarioModelMap,
  emptyAgentSnapshot,
  errorMessage,
  getModuleTitle,
  inferLanguage,
  normalizeRelative,
  quoteRelative,
  toAiConfigurationInput,
  toScopeView,
  toTeamConfig,
} from "./workbenchPresentation";
import {
  buildRelativeCommitCommands,
  containsNull,
  getSingleFileScopeRoot,
  getSingleFolderScopeTarget,
  getSingleScopeTarget,
  hashCandidateState,
  hashFileContents,
  hashFileContentsOrMissing,
  hashOperationScope,
  hashProperties,
  MAX_DIFF_BYTES,
  parseBlameOutput,
  readFileForDiff,
  resolveRepositoryUuid,
  toConflictContentView,
  truncateUtf8,
} from "./workbenchSupport";
import {
  RepositoryWorkbenchActions,
  type RepositoryWorkbenchHost,
} from "./repositoryWorkbenchActions";
import { applyCommitSelectionRulesInvalidation } from "./commitSelectionInvalidation";
import {
  assertServedModuleRequest,
  buildCrossModuleWindowRequest,
  buildDiffWindowRequest,
  buildDiffTargetKey,
  normalizeDiffOpenMode,
  orderRevisionPair,
  shouldOpenInOtherWindow,
  workbenchRevealTarget,
} from "./workbenchRouting";
import { NativeDiffContentProvider } from "./nativeDiffContentProvider";
import { resolveDiffSwitchDecision } from "./diffTargetSwitch";
import { shouldConfirmTargetSwitch } from "./diffTargetSwitch";
import { createSvnBindingProbe } from "./diffSvnBinding";
import { createDiffEditingService, watchDiffEditTargets } from "./diffEditHost";
import { DiffEditingService } from "../../diffEdit/diffEditingService";
import { buildDiffTargetId } from "../../diffEdit/diffEditingService";
import { analyzeUtf8, MAX_EDITABLE_BYTES } from "../../diffEdit/diffPathGuard";
import { SvnSecurityContextRegistry } from "../../security/svnSecurityContextRegistry";
import { normalizeSvnRepositoryRoot } from "../../security/svnSecurityContext";

/**
 * 统一模块窗口路由回调：
 * - `servedModule`：该控制器服务的工作台模块；收到其他模块的打开或动作请求时
 *   经窗口管理器路由到目标模块窗口（跨模块），未注入时保持面板内切换的旧行为。
 * - `onOpenInOtherWindow`：窗口管理器注入的跨模块路由回调。
 * - `securityRegistry`：窗口管理器共享的 SVN 安全上下文注册表；
 *   缺省时回退到模块级直连行为（单测与未接线环境兼容）。
 */
export interface WorkbenchControllerRoutingOptions {
  servedModule?: WorkbenchModuleId;
  onOpenInOtherWindow?: (request: OpenWorkbenchRequest) => void | Promise<void>;
  securityRegistry?: SvnSecurityContextRegistry;
}

export class WorkbenchController implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private session: WorkbenchSession | undefined;
  private ready = false;
  private disposed = false;
  private readonly latestModuleRequests = new Map<WorkbenchModuleId, string>();
  private readonly repositoryActions: RepositoryWorkbenchActions;
  private readonly commitSelectionRuleService: CommitSelectionRuleService;
  private readonly ruleInvalidationSubscription: vscode.Disposable;
  /** 该控制器服务的工作台模块；其他模块请求经窗口管理器跨模块路由。 */
  private readonly servedModule: WorkbenchModuleId;
  private readonly onOpenInOtherWindow?: (
    request: OpenWorkbenchRequest,
  ) => void | Promise<void>;
  private readonly securityRegistry?: SvnSecurityContextRegistry;
  /** 本控制器当前持有的仓库安全引用（归一化键）；一控制器最多持有一个。 */
  private securityReferenceRoot: string | undefined;
  /** v0.0.6 页内编辑服务（仅 Diff 窗口创建）。 */
  private readonly diffEdit?: DiffEditingService;
  /** 当前 Diff 会话目标摘要；同目标重复打开只 reveal，不重新初始化。 */
  private diffTargetKey: string | undefined;
  /** 等待“脏草稿三选一”决定的新目标请求与当前目标（仅 Diff 窗口）。 */
  private pendingDiffOpen:
    { request: OpenWorkbenchRequest; currentTargetId: string } | undefined;
  private pendingDiffOpenTimer: ReturnType<typeof setTimeout> | undefined;
  /** 三选一决定后的递归 reopen 跳过草稿守卫。 */
  private diffSwitchBypass = false;
  private readonly nativeDiffContentProvider?: NativeDiffContentProvider;
  /**
   * 设置页保存/恢复动作触发的规则失效由动作处理器自行发送带反馈的快照；
   * 此标志抑制失效监听的重复模块刷新（仍保留提交预览/AI 结果清除）。
   */
  private suppressSelectionInvalidationReload = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    commitSelectionRuleService?: CommitSelectionRuleService,
    routingOptions?: WorkbenchControllerRoutingOptions,
  ) {
    this.repositoryActions = new RepositoryWorkbenchActions(
      this as unknown as RepositoryWorkbenchHost,
    );
    this.commitSelectionRuleService =
      commitSelectionRuleService ?? new CommitSelectionRuleService();
    this.ruleInvalidationSubscription =
      this.commitSelectionRuleService.onDidInvalidate((event) =>
        this.handleCommitSelectionRulesInvalidated(event),
      );
    this.servedModule = routingOptions?.servedModule ?? "changes";
    this.onOpenInOtherWindow = routingOptions?.onOpenInOtherWindow;
    this.securityRegistry = routingOptions?.securityRegistry;
    if (this.isDiffWindow()) {
      this.nativeDiffContentProvider = new NativeDiffContentProvider();
      this.context.subscriptions.push(
        this.nativeDiffContentProvider,
        vscode.workspace.registerTextDocumentContentProvider(
          "svn-workbench-base",
          this.nativeDiffContentProvider,
        ),
      );
      this.diffEdit = createDiffEditingService();
      this.context.subscriptions.push(watchDiffEditTargets(this.diffEdit));
    }
  }

  /** 当前控制器是否服务独立 Diff 模块窗口（保留 sameGroup/beside 行为）。 */
  private isDiffWindow(): boolean {
    return this.servedModule === "diff";
  }

  /** 管理器据此判断是否需要重建窗口。 */
  get isDisposed(): boolean {
    return this.disposed;
  }

  async open(request: OpenWorkbenchRequest): Promise<void> {
    if (this.disposed) {
      throw new Error("SVN 工作台控制器已释放。");
    }
    // 该控制器只服务自己的模块；其他模块请求经窗口管理器路由（跨模块）。
    if (request.moduleId !== this.servedModule) {
      if (this.onOpenInOtherWindow) {
        await this.onOpenInOtherWindow(request);
        return;
      }
      assertServedModuleRequest(request, this.servedModule);
    }
    if (this.session?.activeOperation) {
      this.revealPanel();
      await vscode.window.showWarningMessage(
        "SVN 工作台正在执行可取消操作。请先等待完成或在进度条中取消，再切换仓库与范围。",
      );
      return;
    }

    const taskId = request.taskId ?? defaultWorkbenchTask(request.moduleId);
    if (!isWorkbenchTaskForModule(taskId, request.moduleId)) {
      throw new Error("请求的工作台子任务与功能模块不匹配。");
    }
    const nextDiffTargetKey = this.isDiffWindow()
      ? buildDiffTargetKey({ ...request, taskId })
      : undefined;
    if (
      nextDiffTargetKey &&
      this.panel &&
      this.session &&
      this.diffTargetKey === nextDiffTargetKey
    ) {
      this.revealPanel();
      return;
    }

    /*
     * v0.0.6 写入安全契约 §6：单例窗口加载新目标前，当前目标存在草稿时必须
     * 由用户三选一（保存并打开 / 暂存并打开 / 留在当前文件）。这里只负责
     * 拦截与挂起请求，选择 UI 在 Webview（Svelte Dialog），决定经
     * diff/target-switch-decision 回传；超时按“暂存并打开”安全处理（草稿
     * 保留在 Host 内存）。
     */
    if (
      !this.diffSwitchBypass &&
      this.isDiffWindow() &&
      this.diffEdit &&
      this.panel &&
      this.session?.targetFile &&
      nextDiffTargetKey !== undefined &&
      nextDiffTargetKey !== this.diffTargetKey
    ) {
      const currentTargetId = buildDiffTargetId(
        path.resolve(this.session.targetFile),
      );
      if (
        shouldConfirmTargetSwitch({
          hasDraft: this.diffEdit.getDraft(currentTargetId) !== undefined,
          draftDirty: this.diffEdit.isDraftDirty(currentTargetId),
          hasActiveSession: this.diffEdit.hasActiveSession(
            currentTargetId,
            this.session.sessionId,
          ),
        })
      ) {
        this.clearPendingDiffOpen();
        this.pendingDiffOpen = { request, currentTargetId };
        this.pendingDiffOpenTimer = setTimeout(() => {
          void this.resolveDiffTargetSwitch("stash", undefined, this.session);
        }, 30_000);
        this.revealPanel();
        await this.post({
          protocolVersion: WORKBENCH_PROTOCOL_VERSION,
          type: "diff/target-switch-confirm",
          moduleId: "diff",
          payload: {
            currentTargetId,
            nextRelativePath: request.targetFile
              ? path.relative(
                  request.scope.repositoryRoot,
                  path.resolve(request.targetFile),
                ) || path.basename(request.targetFile)
              : "新目标",
          },
        });
        return;
      }
    }

    this.latestModuleRequests.clear();
    if (this.session) {
      this.nativeDiffContentProvider?.releaseSession(this.session.sessionId);
    }
    const storedAi = await readStoredAiConfiguration(this.context);
    const repositoryUuid = await resolveRepositoryUuid(
      request.svnPath,
      request.scope,
    );
    const storedAuthentication = await readStoredSvnCredential(
      this.context.secrets,
      repositoryUuid,
    );
    this.session = {
      ...request,
      sessionId: randomUUID(),
      taskId,
      scopeView: toScopeView(request.scope),
      repositoryUuid,
      scopeHash: hashOperationScope(request.scope),
      aiModels: buildScenarioModelMap(storedAi),
      security: {
        authentication: storedAuthentication,
        hasStoredAuthentication: Boolean(storedAuthentication),
      },
    };
    // 一控制器最多持有一个仓库安全引用：首次会话 acquire；同仓库重开保持
    // 既有引用（不重复 acquire）；换仓库时先 release 旧引用再 acquire 新引用。
    this.syncSecurityReference(this.session.scope.repositoryRoot);
    this.diffTargetKey = nextDiffTargetKey;
    this.syncSvnSecurityContext(this.session);
    const panel = await this.ensurePanel();
    panel.title = getModuleTitle(request.moduleId, taskId);
    this.revealPanel();

    if (this.ready) {
      await this.sendInitialize();
      await this.loadInitialModule(this.session);
    }
  }

  /**
   * 打开会话后的首次模块加载：修订比较会话直接渲染 rA → rB patch 快照，
   * 其余会话按模块加载并执行可能的初始文件操作。
   */
  private async loadInitialModule(session: WorkbenchSession): Promise<void> {
    if (session.revisionCompare) {
      await this.runRevisionCompare(
        session,
        session.revisionCompare.revisions,
        session.moduleId,
      );
      return;
    }
    await this.loadModule(session.moduleId, session.targetFile);
    await this.prepareInitialFileOperation(session);
  }

  /** 面板 reveal：显式打开会激活目标标签；Diff 打开组由配置决定。 */
  private revealPanel(): void {
    if (!this.panel) {
      return;
    }
    const target = this.revealTarget();
    const viewColumn =
      target.viewColumn === "beside"
        ? vscode.ViewColumn.Beside
        : target.viewColumn === "active"
          ? vscode.ViewColumn.Active
          : vscode.ViewColumn.One;
    this.panel.reveal(viewColumn, target.preserveFocus);
  }

  private revealTarget() {
    const openMode = normalizeDiffOpenMode(
      vscode.workspace
        .getConfiguration("svnWorkbench")
        .get<unknown>("diff.openMode"),
    );
    return workbenchRevealTarget(this.isDiffWindow(), openMode);
  }

  async openNativeDiffInEditor(requestId?: string): Promise<void> {
    const session = this.session;
    if (!session) {
      throw new Error(
        "没有可用的 SVN Diff 会话，请先打开 Working Copy ↔ BASE。",
      );
    }
    await this.openNativeDiff(session, requestId);
  }

  dispose(): void {
    this.disposed = true;
    this.ruleInvalidationSubscription.dispose();
    this.session?.activeOperation?.controller.abort();
    const session = this.session;
    const referenceRoot = this.securityReferenceRoot;
    // 先摘除会话与引用跟踪，再释放安全引用，避免 panel.dispose() 触发的
    // onDidDispose 对同一仓库重复释放（引用计数下溢或重复广播）。
    this.session = undefined;
    this.diffTargetKey = undefined;
    this.clearPendingDiffOpen();
    this.securityReferenceRoot = undefined;
    if (session) {
      this.nativeDiffContentProvider?.releaseSession(session.sessionId);
      this.diffEdit?.revokeForSession(session.sessionId);
    }
    if (referenceRoot) {
      this.releaseSecurityContext(referenceRoot);
    }
    this.panel?.dispose();
    this.panel = undefined;
  }

  /**
   * 安全上下文失效广播（窗口管理器共享注册表触发）：
   * 仅处理当前会话所在仓库，重新读取 SecretStorage 并更新会话安全状态；
   * 设置页同步刷新展示，不重载其他模块以保留未提交输入。
   */
  handleSecurityInvalidated(repositoryRoot: string): void {
    const session = this.session;
    if (
      !session ||
      this.disposed ||
      normalizeSvnRepositoryRoot(session.scope.repositoryRoot) !==
        repositoryRoot
    ) {
      return;
    }
    void this.refreshSessionSecurity(session);
  }

  private async refreshSessionSecurity(
    session: WorkbenchSession,
  ): Promise<void> {
    const stored = await readStoredSvnCredential(
      this.context.secrets,
      session.repositoryUuid,
    );
    // 写回前确认控制器未释放、面板仍有效、会话仍是当前会话；读取期间若
    // 关窗、重建或切换仓库，陈旧会话不得回写已清除/已切换的上下文。
    if (this.disposed || this.panel === undefined || this.session !== session) {
      return;
    }
    session.security.authentication = stored;
    session.security.hasStoredAuthentication = Boolean(stored);
    this.syncSvnSecurityContext(session);
    if (this.session === session && session.moduleId === "settings") {
      await this.sendSettingsSnapshot(session);
    }
  }

  /**
   * 同步本控制器的安全仓库引用：仅当 normalized 仓库变化时才释放旧引用并
   * 登记新引用；同仓库重开保持既有引用，不重复 acquire。
   */
  private syncSecurityReference(nextRoot: string): void {
    const next = normalizeSvnRepositoryRoot(nextRoot);
    if (this.securityReferenceRoot === next) {
      return;
    }
    if (this.securityReferenceRoot) {
      this.releaseSecurityContext(this.securityReferenceRoot);
    }
    this.acquireSecurityContext(nextRoot);
    this.securityReferenceRoot = next;
  }

  /** 会话替换/面板关闭时释放该仓库的安全上下文引用（最后一个引用消失才清除）。 */
  private releaseSecurityContext(repositoryRoot: string): void {
    if (this.securityRegistry) {
      this.securityRegistry.release(repositoryRoot);
    } else {
      clearSvnSecurityContext(repositoryRoot);
    }
  }

  /** 新会话登记对该仓库安全上下文的引用。 */
  private acquireSecurityContext(repositoryRoot: string): void {
    this.securityRegistry?.acquire(repositoryRoot);
  }

  /**
   * 统一候选采集入口：经规则服务解析当前仓库的有效规则后再采集，
   * 保证提交页、SCM、Changelist、仓库动作与执行前复验得到一致分类（规划 7.3）。
   */
  private async collectScopeCandidates(
    session: WorkbenchSession,
  ): Promise<CommitCandidate[]> {
    const rules = await this.commitSelectionRuleService.getEffectiveRules(
      session.scope.repositoryRoot,
    );
    return collectCommitCandidates(session.svnPath, session.scope, { rules });
  }

  /**
   * 规则来源变化后的失效链路：清除旧提交预览与 AI 选择结果缓存，
   * 保留用户已手动确认的提交篮选择，并基于新规则重建当前模块快照。
   */
  private handleCommitSelectionRulesInvalidated(
    event: CommitSelectionRulesInvalidationEvent,
  ): void {
    const session = this.session;
    if (!session || this.disposed) {
      return;
    }
    if (!applyCommitSelectionRulesInvalidation(session, event.repositoryRoot)) {
      return;
    }
    if (this.suppressSelectionInvalidationReload) {
      return;
    }
    void this.loadModule(session.moduleId, session.targetFile);
  }

  private async ensurePanel(): Promise<vscode.WebviewPanel> {
    if (this.panel) {
      return this.panel;
    }

    const localResourceRoot = vscode.Uri.joinPath(
      this.context.extensionUri,
      "dist",
      "webview",
    );
    const revealTarget = this.revealTarget();
    const panel = vscode.window.createWebviewPanel(
      "svnWorkbench.unified",
      "SVN 工作台",
      revealTarget.viewColumn === "beside"
        ? vscode.ViewColumn.Beside
        : revealTarget.viewColumn === "active"
          ? vscode.ViewColumn.Active
          : vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: this.isDiffWindow(),
        localResourceRoots: [localResourceRoot],
      },
    );
    this.panel = panel;
    this.ready = false;

    panel.onDidDispose(
      () => {
        const session = this.session;
        const referenceRoot = this.securityReferenceRoot;
        // 先摘除会话与引用跟踪，再释放安全引用：release 在最后引用时会同步
        // 广播失效事件，此时本控制器已无活动会话，不会把刚清除的上下文写回。
        this.session = undefined;
        this.diffTargetKey = undefined;
        this.clearPendingDiffOpen();
        this.securityReferenceRoot = undefined;
        this.panel = undefined;
        this.ready = false;
        if (session) {
          this.nativeDiffContentProvider?.releaseSession(session.sessionId);
          this.diffEdit?.revokeForSession(session.sessionId);
        }
        if (referenceRoot) {
          this.releaseSecurityContext(referenceRoot);
        }
      },
      undefined,
      this.context.subscriptions,
    );
    panel.webview.onDidReceiveMessage(
      (message: unknown) => {
        void this.handleMessage(message);
      },
      undefined,
      this.context.subscriptions,
    );

    try {
      const assets = await readWebviewAssets(this.context, panel.webview);
      panel.webview.html = renderWebviewShell(panel.webview, assets);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendOutput(`加载 Svelte 工作台失败：${message}`);
      panel.webview.html = renderWebviewBuildError(message);
    }

    return panel;
  }

  private async handleMessage(value: unknown): Promise<void> {
    if (!isWebviewToHostMessage(value)) {
      appendOutput("已拒绝格式无效的 SVN 工作台 Webview 消息。");
      return;
    }

    if (value.type === "webview/ready") {
      this.ready = true;
      await this.sendInitialize();
      if (this.session) {
        await this.loadInitialModule(this.session);
      }
      return;
    }

    await this.handleAction(value);
  }

  private async handleAction(
    message: Extract<WebviewToHostMessage, { type: "workbench/action" }>,
  ): Promise<void> {
    const session = this.session;
    if (!session) {
      return;
    }
    if (
      message.sessionId !== session.sessionId ||
      message.repositoryUuid !== session.repositoryUuid ||
      message.scopeHash !== session.scopeHash ||
      message.taskId !== session.taskId
    ) {
      appendOutput("已拒绝会话、仓库或范围标识过期的 SVN 工作台消息。");
      await this.sendError(
        session.moduleId,
        "操作上下文已过期",
        "会话、仓库或右键范围已变化，请重新打开当前功能模块。",
        false,
        message.requestId,
      );
      return;
    }
    const data = message.payload.data ?? {};

    switch (message.payload.action) {
      case "refresh":
        await this.loadModule(
          session.moduleId,
          session.targetFile,
          message.requestId,
        );
        return;
      case "open-module": {
        const moduleId = data.moduleId;
        if (!isWorkbenchModuleId(moduleId)) {
          await this.sendError(
            session.moduleId,
            "无法打开模块",
            "请求的工作台模块不存在。",
            false,
            message.requestId,
          );
          return;
        }
        const taskId = data.taskId ?? defaultWorkbenchTask(moduleId);
        if (!isWorkbenchTaskForModule(taskId, moduleId)) {
          await this.sendError(
            session.moduleId,
            "无法打开任务",
            "请求的子任务不属于当前功能模块。",
            false,
            message.requestId,
          );
          return;
        }
        // 同模块任务导航留在当前窗口；跨模块由窗口管理器路由到目标模块窗口。
        if (
          shouldOpenInOtherWindow(
            moduleId,
            this.servedModule,
            this.onOpenInOtherWindow,
          )
        ) {
          await this.onOpenInOtherWindow!(
            buildCrossModuleWindowRequest({
              moduleId,
              taskId,
              svnPath: session.svnPath,
              scope: session.scope,
              selectedPaths: asStringArray(data.selectedPaths),
            }),
          );
          return;
        }
        if (moduleId !== this.servedModule) {
          await this.sendError(
            session.moduleId,
            "无法打开模块",
            `SVN 工作台 ${this.servedModule} 模块窗口仅处理 ${this.servedModule} 模块会话，请从对应模块入口打开其他模块。`,
            false,
            message.requestId,
          );
          return;
        }
        session.moduleId = moduleId;
        session.taskId = taskId;
        session.selectedPaths = asStringArray(data.selectedPaths);
        session.targetFile = undefined;
        this.panel!.title = getModuleTitle(moduleId, taskId);
        await this.loadModule(moduleId, undefined, message.requestId);
        return;
      }
      case "open-diff": {
        const relativePath = asString(data.relativePath);
        if (!relativePath) {
          await this.sendError(
            session.moduleId,
            "无法打开差异",
            "没有收到文件路径。",
            true,
            message.requestId,
          );
          return;
        }
        const absolutePath = path.resolve(
          session.scope.repositoryRoot,
          relativePath,
        );
        const validation = validatePathsInScope(session.scope, [absolutePath]);
        if (validation.outOfScopeItems.length > 0) {
          await this.sendError(
            session.moduleId,
            "范围校验失败",
            "该文件不在当前右键操作范围内。",
            false,
            message.requestId,
          );
          return;
        }
        // 非 Diff 窗口统一路由到独立 Diff 窗口；Diff 窗口内保持当前会话（目标变化）。
        if (this.servedModule !== "diff") {
          if (this.onOpenInOtherWindow) {
            await this.onOpenInOtherWindow(
              buildDiffWindowRequest({
                svnPath: session.svnPath,
                scope: session.scope,
                targetFile: absolutePath,
              }),
            );
            return;
          }
          // 未接线（单测/防御）：面板内切换。
        }
        session.moduleId = "diff";
        session.taskId = defaultWorkbenchTask("diff");
        session.targetFile = absolutePath;
        this.panel!.title = getModuleTitle("diff", session.taskId);
        await this.loadModule("diff", absolutePath, message.requestId);
        return;
      }
      case "open-file": {
        const relativePath = asString(data.relativePath);
        if (!relativePath) {
          return;
        }
        const absolutePath = path.resolve(
          session.scope.repositoryRoot,
          relativePath,
        );
        if (
          validatePathsInScope(session.scope, [absolutePath]).outOfScopeItems
            .length > 0
        ) {
          await this.sendError(
            session.moduleId,
            "范围校验失败",
            "无法打开范围外文件。",
            false,
            message.requestId,
          );
          return;
        }
        const document = await vscode.workspace.openTextDocument(
          vscode.Uri.file(absolutePath),
        );
        await vscode.window.showTextDocument(document, { preview: true });
        return;
      }
      case "diff/open-in-editor":
        await this.openNativeDiffInEditor(message.requestId);
        return;
      case "diff/open-edit":
        await this.openDiffEdit(session, message.requestId);
        return;
      case "diff/save-working":
        await this.saveWorkingDiff(session, message.requestId, data);
        return;
      case "diff/draft-checkpoint":
        await this.checkpointDiffDraft(session, message.requestId, data);
        return;
      case "diff/draft-abandon":
        await this.abandonDiffDraft(session, message.requestId, data);
        return;
      case "diff/draft-export":
        await this.exportDiffDraft(session, message.requestId, data);
        return;
      case "diff/target-switch-decision":
        await this.resolveDiffTargetSwitch(
          asString(data.decision),
          asString(data.targetId),
          session,
        );
        return;
      case "copy-text": {
        const text = asString(data.text);
        if (text) {
          await vscode.env.clipboard.writeText(text);
        }
        return;
      }
      case "security/configure-authentication":
        await this.configureAuthentication(session, message.requestId);
        return;
      case "security/clear-authentication":
        await this.clearAuthentication(session, message.requestId);
        return;
      case "security/review-certificate":
        await this.reviewCertificate(session, message.requestId);
        return;
      case "security/open-proxy-settings":
        await vscode.commands.executeCommand(
          "workbench.action.openSettings",
          "@id:http.proxy",
        );
        return;
      case "operation/cancel": {
        const active = session.activeOperation;
        if (active) {
          active.controller.abort();
          await this.post({
            protocolVersion: WORKBENCH_PROTOCOL_VERSION,
            type: "operation/cancelled",
            requestId: message.requestId,
            moduleId: active.moduleId,
            payload: {
              title: "正在取消操作",
              message: "已向 SVN 进程发送终止请求；完成后将重新采集状态。",
            },
          });
        }
        return;
      }
      case "commit/update-draft": {
        const state = this.ensureCommitState(session);
        state.message = asStringAllowEmpty(data.message) ?? state.message;
        state.preview = undefined;
        await this.sendCommitSnapshot(session, message.requestId);
        return;
      }
      case "commit/update-selection": {
        const selectedPaths = asStringArray(data.selectedPaths) ?? [];
        const absolutePaths = selectedPaths.map((item) =>
          path.resolve(session.scope.repositoryRoot, item),
        );
        const validation = validatePathsInScope(session.scope, absolutePaths);
        if (validation.outOfScopeItems.length > 0) {
          await this.sendError(
            "commit",
            "范围校验失败",
            "提交选择包含当前右键范围之外的文件。",
            false,
            message.requestId,
          );
          return;
        }
        const state = this.ensureCommitState(session);
        state.selectedPaths = selectedPaths;
        state.preview = undefined;
        await this.sendCommitSnapshot(session, message.requestId);
        return;
      }
      case "commit/apply-local-rules": {
        // 始终经统一入口重新采集并评估，不复用陈旧候选（规划 4.2）；
        // 用户显式触发，应用推荐选择属于预期覆盖。
        const candidates = await this.collectScopeCandidates(session);
        const state = this.ensureCommitState(session);
        const recommended = candidates
          .filter((candidate) => candidate.selection === "selected")
          .map((candidate) => candidate.relativePath);
        const needsReview = candidates.filter(
          (candidate) => candidate.selection === "needsReview",
        ).length;
        state.selectedPaths = recommended;
        state.preview = undefined;
        state.feedback = {
          tone: "success",
          message: `已按本地规则应用推荐选择 ${recommended.length} 个文件；${needsReview} 个文件待确认，可手动勾选。`,
        };
        await this.sendCommitSnapshot(session, message.requestId, candidates);
        return;
      }
      case "commit/ai-select": {
        const candidates = await this.collectScopeCandidates(session);
        const allowedPaths = candidates.map((item) => item.absolutePath);
        const request = buildCommitSelectionAiRequest(
          session.scope,
          candidates,
        );
        const aiResult = await this.runAiScenario(
          "commitSelection",
          createLocalCommitSelectionResult(candidates),
          (provider) => provider.selectFiles(request),
        );
        const { result, source, fallbackReason } = aiResult;
        const state = this.ensureCommitState(session);
        if (source === "local-rule-fallback") {
          // AI 未配置、超时或返回无效结构：保留当前选择与预览，
          // 展示失败原因和“应用本地规则”恢复动作，不再静默替换来源（规划 4.2）。
          state.ai = {
            source,
            summary: "AI 建议获取失败，已保留当前选择。",
            warnings: [],
            fallbackReason,
            failed: true,
          };
          await this.sendCommitSnapshot(session, message.requestId, candidates);
          return;
        }
        const validated = validateAiSelectionResult(
          session.scope,
          result,
          allowedPaths,
        );
        // AI 只能在 recommended 与 needsReview 之间调整；越过本地阻止、
        // 强制排除或用户配置排除的推荐条目在此丢弃并计入警告（规划 5.5）。
        const boundary = enforceAiSelectionLocalBoundary(candidates, validated);
        const effective = boundary.result;
        state.selectedPaths = effective.recommended
          .map((item) =>
            normalizeRelative(
              path.relative(session.scope.repositoryRoot, item.path),
            ),
          )
          .filter((relativePath) =>
            candidates.some(
              (candidate) =>
                candidate.relativePath === relativePath &&
                candidate.selection !== "blocked" &&
                candidate.selection !== "excluded",
            ),
          );
        state.preview = undefined;
        state.ai = {
          source,
          summary: `建议选择 ${state.selectedPaths.length} 个文件；${effective.needsReview.length} 个需要人工确认，${effective.excluded.length} 个建议排除。`,
          warnings: [
            ...boundary.violations,
            ...(effective.blocked.length > 0
              ? [`${effective.blocked.length} 个阻止项未进入选择。`]
              : []),
          ],
          fallbackReason,
          binding: {
            repositoryUuid: session.repositoryUuid,
            scopeHash: session.scopeHash,
            candidateHash: hashCandidateState(candidates, "", []),
            generatedAt: new Date().toISOString(),
            model: session.aiModels.commitSelection || undefined,
          },
        };
        await this.sendCommitSnapshot(session, message.requestId, candidates);
        return;
      }
      case "commit/apply-template": {
        const templateId = asString(data.templateId);
        if (!templateId) {
          return;
        }
        const state = this.ensureCommitState(session);
        state.message = applyCommitMessageTemplate(templateId);
        state.preview = undefined;
        await this.sendCommitSnapshot(session, message.requestId);
        return;
      }
      case "commit/generate-message": {
        const state = this.ensureCommitState(session);
        state.message = asStringAllowEmpty(data.message) ?? state.message;
        state.selectedPaths =
          asStringArray(data.selectedPaths) ?? state.selectedPaths;
        const candidates = await this.collectScopeCandidates(session);
        const selectedAbsolutePaths = this.resolveSelectedAbsolutePaths(
          session,
          candidates,
        );
        const convention = await resolveCommitConventionConfig(
          session.scope.repositoryRoot,
        );
        const diffSummaries = await collectCommitDiffSummaries(
          session.svnPath,
          session.scope,
          selectedAbsolutePaths,
        );
        const storedAi = await readStoredAiConfiguration(this.context);
        const recentHistory = storedAi.includeCommitHistory
          ? readTeamMemory(this.context.workspaceState, session.repositoryUuid)
              .entries.slice(0, storedAi.historyLimit)
              .map((entry) => ({
                revision: entry.revision,
                summary: entry.summary,
              }))
          : undefined;
        const request = buildCommitMessageAiRequest(
          session.scope,
          candidates,
          selectedAbsolutePaths,
          diffSummaries,
          {
            currentMessage: state.message,
            convention: toAiCommitConventionHint(convention.config),
            recentHistory,
          },
        );
        const aiResult = await this.runAiScenario(
          "commitMessage",
          createMockCommitMessageResult(request),
          (provider) => provider.generateCommitMessage(request),
        );
        const { result, source, fallbackReason } = aiResult;
        state.message = result.message;
        state.preview = undefined;
        state.ai = {
          source,
          summary: result.summary,
          warnings: result.warnings,
          fallbackReason,
        };
        await this.sendCommitSnapshot(session, message.requestId, candidates);
        return;
      }
      case "commit/preview": {
        const state = this.ensureCommitState(session);
        state.message = asStringAllowEmpty(data.message) ?? state.message;
        state.selectedPaths =
          asStringArray(data.selectedPaths) ?? state.selectedPaths;
        await this.createCommitPreview(session, message.requestId);
        return;
      }
      case "commit/execute": {
        const previewToken = asString(data.previewToken);
        await this.executeCommit(session, previewToken, message.requestId);
        return;
      }
      case "history/select": {
        const revision = asRevision(data.revision);
        if (!revision) {
          return;
        }
        session.historyState = {
          ...session.historyState,
          selectedRevision: revision,
          compareRevisions: asRevisionArray(data.compareRevisions),
        };
        await this.sendHistorySnapshot(session, message.requestId);
        return;
      }
      case "history/compare": {
        const revisions = asRevisionArray(data.revisions);
        if (revisions.length !== 2) {
          await this.sendError(
            "history",
            "无法比较修订",
            "请选择两个修订后再比较。",
            true,
            message.requestId,
          );
          return;
        }
        const ordered = orderRevisionPair(revisions);
        // 非 Diff 窗口经窗口管理器在独立 Diff 窗口展示修订比较，历史面板保持不变。
        if (this.servedModule !== "diff" && this.onOpenInOtherWindow) {
          await this.onOpenInOtherWindow(
            buildDiffWindowRequest({
              svnPath: session.svnPath,
              scope: session.scope,
              revisionCompare: { revisions: ordered },
            }),
          );
          return;
        }
        session.moduleId = "diff";
        session.taskId = defaultWorkbenchTask("diff");
        session.targetFile = undefined;
        this.panel!.title = getModuleTitle("diff", session.taskId);
        await this.runRevisionCompare(
          session,
          ordered,
          this.servedModule,
          message.requestId,
        );
        return;
      }
      case "history/blame": {
        const fileRoot = getSingleFileScopeRoot(session.scope);
        if (!fileRoot) {
          await this.sendError(
            "history",
            "无法查看 Blame",
            "Blame 仅适用于从单个文件进入的范围。",
            true,
            message.requestId,
          );
          return;
        }
        const result = await runSvnCommand(
          session.svnPath,
          ["blame", fileRoot.absolutePath],
          session.scope.repositoryRoot,
        );
        if (result.exitCode !== 0) {
          await this.sendError(
            "history",
            "Blame 读取失败",
            result.stderr || "SVN blame 执行失败。",
            true,
            message.requestId,
          );
          return;
        }
        const state = session.historyState ?? { compareRevisions: [] };
        state.blame = parseBlameOutput(result.stdout);
        state.feedback = `已读取 ${state.blame.length} 行 Blame 信息。`;
        session.historyState = state;
        await this.sendHistorySnapshot(session, message.requestId);
        return;
      }
      case "history/preview-restore": {
        const fileRoot = getSingleFileScopeRoot(session.scope);
        const revision =
          asRevision(data.revision) ?? session.historyState?.selectedRevision;
        if (!fileRoot || !revision) {
          await this.sendError(
            "history",
            "无法生成恢复预览",
            "请选择单个文件和一个有效修订。",
            true,
            message.requestId,
          );
          return;
        }
        const cat = await runSvnCommand(
          session.svnPath,
          ["cat", "-r", revision, fileRoot.absolutePath],
          session.scope.repositoryRoot,
        );
        const issues: string[] = [];
        if (cat.exitCode !== 0)
          issues.push(cat.stderr || `无法读取 r${revision} 文件内容。`);
        const buffer = Buffer.from(cat.stdout, "utf8");
        if (buffer.byteLength > MAX_DIFF_BYTES)
          issues.push("目标修订文件超过 5 MB，工作台不执行覆盖恢复。");
        if (containsNull(buffer))
          issues.push("目标修订疑似二进制文件，请使用专用恢复流程。");
        const state = session.historyState ?? { compareRevisions: [] };
        state.restorePreview = {
          token: randomUUID(),
          contentHash: await hashFileContentsOrMissing(fileRoot.absolutePath),
          revision,
          relativePath: normalizeRelative(fileRoot.relativePath),
          issues,
        };
        state.feedback = undefined;
        session.historyState = state;
        await this.sendHistorySnapshot(session, message.requestId);
        return;
      }
      case "history/execute-restore": {
        const token = asString(data.previewToken);
        const preview = session.historyState?.restorePreview;
        const fileRoot = getSingleFileScopeRoot(session.scope);
        if (
          !token ||
          !preview ||
          token !== preview.token ||
          preview.issues.length > 0 ||
          !fileRoot
        ) {
          await this.sendError(
            "history",
            "恢复预览已失效",
            "请重新生成文件恢复预览。",
            true,
            message.requestId,
          );
          return;
        }
        if (
          (await hashFileContentsOrMissing(fileRoot.absolutePath)) !==
          preview.contentHash
        ) {
          session.historyState!.restorePreview = undefined;
          await this.sendError(
            "history",
            "工作副本文件已变化",
            "当前文件与预览时不同，请重新检查后恢复。",
            true,
            message.requestId,
          );
          return;
        }
        const cat = await runSvnCommand(
          session.svnPath,
          ["cat", "-r", preview.revision, fileRoot.absolutePath],
          session.scope.repositoryRoot,
        );
        const buffer = Buffer.from(cat.stdout, "utf8");
        if (
          cat.exitCode !== 0 ||
          buffer.byteLength > MAX_DIFF_BYTES ||
          containsNull(buffer)
        ) {
          await this.sendError(
            "history",
            "恢复文件失败",
            cat.stderr || "目标修订内容不满足安全恢复条件。",
            true,
            message.requestId,
          );
          return;
        }
        await fs.writeFile(fileRoot.absolutePath, buffer);
        session.historyState!.restorePreview = undefined;
        session.historyState!.feedback = `${preview.relativePath} 已恢复为 r${preview.revision} 内容；尚未提交。`;
        await this.sendHistorySnapshot(session, message.requestId);
        return;
      }
      case "conflict/select": {
        const relativePath = asString(data.relativePath);
        if (!relativePath) {
          return;
        }
        session.conflictState = { selectedPath: relativePath };
        await this.sendConflictSnapshot(session, message.requestId);
        return;
      }
      case "conflict/advise": {
        const selectedPath =
          asString(data.relativePath) ?? session.conflictState?.selectedPath;
        if (!selectedPath) {
          return;
        }
        const conflicts = await collectConflictItems(
          session.svnPath,
          session.scope,
        );
        const conflict = conflicts.find(
          (item) => item.relativePath === selectedPath,
        );
        if (!conflict) {
          await this.sendError(
            "conflicts",
            "冲突已变化",
            "当前冲突不存在，请刷新状态。",
            true,
            message.requestId,
          );
          return;
        }
        const request = await buildConflictAiRequest(conflict);
        const aiResult = await this.runAiScenario(
          "conflictAdvice",
          createMockConflictAdvice(request),
          (provider) => provider.adviseConflict(request),
        );
        const { result: advice, source, fallbackReason } = aiResult;
        session.conflictState = {
          ...session.conflictState,
          selectedPath,
          advice: { ...advice, source, fallbackReason },
        };
        await this.sendConflictSnapshot(session, message.requestId, conflicts);
        return;
      }
      case "conflict/save-working": {
        const token = asString(data.editToken);
        const content = asStringAllowEmpty(data.content);
        const editState = session.conflictState?.editState;
        if (
          !token ||
          content === undefined ||
          !editState ||
          token !== editState.token
        ) {
          await this.sendError(
            "conflicts",
            "合并草稿已失效",
            "请重新选择冲突文件并再次编辑。",
            true,
            message.requestId,
          );
          return;
        }
        const absolutePath = path.resolve(
          session.scope.repositoryRoot,
          editState.relativePath,
        );
        if (
          validatePathsInScope(session.scope, [absolutePath]).outOfScopeItems
            .length > 0
        ) {
          await this.sendError(
            "conflicts",
            "范围校验失败",
            "合并目标已离开当前右键范围。",
            false,
            message.requestId,
          );
          return;
        }
        if ((await hashFileContents(absolutePath)) !== editState.contentHash) {
          session.conflictState!.editState = undefined;
          await this.sendError(
            "conflicts",
            "工作副本文件已变化",
            "编辑器外部已修改该文件，请重新加载后合并。",
            true,
            message.requestId,
          );
          return;
        }
        const buffer = Buffer.from(content, "utf8");
        if (buffer.byteLength > MAX_DIFF_BYTES || containsNull(buffer)) {
          await this.sendError(
            "conflicts",
            "合并内容不安全",
            "文本超过 5 MB 或包含二进制空字节，工作台未写入。",
            false,
            message.requestId,
          );
          return;
        }
        await fs.writeFile(absolutePath, buffer, { flag: "w" });
        session.conflictState!.resolvePreview = undefined;
        session.conflictState!.editState = {
          token: randomUUID(),
          contentHash: await hashFileContents(absolutePath),
          relativePath: editState.relativePath,
          feedback: containsSvnConflictMarkers(content)
            ? "工作副本内容已保存，但仍有冲突标记；请继续逐块处理。"
            : "工作副本合并结果已保存；请生成解决预览。",
        };
        await this.sendConflictSnapshot(session, message.requestId);
        return;
      }
      case "conflict/preview-resolve": {
        const selectedPath =
          asString(data.relativePath) ?? session.conflictState?.selectedPath;
        if (!selectedPath) {
          return;
        }
        const absolutePath = path.resolve(
          session.scope.repositoryRoot,
          selectedPath,
        );
        const preview = buildResolveConflictPreview(
          session.scope,
          absolutePath,
        );
        const workingContent = await fs.readFile(absolutePath, "utf8");
        if (containsSvnConflictMarkers(workingContent)) {
          preview.issues.push(
            "工作副本中仍有 SVN 冲突标记，不能标记为已解决。",
          );
          preview.canResolve = false;
        }
        const contentHash = await hashFileContents(absolutePath);
        session.conflictState = {
          ...session.conflictState,
          selectedPath,
          resolvePreview: {
            token: randomUUID(),
            contentHash,
            relativePath: selectedPath,
          },
        };
        await this.sendConflictSnapshot(
          session,
          message.requestId,
          undefined,
          preview,
        );
        return;
      }
      case "conflict/resolve": {
        const token = asString(data.previewToken);
        const previewState = session.conflictState?.resolvePreview;
        if (!token || !previewState || token !== previewState.token) {
          await this.sendError(
            "conflicts",
            "解决预览已失效",
            "请重新生成解决预览。",
            true,
            message.requestId,
          );
          return;
        }
        const absolutePath = path.resolve(
          session.scope.repositoryRoot,
          previewState.relativePath,
        );
        if (
          (await hashFileContents(absolutePath)) !== previewState.contentHash
        ) {
          session.conflictState!.resolvePreview = undefined;
          await this.sendError(
            "conflicts",
            "工作副本文件已变化",
            "请检查保存内容并重新生成解决预览。",
            true,
            message.requestId,
          );
          return;
        }
        const result = await resolveConflictUsingWorking(
          session.svnPath,
          session.scope,
          absolutePath,
        );
        if (!result.resolved) {
          await this.sendError(
            "conflicts",
            "标记解决失败",
            result.result.stderr || result.result.stdout || "未知错误",
            true,
            message.requestId,
          );
          return;
        }
        session.conflictState = undefined;
        await this.post({
          protocolVersion: WORKBENCH_PROTOCOL_VERSION,
          type: "operation/result",
          requestId: message.requestId,
          moduleId: "conflicts",
          payload: {
            title: "冲突已标记解决",
            message: previewState.relativePath,
          },
        });
        await this.sendConflictSnapshot(session, message.requestId);
        return;
      }
      case "settings/save-ai": {
        try {
          const input = toAiConfigurationInput(data);
          await saveAiConfiguration(this.context, input);
          session.aiModels = buildScenarioModelMap(
            await readStoredAiConfiguration(this.context),
          );
          const state = this.ensureSettingsState(session);
          state.aiFeedback = {
            tone: "success",
            message: "AI 模型配置已保存，密钥仍仅存于 SecretStorage。",
          };
          await this.sendSettingsSnapshot(session, message.requestId);
        } catch (error) {
          await this.updateSettingsFeedback(
            session,
            "error",
            errorMessage(error),
            message.requestId,
          );
        }
        return;
      }
      case "settings/test-ai": {
        try {
          const provider = await this.createAiProviderFromAction(data);
          await provider.testConnection();
          await this.updateSettingsFeedback(
            session,
            "success",
            "连接成功，模型返回了有效响应。",
            message.requestId,
          );
        } catch (error) {
          await this.updateSettingsFeedback(
            session,
            "error",
            `连接失败：${errorMessage(error)}`,
            message.requestId,
          );
        }
        return;
      }
      case "settings/list-models": {
        try {
          const provider = await this.createAiProviderFromAction(data);
          const models = await provider.listModels();
          const state = this.ensureSettingsState(session);
          state.models = models;
          state.aiFeedback = {
            tone: "success",
            message: `读取到 ${models.length} 个可用模型。`,
          };
          await this.sendSettingsSnapshot(session, message.requestId);
        } catch (error) {
          await this.updateSettingsFeedback(
            session,
            "error",
            `模型列表读取失败：${errorMessage(error)}`,
            message.requestId,
          );
        }
        return;
      }
      case "settings/save-team": {
        try {
          const config = toTeamConfig(data);
          const validation = validateCommitConventionConfig(config);
          if (!validation.valid) {
            throw new Error(validation.issues.join("\n"));
          }
          await saveProjectCommitConventionConfig(
            session.scope.repositoryRoot,
            config,
          );
          const state = this.ensureSettingsState(session);
          state.recommendedTeamConfig = undefined;
          state.recommendation = {
            summary: "团队提交规范已保存。",
            reasons: ["后续提交预检将使用当前仓库配置。"],
            warnings: [],
            confidence: "high",
            source: "local-rule",
          };
          await this.sendSettingsSnapshot(session, message.requestId);
        } catch (error) {
          await this.sendError(
            "settings",
            "团队规则保存失败",
            errorMessage(error),
            true,
            message.requestId,
          );
        }
        return;
      }
      case "settings/recommend-team": {
        try {
          const current = toTeamConfig(data);
          const request = await buildTeamRulesAiRequest(
            session.scope.repositoryRoot,
            current,
          );
          let source:
            "local-rule" | "configured-model" | "local-rule-fallback" =
            "local-rule";
          let fallbackReason: string | undefined;
          let recommendation = createLocalTeamRulesRecommendation(request);
          try {
            const config = await this.resolveStoredAiProvider("teamRules");
            recommendation = await new OpenAiCompatibleProvider(
              config,
            ).recommendTeamRules(request);
            source = "configured-model";
          } catch (error) {
            source = "local-rule-fallback";
            fallbackReason = errorMessage(error);
          }
          const state = this.ensureSettingsState(session);
          state.recommendedTeamConfig = aiConventionToTeamConfig(
            recommendation.commitConvention,
          );
          state.recommendation = {
            summary: recommendation.summary,
            reasons: recommendation.reasons,
            warnings: recommendation.warnings,
            confidence: recommendation.confidence,
            source,
            fallbackReason,
          };
          await this.sendSettingsSnapshot(session, message.requestId);
        } catch (error) {
          await this.sendError(
            "settings",
            "团队规则推荐失败",
            errorMessage(error),
            true,
            message.requestId,
          );
        }
        return;
      }
      case "settings/open-team-file": {
        const state = await readCommitConventionEditState(
          session.scope.repositoryRoot,
        );
        const document = await vscode.workspace.openTextDocument(
          vscode.Uri.file(state.configPath),
        );
        await vscode.window.showTextDocument(document, { preview: false });
        return;
      }
      case "settings/clear-team-memory": {
        await clearTeamMemory(
          this.context.workspaceState,
          session.repositoryUuid,
        );
        await this.sendSettingsSnapshot(session, message.requestId);
        return;
      }
      case "settings/save-selection": {
        const resolved =
          await this.commitSelectionRuleService.getEffectiveRules(
            session.scope.repositoryRoot,
          );
        const verdict = validateCommitSelectionSaveInput(data, {
          user: resolved.layers.user.config,
          workspace: resolved.layers.workspace.config,
        });
        const state = this.ensureSettingsState(session);
        if (!verdict.ok || !verdict.config) {
          state.selectionFeedback = {
            tone: "error",
            message:
              "保存被拒绝：提交选择规则校验失败，未写入任何内容。请修正下列错误后重试。",
          };
          state.selectionSaveErrors = verdict.errors;
          await this.sendSettingsSnapshot(session, message.requestId);
          return;
        }
        this.suppressSelectionInvalidationReload = true;
        let result;
        try {
          result = await this.commitSelectionRuleService.saveRepositoryRules(
            session.scope.repositoryRoot,
            verdict.config,
          );
        } finally {
          this.suppressSelectionInvalidationReload = false;
        }
        if (!result.ok) {
          state.selectionFeedback = {
            tone: "error",
            message: result.error ?? "保存提交选择规则失败。",
          };
          state.selectionSaveErrors = result.error ? [result.error] : undefined;
          await this.sendSettingsSnapshot(session, message.requestId);
          return;
        }
        const warnings = [...verdict.warnings, ...result.warnings];
        state.selectionSaveErrors = undefined;
        state.selectionFeedback =
          warnings.length > 0
            ? {
                tone: "warning",
                message: `提交选择规则已保存到 ${SVN_WORKBENCH_CONFIG_FILE}；存在 ${warnings.length} 条警告（含遮蔽规则），请检查规则列表。`,
              }
            : {
                tone: "success",
                message: `提交选择规则已保存到 ${SVN_WORKBENCH_CONFIG_FILE}，文件其他配置与未知字段保持不变。`,
              };
        await this.sendSettingsSnapshot(session, message.requestId);
        return;
      }
      case "settings/restore-selection-defaults": {
        this.suppressSelectionInvalidationReload = true;
        let result;
        try {
          result =
            await this.commitSelectionRuleService.restoreRepositoryRulesToDefault(
              session.scope.repositoryRoot,
            );
        } finally {
          this.suppressSelectionInvalidationReload = false;
        }
        const state = this.ensureSettingsState(session);
        state.selectionSaveErrors = undefined;
        if (!result.ok) {
          state.selectionFeedback = {
            tone: "error",
            message: result.error ?? "恢复默认提交选择规则失败。",
          };
        } else {
          state.selectionFeedback = {
            tone: "success",
            message: result.removed
              ? `已删除 ${SVN_WORKBENCH_CONFIG_FILE} 中的 commitSelection 配置，恢复为用户/工作区配置与内置默认；文件其他内容未改动。`
              : "当前仓库没有提交选择规则配置，无需恢复默认。",
          };
        }
        await this.sendSettingsSnapshot(session, message.requestId);
        return;
      }
      case "settings/open-selection-file": {
        // 与 open-team-file 同惯例：文件不存在时先按默认内容创建再打开。
        const configPath = await ensureSvnWorkbenchProjectConfig(
          session.scope.repositoryRoot,
        );
        const document = await vscode.workspace.openTextDocument(
          vscode.Uri.file(configPath),
        );
        await vscode.window.showTextDocument(document, { preview: false });
        return;
      }
      case "settings/open-selection-vscode-settings": {
        // 用户/工作区级规则由 VS Code 原生配置承载（规划 4.1）；
        // 按目标层打开原生设置页，筛选 commitSelection 配置键。
        const layer = asString(data.layer);
        await vscode.commands.executeCommand(
          layer === "workspace"
            ? "workbench.action.openWorkspaceSettings"
            : "workbench.action.openSettings",
          "svnWorkbench.commitSelection",
        );
        return;
      }
      case "settings/refresh-selection-preview": {
        // 快照重建会重新采集候选；预览状态（就绪/空/错误）即刷新反馈。
        await this.sendSettingsSnapshot(session, message.requestId);
        return;
      }
      case "diagnostics/run":
        await this.sendDiagnosticsSnapshot(session, message.requestId);
        return;
      case "diagnostics/show-output":
        showOutput();
        return;
      case "repository/preview-update": {
        await this.createUpdatePreview(session, message.requestId);
        return;
      }
      case "repository/execute-update": {
        const token = asString(data.previewToken);
        const update = session.repositoryState?.update;
        if (!token || !update || token !== update.token || !update.canExecute) {
          await this.sendError(
            "repository",
            "更新预览已失效",
            "请重新检查远端更新与本地风险。",
            true,
            message.requestId,
          );
          return;
        }
        const candidates = await this.collectScopeCandidates(session);
        const currentHash = hashCandidateState(candidates, "", []);
        if (currentHash !== session.repositoryState?.candidateHash) {
          session.repositoryState!.update = undefined;
          await this.sendError(
            "repository",
            "工作副本已变化",
            "本地状态已变化，请重新生成更新预览。",
            true,
            message.requestId,
          );
          return;
        }
        await this.post({
          protocolVersion: WORKBENCH_PROTOCOL_VERSION,
          type: "operation/progress",
          requestId: message.requestId,
          moduleId: "repository",
          payload: {
            title: "正在更新当前范围",
            message: "SVN update --accept postpone",
            cancellable: true,
          },
        });
        const controller = new AbortController();
        session.activeOperation = { moduleId: "repository", controller };
        let result: Awaited<ReturnType<typeof runUpdateScope>>;
        try {
          result = await runUpdateScope(session.svnPath, session.scope, {
            signal: controller.signal,
          });
        } finally {
          if (session.activeOperation?.controller === controller)
            session.activeOperation = undefined;
        }
        if (result.result.cancelled) {
          session.repositoryState = {
            lastResult: {
              ok: false,
              hasConflicts: false,
              message: "更新已取消；请重新检查工作副本状态。",
            },
          };
          await this.post({
            protocolVersion: WORKBENCH_PROTOCOL_VERSION,
            type: "operation/cancelled",
            requestId: message.requestId,
            moduleId: "repository",
            payload: {
              title: "更新已取消",
              message: "SVN 进程已停止，当前状态将重新采集。",
            },
          });
          await this.sendRepositorySnapshot(session, message.requestId);
          return;
        }
        session.repositoryState = {
          lastResult: {
            ok: result.result.exitCode === 0,
            revision: result.revision,
            hasConflicts: result.hasConflicts,
            message:
              result.result.exitCode === 0
                ? result.revision
                  ? `已更新到 r${result.revision}`
                  : "当前范围更新完成。"
                : result.result.stderr ||
                  result.result.stdout ||
                  "SVN 更新失败。",
          },
        };
        await this.sendRepositorySnapshot(session, message.requestId);
        return;
      }
      case "repository/preview-property": {
        const target = getSingleScopeTarget(session.scope);
        if (!target) {
          await this.sendError(
            "repository",
            "无法编辑属性",
            "属性编辑只支持单个文件或文件夹范围。",
            true,
            message.requestId,
          );
          return;
        }
        const name = (asStringAllowEmpty(data.name) ?? "").trim();
        const value = asStringAllowEmpty(data.value) ?? "";
        const remove = data.remove === true;
        const current = await collectSvnProperties(
          session.svnPath,
          target.absolutePath,
          session.scope.repositoryRoot,
        );
        const issues = current.error
          ? [current.error]
          : validatePropertyEdit(name, value, remove, current.items);
        const state = session.repositoryState ?? {};
        state.propertyPreview = {
          token: randomUUID(),
          stateHash: hashProperties(current.items),
          target: target.absolutePath,
          name,
          value,
          remove,
          issues,
        };
        state.propertyFeedback = undefined;
        session.repositoryState = state;
        await this.sendRepositorySnapshot(session, message.requestId);
        return;
      }
      case "repository/execute-property": {
        const token = asString(data.previewToken);
        const preview = session.repositoryState?.propertyPreview;
        if (
          !token ||
          !preview ||
          token !== preview.token ||
          preview.issues.length > 0
        ) {
          await this.sendError(
            "repository",
            "属性预览已失效",
            "请重新生成属性变更预览。",
            true,
            message.requestId,
          );
          return;
        }
        if (
          validatePathsInScope(session.scope, [preview.target]).outOfScopeItems
            .length > 0
        ) {
          await this.sendError(
            "repository",
            "范围校验失败",
            "属性目标已离开当前操作范围。",
            false,
            message.requestId,
          );
          return;
        }
        const current = await collectSvnProperties(
          session.svnPath,
          preview.target,
          session.scope.repositoryRoot,
        );
        if (
          current.error ||
          hashProperties(current.items) !== preview.stateHash
        ) {
          session.repositoryState!.propertyPreview = undefined;
          await this.sendError(
            "repository",
            "属性状态已变化",
            current.error || "属性已被其他操作修改，请重新预览。",
            true,
            message.requestId,
          );
          return;
        }
        const args = preview.remove
          ? ["propdel", preview.name, preview.target]
          : ["propset", preview.name, preview.value, preview.target];
        const result = await runSvnCommand(
          session.svnPath,
          args,
          session.scope.repositoryRoot,
        );
        if (result.exitCode !== 0) {
          await this.sendError(
            "repository",
            "属性更新失败",
            result.stderr || result.stdout || "未知错误",
            true,
            message.requestId,
          );
          return;
        }
        session.repositoryState!.propertyPreview = undefined;
        session.repositoryState!.propertyFeedback = preview.remove
          ? `已删除属性 ${preview.name}。`
          : `已设置属性 ${preview.name}；变更尚未提交。`;
        await this.sendRepositorySnapshot(session, message.requestId);
        return;
      }
      case "repository/preview-cleanup": {
        const target = getSingleFolderScopeTarget(session.scope);
        const issues = target
          ? []
          : ["清理（Cleanup）只支持单个文件夹范围；请从工作副本目录右键进入。"];
        const state = session.repositoryState ?? {};
        state.cleanupPreview = {
          token: randomUUID(),
          target: target?.absolutePath ?? "",
          issues,
        };
        state.cleanupFeedback = undefined;
        session.repositoryState = state;
        await this.sendRepositorySnapshot(session, message.requestId);
        return;
      }
      case "repository/execute-cleanup": {
        const token = asString(data.previewToken);
        const preview = session.repositoryState?.cleanupPreview;
        if (
          !token ||
          !preview ||
          token !== preview.token ||
          preview.issues.length > 0
        ) {
          await this.sendError(
            "repository",
            "清理预览已失效",
            "请从单个文件夹范围重新生成预览。",
            true,
            message.requestId,
          );
          return;
        }
        if (
          validatePathsInScope(session.scope, [preview.target]).outOfScopeItems
            .length > 0
        ) {
          await this.sendError(
            "repository",
            "范围校验失败",
            "清理目标不再属于当前范围。",
            false,
            message.requestId,
          );
          return;
        }
        const controller = new AbortController();
        session.activeOperation = { moduleId: "repository", controller };
        await this.post({
          protocolVersion: WORKBENCH_PROTOCOL_VERSION,
          type: "operation/progress",
          requestId: message.requestId,
          moduleId: "repository",
          payload: {
            title: "正在清理工作副本",
            message: "不会删除未版本化文件",
            cancellable: true,
          },
        });
        let result: Awaited<ReturnType<typeof runSvnCommand>>;
        try {
          result = await runSvnCommand(
            session.svnPath,
            ["cleanup", preview.target],
            session.scope.repositoryRoot,
            { signal: controller.signal },
          );
        } finally {
          if (session.activeOperation?.controller === controller)
            session.activeOperation = undefined;
        }
        session.repositoryState!.cleanupPreview = undefined;
        if (result.cancelled) {
          await this.post({
            protocolVersion: WORKBENCH_PROTOCOL_VERSION,
            type: "operation/cancelled",
            requestId: message.requestId,
            moduleId: "repository",
            payload: {
              title: "清理已取消",
              message: "请重新检查工作副本状态后再继续。",
            },
          });
        } else if (result.exitCode !== 0) {
          await this.sendError(
            "repository",
            "清理失败",
            result.stderr || result.stdout || "未知错误",
            true,
            message.requestId,
          );
          return;
        } else {
          session.repositoryState!.cleanupFeedback =
            "清理已完成；未删除未版本化文件，请重新检查状态。";
          session.recoveryState = undefined;
        }
        await this.sendRepositorySnapshot(session, message.requestId);
        return;
      }
      case "repository/browse":
        await this.browseRepository(
          session,
          asString(data.url),
          message.requestId,
        );
        return;
      case "repository/preview-advanced":
        await this.previewAdvancedRepositoryOperation(
          session,
          data,
          message.requestId,
        );
        return;
      case "repository/execute-advanced":
        await this.executeAdvancedRepositoryOperation(
          session,
          asString(data.previewToken),
          message.requestId,
        );
        return;
      case "repository/export-patch":
        await this.exportScopePatch(session, message.requestId);
        return;
      case "repository/select-patch":
        await this.selectPatchForPreview(session, message.requestId);
        return;
      case "repository/generate-release-notes":
        await this.generateReleaseNotes(
          session,
          asString(data.fromRevision),
          asString(data.toRevision),
          message.requestId,
        );
        return;
      case "ai-review/run":
        await this.sendAiReviewSnapshot(session, message.requestId);
        return;
      case "impact/run":
        await this.sendImpactSnapshot(session, message.requestId);
        return;
      case "changelist/suggest": {
        const candidates = await this.collectScopeCandidates(session);
        const convention = await resolveCommitConventionConfig(
          session.scope.repositoryRoot,
        );
        const selectedPaths = candidates
          .filter(
            (item) =>
              item.selection !== "blocked" && item.selection !== "excluded",
          )
          .map((item) => item.absolutePath);
        const request = buildCommitSplitAiRequest(
          session.scope,
          candidates,
          selectedPaths,
          { convention: toAiCommitConventionHint(convention.config) },
        );
        const aiResult = await this.runAiScenario(
          "commitSplit",
          createLocalCommitSplitResult(request),
          (provider) => provider.suggestCommitSplits(request),
        );
        const { result: rawResult, source, fallbackReason } = aiResult;
        const result = validateCommitSplitResult(
          session.scope,
          rawResult,
          selectedPaths,
        );
        session.changelistState = {
          suggestions: result.splits.map((item) => ({
            ...item,
            paths: item.paths.map((filePath) =>
              normalizeRelative(
                path.relative(session.scope.repositoryRoot, filePath),
              ),
            ),
          })),
          warnings: result.warnings,
          source,
          fallbackReason,
        };
        await this.sendChangelistsSnapshot(
          session,
          message.requestId,
          candidates,
        );
        return;
      }
      case "changelist/preview-apply": {
        const name = (asStringAllowEmpty(data.name) ?? "").trim();
        const remove = data.remove === true;
        const paths = asStringArray(data.paths) ?? [];
        const candidates = await this.collectScopeCandidates(session);
        const candidatePaths = new Set(
          candidates.map((item) => item.relativePath),
        );
        const issues: string[] = [];
        if (!remove && !name) issues.push("Changelist 名称不能为空。");
        if (paths.length === 0) issues.push("请选择至少一个文件。");
        if (paths.some((item) => !candidatePaths.has(item)))
          issues.push("选择中包含已变化或不属于当前范围的路径。");
        const token = randomUUID();
        const state = session.changelistState ?? {
          suggestions: [],
          warnings: [],
          source: "local-rule" as const,
        };
        state.preview = {
          token,
          candidateHash: hashCandidateState(candidates, "", []),
          name: remove ? undefined : name,
          remove,
          paths,
          issues,
        };
        state.feedback = undefined;
        session.changelistState = state;
        await this.sendChangelistsSnapshot(
          session,
          message.requestId,
          candidates,
          issues,
        );
        return;
      }
      case "changelist/execute-apply": {
        const token = asString(data.previewToken);
        const preview = session.changelistState?.preview;
        if (
          !token ||
          !preview ||
          token !== preview.token ||
          preview.issues.length > 0
        ) {
          await this.sendError(
            "changelists",
            "Changelist 预览已失效",
            "请重新生成预览。",
            true,
            message.requestId,
          );
          return;
        }
        const candidates = await this.collectScopeCandidates(session);
        if (hashCandidateState(candidates, "", []) !== preview.candidateHash) {
          session.changelistState!.preview = undefined;
          await this.sendError(
            "changelists",
            "工作副本已变化",
            "请刷新后重新生成 Changelist 预览。",
            true,
            message.requestId,
          );
          return;
        }
        const result = await applySvnChangelist(
          session.svnPath,
          session.scope,
          preview.name,
          preview.paths,
        );
        if (result.exitCode !== 0) {
          await this.sendError(
            "changelists",
            "Changelist 更新失败",
            result.stderr || result.stdout || "未知错误",
            true,
            message.requestId,
          );
          return;
        }
        session.changelistState!.preview = undefined;
        session.changelistState!.feedback = preview.remove
          ? "文件已移出 Changelist。"
          : `文件已加入 ${preview.name}。`;
        await this.sendChangelistsSnapshot(session, message.requestId);
        return;
      }
      case "agent/create-plan": {
        const candidates = await this.collectScopeCandidates(session);
        const objective =
          (asStringAllowEmpty(data.objective) ?? "").trim().slice(0, 500) ||
          "检查当前 SVN 变更并形成可执行的提交前建议";
        session.agentState = {
          candidateHash: hashCandidateState(candidates, "", []),
          snapshot: {
            kind: "agent",
            status: "planned",
            objective,
            guardrails: [
              "只访问当前右键范围",
              "每一步都需要显式批准",
              "不自动修改文件、不自动提交",
              "状态变化后计划立即失效",
            ],
            steps: [
              {
                id: "status",
                title: "重新采集 SVN 状态",
                detail: "读取当前范围的状态并确认阻止项。",
                capability: "svn-read",
                command: "svn status --xml <current-scope>",
                scope: "当前右键范围",
                risk: "低 · 只读 SVN 状态",
                reversibility: "不产生修改",
                status: "pending",
                requiresApproval: true,
              },
              {
                id: "review",
                title: "执行证据审查",
                detail: "使用本地敏感信息、调试代码与生成物规则扫描。",
                capability: "local-analysis",
                scope: "当前候选元数据与受限差异",
                risk: "低 · 可能产生误报",
                reversibility: "只生成建议，可丢弃",
                status: "pending",
                requiresApproval: true,
              },
              {
                id: "impact",
                title: "生成影响与测试计划",
                detail: "根据实际变更路径给出验证命令和上线观察点。",
                capability: "local-analysis",
                scope: "当前候选路径和文件类型",
                risk: "低 · 需要人工验证建议",
                reversibility: "只生成计划，可丢弃",
                status: "pending",
                requiresApproval: true,
              },
            ],
            nextStepId: "status",
          },
        };
        await this.sendAgentSnapshot(session, message.requestId);
        return;
      }
      case "agent/approve-step": {
        const stepId = asString(data.stepId);
        const state = session.agentState;
        if (!stepId || !state || state.snapshot.nextStepId !== stepId) {
          await this.sendError(
            "agent",
            "代理步骤不可执行",
            "只能批准当前待执行步骤，请重新生成计划。",
            true,
            message.requestId,
          );
          return;
        }
        const candidates = await this.collectScopeCandidates(session);
        if (hashCandidateState(candidates, "", []) !== state.candidateHash) {
          state.snapshot.status = "failed";
          state.snapshot.message =
            "工作副本已变化，原计划已过期。请重新生成计划。";
          await this.sendAgentSnapshot(session, message.requestId);
          return;
        }
        const step = state.snapshot.steps.find((item) => item.id === stepId)!;
        state.snapshot.status = "running";
        step.status = "running";
        await this.sendAgentSnapshot(session, message.requestId);
        try {
          if (stepId === "status") {
            const blocked = candidates.filter(
              (item) => item.selection === "blocked",
            ).length;
            step.output = `已采集 ${candidates.length} 个候选，其中 ${blocked} 个阻止项。`;
          } else if (stepId === "review") {
            const review = await buildLocalChangeReview(candidates);
            step.output = `发现 ${review.summary.critical} 个高风险、${review.summary.warning} 个提醒、${review.summary.note} 个建议。`;
          } else {
            const impact = buildLocalImpactAnalysis(candidates);
            step.output = `识别 ${impact.areas.length} 个影响区域，生成 ${impact.tests.length} 条测试建议。`;
          }
          step.status = "completed";
          const next = state.snapshot.steps.find(
            (item) => item.status === "pending",
          );
          state.snapshot.nextStepId = next?.id;
          state.snapshot.status = next ? "planned" : "completed";
          state.snapshot.message = next
            ? "当前步骤完成，等待批准下一步。"
            : "受控分析计划已完成，可以进入审查、影响或提交模块继续操作。";
        } catch (error) {
          step.status = "failed";
          step.output = errorMessage(error);
          state.snapshot.status = "failed";
          state.snapshot.message = "步骤执行失败；未继续后续步骤。";
        }
        await this.sendAgentSnapshot(session, message.requestId);
        return;
      }
      case "agent/cancel": {
        if (session.agentState) {
          session.agentState.snapshot.status = "cancelled";
          session.agentState.snapshot.nextStepId = undefined;
          session.agentState.snapshot.message = "计划已取消；没有执行写操作。";
          for (const step of session.agentState.snapshot.steps) {
            if (step.status === "pending" || step.status === "running")
              step.status = "cancelled";
          }
          await this.sendAgentSnapshot(session, message.requestId);
        }
        return;
      }
      case "changes/preview-operation": {
        const operation = asFileOperation(data.operation);
        const paths = asStringArray(data.paths) ?? [];
        const ignoreMode =
          data.ignoreMode === "repository"
            ? ("repository" as const)
            : ("directory" as const);
        if (!operation) {
          await this.sendError(
            "changes",
            "操作无效",
            "不支持的 SVN 文件操作。",
            false,
            message.requestId,
          );
          return;
        }
        const candidates = await this.collectScopeCandidates(session);
        const issues = validateFileOperation(
          candidates,
          operation,
          paths,
          session.scope,
          ignoreMode,
        );
        session.changesState = {
          preview: {
            token: randomUUID(),
            candidateHash: hashCandidateState(candidates, "", []),
            operation,
            ignoreMode: operation === "ignore" ? ignoreMode : undefined,
            paths,
            issues,
          },
        };
        await this.sendChangesSnapshot(session, message.requestId, candidates);
        return;
      }
      case "changes/execute-operation": {
        const token = asString(data.previewToken);
        const preview = session.changesState?.preview;
        if (
          !token ||
          !preview ||
          token !== preview.token ||
          preview.issues.length > 0
        ) {
          await this.sendError(
            "changes",
            "文件操作预览已失效",
            "请重新选择文件并生成操作预览。",
            true,
            message.requestId,
          );
          return;
        }
        const candidates = await this.collectScopeCandidates(session);
        const currentIssues = validateFileOperation(
          candidates,
          preview.operation,
          preview.paths,
          session.scope,
          preview.ignoreMode,
        );
        if (
          hashCandidateState(candidates, "", []) !== preview.candidateHash ||
          currentIssues.length > 0
        ) {
          session.changesState!.preview = undefined;
          await this.sendError(
            "changes",
            "工作副本已变化",
            "当前状态不再满足原操作条件，请刷新后重试。",
            true,
            message.requestId,
          );
          return;
        }
        const result =
          preview.operation === "ignore"
            ? await applyIgnoreOperation(
                session.svnPath,
                session.scope,
                preview.paths,
                preview.ignoreMode ?? "directory",
              )
            : await runSvnCommand(
                session.svnPath,
                buildFileOperationArgs(
                  preview.operation,
                  preview.paths.map((item) =>
                    path.resolve(session.scope.repositoryRoot, item),
                  ),
                ),
                session.scope.repositoryRoot,
              );
        if (result.exitCode !== 0) {
          await this.sendError(
            "changes",
            "SVN 文件操作失败",
            result.stderr || result.stdout || "未知错误",
            true,
            message.requestId,
          );
          return;
        }
        session.changesState = {
          feedback: fileOperationSuccess(
            preview.operation,
            preview.paths.length,
          ),
        };
        await this.sendChangesSnapshot(session, message.requestId);
        return;
      }
      case "changes/copy-url": {
        const relativePath = asString(data.relativePath);
        if (!relativePath) return;
        const absolutePath = path.resolve(
          session.scope.repositoryRoot,
          relativePath,
        );
        if (
          validatePathsInScope(session.scope, [absolutePath]).outOfScopeItems
            .length > 0
        ) {
          await this.sendError(
            "changes",
            "范围校验失败",
            "无法读取范围外路径的仓库 URL。",
            false,
            message.requestId,
          );
          return;
        }
        const result = await runSvnCommand(
          session.svnPath,
          ["info", "--show-item", "url", absolutePath],
          session.scope.repositoryRoot,
        );
        if (result.exitCode !== 0 || !result.stdout.trim()) {
          await this.sendError(
            "changes",
            "读取仓库 URL 失败",
            result.stderr || "该文件可能尚未纳入版本控制。",
            true,
            message.requestId,
          );
          return;
        }
        await vscode.env.clipboard.writeText(result.stdout.trim());
        session.changesState = { feedback: "仓库 URL 已复制。" };
        await this.sendChangesSnapshot(session, message.requestId);
        return;
      }
      case "changes/show-in-repository": {
        const relativePath = asString(data.relativePath);
        if (!relativePath) return;
        const absolutePath = path.resolve(
          session.scope.repositoryRoot,
          relativePath,
        );
        if (
          validatePathsInScope(session.scope, [absolutePath]).outOfScopeItems
            .length > 0
        ) {
          await this.sendError(
            "changes",
            "范围校验失败",
            "无法浏览当前右键范围外路径。",
            false,
            message.requestId,
          );
          return;
        }
        const result = await runSvnCommand(
          session.svnPath,
          ["info", "--show-item", "url", absolutePath],
          session.scope.repositoryRoot,
        );
        if (result.exitCode !== 0 || !result.stdout.trim()) {
          await this.sendError(
            "changes",
            "无法定位仓库路径",
            result.stderr || "该资源可能尚未加入版本控制。",
            true,
            message.requestId,
          );
          return;
        }
        session.moduleId = "repository";
        session.taskId = "repository/browse";
        this.panel!.title = getModuleTitle("repository", session.taskId);
        await this.browseRepository(
          session,
          result.stdout.trim(),
          message.requestId,
        );
        return;
      }
    }
  }

  private async sendInitialize(): Promise<void> {
    if (!this.panel || !this.session) {
      return;
    }
    await this.post({
      protocolVersion: WORKBENCH_PROTOCOL_VERSION,
      type: "app/initialize",
      moduleId: this.session.moduleId,
      taskId: this.session.taskId,
      payload: {
        moduleId: this.session.moduleId,
        scope: this.session.scopeView,
      },
    });
  }

  private async loadModule(
    moduleId: WorkbenchModuleId,
    targetFile?: string,
    requestId?: string,
  ): Promise<void> {
    const session = this.session;
    if (!session || !this.panel) {
      return;
    }
    const effectiveRequestId = requestId ?? randomUUID();
    this.latestModuleRequests.set(moduleId, effectiveRequestId);
    await this.post({
      protocolVersion: WORKBENCH_PROTOCOL_VERSION,
      type: "module/loading",
      requestId: effectiveRequestId,
      moduleId,
      payload: { moduleId },
    });

    try {
      const snapshot = await this.buildSnapshot(session, moduleId, targetFile);
      if (
        this.session !== session ||
        this.session.moduleId !== moduleId ||
        this.latestModuleRequests.get(moduleId) !== effectiveRequestId
      ) {
        return;
      }
      await this.post({
        protocolVersion: WORKBENCH_PROTOCOL_VERSION,
        type: "module/snapshot",
        requestId: effectiveRequestId,
        moduleId,
        payload: { snapshot },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendOutput(`加载 Svelte 模块 ${moduleId} 失败：${message}`);
      if (this.latestModuleRequests.get(moduleId) === effectiveRequestId) {
        await this.sendError(
          moduleId,
          "模块加载失败",
          message,
          true,
          effectiveRequestId,
        );
      }
    }
  }

  private async buildSnapshot(
    session: WorkbenchSession,
    moduleId: WorkbenchModuleId,
    targetFile?: string,
  ): Promise<WorkbenchModuleSnapshot> {
    if (moduleId === "changes") {
      const candidates = await this.collectScopeCandidates(session);
      const summary = summarizeCommitCandidates(candidates);
      const preview = session.changesState?.preview;
      const files = await buildWorkbenchFileViews(
        candidates,
        session.scopeView.repositoryName,
      );
      return {
        kind: "changes",
        commitDraft: this.ensureCommitState(session).message,
        files,
        summary: summary.statuses,
        refreshedAt: new Date().toISOString(),
        operationPreview: preview
          ? {
              token: preview.token,
              operation: preview.operation,
              ignoreMode: preview.ignoreMode,
              paths: preview.paths,
              command: formatFileOperationCommand(
                preview.operation,
                preview.paths,
                preview.ignoreMode,
              ),
              consequences: fileOperationConsequences(
                preview.operation,
                preview.ignoreMode,
              ),
              destructive:
                preview.operation === "revert" ||
                preview.operation === "remove",
              recoverability: fileOperationRecoverability(preview.operation),
              canExecute: preview.issues.length === 0,
              issues: preview.issues,
            }
          : undefined,
        feedback: session.changesState?.feedback,
      };
    }

    if (moduleId === "diff") {
      if (!targetFile) {
        throw new Error("请选择一个文件查看差异。");
      }
      return this.buildDiffSnapshot(session, targetFile);
    }

    if (moduleId === "commit") {
      return this.buildCommitSnapshot(session);
    }

    if (moduleId === "history") {
      return this.buildHistorySnapshot(session);
    }

    if (moduleId === "conflicts") {
      return this.buildConflictSnapshot(session);
    }

    if (moduleId === "settings") {
      return this.buildSettingsSnapshot(session);
    }

    if (moduleId === "diagnostics") {
      return this.buildDiagnosticsSnapshot();
    }

    if (moduleId === "repository") {
      return this.buildRepositorySnapshot(session);
    }

    if (moduleId === "ai-review") {
      const candidates = await this.collectScopeCandidates(session);
      return buildLocalChangeReview(candidates);
    }

    if (moduleId === "impact") {
      const candidates = await this.collectScopeCandidates(session);
      return buildLocalImpactAnalysis(candidates);
    }

    if (moduleId === "changelists") {
      return this.buildChangelistsSnapshot(session);
    }

    if (moduleId === "agent") {
      return session.agentState?.snapshot ?? emptyAgentSnapshot();
    }

    throw new Error(`未实现的工作台模块：${moduleId satisfies never}`);
  }

  /**
   * 修订比较（history/compare）：执行 `svn diff -r rA:rB` 并直接推送
   * patch 快照到 diff 模块。`errorModuleId` 标记失败错误归属的模块
   * （主工作台面板内切换时为 history；独立 Diff 窗口会话为 diff）。
   */
  private async runRevisionCompare(
    session: WorkbenchSession,
    revisions: readonly string[],
    errorModuleId: WorkbenchModuleId,
    requestId?: string,
  ): Promise<void> {
    const ordered = orderRevisionPair(revisions);
    const targetPaths = session.scope.roots.map((root) => root.absolutePath);
    const result = await runSvnCommand(
      session.svnPath,
      ["diff", "-r", `${ordered[0]}:${ordered[1]}`, ...targetPaths],
      session.scope.repositoryRoot,
      { maxOutputBytes: MAX_DIFF_BYTES },
    );
    if (result.exitCode !== 0 && !result.truncated) {
      await this.sendError(
        errorModuleId,
        "修订比较失败",
        result.stderr || "SVN diff 执行失败。",
        true,
        requestId,
      );
      return;
    }
    const diffBuffer = Buffer.from(result.stdout, "utf8");
    const snapshot: DiffSnapshot = {
      kind: "diff",
      relativePath: `${session.scope.roots.map((root) => root.relativePath).join(", ")} · r${ordered[0]} → r${ordered[1]}`,
      original: "",
      modified: truncateUtf8(diffBuffer),
      language: "diff",
      truncated:
        Boolean(result.truncated) || diffBuffer.byteLength >= MAX_DIFF_BYTES,
      binary: false,
      message: result.truncated
        ? `修订比较 r${ordered[0]} → r${ordered[1]}（超过 5 MB，已截断）`
        : `修订比较 r${ordered[0]} → r${ordered[1]}`,
    };
    await this.post({
      protocolVersion: WORKBENCH_PROTOCOL_VERSION,
      type: "module/snapshot",
      requestId,
      moduleId: "diff",
      payload: { snapshot },
    });
  }

  private async openNativeDiff(
    session: WorkbenchSession,
    requestId?: string,
  ): Promise<void> {
    if (!this.isDiffWindow() || !this.nativeDiffContentProvider) {
      await this.sendError(
        session.moduleId,
        "无法打开编辑器对比",
        "原生对比只能从独立 SVN Diff 窗口打开。",
        false,
        requestId,
      );
      return;
    }
    if (session.revisionCompare || !session.targetFile) {
      await this.sendError(
        "diff",
        "无法打开编辑器对比",
        "修订比较保持双侧只读；请选择 Working Copy ↔ BASE 文件后重试。",
        false,
        requestId,
      );
      return;
    }

    const absolutePath = path.resolve(session.targetFile);
    if (
      validatePathsInScope(session.scope, [absolutePath]).outOfScopeItems
        .length > 0
    ) {
      await this.sendError(
        "diff",
        "操作范围已变化",
        "目标文件已不在当前右键范围内，请返回修改列表后重新打开 Diff。",
        false,
        requestId,
      );
      return;
    }

    const controller = new AbortController();
    session.activeOperation = { moduleId: "diff", controller };
    await this.post({
      protocolVersion: WORKBENCH_PROTOCOL_VERSION,
      type: "operation/progress",
      requestId,
      moduleId: "diff",
      payload: {
        title: "正在准备编辑器对比",
        message: "正在安全读取 Working Copy 与 BASE 内容。",
        cancellable: true,
      },
    });

    try {
      const working = await readFileForDiff(absolutePath);
      if (this.session?.sessionId !== session.sessionId) return;
      const baseResult = await runSvnCommand(
        session.svnPath,
        ["cat", "-r", "BASE", absolutePath],
        path.dirname(absolutePath),
        { signal: controller.signal, maxOutputBytes: MAX_DIFF_BYTES },
      );
      if (this.session?.sessionId !== session.sessionId) return;
      if (baseResult.cancelled) {
        await this.post({
          protocolVersion: WORKBENCH_PROTOCOL_VERSION,
          type: "operation/cancelled",
          requestId,
          moduleId: "diff",
          payload: {
            title: "已取消编辑器对比",
            message: "未打开原生 Diff；Webview 中的只读差异仍可继续使用。",
          },
        });
        return;
      }
      if (baseResult.exitCode !== 0) {
        await this.sendError(
          "diff",
          "无法读取 BASE 内容",
          baseResult.stderr ||
            "文件可能未纳入版本控制。请刷新状态、重新认证或返回修改列表。",
          true,
          requestId,
        );
        return;
      }

      const baseBuffer = Buffer.from(baseResult.stdout, "utf8");
      if (working.binary || containsNull(baseBuffer)) {
        await this.sendError(
          "diff",
          "二进制文件无法进行文本对比",
          "请在编辑器中直接打开工作副本，或查看 SVN 属性与历史。",
          false,
          requestId,
        );
        return;
      }
      if (
        working.truncated ||
        baseResult.truncated ||
        baseBuffer.byteLength >= MAX_DIFF_BYTES
      ) {
        await this.sendError(
          "diff",
          "文件超过原生对比上限",
          "Working Copy 或 BASE 超过 5 MB。请使用外部工具或缩小目标后重试。",
          false,
          requestId,
        );
        return;
      }
      if (working.text === baseResult.stdout) {
        await this.post({
          protocolVersion: WORKBENCH_PROTOCOL_VERSION,
          type: "operation/result",
          requestId,
          moduleId: "diff",
          payload: {
            title: "没有文本差异",
            message: "Working Copy 与 BASE 内容相同，未打开原生 Diff。",
          },
        });
        return;
      }

      const baseUri = this.nativeDiffContentProvider.createBaseUri(
        session.sessionId,
        baseResult.stdout,
      );
      await vscode.commands.executeCommand(
        "vscode.diff",
        baseUri,
        vscode.Uri.file(absolutePath),
        `${normalizeRelative(path.relative(session.scope.repositoryRoot, absolutePath))}（BASE ↔ 工作副本）`,
        { preview: true },
      );
      await this.post({
        protocolVersion: WORKBENCH_PROTOCOL_VERSION,
        type: "operation/result",
        requestId,
        moduleId: "diff",
        payload: {
          title: "已打开编辑器对比",
          message: "左侧为只读 BASE，右侧为当前工作副本。",
        },
      });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const message =
        code === "ENOENT"
          ? "工作副本文件已移动或删除。请返回修改列表并刷新状态。"
          : errorMessage(error);
      await this.sendError(
        "diff",
        "无法打开编辑器对比",
        message,
        true,
        requestId,
      );
    } finally {
      if (session.activeOperation?.controller === controller) {
        session.activeOperation = undefined;
      }
    }
  }

  private async buildDiffSnapshot(
    session: WorkbenchSession,
    targetFile: string,
  ): Promise<DiffSnapshot> {
    const absolutePath = path.resolve(targetFile);
    if (
      validatePathsInScope(session.scope, [absolutePath]).outOfScopeItems
        .length > 0
    ) {
      throw new Error("文件不在当前右键操作范围内。");
    }

    const working = await readFileForDiff(absolutePath);
    const baseResult = await runSvnCommand(
      session.svnPath,
      ["cat", "-r", "BASE", absolutePath],
      path.dirname(absolutePath),
      { maxOutputBytes: MAX_DIFF_BYTES },
    );
    const baseBuffer = Buffer.from(baseResult.stdout, "utf8");
    const binary = working.binary || containsNull(baseBuffer);
    const truncated =
      working.truncated ||
      Boolean(baseResult.truncated) ||
      baseBuffer.byteLength >= MAX_DIFF_BYTES;
    const original = binary ? "" : truncateUtf8(baseBuffer);

    // v0.0.6 页内编辑能力标记（轻量校验；严格复验在 diff/open-edit 与保存时）。
    let edit: NonNullable<DiffSnapshot["edit"]>;
    if (binary) {
      edit = {
        supported: false,
        reason: "二进制文件不支持页内编辑；请使用原生编辑器。",
      };
    } else if (truncated) {
      edit = {
        supported: false,
        reason: "超过 5 MB 的文件不支持页内编辑；请使用原生编辑器。",
      };
    } else if (baseResult.exitCode !== 0) {
      edit = {
        supported: false,
        reason: "无法读取 BASE 内容（可能未纳入版本控制），不支持页内编辑。",
      };
    } else {
      const capability = await this.computeDiffEditCapability(absolutePath);
      edit = capability;
    }
    const targetId = edit.targetId;
    const draft = targetId ? this.diffEdit?.getDraft(targetId) : undefined;
    // 只有脏草稿才对 Webview 可见（干净草稿无可恢复内容，不展示恢复入口）。
    const dirtyDraft =
      draft && targetId && this.diffEdit?.isDraftDirty(targetId)
        ? draft
        : undefined;
    // 恢复路径：存在草稿时以草稿内容作为可编辑侧（工作副本侧展示草稿）。
    const modified =
      draft && draft.targetPath === path.resolve(absolutePath)
        ? draft.content
        : binary
          ? ""
          : working.text;

    return {
      kind: "diff",
      relativePath: normalizeRelative(
        path.relative(session.scope.repositoryRoot, absolutePath),
      ),
      original,
      modified,
      language: inferLanguage(absolutePath),
      truncated,
      binary,
      edit,
      draft: dirtyDraft
        ? { revision: dirtyDraft.revision, updatedAt: dirtyDraft.updatedAt }
        : undefined,
      message: binary
        ? "检测到二进制内容，未向 Webview 发送文件正文。"
        : truncated
          ? "文件超过 5 MB，仅显示前 5 MB。"
          : baseResult.exitCode !== 0
            ? "无法读取 BASE 内容，可能是未版本化文件。"
            : dirtyDraft
              ? "存在未保存草稿，编辑前请先恢复或放弃。"
              : undefined,
    };
  }

  /** 轻量能力校验：普通文件、UTF-8、≤5 MB 且在工作副本内。 */
  private async computeDiffEditCapability(
    absolutePath: string,
  ): Promise<NonNullable<DiffSnapshot["edit"]>> {
    try {
      const stat = await fs.lstat(absolutePath);
      if (stat.isSymbolicLink() || !stat.isFile()) {
        return {
          supported: false,
          reason:
            "非普通文件（符号链接/目录）不支持页内编辑；请使用原生编辑器。",
        };
      }
      const bytes = await fs.readFile(absolutePath);
      if (bytes.indexOf(0) !== -1) {
        return {
          supported: false,
          reason: "二进制文件不支持页内编辑；请使用原生编辑器。",
        };
      }
      if (bytes.byteLength > MAX_EDITABLE_BYTES) {
        return {
          supported: false,
          reason: "超过 5 MB 的文件不支持页内编辑；请使用原生编辑器。",
        };
      }
      if (!analyzeUtf8(bytes).ok) {
        return {
          supported: false,
          reason: "非可靠 UTF-8 文本不支持页内编辑；请使用原生编辑器。",
        };
      }
      return { supported: true, targetId: buildDiffTargetId(absolutePath) };
    } catch {
      return {
        supported: false,
        reason: "无法读取目标文件；请使用原生编辑器。",
      };
    }
  }

  /** 清除挂起的目标切换请求（新会话、dispose 或决定后）。 */
  private clearPendingDiffOpen(): void {
    this.pendingDiffOpen = undefined;
    if (this.pendingDiffOpenTimer !== undefined) {
      clearTimeout(this.pendingDiffOpenTimer);
      this.pendingDiffOpenTimer = undefined;
    }
  }

  /**
   * 处理“脏草稿三选一”决定：save 先经 Host 安全链保存草稿，成功后打开新
   * 目标；stash 直接打开（草稿保留）；stay 取消切换。保存失败不切换，
   * diff/save-result 回发 Webview 展示拒绝原因。
   */
  private async resolveDiffTargetSwitch(
    decision: string | undefined,
    targetId: string | undefined,
    session: WorkbenchSession | undefined,
  ): Promise<void> {
    const pending = this.pendingDiffOpen;
    this.clearPendingDiffOpen();
    if (!pending) return;
    // 授权绑定：save 的 targetId 必须等于挂起确认时的 currentTargetId。
    const resolution = resolveDiffSwitchDecision(
      pending.currentTargetId,
      decision,
      targetId,
    );
    if (resolution.kind === "reject") {
      await this.sendError("diff", "切换决定被拒绝", resolution.reason, false);
      return;
    }
    if (resolution.kind === "save") {
      if (!this.diffEdit || !session) return;
      const result = await this.diffEdit.saveDraft({
        targetId: resolution.targetId,
        scope: session.scope,
        repositoryRoot: session.scope.repositoryRoot,
        probeSvnBinding: createSvnBindingProbe(session.svnPath),
      });
      if (!result.ok) {
        await this.post({
          protocolVersion: WORKBENCH_PROTOCOL_VERSION,
          type: "diff/save-result",
          moduleId: "diff",
          payload: {
            targetId: resolution.targetId,
            result,
            snapshotVersion: 0,
          },
        });
        return;
      }
    } else if (resolution.kind !== "stash") {
      // stay：保持当前文件，草稿保留。
      await this.post({
        protocolVersion: WORKBENCH_PROTOCOL_VERSION,
        type: "operation/result",
        moduleId: "diff",
        payload: {
          title: "已留在当前文件",
          message: "已取消打开新目标；当前草稿保留，可继续编辑或放弃。",
        },
      });
      return;
    }
    this.diffSwitchBypass = true;
    try {
      await this.open(pending.request);
    } finally {
      this.diffSwitchBypass = false;
    }
  }

  /** diff/open-edit：校验并签发编辑 token，回复 diff/edit-opened。 */
  private async openDiffEdit(
    session: WorkbenchSession,
    requestId?: string,
  ): Promise<void> {
    if (!this.diffEdit) {
      await this.sendError(
        "diff",
        "无法进入编辑",
        "当前窗口不支持页内编辑。",
        false,
        requestId,
      );
      return;
    }
    if (session.revisionCompare || !session.targetFile) {
      await this.sendError(
        "diff",
        "无法进入编辑",
        "修订比较保持双侧只读；请选择 Working Copy ↔ BASE 文件。",
        false,
        requestId,
      );
      return;
    }
    const absolutePath = path.resolve(session.targetFile);
    if (
      validatePathsInScope(session.scope, [absolutePath]).outOfScopeItems
        .length > 0
    ) {
      await this.sendError(
        "diff",
        "范围校验失败",
        "目标不在当前操作范围内，请重新打开差异。",
        false,
        requestId,
      );
      return;
    }
    const baseResult = await runSvnCommand(
      session.svnPath,
      ["cat", "-r", "BASE", absolutePath],
      path.dirname(absolutePath),
      { maxOutputBytes: MAX_DIFF_BYTES },
    );
    if (baseResult.exitCode !== 0) {
      await this.sendError(
        "diff",
        "无法进入编辑",
        "无法读取 BASE 内容（可能未纳入版本控制）；请使用原生编辑器。",
        true,
        requestId,
      );
      return;
    }
    const baseContents = truncateUtf8(Buffer.from(baseResult.stdout, "utf8"));
    const result = await this.diffEdit.openEdit({
      sessionId: session.sessionId,
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      targetPath: absolutePath,
      baseContents,
      baseRevision: "BASE",
      baseHash: "",
      rawHash: "",
      scope: session.scope,
      repositoryRoot: session.scope.repositoryRoot,
      probeSvnBinding: createSvnBindingProbe(session.svnPath),
    });
    if (!result.ok) {
      await this.sendError(
        "diff",
        "无法进入编辑",
        result.message,
        true,
        requestId,
      );
      return;
    }
    await this.post({
      protocolVersion: WORKBENCH_PROTOCOL_VERSION,
      type: "diff/edit-opened",
      requestId,
      moduleId: "diff",
      payload: {
        targetId: result.targetId,
        editToken: result.editToken,
        draftRevision: result.draftRevision,
        baseHash: result.baseHash,
        baseRevision: result.baseRevision,
        rawHash: result.rawHash,
        baseContents: result.baseContents,
        message: result.message,
      },
    });
    // 重新下发快照（含 edit.supported 与草稿信息）。
    await this.loadModule("diff", session.targetFile);
  }

  /** diff/save-working：消耗 token、复验、原子写入，回复 diff/save-result。 */
  private async saveWorkingDiff(
    session: WorkbenchSession,
    requestId: string | undefined,
    data: Record<string, unknown>,
  ): Promise<void> {
    if (!this.diffEdit || session.moduleId !== "diff") {
      await this.sendError(
        "diff",
        "保存失败",
        "当前窗口不支持页内保存。",
        false,
        requestId,
      );
      return;
    }
    const targetId = asString(data.targetId);
    const editToken = asString(data.editToken);
    const content = asString(data.content) ?? "";
    if (!targetId || !editToken) {
      await this.sendError(
        "diff",
        "保存失败",
        "缺少编辑令牌或目标标识。",
        false,
        requestId,
      );
      return;
    }
    const result = await this.diffEdit.saveWorking({
      sessionId: session.sessionId,
      moduleId: "diff",
      taskId: "diff/working",
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      targetId,
      editToken,
      draftRevision: asNumber(data.draftRevision) ?? 0,
      expectedContentHash: asString(data.expectedContentHash) ?? "",
      content,
      scope: session.scope,
      repositoryRoot: session.scope.repositoryRoot,
      probeSvnBinding: createSvnBindingProbe(session.svnPath),
    });
    await this.post({
      protocolVersion: WORKBENCH_PROTOCOL_VERSION,
      type: "diff/save-result",
      requestId,
      moduleId: "diff",
      payload: {
        targetId,
        result,
        snapshotVersion: result.ok ? result.snapshotVersion : 0,
      },
    });
    if (result.ok && session.targetFile) {
      // 保存成功后重载模块（权威快照刷新：modified/draft/message 以磁盘为准）。
      // 编辑器重建风险由 DiffView 编辑态挂载键保持（手动生命周期：编辑态
      // 同键快照刷新不重建实例）+ App 保持模块挂载共同消除；save-result
      // 在 Webview 按消息对象只消费一次。
      await this.loadModule("diff", session.targetFile);
    }
  }

  /** diff/draft-checkpoint：活动会话内的草稿检查点。 */
  private async checkpointDiffDraft(
    session: WorkbenchSession,
    requestId: string | undefined,
    data: Record<string, unknown>,
  ): Promise<void> {
    if (!this.diffEdit) return;
    const targetId = asString(data.targetId);
    const content = asString(data.content) ?? "";
    if (!targetId) return;
    const draft = this.diffEdit.getDraft(targetId);
    const result = this.diffEdit.checkpointDraft({
      targetId,
      sessionId: session.sessionId,
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      baseHash: draft?.baseHash ?? "",
      baseRevision: draft?.baseRevision ?? "BASE",
      baseContents: draft?.baseContents,
      diskHash: draft?.diskHash ?? "",
      targetPath: draft?.targetPath ?? "",
      content,
      baseRevisionOfClient: asNumber(data.draftRevision) ?? -1,
    });
    if (result.ok) {
      await this.post({
        protocolVersion: WORKBENCH_PROTOCOL_VERSION,
        type: "diff/draft-checkpointed",
        requestId,
        moduleId: "diff",
        payload: { targetId, draftRevision: result.draftRevision },
      });
    }
  }

  /** diff/draft-abandon：放弃当前草稿。 */
  private async abandonDiffDraft(
    session: WorkbenchSession,
    requestId: string | undefined,
    data: Record<string, unknown>,
  ): Promise<void> {
    const targetId = asString(data.targetId);
    if (!this.diffEdit || !targetId) return;
    this.diffEdit.revokeForSession(session.sessionId);
    this.diffEdit.abandonDraft(targetId);
    await this.post({
      protocolVersion: WORKBENCH_PROTOCOL_VERSION,
      type: "operation/result",
      requestId,
      moduleId: "diff",
      payload: {
        title: "草稿已放弃",
        message: "页内编辑草稿已清除，回到只读差异视图。",
      },
    });
    await this.loadModule("diff", session.targetFile);
  }

  /** diff/draft-export：导出草稿为 unified diff（剪贴板/展示）。 */
  private async exportDiffDraft(
    session: WorkbenchSession,
    requestId: string | undefined,
    data: Record<string, unknown>,
  ): Promise<void> {
    const targetId = asString(data.targetId);
    if (!this.diffEdit || !targetId) return;
    const patch = this.diffEdit.exportPatch(targetId);
    await this.post({
      protocolVersion: WORKBENCH_PROTOCOL_VERSION,
      type: "operation/result",
      requestId,
      moduleId: "diff",
      payload: {
        title: patch ? "草稿补丁已导出" : "没有可导出的草稿",
        message: patch
          ? "补丁已复制到剪贴板，可在外部审阅或人工应用。"
          : "当前目标没有草稿。",
      },
    });
    if (patch) {
      await vscode.env.clipboard.writeText(patch);
    }
  }

  private async buildHistorySnapshot(session: WorkbenchSession) {
    const revisions = await collectSvnHistory(
      session.svnPath,
      session.scope,
      100,
    );
    if (!session.historyState) {
      session.historyState = {
        selectedRevision: revisions[0]?.revision,
        compareRevisions: [],
      };
    }
    if (
      session.historyState.selectedRevision &&
      !revisions.some(
        (item) => item.revision === session.historyState!.selectedRevision,
      )
    ) {
      session.historyState.selectedRevision = revisions[0]?.revision;
    }
    return {
      kind: "history" as const,
      revisions,
      selectedRevision: session.historyState.selectedRevision,
      compareRevisions: session.historyState.compareRevisions,
      limit: 100,
      fileActionsAvailable: Boolean(getSingleFileScopeRoot(session.scope)),
      blame: session.historyState.blame,
      restorePreview: session.historyState.restorePreview
        ? {
            token: session.historyState.restorePreview.token,
            revision: session.historyState.restorePreview.revision,
            relativePath: session.historyState.restorePreview.relativePath,
            command: `svn cat -r ${session.historyState.restorePreview.revision} ${quoteRelative(session.historyState.restorePreview.relativePath)} > <working-file>`,
            canExecute: session.historyState.restorePreview.issues.length === 0,
            issues: session.historyState.restorePreview.issues,
          }
        : undefined,
      feedback: session.historyState.feedback,
    };
  }

  private async sendHistorySnapshot(
    session: WorkbenchSession,
    requestId?: string,
  ): Promise<void> {
    const snapshot = await this.buildHistorySnapshot(session);
    await this.post({
      protocolVersion: WORKBENCH_PROTOCOL_VERSION,
      type: "module/snapshot",
      requestId,
      moduleId: "history",
      payload: { snapshot },
    });
  }

  private async buildConflictSnapshot(
    session: WorkbenchSession,
    providedConflicts?: Awaited<ReturnType<typeof collectConflictItems>>,
    providedPreview?: ReturnType<typeof buildResolveConflictPreview>,
  ) {
    const conflicts =
      providedConflicts ??
      (await collectConflictItems(session.svnPath, session.scope));
    if (!session.conflictState) {
      session.conflictState = { selectedPath: conflicts[0]?.relativePath };
    }
    if (
      session.conflictState.selectedPath &&
      !conflicts.some(
        (item) => item.relativePath === session.conflictState!.selectedPath,
      )
    ) {
      session.conflictState = { selectedPath: conflicts[0]?.relativePath };
    }
    const selected = conflicts.find(
      (item) => item.relativePath === session.conflictState?.selectedPath,
    );
    const request = selected
      ? await buildConflictAiRequest(selected)
      : undefined;
    if (
      selected &&
      (!session.conflictState?.editState ||
        session.conflictState.editState.relativePath !== selected.relativePath)
    ) {
      session.conflictState = {
        ...session.conflictState,
        editState: {
          token: randomUUID(),
          contentHash: await hashFileContents(selected.workingFile),
          relativePath: selected.relativePath,
        },
      };
    }
    const previewState = session.conflictState?.resolvePreview;
    const preview =
      selected && previewState?.relativePath === selected.relativePath
        ? (providedPreview ??
          buildResolveConflictPreview(session.scope, selected.workingFile))
        : undefined;

    return {
      kind: "conflicts" as const,
      conflicts: conflicts.map((item) => ({
        relativePath: item.relativePath,
        operation: item.operation,
        type: item.type,
        sourceLeftRevision: item.sourceLeftRevision,
        sourceRightRevision: item.sourceRightRevision,
      })),
      selected:
        selected && request
          ? {
              relativePath: selected.relativePath,
              operation: selected.operation,
              type: selected.type,
              sourceLeftRevision: selected.sourceLeftRevision,
              sourceRightRevision: selected.sourceRightRevision,
              contents: {
                base: toConflictContentView(request.contents.base),
                mine: toConflictContentView(request.contents.mine),
                theirs: toConflictContentView(request.contents.theirs),
                working: toConflictContentView(request.contents.working),
              },
              mergeEditor: {
                token: session.conflictState!.editState!.token,
                editable:
                  !request.contents.working?.truncated &&
                  !request.contents.working?.readError,
                issues: request.contents.working?.truncated
                  ? ["工作副本内容超过 5 MB，内嵌编辑已禁用。"]
                  : request.contents.working?.readError
                    ? [request.contents.working.readError]
                    : [],
                feedback: session.conflictState!.editState!.feedback,
              },
            }
          : undefined,
      advice: session.conflictState?.advice,
      aiPrivacy: request
        ? {
            model:
              session.aiModels.conflictAdvice || "本地规则（未配置外部模型）",
            characters: Object.values(request.contents).reduce(
              (sum, item) => sum + (item?.content?.length ?? 0),
              0,
            ),
            maxCharacters: 32_000,
            data: "基础版本、我的版本、对方版本和工作副本的截断文本与修订元数据",
            historyIncluded: false as const,
          }
        : undefined,
      resolvePreview:
        preview && previewState
          ? {
              token: previewState.token,
              relativePath: previewState.relativePath,
              command: `svn resolve --accept working "${previewState.relativePath.replace(/"/g, '\\"')}"`,
              canResolve: preview.canResolve,
              issues: preview.issues,
            }
          : undefined,
    };
  }

  private async sendConflictSnapshot(
    session: WorkbenchSession,
    requestId?: string,
    conflicts?: Awaited<ReturnType<typeof collectConflictItems>>,
    preview?: ReturnType<typeof buildResolveConflictPreview>,
  ): Promise<void> {
    const snapshot = await this.buildConflictSnapshot(
      session,
      conflicts,
      preview,
    );
    await this.post({
      protocolVersion: WORKBENCH_PROTOCOL_VERSION,
      type: "module/snapshot",
      requestId,
      moduleId: "conflicts",
      payload: { snapshot },
    });
  }

  private ensureSettingsState(
    session: WorkbenchSession,
  ): NonNullable<WorkbenchSession["settingsState"]> {
    if (!session.settingsState) {
      session.settingsState = { models: [] };
    }
    return session.settingsState;
  }

  private async buildSettingsSnapshot(
    session: WorkbenchSession,
  ): Promise<SettingsSnapshot> {
    const state = this.ensureSettingsState(session);
    const stored = await readStoredAiConfiguration(this.context);
    const teamState = await readCommitConventionEditState(
      session.scope.repositoryRoot,
    );
    const team = state.recommendedTeamConfig ?? teamState.config;
    const memory = readTeamMemory(
      this.context.workspaceState,
      session.repositoryUuid,
    );
    // 提交选择规则段：有效规则经统一服务解析（缓存），预览候选经统一入口采集；
    // 采集失败只降级预览区，不阻断整个设置模块（无仓库/无候选/损坏配置均有结构化状态）。
    const resolvedSelectionRules =
      await this.commitSelectionRuleService.getEffectiveRules(
        session.scope.repositoryRoot,
      );
    let selectionCandidates: CommitCandidate[] | undefined;
    let selectionPreviewError: string | undefined;
    try {
      selectionCandidates = await this.collectScopeCandidates(session);
    } catch (error) {
      selectionPreviewError = `无法采集当前仓库候选文件：${errorMessage(error)}`;
    }
    return {
      kind: "settings",
      svnSecurity: {
        authenticationActive: Boolean(session.security.authentication),
        hasStoredAuthentication: session.security.hasStoredAuthentication,
        passwordTransport: "stdin",
        certificateTrust: "explicit-svn-cache",
      },
      ai: {
        presets: AI_PROVIDER_PRESETS,
        scenarios: AI_USAGE_SCENARIOS,
        providerPreset: stored.providerPreset,
        baseUrl: stored.baseUrl,
        model: stored.model,
        scenarioModels: { ...stored.scenarioModels },
        hasApiKey: stored.hasSecretApiKey || stored.hasLegacyApiKey,
        includeCommitHistory: stored.includeCommitHistory,
        historyLimit: stored.historyLimit,
        models: state.models,
        feedback: state.aiFeedback,
      },
      team: {
        configPath: normalizeRelative(
          path.relative(session.scope.repositoryRoot, teamState.configPath),
        ),
        enabled: team.enabled,
        requiredIssueId: team.requiredIssueId,
        issueIdPattern: team.issueIdPattern,
        requiredModule: team.requiredModule,
        allowedModulesText: formatCommitConventionList(team.allowedModules),
        requiredPrefix: team.requiredPrefix,
        allowedPrefixesText: formatCommitConventionList(team.allowedPrefixes),
        warnings: teamState.warnings,
        memory: {
          source: memory.source,
          count: memory.entries.length,
          maxEntries: memory.maxEntries,
          externallyShared: memory.externallyShared,
          recent: memory.entries
            .slice(0, 5)
            .map(({ revision, summary, recordedAt }) => ({
              revision,
              summary,
              recordedAt,
            })),
        },
        recommendation: state.recommendation,
      },
      selection: buildCommitSelectionSettingsSection({
        resolved: resolvedSelectionRules,
        candidates: selectionCandidates,
        previewError: selectionPreviewError,
        feedback: state.selectionFeedback,
        saveErrors: state.selectionSaveErrors,
      }),
    };
  }

  private async sendSettingsSnapshot(
    session: WorkbenchSession,
    requestId?: string,
  ): Promise<void> {
    const snapshot = await this.buildSettingsSnapshot(session);
    await this.post({
      protocolVersion: WORKBENCH_PROTOCOL_VERSION,
      type: "module/snapshot",
      requestId,
      moduleId: "settings",
      payload: { snapshot },
    });
  }

  private async updateSettingsFeedback(
    session: WorkbenchSession,
    tone: "success" | "warning" | "error",
    message: string,
    requestId?: string,
  ): Promise<void> {
    this.ensureSettingsState(session).aiFeedback = { tone, message };
    await this.sendSettingsSnapshot(session, requestId);
  }

  private async createAiProviderFromAction(
    data: Record<string, unknown>,
  ): Promise<OpenAiCompatibleProvider> {
    const baseUrl = normalizeAiBaseUrl(asStringAllowEmpty(data.baseUrl) ?? "");
    const model = (asStringAllowEmpty(data.model) ?? "").trim();
    const enteredKey = (asStringAllowEmpty(data.apiKey) ?? "").trim();
    const secret = await this.context.secrets.get(AI_API_KEY_SECRET_KEY);
    const legacy =
      vscode.workspace
        .getConfiguration("svnWorkbench.ai")
        .get<string>("apiKey") ?? "";
    const config = { baseUrl, model, apiKey: enteredKey || secret || legacy };
    const validation = validateAiProviderConfig(config);
    if (!validation.valid) {
      throw new Error(validation.issues.join(" "));
    }
    return new OpenAiCompatibleProvider(config);
  }

  private async resolveStoredAiProvider(scenario: AiUsageScenario) {
    const stored = await readStoredAiConfiguration(this.context);
    const apiKey =
      (await this.context.secrets.get(AI_API_KEY_SECRET_KEY)) ||
      vscode.workspace
        .getConfiguration("svnWorkbench.ai")
        .get<string>("apiKey") ||
      "";
    const model = stored.scenarioModels[scenario] || stored.model;
    const config = {
      baseUrl: normalizeAiBaseUrl(stored.baseUrl),
      model,
      apiKey,
    };
    const validation = validateAiProviderConfig(config);
    if (!validation.valid) {
      throw new Error(validation.issues.join(" "));
    }
    return config;
  }

  private async runAiScenario<T>(
    scenario: AiUsageScenario,
    fallback: T,
    run: (provider: OpenAiCompatibleProvider) => Promise<T>,
  ): Promise<{
    result: T;
    source: "configured-model" | "local-rule-fallback";
    fallbackReason?: string;
  }> {
    try {
      const config = await this.resolveStoredAiProvider(scenario);
      return {
        result: await run(new OpenAiCompatibleProvider(config)),
        source: "configured-model",
      };
    } catch (error) {
      return {
        result: fallback,
        source: "local-rule-fallback",
        fallbackReason: errorMessage(error),
      };
    }
  }

  private async configureAuthentication(
    session: WorkbenchSession,
    requestId?: string,
  ): Promise<void> {
    const username = await vscode.window.showInputBox({
      title: "SVN 认证",
      prompt:
        "用户名只保存在当前会话或 VS Code SecretStorage，不写入 settings。",
      value: session.security.authentication?.username ?? "",
      ignoreFocusOut: true,
      validateInput: (value) =>
        value.trim() ? undefined : "请输入 SVN 用户名。",
    });
    if (username === undefined) return;

    const password = await vscode.window.showInputBox({
      title: "SVN 认证",
      prompt:
        "密码通过标准输入交给 SVN，不进入命令行参数、Webview 快照或日志。",
      password: true,
      ignoreFocusOut: true,
      validateInput: (value) => (value ? undefined : "请输入 SVN 密码。"),
    });
    if (password === undefined) return;

    const storage = await vscode.window.showQuickPick(
      [
        {
          label: "仅本次工作台会话",
          description: "关闭工作台或切换仓库后清除。",
          id: "session" as const,
        },
        {
          label: "安全保存到系统凭据存储",
          description: "通过 VS Code SecretStorage 保存，可随时清除。",
          id: "secret" as const,
        },
      ],
      {
        title: "凭据保存方式",
        placeHolder: "选择凭据生命周期",
        ignoreFocusOut: true,
      },
    );
    if (!storage) return;

    session.security.authentication = { username: username.trim(), password };
    session.security.hasStoredAuthentication = storage.id === "secret";
    if (storage.id === "secret") {
      await storeSvnCredential(
        this.context.secrets,
        session.repositoryUuid,
        session.security.authentication,
      );
    } else {
      await deleteStoredSvnCredential(
        this.context.secrets,
        session.repositoryUuid,
      );
    }
    this.syncSvnSecurityContext(session);
    await this.loadModule(session.moduleId, session.targetFile, requestId);
    await this.post({
      protocolVersion: WORKBENCH_PROTOCOL_VERSION,
      type: "operation/result",
      requestId,
      moduleId: session.moduleId,
      payload: {
        title: "认证凭据已更新",
        message:
          storage.id === "secret"
            ? "凭据已保存到 VS Code SecretStorage；请重新执行原操作。"
            : "凭据仅在当前工作台会话中有效；请重新执行原操作。",
      },
    });
  }

  private async clearAuthentication(
    session: WorkbenchSession,
    requestId?: string,
  ): Promise<void> {
    await deleteStoredSvnCredential(
      this.context.secrets,
      session.repositoryUuid,
    );
    session.security.authentication = undefined;
    session.security.hasStoredAuthentication = false;
    this.clearSecurityAuthentication(session.scope.repositoryRoot);
    await this.post({
      protocolVersion: WORKBENCH_PROTOCOL_VERSION,
      type: "operation/result",
      requestId,
      moduleId: session.moduleId,
      payload: {
        title: "SVN 凭据已清除",
        message: "当前会话和 VS Code SecretStorage 中的仓库凭据均已移除。",
      },
    });
  }

  private async reviewCertificate(
    session: WorkbenchSession,
    requestId?: string,
  ): Promise<void> {
    const certificate = session.security.lastCertificate;
    if (!certificate?.host || !certificate.fingerprint) {
      await this.sendError(
        session.moduleId,
        "无法安全信任证书",
        "SVN 输出中缺少服务器主机或 SHA-256 指纹。请通过管理员提供的可信渠道核对证书，不允许盲目信任。",
        false,
        requestId,
      );
      return;
    }

    const detail = [
      `服务器：${certificate.host}`,
      `SHA-256 指纹：${certificate.fingerprint}`,
      certificate.issuer ? `颁发者：${certificate.issuer}` : undefined,
      certificate.validFrom || certificate.validUntil
        ? `有效期：${certificate.validFrom ?? "?"} → ${certificate.validUntil ?? "?"}`
        : undefined,
      `失败类型：${certificate.failures.join("、")}`,
      "",
      "请通过仓库管理员或其他可信渠道核对指纹。错误的信任决定可能把凭据交给冒充服务器。",
    ]
      .filter((item): item is string => item !== undefined)
      .join("\n");
    const choice = await vscode.window.showWarningMessage(
      "核对 SVN 服务器证书",
      { modal: true, detail },
      "仅本次信任",
      "永久信任（由 SVN 缓存）",
    );
    if (!choice) return;

    const scope = choice.startsWith("永久")
      ? ("permanent" as const)
      : ("once" as const);
    if (scope === "permanent") {
      const confirmed = await vscode.window.showWarningMessage(
        `永久信任 ${certificate.host} 的当前证书？`,
        {
          modal: true,
          detail: `确认 SHA-256 指纹：${certificate.fingerprint}\nSVN 将保存这次信任；证书变化后应重新核对。`,
        },
        "确认永久信任",
      );
      if (!confirmed) return;
    }

    session.security.certificateTrust = {
      host: certificate.host,
      fingerprint: certificate.fingerprint,
      failures: certificate.failures,
      scope,
    };
    this.syncSvnSecurityContext(session);
    try {
      await this.loadModule(session.moduleId, session.targetFile, requestId);
    } finally {
      session.security.certificateTrust = undefined;
      this.clearSecurityCertificateTrust(session.scope.repositoryRoot);
    }
    await this.post({
      protocolVersion: WORKBENCH_PROTOCOL_VERSION,
      type: "operation/result",
      requestId,
      moduleId: session.moduleId,
      payload: {
        title:
          scope === "permanent"
            ? "证书信任已交给 SVN 缓存"
            : "本次证书信任已使用",
        message: "请确认模块已正常重新加载，再重新生成原写操作的预览。",
      },
    });
  }

  private syncSvnSecurityContext(session: WorkbenchSession): void {
    if (this.securityRegistry) {
      // 合并语义：未提供的字段保留仓库既有值，不覆盖其他窗口的凭据。
      this.securityRegistry.sync(session.scope.repositoryRoot, {
        authentication: session.security.authentication,
        certificateTrust: session.security.certificateTrust,
      });
      return;
    }
    setSvnSecurityContext(session.scope.repositoryRoot, {
      authentication: session.security.authentication,
      certificateTrust: session.security.certificateTrust,
    });
  }

  /** 显式清除认证：经注册表广播失效事件；未接线时回退到模块级直接清除。 */
  private clearSecurityAuthentication(repositoryRoot: string): void {
    if (this.securityRegistry) {
      this.securityRegistry.clearAuthentication(repositoryRoot);
      return;
    }
    clearSvnSecurityContext(repositoryRoot);
  }

  /** 临时证书信任结束：只清除证书信任，保留认证；未接线时回退到模块级。 */
  private clearSecurityCertificateTrust(repositoryRoot: string): void {
    if (this.securityRegistry) {
      this.securityRegistry.clearCertificateTrust(repositoryRoot);
      return;
    }
    const existing = resolveSvnSecurityContext(repositoryRoot);
    setSvnSecurityContext(repositoryRoot, {
      authentication: existing?.authentication,
    });
  }

  private async buildDiagnosticsSnapshot(): Promise<DiagnosticsSnapshot> {
    const executable = await resolveSvnExecutable();
    const stored = await readStoredAiConfiguration(this.context);
    const workspaces = await Promise.all(
      (vscode.workspace.workspaceFolders ?? []).map(async (folder) => {
        const isSvnWorkingCopy = await Promise.resolve(
          vscode.workspace.fs.stat(vscode.Uri.joinPath(folder.uri, ".svn")),
        )
          .then(() => true)
          .catch(() => false);
        return { name: folder.name, path: folder.uri.fsPath, isSvnWorkingCopy };
      }),
    );
    const report = buildEnvironmentDiagnosticReport({
      platform: process.platform,
      arch: process.arch,
      vscodeVersion: vscode.version,
      configuredSvnPath: vscode.workspace
        .getConfiguration("svnWorkbench")
        .get<string | null>("svn.path"),
      svnExecutable: executable,
      workspaces,
      ai: {
        providerPreset: stored.providerPreset,
        baseUrl: stored.baseUrl,
        model: stored.model,
        hasApiKey: stored.hasSecretApiKey || stored.hasLegacyApiKey,
      },
    });
    const reportText = `${formatEnvironmentDiagnosticReport(report)}\n\n${formatAcceptanceChecklistMarkdown()}`;
    appendOutput(formatEnvironmentDiagnosticReport(report));
    return {
      kind: "diagnostics",
      status: report.status,
      checks: report.checks,
      acceptance: {
        summary: summarizeAcceptanceChecklist(),
        sections: acceptanceChecklistSections,
      },
      generatedAt: new Date().toISOString(),
      reportText,
    };
  }

  private async sendDiagnosticsSnapshot(
    session: WorkbenchSession,
    requestId?: string,
  ): Promise<void> {
    const snapshot = await this.buildDiagnosticsSnapshot();
    await this.post({
      protocolVersion: WORKBENCH_PROTOCOL_VERSION,
      type: "module/snapshot",
      requestId,
      moduleId: "diagnostics",
      payload: { snapshot },
    });
  }
  private async buildRepositorySnapshot(session: WorkbenchSession) {
    return this.repositoryActions.buildRepositorySnapshot(session);
  }

  private ensureAdvancedRepositoryState(session: WorkbenchSession) {
    return this.repositoryActions.ensureAdvancedRepositoryState(session);
  }

  private async browseRepository(
    session: WorkbenchSession,
    requestedUrl: string | undefined,
    requestId?: string,
  ): Promise<void> {
    await this.repositoryActions.browseRepository(
      session,
      requestedUrl,
      requestId,
    );
  }

  private async previewAdvancedRepositoryOperation(
    session: WorkbenchSession,
    data: Record<string, unknown>,
    requestId?: string,
  ): Promise<void> {
    await this.repositoryActions.previewAdvancedRepositoryOperation(
      session,
      data,
      requestId,
    );
  }

  private async selectPatchForPreview(
    session: WorkbenchSession,
    requestId?: string,
  ): Promise<void> {
    await this.repositoryActions.selectPatchForPreview(session, requestId);
  }

  private async executeAdvancedRepositoryOperation(
    session: WorkbenchSession,
    previewToken: string | undefined,
    requestId?: string,
  ): Promise<void> {
    await this.repositoryActions.executeAdvancedRepositoryOperation(
      session,
      previewToken,
      requestId,
    );
  }

  private async createLocalShelf(
    session: WorkbenchSession,
    candidates: Awaited<ReturnType<typeof collectCommitCandidates>>,
    shelfName: string,
    signal: AbortSignal,
  ): Promise<string> {
    return this.repositoryActions.createLocalShelf(
      session,
      candidates,
      shelfName,
      signal,
    );
  }

  private async exportScopePatch(
    session: WorkbenchSession,
    requestId?: string,
  ): Promise<void> {
    await this.repositoryActions.exportScopePatch(session, requestId);
  }

  private async generateReleaseNotes(
    session: WorkbenchSession,
    fromRevision: string | undefined,
    toRevision: string | undefined,
    requestId?: string,
  ): Promise<void> {
    await this.repositoryActions.generateReleaseNotes(
      session,
      fromRevision,
      toRevision,
      requestId,
    );
  }

  private async sendRepositorySnapshot(
    session: WorkbenchSession,
    requestId?: string,
  ): Promise<void> {
    await this.repositoryActions.sendRepositorySnapshot(session, requestId);
  }

  private async createUpdatePreview(
    session: WorkbenchSession,
    requestId?: string,
  ): Promise<void> {
    await this.repositoryActions.createUpdatePreview(session, requestId);
  }

  private async sendAiReviewSnapshot(
    session: WorkbenchSession,
    requestId?: string,
  ): Promise<void> {
    const candidates = await this.collectScopeCandidates(session);
    const snapshot = await buildLocalChangeReview(candidates);
    await this.post({
      protocolVersion: WORKBENCH_PROTOCOL_VERSION,
      type: "module/snapshot",
      requestId,
      moduleId: "ai-review",
      payload: { snapshot },
    });
  }

  private async sendImpactSnapshot(
    session: WorkbenchSession,
    requestId?: string,
  ): Promise<void> {
    const candidates = await this.collectScopeCandidates(session);
    const snapshot = buildLocalImpactAnalysis(candidates);
    await this.post({
      protocolVersion: WORKBENCH_PROTOCOL_VERSION,
      type: "module/snapshot",
      requestId,
      moduleId: "impact",
      payload: { snapshot },
    });
  }

  private async buildChangelistsSnapshot(
    session: WorkbenchSession,
    providedCandidates?: Awaited<ReturnType<typeof collectCommitCandidates>>,
    previewIssues?: string[],
  ) {
    const candidates =
      providedCandidates ?? (await this.collectScopeCandidates(session));
    const groups = await collectSvnChangelists(session.svnPath, session.scope);
    const assigned = new Set(groups.flatMap((group) => group.paths));
    const state = session.changelistState ?? {
      suggestions: [],
      warnings: [],
      source: "local-rule" as const,
    };
    session.changelistState = state;
    const preview = state.preview;
    return {
      kind: "changelists" as const,
      aiPrivacy: {
        model: session.aiModels.commitSplit || "本地规则（未配置外部模型）",
        fileLimit: 120,
        data: "文件相对路径、状态、类型和模块分组；不发送文件正文",
        historyIncluded: false as const,
      },
      groups,
      unassigned: candidates
        .filter((item) => !assigned.has(item.relativePath))
        .map((candidate) => ({
          relativePath: candidate.relativePath,
          status: candidate.status,
          propStatus: candidate.propStatus,
          fileType: candidate.fileType,
          selection: candidate.selection,
          reason: candidate.reason,
        })),
      suggestions: state.suggestions,
      warnings: state.warnings,
      source: state.source,
      fallbackReason: state.fallbackReason,
      preview: preview
        ? {
            token: preview.token,
            name: preview.name,
            remove: preview.remove,
            paths: preview.paths,
            command: preview.remove
              ? `svn changelist --remove ${preview.paths.map(quoteRelative).join(" ")}`
              : `svn changelist "${(preview.name ?? "").replace(/"/g, '\\"')}" ${preview.paths.map(quoteRelative).join(" ")}`,
            canExecute: (previewIssues ?? preview.issues).length === 0,
            issues: previewIssues ?? preview.issues,
          }
        : undefined,
      feedback: state.feedback,
    };
  }

  private async sendChangelistsSnapshot(
    session: WorkbenchSession,
    requestId?: string,
    candidates?: Awaited<ReturnType<typeof collectCommitCandidates>>,
    previewIssues?: string[],
  ): Promise<void> {
    const snapshot = await this.buildChangelistsSnapshot(
      session,
      candidates,
      previewIssues,
    );
    await this.post({
      protocolVersion: WORKBENCH_PROTOCOL_VERSION,
      type: "module/snapshot",
      requestId,
      moduleId: "changelists",
      payload: { snapshot },
    });
  }

  private async sendAgentSnapshot(
    session: WorkbenchSession,
    requestId?: string,
  ): Promise<void> {
    const snapshot = session.agentState?.snapshot ?? emptyAgentSnapshot();
    await this.post({
      protocolVersion: WORKBENCH_PROTOCOL_VERSION,
      type: "module/snapshot",
      requestId,
      moduleId: "agent",
      payload: { snapshot },
    });
  }

  private async sendChangesSnapshot(
    session: WorkbenchSession,
    requestId?: string,
    providedCandidates?: Awaited<ReturnType<typeof collectCommitCandidates>>,
  ): Promise<void> {
    const candidates =
      providedCandidates ?? (await this.collectScopeCandidates(session));
    const summary = summarizeCommitCandidates(candidates);
    const preview = session.changesState?.preview;
    const snapshot: import("../../protocol/workbenchProtocol").ChangesSnapshot =
      {
        kind: "changes",
        commitDraft: this.ensureCommitState(session).message,
        files: await buildWorkbenchFileViews(
          candidates,
          session.scopeView.repositoryName,
        ),
        summary: summary.statuses,
        refreshedAt: new Date().toISOString(),
        operationPreview: preview
          ? {
              token: preview.token,
              operation: preview.operation,
              paths: preview.paths,
              ignoreMode: preview.ignoreMode,
              command: formatFileOperationCommand(
                preview.operation,
                preview.paths,
                preview.ignoreMode,
              ),
              consequences: fileOperationConsequences(
                preview.operation,
                preview.ignoreMode,
              ),
              destructive:
                preview.operation === "revert" ||
                preview.operation === "remove",
              recoverability: fileOperationRecoverability(preview.operation),
              canExecute: preview.issues.length === 0,
              issues: preview.issues,
            }
          : undefined,
        feedback: session.changesState?.feedback,
      };
    await this.post({
      protocolVersion: WORKBENCH_PROTOCOL_VERSION,
      type: "module/snapshot",
      requestId,
      moduleId: "changes",
      payload: { snapshot },
    });
  }

  private async prepareInitialFileOperation(
    session: WorkbenchSession,
  ): Promise<void> {
    const initial = session.initialFileOperation;
    if (!initial) return;
    session.initialFileOperation = undefined;
    const candidates = await this.collectScopeCandidates(session);
    const paths = candidates.map((candidate) => candidate.relativePath);
    const issues = validateFileOperation(
      candidates,
      initial.operation,
      paths,
      session.scope,
      initial.ignoreMode,
    );
    session.changesState = {
      preview: {
        token: randomUUID(),
        candidateHash: hashCandidateState(candidates, "", []),
        operation: initial.operation,
        ignoreMode:
          initial.operation === "ignore"
            ? (initial.ignoreMode ?? "directory")
            : undefined,
        paths,
        issues,
      },
    };
    await this.sendChangesSnapshot(session, undefined, candidates);
  }

  private ensureCommitState(session: WorkbenchSession): CommitSessionState {
    if (!session.commitState) {
      session.commitState = {
        message: "",
        selectedPaths: session.selectedPaths,
      };
    }
    return session.commitState;
  }

  private async buildCommitSnapshot(
    session: WorkbenchSession,
    providedCandidates?: Awaited<ReturnType<typeof collectCommitCandidates>>,
  ): Promise<CommitSnapshot> {
    const state = this.ensureCommitState(session);
    const candidates =
      providedCandidates ?? (await this.collectScopeCandidates(session));
    const summary = summarizeCommitCandidates(candidates);
    if (!state.selectedPaths) {
      state.selectedPaths = candidates
        .filter((candidate) => candidate.selection === "selected")
        .map((candidate) => candidate.relativePath);
    }
    const candidatePaths = new Set(
      candidates.map((candidate) => candidate.relativePath),
    );
    state.selectedPaths = state.selectedPaths.filter((relativePath) =>
      candidatePaths.has(relativePath),
    );

    const convention = await resolveCommitConventionConfig(
      session.scope.repositoryRoot,
    );
    const storedAi = await readStoredAiConfiguration(this.context);
    const memoryCount = storedAi.includeCommitHistory
      ? Math.min(
          storedAi.historyLimit,
          readTeamMemory(this.context.workspaceState, session.repositoryUuid)
            .entries.length,
        )
      : 0;
    const messageIssues = [
      ...validateCommitMessage(state.message).issues,
      ...validateCommitMessageConvention(state.message, convention.config)
        .issues,
    ];

    // 提交文件选择场景的 AI 配置状态（规划 4.2）：仅在配置了有效模型
    // （Base URL + 模型 + 密钥）时提交页才提供“获取 AI 建议”。
    const selectionModel = (
      storedAi.scenarioModels.commitSelection ||
      storedAi.model ||
      ""
    ).trim();
    const selectionAiConfigured = validateAiProviderConfig({
      baseUrl: normalizeAiBaseUrl(storedAi.baseUrl),
      model: selectionModel,
      apiKey:
        storedAi.hasSecretApiKey || storedAi.hasLegacyApiKey ? "stored" : "",
    }).valid;

    // AI 结果过期判定（规划 6.3）：binding 与当前范围/候选哈希不匹配时
    // 标记 stale，只能查看或重新生成，不能直接采用。
    let ai = state.ai;
    if (
      ai?.binding &&
      (ai.binding.scopeHash !== session.scopeHash ||
        ai.binding.candidateHash !== hashCandidateState(candidates, "", []))
    ) {
      ai = { ...ai, stale: true };
    }

    // 一次性反馈（应用本地规则结果、规则更新提示）：随本次快照下发后清除。
    const feedback = state.feedback;
    state.feedback = undefined;

    return {
      kind: "commit",
      files: candidates.map((candidate) => ({
        relativePath: candidate.relativePath,
        status: candidate.status,
        propStatus: candidate.propStatus,
        fileType: candidate.fileType,
        selection: candidate.selection,
        reason: candidate.reason,
        evaluation: candidate.evaluation,
      })),
      summary: {
        total: summary.total,
        selected: summary.selected,
        needsReview: summary.needsReview,
        excluded: summary.excluded,
        blocked: summary.blocked,
      },
      selectedPaths: state.selectedPaths,
      message: state.message,
      messageIssues,
      conventionHint: convention.config.enabled
        ? `前缀：${convention.config.allowedPrefixes.join(", ")}；模块：${convention.config.allowedModules.join(", ")}`
        : "",
      templates: defaultCommitMessageTemplates,
      preview: state.preview?.view,
      selectionAi: {
        configured: selectionAiConfigured,
        model: selectionModel || undefined,
      },
      feedback,
      ai,
      aiPrivacy: [
        {
          scenario: "selection",
          model:
            session.aiModels.commitSelection || "本地规则（未配置外部模型）",
          fileLimit: 200,
          data: "文件相对路径、SVN 状态、文件类型和规则判断；不发送文件正文",
          historyIncluded: false,
        },
        {
          scenario: "message",
          model: session.aiModels.commitMessage || "本地规则（未配置外部模型）",
          fileLimit: 80,
          data: "已选文件元数据与增删行统计；不发送文件正文",
          historyIncluded: storedAi.includeCommitHistory,
          historyCount: memoryCount,
        },
      ],
    };
  }

  private async sendCommitSnapshot(
    session: WorkbenchSession,
    requestId?: string,
    candidates?: Awaited<ReturnType<typeof collectCommitCandidates>>,
  ): Promise<void> {
    session.moduleId = "commit";
    session.taskId = defaultWorkbenchTask("commit");
    const snapshot = await this.buildCommitSnapshot(session, candidates);
    await this.post({
      protocolVersion: WORKBENCH_PROTOCOL_VERSION,
      type: "module/snapshot",
      requestId,
      moduleId: "commit",
      payload: { snapshot },
    });
  }

  private resolveSelectedAbsolutePaths(
    session: WorkbenchSession,
    candidates: Awaited<ReturnType<typeof collectCommitCandidates>>,
  ): string[] {
    const state = this.ensureCommitState(session);
    const selected = new Set(state.selectedPaths ?? []);
    return candidates
      .filter((candidate) => selected.has(candidate.relativePath))
      .map((candidate) => candidate.absolutePath);
  }

  private async createCommitPreview(
    session: WorkbenchSession,
    requestId?: string,
  ): Promise<void> {
    const state = this.ensureCommitState(session);
    const candidates = await this.collectScopeCandidates(session);
    const selectedAbsolutePaths = this.resolveSelectedAbsolutePaths(
      session,
      candidates,
    );
    const plan = buildCommitPlanPreview(
      session.scope,
      candidates,
      selectedAbsolutePaths,
    );
    const convention = await resolveCommitConventionConfig(
      session.scope.repositoryRoot,
    );
    const issues = [
      ...validateCommitMessage(state.message).issues,
      ...validateCommitMessageConvention(state.message, convention.config)
        .issues,
      ...plan.issues.map((issue) =>
        issue.path
          ? `${normalizeRelative(path.relative(session.scope.repositoryRoot, issue.path))}：${issue.reason}`
          : issue.reason,
      ),
    ];

    let checkedRevision: string | undefined;
    let outOfDatePaths: string[] = [];
    if (plan.commitPaths.length > 0) {
      try {
        const remote = await checkPreCommitRemoteUpdates(
          session.svnPath,
          session.scope,
          plan.commitPaths,
        );
        checkedRevision = remote.checkedRevision;
        outOfDatePaths = remote.outOfDateItems.map((item) => item.relativePath);
        if (outOfDatePaths.length > 0) {
          issues.push(
            `远端有 ${outOfDatePaths.length} 个相关更新，请先更新并重新预检。`,
          );
        }
      } catch (error) {
        issues.push(
          `远端检查失败：${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const token = randomUUID();
    const stateHash = hashCandidateState(
      candidates,
      state.message,
      state.selectedPaths ?? [],
    );
    const view: CommitPlanView = {
      token,
      canExecute: plan.canCommit && issues.length === 0,
      selectedPaths: plan.commitPaths.map((item) =>
        normalizeRelative(path.relative(session.scope.repositoryRoot, item)),
      ),
      addPaths: plan.addPaths.map((item) =>
        normalizeRelative(path.relative(session.scope.repositoryRoot, item)),
      ),
      removePaths: plan.removePaths.map((item) =>
        normalizeRelative(path.relative(session.scope.repositoryRoot, item)),
      ),
      commands: buildRelativeCommitCommands(session.scope.repositoryRoot, plan),
      issues,
      remoteRevision: checkedRevision,
      outOfDatePaths,
      createdAt: new Date().toISOString(),
    };
    state.preview = { token, stateHash, plan, view };
    await this.sendCommitSnapshot(session, requestId, candidates);
  }

  private async executeCommit(
    session: WorkbenchSession,
    previewToken: string | undefined,
    requestId?: string,
  ): Promise<void> {
    const state = this.ensureCommitState(session);
    const preview = state.preview;
    if (
      !previewToken ||
      !preview ||
      preview.token !== previewToken ||
      !preview.view.canExecute
    ) {
      await this.sendError(
        "commit",
        "提交预览已失效",
        "请重新生成提交预览后再执行。",
        true,
        requestId,
      );
      return;
    }

    const candidates = await this.collectScopeCandidates(session);
    const stateHash = hashCandidateState(
      candidates,
      state.message,
      state.selectedPaths ?? [],
    );
    if (stateHash !== preview.stateHash) {
      state.preview = undefined;
      await this.sendError(
        "commit",
        "工作副本已变化",
        "文件状态、范围或提交说明已变化，请重新预检。",
        true,
        requestId,
      );
      return;
    }

    const remote = await checkPreCommitRemoteUpdates(
      session.svnPath,
      session.scope,
      preview.plan.commitPaths,
    );
    if (remote.outOfDateItems.length > 0) {
      state.preview = undefined;
      await this.sendError(
        "commit",
        "远端状态已变化",
        "检测到远端更新，请先更新并重新预检。",
        true,
        requestId,
      );
      return;
    }

    await this.post({
      protocolVersion: WORKBENCH_PROTOCOL_VERSION,
      type: "operation/progress",
      requestId,
      moduleId: "commit",
      payload: {
        title: "正在提交",
        message: `${preview.plan.commitPaths.length} 个文件`,
        cancellable: true,
      },
    });
    const controller = new AbortController();
    session.activeOperation = { moduleId: "commit", controller };
    let result: Awaited<ReturnType<typeof runCommitFlow>>;
    try {
      result = await runCommitFlow(
        session.svnPath,
        toCommitFlowPlan(preview.plan, state.message),
        { signal: controller.signal },
      );
    } catch (error) {
      if (controller.signal.aborted) {
        state.preview = undefined;
        await this.post({
          protocolVersion: WORKBENCH_PROTOCOL_VERSION,
          type: "operation/cancelled",
          requestId,
          moduleId: "commit",
          payload: {
            title: "提交已取消",
            message:
              "SVN 进程已停止；可能已完成部分 add/remove，状态已重新采集。",
          },
        });
        await this.sendCommitSnapshot(session, requestId);
        return;
      }
      throw error;
    } finally {
      if (session.activeOperation?.controller === controller)
        session.activeOperation = undefined;
    }
    if (result.commitResult.cancelled) {
      state.preview = undefined;
      await this.post({
        protocolVersion: WORKBENCH_PROTOCOL_VERSION,
        type: "operation/cancelled",
        requestId,
        moduleId: "commit",
        payload: {
          title: "提交已取消",
          message: "状态已重新采集，请确认是否存在部分调度变化。",
        },
      });
      await this.sendCommitSnapshot(session, requestId);
      return;
    }
    if (result.commitResult.exitCode !== 0) {
      state.preview = undefined;
      await this.sendError(
        "commit",
        "SVN 提交失败",
        result.commitResult.stderr || result.commitResult.stdout || "未知错误",
        true,
        requestId,
      );
      return;
    }

    const committedMessage = state.message;
    try {
      await appendTeamMemory(
        this.context.workspaceState,
        session.repositoryUuid,
        {
          revision: result.revision,
          message: committedMessage,
        },
      );
    } catch (error) {
      appendOutput(
        `Team memory cache failed after successful commit: ${sanitizeDiagnostic(errorMessage(error))}`,
      );
    }
    state.preview = undefined;
    state.selectedPaths = undefined;
    state.message = "";
    state.ai = undefined;
    await this.post({
      protocolVersion: WORKBENCH_PROTOCOL_VERSION,
      type: "operation/result",
      requestId,
      moduleId: "commit",
      payload: {
        title: "提交完成",
        message: result.revision
          ? `已提交为 r${result.revision}`
          : "SVN 提交已完成。",
      },
    });
    await this.sendCommitSnapshot(session, requestId);
  }

  private async sendError(
    moduleId: WorkbenchModuleId,
    title: string,
    message: string,
    recoverable: boolean,
    requestId?: string,
  ): Promise<void> {
    const safeMessage = sanitizeDiagnostic(message);
    const classification = classifySvnFailure(message);
    const certificate =
      classification.category === "certificate"
        ? extractSvnCertificateDetails(message)
        : undefined;
    if (this.session) this.session.security.lastCertificate = certificate;
    if (
      this.session &&
      (classification.category === "working-copy-locked" ||
        classification.category === "interrupted")
    ) {
      this.session.recoveryState = {
        category: classification.category,
        title: classification.label,
        detectedAt: new Date().toISOString(),
        steps: classification.guidance,
        requiresFreshPreview: true,
      };
      if (this.session.commitState)
        this.session.commitState.preview = undefined;
      if (this.session.repositoryState)
        this.session.repositoryState.update = undefined;
    }
    await this.post({
      protocolVersion: WORKBENCH_PROTOCOL_VERSION,
      type: "operation/error",
      requestId,
      moduleId,
      payload: {
        title,
        message: safeMessage,
        recoverable,
        category: classification.category,
        categoryLabel: classification.label,
        guidance: classification.guidance,
        certificate: certificate
          ? {
              ...certificate,
              canTrust: Boolean(certificate.host && certificate.fingerprint),
            }
          : undefined,
        network: classification.networkKind
          ? { kind: classification.networkKind }
          : undefined,
        recovery: classification.recoveryModule
          ? { moduleId: classification.recoveryModule }
          : undefined,
      },
    });
  }

  private async post(message: HostToWebviewMessage): Promise<void> {
    await this.panel?.webview.postMessage({
      ...message,
      taskId:
        this.session?.moduleId === message.moduleId
          ? this.session.taskId
          : defaultWorkbenchTask(message.moduleId),
      sessionId: this.session?.sessionId,
      repositoryUuid: this.session?.repositoryUuid,
      scopeHash: this.session?.scopeHash,
    } satisfies HostToWebviewMessage);
  }
}
