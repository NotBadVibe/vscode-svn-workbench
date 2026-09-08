import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import * as vscode from "vscode";
import type { CommitCandidate } from "../../commit/commitCandidateCollector";
import {
  collectSvnHistoryRange,
  resolveHeadRevision,
} from "../../history/svnHistory";
import { collectSvnProperties } from "../../properties/svnProperties";
import {
  WORKBENCH_PROTOCOL_VERSION,
  isReleaseNotesView,
  type HostToWebviewMessage,
  type RepositorySnapshot,
  type WorkbenchModuleId,
} from "../../protocol/workbenchProtocol";
import {
  buildReleaseNotes,
  normalizeReleaseNotesRange,
  parseSvnListXml,
  validatePatchText,
  validateRepositoryUrl,
} from "../../repository/advancedRepositoryTools";
import {
  buildShelfId,
  loadShelfIndex,
  resolveShelfPatchPath,
  saveShelfIndexAtomic,
  shelfIndexFilePath,
  shelfPatchFileName,
  validateShelfDisplayName,
  type ShelfEntry,
  type ShelfIndexDeps,
} from "../../repository/shelfIndex";
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

  /** V024-R38：搁置目录（按 repositoryUuid 隔离，同名多项目不串用）。 */
  getShelfDirectory(session: WorkbenchSession): string {
    return path.join(
      this.host.context.globalStorageUri.fsPath,
      "shelves",
      session.repositoryUuid,
    );
  }

  private shelfDeps(): ShelfIndexDeps {
    return {
      readTextFile: (filePath) => fs.readFile(filePath, "utf8"),
      writeTextFile: (filePath, content, options) =>
        fs.writeFile(filePath, content, {
          encoding: "utf8",
          mode: options?.mode ?? 0o600,
        }),
      renameFile: (fromPath, toPath) => fs.rename(fromPath, toPath),
      removeFile: (filePath) => fs.unlink(filePath),
      listDir: (dirPath) => fs.readdir(dirPath),
    };
  }

  /** V024-R38：读取本仓库搁置清单（含旧项迁移），失败 fail-closed。 */
  async listShelfEntries(
    session: WorkbenchSession,
  ): Promise<{ entries: ShelfEntry[]; error?: string }> {
    const shelfDir = this.getShelfDirectory(session);
    try {
      const loaded = await loadShelfIndex(
        this.shelfDeps(),
        shelfDir,
        session.repositoryUuid,
      );
      const checked = await this.checkShelfIntegrity(shelfDir, loaded.entries);
      const issues =
        loaded.issues.length > 0 ? loaded.issues.join(" ") : undefined;
      return { entries: checked, error: issues };
    } catch (error) {
      return { entries: [], error: `搁置清单不可读：${errorMessage(error)}` };
    }
  }

  private async checkShelfIntegrity(
    shelfDir: string,
    entries: ShelfEntry[],
  ): Promise<ShelfEntry[]> {
    const result: ShelfEntry[] = [];
    for (const entry of entries) {
      const resolved = resolveShelfPatchPath(shelfDir, entry.patchFileName);
      if (!resolved) {
        result.push({
          ...entry,
          integrity: "unreadable",
          integrityDetail: "搁置路径越界，已拒绝读取。",
        });
        continue;
      }
      try {
        const stat = await fs.stat(resolved);
        if (stat.size > MAX_PATCH_BYTES) {
          result.push({
            ...entry,
            integrity: "corrupt",
            integrityDetail: "补丁超过 20 MB 安全上限。",
          });
          continue;
        }
        const content = await fs.readFile(resolved, "utf8");
        const patchIssues = validatePatchText(content, MAX_PATCH_BYTES);
        if (patchIssues.length > 0) {
          result.push({
            ...entry,
            integrity: "corrupt",
            integrityDetail: patchIssues[0],
          });
          continue;
        }
        result.push({
          ...entry,
          integrity: entry.integrity === "ok" ? "ok" : entry.integrity,
          fileCount: entry.fileCount > 0 ? entry.fileCount : entry.files.length,
        });
      } catch (error) {
        const code = (error as NodeJS.ErrnoException | undefined)?.code;
        result.push({
          ...entry,
          integrity: code === "ENOENT" ? "missing-patch" : "unreadable",
          integrityDetail:
            code === "ENOENT"
              ? "补丁文件已丢失，可尝试导出残留索引。"
              : `补丁不可读：${errorMessage(error)}`,
        });
      }
    }
    // 按创建时间倒序，同名条目通过日期/项目消歧。
    return result.sort((left, right) =>
      right.createdAt < left.createdAt ? -1 : 1,
    );
  }

  async buildRepositorySnapshot(session: WorkbenchSession) {
    // V021-R14：外发前纵深校验 releaseNotes 形状；畸形时 fail-closed 丢弃
    // 该字段（保留 feedback 说明），不把坏载荷发给 Webview。
    const storedReleaseNotes = session.repositoryState?.advanced?.releaseNotes;
    const releaseNotes =
      storedReleaseNotes !== undefined &&
      !isReleaseNotesView(storedReleaseNotes)
        ? undefined
        : storedReleaseNotes;
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
    // V024-R38：搁置清单随快照下发（重启可发现）；失败不阻断快照。
    let shelfEntries: ShelfEntry[] | undefined;
    let shelvesError: string | undefined;
    try {
      const listed = await this.listShelfEntries(session);
      shelfEntries = listed.entries.map((entry) => ({
        id: entry.id,
        displayName: entry.displayName,
        createdAt: entry.createdAt,
        fileCount: entry.fileCount,
        files: entry.files,
        baselineRevision: entry.baselineRevision,
        repositoryUuid: entry.repositoryUuid,
        projectName: entry.projectName,
        patchFileName: entry.patchFileName,
        integrity: entry.integrity,
        integrityDetail: entry.integrityDetail,
      }));
      shelvesError = listed.error;
    } catch (error) {
      shelfEntries = undefined;
      shelvesError = `搁置清单不可读：${errorMessage(error)}`;
    }
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
        releaseNotes,
        feedback: session.repositoryState?.advanced?.feedback,
        shelves: shelfEntries,
        shelvesError,
        shelfFeedback: session.repositoryState?.advanced?.shelfFeedback,
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
    } else if (operation === "restore-shelf") {
      title = "恢复本地搁置";
      destructive = true;
      const shelfId = input.shelfId || "";
      const listed = await this.listShelfEntries(session);
      const entry = listed.entries.find((item) => item.id === shelfId);
      if (!shelfId || !entry) {
        issues.push("未找到该搁置条目，请刷新搁置清单后重试。");
      } else {
        const resolved = resolveShelfPatchPath(
          this.getShelfDirectory(session),
          entry.patchFileName,
        );
        if (!resolved) {
          issues.push("搁置路径越界，已拒绝读取。");
        } else {
          try {
            const stat = await fs.stat(resolved);
            if (stat.size > MAX_PATCH_BYTES) {
              issues.push("补丁超过 20 MB 安全上限。");
            } else {
              const patchText = await fs.readFile(resolved, "utf8");
              issues.push(...validatePatchText(patchText, MAX_PATCH_BYTES));
            }
          } catch (error) {
            issues.push(`无法读取搁置补丁：${errorMessage(error)}`);
          }
          if (issues.length === 0) {
            const dryRun = await runSvnCommand(
              session.svnPath,
              ["patch", "--dry-run", resolved, session.scope.repositoryRoot],
              session.scope.repositoryRoot,
              { maxOutputBytes: MAX_DIFF_BYTES },
            );
            if (dryRun.exitCode !== 0) {
              issues.push(
                dryRun.stderr ||
                  dryRun.stdout ||
                  "搁置试运行失败，当前工作副本可能已冲突或过期。",
              );
            }
            if (
              entry.baselineRevision &&
              info?.revision &&
              entry.baselineRevision !== info.revision
            ) {
              details.push(
                `基线 r${entry.baselineRevision}，当前工作副本 r${info.revision}：内容可能已过期，恢复前请核对。`,
              );
            }
            if (candidates.length > 0) {
              details.push(
                `当前工作副本有 ${candidates.length} 个本地变更，恢复只写入工作副本，不会自动提交；冲突请先处理。`,
              );
            }
          }
          commands.push(
            `svn patch ${quoteRelative(resolved)} ${quoteRelative(session.scope.repositoryRoot)}`,
          );
          details.push(
            `搁置：${entry.displayName}（${entry.createdAt}，${entry.fileCount} 个文件，基线 ${entry.baselineRevision ?? "未知"}）`,
            ...entry.files.map((file) => `文件 ${file}`),
            "恢复只写入工作副本，不会自动提交；搁置在成功后保留，删除需单独确认。",
          );
          input.shelfId = entry.id;
          input.patchPath = resolved;
        }
      }
    } else {
      title = "创建本地搁置（补丁 + 还原）";
      destructive = true;
      const displayName = (input.shelfName || "").trim();
      const existing = (await this.listShelfEntries(session)).entries.map(
        (item) => item.displayName,
      );
      issues.push(...validateShelfDisplayName(input.shelfName ?? "", existing));
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
        `svn diff <current-scope> > 搁置“${displayName || "<名称>"}”（内部安全文件名，重启可找回）.patch`,
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
      } else if (preview.operation === "restore-shelf") {
        successMessage = await this.restoreShelfEntry(
          session,
          input.shelfId,
          input.patchPath,
          controller.signal,
        );
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
    // V024-R48：shelfName 为中文显示名，Host 始终复验（含重复与控制字符）。
    const existing = (await this.listShelfEntries(session)).entries.map(
      (item) => item.displayName,
    );
    const nameIssues = validateShelfDisplayName(shelfName, existing);
    if (nameIssues.length > 0) throw new Error(nameIssues.join(" "));
    const displayName = (shelfName as string).trim();
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

    const shelfDirectory = this.getShelfDirectory(session);
    await fs.mkdir(shelfDirectory, { recursive: true, mode: 0o700 });
    // V024-R48：内部安全 ID 独立于显示名，路径分隔永不进入内部路径。
    const shelfId = buildShelfId(
      Date.now(),
      randomUUID().replace(/-/g, "").slice(0, 8),
    );
    const fileName = shelfPatchFileName(shelfId);
    if (!fileName) throw new Error("搁置内部标识生成失败，请重试。");
    const patchPath = resolveShelfPatchPath(shelfDirectory, fileName);
    if (!patchPath) throw new Error("搁置路径越界，已拒绝写入。");
    await fs.writeFile(patchPath, diff.stdout, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    // V024-R38：索引原子保存（临时文件 + rename），失败保留补丁并如实提示。
    const baselineRevision =
      session.workingCopyRevision ?? session.scopeView.workingCopyRevision;
    try {
      const loaded = await loadShelfIndex(
        this.shelfDeps(),
        shelfDirectory,
        session.repositoryUuid,
      );
      const next: ShelfEntry[] = [
        ...loaded.entries.filter(
          (entry) =>
            entry.repositoryUuid === session.repositoryUuid ||
            !entry.repositoryUuid,
        ),
        {
          id: shelfId,
          displayName,
          createdAt: new Date().toISOString(),
          fileCount: shelfCandidates.length,
          files: relativePaths,
          baselineRevision,
          repositoryUuid: session.repositoryUuid,
          projectName: session.scopeView.projectName,
          patchFileName: fileName,
          integrity: "ok" as const,
        },
      ];
      await saveShelfIndexAtomic(
        this.shelfDeps(),
        shelfIndexFilePath(shelfDirectory),
        next,
      );
    } catch (error) {
      appendOutput(`搁置索引保存失败（补丁已保留）：${errorMessage(error)}`);
    }
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
    return `本地搁置“${displayName}”已创建并还原 ${absolutePaths.length} 个文件；重启后可在搁置清单中找到。`;
  }

  /** V024-R38：恢复搁置（新 token 预览已校验；成功保留搁置，不自动提交）。 */
  async restoreShelfEntry(
    session: WorkbenchSession,
    shelfId: string,
    patchPath: string | undefined,
    signal: AbortSignal,
  ): Promise<string> {
    const listed = await this.listShelfEntries(session);
    const entry = listed.entries.find((item) => item.id === shelfId);
    if (!entry)
      throw new Error("搁置条目已不存在或不属于当前仓库，请刷新清单。");
    const resolved = resolveShelfPatchPath(
      this.getShelfDirectory(session),
      entry.patchFileName,
    );
    if (!resolved) throw new Error("搁置路径越界，已拒绝恢复。");
    if (patchPath && path.resolve(patchPath) !== resolved) {
      throw new Error("搁置路径已变化，请重新预览。");
    }
    let patchText: string;
    try {
      patchText = await fs.readFile(resolved, "utf8");
    } catch (error) {
      throw new Error(`无法读取搁置补丁：${errorMessage(error)}`, {
        cause: error,
      });
    }
    const patchIssues = validatePatchText(patchText, MAX_PATCH_BYTES);
    if (patchIssues.length > 0) throw new Error(patchIssues.join(" "));
    const result = await runSvnCommand(
      session.svnPath,
      ["patch", resolved, session.scope.repositoryRoot],
      session.scope.repositoryRoot,
      { signal, maxOutputBytes: MAX_DIFF_BYTES },
    );
    if (result.cancelled) throw new Error("恢复搁置已取消，工作副本未改动。");
    if (result.exitCode !== 0) {
      throw new Error(
        result.stderr ||
          result.stdout ||
          "搁置恢复失败，工作副本未被强行覆盖。",
      );
    }
    return `搁置“${entry.displayName}”已恢复到工作副本；尚未提交，搁置已保留。`;
  }

  /** V024-R38：刷新搁置清单（只读，不改工作副本）。 */
  async refreshShelves(
    session: WorkbenchSession,
    requestId?: string,
  ): Promise<void> {
    const state = this.host.ensureAdvancedRepositoryState(session);
    const listed = await this.listShelfEntries(session);
    state.shelfFeedback =
      listed.error ??
      (listed.entries.length === 0
        ? "暂无本地搁置。"
        : `已载入 ${listed.entries.length} 个本地搁置。`);
    await this.host.sendRepositorySnapshot(session, requestId);
  }

  /** V024-R38：导出搁置补丁（只读，不改工作副本）。 */
  async exportShelf(
    session: WorkbenchSession,
    shelfId: string | undefined,
    requestId?: string,
  ): Promise<void> {
    const state = this.host.ensureAdvancedRepositoryState(session);
    const listed = await this.listShelfEntries(session);
    const entry = listed.entries.find((item) => item.id === shelfId);
    if (!entry) {
      await this.host.sendError(
        "repository",
        "未找到搁置",
        "该搁置条目不存在或不属于当前仓库，请刷新清单。",
        true,
        requestId,
      );
      return;
    }
    const resolved = resolveShelfPatchPath(
      this.getShelfDirectory(session),
      entry.patchFileName,
    );
    if (!resolved) {
      await this.host.sendError(
        "repository",
        "搁置路径越界",
        "该搁置路径已越界，已拒绝导出。",
        true,
        requestId,
      );
      return;
    }
    let content: string;
    try {
      content = await fs.readFile(resolved, "utf8");
    } catch (error) {
      await this.host.sendError(
        "repository",
        "导出搁置失败",
        `无法读取搁置补丁：${errorMessage(error)}`,
        true,
        requestId,
      );
      return;
    }
    const destination = await vscode.window.showSaveDialog({
      title: `导出搁置“${entry.displayName}”`,
      defaultUri: vscode.Uri.file(
        path.join(session.scope.repositoryRoot, `${entry.displayName}.patch`),
      ),
      filters: { 补丁文件: ["patch", "diff"] },
      saveLabel: "导出搁置",
    });
    if (!destination) return;
    await vscode.workspace.fs.writeFile(
      destination,
      Buffer.from(content, "utf8"),
    );
    state.shelfFeedback = `搁置“${entry.displayName}”已导出：${destination.fsPath}`;
    await this.host.sendRepositorySnapshot(session, requestId);
  }

  /** V024-R38：删除搁置（明确独立动作，不碰工作副本）。 */
  async deleteShelf(
    session: WorkbenchSession,
    shelfId: string | undefined,
    requestId?: string,
  ): Promise<void> {
    const state = this.host.ensureAdvancedRepositoryState(session);
    const shelfDir = this.getShelfDirectory(session);
    const listed = await this.listShelfEntries(session);
    const entry = listed.entries.find((item) => item.id === shelfId);
    if (!entry) {
      await this.host.sendError(
        "repository",
        "未找到搁置",
        "该搁置条目不存在或不属于当前仓库，请刷新清单。",
        true,
        requestId,
      );
      return;
    }
    const resolved = resolveShelfPatchPath(shelfDir, entry.patchFileName);
    if (!resolved) {
      await this.host.sendError(
        "repository",
        "搁置路径越界",
        "该搁置路径已越界，已拒绝删除。",
        true,
        requestId,
      );
      return;
    }
    try {
      await fs.unlink(resolved);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (code !== "ENOENT") {
        await this.host.sendError(
          "repository",
          "删除搁置失败",
          `无法删除补丁文件：${errorMessage(error)}`,
          true,
          requestId,
        );
        return;
      }
    }
    try {
      const next = listed.entries.filter((item) => item.id !== entry.id);
      await saveShelfIndexAtomic(
        this.shelfDeps(),
        shelfIndexFilePath(shelfDir),
        next,
      );
    } catch (error) {
      state.shelfFeedback = `补丁已删除，但索引更新失败：${errorMessage(error)}`;
      await this.host.sendRepositorySnapshot(session, requestId);
      return;
    }
    state.shelfFeedback = `搁置“${entry.displayName}”已删除，工作副本未改动。`;
    await this.host.sendRepositorySnapshot(session, requestId);
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

  /**
   * V021-R14：按用户指定修订范围只读分页采集发布说明（端点包含）。
   * - HEAD 在请求开始固定解析为 rN（展示中注明），解析失败如实拒绝；
   * - 反向范围归一化并备注；空范围（均未填）仅读最近一页并诚实标注；
   * - 取消/分页失败保留已采集部分并标记 partial，重试重新采集去重计数；
   * - 每修订摘要最多展示 20 路径并注明省略数，完整版随快照下发供导出。
   */
  async generateReleaseNotes(
    session: WorkbenchSession,
    fromRevision: string | undefined,
    toRevision: string | undefined,
    requestId?: string,
  ): Promise<void> {
    const rawFrom = fromRevision?.trim() ?? "";
    const rawTo = toRevision?.trim() ?? "";
    const normalized = normalizeReleaseNotesRange(fromRevision, toRevision);
    if (normalized.issues.length > 0) {
      await this.host.sendError(
        "repository",
        "修订范围无效",
        `${normalized.issues.join(" ")}（起止修订号填写正整数，结束可用 HEAD；范围含两端。）`,
        true,
        requestId,
      );
      return;
    }
    const advanced = this.host.ensureAdvancedRepositoryState(session);
    const previous = advanced.releaseNotes;
    let resolvedHead: string | undefined;
    let effectiveTo = normalized.to;
    if (normalized.headRequested) {
      resolvedHead = await resolveHeadRevision(session.svnPath, session.scope);
      if (!resolvedHead) {
        advanced.feedback =
          "未能解析 HEAD（网络或仓库不可达），已保留上次发布说明；请检查连接后重试，或改填数字修订号。";
        await this.host.sendRepositorySnapshot(session, requestId);
        return;
      }
      effectiveTo = resolvedHead;
    }
    // 反向归一化（含 HEAD 解析后）：小→大。
    let effectiveFrom = normalized.from;
    let rangeNote: string | undefined = normalized.normalized
      ? `输入为反向范围，已按含端点语义归一化为 r${normalized.from}→r${normalized.to}`
      : undefined;
    if (
      effectiveFrom !== undefined &&
      effectiveTo !== undefined &&
      BigInt(effectiveFrom) > BigInt(effectiveTo)
    ) {
      const swapped = effectiveFrom;
      effectiveFrom = effectiveTo;
      effectiveTo = swapped;
      rangeNote = `输入为反向范围，已按含端点语义归一化为 r${effectiveFrom}→r${effectiveTo}`;
    }
    const controller = new AbortController();
    session.activeOperation = { moduleId: "repository", controller };
    await this.host.post({
      protocolVersion: WORKBENCH_PROTOCOL_VERSION,
      type: "operation/progress",
      requestId,
      moduleId: "repository",
      payload: {
        title: "正在按范围采集发布说明",
        message: `范围 r${effectiveFrom ?? "1"} → r${effectiveTo ?? "HEAD"}（含两端），只读分页读取中…`,
        cancellable: true,
      },
    });
    try {
      const infoResult = await runSvnCommand(
        session.svnPath,
        ["info", "--xml", session.scope.repositoryRoot],
        session.scope.repositoryRoot,
        { signal: controller.signal },
      );
      const info =
        infoResult.exitCode === 0
          ? parseInfoXml(infoResult.stdout, session.scope.repositoryRoot)
          : undefined;
      // 空范围：仅读最近一页（200 条），有更多时诚实标注而非冒充完整。
      if (effectiveFrom === undefined && effectiveTo === undefined) {
        const { collectSvnHistoryPage } =
          await import("../../history/svnHistory");
        const page = await collectSvnHistoryPage(
          session.svnPath,
          session.scope,
          200,
          {},
          controller.signal,
        );
        const notes = buildReleaseNotes(
          page.revisions,
          undefined,
          undefined,
          info?.url,
          {
            revisionsRead: page.revisions.length,
            complete: !page.hasMore,
            partialReason: page.hasMore
              ? "目标范围未限定，仅展示最近 200 条；如需更早区间请填写起止修订（含两端）后重新生成"
              : undefined,
            resolvedHeadRevision: resolvedHead,
            rangeNote: "未填写范围",
          },
        );
        advanced.releaseNotes = {
          ...notes,
          requestedFrom: rawFrom || undefined,
          requestedTo: rawTo || undefined,
        };
        advanced.feedback = notes.complete
          ? `已读取最近 ${notes.revisionsRead} 条修订（已是全部历史），生成 ${notes.count} 条发布记录。`
          : `仅读取到最近 ${notes.revisionsRead} 条（部分结果：可能还有更早修订），已生成 ${notes.count} 条；请填写起止修订后续查。`;
        await this.host.sendRepositorySnapshot(session, requestId);
        return;
      }
      const range = await collectSvnHistoryRange(
        session.svnPath,
        session.scope,
        { fromRevision: effectiveFrom, toRevision: effectiveTo },
        {
          pageSize: 200,
          signal: controller.signal,
          onPage: (read) => {
            void this.host
              .post({
                protocolVersion: WORKBENCH_PROTOCOL_VERSION,
                type: "operation/progress",
                requestId,
                moduleId: "repository",
                payload: {
                  title: "正在按范围采集发布说明",
                  message: `已读取 ${read} 条修订…`,
                  cancellable: true,
                },
              })
              .catch(() => undefined);
          },
        },
      );
      if (range.revisions.length === 0 && !range.complete) {
        // 首轮即失败/取消且无任何采集：保留上次结果（如有），不展示空清单冒充。
        if (previous) {
          advanced.feedback = range.cancelled
            ? "采集已取消，已保留上次发布说明；请用相同范围重新生成以续查。"
            : `采集失败（${range.partialReason ?? "未知错误"}），已保留上次发布说明；请检查连接后用相同范围重试，重试不会重复计数。`;
          if (range.cancelled) {
            await this.host.post({
              protocolVersion: WORKBENCH_PROTOCOL_VERSION,
              type: "operation/cancelled",
              requestId,
              moduleId: "repository",
              payload: {
                title: "采集已取消",
                message: advanced.feedback,
              },
            });
          } else {
            await this.host.post({
              protocolVersion: WORKBENCH_PROTOCOL_VERSION,
              type: "operation/progress",
              requestId,
              moduleId: "repository",
              payload: {
                title: "采集失败",
                message: advanced.feedback,
                cancellable: false,
              },
            });
          }
          await this.host.sendRepositorySnapshot(session, requestId);
          return;
        }
      }
      const notes = buildReleaseNotes(
        range.revisions,
        effectiveFrom,
        effectiveTo,
        info?.url,
        {
          revisionsRead: range.revisionsRead,
          complete: range.complete,
          partialReason: range.cancelled ? "已取消" : range.partialReason,
          resolvedHeadRevision: resolvedHead,
          rangeNote,
        },
      );
      advanced.releaseNotes = {
        ...notes,
        cancelled: range.cancelled || undefined,
        failedUpperBound: range.failedUpperBound,
        requestedFrom: rawFrom || undefined,
        requestedTo: rawTo || undefined,
      };
      if (range.complete) {
        advanced.feedback =
          `已按范围 r${notes.fromRevision ?? "1"}→r${notes.toRevision ?? resolvedHead ?? "最新"}（含两端）读取 ${notes.revisionsRead} 条修订（完整），生成 ${notes.count} 条发布记录。` +
          (notes.omittedPathCount > 0
            ? `其中 ${notes.omittedPathCount} 个路径未在摘要中显示，完整版可复制/导出查看。`
            : "");
      } else if (range.cancelled) {
        advanced.feedback = `采集已取消：已读取 ${notes.revisionsRead} 条（部分结果），生成 ${notes.count} 条；已保留已采集内容，请用相同范围重新生成以续查，重试不会重复计数。`;
        await this.host.post({
          protocolVersion: WORKBENCH_PROTOCOL_VERSION,
          type: "operation/cancelled",
          requestId,
          moduleId: "repository",
          payload: {
            title: "采集已取消",
            message: advanced.feedback,
          },
        });
      } else {
        advanced.feedback = `采集未完成（${range.partialReason ?? "分页失败"}）：已读取 ${notes.revisionsRead} 条（部分结果），生成 ${notes.count} 条；已保留已采集内容，请检查连接后用相同范围重试，重试不会重复计数。`;
      }
      await this.host.sendRepositorySnapshot(session, requestId);
    } catch (error) {
      if (
        controller.signal.aborted ||
        (error instanceof Error && /abort|cancel/i.test(error.message))
      ) {
        if (previous) {
          advanced.feedback =
            "采集已取消，已保留上次发布说明；请用相同范围重新生成以续查。";
        } else {
          advanced.releaseNotes = {
            markdown: "_采集已取消，暂无已采集修订。_",
            fullMarkdown: "_采集已取消，暂无已采集修订。_",
            count: 0,
            revisionsRead: 0,
            complete: false,
            partialReason: "已取消",
            cancelled: true,
            omittedPathCount: 0,
            truncatedRevisions: [],
            requestedFrom: rawFrom || undefined,
            requestedTo: rawTo || undefined,
          };
          advanced.feedback =
            "采集已取消（部分结果：暂无已采集修订）；请用相同范围重新生成。";
        }
        await this.host.post({
          protocolVersion: WORKBENCH_PROTOCOL_VERSION,
          type: "operation/cancelled",
          requestId,
          moduleId: "repository",
          payload: {
            title: "采集已取消",
            message: advanced.feedback,
          },
        });
        await this.host.sendRepositorySnapshot(session, requestId);
        return;
      }
      if (previous) {
        advanced.feedback = `采集失败（${errorMessage(error)}），已保留上次发布说明；请检查连接后用相同范围重试。`;
        await this.host.sendRepositorySnapshot(session, requestId);
        return;
      }
      advanced.releaseNotes = {
        markdown: "_采集失败，暂无已采集修订。_",
        fullMarkdown: "_采集失败，暂无已采集修订。_",
        count: 0,
        revisionsRead: 0,
        complete: false,
        partialReason: error instanceof Error ? error.message : "采集失败",
        omittedPathCount: 0,
        truncatedRevisions: [],
        requestedFrom: rawFrom || undefined,
        requestedTo: rawTo || undefined,
      };
      advanced.feedback = `采集失败（${errorMessage(error)}）；请检查连接后重试。`;
      await this.host.sendRepositorySnapshot(session, requestId);
    } finally {
      if (session.activeOperation?.controller === controller)
        session.activeOperation = undefined;
    }
  }

  /**
   * V021-R14：导出完整版发布说明（含全部路径，不截断）。只读导出：
   * 将快照中的 fullMarkdown 写入用户选择的文件，不修改工作副本。
   */
  async exportReleaseNotes(
    session: WorkbenchSession,
    requestId?: string,
  ): Promise<void> {
    const notes = this.host.ensureAdvancedRepositoryState(session).releaseNotes;
    const content = notes?.fullMarkdown ?? notes?.markdown;
    if (!content) {
      await this.host.sendError(
        "repository",
        "没有可导出的发布说明",
        "请先按修订范围生成发布说明，再导出完整版。",
        true,
        requestId,
      );
      return;
    }
    const destination = await vscode.window.showSaveDialog({
      title: "导出完整版发布说明",
      defaultUri: vscode.Uri.file(
        path.join(session.scope.repositoryRoot, "svn-release-notes.md"),
      ),
      filters: { Markdown: ["md", "markdown"] },
      saveLabel: "导出发布说明",
    });
    if (!destination) return;
    await vscode.workspace.fs.writeFile(
      destination,
      Buffer.from(content, "utf8"),
    );
    this.host.ensureAdvancedRepositoryState(session).feedback =
      `完整版发布说明已导出：${destination.fsPath}`;
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
