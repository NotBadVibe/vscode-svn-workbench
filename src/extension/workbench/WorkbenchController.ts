import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import * as vscode from "vscode";
import {
  buildCommitMessageAiRequest,
  createMockCommitMessageResult,
  normalizeCommitMessageResult,
} from "../../ai/commitMessageAiGenerator";
import {
  insertSuggestionBlankFields,
  replaceDraftWithSuggestion,
} from "../../commit/commitMessageSuggestion";
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
  AI_VISIBLE_USAGE_SCENARIOS,
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
  filterCommitSelectionByCandidates,
  validateCommitSelection,
} from "../../commit/commitSelectionValidation";
import { describeSelectionChange } from "../../commit/selectionChangeSummary";
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
import {
  SVN_WORKBENCH_CONFIG_FILE,
  getSvnWorkbenchConfigPath,
  readSvnWorkbenchConfig,
  readSvnWorkbenchConfigContent,
} from "../../config/svnWorkbenchConfig";
import {
  hashTeamConfigContent,
  planTeamConfigMigration,
} from "../../config/teamConfigMigration";
import {
  executeTeamConfigMigration,
  nodeTeamConfigMigrationIo,
} from "../../config/teamConfigMigrationExecutor";
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
  type CommitMessageSuggestion,
  type DiffSnapshot,
  type CommitPlanView,
  type CommitSnapshot,
  type DiagnosticsSnapshot,
  type HostToWebviewMessage,
  type SettingsSnapshot,
  type WebviewToHostMessage,
  type WorkbenchModuleId,
  type WorkbenchTaskId,
  type WorkbenchModuleSnapshot,
  type ProjectsSnapshot,
} from "../../protocol/workbenchProtocol";
import { toDisplayPath } from "../../scope/pathBrands";
import { nativePathSemantics } from "../../scope/nativePathSemantics";
import { createScopedFileKey } from "../../scope/projectIdentity";
import type { PathIdentityKey } from "../../scope/pathIdentity";
import { validatePathsInScope } from "../../scope/pathBoundaryGuard";
import { isPathInScope } from "../../scope/pathBoundaryGuard";
import { projectRelativePath } from "../../scope/projectIdentity";
import {
  buildAnalysisReceipt,
  buildCandidateId,
  isCommitDraftEvidenceStale,
  validateCommitMessageClaims,
  validateEvidenceReferences,
} from "../../commit/commitDiffEvidence";
import {
  collectLimitedCommitDiffs,
  COMMIT_DIFF_PER_FILE_BUDGET,
  COMMIT_DIFF_TOTAL_BUDGET,
  type CommitDiffCandidateRef,
} from "../../commit/commitDiffCollector";
import {
  isSameOrDescendantPath,
  isSamePathIdentity,
} from "../../scope/pathIdentity";
import {
  classifyWorkingCopyBinding,
  isSvnBound,
  type WorkingCopyBinding,
} from "../../scope/workingCopyClassification";
import { resolveWorkingCopyRoot } from "../../scope/workingCopyResolver";
import {
  createScopeFromExplorer,
  createWorkingCopyScope,
} from "../../scope/operationScope";
import { finalizeScopeProject } from "../../scope/projectResolver";
import { workingCopyBindingLabels } from "../../scope/workingCopyClassification";
import {
  groupProjectsByWorkingCopy,
  sliceCandidatesForProject,
} from "../../scm/projectSlicing";
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
  parseSvnExternalsTargetNames,
  parseSvnPropertiesXml,
  validatePropertyEdit,
} from "../../properties/svnProperties";
import { runSvnCommand } from "../../svn/svnCommandRunner";
import { deriveRepositoryRelativePath, joinSvnUrl } from "../../svn/svnUrl";
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
  collectUnfinishedContent,
  resolveProjectSwitchDecision,
  type UnfinishedContentResult,
} from "./projectSwitchGuard";
import {
  deleteProjectDraft,
  projectDraftKey,
  readProjectDraft,
  writeProjectDraft,
  type ProjectDraftMap,
} from "./projectDraftStore";
import type { OperationScope } from "../../scope/operationScope";
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
  withProjectFileView,
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
  resolveRepositoryRootUrl,
  resolveWorkingCopyRevision,
  resolveWorkingCopyUrl,
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
  /** v0.0.7 项目草稿存储键（workspaceState 本身按工作区容器隔离）。 */
  private static readonly PROJECT_DRAFTS_STATE_KEY =
    "svnWorkbench.projectDrafts";
  /** 本控制器当前持有的仓库安全引用（归一化键）；一控制器最多持有一个。 */
  private securityReferenceRoot: PathIdentityKey | undefined;
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

    /*
     * v0.0.7 §8 项目切换草稿守卫：复用模块窗口从项目 A 加载项目 B 前，
     * 检查提交说明草稿、手动选择、AI 结果与待确认预览；存在内容时三选一
     * （保留为项目 A 草稿并切换 / 放弃内容并切换 / 留在当前项目）。
     * Diff 窗口的目标级三选一守卫在下方独立处理。
     */
    if (
      !this.isDiffWindow() &&
      this.session &&
      this.isProjectSwitch(this.session, request) &&
      !(await this.confirmProjectSwitch(this.session, request))
    ) {
      return;
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
      // 会话替换即撤销旧会话的编辑令牌：旧 token 永不恢复有效（v0.0.7 §8）。
      this.diffEdit?.revokeForSession(this.session.sessionId);
    }
    const storedAi = await readStoredAiConfiguration(this.context);
    const repositoryUuid = await resolveRepositoryUuid(
      request.svnPath,
      request.scope,
    );
    const repositoryRootUrl = await resolveRepositoryRootUrl(
      request.svnPath,
      request.scope,
    );
    const workingCopyUrl = await resolveWorkingCopyUrl(
      request.svnPath,
      request.scope,
    );
    const workingCopyRevision = await resolveWorkingCopyRevision(
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
      repositoryRootUrl,
      workingCopyUrl,
      workingCopyRevision,
      scopeHash: hashOperationScope(request.scope),
      aiModels: buildScenarioModelMap(storedAi),
      security: {
        authentication: storedAuthentication,
        hasStoredAuthentication: Boolean(storedAuthentication),
      },
    };
    // 项目切换后恢复该项目保留的草稿（仅提交说明与手动选择；旧预览、
    // 确认令牌与 AI 结果永不恢复）。
    await this.restoreProjectDraft(this.session);
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
  handleSecurityInvalidated(repositoryRoot: PathIdentityKey): void {
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
      session.scope.project?.projectRoot,
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
        const validation = validatePathsInScope(
          session.scope,
          [absolutePath],
          nativePathSemantics,
        );
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
          validatePathsInScope(
            session.scope,
            [absolutePath],
            nativePathSemantics,
          ).outOfScopeItems.length > 0
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
      case "file/path-detail": {
        await this.respondFilePathDetail(
          session,
          asString(data.relativePath),
          message.requestId,
        );
        return;
      }
      case "file/copy-path": {
        await this.copyFileLocalPath(
          session,
          asString(data.relativePath),
          message.requestId,
        );
        return;
      }
      case "projects/open-task": {
        await this.openProjectTask(
          session,
          asString(data.projectRoot),
          asString(data.task),
          message.requestId,
        );
        return;
      }
      case "projects/switch": {
        await this.switchActiveProject(session, message.requestId);
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
        const next = asStringAllowEmpty(data.message) ?? state.message;
        // v0.0.9 §4：仅在用户真正改动草稿（内容与当前不同）时清除替换前
        // 备份——blur/回显等未改动的同步不得使“撤销替换”入口消失。
        if (state.messageSuggestionReplaceBackup && next !== state.message) {
          state.messageSuggestionReplaceBackup = undefined;
        }
        state.message = next;
        state.preview = undefined;
        await this.sendCommitSnapshot(session, message.requestId);
        return;
      }
      case "commit/update-selection": {
        const requested = asStringArray(data.selectedPaths) ?? [];
        const state = this.ensureCommitState(session);
        // 候选复验（fail-closed）：路径必须在当前候选集合，且不是
        // excluded/blocked。复用最近一次权威采集缓存，refresh 后自动更新。
        const candidates =
          state.candidates ?? (await this.collectScopeCandidates(session));
        // 统一 Webview 选择校验入口（与 preview/generate-message 一致）：
        // 非法输入不修改 state.selectedPaths、不清除合法现状。
        const selectionError = this.applyWebviewSelection(
          session,
          requested,
          candidates,
          { trackManualSelection: true },
        );
        if (selectionError) {
          await this.sendError(
            "commit",
            "提交选择未通过候选校验",
            selectionError,
            true,
            message.requestId,
          );
          return;
        }
        // 复用刚用于校验的候选快照：勾选不重跑 SVN status；真实写操作
        // （createCommitPreview/execute）仍会重新采集并复验。
        await this.sendCommitSnapshot(session, message.requestId, candidates);
        return;
      }
      case "commit/apply-local-rules": {
        // 始终经统一入口重新采集并评估，不复用陈旧候选（规划 4.2）；
        // 用户显式触发，应用推荐选择属于预期覆盖。
        const candidates = await this.collectScopeCandidates(session);
        const state = this.ensureCommitState(session);
        // provenance：摘要只对最后一次手动选择计算，不把规则/AI 推荐
        // 虚构成手动选择；应用后清空手动跟踪。
        const previousManual = state.manualSelectedPaths ?? [];
        const recommended = candidates
          .filter((candidate) => candidate.selection === "selected")
          .map((candidate) => candidate.relativePath);
        const needsReview = candidates.filter(
          (candidate) => candidate.selection === "needsReview",
        ).length;
        state.selectedPaths = recommended;
        state.manualSelectedPaths = undefined;
        state.preview = undefined;
        state.feedback = {
          tone: "success",
          message: `已按本地规则应用推荐选择 ${recommended.length} 个文件（${describeSelectionChange(previousManual, recommended)}）；${needsReview} 个文件待确认，可手动勾选。`,
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
        // provenance：摘要只对最后一次手动选择计算；AI 应用后清空手动跟踪。
        const previousManual = state.manualSelectedPaths ?? [];
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
        state.manualSelectedPaths = undefined;
        state.preview = undefined;
        state.ai = {
          source,
          summary: `建议选择 ${state.selectedPaths.length} 个文件（${describeSelectionChange(previousManual, state.selectedPaths)}）；${effective.needsReview.length} 个需要人工确认，${effective.excluded.length} 个建议排除。`,
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
        // 用户显式套用模板接管草稿：替换前备份失效。
        state.messageSuggestionReplaceBackup = undefined;
        state.preview = undefined;
        await this.sendCommitSnapshot(session, message.requestId);
        return;
      }
      case "commit/preview-receipt": {
        // v0.0.11 §3 动作级外发回执：受限差异模式调用模型前，先采集、
        // 脱敏、裁剪并计算覆盖率，把回执下发给 Webview；此处不调用模型。
        // 用户确认“开始模型生成”或“继续仅文件信息”后，再经
        // commit/generate-message（携带 receiptToken）实际生成。
        const state = this.ensureCommitState(session);
        const candidates = await this.collectScopeCandidates(session);
        const requested = asStringArray(data.selectedPaths);
        if (requested !== undefined) {
          const selectionError = this.applyWebviewSelection(
            session,
            requested,
            candidates,
            { trackManualSelection: false },
          );
          if (selectionError) {
            await this.sendError(
              "commit",
              "提交选择未通过候选校验",
              selectionError,
              true,
              message.requestId,
            );
            return;
          }
        }
        state.message = asStringAllowEmpty(data.message) ?? state.message;
        const selectedAbsolutePaths = this.resolveSelectedAbsolutePaths(
          session,
          candidates,
        );
        if (selectedAbsolutePaths.length === 0) {
          state.pendingReceipt = undefined;
          state.feedback = {
            tone: "warning",
            message: "当前没有勾选文件，无法预览受限差异回执；请先选择文件。",
          };
          await this.sendCommitSnapshot(session, message.requestId, candidates);
          return;
        }
        const storedAi = await readStoredAiConfiguration(this.context);
        const pending = await this.collectCommitDiffReceipt(
          session,
          candidates,
          selectedAbsolutePaths,
          storedAi,
        );
        if (!pending) {
          await this.sendError(
            "commit",
            "无法生成受限差异回执",
            "受限差异采集失败；请检查工作副本状态后重试。",
            true,
            message.requestId,
          );
          return;
        }
        state.pendingReceipt = pending;
        await this.postCommitReceipt(pending, message.requestId);
        return;
      }
      case "commit/receipt-dismiss": {
        // v0.0.11 §3：取消回执。未确认前模型不会被调用，回执一次性失效；
        // 明确说明未发生任何外发。
        const state = this.ensureCommitState(session);
        const token = asString(data.token);
        if (state.pendingReceipt && state.pendingReceipt.token === token) {
          state.pendingReceipt = undefined;
          state.feedback = {
            tone: "warning",
            message:
              "已放弃受限差异回执；未确认前未发送任何差异内容，提交说明保持不变。",
          };
        }
        await this.sendCommitSnapshot(session, message.requestId);
        return;
      }
      case "commit/open-evidence": {
        // v0.0.11 §4/AI11-DRAFT-02：打开 Host 校验过的证据对应文件的差异。
        // 只接受建议中 valid=true 的引用；建议过期、引用失效、文件已不在
        // 候选集合或范围外均拒绝，防止把模型引用当可写路径使用。
        const state = this.ensureCommitState(session);
        const suggestion = state.messageSuggestion;
        const token = asString(data.token);
        const candidateId = asString(data.candidateId);
        const projectRelativePath = asString(data.projectRelativePath);
        const hunkId = asString(data.hunkId);
        if (
          !suggestion ||
          suggestion.token !== token ||
          !candidateId ||
          !projectRelativePath
        ) {
          await this.sendError(
            "commit",
            "无法打开证据",
            "证据引用无效或建议已不存在，未打开差异。",
            true,
            message.requestId,
          );
          return;
        }
        const candidates = await this.collectScopeCandidates(session);
        if (
          this.isCommitMessageSuggestionStale(session, suggestion, candidates)
        ) {
          await this.sendError(
            "commit",
            "建议已过期",
            "范围或候选已变化，证据可能失效；请重新生成后查看。",
            true,
            message.requestId,
          );
          return;
        }
        const validEvidence = suggestion.evidence?.some(
          (item) =>
            item.valid &&
            item.reference.candidateId === candidateId &&
            item.reference.projectRelativePath === projectRelativePath &&
            (hunkId === undefined ||
              hunkId === "" ||
              item.reference.hunkId === hunkId),
        );
        if (!validEvidence) {
          await this.sendError(
            "commit",
            "证据引用无效",
            "该引用不在建议的有效证据集合内，未打开差异。",
            true,
            message.requestId,
          );
          return;
        }
        const absolutePath = candidates.find(
          (candidate) =>
            buildCandidateId(
              session.scope.repositoryRoot,
              candidate.absolutePath,
            ) === candidateId,
        )?.absolutePath;
        if (
          !absolutePath ||
          !isPathInScope(session.scope, absolutePath, nativePathSemantics)
        ) {
          await this.sendError(
            "commit",
            "证据文件已失效",
            "该证据引用的文件已不在当前候选集合或操作范围内，未打开差异。",
            true,
            message.requestId,
          );
          return;
        }
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
        }
        session.moduleId = "diff";
        session.taskId = defaultWorkbenchTask("diff");
        session.targetFile = absolutePath;
        this.panel!.title = getModuleTitle("diff", session.taskId);
        await this.loadModule("diff", absolutePath, message.requestId);
        return;
      }
      case "commit/retry-failed-diff": {
        // v0.0.11 §6“部分完成只重试失败项”：只对上次读取失败/预算外的
        // 文件重新采集受限差异并展示回执（不调用模型）；确认后经
        // commit/generate-message 生成，新建议替换旧建议（草稿不变）。
        const state = this.ensureCommitState(session);
        const suggestion = state.messageSuggestion;
        const token = asString(data.token);
        if (!suggestion || suggestion.token !== token) {
          await this.sendError(
            "commit",
            "无法重试失败项",
            "建议不存在或已失效，未重试。",
            true,
            message.requestId,
          );
          return;
        }
        if (suggestion.diffMode !== "limited-diff") {
          await this.sendError(
            "commit",
            "无法重试失败项",
            "仅受限差异模式的建议支持重试失败项。",
            true,
            message.requestId,
          );
          return;
        }
        const candidates = await this.collectScopeCandidates(session);
        if (
          this.isCommitMessageSuggestionStale(session, suggestion, candidates)
        ) {
          await this.sendError(
            "commit",
            "建议已过期",
            "范围或候选已变化，请重新生成后再重试。",
            true,
            message.requestId,
          );
          return;
        }
        const failedIds =
          suggestion.coverageFiles
            ?.filter(
              (file) =>
                file.state === "readFailed" || file.state === "budgetExcluded",
            )
            .map((file) => file.candidateId) ?? [];
        const failedPaths = candidates
          .filter((candidate) =>
            failedIds.includes(
              buildCandidateId(
                session.scope.repositoryRoot,
                candidate.absolutePath,
              ),
            ),
          )
          .map((candidate) => candidate.absolutePath);
        if (failedPaths.length === 0) {
          state.feedback = {
            tone: "warning",
            message:
              "没有可重试的失败项（上次读取失败或预算外的文件已全部处理或已失效）。",
          };
          await this.sendCommitSnapshot(session, message.requestId, candidates);
          return;
        }
        const storedAi = await readStoredAiConfiguration(this.context);
        const pending = await this.collectCommitDiffReceipt(
          session,
          candidates,
          failedPaths,
          storedAi,
          `本次重试仅覆盖 ${failedPaths.length} 个上次读取失败或预算外的文件。`,
        );
        if (!pending) {
          await this.sendError(
            "commit",
            "无法重试失败项",
            "受限差异采集失败；请检查工作副本状态后重试。",
            true,
            message.requestId,
          );
          return;
        }
        state.pendingReceipt = pending;
        await this.postCommitReceipt(pending, message.requestId);
        return;
      }
      case "commit/generate-message": {
        const state = this.ensureCommitState(session);
        const candidates = await this.collectScopeCandidates(session);
        const requested = asStringArray(data.selectedPaths);
        if (requested !== undefined) {
          // 整批校验（Finding 1）：invalid 时保留旧状态、不调用 AI。
          const selectionError = this.applyWebviewSelection(
            session,
            requested,
            candidates,
            { trackManualSelection: false },
          );
          if (selectionError) {
            await this.sendError(
              "commit",
              "提交选择未通过候选校验",
              selectionError,
              true,
              message.requestId,
            );
            return;
          }
        }
        state.message = asStringAllowEmpty(data.message) ?? state.message;
        const selectedAbsolutePaths = this.resolveSelectedAbsolutePaths(
          session,
          candidates,
        );
        const convention = await resolveCommitConventionConfig(
          session.scope.repositoryRoot,
          session.scope.project?.projectRoot,
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
        const diffMode =
          asString(data.diffMode) === "limited-diff"
            ? "limited-diff"
            : "metadata-only";

        if (diffMode === "limited-diff") {
          // v0.0.11 §3：受限差异必须携带匹配的回执令牌才调用模型。
          const receiptToken = asString(data.receiptToken);
          const pending = state.pendingReceipt;
          const currentCandidateHash = hashCandidateState(candidates, "", []);
          if (
            !pending ||
            !receiptToken ||
            pending.token !== receiptToken ||
            pending.scopeHash !== session.scopeHash ||
            pending.candidateHash !== currentCandidateHash
          ) {
            state.pendingReceipt = undefined;
            await this.sendError(
              "commit",
              "外发回执已失效",
              "受限差异的外发回执已过期或不存在（范围或候选已变化），未调用模型；当前提交说明保持不变。",
              true,
              message.requestId,
            );
            await this.sendCommitSnapshot(
              session,
              message.requestId,
              candidates,
            );
            return;
          }
          const pendingFragments = pending.fragments;
          const request = buildCommitMessageAiRequest(
            session.scope,
            candidates,
            selectedAbsolutePaths,
            [],
            {
              currentMessage: state.message,
              convention: toAiCommitConventionHint(convention.config),
              recentHistory,
              diffMode: "limited-diff",
              receipt: pending.receipt,
              coverage: pending.coverage,
              diffs: pendingFragments,
            },
          );
          const aiResult = await this.runAiScenario(
            "commitMessage",
            createMockCommitMessageResult(request),
            (provider) => provider.generateCommitMessage(request),
          );
          const { result, source, fallbackReason } = aiResult;
          const generated = normalizeCommitMessageResult(result);
          if (!generated.message.trim()) {
            state.messageSuggestion = undefined;
            state.pendingReceipt = undefined;
            state.feedback = {
              tone: "warning",
              message: `${
                generated.summary || "当前没有足够的差异信息生成建议草稿"
              }；当前提交说明保持不变。`,
            };
            state.preview = undefined;
            await this.sendCommitSnapshot(
              session,
              message.requestId,
              candidates,
            );
            return;
          }
          // v0.0.11 §4/AI11-SAFE-02：证据引用必须落在回执允许的文件与
          // 差异块集合内；虚构、范围外、过期引用丢弃并计入警告。
          const evidenceValidation = validateEvidenceReferences(
            generated.evidence ?? [],
            pendingFragments,
          );
          const evidenceWarnings = evidenceValidation.invalid.map(
            (invalid) =>
              `${invalid.reference.projectRelativePath}：${invalid.reason}。`,
          );
          // v0.0.11 §5：逐条声明逐条校验与强制降级——模型标 confirmed 但
          // 无任何有效 Host 证据的声明降级为 toConfirm 并计入警告。
          const claimValidation = validateCommitMessageClaims(
            generated.claims ?? [],
            pendingFragments,
          );
          const claimWarnings = claimValidation.claims
            .filter((claim) => claim.downgraded)
            .map(
              (claim) =>
                `模型把“${claim.text}”标为已证实，但缺少可核对的 Host 证据，已降级为待确认。`,
            );
          const suggestion: CommitMessageSuggestion = {
            token: randomUUID(),
            message: generated.message,
            source,
            model: session.aiModels.commitMessage || undefined,
            metadataOnly: false,
            diffMode: "limited-diff",
            coverage: pending.coverage,
            coverageFiles: pending.files,
            claims: claimValidation.claims,
            evidence: [
              ...evidenceValidation.valid.map((reference) => ({
                reference,
                valid: true,
              })),
              ...evidenceValidation.invalid.map((invalid) => ({
                reference: invalid.reference,
                valid: false,
                reason: invalid.reason,
              })),
            ],
            receipt: pending.receipt,
            warnings: [
              ...generated.warnings,
              ...(pending.retryNote ? [pending.retryNote] : []),
              ...evidenceWarnings,
              ...claimWarnings,
              ...(fallbackReason
                ? [`模型不可用，已使用本地回退：${fallbackReason}`]
                : []),
            ],
            binding: {
              repositoryUuid: session.repositoryUuid,
              scopeHash: session.scopeHash,
              candidateHash: currentCandidateHash,
              revision: pending.revision,
              generatedAt: new Date().toISOString(),
              model: session.aiModels.commitMessage || undefined,
            },
          };
          state.messageSuggestion = suggestion;
          state.pendingReceipt = undefined;
          state.preview = undefined;
          await this.sendCommitSnapshot(session, message.requestId, candidates);
          return;
        }

        const diffSummaries = await collectCommitDiffSummaries(
          session.svnPath,
          session.scope,
          selectedAbsolutePaths,
        );
        const request = buildCommitMessageAiRequest(
          session.scope,
          candidates,
          selectedAbsolutePaths,
          diffSummaries,
          {
            currentMessage: state.message,
            convention: toAiCommitConventionHint(convention.config),
            recentHistory,
            diffMode: "metadata-only",
          },
        );
        const aiResult = await this.runAiScenario(
          "commitMessage",
          createMockCommitMessageResult(request),
          (provider) => provider.generateCommitMessage(request),
        );
        const { result, source, fallbackReason } = aiResult;
        // v0.0.9 §4：生成、失败、超时、取消、降级均不得覆盖用户已填草稿。
        // 结果只进入 messageSuggestion 建议区，不写入 state.message；
        // 采用必须经 commit/adopt-suggestion 显式执行。
        const generated = normalizeCommitMessageResult(result);
        if (!generated.message.trim()) {
          // 没有足够输入（如未勾选文件）：不生成建议，保留用户草稿。
          state.messageSuggestion = undefined;
          state.feedback = {
            tone: "warning",
            message: `${
              generated.summary || "当前没有足够的文件信息生成建议草稿"
            }；当前提交说明保持不变。`,
          };
          state.preview = undefined;
          await this.sendCommitSnapshot(session, message.requestId, candidates);
          return;
        }
        const suggestion: CommitMessageSuggestion = {
          token: randomUUID(),
          message: generated.message,
          source,
          model: session.aiModels.commitMessage || undefined,
          // 输入仅含文件信息与差异统计（未读取差异正文）：
          // 无论模型还是本地回退，都明确标记“基于文件信息”。
          metadataOnly: true,
          diffMode: "metadata-only",
          warnings: [
            ...generated.warnings,
            ...(fallbackReason
              ? [`模型不可用，已使用本地回退：${fallbackReason}`]
              : []),
          ],
          binding: {
            repositoryUuid: session.repositoryUuid,
            scopeHash: session.scopeHash,
            candidateHash: hashCandidateState(candidates, "", []),
            revision: session.workingCopyRevision,
            generatedAt: new Date().toISOString(),
            model: session.aiModels.commitMessage || undefined,
          },
        };
        state.messageSuggestion = suggestion;
        state.preview = undefined;
        await this.sendCommitSnapshot(session, message.requestId, candidates);
        return;
      }
      case "commit/adopt-suggestion": {
        // v0.0.9 §4：显式采用建议草稿（插入空白字段 / 替换草稿）。
        // 生成结果不覆盖草稿；这里由用户明确动作才写回主草稿。
        const state = this.ensureCommitState(session);
        const token = asString(data.token);
        const mode = asString(data.mode);
        const currentMessage = asStringAllowEmpty(data.currentMessage) ?? "";
        const suggestion = state.messageSuggestion;
        if (!suggestion || suggestion.token !== token) {
          await this.sendError(
            "commit",
            "建议草稿已失效",
            "该建议草稿已不存在或已被替换，未修改当前提交说明。",
            true,
            message.requestId,
          );
          // 补发快照：Webview 在 replace 确认时已把本地 message 置为建议
          // 文本，拒绝后必须用 Host 权威草稿回滚，避免界面与草稿分歧。
          await this.sendCommitSnapshot(session, message.requestId);
          return;
        }
        // 采用是写回草稿的动作：执行前重新校验候选与范围，不能只信
        // Webview 回传或快照里的 stale 标记（fail-closed）。
        const candidates = await this.collectScopeCandidates(session);
        if (
          this.isCommitMessageSuggestionStale(session, suggestion, candidates)
        ) {
          await this.sendError(
            "commit",
            "建议草稿已过期",
            "范围或候选已变化，该建议只能查看；当前提交说明保持不变。",
            true,
            message.requestId,
          );
          // 补发快照：拒绝后回滚 Webview 本地 message 到 Host 权威草稿。
          await this.sendCommitSnapshot(session, message.requestId, candidates);
          return;
        }
        if (mode === "insert-blank-fields") {
          // 只补充建议中“标签:”为空的空白字段，不删除、不改写用户已填内容
          // （幂等：重复提交不重复插入）。
          const outcome = insertSuggestionBlankFields(
            currentMessage,
            suggestion.message,
          );
          state.message = outcome.message;
          state.messageSuggestionReplaceBackup = undefined;
          state.preview = undefined;
          state.feedback = {
            tone: "success",
            message:
              outcome.inserted.length > 0
                ? `已插入 ${outcome.inserted.length} 个空白字段，用户已填内容保持不变。`
                : "建议中无新空白字段，当前提交说明保持不变。",
          };
          await this.sendCommitSnapshot(session, message.requestId);
          return;
        }
        if (mode === "replace") {
          const check = replaceDraftWithSuggestion(
            currentMessage,
            suggestion.message,
          );
          if (!check.ok) {
            await this.sendError(
              "commit",
              "未替换提交说明",
              check.reason,
              true,
              message.requestId,
            );
            // 补发快照：replace 被拒（同内容/超限）时回滚 Webview 本地
            // message，确保文本框与 Host 草稿一致（AI09-DRAFT-02）。
            await this.sendCommitSnapshot(
              session,
              message.requestId,
              candidates,
            );
            return;
          }
          // 替换前备份，供 commit/undo-suggestion-replace 恢复。
          state.messageSuggestionReplaceBackup = { previous: currentMessage };
          state.message = check.message;
          state.preview = undefined;
          state.feedback = {
            tone: "success",
            message: "已用建议替换提交说明；可撤销替换恢复原内容。",
          };
          await this.sendCommitSnapshot(session, message.requestId);
          return;
        }
        await this.sendError(
          "commit",
          "未知的采用方式",
          "未知的 adopt-suggestion 模式，未修改当前提交说明。",
          true,
          message.requestId,
        );
        // 补发快照：未知 mode 拒绝后同样回滚 Webview 本地 message。
        await this.sendCommitSnapshot(session, message.requestId, candidates);
        return;
      }
      case "commit/undo-suggestion-replace": {
        const state = this.ensureCommitState(session);
        if (!state.messageSuggestionReplaceBackup) {
          await this.sendError(
            "commit",
            "没有可撤销的替换",
            "没有可撤销的提交说明替换记录；当前提交说明保持不变。",
            true,
            message.requestId,
          );
          return;
        }
        state.message = state.messageSuggestionReplaceBackup.previous;
        state.messageSuggestionReplaceBackup = undefined;
        state.preview = undefined;
        state.feedback = {
          tone: "success",
          message: "已撤销建议替换，已恢复原提交说明。",
        };
        await this.sendCommitSnapshot(session, message.requestId);
        return;
      }
      case "commit/discard-suggestion": {
        const state = this.ensureCommitState(session);
        const token = asString(data.token);
        if (
          !state.messageSuggestion ||
          state.messageSuggestion.token !== token
        ) {
          // 建议已不存在：视为已放弃，幂等成功。
          await this.sendCommitSnapshot(session, message.requestId);
          return;
        }
        state.messageSuggestion = undefined;
        state.messageSuggestionReplaceBackup = undefined;
        state.preview = undefined;
        state.feedback = {
          tone: "success",
          message: "已放弃建议草稿；当前提交说明保持不变。",
        };
        await this.sendCommitSnapshot(session, message.requestId);
        return;
      }
      case "commit/preview": {
        const state = this.ensureCommitState(session);
        // 无论是否携带 selectedPaths，都用本次权威候选校验当前选择
        // （Finding 1 + Lead 复审）：候选在快照后消失时不得静默取交集；
        // 缺省时校验 state.selectedPaths，trackManual=false。
        const candidates = await this.collectScopeCandidates(session);
        const requested = asStringArray(data.selectedPaths);
        const selectionError = this.applyWebviewSelection(
          session,
          requested ?? state.selectedPaths ?? [],
          candidates,
          { trackManualSelection: false },
        );
        if (selectionError) {
          await this.sendError(
            "commit",
            "提交选择未通过候选校验",
            selectionError,
            true,
            message.requestId,
          );
          return;
        }
        state.message = asStringAllowEmpty(data.message) ?? state.message;
        await this.createCommitPreview(session, message.requestId, candidates);
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
          validatePathsInScope(
            session.scope,
            [absolutePath],
            nativePathSemantics,
          ).outOfScopeItems.length > 0
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
            session.scope.project?.projectRoot,
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
        // 明确的“打开配置文件”动作：无既有配置时在写入目标（项目根优先）
        // 创建默认配置。
        const configPath = await ensureSvnWorkbenchProjectConfig(
          session.scope.repositoryRoot,
          session.scope.project?.projectRoot,
        );
        const document = await vscode.workspace.openTextDocument(
          vscode.Uri.file(configPath),
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
            session.scope.project?.projectRoot,
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
              session.scope.project?.projectRoot,
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
          session.scope.project?.projectRoot,
        );
        const document = await vscode.workspace.openTextDocument(
          vscode.Uri.file(configPath),
        );
        await vscode.window.showTextDocument(document, { preview: false });
        return;
      }
      case "settings/preview-team-migration": {
        await this.previewTeamMigration(session, message.requestId);
        return;
      }
      case "settings/execute-team-migration": {
        await this.executeTeamMigration(
          session,
          asString(data.token),
          message.requestId,
        );
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
          validatePathsInScope(
            session.scope,
            [preview.target],
            nativePathSemantics,
          ).outOfScopeItems.length > 0
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
          validatePathsInScope(
            session.scope,
            [preview.target],
            nativePathSemantics,
          ).outOfScopeItems.length > 0
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
          session.scope.project?.projectRoot,
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
              "只执行只读采集与本地分析",
              "不自动修改文件、不自动提交",
              "状态变化后流水线结果立即失效",
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
                title: "执行本地证据检查",
                detail:
                  "使用本地敏感信息、调试代码与生成物规则扫描，不调用外部模型。",
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
                detail: "根据实际变更路径与本地规则给出验证命令和上线观察点。",
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
            "流水线步骤不可执行",
            "只能执行当前待运行步骤，请重新运行流水线。",
            true,
            message.requestId,
          );
          return;
        }
        const candidates = await this.collectScopeCandidates(session);
        if (hashCandidateState(candidates, "", []) !== state.candidateHash) {
          state.snapshot.status = "failed";
          state.snapshot.message =
            "工作副本已变化，原流水线结果已过期。请重新运行流水线。";
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
            ? "当前步骤完成，等待执行下一步。"
            : "只读流水线已完成，可以进入本地检查、影响或提交模块继续操作。";
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
          validatePathsInScope(
            session.scope,
            [absolutePath],
            nativePathSemantics,
          ).outOfScopeItems.length > 0
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
          validatePathsInScope(
            session.scope,
            [absolutePath],
            nativePathSemantics,
          ).outOfScopeItems.length > 0
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
        session.scope,
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

    if (moduleId === "projects") {
      return this.buildProjectsSnapshot(session);
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
      validatePathsInScope(session.scope, [absolutePath], nativePathSemantics)
        .outOfScopeItems.length > 0
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
      validatePathsInScope(session.scope, [absolutePath], nativePathSemantics)
        .outOfScopeItems.length > 0
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
      validatePathsInScope(session.scope, [absolutePath], nativePathSemantics)
        .outOfScopeItems.length > 0
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
      session.conflictState = {
        selectedPath: conflicts[0]?.relativePath,
        // v0.0.10：会话内首次冲突总数作为处理进度基线。
        initialCount: conflicts.length,
      };
    } else if (session.conflictState.initialCount === undefined) {
      session.conflictState.initialCount = conflicts.length;
    }
    if (
      session.conflictState.selectedPath &&
      !conflicts.some(
        (item) => item.relativePath === session.conflictState!.selectedPath,
      )
    ) {
      // 选择失效时重置建议与预览，但保留进度基线。
      session.conflictState = {
        selectedPath: conflicts[0]?.relativePath,
        initialCount: session.conflictState.initialCount,
      };
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
      progress: {
        initialCount: session.conflictState.initialCount ?? conflicts.length,
        remaining: conflicts.length,
        resolvedCount: Math.max(
          0,
          (session.conflictState.initialCount ?? conflicts.length) -
            conflicts.length,
        ),
      },
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
    const projectRoot = session.scope.project?.projectRoot;
    const teamState = await readCommitConventionEditState(
      session.scope.repositoryRoot,
      projectRoot,
    );
    const conventionResolution = await resolveCommitConventionConfig(
      session.scope.repositoryRoot,
      projectRoot,
    );
    const team = state.recommendedTeamConfig ?? teamState.config;
    // 团队规则动作反馈为一次性：本次快照下发后清除。
    const teamFeedback = state.teamFeedback;
    state.teamFeedback = undefined;
    const memory = readTeamMemory(
      this.context.workspaceState,
      session.repositoryUuid,
    );
    // 提交选择规则段：有效规则经统一服务解析（缓存），预览候选经统一入口采集；
    // 采集失败只降级预览区，不阻断整个设置模块（无仓库/无候选/损坏配置均有结构化状态）。
    const resolvedSelectionRules =
      await this.commitSelectionRuleService.getEffectiveRules(
        session.scope.repositoryRoot,
        projectRoot,
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
        // v0.0.9 §6：设置页只列出有真实调用链的场景，不展示无调用链的伪场景。
        scenarios: AI_VISIBLE_USAGE_SCENARIOS,
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
        configSource:
          conventionResolution.source === "repository"
            ? "workingCopy"
            : conventionResolution.source,
        inheritedFromWorkingCopy: conventionResolution.inheritedFromWorkingCopy,
        migrationAvailable: teamState.inherited,
        migrationPreview: state.teamMigration
          ? {
              token: state.teamMigration.token,
              sourcePath: state.teamMigration.sourcePath,
              targetPath: state.teamMigration.targetPath,
              keys: state.teamMigration.plan.keys,
              targetContent: state.teamMigration.plan.targetContent,
              sourceContentAfter: state.teamMigration.plan.sourceContentAfter,
              issues: state.teamMigration.plan.issues,
            }
          : undefined,
        feedback: teamFeedback,
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

  /**
   * v0.0.7 路径详情：把 Webview 传来的工作副本内相对路径还原为范围内
   * 绝对路径；范围外路径一律拒绝，显示路径不得成为写操作身份。
   */
  private resolveScopedAbsolutePath(
    session: WorkbenchSession,
    relativePath: string,
  ): string | undefined {
    const absolutePath = path.resolve(
      session.scope.repositoryRoot,
      relativePath,
    );
    return isPathInScope(session.scope, absolutePath, nativePathSemantics)
      ? absolutePath
      : undefined;
  }

  private async respondFilePathDetail(
    session: WorkbenchSession,
    relativePath: string | undefined,
    requestId: string | undefined,
  ): Promise<void> {
    const respond = async (
      payload: Extract<
        HostToWebviewMessage,
        { type: "file/path-detail-result" }
      >["payload"],
    ): Promise<void> => {
      await this.post({
        protocolVersion: WORKBENCH_PROTOCOL_VERSION,
        type: "file/path-detail-result",
        requestId,
        moduleId: session.moduleId,
        payload,
      });
    };
    if (!relativePath) {
      await respond({ relativePath: "", error: "缺少文件路径。" });
      return;
    }
    const absolutePath = this.resolveScopedAbsolutePath(session, relativePath);
    if (!absolutePath) {
      await respond({
        relativePath,
        error: "路径不在当前操作范围内，已拒绝。",
      });
      return;
    }
    const project = session.scope.project;
    const projectRel = project
      ? projectRelativePath(
          project.projectRoot,
          absolutePath,
          nativePathSemantics,
        )
      : undefined;
    const normalized = normalizeRelative(relativePath);
    // SVN URL 只能由工作副本根检出 URL 推导；repos-root 拼接会产生错误
    // URL（工作副本可能检出自仓库子目录）。信息不可得时如实缺省。
    const svnUrl = session.workingCopyUrl
      ? joinSvnUrl(session.workingCopyUrl, normalized)
      : undefined;
    const repositoryRelativePath =
      session.repositoryRootUrl && session.workingCopyUrl
        ? deriveRepositoryRelativePath(
            session.repositoryRootUrl,
            session.workingCopyUrl,
            normalized,
          )
        : undefined;
    await respond({
      relativePath,
      detail: {
        projectRelativePath:
          projectRel === undefined || projectRel === "."
            ? undefined
            : // 展示边界显式转换：协议展示字段不接受 identity 键。
              toDisplayPath(projectRel),
        workingCopyRelativePath: toDisplayPath(normalized),
        repositoryRelativePath: repositoryRelativePath
          ? toDisplayPath(repositoryRelativePath)
          : undefined,
        svnUrl,
        absolutePath: toDisplayPath(absolutePath),
      },
    });
  }

  /** 本地完整路径的复制只由 Host 完成，不经过 Webview 可写字段。 */
  private async copyFileLocalPath(
    session: WorkbenchSession,
    relativePath: string | undefined,
    requestId: string | undefined,
  ): Promise<void> {
    const absolutePath = relativePath
      ? this.resolveScopedAbsolutePath(session, relativePath)
      : undefined;
    if (!absolutePath) {
      await this.post({
        protocolVersion: WORKBENCH_PROTOCOL_VERSION,
        type: "operation/error",
        requestId,
        moduleId: session.moduleId,
        payload: {
          title: "无法复制完整路径",
          message: "路径缺失或不在当前操作范围内。",
          recoverable: true,
          guidance: ["刷新当前范围后重试。"],
        },
      });
      return;
    }
    await vscode.env.clipboard.writeText(absolutePath);
    await this.post({
      protocolVersion: WORKBENCH_PROTOCOL_VERSION,
      type: "operation/result",
      requestId,
      moduleId: session.moduleId,
      payload: { title: "已复制完整路径", message: absolutePath },
    });
  }

  /**
   * v0.0.7 项目总览（§6.1）：只读优先，允许聚合数量，但不得把多个项目
   * 自动合成一个 operationScope。同一工作副本只采集一次状态再按项目切片。
   */
  private async buildProjectsSnapshot(
    session: WorkbenchSession,
  ): Promise<ProjectsSnapshot> {
    const folders = (vscode.workspace.workspaceFolders ?? []).map((folder) => ({
      name: folder.name,
      absolutePath: folder.uri.fsPath,
    }));
    const items = await Promise.all(
      folders.map(async (folder) => {
        const binding = await this.classifyFolderWorkingCopyBinding(
          folder.absolutePath,
          session.svnPath,
        );
        const workingCopyRoot =
          binding !== "notSvn" && binding !== "missing"
            ? await resolveWorkingCopyRoot(session.svnPath, folder.absolutePath)
            : undefined;
        return {
          name: folder.name,
          absolutePath: folder.absolutePath,
          exists: binding !== "missing",
          binding,
          bindingLabel: workingCopyBindingLabels[binding],
          workingCopyRoot,
          current: session.scope.project
            ? isSamePathIdentity(
                folder.absolutePath,
                session.scope.project.projectRoot,
                nativePathSemantics,
              )
            : false,
        };
      }),
    );
    // 同一工作副本共享一次状态采集，再按项目根切片统计数量。
    const countByProject = new Map<
      string,
      { changes: number; conflicts: number; unversioned: number }
    >();
    const svnProjects = items.filter(
      (item) => item.workingCopyRoot !== undefined,
    );
    const groups = groupProjectsByWorkingCopy(
      svnProjects.map((item) => ({
        absolutePath: item.absolutePath,
        workingCopyRoot: item.workingCopyRoot!,
      })),
      nativePathSemantics,
    );
    await Promise.all(
      [...groups.values()].map(async (group) => {
        const workingCopyRoot = group[0].workingCopyRoot;
        try {
          const scope = createWorkingCopyScope(workingCopyRoot);
          const rules =
            await this.commitSelectionRuleService.getEffectiveRules(
              workingCopyRoot,
            );
          const candidates = await collectCommitCandidates(
            session.svnPath,
            scope,
            { rules },
          );
          for (const project of group) {
            const sliced = sliceCandidatesForProject(
              candidates,
              project.absolutePath,
              nativePathSemantics,
            );
            countByProject.set(project.absolutePath, {
              conflicts: sliced.filter(
                (candidate) => candidate.status === "conflicted",
              ).length,
              unversioned: sliced.filter(
                (candidate) => candidate.status === "unversioned",
              ).length,
              changes: sliced.filter(
                (candidate) =>
                  candidate.status !== "conflicted" &&
                  candidate.status !== "unversioned",
              ).length,
            });
          }
        } catch (error) {
          appendOutput(
            `项目总览统计 ${workingCopyRoot} 失败：${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }),
    );
    return {
      kind: "projects",
      projects: items.map((item) => ({
        ...item,
        counts: countByProject.get(item.absolutePath),
      })),
      generatedAt: new Date().toISOString(),
    };
  }

  /** 为明确项目目标构建独立 scope；不得把多个项目合成一个 scope。 */
  private async buildProjectScope(
    svnPath: string,
    folderPath: string,
  ): Promise<OperationScope | undefined> {
    const workingCopyRoot = await resolveWorkingCopyRoot(svnPath, folderPath);
    if (!workingCopyRoot) return undefined;
    return createScopeFromExplorer(
      workingCopyRoot,
      vscode.Uri.file(folderPath),
      undefined,
      finalizeScopeProject(folderPath, workingCopyRoot, nativePathSemantics),
    );
  }

  /** 项目总览行动作：以明确项目目标打开变更/提交/更新。 */
  private async openProjectTask(
    session: WorkbenchSession,
    projectRoot: string | undefined,
    task: string | undefined,
    requestId: string | undefined,
  ): Promise<void> {
    const taskMap: Record<
      string,
      { moduleId: WorkbenchModuleId; taskId: WorkbenchTaskId }
    > = {
      changes: { moduleId: "changes", taskId: "changes/overview" },
      commit: { moduleId: "commit", taskId: "commit/compose" },
      update: { moduleId: "repository", taskId: "repository/update" },
    };
    const entry = task ? taskMap[task] : undefined;
    const folder = (vscode.workspace.workspaceFolders ?? []).find(
      (candidate) =>
        projectRoot !== undefined &&
        isSamePathIdentity(
          candidate.uri.fsPath,
          projectRoot,
          nativePathSemantics,
        ),
    );
    if (!entry || !projectRoot || !folder) {
      await this.sendError(
        session.moduleId,
        "无法打开项目任务",
        "目标项目不在当前工作区，或任务类型不受支持。",
        true,
        requestId,
      );
      return;
    }
    const scope = await this.buildProjectScope(
      session.svnPath,
      folder.uri.fsPath,
    );
    if (!scope) {
      await this.sendError(
        session.moduleId,
        "无法打开项目任务",
        `项目 ${folder.name} 不属于 SVN 工作副本，不能执行 SVN 任务。`,
        true,
        requestId,
      );
      return;
    }
    const request = buildCrossModuleWindowRequest({
      moduleId: entry.moduleId,
      taskId: entry.taskId,
      svnPath: session.svnPath,
      scope,
    });
    if (
      shouldOpenInOtherWindow(
        entry.moduleId,
        this.servedModule,
        this.onOpenInOtherWindow,
      )
    ) {
      await this.onOpenInOtherWindow!(request);
      return;
    }
    // 同窗口加载新项目：open() 内的项目切换草稿守卫会检查未提交内容。
    await this.open(request);
  }

  /** 范围栏“切换项目”：QuickPick 选择项目或进入项目总览，不静默切换。 */
  private async switchActiveProject(
    session: WorkbenchSession,
    requestId: string | undefined,
  ): Promise<void> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0) {
      await this.sendError(
        session.moduleId,
        "无法切换项目",
        "当前窗口没有打开的工作区项目。",
        true,
        requestId,
      );
      return;
    }
    const overviewItem = {
      label: "$(project) 查看项目总览",
      description: "查看全部项目的归属与变更统计",
      folder: undefined as vscode.WorkspaceFolder | undefined,
    };
    const picked = await vscode.window.showQuickPick(
      [
        overviewItem,
        ...folders.map((folder) => ({
          label: folder.name,
          description: folder.uri.fsPath,
          folder: folder as vscode.WorkspaceFolder | undefined,
        })),
      ],
      { placeHolder: "选择要切换到的项目", canPickMany: false },
    );
    if (!picked) return;
    if (!picked.folder) {
      const request = buildCrossModuleWindowRequest({
        moduleId: "projects",
        taskId: "projects/overview",
        svnPath: session.svnPath,
        scope: session.scope,
      });
      if (
        shouldOpenInOtherWindow(
          "projects",
          this.servedModule,
          this.onOpenInOtherWindow,
        )
      ) {
        await this.onOpenInOtherWindow!(request);
        return;
      }
      await this.open(request);
      return;
    }
    const scope = await this.buildProjectScope(
      session.svnPath,
      picked.folder.uri.fsPath,
    );
    if (!scope) {
      await this.sendError(
        session.moduleId,
        "无法切换项目",
        `项目 ${picked.folder.name} 不属于 SVN 工作副本。`,
        true,
        requestId,
      );
      return;
    }
    // Diff 窗口没有项目级任务，切换到该项目的变更模块。
    const targetModule = this.isDiffWindow() ? "changes" : session.moduleId;
    const request = buildCrossModuleWindowRequest({
      moduleId: targetModule,
      taskId: this.isDiffWindow()
        ? defaultWorkbenchTask("changes")
        : session.taskId,
      svnPath: session.svnPath,
      scope,
    });
    if (
      shouldOpenInOtherWindow(
        targetModule,
        this.servedModule,
        this.onOpenInOtherWindow,
      )
    ) {
      await this.onOpenInOtherWindow!(request);
      return;
    }
    // 同窗口加载新项目：open() 内的项目切换草稿守卫会检查未提交内容。
    await this.open(request);
  }

  /** 是否发生项目切换（双方都有项目上下文且项目根 identity 不同）。 */
  private isProjectSwitch(
    session: WorkbenchSession,
    request: OpenWorkbenchRequest,
  ): boolean {
    const current = session.scope.project?.projectRoot;
    const next = request.scope.project?.projectRoot;
    return (
      current !== undefined &&
      next !== undefined &&
      !isSamePathIdentity(current, next, nativePathSemantics)
    );
  }

  /** 收集当前会话的未完成内容（§8 检查清单）。 */
  private collectSessionUnfinishedContent(
    session: WorkbenchSession,
  ): UnfinishedContentResult {
    return collectUnfinishedContent({
      commitMessage: session.commitState?.message,
      hasManualSelection: (session.commitState?.selectedPaths?.length ?? 0) > 0,
      hasCommitAiResult: session.commitState?.ai !== undefined,
      hasCommitMessageSuggestion:
        session.commitState?.messageSuggestion !== undefined,
      hasCommitPreview: session.commitState?.preview !== undefined,
      hasChangesPreview: session.changesState?.preview !== undefined,
      hasHistoryRestorePreview:
        session.historyState?.restorePreview !== undefined,
      hasConflictResolvePreview:
        session.conflictState?.resolvePreview !== undefined,
      hasConflictAdvice: session.conflictState?.advice !== undefined,
    });
  }

  /**
   * 项目切换三选一确认：返回 true 表示继续切换。取消或“留在当前项目”
   * 返回 false；“保留为当前项目草稿并切换”先暂存草稿再切换。
   */
  private async confirmProjectSwitch(
    session: WorkbenchSession,
    request: OpenWorkbenchRequest,
  ): Promise<boolean> {
    const check = this.collectSessionUnfinishedContent(session);
    if (!check.hasContent) return true;
    const currentName = session.scope.project?.projectName ?? "当前项目";
    const nextName = request.scope.project?.projectName ?? "新项目";
    const choice = await vscode.window.showWarningMessage(
      `从项目 ${currentName} 切换到 ${nextName}：当前项目还有未完成内容（${check.reasons.join("、")}）。`,
      "保留为当前项目草稿并切换",
      "放弃内容并切换",
      "留在当前项目",
    );
    const decision = resolveProjectSwitchDecision(choice);
    if (decision === "stay") {
      this.revealPanel();
      return false;
    }
    if (decision === "stash") {
      this.stashProjectDraft(session);
    }
    // discard：直接继续；会话替换会丢弃状态并撤销旧令牌。
    return true;
  }

  /** 项目草稿只保存提交说明与手动选择，按项目 + 模块 + 范围隔离。 */
  private stashProjectDraft(session: WorkbenchSession): void {
    const projectRoot = session.scope.project?.projectRoot;
    const commit = session.commitState;
    if (!projectRoot || !commit) return;
    const store = this.context.workspaceState.get<ProjectDraftMap>(
      WorkbenchController.PROJECT_DRAFTS_STATE_KEY,
      {},
    );
    const key = projectDraftKey(
      projectRoot,
      session.moduleId,
      session.scopeHash,
      nativePathSemantics,
    );
    void this.context.workspaceState.update(
      WorkbenchController.PROJECT_DRAFTS_STATE_KEY,
      writeProjectDraft(store, key, {
        message: commit.message,
        selectedPaths: commit.selectedPaths ?? [],
        scopeHash: session.scopeHash,
        savedAt: Date.now(),
      }),
    );
  }

  private async restoreProjectDraft(session: WorkbenchSession): Promise<void> {
    const projectRoot = session.scope.project?.projectRoot;
    if (
      !projectRoot ||
      (session.moduleId !== "commit" && session.moduleId !== "changes")
    ) {
      return;
    }
    // §8：只恢复当前 projectId + moduleId + operationScope 的草稿；
    // 同项目同模块但范围不同的草稿不得串用。
    const key = projectDraftKey(
      projectRoot,
      session.moduleId,
      session.scopeHash,
      nativePathSemantics,
    );
    const store = this.context.workspaceState.get<ProjectDraftMap>(
      WorkbenchController.PROJECT_DRAFTS_STATE_KEY,
      {},
    );
    const draft = readProjectDraft(store, key);
    if (!draft || (!draft.message && draft.selectedPaths.length === 0)) {
      return;
    }
    // 取出即移除：恢复一次性生效，状态重新采集由快照构建完成。
    void this.context.workspaceState.update(
      WorkbenchController.PROJECT_DRAFTS_STATE_KEY,
      deleteProjectDraft(store, key),
    );
    // 手动选择与当前候选集合/范围复验：已不存在、越界或不再可选的路径
    // 剔除并反馈，不得恢复成隐式扩大。
    let selectedPaths: string[] = [];
    let dropped = 0;
    let collectionFailed = false;
    if (draft.selectedPaths.length > 0) {
      try {
        const candidates = await this.collectScopeCandidates(session);
        const selectable = new Set(
          candidates
            .filter(
              (candidate) =>
                candidate.selection !== "blocked" &&
                candidate.selection !== "excluded",
            )
            .map((candidate) => normalizeRelative(candidate.relativePath)),
        );
        selectedPaths = draft.selectedPaths.filter((selectedPath) =>
          selectable.has(normalizeRelative(selectedPath)),
        );
        dropped = draft.selectedPaths.length - selectedPaths.length;
      } catch {
        // 安全降级：采集失败时不得恢复未经复验的选择（可能已越界）。
        collectionFailed = true;
      }
    }
    const state = this.ensureCommitState(session);
    state.message = draft.message;
    state.selectedPaths = selectedPaths;
    state.feedback = collectionFailed
      ? {
          tone: "warning",
          message:
            "已恢复该项目保留的提交说明草稿；状态采集失败，旧文件选择未恢复，请刷新后重新选择。",
        }
      : {
          tone: dropped > 0 ? "warning" : "success",
          message:
            dropped > 0
              ? `已恢复该项目保留的提交草稿；${dropped} 个已选路径已不存在、越界或不再可选，已剔除。旧预览与确认令牌不恢复，请重新检查。`
              : "已恢复该项目保留的提交草稿；旧预览与确认令牌不恢复，请重新检查。",
        };
  }

  /**
   * v0.0.7 §9 团队规则迁移预览：把工作副本根的 commitConvention/
   * commitSelection 键迁移到已确认项目根。只生成预览与确认令牌，不写文件。
   */
  private async previewTeamMigration(
    session: WorkbenchSession,
    requestId: string | undefined,
  ): Promise<void> {
    const state = this.ensureSettingsState(session);
    state.teamMigration = undefined;
    const workingCopyRoot = session.scope.repositoryRoot;
    const projectRoot = session.scope.project?.projectRoot;
    if (
      !projectRoot ||
      isSamePathIdentity(projectRoot, workingCopyRoot, nativePathSemantics)
    ) {
      state.teamFeedback = {
        tone: "warning",
        message: "当前项目根与工作副本根重合，无需迁移团队规则。",
      };
      await this.sendSettingsSnapshot(session, requestId);
      return;
    }
    const source = await readSvnWorkbenchConfig(workingCopyRoot);
    const targetPath = getSvnWorkbenchConfigPath(projectRoot);
    const targetExists = await fs.access(targetPath).then(
      () => true,
      () => false,
    );
    const sourceContent = source.exists
      ? await readSvnWorkbenchConfigContent(workingCopyRoot)
      : "";
    const plan = planTeamConfigMigration({
      sourceRaw: source.raw,
      sourceExists: source.exists && source.raw !== undefined,
      targetExists,
      projectRoot,
      workingCopyRoot,
      options: nativePathSemantics,
    });
    state.teamMigration = {
      token: randomUUID(),
      sourcePath: getSvnWorkbenchConfigPath(workingCopyRoot),
      targetPath,
      sourceHash: hashTeamConfigContent(sourceContent),
      plan,
    };
    if (plan.issues.length > 0) {
      state.teamFeedback = {
        tone: "warning",
        message: `迁移预览存在阻止项：${plan.issues[0]}`,
      };
    }
    await this.sendSettingsSnapshot(session, requestId);
  }

  /**
   * v0.0.7 §9 团队规则迁移执行：校验确认令牌，重新校验源哈希、目标存在性
   * 与项目边界后才写文件；只迁移白名单键，不涉及任何凭据或私密材料。
   */
  private async executeTeamMigration(
    session: WorkbenchSession,
    token: string | undefined,
    requestId: string | undefined,
  ): Promise<void> {
    const state = this.ensureSettingsState(session);
    const fail = async (message: string): Promise<void> => {
      state.teamFeedback = { tone: "error", message };
      await this.sendSettingsSnapshot(session, requestId);
    };
    const pending = state.teamMigration;
    if (!pending || pending.token !== token) {
      await fail("迁移预览已过期或不存在，请重新生成迁移预览后再确认。");
      return;
    }
    if (pending.plan.issues.length > 0) {
      await fail(`迁移存在阻止项：${pending.plan.issues[0]}`);
      return;
    }
    const workingCopyRoot = session.scope.repositoryRoot;
    const projectRoot = session.scope.project?.projectRoot;
    if (
      !projectRoot ||
      !isSameOrDescendantPath(
        projectRoot,
        workingCopyRoot,
        nativePathSemantics,
      ) ||
      isSamePathIdentity(projectRoot, workingCopyRoot, nativePathSemantics)
    ) {
      state.teamMigration = undefined;
      await fail("项目边界已变化，迁移已取消；请重新生成迁移预览。");
      return;
    }
    try {
      // 事务执行层：预检（源哈希/目标排他创建）→ 原子替换源 → 失败补偿
      // 回滚 → 执行后复验；任何失败都不会显示成功。
      const result = await executeTeamConfigMigration(
        nodeTeamConfigMigrationIo,
        {
          sourcePath: pending.sourcePath,
          targetPath: pending.targetPath,
          targetContent: pending.plan.targetContent,
          sourceContentAfter: pending.plan.sourceContentAfter,
          expectedSourceHash: pending.sourceHash,
        },
      );
      if (!result.ok) {
        if (result.stage !== "precheck") {
          state.teamMigration = undefined;
        }
        await fail(`${result.error}\n${result.recovery.join("\n")}`);
        return;
      }
      state.teamMigration = undefined;
      this.commitSelectionRuleService.invalidateRepository(
        workingCopyRoot,
        "repository-config",
      );
      this.commitSelectionRuleService.invalidateRepository(
        projectRoot,
        "repository-config",
      );
      state.teamFeedback = {
        tone: "success",
        message: `已把 ${pending.plan.keys.join("、")} 迁移到项目根配置；工作副本根配置中的这些键已移除，其他仍继承工作副本根配置的项目将不再继承这些规则。`,
      };
      await this.sendSettingsSnapshot(session, requestId);
    } catch (error) {
      await fail(
        `迁移团队规则失败：${errorMessage(error)}。请检查两个配置文件状态后重试，或手动复制配置。`,
      );
    }
  }

  /**
   * v0.0.7 工作副本归属分类（releases/v0.0.7 §6.3）：复用工作副本解析器
   * 区分独立工作副本根、上层工作副本、嵌套工作副本、external、非 SVN
   * 与路径不存在。仅当 folder 自身是嵌套根且 SVN 可用时才读取父目录
   * svn:externals 以区分 external；SVN 不可用时按嵌套工作副本报告。
   */
  private async classifyFolderWorkingCopyBinding(
    folderPath: string,
    svnPath: string | undefined,
  ): Promise<WorkingCopyBinding> {
    const exists = await Promise.resolve(
      vscode.workspace.fs.stat(vscode.Uri.file(folderPath)),
    )
      .then(() => true)
      .catch(() => false);
    if (!exists) {
      return "missing";
    }
    const executable = svnPath ?? "svn";
    const workingCopyRoot = await resolveWorkingCopyRoot(
      executable,
      folderPath,
    );
    let parentWorkingCopyRoot: string | undefined;
    let isExternalsTarget: boolean | undefined;
    if (
      workingCopyRoot &&
      isSamePathIdentity(workingCopyRoot, folderPath, nativePathSemantics)
    ) {
      const parentDir = path.dirname(folderPath);
      parentWorkingCopyRoot = await resolveWorkingCopyRoot(
        executable,
        parentDir,
      );
      if (parentWorkingCopyRoot && svnPath) {
        const externals = await runSvnCommand(
          svnPath,
          ["propget", "svn:externals", "--xml", parentDir],
          parentDir,
        );
        // 未设置该属性时 svn 以 W200017 警告退出 1——视为未声明。
        if (externals.exitCode === 0 || externals.stderr.includes("W200017")) {
          const targetNames = new Set(
            parseSvnPropertiesXml(externals.stdout)
              .filter((item) => item.name === "svn:externals")
              .flatMap((item) => parseSvnExternalsTargetNames(item.value)),
          );
          isExternalsTarget = targetNames.has(path.basename(folderPath));
        }
      }
    }
    return classifyWorkingCopyBinding(
      {
        exists,
        folderPath,
        workingCopyRoot,
        parentWorkingCopyRoot,
        isExternalsTarget,
      },
      nativePathSemantics,
    );
  }

  private async buildDiagnosticsSnapshot(): Promise<DiagnosticsSnapshot> {
    const executable = await resolveSvnExecutable();
    const stored = await readStoredAiConfiguration(this.context);
    const workspaces = await Promise.all(
      (vscode.workspace.workspaceFolders ?? []).map(async (folder) => {
        // v0.0.7：诊断复用工作副本解析器，不再只检查 folder 根是否直接
        // 包含 .svn；位于上层工作副本的项目不再被误报为非 SVN。
        const binding = await this.classifyFolderWorkingCopyBinding(
          folder.uri.fsPath,
          executable?.path,
        );
        return {
          name: folder.name,
          path: folder.uri.fsPath,
          isSvnWorkingCopy: isSvnBound(binding),
          binding,
        };
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
    // v0.0.10：变更集文件用当前候选富化（状态/类型/决策/身份键），
    // 候选缺失或无法建立身份键的文件仍展示，只是不可进入选择。
    const rawGroups = await collectSvnChangelists(
      session.svnPath,
      session.scope,
    );
    const candidateByPath = new Map(
      candidates.map((item) => [item.relativePath, item]),
    );
    const groups = rawGroups.map((group) => ({
      name: group.name,
      files: group.paths.map((relativePath) => {
        const candidate = candidateByPath.get(relativePath);
        if (!candidate) return { relativePath };
        const selectionKey = createScopedFileKey(
          session.scope.repositoryRoot,
          candidate.absolutePath,
          nativePathSemantics,
        );
        return {
          relativePath,
          selectionKey,
          status: candidate.status,
          propStatus: candidate.propStatus,
          fileType: candidate.fileType,
          selection: candidate.selection,
          reason: candidate.reason,
        };
      }),
    }));
    const assigned = new Set(
      groups.flatMap((group) => group.files.map((file) => file.relativePath)),
    );
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
        .flatMap((candidate) => {
          const selectionKey = createScopedFileKey(
            session.scope.repositoryRoot,
            candidate.absolutePath,
            nativePathSemantics,
          );
          if (selectionKey === undefined) return [];
          return [
            {
              relativePath: candidate.relativePath,
              selectionKey,
              status: candidate.status,
              propStatus: candidate.propStatus,
              fileType: candidate.fileType,
              selection: candidate.selection,
              reason: candidate.reason,
            },
          ];
        }),
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
          session.scope,
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

  /**
   * v0.0.9 §4：提交说明建议草稿过期判定（与快照 stale 标记同一来源）。
   * binding 与当前范围/候选哈希不匹配即过期：只能查看，不能采用。
   * v0.0.11：工作副本 revision 变化同样使建议过期（证据时效绑定）。
   * 采用（adopt）前必须用它重新校验，不依赖 Webview 回传或快照副本。
   */
  private isCommitMessageSuggestionStale(
    session: WorkbenchSession,
    suggestion: CommitMessageSuggestion,
    candidates: Awaited<ReturnType<typeof collectCommitCandidates>>,
  ): boolean {
    if (suggestion.binding === undefined) {
      return false;
    }
    return isCommitDraftEvidenceStale({
      bindingScopeHash: suggestion.binding.scopeHash,
      currentScopeHash: session.scopeHash,
      bindingCandidateHash: suggestion.binding.candidateHash,
      currentCandidateHash: hashCandidateState(candidates, "", []),
      bindingRevision: suggestion.binding.revision,
      currentRevision: session.workingCopyRevision,
    });
  }

  /**
   * v0.0.11 §3/§9：采集受限差异并构建外发回执（不调用模型）。
   * 返回 pending 回执供 Webview 展示与确认；失败返回 undefined。
   */
  /**
   * v0.0.11 §3：下发受限差异外发回执视图（preview-receipt / retry-failed-diff
   * 共用；payload 不变，只有 pending 内容不同）。
   */
  private async postCommitReceipt(
    pending: NonNullable<CommitSessionState["pendingReceipt"]>,
    requestId?: string,
  ): Promise<void> {
    await this.post({
      protocolVersion: WORKBENCH_PROTOCOL_VERSION,
      type: "commit/receipt",
      requestId,
      moduleId: "commit",
      payload: {
        token: pending.token,
        receipt: pending.receipt,
        coverage: pending.coverage,
        files: pending.files,
        excludedCount: pending.excludedCount,
        historyIncluded: pending.historyIncluded,
        historyCount: pending.historyCount,
        notSent: [
          "本地绝对路径（只发送项目内相对路径）",
          "范围外文件内容",
          "API 密钥、SVN 凭据与证书私密材料",
          "未授权历史（默认不发送；开启时仅脱敏摘要并限条数）",
        ],
        retentionNote:
          "数据保留策略由模型服务商策略决定，本插件无法证明其保留期限。",
      },
    });
  }

  private async collectCommitDiffReceipt(
    session: WorkbenchSession,
    candidates: Awaited<ReturnType<typeof collectCommitCandidates>>,
    selectedAbsolutePaths: string[],
    storedAi: Awaited<ReturnType<typeof readStoredAiConfiguration>>,
    retryNote?: string,
  ): Promise<NonNullable<CommitSessionState["pendingReceipt"]> | undefined> {
    try {
      const collected = await collectLimitedCommitDiffs({
        svnPath: session.svnPath,
        scope: session.scope,
        selectedPaths: selectedAbsolutePaths,
        candidates: this.toCommitDiffCandidateRefs(candidates),
        perFileBudget: COMMIT_DIFF_PER_FILE_BUDGET,
        totalBudget: COMMIT_DIFF_TOTAL_BUDGET,
      });
      const projectId = buildCandidateId(
        session.scope.repositoryRoot,
        session.scope.project?.projectRoot ?? session.scope.repositoryRoot,
      );
      const receipt = buildAnalysisReceipt({
        projectId,
        model: session.aiModels.commitMessage || "本地规则（未配置外部模型）",
        files: collected.fragments.length,
        totalBudget: COMMIT_DIFF_TOTAL_BUDGET,
        perFileBudget: COMMIT_DIFF_PER_FILE_BUDGET,
        historyIncluded: storedAi.includeCommitHistory,
        dataTypes: [
          "项目内相对路径、SVN 状态、脱敏差异片段",
          ...(storedAi.includeCommitHistory ? ["脱敏历史摘要（限条数）"] : []),
        ],
      });
      return {
        token: randomUUID(),
        receipt,
        coverage: collected.summary,
        files: collected.coverage.map((item) => ({
          candidateId: item.candidateId,
          projectRelativePath: toDisplayPath(item.projectRelativePath),
          status: item.status,
          state: item.state,
          diffHash: item.diffHash,
          charCount: item.charCount,
          hunkCount: item.hunkCount,
          reason: item.reason,
        })),
        fragments: collected.fragments,
        revision: collected.revision,
        scopeHash: session.scopeHash,
        candidateHash: hashCandidateState(candidates, "", []),
        excludedCount: collected.excludedCount,
        historyIncluded: storedAi.includeCommitHistory,
        historyCount: storedAi.includeCommitHistory
          ? readTeamMemory(this.context.workspaceState, session.repositoryUuid)
              .entries.length
          : undefined,
        ...(retryNote ? { retryNote } : {}),
      };
    } catch (error) {
      void error;
      return undefined;
    }
  }

  /**
   * v0.0.11：把提交候选映射为受限差异采集所需的候选引用
   * （candidateId 在采集侧按工作副本根 + 绝对路径生成）。
   */
  private toCommitDiffCandidateRefs(
    candidates: Awaited<ReturnType<typeof collectCommitCandidates>>,
  ): CommitDiffCandidateRef[] {
    const projectRoot = this.session?.scope.project?.projectRoot;
    return candidates.map((candidate) => ({
      absolutePath: candidate.absolutePath,
      relativePath: candidate.relativePath,
      status: candidate.status,
      projectRelativePath:
        projectRoot !== undefined
          ? (projectRelativePath(
              projectRoot,
              candidate.absolutePath,
              nativePathSemantics,
            ) ?? candidate.relativePath)
          : candidate.relativePath,
    }));
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
    const rawCandidates =
      providedCandidates ?? (await this.collectScopeCandidates(session));
    // 一次性建立“可生成选择身份的候选 + key”集合：绝对路径无法建立
    // selectionKey（工作副本外/路径失效）者 fail-closed 排除，并从权威
    // 候选、summary、缓存、选择与 AI hash 同步剔除，保证 files/summary/
    // selectedPaths 三处一致（Finding 2）。files 构建不再重复调用
    // createScopedFileKey。
    const keyedCandidates: Array<{
      candidate: CommitCandidate;
      selectionKey: PathIdentityKey;
    }> = [];
    for (const candidate of rawCandidates) {
      const selectionKey = createScopedFileKey(
        session.scope.repositoryRoot,
        candidate.absolutePath,
        nativePathSemantics,
      );
      if (selectionKey === undefined) {
        appendOutput(
          `无法为 ${candidate.relativePath} 建立选择身份，已从提交视图排除。`,
        );
        continue;
      }
      keyedCandidates.push({ candidate, selectionKey });
    }
    const candidates = keyedCandidates.map(({ candidate }) => candidate);
    const summary = summarizeCommitCandidates(candidates);
    // 缓存最近一次权威候选采集：commit/update-selection 逐项复验复用。
    state.candidates = candidates;
    if (!state.selectedPaths) {
      state.selectedPaths = candidates
        .filter((candidate) => candidate.selection === "selected")
        .map((candidate) => candidate.relativePath);
    }
    // 初始路由/草稿恢复/旧状态清理：消失、excluded、blocked 自动移除，
    // 并通过一次性 feedback 说明数量与原因；excluded/blocked 不得以已选
    // 状态进入预览。
    const filtered = filterCommitSelectionByCandidates(
      state.selectedPaths,
      candidates,
    );
    state.selectedPaths = filtered.kept;
    // manualSelectedPaths 同步收敛到“仍保留的当前选择”（保持原手动顺序、
    // 去重）：被刷新移除/失效的路径不得继续污染后续规则/AI provenance 摘要。
    if (state.manualSelectedPaths) {
      const keptSet = new Set(state.selectedPaths);
      const manualSeen = new Set<string>();
      const manualKept: string[] = [];
      for (const relativePath of state.manualSelectedPaths) {
        if (keptSet.has(relativePath) && !manualSeen.has(relativePath)) {
          manualSeen.add(relativePath);
          manualKept.push(relativePath);
        }
      }
      state.manualSelectedPaths = manualKept;
    }
    const removedReasons = filtered.removedReasons;
    if (removedReasons.length > 0 && !state.feedback) {
      state.feedback = {
        tone: "warning",
        message: `刷新后移除 ${removedReasons.length} 个失效选择（${removedReasons
          .slice(0, 3)
          .join(
            "；",
          )}${removedReasons.length > 3 ? "…" : ""}）。请确认当前选择。`,
      };
    }

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
    let feedback = state.feedback;
    state.feedback = undefined;
    // v0.0.9 §4：替换后“撤销替换”入口必须持续可用——只要仍持有替换前
    // 备份，就在每次快照追加撤销提示（不覆盖其他一次性反馈）。
    if (state.messageSuggestionReplaceBackup) {
      const undoText = "已用建议替换提交说明；可撤销替换恢复原内容。";
      feedback = feedback
        ? { ...feedback, message: `${undoText} ${feedback.message}` }
        : { tone: "success", message: undoText };
    }

    // v0.0.9 §4 建议草稿过期判定：复用 AI 结果失效机制——binding 与当前
    // 范围/候选哈希不匹配时标记 stale，只能查看或重新生成，不能采用；
    // 用户草稿 message 保持不变。
    let messageSuggestion = state.messageSuggestion;
    if (
      messageSuggestion &&
      this.isCommitMessageSuggestionStale(
        session,
        messageSuggestion,
        candidates,
      )
    ) {
      messageSuggestion = { ...messageSuggestion, stale: true };
    }

    // v0.0.11 §3：范围/候选变化后旧外发回执失效（fail-closed 在
    // generate-message 复验，这里同步清除避免残留）。
    if (state.pendingReceipt) {
      const currentCandidateHash = hashCandidateState(candidates, "", []);
      if (
        state.pendingReceipt.scopeHash !== session.scopeHash ||
        state.pendingReceipt.candidateHash !== currentCandidateHash
      ) {
        state.pendingReceipt = undefined;
      }
    }

    return {
      kind: "commit",
      files: keyedCandidates.map(({ candidate, selectionKey }) =>
        withProjectFileView(
          {
            relativePath: candidate.relativePath,
            selectionKey,
            status: candidate.status,
            propStatus: candidate.propStatus,
            fileType: candidate.fileType,
            selection: candidate.selection,
            reason: candidate.reason,
            evaluation: candidate.evaluation,
          },
          candidate.absolutePath,
          session.scope,
        ),
      ),
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
      messageSuggestion,
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

  /**
   * 统一 Webview 选择入口（preview / generate-message 共用）：整批校验
   * （validateCommitSelection），任一 missing/excluded/blocked 即拒绝——
   * 保留旧 state、不生成 preview/AI，返回中文错误与恢复动作；合法请求
   * 去重保持首次顺序。调用方必须传入权威候选（避免重复采集）。
   * 返回错误文案；成功返回 undefined。
   */
  private applyWebviewSelection(
    session: WorkbenchSession,
    requested: readonly string[],
    candidates: Awaited<ReturnType<typeof collectCommitCandidates>>,
    options: { trackManualSelection: boolean },
  ): string | undefined {
    const validation = validateCommitSelection(requested, candidates);
    if (validation.missing.length > 0 || validation.notSubmittable.length > 0) {
      return `提交选择包含无效文件：${validation.missing.length} 个不在当前候选集合${validation.notSubmittable.length > 0 ? `，${validation.notSubmittable.length} 个为排除/阻止项` : ""}。已保留原有选择，未做修改；请刷新状态后重新选择。`;
    }
    const state = this.ensureCommitState(session);
    state.selectedPaths = validation.selectedPaths;
    // trackManualSelection：只有 commit/update-selection=true（用户逐项
    // 勾选）；preview/generate-message 即使带回相同 selectedPaths 也只是
    // 回放当前选择，不得创建/覆盖 manualSelectedPaths（否则“应用本地规则/
    // AI → 直接预览/AI 说明”会把推荐集合重新虚构成手动选择）。
    if (options.trackManualSelection) {
      state.manualSelectedPaths = validation.selectedPaths;
    }
    state.preview = undefined;
    return undefined;
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
    providedCandidates?: Awaited<ReturnType<typeof collectCommitCandidates>>,
  ): Promise<void> {
    const state = this.ensureCommitState(session);
    const candidates =
      providedCandidates ?? (await this.collectScopeCandidates(session));
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
    state.messageSuggestion = undefined;
    state.messageSuggestionReplaceBackup = undefined;
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
