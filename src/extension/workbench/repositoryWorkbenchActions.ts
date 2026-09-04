import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import * as vscode from "vscode";
import type { CommitCandidate } from "../../commit/commitCandidateCollector";
import { collectSvnHistory } from "../../history/svnHistory";
import { collectSvnProperties } from "../../properties/svnProperties";
import {
  WORKBENCH_PROTOCOL_VERSION,
  type HostToWebviewMessage,
  type RepositorySnapshot,
  type WorkbenchModuleId,
} from "../../protocol/workbenchProtocol";
import {
  buildReleaseNotes,
  parseSvnListXml,
  validatePatchText,
  validateRepositoryUrl,
} from "../../repository/advancedRepositoryTools";
import { validatePathsInScope } from "../../scope/pathBoundaryGuard";
import { nativePathSemantics } from "../../scope/nativePathSemantics";
import { parseInfoXml } from "../../svn/parsers/infoXmlParser";
import { runSvnCommand } from "../../svn/svnCommandRunner";
import { appendOutput } from "../../diagnostics/outputChannel";
import {
  asAdvancedRepositoryOperation,
  repositoryParentUrl,
  stripUrlSlash,
} from "./workbenchFileOperations";
import {
  errorMessage,
  normalizeRelative,
  quoteRelative,
} from "./workbenchPresentation";
import {
  getSingleFolderScopeTarget,
  getSingleScopeTarget,
  hashCandidateState,
  MAX_DIFF_BYTES,
  MAX_PATCH_BYTES,
} from "./workbenchSupport";
import {
  validateOperationIntentForExecute,
  type OperationIntentKind,
} from "../../operation/operationIntent";
import type { WorkbenchSession } from "./workbenchSession";

export interface RepositoryWorkbenchHost {
  readonly context: vscode.ExtensionContext;
  post(message: HostToWebviewMessage): Promise<void>;
  sendError(
    moduleId: WorkbenchModuleId,
    title: string,
    message: string,
    recoverable: boolean,
    requestId?: string,
  ): Promise<void>;
  /** 统一候选采集入口：经规则服务解析有效规则，保证与各模块一致分类（规划 7.3）。 */
  collectScopeCandidates(session: WorkbenchSession): Promise<CommitCandidate[]>;
  buildRepositorySnapshot(
    session: WorkbenchSession,
  ): Promise<RepositorySnapshot>;
  ensureAdvancedRepositoryState(
    session: WorkbenchSession,
  ): NonNullable<NonNullable<WorkbenchSession["repositoryState"]>["advanced"]>;
  createLocalShelf(
    session: WorkbenchSession,
    candidates: CommitCandidate[],
    shelfName: string,
    signal: AbortSignal,
  ): Promise<string>;
  sendRepositorySnapshot(
    session: WorkbenchSession,
    requestId?: string,
  ): Promise<void>;
}

export class RepositoryWorkbenchActions {
  constructor(private readonly host: RepositoryWorkbenchHost) {}

  async buildRepositorySnapshot(session: WorkbenchSession) {
    const infoResult = await runSvnCommand(
      session.svnPath,
      ["info", "--xml", session.scope.repositoryRoot],
      session.scope.repositoryRoot,
    );
    const info =
      infoResult.exitCode === 0
        ? parseInfoXml(infoResult.stdout, session.scope.repositoryRoot)
        : undefined;
    const propertyTarget = getSingleScopeTarget(session.scope);
    const propertyResult = propertyTarget
      ? await collectSvnProperties(
          session.svnPath,
          propertyTarget.absolutePath,
          session.scope.repositoryRoot,
        )
      : { items: [], error: "请选择单个文件或文件夹以查看和编辑 SVN 属性。" };
    const propertyPreview = session.repositoryState?.propertyPreview;
    const cleanupTarget = getSingleFolderScopeTarget(session.scope);
    const cleanupPreview = session.repositoryState?.cleanupPreview;
    return {
      kind: "repository" as const,
      recovery: session.recoveryState,
      info: {
        name: path.basename(session.scope.repositoryRoot),
        url: info?.url,
        repositoryRoot: info?.repositoryRoot,
        revision: info?.revision,
      },
      properties: {
        available: Boolean(propertyTarget && !propertyResult.error),
        target: propertyTarget
          ? normalizeRelative(propertyTarget.relativePath)
          : "多个范围",
        items: propertyResult.items,
        error: propertyResult.error,
        feedback: session.repositoryState?.propertyFeedback,
        preview: propertyPreview
          ? {
              token: propertyPreview.token,
              name: propertyPreview.name,
              value: propertyPreview.remove ? undefined : propertyPreview.value,
              remove: propertyPreview.remove,
              command: propertyPreview.remove
                ? `svn propdel ${quoteRelative(propertyPreview.name)} ${quoteRelative(normalizeRelative(path.relative(session.scope.repositoryRoot, propertyPreview.target)))}`
                : `svn propset ${quoteRelative(propertyPreview.name)} <value> ${quoteRelative(normalizeRelative(path.relative(session.scope.repositoryRoot, propertyPreview.target)))}`,
              canExecute: propertyPreview.issues.length === 0,
              issues: propertyPreview.issues,
            }
          : undefined,
      },
      cleanup: {
        available: Boolean(cleanupTarget),
        target: cleanupTarget
          ? normalizeRelative(cleanupTarget.relativePath)
          : "非单文件夹范围",
        reason: cleanupTarget
          ? undefined
          : "请从一个 SVN 文件夹右键进入后再执行清理。",
        feedback: session.repositoryState?.cleanupFeedback,
        preview: cleanupPreview
          ? {
              token: cleanupPreview.token,
              command: cleanupPreview.target
                ? `svn cleanup ${quoteRelative(normalizeRelative(path.relative(session.scope.repositoryRoot, cleanupPreview.target)))}`
                : "svn cleanup <single-folder-scope>",
              canExecute: cleanupPreview.issues.length === 0,
              issues: cleanupPreview.issues,
            }
          : undefined,
      },
      advanced: {
        browser: session.repositoryState?.advanced?.browser,
        releaseNotes: session.repositoryState?.advanced?.releaseNotes,
        feedback: session.repositoryState?.advanced?.feedback,
        preview: session.repositoryState?.advanced?.preview
          ? {
              token: session.repositoryState.advanced.preview.token,
              operation: session.repositoryState.advanced.preview.operation,
              title: session.repositoryState.advanced.preview.title,
              commands: session.repositoryState.advanced.preview.commands,
              details: session.repositoryState.advanced.preview.details,
              issues: session.repositoryState.advanced.preview.issues,
              canExecute:
                session.repositoryState.advanced.preview.issues.length === 0,
              destructive: session.repositoryState.advanced.preview.destructive,
              scopeHash: session.repositoryState.advanced.preview.scopeHash,
              candidateHash:
                session.repositoryState.advanced.preview.candidateHash,
              repositoryUuid:
                session.repositoryState.advanced.preview.repositoryUuid,
            }
          : undefined,
      },
    };
  }

  ensureAdvancedRepositoryState(
    session: WorkbenchSession,
  ): NonNullable<NonNullable<WorkbenchSession["repositoryState"]>["advanced"]> {
    session.repositoryState ??= {};
    session.repositoryState.advanced ??= {};
    return session.repositoryState.advanced;
  }

  async browseRepository(
    session: WorkbenchSession,
    requestedUrl: string | undefined,
    requestId?: string,
  ): Promise<void> {
    const infoResult = await runSvnCommand(
      session.svnPath,
      ["info", "--xml", session.scope.repositoryRoot],
      session.scope.repositoryRoot,
    );
    const info =
      infoResult.exitCode === 0
        ? parseInfoXml(infoResult.stdout, session.scope.repositoryRoot)
        : undefined;
    const url = requestedUrl?.trim() || info?.url || info?.repositoryRoot;
    const state = this.host.ensureAdvancedRepositoryState(session);
    if (!url) {
      state.browser = { url: "", entries: [], error: "未能解析当前仓库 URL。" };
      await this.host.sendRepositorySnapshot(session, requestId);
      return;
    }
    const issues = validateRepositoryUrl(url, info?.repositoryRoot);
    if (issues.length > 0) {
      state.browser = { url, entries: [], error: issues.join(" ") };
      await this.host.sendRepositorySnapshot(session, requestId);
      return;
    }
    const result = await runSvnCommand(
      session.svnPath,
      ["list", "--xml", url],
      session.scope.repositoryRoot,
    );
    state.browser =
      result.exitCode === 0
        ? {
            url,
            parentUrl: repositoryParentUrl(url, info?.repositoryRoot),
            entries: parseSvnListXml(result.stdout),
          }
        : {
            url,
            entries: [],
            error: result.stderr || result.stdout || "无法读取仓库目录。",
          };
    await this.host.sendRepositorySnapshot(session, requestId);
  }

  async previewAdvancedRepositoryOperation(
    session: WorkbenchSession,
    data: Record<string, unknown>,
    requestId?: string,
  ): Promise<void> {
    const operation = asAdvancedRepositoryOperation(data.operation);
    if (!operation || operation === "apply-patch") {
      await this.host.sendError(
        "repository",
        "高级操作无效",
        "请选择受支持的仓库操作。",
        false,
        requestId,
      );
      return;
    }
    const input = Object.fromEntries(
      Object.entries(data).flatMap(([key, value]) =>
        typeof value === "string" ? [[key, value.trim()]] : [],
      ),
    );
    const infoResult = await runSvnCommand(
      session.svnPath,
      ["info", "--xml", session.scope.repositoryRoot],
      session.scope.repositoryRoot,
    );
    const info =
      infoResult.exitCode === 0
        ? parseInfoXml(infoResult.stdout, session.scope.repositoryRoot)
        : undefined;
    const candidates = await this.host.collectScopeCandidates(session);
    const issues: string[] = [];
    const commands: string[] = [];
    const details: string[] = [];
    let title: string;
    let destructive: boolean;

    if (operation === "branch" || operation === "tag") {
      title = operation === "branch" ? "创建分支" : "创建标签";
      destructive = false;
      const sourceUrl = input.sourceUrl || info?.url || "";
      const targetUrl = input.targetUrl || "";
      issues.push(
        ...validateRepositoryUrl(sourceUrl, info?.repositoryRoot),
        ...validateRepositoryUrl(targetUrl, info?.repositoryRoot),
      );
      if (!input.message) issues.push("远端 copy 必须填写提交说明。");
      if (
        sourceUrl &&
        targetUrl &&
        stripUrlSlash(sourceUrl) === stripUrlSlash(targetUrl)
      )
        issues.push("源 URL 与目标 URL 不能相同。");
      commands.push(
        `svn copy ${quoteRelative(sourceUrl)} ${quoteRelative(targetUrl)} -m <message> --encoding utf-8`,
      );
      details.push(
        `源：${sourceUrl || "未填写"}`,
        `目标：${targetUrl || "未填写"}`,
        "直接在仓库端创建，不包含未提交的本地修改。",
      );
      input.sourceUrl = sourceUrl;
    } else if (operation === "switch") {
      title = "切换工作副本";
      destructive = true;
      issues.push(
        ...validateRepositoryUrl(input.targetUrl || "", info?.repositoryRoot),
      );
      if (candidates.length > 0)
        issues.push(
          `工作副本存在 ${candidates.length} 个本地变更，已阻止切换。`,
        );
      commands.push(
        `svn switch ${quoteRelative(input.targetUrl || "")} ${quoteRelative(session.scope.repositoryRoot)} --accept postpone`,
      );
      details.push("切换工作副本 URL；执行后必须重新采集状态。");
    } else if (operation === "relocate") {
      title = "重定位仓库根地址";
      destructive = true;
      const oldRoot = info?.repositoryRoot || "";
      issues.push(
        ...validateRepositoryUrl(oldRoot),
        ...validateRepositoryUrl(input.targetUrl || ""),
      );
      if (candidates.length > 0)
        issues.push(
          `工作副本存在 ${candidates.length} 个本地变更，已阻止重定位。`,
        );
      commands.push(
        `svn switch --relocate ${quoteRelative(oldRoot)} ${quoteRelative(input.targetUrl || "")} ${quoteRelative(session.scope.repositoryRoot)}`,
      );
      details.push(
        `旧根：${oldRoot || "未解析"}`,
        `新根：${input.targetUrl || "未填写"}`,
      );
      input.sourceUrl = oldRoot;
    } else if (operation === "merge") {
      title = "合并到当前工作副本";
      destructive = true;
      issues.push(
        ...validateRepositoryUrl(input.sourceUrl || "", info?.repositoryRoot),
      );
      if (candidates.length > 0)
        issues.push(
          `工作副本存在 ${candidates.length} 个本地变更，已阻止合并。`,
        );
      commands.push(
        `svn merge ${quoteRelative(input.sourceUrl || "")} ${quoteRelative(session.scope.repositoryRoot)} --accept postpone`,
      );
      details.push("合并只写入工作副本，不会自动提交；冲突统一进入冲突模块。");
    } else {
      title = "创建本地搁置（补丁 + 还原）";
      destructive = true;
      const name = input.shelfName || "";
      if (!/^[A-Za-z0-9._-]{1,64}$/.test(name))
        issues.push(
          "搁置名称只能包含字母、数字、点、下划线和连字符，长度 1–64。",
        );
      if (candidates.length === 0) issues.push("当前范围没有可搁置变更。");
      const unsupported = candidates.filter(
        (item) =>
          !["modified", "deleted", "missing", "replaced"].includes(item.status),
      );
      if (unsupported.length > 0)
        issues.push(
          `有 ${unsupported.length} 个新增、未版本化、冲突或其他不安全项，不能进入本地搁置。`,
        );
      commands.push(
        `svn diff <current-scope> > ${name || "<shelf-name>"}.patch`,
        "svn revert --depth empty <exact-files>",
      );
      details.push(
        ...candidates.map((item) => `${item.status} ${item.relativePath}`),
      );
    }

    const state = this.host.ensureAdvancedRepositoryState(session);
    state.feedback = undefined;
    state.preview = {
      token: randomUUID(),
      candidateHash: hashCandidateState(candidates, "", []),
      // v0.1.6 V016-F1：预览携带生成时绑定，Webview 意向单据此自检 stale。
      scopeHash: session.scopeHash,
      repositoryUuid: session.repositoryUuid,
      operation,
      title,
      commands,
      details,
      issues: [...new Set(issues)],
      destructive,
      input,
    };
    await this.host.sendRepositorySnapshot(session, requestId);
  }

  async selectPatchForPreview(
    session: WorkbenchSession,
    requestId?: string,
  ): Promise<void> {
    const selection = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: { 补丁文件: ["patch", "diff"] },
      title: "选择要应用到当前范围的补丁",
    });
    if (!selection?.[0]) return;
    const patchPath = selection[0].fsPath;
    let patchIssues: string[];
    try {
      const stat = await fs.stat(patchPath);
      if (stat.size > MAX_PATCH_BYTES) {
        patchIssues = [
          `补丁超过 ${MAX_PATCH_BYTES / 1024 / 1024} MB 安全上限。`,
        ];
      } else {
        patchIssues = validatePatchText(
          await fs.readFile(patchPath, "utf8"),
          MAX_PATCH_BYTES,
        );
      }
    } catch (error) {
      patchIssues = [`无法读取补丁：${errorMessage(error)}`];
    }
    const result =
      patchIssues.length === 0
        ? await runSvnCommand(
            session.svnPath,
            ["patch", "--dry-run", patchPath, session.scope.repositoryRoot],
            session.scope.repositoryRoot,
            { maxOutputBytes: MAX_DIFF_BYTES },
          )
        : undefined;
    const candidates = await this.host.collectScopeCandidates(session);
    const state = this.host.ensureAdvancedRepositoryState(session);
    state.preview = {
      token: randomUUID(),
      candidateHash: hashCandidateState(candidates, "", []),
      // v0.1.6 V016-F1：预览携带生成时绑定，Webview 意向单据此自检 stale。
      scopeHash: session.scopeHash,
      repositoryUuid: session.repositoryUuid,
      operation: "apply-patch",
      title: "应用补丁",
      commands: [
        `svn patch ${quoteRelative(patchPath)} ${quoteRelative(session.scope.repositoryRoot)}`,
      ],
      details: [
        `文件：${patchPath}`,
        "已执行 svn patch --dry-run；正式执行只写入工作副本，不会自动提交。",
      ],
      issues:
        patchIssues.length > 0
          ? patchIssues
          : result?.exitCode === 0
            ? []
            : [result?.stderr || result?.stdout || "补丁试运行失败。"],
      destructive: true,
      input: { patchPath },
    };
    await this.host.sendRepositorySnapshot(session, requestId);
  }

  async executeAdvancedRepositoryOperation(
    session: WorkbenchSession,
    previewToken: string | undefined,
    requestId?: string,
  ): Promise<void> {
    const state = this.host.ensureAdvancedRepositoryState(session);
    const preview = state.preview;
    if (
      !previewToken ||
      !preview ||
      preview.token !== previewToken ||
      preview.issues.length > 0
    ) {
      await this.host.sendError(
        "repository",
        "高级操作预览已失效",
        "请重新生成操作预览。",
        true,
        requestId,
      );
      return;
    }
    const candidates = await this.host.collectScopeCandidates(session);
    // v0.0.14 批次 B：高级操作通用意向单校验（scope/candidate 变化只读失效）
    // kind 诚实映射：preview.operation → OperationIntentKind（branch/tag/switch/relocate/merge 等），patch/shelf 复用 file-operation
    const candidateHash = hashCandidateState(candidates, "", []);
    const advancedKind: OperationIntentKind =
      preview.operation === "branch"
        ? "branch"
        : preview.operation === "tag"
          ? "tag"
          : preview.operation === "relocate"
            ? "relocate"
            : preview.operation === "merge"
              ? "merge"
              : preview.operation === "switch"
                ? "switch"
                : "file-operation";
    const advancedIntent = {
      token: preview.token,
      kind: advancedKind,
      title: preview.title,
      summary: preview.title,
      paths: preview.details,
      scopeHash: session.scopeHash,
      candidateHash: preview.candidateHash,
      repositoryUuid: session.repositoryUuid,
      createdAt: new Date().toISOString(),
      canExecute: preview.issues.length === 0,
      issues: preview.issues,
      commands: preview.commands,
      stale: false,
    };
    const genericCheck = validateOperationIntentForExecute(
      advancedIntent,
      previewToken,
      {
        repositoryUuid: session.repositoryUuid,
        scopeHash: session.scopeHash,
        candidateHash,
      },
    );
    if (!genericCheck.ok) {
      state.preview = undefined;
      await this.host.sendError(
        "repository",
        "高级操作预览已失效",
        genericCheck.reason,
        true,
        requestId,
      );
      // v0.1.6 V016-F1：作废预览后主动推送快照，Webview 对话框随之关闭。
      // 拒绝错误已下发，快照构建含真实 SVN 查询，异常环境下失败不得掩盖
      // 原拒绝或二次抛错，仅尽力而为。
      try {
        await this.host.sendRepositorySnapshot(session, requestId);
      } catch {
        // 忽略：原拒绝已送达，旧预览已作废。
      }
      return;
    }
    if (candidateHash !== preview.candidateHash) {
      state.preview = undefined;
      await this.host.sendError(
        "repository",
        "工作副本已变化",
        "高级操作已阻止，请刷新状态并重新预览。",
        true,
        requestId,
      );
      // v0.1.6 V016-F1：作废预览后主动推送快照，Webview 对话框随之关闭。
      // 拒绝错误已下发，快照构建含真实 SVN 查询，异常环境下失败不得掩盖
      // 原拒绝或二次抛错，仅尽力而为。
      try {
        await this.host.sendRepositorySnapshot(session, requestId);
      } catch {
        // 忽略：原拒绝已送达，旧预览已作废。
      }
      return;
    }

    const controller = new AbortController();
    session.activeOperation = { moduleId: "repository", controller };
    await this.host.post({
      protocolVersion: WORKBENCH_PROTOCOL_VERSION,
      type: "operation/progress",
      requestId,
      moduleId: "repository",
      payload: {
        title: `正在${preview.title}`,
        message: preview.commands[0],
        cancellable: true,
      },
    });

    let result: Awaited<ReturnType<typeof runSvnCommand>> | undefined;
    let successMessage: string;
    try {
      const input = preview.input;
      if (preview.operation === "branch" || preview.operation === "tag") {
        result = await runSvnCommand(
          session.svnPath,
          [
            "copy",
            input.sourceUrl,
            input.targetUrl,
            "-m",
            input.message,
            "--encoding",
            "utf-8",
          ],
          session.scope.repositoryRoot,
          { signal: controller.signal },
        );
        successMessage = `${preview.operation === "branch" ? "分支" : "标签"}已在仓库端创建：${input.targetUrl}`;
      } else if (preview.operation === "switch") {
        result = await runSvnCommand(
          session.svnPath,
          [
            "switch",
            input.targetUrl,
            session.scope.repositoryRoot,
            "--accept",
            "postpone",
          ],
          session.scope.repositoryRoot,
          { signal: controller.signal },
        );
        successMessage = `工作副本已切换到 ${input.targetUrl}。`;
      } else if (preview.operation === "relocate") {
        result = await runSvnCommand(
          session.svnPath,
          [
            "switch",
            "--relocate",
            input.sourceUrl,
            input.targetUrl,
            session.scope.repositoryRoot,
          ],
          session.scope.repositoryRoot,
          { signal: controller.signal },
        );
        successMessage = `仓库根地址已重定位到 ${input.targetUrl}。`;
      } else if (preview.operation === "merge") {
        result = await runSvnCommand(
          session.svnPath,
          [
            "merge",
            input.sourceUrl,
            session.scope.repositoryRoot,
            "--accept",
            "postpone",
          ],
          session.scope.repositoryRoot,
          { signal: controller.signal },
        );
        successMessage = "合并结果已写入工作副本；尚未提交，请检查变更与冲突。";
      } else if (preview.operation === "apply-patch") {
        result = await runSvnCommand(
          session.svnPath,
          ["patch", input.patchPath, session.scope.repositoryRoot],
          session.scope.repositoryRoot,
          { signal: controller.signal, maxOutputBytes: MAX_DIFF_BYTES },
        );
        successMessage = "补丁已写入工作副本；尚未提交，请检查变更。";
      } else {
        successMessage = await this.host.createLocalShelf(
          session,
          candidates,
          input.shelfName,
          controller.signal,
        );
      }
    } catch (error) {
      state.preview = undefined;
      state.feedback = `操作失败：${errorMessage(error)}`;
      await this.host.sendError(
        "repository",
        `${preview.title}失败`,
        errorMessage(error),
        true,
        requestId,
      );
      await this.host.sendRepositorySnapshot(session, requestId);
      return;
    } finally {
      if (session.activeOperation?.controller === controller)
        session.activeOperation = undefined;
    }

    state.preview = undefined;
    if (result?.cancelled || controller.signal.aborted) {
      state.feedback =
        "操作已取消；工作副本可能已发生部分变化，请刷新并重新检查。";
      await this.host.post({
        protocolVersion: WORKBENCH_PROTOCOL_VERSION,
        type: "operation/cancelled",
        requestId,
        moduleId: "repository",
        payload: { title: `${preview.title}已取消`, message: state.feedback },
      });
    } else if (result && result.exitCode !== 0) {
      state.feedback = result.stderr || result.stdout || "SVN 操作失败。";
      await this.host.sendError(
        "repository",
        `${preview.title}失败`,
        state.feedback,
        true,
        requestId,
      );
    } else {
      state.feedback = successMessage;
    }
    await this.host.sendRepositorySnapshot(session, requestId);
  }

  async createLocalShelf(
    session: WorkbenchSession,
    candidates: CommitCandidate[],
    shelfName: string,
    signal: AbortSignal,
  ): Promise<string> {
    const shelfCandidates = candidates.filter((item) =>
      ["modified", "deleted", "missing", "replaced"].includes(item.status),
    );
    if (
      shelfCandidates.length !== candidates.length ||
      shelfCandidates.length === 0
    )
      throw new Error("搁置候选状态已变化，请重新预览。");
    const absolutePaths = shelfCandidates.map((item) => item.absolutePath);
    if (
      validatePathsInScope(session.scope, absolutePaths, nativePathSemantics)
        .outOfScopeItems.length > 0
    )
      throw new Error("搁置中包含当前操作范围外路径。");
    const relativePaths = shelfCandidates.map((item) =>
      normalizeRelative(item.relativePath),
    );
    const diff = await runSvnCommand(
      session.svnPath,
      ["diff", ...relativePaths],
      session.scope.repositoryRoot,
      { signal, maxOutputBytes: MAX_PATCH_BYTES },
    );
    if (diff.cancelled) throw new Error("创建搁置已取消。");
    if (diff.exitCode !== 0 || diff.truncated || !diff.stdout.trim())
      throw new Error(diff.stderr || "无法生成完整的搁置补丁。");
    const patchIssues = validatePatchText(diff.stdout, MAX_PATCH_BYTES);
    if (patchIssues.length > 0) throw new Error(patchIssues.join(" "));

    const shelfDirectory = path.join(
      this.host.context.globalStorageUri.fsPath,
      "shelves",
      session.repositoryUuid,
    );
    await fs.mkdir(shelfDirectory, { recursive: true, mode: 0o700 });
    const patchPath = path.join(
      shelfDirectory,
      `${shelfName}-${Date.now()}.patch`,
    );
    await fs.writeFile(patchPath, diff.stdout, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    const revert = await runSvnCommand(
      session.svnPath,
      ["revert", "--depth", "empty", ...absolutePaths],
      session.scope.repositoryRoot,
      { signal },
    );
    if (revert.cancelled)
      throw new Error(
        `还原已取消；补丁已安全保存在 ${patchPath}，请检查工作副本。`,
      );
    if (revert.exitCode !== 0)
      throw new Error(
        `${revert.stderr || "还原失败。"} 补丁已安全保存在 ${patchPath}。`,
      );
    appendOutput(`搁置补丁已保存：${patchPath}`);
    return `本地搁置已创建并还原 ${absolutePaths.length} 个文件；补丁：${patchPath}`;
  }

  async exportScopePatch(
    session: WorkbenchSession,
    requestId?: string,
  ): Promise<void> {
    const relativePaths = session.scope.roots.map(
      (root) =>
        normalizeRelative(
          path.relative(session.scope.repositoryRoot, root.absolutePath),
        ) || ".",
    );
    const result = await runSvnCommand(
      session.svnPath,
      ["diff", ...relativePaths],
      session.scope.repositoryRoot,
      { maxOutputBytes: MAX_PATCH_BYTES },
    );
    if (result.exitCode !== 0 || result.truncated) {
      await this.host.sendError(
        "repository",
        "导出补丁失败",
        result.stderr || "补丁超过 20 MB 安全上限。",
        true,
        requestId,
      );
      return;
    }
    const destination = await vscode.window.showSaveDialog({
      title: "导出当前范围补丁",
      defaultUri: vscode.Uri.file(
        path.join(session.scope.repositoryRoot, "svn-workbench.patch"),
      ),
      filters: { 补丁文件: ["patch", "diff"] },
      saveLabel: "导出补丁",
    });
    if (!destination) return;
    await vscode.workspace.fs.writeFile(
      destination,
      Buffer.from(result.stdout, "utf8"),
    );
    this.host.ensureAdvancedRepositoryState(session).feedback =
      `补丁已导出：${destination.fsPath}`;
    await this.host.sendRepositorySnapshot(session, requestId);
  }

  async generateReleaseNotes(
    session: WorkbenchSession,
    fromRevision: string | undefined,
    toRevision: string | undefined,
    requestId?: string,
  ): Promise<void> {
    if (
      (fromRevision && !/^\d+$/.test(fromRevision)) ||
      (toRevision && !/^\d+$/.test(toRevision))
    ) {
      await this.host.sendError(
        "repository",
        "修订范围无效",
        "起止修订号只能填写正整数。",
        true,
        requestId,
      );
      return;
    }
    const [revisions, infoResult] = await Promise.all([
      collectSvnHistory(session.svnPath, session.scope, 200),
      runSvnCommand(
        session.svnPath,
        ["info", "--xml", session.scope.repositoryRoot],
        session.scope.repositoryRoot,
      ),
    ]);
    const info =
      infoResult.exitCode === 0
        ? parseInfoXml(infoResult.stdout, session.scope.repositoryRoot)
        : undefined;
    const advanced = this.host.ensureAdvancedRepositoryState(session);
    advanced.releaseNotes = buildReleaseNotes(
      revisions,
      fromRevision,
      toRevision,
      info?.url,
    );
    advanced.feedback = `已从 ${revisions.length} 条已加载历史中生成 ${advanced.releaseNotes.count} 条发布记录。`;
    await this.host.sendRepositorySnapshot(session, requestId);
  }

  async sendRepositorySnapshot(
    session: WorkbenchSession,
    requestId?: string,
  ): Promise<void> {
    const snapshot = await this.host.buildRepositorySnapshot(session);
    await this.host.post({
      protocolVersion: WORKBENCH_PROTOCOL_VERSION,
      type: "module/snapshot",
      requestId,
      moduleId: "repository",
      payload: { snapshot },
    });
  }
}
