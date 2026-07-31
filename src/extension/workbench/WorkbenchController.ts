import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import { buildCommitMessageAiRequest, createMockCommitMessageResult } from '../../ai/commitMessageAiGenerator';
import { buildCommitSelectionAiRequest, createLocalCommitSelectionResult } from '../../ai/commitSelectionAi';
import { validateAiSelectionResult } from '../../ai/aiResultValidator';
import { buildLocalChangeReview, buildLocalImpactAnalysis } from '../../ai/changeIntelligence';
import { buildConflictAiRequest, containsSvnConflictMarkers, createMockConflictAdvice } from '../../ai/conflictAiAdvisor';
import {
  AI_API_KEY_SECRET_KEY,
  AI_PROVIDER_PRESETS,
  AI_USAGE_SCENARIOS,
  normalizeAiBaseUrl,
  readStoredAiConfiguration,
  saveAiConfiguration,
  validateAiProviderConfig,
  type AiProviderPresetId,
  type AiUsageScenario
} from '../../ai/aiModelConfiguration';
import { OpenAiCompatibleProvider } from '../../ai/openAiCompatibleProvider';
import { buildTeamRulesAiRequest, createLocalTeamRulesRecommendation } from '../../ai/teamRulesAiRecommender';
import { appendTeamMemory, clearTeamMemory, readTeamMemory } from '../../ai/teamMemory';
import { buildCommitSplitAiRequest, createLocalCommitSplitResult, validateCommitSplitResult } from '../../ai/commitSplitAi';
import { applySvnChangelist, collectSvnChangelists } from '../../changelist/svnChangelists';
import { collectCommitCandidates, summarizeCommitCandidates } from '../../commit/commitCandidateCollector';
import { collectCommitDiffSummaries } from '../../commit/commitDiffSummary';
import {
  buildCommitConventionConfigFromEditorInput,
  formatCommitConventionList,
  readCommitConventionEditState,
  resolveCommitConventionConfig,
  saveProjectCommitConventionConfig,
  toAiCommitConventionHint,
  validateCommitConventionConfig,
  validateCommitMessageConvention,
  type CommitConventionConfig
} from '../../commit/commitConvention';
import { runCommitFlow } from '../../commit/commitFlow';
import { buildCommitPlanPreview, toCommitFlowPlan } from '../../commit/commitPlanBuilder';
import { applyCommitMessageTemplate, defaultCommitMessageTemplates, validateCommitMessage } from '../../commit/commitMessageTemplates';
import { checkPreCommitRemoteUpdates } from '../../commit/preCommitRemoteCheck';
import { acceptanceChecklistSections, formatAcceptanceChecklistMarkdown, summarizeAcceptanceChecklist } from '../../diagnostics/acceptanceChecklist';
import { buildEnvironmentDiagnosticReport, formatEnvironmentDiagnosticReport } from '../../diagnostics/environmentDiagnostics';
import { appendOutput, sanitizeDiagnostic, showOutput } from '../../diagnostics/outputChannel';
import { collectSvnHistory } from '../../history/svnHistory';
import { collectConflictItems } from '../../conflict/conflictCollector';
import { buildResolveConflictPreview, resolveConflictUsingWorking } from '../../conflict/conflictResolver';
import {
  WORKBENCH_PROTOCOL_VERSION,
  defaultWorkbenchTask,
  isWebviewToHostMessage,
  isWorkbenchModuleId,
  isWorkbenchTaskForModule,
  type DiffSnapshot,
  type CommitPlanView,
  type CommitSnapshot,
  type AgentSnapshot,
  type DiagnosticsSnapshot,
  type HostToWebviewMessage,
  type SettingsSnapshot,
  type WebviewToHostMessage,
  type WorkbenchModuleId,
  type WorkbenchModuleSnapshot,
  type WorkbenchScopeView,
  type WorkbenchTaskId
} from '../../protocol/workbenchProtocol';
import { OperationScope } from '../../scope/operationScope';
import { validatePathsInScope } from '../../scope/pathBoundaryGuard';
import { deleteStoredSvnCredential, readStoredSvnCredential, storeSvnCredential } from '../../security/svnCredentialStore';
import {
  clearSvnSecurityContext,
  setSvnSecurityContext,
  type SvnAuthenticationContext,
  type SvnCertificateTrustContext
} from '../../security/svnSecurityContext';
import { collectSvnProperties, validatePropertyEdit } from '../../properties/svnProperties';
import { buildReleaseNotes, parseSvnListXml, validatePatchText, validateRepositoryUrl } from '../../repository/advancedRepositoryTools';
import { parseInfoXml } from '../../svn/parsers/infoXmlParser';
import { runSvnCommand } from '../../svn/svnCommandRunner';
import { classifySvnFailure, extractSvnCertificateDetails, type SvnCertificateDetails } from '../../svn/svnErrorClassifier';
import { resolveSvnExecutable } from '../../svn/svnExecutableResolver';
import { buildUpdateScopePreview, checkUpdateScopeRemoteChanges, runUpdateScope, summarizeUpdateScopeRisk } from '../../update/updateFlow';
import { readWebviewAssets } from './WebviewAssetManifest';
import { renderWebviewBuildError, renderWebviewShell } from './renderWebviewShell';

export interface OpenWorkbenchRequest {
  moduleId: WorkbenchModuleId;
  taskId?: WorkbenchTaskId;
  svnPath: string;
  scope: OperationScope;
  targetFile?: string;
  selectedPaths?: string[];
  initialFileOperation?: { operation: 'add' | 'ignore' | 'revert' | 'lock' | 'unlock'; ignoreMode?: 'directory' | 'repository' };
}

interface WorkbenchSession extends OpenWorkbenchRequest {
  taskId: WorkbenchTaskId;
  scopeView: WorkbenchScopeView;
  repositoryUuid: string;
  scopeHash: string;
  aiModels: Partial<Record<AiUsageScenario, string>>;
  security: {
    authentication?: SvnAuthenticationContext;
    hasStoredAuthentication: boolean;
    certificateTrust?: SvnCertificateTrustContext;
    lastCertificate?: SvnCertificateDetails;
  };
  recoveryState?: NonNullable<import('../../protocol/workbenchProtocol').RepositorySnapshot['recovery']>;
  commitState?: CommitSessionState;
  historyState?: {
    selectedRevision?: string;
    compareRevisions: string[];
    blame?: import('../../protocol/workbenchProtocol').HistorySnapshot['blame'];
    restorePreview?: {
      token: string;
      contentHash: string;
      revision: string;
      relativePath: string;
      issues: string[];
    };
    feedback?: string;
  };
  conflictState?: {
    selectedPath?: string;
    advice?: import('../../protocol/workbenchProtocol').ConflictSnapshot['advice'];
    resolvePreview?: {
      token: string;
      contentHash: string;
      relativePath: string;
    };
    editState?: {
      token: string;
      contentHash: string;
      relativePath: string;
      feedback?: string;
    };
  };
  settingsState?: {
    models: Array<{ id: string; owner?: string }>;
    aiFeedback?: SettingsSnapshot['ai']['feedback'];
    recommendedTeamConfig?: CommitConventionConfig;
    recommendation?: SettingsSnapshot['team']['recommendation'];
  };
  repositoryState?: {
    update?: import('../../protocol/workbenchProtocol').RepositorySnapshot['update'];
    candidateHash?: string;
    lastResult?: import('../../protocol/workbenchProtocol').RepositorySnapshot['lastResult'];
    propertyPreview?: {
      token: string;
      stateHash: string;
      target: string;
      name: string;
      value: string;
      remove: boolean;
      issues: string[];
    };
    propertyFeedback?: string;
    cleanupPreview?: { token: string; target: string; issues: string[] };
    cleanupFeedback?: string;
    advanced?: {
      browser?: import('../../protocol/workbenchProtocol').RepositorySnapshot['advanced']['browser'];
      releaseNotes?: import('../../protocol/workbenchProtocol').RepositorySnapshot['advanced']['releaseNotes'];
      feedback?: string;
      preview?: {
        token: string;
        candidateHash: string;
        operation: NonNullable<import('../../protocol/workbenchProtocol').RepositorySnapshot['advanced']['preview']>['operation'];
        title: string;
        commands: string[];
        details: string[];
        issues: string[];
        destructive: boolean;
        input: Record<string, string>;
      };
    };
  };
  changelistState?: {
    suggestions: import('../../protocol/workbenchProtocol').ChangelistsSnapshot['suggestions'];
    warnings: string[];
    source: 'local-rule' | 'configured-model' | 'local-rule-fallback';
    fallbackReason?: string;
    feedback?: string;
    preview?: {
      token: string;
      candidateHash: string;
      name?: string;
      remove: boolean;
      paths: string[];
      issues: string[];
    };
  };
  agentState?: {
    snapshot: AgentSnapshot;
    candidateHash: string;
  };
  changesState?: {
    preview?: {
      token: string;
      candidateHash: string;
      operation: NonNullable<import('../../protocol/workbenchProtocol').ChangesSnapshot['operationPreview']>['operation'];
      ignoreMode?: 'directory' | 'repository';
      paths: string[];
      issues: string[];
    };
    feedback?: string;
  };
  activeOperation?: {
    moduleId: WorkbenchModuleId;
    controller: AbortController;
  };
}

interface CommitSessionState {
  message: string;
  selectedPaths?: string[];
  preview?: {
    token: string;
    stateHash: string;
    plan: ReturnType<typeof buildCommitPlanPreview>;
    view: CommitPlanView;
  };
  ai?: CommitSnapshot['ai'];
}

const MAX_DIFF_BYTES = 5 * 1024 * 1024;
const MAX_PATCH_BYTES = 20 * 1024 * 1024;

export class WorkbenchController implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private session: WorkbenchSession | undefined;
  private ready = false;
  private disposed = false;
  private readonly latestModuleRequests = new Map<WorkbenchModuleId, string>();

  constructor(private readonly context: vscode.ExtensionContext) {}

  async open(request: OpenWorkbenchRequest): Promise<void> {
    if (this.disposed) {
      throw new Error('SVN 工作台控制器已释放。');
    }
    if (this.session?.activeOperation) {
      this.panel?.reveal(vscode.ViewColumn.One, false);
      await vscode.window.showWarningMessage('SVN 工作台正在执行可取消操作。请先等待完成或在进度条中取消，再切换仓库与范围。');
      return;
    }

    const taskId = request.taskId ?? defaultWorkbenchTask(request.moduleId);
    if (!isWorkbenchTaskForModule(taskId, request.moduleId)) {
      throw new Error('请求的工作台子任务与功能模块不匹配。');
    }

    this.latestModuleRequests.clear();
    if (this.session) clearSvnSecurityContext(this.session.scope.repositoryRoot);
    const storedAi = await readStoredAiConfiguration(this.context);
    const repositoryUuid = await resolveRepositoryUuid(request.svnPath, request.scope);
    const storedAuthentication = await readStoredSvnCredential(this.context.secrets, repositoryUuid);
    this.session = {
      ...request,
      taskId,
      scopeView: toScopeView(request.scope),
      repositoryUuid,
      scopeHash: hashOperationScope(request.scope),
      aiModels: buildScenarioModelMap(storedAi),
      security: {
        authentication: storedAuthentication,
        hasStoredAuthentication: Boolean(storedAuthentication)
      }
    };
    this.syncSvnSecurityContext(this.session);
    const panel = await this.ensurePanel();
    panel.title = getModuleTitle(request.moduleId, taskId);
    panel.reveal(vscode.ViewColumn.One, false);

    if (this.ready) {
      await this.sendInitialize();
      await this.loadModule(request.moduleId, request.targetFile);
      await this.prepareInitialFileOperation(this.session);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.session?.activeOperation?.controller.abort();
    if (this.session) clearSvnSecurityContext(this.session.scope.repositoryRoot);
    this.panel?.dispose();
    this.panel = undefined;
    this.session = undefined;
  }

  private async ensurePanel(): Promise<vscode.WebviewPanel> {
    if (this.panel) {
      return this.panel;
    }

    const localResourceRoot = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview');
    const panel = vscode.window.createWebviewPanel(
      'svnWorkbench.unified',
      'SVN 工作台',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: false,
        localResourceRoots: [localResourceRoot]
      }
    );
    this.panel = panel;
    this.ready = false;

    panel.onDidDispose(() => {
      this.panel = undefined;
      this.ready = false;
    }, undefined, this.context.subscriptions);
    panel.webview.onDidReceiveMessage((message: unknown) => {
      void this.handleMessage(message);
    }, undefined, this.context.subscriptions);

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
      appendOutput('已拒绝格式无效的 SVN 工作台 Webview 消息。');
      return;
    }

    if (value.type === 'webview/ready') {
      this.ready = true;
      await this.sendInitialize();
      if (this.session) {
        await this.loadModule(this.session.moduleId, this.session.targetFile);
        await this.prepareInitialFileOperation(this.session);
      }
      return;
    }

    await this.handleAction(value);
  }

  private async handleAction(message: Extract<WebviewToHostMessage, { type: 'workbench/action' }>): Promise<void> {
    const session = this.session;
    if (!session) {
      return;
    }
    if (message.repositoryUuid !== session.repositoryUuid || message.scopeHash !== session.scopeHash || message.taskId !== session.taskId) {
      appendOutput('已拒绝仓库或范围标识过期的 SVN 工作台消息。');
      await this.sendError(session.moduleId, '操作上下文已过期', '仓库或右键范围已变化，请重新打开当前功能模块。', false, message.requestId);
      return;
    }
    const data = message.payload.data ?? {};

    switch (message.payload.action) {
      case 'refresh':
        await this.loadModule(session.moduleId, session.targetFile, message.requestId);
        return;
      case 'open-module': {
        const moduleId = data.moduleId;
        if (!isWorkbenchModuleId(moduleId)) {
          await this.sendError(session.moduleId, '无法打开模块', '请求的工作台模块不存在。', false, message.requestId);
          return;
        }
        const taskId = data.taskId ?? defaultWorkbenchTask(moduleId);
        if (!isWorkbenchTaskForModule(taskId, moduleId)) {
          await this.sendError(session.moduleId, '无法打开任务', '请求的子任务不属于当前功能模块。', false, message.requestId);
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
      case 'open-diff': {
        const relativePath = asString(data.relativePath);
        if (!relativePath) {
          await this.sendError(session.moduleId, '无法打开差异', '没有收到文件路径。', true, message.requestId);
          return;
        }
        const absolutePath = path.resolve(session.scope.repositoryRoot, relativePath);
        const validation = validatePathsInScope(session.scope, [absolutePath]);
        if (validation.outOfScopeItems.length > 0) {
          await this.sendError(session.moduleId, '范围校验失败', '该文件不在当前右键操作范围内。', false, message.requestId);
          return;
        }
        session.moduleId = 'diff';
        session.taskId = defaultWorkbenchTask('diff');
        session.targetFile = absolutePath;
        this.panel!.title = getModuleTitle('diff', session.taskId);
        await this.loadModule('diff', absolutePath, message.requestId);
        return;
      }
      case 'open-file': {
        const relativePath = asString(data.relativePath);
        if (!relativePath) {
          return;
        }
        const absolutePath = path.resolve(session.scope.repositoryRoot, relativePath);
        if (validatePathsInScope(session.scope, [absolutePath]).outOfScopeItems.length > 0) {
          await this.sendError(session.moduleId, '范围校验失败', '无法打开范围外文件。', false, message.requestId);
          return;
        }
        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(absolutePath));
        await vscode.window.showTextDocument(document, { preview: true });
        return;
      }
      case 'copy-text': {
        const text = asString(data.text);
        if (text) {
          await vscode.env.clipboard.writeText(text);
        }
        return;
      }
      case 'security/configure-authentication':
        await this.configureAuthentication(session, message.requestId);
        return;
      case 'security/clear-authentication':
        await this.clearAuthentication(session, message.requestId);
        return;
      case 'security/review-certificate':
        await this.reviewCertificate(session, message.requestId);
        return;
      case 'security/open-proxy-settings':
        await vscode.commands.executeCommand('workbench.action.openSettings', '@id:http.proxy');
        return;
      case 'operation/cancel': {
        const active = session.activeOperation;
        if (active) {
          active.controller.abort();
          await this.post({
            protocolVersion: WORKBENCH_PROTOCOL_VERSION,
            type: 'operation/cancelled',
            requestId: message.requestId,
            moduleId: active.moduleId,
            payload: { title: '正在取消操作', message: '已向 SVN 进程发送终止请求；完成后将重新采集状态。' }
          });
        }
        return;
      }
      case 'commit/update-draft': {
        const state = this.ensureCommitState(session);
        state.message = asStringAllowEmpty(data.message) ?? state.message;
        state.preview = undefined;
        await this.sendCommitSnapshot(session, message.requestId);
        return;
      }
      case 'commit/update-selection': {
        const selectedPaths = asStringArray(data.selectedPaths) ?? [];
        const absolutePaths = selectedPaths.map((item) => path.resolve(session.scope.repositoryRoot, item));
        const validation = validatePathsInScope(session.scope, absolutePaths);
        if (validation.outOfScopeItems.length > 0) {
          await this.sendError('commit', '范围校验失败', '提交选择包含当前右键范围之外的文件。', false, message.requestId);
          return;
        }
        const state = this.ensureCommitState(session);
        state.selectedPaths = selectedPaths;
        state.preview = undefined;
        await this.sendCommitSnapshot(session, message.requestId);
        return;
      }
      case 'commit/ai-select': {
        const candidates = await collectCommitCandidates(session.svnPath, session.scope);
        const allowedPaths = candidates.map((item) => item.absolutePath);
        const request = buildCommitSelectionAiRequest(session.scope, candidates);
        let result = createLocalCommitSelectionResult(candidates);
        let source: 'local-rule' | 'configured-model' | 'local-rule-fallback' = 'local-rule';
        let fallbackReason: string | undefined;
        try {
          const config = await this.resolveStoredAiProvider('commitSelection');
          result = await new OpenAiCompatibleProvider(config).selectFiles(request);
          source = 'configured-model';
        } catch (error) {
          source = 'local-rule-fallback';
          fallbackReason = errorMessage(error);
        }
        const validated = validateAiSelectionResult(session.scope, result, allowedPaths);
        const state = this.ensureCommitState(session);
        state.selectedPaths = validated.recommended
          .map((item) => normalizeRelative(path.relative(session.scope.repositoryRoot, item.path)))
          .filter((relativePath) => candidates.some((candidate) => candidate.relativePath === relativePath && candidate.selection !== 'blocked' && candidate.selection !== 'excluded'));
        state.preview = undefined;
        state.ai = {
          source,
          summary: `建议选择 ${state.selectedPaths.length} 个文件；${validated.needsReview.length} 个需要人工确认，${validated.excluded.length} 个建议排除。`,
          warnings: validated.blocked.length > 0 ? [`${validated.blocked.length} 个阻止项未进入选择。`] : [],
          fallbackReason
        };
        await this.sendCommitSnapshot(session, message.requestId, candidates);
        return;
      }
      case 'commit/apply-template': {
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
      case 'commit/generate-message': {
        const state = this.ensureCommitState(session);
        state.message = asStringAllowEmpty(data.message) ?? state.message;
        state.selectedPaths = asStringArray(data.selectedPaths) ?? state.selectedPaths;
        const candidates = await collectCommitCandidates(session.svnPath, session.scope);
        const selectedAbsolutePaths = this.resolveSelectedAbsolutePaths(session, candidates);
        const convention = await resolveCommitConventionConfig(session.scope.repositoryRoot);
        const diffSummaries = await collectCommitDiffSummaries(session.svnPath, session.scope, selectedAbsolutePaths);
        const storedAi = await readStoredAiConfiguration(this.context);
        const recentHistory = storedAi.includeCommitHistory
          ? readTeamMemory(this.context.workspaceState, session.repositoryUuid).entries.slice(0, storedAi.historyLimit).map((entry) => ({ revision: entry.revision, summary: entry.summary }))
          : undefined;
        const request = buildCommitMessageAiRequest(session.scope, candidates, selectedAbsolutePaths, diffSummaries, {
          currentMessage: state.message,
          convention: toAiCommitConventionHint(convention.config),
          recentHistory
        });
        let result = createMockCommitMessageResult(request);
        let source: 'local-rule' | 'configured-model' | 'local-rule-fallback' = 'local-rule';
        let fallbackReason: string | undefined;
        try {
          const config = await this.resolveStoredAiProvider('commitMessage');
          result = await new OpenAiCompatibleProvider(config).generateCommitMessage(request);
          source = 'configured-model';
        } catch (error) {
          source = 'local-rule-fallback';
          fallbackReason = errorMessage(error);
        }
        state.message = result.message;
        state.preview = undefined;
        state.ai = {
          source,
          summary: result.summary,
          warnings: result.warnings,
          fallbackReason
        };
        await this.sendCommitSnapshot(session, message.requestId, candidates);
        return;
      }
      case 'commit/preview': {
        const state = this.ensureCommitState(session);
        state.message = asStringAllowEmpty(data.message) ?? state.message;
        state.selectedPaths = asStringArray(data.selectedPaths) ?? state.selectedPaths;
        await this.createCommitPreview(session, message.requestId);
        return;
      }
      case 'commit/execute': {
        const previewToken = asString(data.previewToken);
        await this.executeCommit(session, previewToken, message.requestId);
        return;
      }
      case 'history/select': {
        const revision = asRevision(data.revision);
        if (!revision) {
          return;
        }
        session.historyState = {
          ...session.historyState,
          selectedRevision: revision,
          compareRevisions: asRevisionArray(data.compareRevisions)
        };
        await this.sendHistorySnapshot(session, message.requestId);
        return;
      }
      case 'history/compare': {
        const revisions = asRevisionArray(data.revisions);
        if (revisions.length !== 2) {
          await this.sendError('history', '无法比较修订', '请选择两个修订后再比较。', true, message.requestId);
          return;
        }
        const ordered = [...revisions].sort((left, right) => Number(left) - Number(right));
        const targetPaths = session.scope.roots.map((root) => root.absolutePath);
        const result = await runSvnCommand(
          session.svnPath,
          ['diff', '-r', `${ordered[0]}:${ordered[1]}`, ...targetPaths],
          session.scope.repositoryRoot,
          { maxOutputBytes: MAX_DIFF_BYTES }
        );
        if (result.exitCode !== 0 && !result.truncated) {
          await this.sendError('history', '修订比较失败', result.stderr || 'SVN diff 执行失败。', true, message.requestId);
          return;
        }
        session.moduleId = 'diff';
        session.taskId = defaultWorkbenchTask('diff');
        session.targetFile = undefined;
        this.panel!.title = getModuleTitle('diff', session.taskId);
        const diffBuffer = Buffer.from(result.stdout, 'utf8');
        const snapshot: DiffSnapshot = {
          kind: 'diff',
          relativePath: `${session.scope.roots.map((root) => root.relativePath).join(', ')} · r${ordered[0]} → r${ordered[1]}`,
          original: '',
          modified: truncateUtf8(diffBuffer),
          language: 'diff',
          truncated: Boolean(result.truncated) || diffBuffer.byteLength >= MAX_DIFF_BYTES,
          binary: false,
          message: result.truncated ? `修订比较 r${ordered[0]} → r${ordered[1]}（超过 5 MB，已截断）` : `修订比较 r${ordered[0]} → r${ordered[1]}`
        };
        await this.post({
          protocolVersion: WORKBENCH_PROTOCOL_VERSION,
          type: 'module/snapshot',
          requestId: message.requestId,
          moduleId: 'diff',
          payload: { snapshot }
        });
        return;
      }
      case 'history/blame': {
        const fileRoot = getSingleFileScopeRoot(session.scope);
        if (!fileRoot) {
          await this.sendError('history', '无法查看 Blame', 'Blame 仅适用于从单个文件进入的范围。', true, message.requestId);
          return;
        }
        const result = await runSvnCommand(session.svnPath, ['blame', fileRoot.absolutePath], session.scope.repositoryRoot);
        if (result.exitCode !== 0) {
          await this.sendError('history', 'Blame 读取失败', result.stderr || 'SVN blame 执行失败。', true, message.requestId);
          return;
        }
        const state = session.historyState ?? { compareRevisions: [] };
        state.blame = parseBlameOutput(result.stdout);
        state.feedback = `已读取 ${state.blame.length} 行 Blame 信息。`;
        session.historyState = state;
        await this.sendHistorySnapshot(session, message.requestId);
        return;
      }
      case 'history/preview-restore': {
        const fileRoot = getSingleFileScopeRoot(session.scope);
        const revision = asRevision(data.revision) ?? session.historyState?.selectedRevision;
        if (!fileRoot || !revision) {
          await this.sendError('history', '无法生成恢复预览', '请选择单个文件和一个有效修订。', true, message.requestId);
          return;
        }
        const cat = await runSvnCommand(session.svnPath, ['cat', '-r', revision, fileRoot.absolutePath], session.scope.repositoryRoot);
        const issues: string[] = [];
        if (cat.exitCode !== 0) issues.push(cat.stderr || `无法读取 r${revision} 文件内容。`);
        const buffer = Buffer.from(cat.stdout, 'utf8');
        if (buffer.byteLength > MAX_DIFF_BYTES) issues.push('目标修订文件超过 5 MB，工作台不执行覆盖恢复。');
        if (containsNull(buffer)) issues.push('目标修订疑似二进制文件，请使用专用恢复流程。');
        const state = session.historyState ?? { compareRevisions: [] };
        state.restorePreview = {
          token: randomUUID(), contentHash: await hashFileContentsOrMissing(fileRoot.absolutePath), revision,
          relativePath: normalizeRelative(fileRoot.relativePath), issues
        };
        state.feedback = undefined;
        session.historyState = state;
        await this.sendHistorySnapshot(session, message.requestId);
        return;
      }
      case 'history/execute-restore': {
        const token = asString(data.previewToken);
        const preview = session.historyState?.restorePreview;
        const fileRoot = getSingleFileScopeRoot(session.scope);
        if (!token || !preview || token !== preview.token || preview.issues.length > 0 || !fileRoot) {
          await this.sendError('history', '恢复预览已失效', '请重新生成文件恢复预览。', true, message.requestId);
          return;
        }
        if (await hashFileContentsOrMissing(fileRoot.absolutePath) !== preview.contentHash) {
          session.historyState!.restorePreview = undefined;
          await this.sendError('history', '工作副本文件已变化', '当前文件与预览时不同，请重新检查后恢复。', true, message.requestId);
          return;
        }
        const cat = await runSvnCommand(session.svnPath, ['cat', '-r', preview.revision, fileRoot.absolutePath], session.scope.repositoryRoot);
        const buffer = Buffer.from(cat.stdout, 'utf8');
        if (cat.exitCode !== 0 || buffer.byteLength > MAX_DIFF_BYTES || containsNull(buffer)) {
          await this.sendError('history', '恢复文件失败', cat.stderr || '目标修订内容不满足安全恢复条件。', true, message.requestId);
          return;
        }
        await fs.writeFile(fileRoot.absolutePath, buffer);
        session.historyState!.restorePreview = undefined;
        session.historyState!.feedback = `${preview.relativePath} 已恢复为 r${preview.revision} 内容；尚未提交。`;
        await this.sendHistorySnapshot(session, message.requestId);
        return;
      }
      case 'conflict/select': {
        const relativePath = asString(data.relativePath);
        if (!relativePath) {
          return;
        }
        session.conflictState = { selectedPath: relativePath };
        await this.sendConflictSnapshot(session, message.requestId);
        return;
      }
      case 'conflict/advise': {
        const selectedPath = asString(data.relativePath) ?? session.conflictState?.selectedPath;
        if (!selectedPath) {
          return;
        }
        const conflicts = await collectConflictItems(session.svnPath, session.scope);
        const conflict = conflicts.find((item) => item.relativePath === selectedPath);
        if (!conflict) {
          await this.sendError('conflicts', '冲突已变化', '当前冲突不存在，请刷新状态。', true, message.requestId);
          return;
        }
        const request = await buildConflictAiRequest(conflict);
        let advice = createMockConflictAdvice(request);
        let source: 'local-rule' | 'configured-model' | 'local-rule-fallback' = 'local-rule';
        let fallbackReason: string | undefined;
        try {
          const config = await this.resolveStoredAiProvider('conflictAdvice');
          advice = await new OpenAiCompatibleProvider(config).adviseConflict(request);
          source = 'configured-model';
        } catch (error) {
          source = 'local-rule-fallback';
          fallbackReason = errorMessage(error);
        }
        session.conflictState = {
          ...session.conflictState,
          selectedPath,
          advice: { ...advice, source, fallbackReason }
        };
        await this.sendConflictSnapshot(session, message.requestId, conflicts);
        return;
      }
      case 'conflict/save-working': {
        const token = asString(data.editToken);
        const content = asStringAllowEmpty(data.content);
        const editState = session.conflictState?.editState;
        if (!token || content === undefined || !editState || token !== editState.token) {
          await this.sendError('conflicts', '合并草稿已失效', '请重新选择冲突文件并再次编辑。', true, message.requestId);
          return;
        }
        const absolutePath = path.resolve(session.scope.repositoryRoot, editState.relativePath);
        if (validatePathsInScope(session.scope, [absolutePath]).outOfScopeItems.length > 0) {
          await this.sendError('conflicts', '范围校验失败', '合并目标已离开当前右键范围。', false, message.requestId);
          return;
        }
        if (await hashFileContents(absolutePath) !== editState.contentHash) {
          session.conflictState!.editState = undefined;
          await this.sendError('conflicts', '工作副本文件已变化', '编辑器外部已修改该文件，请重新加载后合并。', true, message.requestId);
          return;
        }
        const buffer = Buffer.from(content, 'utf8');
        if (buffer.byteLength > MAX_DIFF_BYTES || containsNull(buffer)) {
          await this.sendError('conflicts', '合并内容不安全', '文本超过 5 MB 或包含二进制空字节，工作台未写入。', false, message.requestId);
          return;
        }
        await fs.writeFile(absolutePath, buffer, { flag: 'w' });
        session.conflictState!.resolvePreview = undefined;
        session.conflictState!.editState = {
          token: randomUUID(), contentHash: await hashFileContents(absolutePath), relativePath: editState.relativePath,
          feedback: containsSvnConflictMarkers(content) ? '工作副本内容已保存，但仍有冲突标记；请继续逐块处理。' : '工作副本合并结果已保存；请生成解决预览。'
        };
        await this.sendConflictSnapshot(session, message.requestId);
        return;
      }
      case 'conflict/preview-resolve': {
        const selectedPath = asString(data.relativePath) ?? session.conflictState?.selectedPath;
        if (!selectedPath) {
          return;
        }
        const absolutePath = path.resolve(session.scope.repositoryRoot, selectedPath);
        const preview = buildResolveConflictPreview(session.scope, absolutePath);
        const workingContent = await fs.readFile(absolutePath, 'utf8');
        if (containsSvnConflictMarkers(workingContent)) {
          preview.issues.push('工作副本中仍有 SVN 冲突标记，不能标记为已解决。');
          preview.canResolve = false;
        }
        const contentHash = await hashFileContents(absolutePath);
        session.conflictState = {
          ...session.conflictState,
          selectedPath,
          resolvePreview: { token: randomUUID(), contentHash, relativePath: selectedPath }
        };
        await this.sendConflictSnapshot(session, message.requestId, undefined, preview);
        return;
      }
      case 'conflict/resolve': {
        const token = asString(data.previewToken);
        const previewState = session.conflictState?.resolvePreview;
        if (!token || !previewState || token !== previewState.token) {
          await this.sendError('conflicts', '解决预览已失效', '请重新生成解决预览。', true, message.requestId);
          return;
        }
        const absolutePath = path.resolve(session.scope.repositoryRoot, previewState.relativePath);
        if (await hashFileContents(absolutePath) !== previewState.contentHash) {
          session.conflictState!.resolvePreview = undefined;
          await this.sendError('conflicts', '工作副本文件已变化', '请检查保存内容并重新生成解决预览。', true, message.requestId);
          return;
        }
        const result = await resolveConflictUsingWorking(session.svnPath, session.scope, absolutePath);
        if (!result.resolved) {
          await this.sendError('conflicts', '标记解决失败', result.result.stderr || result.result.stdout || '未知错误', true, message.requestId);
          return;
        }
        session.conflictState = undefined;
        await this.post({
          protocolVersion: WORKBENCH_PROTOCOL_VERSION,
          type: 'operation/result',
          requestId: message.requestId,
          moduleId: 'conflicts',
          payload: { title: '冲突已标记解决', message: previewState.relativePath }
        });
        await this.sendConflictSnapshot(session, message.requestId);
        return;
      }
      case 'settings/save-ai': {
        try {
          const input = toAiConfigurationInput(data);
          await saveAiConfiguration(this.context, input);
          session.aiModels = buildScenarioModelMap(await readStoredAiConfiguration(this.context));
          const state = this.ensureSettingsState(session);
          state.aiFeedback = { tone: 'success', message: 'AI 模型配置已保存，密钥仍仅存于 SecretStorage。' };
          await this.sendSettingsSnapshot(session, message.requestId);
        } catch (error) {
          await this.updateSettingsFeedback(session, 'error', errorMessage(error), message.requestId);
        }
        return;
      }
      case 'settings/test-ai': {
        try {
          const provider = await this.createAiProviderFromAction(data);
          await provider.testConnection();
          await this.updateSettingsFeedback(session, 'success', '连接成功，模型返回了有效响应。', message.requestId);
        } catch (error) {
          await this.updateSettingsFeedback(session, 'error', `连接失败：${errorMessage(error)}`, message.requestId);
        }
        return;
      }
      case 'settings/list-models': {
        try {
          const provider = await this.createAiProviderFromAction(data);
          const models = await provider.listModels();
          const state = this.ensureSettingsState(session);
          state.models = models;
          state.aiFeedback = { tone: 'success', message: `读取到 ${models.length} 个可用模型。` };
          await this.sendSettingsSnapshot(session, message.requestId);
        } catch (error) {
          await this.updateSettingsFeedback(session, 'error', `模型列表读取失败：${errorMessage(error)}`, message.requestId);
        }
        return;
      }
      case 'settings/save-team': {
        try {
          const config = toTeamConfig(data);
          const validation = validateCommitConventionConfig(config);
          if (!validation.valid) {
            throw new Error(validation.issues.join('\n'));
          }
          await saveProjectCommitConventionConfig(session.scope.repositoryRoot, config);
          const state = this.ensureSettingsState(session);
          state.recommendedTeamConfig = undefined;
          state.recommendation = {
            summary: '团队提交规范已保存。',
            reasons: ['后续提交预检将使用当前仓库配置。'],
            warnings: [],
            confidence: 'high',
            source: 'local-rule'
          };
          await this.sendSettingsSnapshot(session, message.requestId);
        } catch (error) {
          await this.sendError('settings', '团队规则保存失败', errorMessage(error), true, message.requestId);
        }
        return;
      }
      case 'settings/recommend-team': {
        try {
          const current = toTeamConfig(data);
          const request = await buildTeamRulesAiRequest(session.scope.repositoryRoot, current);
          let source: 'local-rule' | 'configured-model' | 'local-rule-fallback' = 'local-rule';
          let fallbackReason: string | undefined;
          let recommendation = createLocalTeamRulesRecommendation(request);
          try {
            const config = await this.resolveStoredAiProvider('teamRules');
            recommendation = await new OpenAiCompatibleProvider(config).recommendTeamRules(request);
            source = 'configured-model';
          } catch (error) {
            source = 'local-rule-fallback';
            fallbackReason = errorMessage(error);
          }
          const state = this.ensureSettingsState(session);
          state.recommendedTeamConfig = aiConventionToTeamConfig(recommendation.commitConvention);
          state.recommendation = {
            summary: recommendation.summary,
            reasons: recommendation.reasons,
            warnings: recommendation.warnings,
            confidence: recommendation.confidence,
            source,
            fallbackReason
          };
          await this.sendSettingsSnapshot(session, message.requestId);
        } catch (error) {
          await this.sendError('settings', '团队规则推荐失败', errorMessage(error), true, message.requestId);
        }
        return;
      }
      case 'settings/open-team-file': {
        const state = await readCommitConventionEditState(session.scope.repositoryRoot);
        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(state.configPath));
        await vscode.window.showTextDocument(document, { preview: false });
        return;
      }
      case 'settings/clear-team-memory': {
        await clearTeamMemory(this.context.workspaceState, session.repositoryUuid);
        await this.sendSettingsSnapshot(session, message.requestId);
        return;
      }
      case 'diagnostics/run':
        await this.sendDiagnosticsSnapshot(session, message.requestId);
        return;
      case 'diagnostics/show-output':
        showOutput();
        return;
      case 'repository/preview-update': {
        await this.createUpdatePreview(session, message.requestId);
        return;
      }
      case 'repository/execute-update': {
        const token = asString(data.previewToken);
        const update = session.repositoryState?.update;
        if (!token || !update || token !== update.token || !update.canExecute) {
          await this.sendError('repository', '更新预览已失效', '请重新检查远端更新与本地风险。', true, message.requestId);
          return;
        }
        const candidates = await collectCommitCandidates(session.svnPath, session.scope);
        const currentHash = hashCandidateState(candidates, '', []);
        if (currentHash !== session.repositoryState?.candidateHash) {
          session.repositoryState!.update = undefined;
          await this.sendError('repository', '工作副本已变化', '本地状态已变化，请重新生成更新预览。', true, message.requestId);
          return;
        }
        await this.post({
          protocolVersion: WORKBENCH_PROTOCOL_VERSION,
          type: 'operation/progress',
          requestId: message.requestId,
          moduleId: 'repository',
          payload: { title: '正在更新当前范围', message: 'SVN update --accept postpone', cancellable: true }
        });
        const controller = new AbortController();
        session.activeOperation = { moduleId: 'repository', controller };
        let result: Awaited<ReturnType<typeof runUpdateScope>>;
        try {
          result = await runUpdateScope(session.svnPath, session.scope, { signal: controller.signal });
        } finally {
          if (session.activeOperation?.controller === controller) session.activeOperation = undefined;
        }
        if (result.result.cancelled) {
          session.repositoryState = { lastResult: { ok: false, hasConflicts: false, message: '更新已取消；请重新检查工作副本状态。' } };
          await this.post({ protocolVersion: WORKBENCH_PROTOCOL_VERSION, type: 'operation/cancelled', requestId: message.requestId, moduleId: 'repository', payload: { title: '更新已取消', message: 'SVN 进程已停止，当前状态将重新采集。' } });
          await this.sendRepositorySnapshot(session, message.requestId);
          return;
        }
        session.repositoryState = {
          lastResult: {
            ok: result.result.exitCode === 0,
            revision: result.revision,
            hasConflicts: result.hasConflicts,
            message: result.result.exitCode === 0
              ? result.revision ? `已更新到 r${result.revision}` : '当前范围更新完成。'
              : result.result.stderr || result.result.stdout || 'SVN 更新失败。'
          }
        };
        await this.sendRepositorySnapshot(session, message.requestId);
        return;
      }
      case 'repository/preview-property': {
        const target = getSingleScopeTarget(session.scope);
        if (!target) {
          await this.sendError('repository', '无法编辑属性', '属性编辑只支持单个文件或文件夹范围。', true, message.requestId);
          return;
        }
        const name = (asStringAllowEmpty(data.name) ?? '').trim();
        const value = asStringAllowEmpty(data.value) ?? '';
        const remove = data.remove === true;
        const current = await collectSvnProperties(session.svnPath, target.absolutePath, session.scope.repositoryRoot);
        const issues = current.error ? [current.error] : validatePropertyEdit(name, value, remove, current.items);
        const state = session.repositoryState ?? {};
        state.propertyPreview = {
          token: randomUUID(),
          stateHash: hashProperties(current.items),
          target: target.absolutePath,
          name,
          value,
          remove,
          issues
        };
        state.propertyFeedback = undefined;
        session.repositoryState = state;
        await this.sendRepositorySnapshot(session, message.requestId);
        return;
      }
      case 'repository/execute-property': {
        const token = asString(data.previewToken);
        const preview = session.repositoryState?.propertyPreview;
        if (!token || !preview || token !== preview.token || preview.issues.length > 0) {
          await this.sendError('repository', '属性预览已失效', '请重新生成属性变更预览。', true, message.requestId);
          return;
        }
        if (validatePathsInScope(session.scope, [preview.target]).outOfScopeItems.length > 0) {
          await this.sendError('repository', '范围校验失败', '属性目标已离开当前操作范围。', false, message.requestId);
          return;
        }
        const current = await collectSvnProperties(session.svnPath, preview.target, session.scope.repositoryRoot);
        if (current.error || hashProperties(current.items) !== preview.stateHash) {
          session.repositoryState!.propertyPreview = undefined;
          await this.sendError('repository', '属性状态已变化', current.error || '属性已被其他操作修改，请重新预览。', true, message.requestId);
          return;
        }
        const args = preview.remove
          ? ['propdel', preview.name, preview.target]
          : ['propset', preview.name, preview.value, preview.target];
        const result = await runSvnCommand(session.svnPath, args, session.scope.repositoryRoot);
        if (result.exitCode !== 0) {
          await this.sendError('repository', '属性更新失败', result.stderr || result.stdout || '未知错误', true, message.requestId);
          return;
        }
        session.repositoryState!.propertyPreview = undefined;
        session.repositoryState!.propertyFeedback = preview.remove ? `已删除属性 ${preview.name}。` : `已设置属性 ${preview.name}；变更尚未提交。`;
        await this.sendRepositorySnapshot(session, message.requestId);
        return;
      }
      case 'repository/preview-cleanup': {
        const target = getSingleFolderScopeTarget(session.scope);
        const issues = target ? [] : ['清理（Cleanup）只支持单个文件夹范围；请从工作副本目录右键进入。'];
        const state = session.repositoryState ?? {};
        state.cleanupPreview = { token: randomUUID(), target: target?.absolutePath ?? '', issues };
        state.cleanupFeedback = undefined;
        session.repositoryState = state;
        await this.sendRepositorySnapshot(session, message.requestId);
        return;
      }
      case 'repository/execute-cleanup': {
        const token = asString(data.previewToken);
        const preview = session.repositoryState?.cleanupPreview;
        if (!token || !preview || token !== preview.token || preview.issues.length > 0) {
          await this.sendError('repository', '清理预览已失效', '请从单个文件夹范围重新生成预览。', true, message.requestId);
          return;
        }
        if (validatePathsInScope(session.scope, [preview.target]).outOfScopeItems.length > 0) {
          await this.sendError('repository', '范围校验失败', '清理目标不再属于当前范围。', false, message.requestId);
          return;
        }
        const controller = new AbortController();
        session.activeOperation = { moduleId: 'repository', controller };
        await this.post({ protocolVersion: WORKBENCH_PROTOCOL_VERSION, type: 'operation/progress', requestId: message.requestId, moduleId: 'repository', payload: { title: '正在清理工作副本', message: '不会删除未版本化文件', cancellable: true } });
        let result: Awaited<ReturnType<typeof runSvnCommand>>;
        try {
          result = await runSvnCommand(session.svnPath, ['cleanup', preview.target], session.scope.repositoryRoot, { signal: controller.signal });
        } finally {
          if (session.activeOperation?.controller === controller) session.activeOperation = undefined;
        }
        session.repositoryState!.cleanupPreview = undefined;
        if (result.cancelled) {
          await this.post({ protocolVersion: WORKBENCH_PROTOCOL_VERSION, type: 'operation/cancelled', requestId: message.requestId, moduleId: 'repository', payload: { title: '清理已取消', message: '请重新检查工作副本状态后再继续。' } });
        } else if (result.exitCode !== 0) {
          await this.sendError('repository', '清理失败', result.stderr || result.stdout || '未知错误', true, message.requestId);
          return;
        } else {
          session.repositoryState!.cleanupFeedback = '清理已完成；未删除未版本化文件，请重新检查状态。';
          session.recoveryState = undefined;
        }
        await this.sendRepositorySnapshot(session, message.requestId);
        return;
      }
      case 'repository/browse':
        await this.browseRepository(session, asString(data.url), message.requestId);
        return;
      case 'repository/preview-advanced':
        await this.previewAdvancedRepositoryOperation(session, data, message.requestId);
        return;
      case 'repository/execute-advanced':
        await this.executeAdvancedRepositoryOperation(session, asString(data.previewToken), message.requestId);
        return;
      case 'repository/export-patch':
        await this.exportScopePatch(session, message.requestId);
        return;
      case 'repository/select-patch':
        await this.selectPatchForPreview(session, message.requestId);
        return;
      case 'repository/generate-release-notes':
        await this.generateReleaseNotes(session, asString(data.fromRevision), asString(data.toRevision), message.requestId);
        return;
      case 'ai-review/run':
        await this.sendAiReviewSnapshot(session, message.requestId);
        return;
      case 'impact/run':
        await this.sendImpactSnapshot(session, message.requestId);
        return;
      case 'changelist/suggest': {
        const candidates = await collectCommitCandidates(session.svnPath, session.scope);
        const convention = await resolveCommitConventionConfig(session.scope.repositoryRoot);
        const selectedPaths = candidates
          .filter((item) => item.selection !== 'blocked' && item.selection !== 'excluded')
          .map((item) => item.absolutePath);
        const request = buildCommitSplitAiRequest(session.scope, candidates, selectedPaths, { convention: toAiCommitConventionHint(convention.config) });
        let rawResult = createLocalCommitSplitResult(request);
        let source: 'local-rule' | 'configured-model' | 'local-rule-fallback' = 'local-rule';
        let fallbackReason: string | undefined;
        try {
          const config = await this.resolveStoredAiProvider('commitSplit');
          rawResult = await new OpenAiCompatibleProvider(config).suggestCommitSplits(request);
          source = 'configured-model';
        } catch (error) {
          source = 'local-rule-fallback';
          fallbackReason = errorMessage(error);
        }
        const result = validateCommitSplitResult(session.scope, rawResult, selectedPaths);
        session.changelistState = {
          suggestions: result.splits.map((item) => ({
            ...item,
            paths: item.paths.map((filePath) => normalizeRelative(path.relative(session.scope.repositoryRoot, filePath)))
          })),
          warnings: result.warnings,
          source,
          fallbackReason
        };
        await this.sendChangelistsSnapshot(session, message.requestId, candidates);
        return;
      }
      case 'changelist/preview-apply': {
        const name = (asStringAllowEmpty(data.name) ?? '').trim();
        const remove = data.remove === true;
        const paths = asStringArray(data.paths) ?? [];
        const candidates = await collectCommitCandidates(session.svnPath, session.scope);
        const candidatePaths = new Set(candidates.map((item) => item.relativePath));
        const issues: string[] = [];
        if (!remove && !name) issues.push('Changelist 名称不能为空。');
        if (paths.length === 0) issues.push('请选择至少一个文件。');
        if (paths.some((item) => !candidatePaths.has(item))) issues.push('选择中包含已变化或不属于当前范围的路径。');
        const token = randomUUID();
        const state = session.changelistState ?? { suggestions: [], warnings: [], source: 'local-rule' as const };
        state.preview = { token, candidateHash: hashCandidateState(candidates, '', []), name: remove ? undefined : name, remove, paths, issues };
        state.feedback = undefined;
        session.changelistState = state;
        await this.sendChangelistsSnapshot(session, message.requestId, candidates, issues);
        return;
      }
      case 'changelist/execute-apply': {
        const token = asString(data.previewToken);
        const preview = session.changelistState?.preview;
        if (!token || !preview || token !== preview.token || preview.issues.length > 0) {
          await this.sendError('changelists', 'Changelist 预览已失效', '请重新生成预览。', true, message.requestId);
          return;
        }
        const candidates = await collectCommitCandidates(session.svnPath, session.scope);
        if (hashCandidateState(candidates, '', []) !== preview.candidateHash) {
          session.changelistState!.preview = undefined;
          await this.sendError('changelists', '工作副本已变化', '请刷新后重新生成 Changelist 预览。', true, message.requestId);
          return;
        }
        const result = await applySvnChangelist(session.svnPath, session.scope, preview.name, preview.paths);
        if (result.exitCode !== 0) {
          await this.sendError('changelists', 'Changelist 更新失败', result.stderr || result.stdout || '未知错误', true, message.requestId);
          return;
        }
        session.changelistState!.preview = undefined;
        session.changelistState!.feedback = preview.remove ? '文件已移出 Changelist。' : `文件已加入 ${preview.name}。`;
        await this.sendChangelistsSnapshot(session, message.requestId);
        return;
      }
      case 'agent/create-plan': {
        const candidates = await collectCommitCandidates(session.svnPath, session.scope);
        const objective = (asStringAllowEmpty(data.objective) ?? '').trim().slice(0, 500) || '检查当前 SVN 变更并形成可执行的提交前建议';
        session.agentState = {
          candidateHash: hashCandidateState(candidates, '', []),
          snapshot: {
            kind: 'agent', status: 'planned', objective,
            guardrails: ['只访问当前右键范围', '每一步都需要显式批准', '不自动修改文件、不自动提交', '状态变化后计划立即失效'],
            steps: [
              { id: 'status', title: '重新采集 SVN 状态', detail: '读取当前范围的状态并确认阻止项。', capability: 'svn-read', command: 'svn status --xml <current-scope>', scope: '当前右键范围', risk: '低 · 只读 SVN 状态', reversibility: '不产生修改', status: 'pending', requiresApproval: true },
              { id: 'review', title: '执行证据审查', detail: '使用本地敏感信息、调试代码与生成物规则扫描。', capability: 'local-analysis', scope: '当前候选元数据与受限差异', risk: '低 · 可能产生误报', reversibility: '只生成建议，可丢弃', status: 'pending', requiresApproval: true },
              { id: 'impact', title: '生成影响与测试计划', detail: '根据实际变更路径给出验证命令和上线观察点。', capability: 'local-analysis', scope: '当前候选路径和文件类型', risk: '低 · 需要人工验证建议', reversibility: '只生成计划，可丢弃', status: 'pending', requiresApproval: true }
            ],
            nextStepId: 'status'
          }
        };
        await this.sendAgentSnapshot(session, message.requestId);
        return;
      }
      case 'agent/approve-step': {
        const stepId = asString(data.stepId);
        const state = session.agentState;
        if (!stepId || !state || state.snapshot.nextStepId !== stepId) {
          await this.sendError('agent', '代理步骤不可执行', '只能批准当前待执行步骤，请重新生成计划。', true, message.requestId);
          return;
        }
        const candidates = await collectCommitCandidates(session.svnPath, session.scope);
        if (hashCandidateState(candidates, '', []) !== state.candidateHash) {
          state.snapshot.status = 'failed';
          state.snapshot.message = '工作副本已变化，原计划已过期。请重新生成计划。';
          await this.sendAgentSnapshot(session, message.requestId);
          return;
        }
        const step = state.snapshot.steps.find((item) => item.id === stepId)!;
        state.snapshot.status = 'running';
        step.status = 'running';
        await this.sendAgentSnapshot(session, message.requestId);
        try {
          if (stepId === 'status') {
            const blocked = candidates.filter((item) => item.selection === 'blocked').length;
            step.output = `已采集 ${candidates.length} 个候选，其中 ${blocked} 个阻止项。`;
          } else if (stepId === 'review') {
            const review = await buildLocalChangeReview(candidates);
            step.output = `发现 ${review.summary.critical} 个高风险、${review.summary.warning} 个提醒、${review.summary.note} 个建议。`;
          } else {
            const impact = buildLocalImpactAnalysis(candidates);
            step.output = `识别 ${impact.areas.length} 个影响区域，生成 ${impact.tests.length} 条测试建议。`;
          }
          step.status = 'completed';
          const next = state.snapshot.steps.find((item) => item.status === 'pending');
          state.snapshot.nextStepId = next?.id;
          state.snapshot.status = next ? 'planned' : 'completed';
          state.snapshot.message = next ? '当前步骤完成，等待批准下一步。' : '受控分析计划已完成，可以进入审查、影响或提交模块继续操作。';
        } catch (error) {
          step.status = 'failed';
          step.output = errorMessage(error);
          state.snapshot.status = 'failed';
          state.snapshot.message = '步骤执行失败；未继续后续步骤。';
        }
        await this.sendAgentSnapshot(session, message.requestId);
        return;
      }
      case 'agent/cancel': {
        if (session.agentState) {
          session.agentState.snapshot.status = 'cancelled';
          session.agentState.snapshot.nextStepId = undefined;
          session.agentState.snapshot.message = '计划已取消；没有执行写操作。';
          for (const step of session.agentState.snapshot.steps) {
            if (step.status === 'pending' || step.status === 'running') step.status = 'cancelled';
          }
          await this.sendAgentSnapshot(session, message.requestId);
        }
        return;
      }
      case 'changes/preview-operation': {
        const operation = asFileOperation(data.operation);
        const paths = asStringArray(data.paths) ?? [];
        const ignoreMode = data.ignoreMode === 'repository' ? 'repository' as const : 'directory' as const;
        if (!operation) {
          await this.sendError('changes', '操作无效', '不支持的 SVN 文件操作。', false, message.requestId);
          return;
        }
        const candidates = await collectCommitCandidates(session.svnPath, session.scope);
        const issues = validateFileOperation(candidates, operation, paths, session.scope, ignoreMode);
        session.changesState = {
          preview: { token: randomUUID(), candidateHash: hashCandidateState(candidates, '', []), operation, ignoreMode: operation === 'ignore' ? ignoreMode : undefined, paths, issues }
        };
        await this.sendChangesSnapshot(session, message.requestId, candidates);
        return;
      }
      case 'changes/execute-operation': {
        const token = asString(data.previewToken);
        const preview = session.changesState?.preview;
        if (!token || !preview || token !== preview.token || preview.issues.length > 0) {
          await this.sendError('changes', '文件操作预览已失效', '请重新选择文件并生成操作预览。', true, message.requestId);
          return;
        }
        const candidates = await collectCommitCandidates(session.svnPath, session.scope);
        const currentIssues = validateFileOperation(candidates, preview.operation, preview.paths, session.scope, preview.ignoreMode);
        if (hashCandidateState(candidates, '', []) !== preview.candidateHash || currentIssues.length > 0) {
          session.changesState!.preview = undefined;
          await this.sendError('changes', '工作副本已变化', '当前状态不再满足原操作条件，请刷新后重试。', true, message.requestId);
          return;
        }
        const result = preview.operation === 'ignore'
          ? await applyIgnoreOperation(session.svnPath, session.scope, preview.paths, preview.ignoreMode ?? 'directory')
          : await runSvnCommand(session.svnPath, buildFileOperationArgs(preview.operation, preview.paths.map((item) => path.resolve(session.scope.repositoryRoot, item))), session.scope.repositoryRoot);
        if (result.exitCode !== 0) {
          await this.sendError('changes', 'SVN 文件操作失败', result.stderr || result.stdout || '未知错误', true, message.requestId);
          return;
        }
        session.changesState = { feedback: fileOperationSuccess(preview.operation, preview.paths.length) };
        await this.sendChangesSnapshot(session, message.requestId);
        return;
      }
      case 'changes/copy-url': {
        const relativePath = asString(data.relativePath);
        if (!relativePath) return;
        const absolutePath = path.resolve(session.scope.repositoryRoot, relativePath);
        if (validatePathsInScope(session.scope, [absolutePath]).outOfScopeItems.length > 0) {
          await this.sendError('changes', '范围校验失败', '无法读取范围外路径的仓库 URL。', false, message.requestId);
          return;
        }
        const result = await runSvnCommand(session.svnPath, ['info', '--show-item', 'url', absolutePath], session.scope.repositoryRoot);
        if (result.exitCode !== 0 || !result.stdout.trim()) {
          await this.sendError('changes', '读取仓库 URL 失败', result.stderr || '该文件可能尚未纳入版本控制。', true, message.requestId);
          return;
        }
        await vscode.env.clipboard.writeText(result.stdout.trim());
        session.changesState = { feedback: '仓库 URL 已复制。' };
        await this.sendChangesSnapshot(session, message.requestId);
        return;
      }
      case 'changes/show-in-repository': {
        const relativePath = asString(data.relativePath);
        if (!relativePath) return;
        const absolutePath = path.resolve(session.scope.repositoryRoot, relativePath);
        if (validatePathsInScope(session.scope, [absolutePath]).outOfScopeItems.length > 0) {
          await this.sendError('changes', '范围校验失败', '无法浏览当前右键范围外路径。', false, message.requestId);
          return;
        }
        const result = await runSvnCommand(session.svnPath, ['info', '--show-item', 'url', absolutePath], session.scope.repositoryRoot);
        if (result.exitCode !== 0 || !result.stdout.trim()) {
          await this.sendError('changes', '无法定位仓库路径', result.stderr || '该资源可能尚未加入版本控制。', true, message.requestId);
          return;
        }
        session.moduleId = 'repository';
        session.taskId = 'repository/browse';
        this.panel!.title = getModuleTitle('repository', session.taskId);
        await this.browseRepository(session, result.stdout.trim(), message.requestId);
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
      type: 'app/initialize',
      moduleId: this.session.moduleId,
      taskId: this.session.taskId,
      payload: {
        moduleId: this.session.moduleId,
        scope: this.session.scopeView
      }
    });
  }

  private async loadModule(moduleId: WorkbenchModuleId, targetFile?: string, requestId?: string): Promise<void> {
    const session = this.session;
    if (!session || !this.panel) {
      return;
    }
    const effectiveRequestId = requestId ?? randomUUID();
    this.latestModuleRequests.set(moduleId, effectiveRequestId);
    await this.post({
      protocolVersion: WORKBENCH_PROTOCOL_VERSION,
      type: 'module/loading',
      requestId: effectiveRequestId,
      moduleId,
      payload: { moduleId }
    });

    try {
      const snapshot = await this.buildSnapshot(session, moduleId, targetFile);
      if (this.session !== session || this.session.moduleId !== moduleId || this.latestModuleRequests.get(moduleId) !== effectiveRequestId) {
        return;
      }
      await this.post({
        protocolVersion: WORKBENCH_PROTOCOL_VERSION,
        type: 'module/snapshot',
        requestId: effectiveRequestId,
        moduleId,
        payload: { snapshot }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendOutput(`加载 Svelte 模块 ${moduleId} 失败：${message}`);
      if (this.latestModuleRequests.get(moduleId) === effectiveRequestId) {
        await this.sendError(moduleId, '模块加载失败', message, true, effectiveRequestId);
      }
    }
  }

  private async buildSnapshot(
    session: WorkbenchSession,
    moduleId: WorkbenchModuleId,
    targetFile?: string
  ): Promise<WorkbenchModuleSnapshot> {
    if (moduleId === 'changes') {
      const candidates = await collectCommitCandidates(session.svnPath, session.scope);
      const summary = summarizeCommitCandidates(candidates);
      const preview = session.changesState?.preview;
      const files = await buildWorkbenchFileViews(candidates, session.scopeView.repositoryName);
      return {
        kind: 'changes',
        commitDraft: this.ensureCommitState(session).message,
        files,
        summary: summary.statuses,
        refreshedAt: new Date().toISOString(),
        operationPreview: preview ? {
          token: preview.token,
          operation: preview.operation,
          ignoreMode: preview.ignoreMode,
          paths: preview.paths,
          command: formatFileOperationCommand(preview.operation, preview.paths, preview.ignoreMode),
          consequences: fileOperationConsequences(preview.operation, preview.ignoreMode),
          destructive: preview.operation === 'revert' || preview.operation === 'remove',
          recoverability: fileOperationRecoverability(preview.operation),
          canExecute: preview.issues.length === 0,
          issues: preview.issues
        } : undefined,
        feedback: session.changesState?.feedback
      };
    }

    if (moduleId === 'diff') {
      if (!targetFile) {
        throw new Error('请选择一个文件查看差异。');
      }
      return this.buildDiffSnapshot(session, targetFile);
    }

    if (moduleId === 'commit') {
      return this.buildCommitSnapshot(session);
    }

    if (moduleId === 'history') {
      return this.buildHistorySnapshot(session);
    }

    if (moduleId === 'conflicts') {
      return this.buildConflictSnapshot(session);
    }

    if (moduleId === 'settings') {
      return this.buildSettingsSnapshot(session);
    }

    if (moduleId === 'diagnostics') {
      return this.buildDiagnosticsSnapshot();
    }

    if (moduleId === 'repository') {
      return this.buildRepositorySnapshot(session);
    }

    if (moduleId === 'ai-review') {
      const candidates = await collectCommitCandidates(session.svnPath, session.scope);
      return buildLocalChangeReview(candidates);
    }

    if (moduleId === 'impact') {
      const candidates = await collectCommitCandidates(session.svnPath, session.scope);
      return buildLocalImpactAnalysis(candidates);
    }

    if (moduleId === 'changelists') {
      return this.buildChangelistsSnapshot(session);
    }

    if (moduleId === 'agent') {
      return session.agentState?.snapshot ?? emptyAgentSnapshot();
    }

    throw new Error(`未实现的工作台模块：${moduleId satisfies never}`);
  }

  private async buildDiffSnapshot(session: WorkbenchSession, targetFile: string): Promise<DiffSnapshot> {
    const absolutePath = path.resolve(targetFile);
    if (validatePathsInScope(session.scope, [absolutePath]).outOfScopeItems.length > 0) {
      throw new Error('文件不在当前右键操作范围内。');
    }

    const working = await readFileForDiff(absolutePath);
    const baseResult = await runSvnCommand(
      session.svnPath,
      ['cat', '-r', 'BASE', absolutePath],
      path.dirname(absolutePath),
      { maxOutputBytes: MAX_DIFF_BYTES }
    );
    const baseBuffer = Buffer.from(baseResult.stdout, 'utf8');
    const binary = working.binary || containsNull(baseBuffer);
    const truncated = working.truncated || Boolean(baseResult.truncated) || baseBuffer.byteLength >= MAX_DIFF_BYTES;
    const original = binary ? '' : truncateUtf8(baseBuffer);
    const modified = binary ? '' : working.text;

    return {
      kind: 'diff',
      relativePath: normalizeRelative(path.relative(session.scope.repositoryRoot, absolutePath)),
      original,
      modified,
      language: inferLanguage(absolutePath),
      truncated,
      binary,
      message: binary
        ? '检测到二进制内容，未向 Webview 发送文件正文。'
        : truncated
          ? '文件超过 5 MB，仅显示前 5 MB。'
          : baseResult.exitCode !== 0
            ? '无法读取 BASE 内容，可能是未版本化文件。'
            : undefined
    };
  }

  private async buildHistorySnapshot(session: WorkbenchSession) {
    const revisions = await collectSvnHistory(session.svnPath, session.scope, 100);
    if (!session.historyState) {
      session.historyState = { selectedRevision: revisions[0]?.revision, compareRevisions: [] };
    }
    if (session.historyState.selectedRevision && !revisions.some((item) => item.revision === session.historyState!.selectedRevision)) {
      session.historyState.selectedRevision = revisions[0]?.revision;
    }
    return {
      kind: 'history' as const,
      revisions,
      selectedRevision: session.historyState.selectedRevision,
      compareRevisions: session.historyState.compareRevisions,
      limit: 100,
      fileActionsAvailable: Boolean(getSingleFileScopeRoot(session.scope)),
      blame: session.historyState.blame,
      restorePreview: session.historyState.restorePreview ? {
        token: session.historyState.restorePreview.token,
        revision: session.historyState.restorePreview.revision,
        relativePath: session.historyState.restorePreview.relativePath,
        command: `svn cat -r ${session.historyState.restorePreview.revision} ${quoteRelative(session.historyState.restorePreview.relativePath)} > <working-file>`,
        canExecute: session.historyState.restorePreview.issues.length === 0,
        issues: session.historyState.restorePreview.issues
      } : undefined,
      feedback: session.historyState.feedback
    };
  }

  private async sendHistorySnapshot(session: WorkbenchSession, requestId?: string): Promise<void> {
    const snapshot = await this.buildHistorySnapshot(session);
    await this.post({
      protocolVersion: WORKBENCH_PROTOCOL_VERSION,
      type: 'module/snapshot',
      requestId,
      moduleId: 'history',
      payload: { snapshot }
    });
  }

  private async buildConflictSnapshot(
    session: WorkbenchSession,
    providedConflicts?: Awaited<ReturnType<typeof collectConflictItems>>,
    providedPreview?: ReturnType<typeof buildResolveConflictPreview>
  ) {
    const conflicts = providedConflicts ?? await collectConflictItems(session.svnPath, session.scope);
    if (!session.conflictState) {
      session.conflictState = { selectedPath: conflicts[0]?.relativePath };
    }
    if (session.conflictState.selectedPath && !conflicts.some((item) => item.relativePath === session.conflictState!.selectedPath)) {
      session.conflictState = { selectedPath: conflicts[0]?.relativePath };
    }
    const selected = conflicts.find((item) => item.relativePath === session.conflictState?.selectedPath);
    const request = selected ? await buildConflictAiRequest(selected) : undefined;
    if (selected && (!session.conflictState?.editState || session.conflictState.editState.relativePath !== selected.relativePath)) {
      session.conflictState = {
        ...session.conflictState,
        editState: { token: randomUUID(), contentHash: await hashFileContents(selected.workingFile), relativePath: selected.relativePath }
      };
    }
    const previewState = session.conflictState?.resolvePreview;
    const preview = selected && previewState?.relativePath === selected.relativePath
      ? providedPreview ?? buildResolveConflictPreview(session.scope, selected.workingFile)
      : undefined;

    return {
      kind: 'conflicts' as const,
      conflicts: conflicts.map((item) => ({
        relativePath: item.relativePath,
        operation: item.operation,
        type: item.type,
        sourceLeftRevision: item.sourceLeftRevision,
        sourceRightRevision: item.sourceRightRevision
      })),
      selected: selected && request ? {
        relativePath: selected.relativePath,
        operation: selected.operation,
        type: selected.type,
        sourceLeftRevision: selected.sourceLeftRevision,
        sourceRightRevision: selected.sourceRightRevision,
        contents: {
          base: toConflictContentView(request.contents.base),
          mine: toConflictContentView(request.contents.mine),
          theirs: toConflictContentView(request.contents.theirs),
          working: toConflictContentView(request.contents.working)
        },
        mergeEditor: {
          token: session.conflictState!.editState!.token,
          editable: !request.contents.working?.truncated && !request.contents.working?.readError,
          issues: request.contents.working?.truncated ? ['工作副本内容超过 5 MB，内嵌编辑已禁用。'] : request.contents.working?.readError ? [request.contents.working.readError] : [],
          feedback: session.conflictState!.editState!.feedback
        }
      } : undefined,
      advice: session.conflictState?.advice,
      aiPrivacy: request ? {
        model: session.aiModels.conflictAdvice || '本地规则（未配置外部模型）',
        characters: Object.values(request.contents).reduce((sum, item) => sum + (item?.content?.length ?? 0), 0),
        maxCharacters: 32_000,
        data: '基础版本、我的版本、对方版本和工作副本的截断文本与修订元数据',
        historyIncluded: false as const
      } : undefined,
      resolvePreview: preview && previewState ? {
        token: previewState.token,
        relativePath: previewState.relativePath,
        command: `svn resolve --accept working "${previewState.relativePath.replace(/"/g, '\\"')}"`,
        canResolve: preview.canResolve,
        issues: preview.issues
      } : undefined
    };
  }

  private async sendConflictSnapshot(
    session: WorkbenchSession,
    requestId?: string,
    conflicts?: Awaited<ReturnType<typeof collectConflictItems>>,
    preview?: ReturnType<typeof buildResolveConflictPreview>
  ): Promise<void> {
    const snapshot = await this.buildConflictSnapshot(session, conflicts, preview);
    await this.post({
      protocolVersion: WORKBENCH_PROTOCOL_VERSION,
      type: 'module/snapshot',
      requestId,
      moduleId: 'conflicts',
      payload: { snapshot }
    });
  }

  private ensureSettingsState(session: WorkbenchSession): NonNullable<WorkbenchSession['settingsState']> {
    if (!session.settingsState) {
      session.settingsState = { models: [] };
    }
    return session.settingsState;
  }

  private async buildSettingsSnapshot(session: WorkbenchSession): Promise<SettingsSnapshot> {
    const state = this.ensureSettingsState(session);
    const stored = await readStoredAiConfiguration(this.context);
    const teamState = await readCommitConventionEditState(session.scope.repositoryRoot);
    const team = state.recommendedTeamConfig ?? teamState.config;
    const memory = readTeamMemory(this.context.workspaceState, session.repositoryUuid);
    return {
      kind: 'settings',
      svnSecurity: {
        authenticationActive: Boolean(session.security.authentication),
        hasStoredAuthentication: session.security.hasStoredAuthentication,
        passwordTransport: 'stdin',
        certificateTrust: 'explicit-svn-cache'
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
        feedback: state.aiFeedback
      },
      team: {
        configPath: normalizeRelative(path.relative(session.scope.repositoryRoot, teamState.configPath)),
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
          recent: memory.entries.slice(0, 5).map(({ revision, summary, recordedAt }) => ({ revision, summary, recordedAt }))
        },
        recommendation: state.recommendation
      }
    };
  }

  private async sendSettingsSnapshot(session: WorkbenchSession, requestId?: string): Promise<void> {
    const snapshot = await this.buildSettingsSnapshot(session);
    await this.post({
      protocolVersion: WORKBENCH_PROTOCOL_VERSION,
      type: 'module/snapshot',
      requestId,
      moduleId: 'settings',
      payload: { snapshot }
    });
  }

  private async updateSettingsFeedback(
    session: WorkbenchSession,
    tone: 'success' | 'warning' | 'error',
    message: string,
    requestId?: string
  ): Promise<void> {
    this.ensureSettingsState(session).aiFeedback = { tone, message };
    await this.sendSettingsSnapshot(session, requestId);
  }

  private async createAiProviderFromAction(data: Record<string, unknown>): Promise<OpenAiCompatibleProvider> {
    const baseUrl = normalizeAiBaseUrl(asStringAllowEmpty(data.baseUrl) ?? '');
    const model = (asStringAllowEmpty(data.model) ?? '').trim();
    const enteredKey = (asStringAllowEmpty(data.apiKey) ?? '').trim();
    const secret = await this.context.secrets.get(AI_API_KEY_SECRET_KEY);
    const legacy = vscode.workspace.getConfiguration('svnWorkbench.ai').get<string>('apiKey') ?? '';
    const config = { baseUrl, model, apiKey: enteredKey || secret || legacy };
    const validation = validateAiProviderConfig(config);
    if (!validation.valid) {
      throw new Error(validation.issues.join(' '));
    }
    return new OpenAiCompatibleProvider(config);
  }

  private async resolveStoredAiProvider(scenario: AiUsageScenario) {
    const stored = await readStoredAiConfiguration(this.context);
    const apiKey = await this.context.secrets.get(AI_API_KEY_SECRET_KEY)
      || vscode.workspace.getConfiguration('svnWorkbench.ai').get<string>('apiKey')
      || '';
    const model = stored.scenarioModels[scenario] || stored.model;
    const config = { baseUrl: normalizeAiBaseUrl(stored.baseUrl), model, apiKey };
    const validation = validateAiProviderConfig(config);
    if (!validation.valid) {
      throw new Error(validation.issues.join(' '));
    }
    return config;
  }

  private async configureAuthentication(session: WorkbenchSession, requestId?: string): Promise<void> {
    const username = await vscode.window.showInputBox({
      title: 'SVN 认证',
      prompt: '用户名只保存在当前会话或 VS Code SecretStorage，不写入 settings。',
      value: session.security.authentication?.username ?? '',
      ignoreFocusOut: true,
      validateInput: (value) => value.trim() ? undefined : '请输入 SVN 用户名。'
    });
    if (username === undefined) return;

    const password = await vscode.window.showInputBox({
      title: 'SVN 认证',
      prompt: '密码通过标准输入交给 SVN，不进入命令行参数、Webview 快照或日志。',
      password: true,
      ignoreFocusOut: true,
      validateInput: (value) => value ? undefined : '请输入 SVN 密码。'
    });
    if (password === undefined) return;

    const storage = await vscode.window.showQuickPick([
      { label: '仅本次工作台会话', description: '关闭工作台或切换仓库后清除。', id: 'session' as const },
      { label: '安全保存到系统凭据存储', description: '通过 VS Code SecretStorage 保存，可随时清除。', id: 'secret' as const }
    ], { title: '凭据保存方式', placeHolder: '选择凭据生命周期', ignoreFocusOut: true });
    if (!storage) return;

    session.security.authentication = { username: username.trim(), password };
    session.security.hasStoredAuthentication = storage.id === 'secret';
    if (storage.id === 'secret') {
      await storeSvnCredential(this.context.secrets, session.repositoryUuid, session.security.authentication);
    } else {
      await deleteStoredSvnCredential(this.context.secrets, session.repositoryUuid);
    }
    this.syncSvnSecurityContext(session);
    await this.loadModule(session.moduleId, session.targetFile, requestId);
    await this.post({
      protocolVersion: WORKBENCH_PROTOCOL_VERSION,
      type: 'operation/result', requestId, moduleId: session.moduleId,
      payload: { title: '认证凭据已更新', message: storage.id === 'secret' ? '凭据已保存到 VS Code SecretStorage；请重新执行原操作。' : '凭据仅在当前工作台会话中有效；请重新执行原操作。' }
    });
  }

  private async clearAuthentication(session: WorkbenchSession, requestId?: string): Promise<void> {
    await deleteStoredSvnCredential(this.context.secrets, session.repositoryUuid);
    session.security.authentication = undefined;
    session.security.hasStoredAuthentication = false;
    this.syncSvnSecurityContext(session);
    await this.post({
      protocolVersion: WORKBENCH_PROTOCOL_VERSION,
      type: 'operation/result', requestId, moduleId: session.moduleId,
      payload: { title: 'SVN 凭据已清除', message: '当前会话和 VS Code SecretStorage 中的仓库凭据均已移除。' }
    });
  }

  private async reviewCertificate(session: WorkbenchSession, requestId?: string): Promise<void> {
    const certificate = session.security.lastCertificate;
    if (!certificate?.host || !certificate.fingerprint) {
      await this.sendError(session.moduleId, '无法安全信任证书', 'SVN 输出中缺少服务器主机或 SHA-256 指纹。请通过管理员提供的可信渠道核对证书，不允许盲目信任。', false, requestId);
      return;
    }

    const detail = [
      `服务器：${certificate.host}`,
      `SHA-256 指纹：${certificate.fingerprint}`,
      certificate.issuer ? `颁发者：${certificate.issuer}` : undefined,
      certificate.validFrom || certificate.validUntil ? `有效期：${certificate.validFrom ?? '?'} → ${certificate.validUntil ?? '?'}` : undefined,
      `失败类型：${certificate.failures.join('、')}`,
      '',
      '请通过仓库管理员或其他可信渠道核对指纹。错误的信任决定可能把凭据交给冒充服务器。'
    ].filter((item): item is string => item !== undefined).join('\n');
    const choice = await vscode.window.showWarningMessage(
      '核对 SVN 服务器证书',
      { modal: true, detail },
      '仅本次信任',
      '永久信任（由 SVN 缓存）'
    );
    if (!choice) return;

    const scope = choice.startsWith('永久') ? 'permanent' as const : 'once' as const;
    if (scope === 'permanent') {
      const confirmed = await vscode.window.showWarningMessage(
        `永久信任 ${certificate.host} 的当前证书？`,
        { modal: true, detail: `确认 SHA-256 指纹：${certificate.fingerprint}\nSVN 将保存这次信任；证书变化后应重新核对。` },
        '确认永久信任'
      );
      if (!confirmed) return;
    }

    session.security.certificateTrust = {
      host: certificate.host,
      fingerprint: certificate.fingerprint,
      failures: certificate.failures,
      scope
    };
    this.syncSvnSecurityContext(session);
    try {
      await this.loadModule(session.moduleId, session.targetFile, requestId);
    } finally {
      session.security.certificateTrust = undefined;
      this.syncSvnSecurityContext(session);
    }
    await this.post({
      protocolVersion: WORKBENCH_PROTOCOL_VERSION,
      type: 'operation/result', requestId, moduleId: session.moduleId,
      payload: {
        title: scope === 'permanent' ? '证书信任已交给 SVN 缓存' : '本次证书信任已使用',
        message: '请确认模块已正常重新加载，再重新生成原写操作的预览。'
      }
    });
  }

  private syncSvnSecurityContext(session: WorkbenchSession): void {
    setSvnSecurityContext(session.scope.repositoryRoot, {
      authentication: session.security.authentication,
      certificateTrust: session.security.certificateTrust
    });
  }

  private async buildDiagnosticsSnapshot(): Promise<DiagnosticsSnapshot> {
    const executable = await resolveSvnExecutable();
    const stored = await readStoredAiConfiguration(this.context);
    const workspaces = await Promise.all((vscode.workspace.workspaceFolders ?? []).map(async (folder) => {
      let isSvnWorkingCopy = false;
      try {
        await vscode.workspace.fs.stat(vscode.Uri.joinPath(folder.uri, '.svn'));
        isSvnWorkingCopy = true;
      } catch {
        isSvnWorkingCopy = false;
      }
      return { name: folder.name, path: folder.uri.fsPath, isSvnWorkingCopy };
    }));
    const report = buildEnvironmentDiagnosticReport({
      platform: process.platform,
      arch: process.arch,
      vscodeVersion: vscode.version,
      configuredSvnPath: vscode.workspace.getConfiguration('svnWorkbench').get<string | null>('svn.path'),
      svnExecutable: executable,
      workspaces,
      ai: {
        providerPreset: stored.providerPreset,
        baseUrl: stored.baseUrl,
        model: stored.model,
        hasApiKey: stored.hasSecretApiKey || stored.hasLegacyApiKey
      }
    });
    const reportText = `${formatEnvironmentDiagnosticReport(report)}\n\n${formatAcceptanceChecklistMarkdown()}`;
    appendOutput(formatEnvironmentDiagnosticReport(report));
    return {
      kind: 'diagnostics',
      status: report.status,
      checks: report.checks,
      acceptance: {
        summary: summarizeAcceptanceChecklist(),
        sections: acceptanceChecklistSections
      },
      generatedAt: new Date().toISOString(),
      reportText
    };
  }

  private async sendDiagnosticsSnapshot(session: WorkbenchSession, requestId?: string): Promise<void> {
    const snapshot = await this.buildDiagnosticsSnapshot();
    await this.post({
      protocolVersion: WORKBENCH_PROTOCOL_VERSION,
      type: 'module/snapshot',
      requestId,
      moduleId: 'diagnostics',
      payload: { snapshot }
    });
  }

  private async buildRepositorySnapshot(session: WorkbenchSession) {
    const infoResult = await runSvnCommand(session.svnPath, ['info', '--xml', session.scope.repositoryRoot], session.scope.repositoryRoot);
    const info = infoResult.exitCode === 0 ? parseInfoXml(infoResult.stdout, session.scope.repositoryRoot) : undefined;
    const propertyTarget = getSingleScopeTarget(session.scope);
    const propertyResult = propertyTarget
      ? await collectSvnProperties(session.svnPath, propertyTarget.absolutePath, session.scope.repositoryRoot)
      : { items: [], error: '请选择单个文件或文件夹以查看和编辑 SVN 属性。' };
    const propertyPreview = session.repositoryState?.propertyPreview;
    const cleanupTarget = getSingleFolderScopeTarget(session.scope);
    const cleanupPreview = session.repositoryState?.cleanupPreview;
    return {
      kind: 'repository' as const,
      recovery: session.recoveryState,
      info: {
        name: path.basename(session.scope.repositoryRoot),
        url: info?.url,
        repositoryRoot: info?.repositoryRoot,
        revision: info?.revision
      },
      update: session.repositoryState?.update,
      lastResult: session.repositoryState?.lastResult,
      properties: {
        available: Boolean(propertyTarget && !propertyResult.error),
        target: propertyTarget ? normalizeRelative(propertyTarget.relativePath) : '多个范围',
        items: propertyResult.items,
        error: propertyResult.error,
        feedback: session.repositoryState?.propertyFeedback,
        preview: propertyPreview ? {
          token: propertyPreview.token,
          name: propertyPreview.name,
          value: propertyPreview.remove ? undefined : propertyPreview.value,
          remove: propertyPreview.remove,
          command: propertyPreview.remove
            ? `svn propdel ${quoteRelative(propertyPreview.name)} ${quoteRelative(normalizeRelative(path.relative(session.scope.repositoryRoot, propertyPreview.target)))}`
            : `svn propset ${quoteRelative(propertyPreview.name)} <value> ${quoteRelative(normalizeRelative(path.relative(session.scope.repositoryRoot, propertyPreview.target)))}`,
          canExecute: propertyPreview.issues.length === 0,
          issues: propertyPreview.issues
        } : undefined
      },
      cleanup: {
        available: Boolean(cleanupTarget),
        target: cleanupTarget ? normalizeRelative(cleanupTarget.relativePath) : '非单文件夹范围',
        reason: cleanupTarget ? undefined : '请从一个 SVN 文件夹右键进入后再执行清理。',
        feedback: session.repositoryState?.cleanupFeedback,
        preview: cleanupPreview ? {
          token: cleanupPreview.token,
          command: cleanupPreview.target ? `svn cleanup ${quoteRelative(normalizeRelative(path.relative(session.scope.repositoryRoot, cleanupPreview.target)))}` : 'svn cleanup <single-folder-scope>',
          canExecute: cleanupPreview.issues.length === 0,
          issues: cleanupPreview.issues
        } : undefined
      },
      advanced: {
        browser: session.repositoryState?.advanced?.browser,
        releaseNotes: session.repositoryState?.advanced?.releaseNotes,
        feedback: session.repositoryState?.advanced?.feedback,
        preview: session.repositoryState?.advanced?.preview ? {
          token: session.repositoryState.advanced.preview.token,
          operation: session.repositoryState.advanced.preview.operation,
          title: session.repositoryState.advanced.preview.title,
          commands: session.repositoryState.advanced.preview.commands,
          details: session.repositoryState.advanced.preview.details,
          issues: session.repositoryState.advanced.preview.issues,
          canExecute: session.repositoryState.advanced.preview.issues.length === 0,
          destructive: session.repositoryState.advanced.preview.destructive
        } : undefined
      }
    };
  }

  private ensureAdvancedRepositoryState(session: WorkbenchSession): NonNullable<NonNullable<WorkbenchSession['repositoryState']>['advanced']> {
    session.repositoryState ??= {};
    session.repositoryState.advanced ??= {};
    return session.repositoryState.advanced;
  }

  private async browseRepository(session: WorkbenchSession, requestedUrl: string | undefined, requestId?: string): Promise<void> {
    const infoResult = await runSvnCommand(session.svnPath, ['info', '--xml', session.scope.repositoryRoot], session.scope.repositoryRoot);
    const info = infoResult.exitCode === 0 ? parseInfoXml(infoResult.stdout, session.scope.repositoryRoot) : undefined;
    const url = requestedUrl?.trim() || info?.url || info?.repositoryRoot;
    const state = this.ensureAdvancedRepositoryState(session);
    if (!url) {
      state.browser = { url: '', entries: [], error: '未能解析当前仓库 URL。' };
      await this.sendRepositorySnapshot(session, requestId);
      return;
    }
    const issues = validateRepositoryUrl(url, info?.repositoryRoot);
    if (issues.length > 0) {
      state.browser = { url, entries: [], error: issues.join(' ') };
      await this.sendRepositorySnapshot(session, requestId);
      return;
    }
    const result = await runSvnCommand(session.svnPath, ['list', '--xml', url], session.scope.repositoryRoot);
    state.browser = result.exitCode === 0
      ? { url, parentUrl: repositoryParentUrl(url, info?.repositoryRoot), entries: parseSvnListXml(result.stdout) }
      : { url, entries: [], error: result.stderr || result.stdout || '无法读取仓库目录。' };
    await this.sendRepositorySnapshot(session, requestId);
  }

  private async previewAdvancedRepositoryOperation(session: WorkbenchSession, data: Record<string, unknown>, requestId?: string): Promise<void> {
    const operation = asAdvancedRepositoryOperation(data.operation);
    if (!operation || operation === 'apply-patch') {
      await this.sendError('repository', '高级操作无效', '请选择受支持的仓库操作。', false, requestId);
      return;
    }
    const input = Object.fromEntries(Object.entries(data).flatMap(([key, value]) => typeof value === 'string' ? [[key, value.trim()]] : []));
    const infoResult = await runSvnCommand(session.svnPath, ['info', '--xml', session.scope.repositoryRoot], session.scope.repositoryRoot);
    const info = infoResult.exitCode === 0 ? parseInfoXml(infoResult.stdout, session.scope.repositoryRoot) : undefined;
    const candidates = await collectCommitCandidates(session.svnPath, session.scope);
    const issues: string[] = [];
    const commands: string[] = [];
    const details: string[] = [];
    let title = '';
    let destructive = false;

    if (operation === 'branch' || operation === 'tag') {
      title = operation === 'branch' ? '创建分支' : '创建标签';
      const sourceUrl = input.sourceUrl || info?.url || '';
      const targetUrl = input.targetUrl || '';
      issues.push(...validateRepositoryUrl(sourceUrl, info?.repositoryRoot), ...validateRepositoryUrl(targetUrl, info?.repositoryRoot));
      if (!input.message) issues.push('远端 copy 必须填写提交说明。');
      if (sourceUrl && targetUrl && stripUrlSlash(sourceUrl) === stripUrlSlash(targetUrl)) issues.push('源 URL 与目标 URL 不能相同。');
      commands.push(`svn copy ${quoteRelative(sourceUrl)} ${quoteRelative(targetUrl)} -m <message> --encoding utf-8`);
      details.push(`源：${sourceUrl || '未填写'}`, `目标：${targetUrl || '未填写'}`, '直接在仓库端创建，不包含未提交的本地修改。');
      input.sourceUrl = sourceUrl;
    } else if (operation === 'switch') {
      title = '切换工作副本'; destructive = true;
      issues.push(...validateRepositoryUrl(input.targetUrl || '', info?.repositoryRoot));
      if (candidates.length > 0) issues.push(`工作副本存在 ${candidates.length} 个本地变更，已阻止切换。`);
      commands.push(`svn switch ${quoteRelative(input.targetUrl || '')} ${quoteRelative(session.scope.repositoryRoot)} --accept postpone`);
      details.push('切换工作副本 URL；执行后必须重新采集状态。');
    } else if (operation === 'relocate') {
      title = '重定位仓库根地址'; destructive = true;
      const oldRoot = info?.repositoryRoot || '';
      issues.push(...validateRepositoryUrl(oldRoot), ...validateRepositoryUrl(input.targetUrl || ''));
      if (candidates.length > 0) issues.push(`工作副本存在 ${candidates.length} 个本地变更，已阻止重定位。`);
      commands.push(`svn switch --relocate ${quoteRelative(oldRoot)} ${quoteRelative(input.targetUrl || '')} ${quoteRelative(session.scope.repositoryRoot)}`);
      details.push(`旧根：${oldRoot || '未解析'}`, `新根：${input.targetUrl || '未填写'}`);
      input.sourceUrl = oldRoot;
    } else if (operation === 'merge') {
      title = '合并到当前工作副本'; destructive = true;
      issues.push(...validateRepositoryUrl(input.sourceUrl || '', info?.repositoryRoot));
      if (candidates.length > 0) issues.push(`工作副本存在 ${candidates.length} 个本地变更，已阻止合并。`);
      commands.push(`svn merge ${quoteRelative(input.sourceUrl || '')} ${quoteRelative(session.scope.repositoryRoot)} --accept postpone`);
      details.push('合并只写入工作副本，不会自动提交；冲突统一进入冲突模块。');
    } else {
      title = '创建本地搁置（补丁 + 还原）'; destructive = true;
      const name = input.shelfName || '';
      if (!/^[A-Za-z0-9._-]{1,64}$/.test(name)) issues.push('搁置名称只能包含字母、数字、点、下划线和连字符，长度 1–64。');
      if (candidates.length === 0) issues.push('当前范围没有可搁置变更。');
      const unsupported = candidates.filter((item) => !['modified', 'deleted', 'missing', 'replaced'].includes(item.status));
      if (unsupported.length > 0) issues.push(`有 ${unsupported.length} 个新增、未版本化、冲突或其他不安全项，不能进入本地搁置。`);
      commands.push(`svn diff <current-scope> > ${name || '<shelf-name>'}.patch`, 'svn revert --depth empty <exact-files>');
      details.push(...candidates.map((item) => `${item.status} ${item.relativePath}`));
    }

    const state = this.ensureAdvancedRepositoryState(session);
    state.feedback = undefined;
    state.preview = { token: randomUUID(), candidateHash: hashCandidateState(candidates, '', []), operation, title, commands, details, issues: [...new Set(issues)], destructive, input };
    await this.sendRepositorySnapshot(session, requestId);
  }

  private async selectPatchForPreview(session: WorkbenchSession, requestId?: string): Promise<void> {
    const selection = await vscode.window.showOpenDialog({ canSelectFiles: true, canSelectFolders: false, canSelectMany: false, filters: { '补丁文件': ['patch', 'diff'] }, title: '选择要应用到当前范围的补丁' });
    if (!selection?.[0]) return;
    const patchPath = selection[0].fsPath;
    let patchIssues: string[] = [];
    try {
      const stat = await fs.stat(patchPath);
      if (stat.size > MAX_PATCH_BYTES) {
        patchIssues = [`补丁超过 ${MAX_PATCH_BYTES / 1024 / 1024} MB 安全上限。`];
      } else {
        patchIssues = validatePatchText(await fs.readFile(patchPath, 'utf8'), MAX_PATCH_BYTES);
      }
    } catch (error) {
      patchIssues = [`无法读取补丁：${errorMessage(error)}`];
    }
    const result = patchIssues.length === 0
      ? await runSvnCommand(session.svnPath, ['patch', '--dry-run', patchPath, session.scope.repositoryRoot], session.scope.repositoryRoot, { maxOutputBytes: MAX_DIFF_BYTES })
      : undefined;
    const candidates = await collectCommitCandidates(session.svnPath, session.scope);
    const state = this.ensureAdvancedRepositoryState(session);
    state.preview = {
      token: randomUUID(), candidateHash: hashCandidateState(candidates, '', []), operation: 'apply-patch', title: '应用补丁',
      commands: [`svn patch ${quoteRelative(patchPath)} ${quoteRelative(session.scope.repositoryRoot)}`],
      details: [`文件：${patchPath}`, '已执行 svn patch --dry-run；正式执行只写入工作副本，不会自动提交。'],
      issues: patchIssues.length > 0 ? patchIssues : result?.exitCode === 0 ? [] : [result?.stderr || result?.stdout || '补丁试运行失败。'], destructive: true, input: { patchPath }
    };
    await this.sendRepositorySnapshot(session, requestId);
  }

  private async executeAdvancedRepositoryOperation(session: WorkbenchSession, previewToken: string | undefined, requestId?: string): Promise<void> {
    const state = this.ensureAdvancedRepositoryState(session);
    const preview = state.preview;
    if (!previewToken || !preview || preview.token !== previewToken || preview.issues.length > 0) {
      await this.sendError('repository', '高级操作预览已失效', '请重新生成操作预览。', true, requestId);
      return;
    }
    const candidates = await collectCommitCandidates(session.svnPath, session.scope);
    if (hashCandidateState(candidates, '', []) !== preview.candidateHash) {
      state.preview = undefined;
      await this.sendError('repository', '工作副本已变化', '高级操作已阻止，请刷新状态并重新预览。', true, requestId);
      return;
    }

    const controller = new AbortController();
    session.activeOperation = { moduleId: 'repository', controller };
    await this.post({
      protocolVersion: WORKBENCH_PROTOCOL_VERSION,
      type: 'operation/progress',
      requestId,
      moduleId: 'repository',
      payload: { title: `正在${preview.title}`, message: preview.commands[0], cancellable: true }
    });

    let result: Awaited<ReturnType<typeof runSvnCommand>> | undefined;
    let successMessage = '';
    try {
      const input = preview.input;
      if (preview.operation === 'branch' || preview.operation === 'tag') {
        result = await runSvnCommand(session.svnPath, ['copy', input.sourceUrl, input.targetUrl, '-m', input.message, '--encoding', 'utf-8'], session.scope.repositoryRoot, { signal: controller.signal });
        successMessage = `${preview.operation === 'branch' ? '分支' : '标签'}已在仓库端创建：${input.targetUrl}`;
      } else if (preview.operation === 'switch') {
        result = await runSvnCommand(session.svnPath, ['switch', input.targetUrl, session.scope.repositoryRoot, '--accept', 'postpone'], session.scope.repositoryRoot, { signal: controller.signal });
        successMessage = `工作副本已切换到 ${input.targetUrl}。`;
      } else if (preview.operation === 'relocate') {
        result = await runSvnCommand(session.svnPath, ['switch', '--relocate', input.sourceUrl, input.targetUrl, session.scope.repositoryRoot], session.scope.repositoryRoot, { signal: controller.signal });
        successMessage = `仓库根地址已重定位到 ${input.targetUrl}。`;
      } else if (preview.operation === 'merge') {
        result = await runSvnCommand(session.svnPath, ['merge', input.sourceUrl, session.scope.repositoryRoot, '--accept', 'postpone'], session.scope.repositoryRoot, { signal: controller.signal });
        successMessage = '合并结果已写入工作副本；尚未提交，请检查变更与冲突。';
      } else if (preview.operation === 'apply-patch') {
        result = await runSvnCommand(session.svnPath, ['patch', input.patchPath, session.scope.repositoryRoot], session.scope.repositoryRoot, { signal: controller.signal, maxOutputBytes: MAX_DIFF_BYTES });
        successMessage = '补丁已写入工作副本；尚未提交，请检查变更。';
      } else {
        successMessage = await this.createLocalShelf(session, candidates, input.shelfName, controller.signal);
      }
    } catch (error) {
      state.preview = undefined;
      state.feedback = `操作失败：${errorMessage(error)}`;
      await this.sendError('repository', `${preview.title}失败`, errorMessage(error), true, requestId);
      await this.sendRepositorySnapshot(session, requestId);
      return;
    } finally {
      if (session.activeOperation?.controller === controller) session.activeOperation = undefined;
    }

    state.preview = undefined;
    if (result?.cancelled || controller.signal.aborted) {
      state.feedback = '操作已取消；工作副本可能已发生部分变化，请刷新并重新检查。';
      await this.post({ protocolVersion: WORKBENCH_PROTOCOL_VERSION, type: 'operation/cancelled', requestId, moduleId: 'repository', payload: { title: `${preview.title}已取消`, message: state.feedback } });
    } else if (result && result.exitCode !== 0) {
      state.feedback = result.stderr || result.stdout || 'SVN 操作失败。';
      await this.sendError('repository', `${preview.title}失败`, state.feedback, true, requestId);
    } else {
      state.feedback = successMessage;
    }
    await this.sendRepositorySnapshot(session, requestId);
  }

  private async createLocalShelf(
    session: WorkbenchSession,
    candidates: Awaited<ReturnType<typeof collectCommitCandidates>>,
    shelfName: string,
    signal: AbortSignal
  ): Promise<string> {
    const shelfCandidates = candidates.filter((item) => ['modified', 'deleted', 'missing', 'replaced'].includes(item.status));
    if (shelfCandidates.length !== candidates.length || shelfCandidates.length === 0) throw new Error('搁置候选状态已变化，请重新预览。');
    const absolutePaths = shelfCandidates.map((item) => item.absolutePath);
    if (validatePathsInScope(session.scope, absolutePaths).outOfScopeItems.length > 0) throw new Error('搁置中包含当前操作范围外路径。');
    const relativePaths = shelfCandidates.map((item) => normalizeRelative(item.relativePath));
    const diff = await runSvnCommand(session.svnPath, ['diff', ...relativePaths], session.scope.repositoryRoot, { signal, maxOutputBytes: MAX_PATCH_BYTES });
    if (diff.cancelled) throw new Error('创建搁置已取消。');
    if (diff.exitCode !== 0 || diff.truncated || !diff.stdout.trim()) throw new Error(diff.stderr || '无法生成完整的搁置补丁。');
    const patchIssues = validatePatchText(diff.stdout, MAX_PATCH_BYTES);
    if (patchIssues.length > 0) throw new Error(patchIssues.join(' '));

    const shelfDirectory = path.join(this.context.globalStorageUri.fsPath, 'shelves', session.repositoryUuid);
    await fs.mkdir(shelfDirectory, { recursive: true, mode: 0o700 });
    const patchPath = path.join(shelfDirectory, `${shelfName}-${Date.now()}.patch`);
    await fs.writeFile(patchPath, diff.stdout, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    const revert = await runSvnCommand(session.svnPath, ['revert', '--depth', 'empty', ...absolutePaths], session.scope.repositoryRoot, { signal });
    if (revert.cancelled) throw new Error(`还原已取消；补丁已安全保存在 ${patchPath}，请检查工作副本。`);
    if (revert.exitCode !== 0) throw new Error(`${revert.stderr || '还原失败。'} 补丁已安全保存在 ${patchPath}。`);
    appendOutput(`搁置补丁已保存：${patchPath}`);
    return `本地搁置已创建并还原 ${absolutePaths.length} 个文件；补丁：${patchPath}`;
  }

  private async exportScopePatch(session: WorkbenchSession, requestId?: string): Promise<void> {
    const relativePaths = session.scope.roots.map((root) => normalizeRelative(path.relative(session.scope.repositoryRoot, root.absolutePath)) || '.');
    const result = await runSvnCommand(session.svnPath, ['diff', ...relativePaths], session.scope.repositoryRoot, { maxOutputBytes: MAX_PATCH_BYTES });
    if (result.exitCode !== 0 || result.truncated) {
      await this.sendError('repository', '导出补丁失败', result.stderr || '补丁超过 20 MB 安全上限。', true, requestId);
      return;
    }
    const destination = await vscode.window.showSaveDialog({
      title: '导出当前范围补丁',
      defaultUri: vscode.Uri.file(path.join(session.scope.repositoryRoot, 'svn-workbench.patch')),
      filters: { '补丁文件': ['patch', 'diff'] },
      saveLabel: '导出补丁'
    });
    if (!destination) return;
    await vscode.workspace.fs.writeFile(destination, Buffer.from(result.stdout, 'utf8'));
    this.ensureAdvancedRepositoryState(session).feedback = `补丁已导出：${destination.fsPath}`;
    await this.sendRepositorySnapshot(session, requestId);
  }

  private async generateReleaseNotes(session: WorkbenchSession, fromRevision: string | undefined, toRevision: string | undefined, requestId?: string): Promise<void> {
    if ((fromRevision && !/^\d+$/.test(fromRevision)) || (toRevision && !/^\d+$/.test(toRevision))) {
      await this.sendError('repository', '修订范围无效', '起止修订号只能填写正整数。', true, requestId);
      return;
    }
    const [revisions, infoResult] = await Promise.all([
      collectSvnHistory(session.svnPath, session.scope, 200),
      runSvnCommand(session.svnPath, ['info', '--xml', session.scope.repositoryRoot], session.scope.repositoryRoot)
    ]);
    const info = infoResult.exitCode === 0 ? parseInfoXml(infoResult.stdout, session.scope.repositoryRoot) : undefined;
    const advanced = this.ensureAdvancedRepositoryState(session);
    advanced.releaseNotes = buildReleaseNotes(revisions, fromRevision, toRevision, info?.url);
    advanced.feedback = `已从 ${revisions.length} 条已加载历史中生成 ${advanced.releaseNotes.count} 条发布记录。`;
    await this.sendRepositorySnapshot(session, requestId);
  }

  private async sendRepositorySnapshot(session: WorkbenchSession, requestId?: string): Promise<void> {
    const snapshot = await this.buildRepositorySnapshot(session);
    await this.post({
      protocolVersion: WORKBENCH_PROTOCOL_VERSION,
      type: 'module/snapshot',
      requestId,
      moduleId: 'repository',
      payload: { snapshot }
    });
  }

  private async createUpdatePreview(session: WorkbenchSession, requestId?: string): Promise<void> {
    const candidates = await collectCommitCandidates(session.svnPath, session.scope);
    const base = buildUpdateScopePreview(session.scope, candidates);
    let remoteChanges: Awaited<ReturnType<typeof checkUpdateScopeRemoteChanges>> | undefined;
    let remoteCheckError: string | undefined;
    try {
      remoteChanges = await checkUpdateScopeRemoteChanges(session.svnPath, session.scope);
    } catch (error) {
      remoteCheckError = errorMessage(error);
    }
    const risk = summarizeUpdateScopeRisk(session.scope, candidates, remoteChanges, remoteCheckError);
    const token = randomUUID();
    session.repositoryState = {
      update: {
        token,
        canExecute: !remoteCheckError && base.localChanges.blocked === 0,
        localCount: base.localChanges.total,
        remoteCount: remoteChanges?.total,
        checkedRevision: remoteChanges?.checkedRevision,
        risk: risk.level,
        overlapPaths: risk.overlapPaths,
        messages: risk.messages,
        commands: [`svn update --accept postpone ${session.scope.roots.map((root) => `"${normalizeRelative(root.relativePath).replace(/"/g, '\\"')}"`).join(' ')}`],
        error: remoteCheckError
      },
      candidateHash: hashCandidateState(candidates, '', []),
      lastResult: session.repositoryState?.lastResult,
      propertyPreview: session.repositoryState?.propertyPreview,
      propertyFeedback: session.repositoryState?.propertyFeedback,
      cleanupPreview: session.repositoryState?.cleanupPreview,
      cleanupFeedback: session.repositoryState?.cleanupFeedback
    };
    await this.sendRepositorySnapshot(session, requestId);
  }

  private async sendAiReviewSnapshot(session: WorkbenchSession, requestId?: string): Promise<void> {
    const candidates = await collectCommitCandidates(session.svnPath, session.scope);
    const snapshot = await buildLocalChangeReview(candidates);
    await this.post({ protocolVersion: WORKBENCH_PROTOCOL_VERSION, type: 'module/snapshot', requestId, moduleId: 'ai-review', payload: { snapshot } });
  }

  private async sendImpactSnapshot(session: WorkbenchSession, requestId?: string): Promise<void> {
    const candidates = await collectCommitCandidates(session.svnPath, session.scope);
    const snapshot = buildLocalImpactAnalysis(candidates);
    await this.post({ protocolVersion: WORKBENCH_PROTOCOL_VERSION, type: 'module/snapshot', requestId, moduleId: 'impact', payload: { snapshot } });
  }

  private async buildChangelistsSnapshot(
    session: WorkbenchSession,
    providedCandidates?: Awaited<ReturnType<typeof collectCommitCandidates>>,
    previewIssues?: string[]
  ) {
    const candidates = providedCandidates ?? await collectCommitCandidates(session.svnPath, session.scope);
    const groups = await collectSvnChangelists(session.svnPath, session.scope);
    const assigned = new Set(groups.flatMap((group) => group.paths));
    const state = session.changelistState ?? { suggestions: [], warnings: [], source: 'local-rule' as const };
    session.changelistState = state;
    const preview = state.preview;
    return {
      kind: 'changelists' as const,
      aiPrivacy: { model: session.aiModels.commitSplit || '本地规则（未配置外部模型）', fileLimit: 120, data: '文件相对路径、状态、类型和模块分组；不发送文件正文', historyIncluded: false as const },
      groups,
      unassigned: candidates.filter((item) => !assigned.has(item.relativePath)).map((candidate) => ({
        relativePath: candidate.relativePath,
        status: candidate.status,
        propStatus: candidate.propStatus,
        fileType: candidate.fileType,
        selection: candidate.selection,
        reason: candidate.reason
      })),
      suggestions: state.suggestions,
      warnings: state.warnings,
      source: state.source,
      fallbackReason: state.fallbackReason,
      preview: preview ? {
        token: preview.token,
        name: preview.name,
        remove: preview.remove,
        paths: preview.paths,
        command: preview.remove
          ? `svn changelist --remove ${preview.paths.map(quoteRelative).join(' ')}`
          : `svn changelist "${(preview.name ?? '').replace(/"/g, '\\"')}" ${preview.paths.map(quoteRelative).join(' ')}`,
        canExecute: (previewIssues ?? preview.issues).length === 0,
        issues: previewIssues ?? preview.issues
      } : undefined,
      feedback: state.feedback
    };
  }

  private async sendChangelistsSnapshot(
    session: WorkbenchSession,
    requestId?: string,
    candidates?: Awaited<ReturnType<typeof collectCommitCandidates>>,
    previewIssues?: string[]
  ): Promise<void> {
    const snapshot = await this.buildChangelistsSnapshot(session, candidates, previewIssues);
    await this.post({ protocolVersion: WORKBENCH_PROTOCOL_VERSION, type: 'module/snapshot', requestId, moduleId: 'changelists', payload: { snapshot } });
  }

  private async sendAgentSnapshot(session: WorkbenchSession, requestId?: string): Promise<void> {
    const snapshot = session.agentState?.snapshot ?? emptyAgentSnapshot();
    await this.post({ protocolVersion: WORKBENCH_PROTOCOL_VERSION, type: 'module/snapshot', requestId, moduleId: 'agent', payload: { snapshot } });
  }

  private async sendChangesSnapshot(
    session: WorkbenchSession,
    requestId?: string,
    providedCandidates?: Awaited<ReturnType<typeof collectCommitCandidates>>
  ): Promise<void> {
    const candidates = providedCandidates ?? await collectCommitCandidates(session.svnPath, session.scope);
    const summary = summarizeCommitCandidates(candidates);
    const preview = session.changesState?.preview;
    const snapshot: import('../../protocol/workbenchProtocol').ChangesSnapshot = {
      kind: 'changes',
      commitDraft: this.ensureCommitState(session).message,
      files: await buildWorkbenchFileViews(candidates, session.scopeView.repositoryName),
      summary: summary.statuses,
      refreshedAt: new Date().toISOString(),
      operationPreview: preview ? {
        token: preview.token, operation: preview.operation, paths: preview.paths,
        ignoreMode: preview.ignoreMode,
        command: formatFileOperationCommand(preview.operation, preview.paths, preview.ignoreMode),
        consequences: fileOperationConsequences(preview.operation, preview.ignoreMode),
        destructive: preview.operation === 'revert' || preview.operation === 'remove',
        recoverability: fileOperationRecoverability(preview.operation),
        canExecute: preview.issues.length === 0, issues: preview.issues
      } : undefined,
      feedback: session.changesState?.feedback
    };
    await this.post({ protocolVersion: WORKBENCH_PROTOCOL_VERSION, type: 'module/snapshot', requestId, moduleId: 'changes', payload: { snapshot } });
  }

  private async prepareInitialFileOperation(session: WorkbenchSession): Promise<void> {
    const initial = session.initialFileOperation;
    if (!initial) return;
    session.initialFileOperation = undefined;
    const candidates = await collectCommitCandidates(session.svnPath, session.scope);
    const paths = candidates.map((candidate) => candidate.relativePath);
    const issues = validateFileOperation(candidates, initial.operation, paths, session.scope, initial.ignoreMode);
    session.changesState = {
      preview: {
        token: randomUUID(), candidateHash: hashCandidateState(candidates, '', []), operation: initial.operation,
        ignoreMode: initial.operation === 'ignore' ? initial.ignoreMode ?? 'directory' : undefined, paths, issues
      }
    };
    await this.sendChangesSnapshot(session, undefined, candidates);
  }

  private ensureCommitState(session: WorkbenchSession): CommitSessionState {
    if (!session.commitState) {
      session.commitState = {
        message: '',
        selectedPaths: session.selectedPaths
      };
    }
    return session.commitState;
  }

  private async buildCommitSnapshot(
    session: WorkbenchSession,
    providedCandidates?: Awaited<ReturnType<typeof collectCommitCandidates>>
  ): Promise<CommitSnapshot> {
    const state = this.ensureCommitState(session);
    const candidates = providedCandidates ?? await collectCommitCandidates(session.svnPath, session.scope);
    const summary = summarizeCommitCandidates(candidates);
    if (!state.selectedPaths) {
      state.selectedPaths = candidates
        .filter((candidate) => candidate.selection === 'selected')
        .map((candidate) => candidate.relativePath);
    }
    const candidatePaths = new Set(candidates.map((candidate) => candidate.relativePath));
    state.selectedPaths = state.selectedPaths.filter((relativePath) => candidatePaths.has(relativePath));

    const convention = await resolveCommitConventionConfig(session.scope.repositoryRoot);
    const storedAi = await readStoredAiConfiguration(this.context);
    const memoryCount = storedAi.includeCommitHistory
      ? Math.min(storedAi.historyLimit, readTeamMemory(this.context.workspaceState, session.repositoryUuid).entries.length)
      : 0;
    const messageIssues = [
      ...validateCommitMessage(state.message).issues,
      ...validateCommitMessageConvention(state.message, convention.config).issues
    ];

    return {
      kind: 'commit',
      files: candidates.map((candidate) => ({
        relativePath: candidate.relativePath,
        status: candidate.status,
        propStatus: candidate.propStatus,
        fileType: candidate.fileType,
        selection: candidate.selection,
        reason: candidate.reason
      })),
      summary: {
        total: summary.total,
        selected: summary.selected,
        needsReview: summary.needsReview,
        excluded: summary.excluded,
        blocked: summary.blocked
      },
      selectedPaths: state.selectedPaths,
      message: state.message,
      messageIssues,
      conventionHint: convention.config.enabled
        ? `前缀：${convention.config.allowedPrefixes.join(', ')}；模块：${convention.config.allowedModules.join(', ')}`
        : '',
      templates: defaultCommitMessageTemplates,
      preview: state.preview?.view,
      ai: state.ai,
      aiPrivacy: [
        { scenario: 'selection', model: session.aiModels.commitSelection || '本地规则（未配置外部模型）', fileLimit: 200, data: '文件相对路径、SVN 状态、文件类型和规则判断；不发送文件正文', historyIncluded: false },
        { scenario: 'message', model: session.aiModels.commitMessage || '本地规则（未配置外部模型）', fileLimit: 80, data: '已选文件元数据与增删行统计；不发送文件正文', historyIncluded: storedAi.includeCommitHistory, historyCount: memoryCount }
      ]
    };
  }

  private async sendCommitSnapshot(
    session: WorkbenchSession,
    requestId?: string,
    candidates?: Awaited<ReturnType<typeof collectCommitCandidates>>
  ): Promise<void> {
    session.moduleId = 'commit';
    session.taskId = defaultWorkbenchTask('commit');
    const snapshot = await this.buildCommitSnapshot(session, candidates);
    await this.post({
      protocolVersion: WORKBENCH_PROTOCOL_VERSION,
      type: 'module/snapshot',
      requestId,
      moduleId: 'commit',
      payload: { snapshot }
    });
  }

  private resolveSelectedAbsolutePaths(
    session: WorkbenchSession,
    candidates: Awaited<ReturnType<typeof collectCommitCandidates>>
  ): string[] {
    const state = this.ensureCommitState(session);
    const selected = new Set(state.selectedPaths ?? []);
    return candidates
      .filter((candidate) => selected.has(candidate.relativePath))
      .map((candidate) => candidate.absolutePath);
  }

  private async createCommitPreview(session: WorkbenchSession, requestId?: string): Promise<void> {
    const state = this.ensureCommitState(session);
    const candidates = await collectCommitCandidates(session.svnPath, session.scope);
    const selectedAbsolutePaths = this.resolveSelectedAbsolutePaths(session, candidates);
    const plan = buildCommitPlanPreview(session.scope, candidates, selectedAbsolutePaths);
    const convention = await resolveCommitConventionConfig(session.scope.repositoryRoot);
    const issues = [
      ...validateCommitMessage(state.message).issues,
      ...validateCommitMessageConvention(state.message, convention.config).issues,
      ...plan.issues.map((issue) => issue.path ? `${normalizeRelative(path.relative(session.scope.repositoryRoot, issue.path))}：${issue.reason}` : issue.reason)
    ];

    let checkedRevision: string | undefined;
    let outOfDatePaths: string[] = [];
    if (plan.commitPaths.length > 0) {
      try {
        const remote = await checkPreCommitRemoteUpdates(session.svnPath, session.scope, plan.commitPaths);
        checkedRevision = remote.checkedRevision;
        outOfDatePaths = remote.outOfDateItems.map((item) => item.relativePath);
        if (outOfDatePaths.length > 0) {
          issues.push(`远端有 ${outOfDatePaths.length} 个相关更新，请先更新并重新预检。`);
        }
      } catch (error) {
        issues.push(`远端检查失败：${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const token = randomUUID();
    const stateHash = hashCandidateState(candidates, state.message, state.selectedPaths ?? []);
    const view: CommitPlanView = {
      token,
      canExecute: plan.canCommit && issues.length === 0,
      selectedPaths: plan.commitPaths.map((item) => normalizeRelative(path.relative(session.scope.repositoryRoot, item))),
      addPaths: plan.addPaths.map((item) => normalizeRelative(path.relative(session.scope.repositoryRoot, item))),
      removePaths: plan.removePaths.map((item) => normalizeRelative(path.relative(session.scope.repositoryRoot, item))),
      commands: buildRelativeCommitCommands(session.scope.repositoryRoot, plan),
      issues,
      remoteRevision: checkedRevision,
      outOfDatePaths,
      createdAt: new Date().toISOString()
    };
    state.preview = { token, stateHash, plan, view };
    await this.sendCommitSnapshot(session, requestId, candidates);
  }

  private async executeCommit(
    session: WorkbenchSession,
    previewToken: string | undefined,
    requestId?: string
  ): Promise<void> {
    const state = this.ensureCommitState(session);
    const preview = state.preview;
    if (!previewToken || !preview || preview.token !== previewToken || !preview.view.canExecute) {
      await this.sendError('commit', '提交预览已失效', '请重新生成提交预览后再执行。', true, requestId);
      return;
    }

    const candidates = await collectCommitCandidates(session.svnPath, session.scope);
    const stateHash = hashCandidateState(candidates, state.message, state.selectedPaths ?? []);
    if (stateHash !== preview.stateHash) {
      state.preview = undefined;
      await this.sendError('commit', '工作副本已变化', '文件状态、范围或提交说明已变化，请重新预检。', true, requestId);
      return;
    }

    const remote = await checkPreCommitRemoteUpdates(session.svnPath, session.scope, preview.plan.commitPaths);
    if (remote.outOfDateItems.length > 0) {
      state.preview = undefined;
      await this.sendError('commit', '远端状态已变化', '检测到远端更新，请先更新并重新预检。', true, requestId);
      return;
    }

    await this.post({
      protocolVersion: WORKBENCH_PROTOCOL_VERSION,
      type: 'operation/progress',
      requestId,
      moduleId: 'commit',
      payload: { title: '正在提交', message: `${preview.plan.commitPaths.length} 个文件`, cancellable: true }
    });
    const controller = new AbortController();
    session.activeOperation = { moduleId: 'commit', controller };
    let result: Awaited<ReturnType<typeof runCommitFlow>>;
    try {
      result = await runCommitFlow(session.svnPath, toCommitFlowPlan(preview.plan, state.message), { signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted) {
        state.preview = undefined;
        await this.post({
          protocolVersion: WORKBENCH_PROTOCOL_VERSION,
          type: 'operation/cancelled', requestId, moduleId: 'commit',
          payload: { title: '提交已取消', message: 'SVN 进程已停止；可能已完成部分 add/remove，状态已重新采集。' }
        });
        await this.sendCommitSnapshot(session, requestId);
        return;
      }
      throw error;
    } finally {
      if (session.activeOperation?.controller === controller) session.activeOperation = undefined;
    }
    if (result.commitResult.cancelled) {
      state.preview = undefined;
      await this.post({ protocolVersion: WORKBENCH_PROTOCOL_VERSION, type: 'operation/cancelled', requestId, moduleId: 'commit', payload: { title: '提交已取消', message: '状态已重新采集，请确认是否存在部分调度变化。' } });
      await this.sendCommitSnapshot(session, requestId);
      return;
    }
    if (result.commitResult.exitCode !== 0) {
      state.preview = undefined;
      await this.sendError('commit', 'SVN 提交失败', result.commitResult.stderr || result.commitResult.stdout || '未知错误', true, requestId);
      return;
    }

    const committedMessage = state.message;
    try {
      await appendTeamMemory(this.context.workspaceState, session.repositoryUuid, {
        revision: result.revision,
        message: committedMessage
      });
    } catch (error) {
      appendOutput(`Team memory cache failed after successful commit: ${sanitizeDiagnostic(errorMessage(error))}`);
    }
    state.preview = undefined;
    state.selectedPaths = undefined;
    state.message = '';
    state.ai = undefined;
    await this.post({
      protocolVersion: WORKBENCH_PROTOCOL_VERSION,
      type: 'operation/result',
      requestId,
      moduleId: 'commit',
      payload: {
        title: '提交完成',
        message: result.revision ? `已提交为 r${result.revision}` : 'SVN 提交已完成。'
      }
    });
    await this.sendCommitSnapshot(session, requestId);
  }

  private async sendError(
    moduleId: WorkbenchModuleId,
    title: string,
    message: string,
    recoverable: boolean,
    requestId?: string
  ): Promise<void> {
    const safeMessage = sanitizeDiagnostic(message);
    const classification = classifySvnFailure(message);
    const certificate = classification.category === 'certificate' ? extractSvnCertificateDetails(message) : undefined;
    if (this.session) this.session.security.lastCertificate = certificate;
    if (this.session && (classification.category === 'working-copy-locked' || classification.category === 'interrupted')) {
      this.session.recoveryState = {
        category: classification.category,
        title: classification.label,
        detectedAt: new Date().toISOString(),
        steps: classification.guidance,
        requiresFreshPreview: true
      };
      if (this.session.commitState) this.session.commitState.preview = undefined;
      if (this.session.repositoryState) this.session.repositoryState.update = undefined;
    }
    await this.post({
      protocolVersion: WORKBENCH_PROTOCOL_VERSION,
      type: 'operation/error',
      requestId,
      moduleId,
      payload: {
        title,
        message: safeMessage,
        recoverable,
        category: classification.category,
        categoryLabel: classification.label,
        guidance: classification.guidance,
        certificate: certificate ? {
          ...certificate,
          canTrust: Boolean(certificate.host && certificate.fingerprint)
        } : undefined,
        network: classification.networkKind ? { kind: classification.networkKind } : undefined,
        recovery: classification.recoveryModule ? { moduleId: classification.recoveryModule } : undefined
      }
    });
  }

  private async post(message: HostToWebviewMessage): Promise<void> {
    await this.panel?.webview.postMessage({
      ...message,
      taskId: this.session?.moduleId === message.moduleId ? this.session.taskId : defaultWorkbenchTask(message.moduleId),
      repositoryUuid: this.session?.repositoryUuid,
      scopeHash: this.session?.scopeHash
    } satisfies HostToWebviewMessage);
  }
}

function toScopeView(scope: OperationScope): WorkbenchScopeView {
  return {
    repositoryName: path.basename(scope.repositoryRoot) || 'SVN 仓库',
    roots: scope.roots.map((root) => ({ kind: root.kind, relativePath: normalizeRelative(root.relativePath) })),
    source:
      scope.source === 'editorFile'
        ? 'editor'
        : scope.source === 'scmSelection'
          ? 'scm'
          : scope.source === 'commandPalette'
            ? 'commandPalette'
            : 'explorer'
  };
}

function getModuleTitle(moduleId: WorkbenchModuleId, taskId: WorkbenchTaskId): string {
  const taskTitles: Record<WorkbenchTaskId, string> = {
    'changes/overview': '工作副本修改',
    'commit/compose': '提交当前范围',
    'diff/working': '查看本地修改',
    'history/revisions': '历史记录',
    'conflicts/resolve': '冲突处理',
    'changelists/manage': '变更集',
    'ai-review/review': 'AI 变更审查',
    'impact/analyze': '影响与测试',
    'agent/plan': 'AI 任务代理',
    'repository/update': '更新当前范围',
    'repository/recovery': '清理与恢复工作副本',
    'repository/browse': '浏览 SVN 仓库',
    'repository/branch': '创建 SVN 分支',
    'repository/tag': '创建 SVN 标签',
    'repository/switch': '切换工作副本',
    'repository/relocate': '重定位仓库地址',
    'repository/merge': '合并到工作副本',
    'repository/patch-shelf': '补丁与本地搁置',
    'repository/release-notes': '生成发布说明',
    'repository/properties': 'SVN 属性',
    'settings/ai': 'AI 模型设置',
    'settings/team': '团队提交规范',
    'settings/svn': 'SVN 安全设置',
    'diagnostics/environment': '环境诊断',
    'diagnostics/acceptance': '验收清单'
  };
  return `SVN · ${taskTitles[isWorkbenchTaskForModule(taskId, moduleId) ? taskId : defaultWorkbenchTask(moduleId)]}`;
}

async function readFileForDiff(filePath: string): Promise<{ text: string; binary: boolean; truncated: boolean }> {
  try {
    const handle = await fs.open(filePath, 'r');
    try {
      const stat = await handle.stat();
      const byteLength = Math.min(stat.size, MAX_DIFF_BYTES);
      const buffer = Buffer.alloc(byteLength);
      await handle.read(buffer, 0, byteLength, 0);
      return {
        text: containsNull(buffer) ? '' : buffer.toString('utf8'),
        binary: containsNull(buffer),
        truncated: stat.size > MAX_DIFF_BYTES
      };
    } finally {
      await handle.close();
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return { text: '', binary: false, truncated: false };
    }
    throw error;
  }
}

function containsNull(buffer: Buffer): boolean {
  return buffer.includes(0);
}

function truncateUtf8(buffer: Buffer): string {
  return buffer.subarray(0, MAX_DIFF_BYTES).toString('utf8');
}

function normalizeRelative(value: string): string {
  return value.split(path.sep).join('/') || '.';
}

function inferLanguage(filePath: string): string {
  const extension = path.extname(filePath).slice(1).toLowerCase();
  const aliases: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    json: 'json',
    md: 'markdown',
    svelte: 'svelte',
    py: 'python',
    java: 'java',
    xml: 'xml',
    html: 'html',
    css: 'css'
  };
  return aliases[extension] ?? (extension || 'text');
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asStringAllowEmpty(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    return undefined;
  }
  return value;
}

function asRevision(value: unknown): string | undefined {
  return typeof value === 'string' && /^\d+$/.test(value) ? value : undefined;
}

function asRevisionArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string' && /^\d+$/.test(item));
}

function toAiConfigurationInput(data: Record<string, unknown>) {
  const providerPreset = asString(data.providerPreset);
  if (!providerPreset || !AI_PROVIDER_PRESETS.some((item) => item.id === providerPreset)) {
    throw new Error('AI 供应商预设无效。');
  }
  const scenarioModels: Partial<Record<AiUsageScenario, string>> = {};
  if (isRecord(data.scenarioModels)) {
    for (const scenario of AI_USAGE_SCENARIOS) {
      const value = asStringAllowEmpty(data.scenarioModels[scenario.id])?.trim();
      if (value) {
        scenarioModels[scenario.id] = value;
      }
    }
  }
  return {
    providerPreset: providerPreset as AiProviderPresetId,
    baseUrl: asStringAllowEmpty(data.baseUrl) ?? '',
    model: asStringAllowEmpty(data.model) ?? '',
    scenarioModels,
    apiKey: asStringAllowEmpty(data.apiKey),
    clearApiKey: data.clearApiKey === true,
    includeCommitHistory: data.includeCommitHistory === true,
    historyLimit: typeof data.historyLimit === 'number' ? data.historyLimit : Number(asString(data.historyLimit) ?? 10)
  };
}

function toTeamConfig(data: Record<string, unknown>): CommitConventionConfig {
  return buildCommitConventionConfigFromEditorInput({
    enabled: data.enabled === true,
    requiredIssueId: data.requiredIssueId === true,
    issueIdPattern: asStringAllowEmpty(data.issueIdPattern) ?? '',
    requiredModule: data.requiredModule === true,
    allowedModulesText: asStringAllowEmpty(data.allowedModulesText) ?? '',
    requiredPrefix: data.requiredPrefix === true,
    allowedPrefixesText: asStringAllowEmpty(data.allowedPrefixesText) ?? ''
  });
}

function aiConventionToTeamConfig(value: {
  enabled: boolean;
  requiredIssueId: boolean;
  issueIdPattern: string;
  requiredModule: boolean;
  allowedModules: string[];
  requiredPrefix: boolean;
  allowedPrefixes: string[];
}): CommitConventionConfig {
  return {
    enabled: value.enabled,
    requiredIssueId: value.requiredIssueId,
    issueIdPattern: value.issueIdPattern,
    requiredModule: value.requiredModule,
    allowedModules: value.allowedModules,
    requiredPrefix: value.requiredPrefix,
    allowedPrefixes: value.allowedPrefixes
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function buildScenarioModelMap(stored: Awaited<ReturnType<typeof readStoredAiConfiguration>>): Partial<Record<AiUsageScenario, string>> {
  return Object.fromEntries(AI_USAGE_SCENARIOS.map((scenario) => [scenario.id, stored.scenarioModels[scenario.id] || stored.model]));
}

function quoteRelative(value: string): string {
  return `"${normalizeRelative(value).replace(/"/g, '\\"')}"`;
}

function emptyAgentSnapshot(): AgentSnapshot {
  return {
    kind: 'agent', status: 'idle', objective: '', steps: [],
    guardrails: ['只访问当前右键范围', '每一步都需要显式批准', '不自动修改文件、不自动提交', '状态变化后计划立即失效']
  };
}

type FileOperation = NonNullable<import('../../protocol/workbenchProtocol').ChangesSnapshot['operationPreview']>['operation'];

type AdvancedRepositoryOperation = NonNullable<import('../../protocol/workbenchProtocol').RepositorySnapshot['advanced']['preview']>['operation'];

function asAdvancedRepositoryOperation(value: unknown): AdvancedRepositoryOperation | undefined {
  return value === 'branch' || value === 'tag' || value === 'switch' || value === 'relocate' || value === 'merge' || value === 'apply-patch' || value === 'shelf'
    ? value
    : undefined;
}

function stripUrlSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function repositoryParentUrl(value: string, repositoryRoot?: string): string | undefined {
  const current = stripUrlSlash(value);
  const root = repositoryRoot ? stripUrlSlash(repositoryRoot) : undefined;
  if (!current || current === root) return undefined;
  const slash = current.lastIndexOf('/');
  const parent = slash > current.indexOf('://') + 2 ? current.slice(0, slash) : undefined;
  if (!parent || (root && !parent.startsWith(root))) return undefined;
  return parent;
}

function asFileOperation(value: unknown): FileOperation | undefined {
  return value === 'add' || value === 'remove' || value === 'revert' || value === 'lock' || value === 'unlock' || value === 'ignore'
    ? value
    : undefined;
}

function validateFileOperation(
  candidates: Awaited<ReturnType<typeof collectCommitCandidates>>,
  operation: FileOperation,
  relativePaths: string[],
  scope: OperationScope,
  ignoreMode: 'directory' | 'repository' = 'directory'
): string[] {
  const issues: string[] = [];
  const byPath = new Map(candidates.map((item) => [item.relativePath, item]));
  if (relativePaths.length === 0) issues.push('请选择至少一个文件。');
  const absolutePaths = relativePaths.map((item) => path.resolve(scope.repositoryRoot, item));
  if (validatePathsInScope(scope, absolutePaths).outOfScopeItems.length > 0) issues.push('选择中包含当前右键范围外路径。');
  for (const relativePath of relativePaths) {
    const candidate = byPath.get(relativePath);
    if (!candidate) {
      issues.push(`${relativePath} 状态已变化或不属于当前候选。`);
      continue;
    }
    const allowed = operation === 'add'
      ? candidate.status === 'unversioned'
      : operation === 'ignore'
        ? candidate.status === 'unversioned'
        : operation === 'revert'
          ? ['modified', 'added', 'deleted', 'missing', 'replaced'].includes(candidate.status)
          : operation === 'remove'
            ? ['modified', 'added', 'replaced'].includes(candidate.status)
            : !['unversioned', 'added', 'deleted', 'missing', 'conflicted'].includes(candidate.status);
    if (!allowed) issues.push(`${relativePath} 的 ${candidate.status} 状态不支持 ${operation}。`);
  }
  if (operation === 'ignore') {
    if (ignoreMode === 'repository') {
      const rootIsExplicitlySelected = scope.roots.some((root) => root.kind === 'folder' && path.resolve(root.absolutePath) === path.resolve(scope.repositoryRoot));
      if (!rootIsExplicitlySelected) issues.push('仓库继承忽略会修改根目录 svn:global-ignores；请从仓库根目录右键进入后再选择。');
    } else {
      const parents = absolutePaths.map((item) => path.dirname(item));
      if (validatePathsInScope(scope, parents).outOfScopeItems.length > 0) {
        issues.push('目录忽略会修改父目录 svn:ignore，但父目录不在当前操作范围内。请从父目录右键进入。');
      }
    }
  }
  return [...new Set(issues)];
}

function buildFileOperationArgs(operation: Exclude<FileOperation, 'ignore'>, absolutePaths: string[]): string[] {
  if (operation === 'add') return ['add', ...absolutePaths];
  if (operation === 'remove') return ['delete', '--force', ...absolutePaths];
  if (operation === 'revert') return ['revert', '--depth', 'empty', ...absolutePaths];
  if (operation === 'lock') return ['lock', ...absolutePaths];
  return ['unlock', ...absolutePaths];
}

function formatFileOperationCommand(operation: FileOperation, relativePaths: string[], ignoreMode?: 'directory' | 'repository'): string {
  const paths = relativePaths.map(quoteRelative).join(' ');
  if (operation === 'ignore') return ignoreMode === 'repository'
    ? `svn propset svn:global-ignores <preserved-patterns+names> <repository-root>  # ${paths}`
    : `svn propset svn:ignore <preserved-rules+names> <parent-directories>  # ${paths}`;
  return `svn ${buildFileOperationArgs(operation, []).join(' ')} ${paths}`.replace(/\s+/g, ' ').trim();
}

function fileOperationConsequences(operation: FileOperation, ignoreMode?: 'directory' | 'repository'): string[] {
  const values: Record<FileOperation, string[]> = {
    add: ['把未版本化文件加入 SVN 调度；不会自动提交。'],
    remove: ['删除工作副本中的文件并调度 SVN Delete；提交后仓库才会生效。'],
    revert: ['丢弃尚未提交的本地变更；此操作通常无法从 SVN 恢复。'],
    lock: ['向仓库申请文件锁；可能需要网络与认证。'],
    unlock: ['释放仓库文件锁；其他成员随后可以获得锁。'],
    ignore: ignoreMode === 'repository'
      ? ['保留根目录现有 svn:global-ignores，并追加所选文件名；规则会由子目录继承，可能影响仓库内同名文件。']
      : ['保留父目录现有 svn:ignore，并追加所选文件名；只影响对应目录。']
  };
  return values[operation];
}

function fileOperationRecoverability(operation: FileOperation): string {
  if (operation === 'revert') return '还原会直接丢弃未提交内容；SVN 无法恢复，执行前请自行导出补丁。';
  if (operation === 'remove') return '提交前可以通过 SVN 还原恢复调度和文件；提交后需通过历史修订恢复。';
  if (operation === 'ignore') return '可以再次编辑对应 SVN 属性移除规则。';
  if (operation === 'add') return '提交前可以还原调度，文件内容仍保留在本地。';
  return operation === 'lock' ? '可以解锁文件来释放锁。' : '可以重新锁定文件，但锁可能已被其他成员获取。';
}

async function buildWorkbenchFileViews(
  candidates: Awaited<ReturnType<typeof collectCommitCandidates>>,
  currentRepositoryName: string
): Promise<import('../../protocol/workbenchProtocol').WorkbenchFileView[]> {
  return Promise.all(candidates.map(async (candidate) => {
    let ownership: 'current' | 'external' | 'nested' = candidate.status === 'external' ? 'external' : 'current';
    if (candidate.status === 'obstructed' || candidate.fileType === 'Folder') {
      try {
        if ((await fs.stat(path.join(candidate.absolutePath, '.svn'))).isDirectory()) ownership = 'nested';
      } catch {
        // Ordinary files and directories remain owned by the current working copy.
      }
    }
    return {
      relativePath: candidate.relativePath, status: candidate.status, propStatus: candidate.propStatus,
      repositoryName: ownership === 'current' ? currentRepositoryName : path.basename(candidate.absolutePath), ownership,
      fileType: candidate.fileType, selection: ownership === 'current' ? candidate.selection : 'blocked',
      reason: ownership === 'nested' ? '嵌套工作副本：必须在其独立 SCM 仓库模型中操作。' : candidate.reason
    };
  }));
}

function fileOperationSuccess(operation: FileOperation, count: number): string {
  const labels: Record<FileOperation, string> = { add: '加入版本控制', remove: '调度删除', revert: '还原', lock: '加锁', unlock: '解锁', ignore: '加入忽略规则' };
  return `${count} 个文件已${labels[operation]}。请刷新并确认最新 SVN 状态。`;
}

async function applyIgnoreOperation(svnPath: string, scope: OperationScope, relativePaths: string[], ignoreMode: 'directory' | 'repository') {
  const byParent = new Map<string, string[]>();
  for (const relativePath of relativePaths) {
    const absolutePath = path.resolve(scope.repositoryRoot, relativePath);
    const parent = ignoreMode === 'repository' ? scope.repositoryRoot : path.dirname(absolutePath);
    byParent.set(parent, [...(byParent.get(parent) ?? []), path.basename(absolutePath)]);
  }
  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'svn-workbench-ignore-'));
  let finalResult: Awaited<ReturnType<typeof runSvnCommand>> | undefined;
  try {
    let index = 0;
    for (const [parent, names] of byParent) {
      const propertyName = ignoreMode === 'repository' ? 'svn:global-ignores' : 'svn:ignore';
      const existing = await runSvnCommand(svnPath, ['propget', propertyName, parent], scope.repositoryRoot);
      const rules = existing.stdout.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
      const next = [...new Set([...rules, ...names])].join('\n') + '\n';
      const rulesFile = path.join(tempDirectory, `rules-${index++}.txt`);
      await fs.writeFile(rulesFile, next, { encoding: 'utf8', mode: 0o600 });
      finalResult = await runSvnCommand(svnPath, ['propset', propertyName, '--file', rulesFile, parent], scope.repositoryRoot);
      if (finalResult.exitCode !== 0) return finalResult;
    }
    if (!finalResult) throw new Error('没有可应用的忽略规则。');
    return finalResult;
  } finally {
    await fs.rm(tempDirectory, { recursive: true, force: true });
  }
}

function hashOperationScope(scope: OperationScope): string {
  return createHash('sha256').update(JSON.stringify({
    repositoryRoot: path.resolve(scope.repositoryRoot),
    roots: scope.roots.map((root) => ({ absolutePath: path.resolve(root.absolutePath), kind: root.kind })).sort((left, right) => left.absolutePath.localeCompare(right.absolutePath)),
    includeExternals: scope.includeExternals,
    includeNestedWorkingCopies: scope.includeNestedWorkingCopies
  })).digest('hex');
}

async function resolveRepositoryUuid(svnPath: string, scope: OperationScope): Promise<string> {
  try {
    const result = await runSvnCommand(svnPath, ['info', '--show-item', 'repos-uuid', scope.repositoryRoot], scope.repositoryRoot);
    const uuid = result.stdout.trim();
    if (result.exitCode === 0 && uuid) return uuid;
  } catch {
    // Settings and diagnostics remain available without a working SVN CLI.
  }
  return `unavailable-${createHash('sha256').update(path.resolve(scope.repositoryRoot)).digest('hex').slice(0, 16)}`;
}

function hashCandidateState(
  candidates: Awaited<ReturnType<typeof collectCommitCandidates>>,
  message: string,
  selectedPaths: string[]
): string {
  const normalized = candidates
    .map((candidate) => [candidate.relativePath, candidate.status, candidate.propStatus ?? '', candidate.selection].join(':'))
    .sort();
  return createHash('sha256')
    .update(JSON.stringify({ candidates: normalized, message, selectedPaths: [...selectedPaths].sort() }))
    .digest('hex');
}

function buildRelativeCommitCommands(
  repositoryRoot: string,
  plan: ReturnType<typeof buildCommitPlanPreview>
): string[] {
  const quote = (filePath: string) => `"${normalizeRelative(path.relative(repositoryRoot, filePath)).replace(/"/g, '\\"')}"`;
  return [
    ...plan.addPaths.map((item) => `svn add ${quote(item)}`),
    ...plan.removePaths.map((item) => `svn remove ${quote(item)}`),
    ...(plan.commitPaths.length > 0
      ? [`svn commit ${plan.commitPaths.map(quote).join(' ')} -F <message-file> --encoding utf-8`]
      : [])
  ];
}

function toConflictContentView(value: { content?: string; truncated: boolean; readError?: string } | undefined) {
  if (!value) {
    return undefined;
  }
  return { content: value.content, truncated: value.truncated, readError: value.readError };
}

async function hashFileContents(filePath: string): Promise<string> {
  try {
    const contents = await fs.readFile(filePath);
    return createHash('sha256').update(contents).digest('hex');
  } catch (error) {
    throw new Error(`无法读取待解决文件：${error instanceof Error ? error.message : String(error)}`);
  }
}

async function hashFileContentsOrMissing(filePath: string): Promise<string> {
  try {
    return createHash('sha256').update(await fs.readFile(filePath)).digest('hex');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing';
    throw error;
  }
}

function getSingleFileScopeRoot(scope: OperationScope) {
  return scope.roots.length === 1 && scope.roots[0].kind === 'file' ? scope.roots[0] : undefined;
}

function getSingleScopeTarget(scope: OperationScope) {
  return scope.roots.length === 1 ? scope.roots[0] : undefined;
}

function getSingleFolderScopeTarget(scope: OperationScope) {
  return scope.roots.length === 1 && scope.roots[0].kind === 'folder' ? scope.roots[0] : undefined;
}

function hashProperties(items: Array<{ name: string; value: string }>): string {
  return createHash('sha256').update(JSON.stringify([...items].sort((left, right) => left.name.localeCompare(right.name)))).digest('hex');
}

function parseBlameOutput(output: string): NonNullable<import('../../protocol/workbenchProtocol').HistorySnapshot['blame']> {
  return output.split(/\r?\n/).filter(Boolean).map((line, index) => {
    const match = /^\s*(\d+|-)\s+(\S+)\s?(.*)$/.exec(line);
    return { line: index + 1, revision: match?.[1] ?? '?', author: match?.[2] ?? '未知', content: match?.[3] ?? line };
  });
}
