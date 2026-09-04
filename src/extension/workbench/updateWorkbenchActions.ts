import * as path from "node:path";
import { randomUUID } from "node:crypto";
import {
  WORKBENCH_PROTOCOL_VERSION,
  type HostToWebviewMessage,
  type UpdateSnapshot,
  type WorkbenchModuleId,
  type WorkbenchTaskId,
} from "../../protocol/workbenchProtocol";
import type { CommitCandidate } from "../../commit/commitCandidateCollector";
import { collectConflictItems } from "../../conflict/conflictCollector";
import { parseInfoXml } from "../../svn/parsers/infoXmlParser";
import { runSvnCommand } from "../../svn/svnCommandRunner";
import {
  buildUpdateScopePreview,
  checkUpdateScopeRemoteChanges,
  runUpdateScope,
  summarizeUpdateScopeRisk,
} from "../../update/updateFlow";
import { validateOperationIntentForExecute } from "../../operation/operationIntent";
import { errorMessage, quoteRelative } from "./workbenchPresentation";
import { hashCandidateState } from "./workbenchSupport";
import type { WorkbenchSession } from "./workbenchSession";

/**
 * v0.0.17 批次 A：Update 自 repository 拆出的独立模块动作（moduleId "update"）。
 * 预览与执行契约不变：先预览、意向单确认、执行前复验 token/范围/候选；
 * 结果页常驻冲突 CTA（U-06），冲突文件由 Host 构建快照时重采。
 */
export interface UpdateWorkbenchHost {
  post(message: HostToWebviewMessage): Promise<void>;
  sendError(
    moduleId: WorkbenchModuleId,
    title: string,
    message: string,
    recoverable: boolean,
    requestId?: string,
  ): Promise<void>;
  /** 统一候选采集入口：与各模块一致分类。 */
  collectScopeCandidates(session: WorkbenchSession): Promise<CommitCandidate[]>;
  appendActivityRecord(record: {
    kind: "operation-execution";
    moduleId: WorkbenchModuleId;
    taskId: WorkbenchTaskId;
    scopeHash: string;
    repositoryUuid: string;
    scopeLabel: string;
    impactedCount: number;
    previewSummary?: string;
    result: "success" | "failed";
    errorReason?: string;
    projectName?: string;
    capturedRevision?: string;
  }): void;
}

export class UpdateWorkbenchActions {
  constructor(private readonly host: UpdateWorkbenchHost) {}

  async buildUpdateSnapshot(
    session: WorkbenchSession,
  ): Promise<UpdateSnapshot> {
    const infoResult = await runSvnCommand(
      session.svnPath,
      ["info", "--xml", session.scope.repositoryRoot],
      session.scope.repositoryRoot,
    );
    const info =
      infoResult.exitCode === 0
        ? parseInfoXml(infoResult.stdout, session.scope.repositoryRoot)
        : undefined;
    // 常驻冲突 CTA：每次构建快照重采当前范围冲突；采集失败如实降级，
    // 不阻塞更新页本身（预览/执行状态仍可展示）。
    let conflicts: UpdateSnapshot["conflicts"];
    try {
      const items = await collectConflictItems(session.svnPath, session.scope);
      conflicts = {
        count: items.length,
        paths: items.map((item) => item.relativePath),
      };
    } catch (error) {
      conflicts = {
        count: 0,
        paths: [],
        error: errorMessage(error),
      };
    }
    return {
      kind: "update",
      recovery: session.recoveryState,
      info: {
        name: path.basename(session.scope.repositoryRoot),
        url: info?.url,
        repositoryRoot: info?.repositoryRoot,
        revision: info?.revision,
      },
      preview: session.updateState?.preview,
      result: session.updateState?.result,
      conflicts,
    };
  }

  async sendUpdateSnapshot(
    session: WorkbenchSession,
    requestId?: string,
  ): Promise<void> {
    const snapshot = await this.buildUpdateSnapshot(session);
    await this.host.post({
      protocolVersion: WORKBENCH_PROTOCOL_VERSION,
      type: "module/snapshot",
      requestId,
      moduleId: "update",
      payload: { snapshot },
    });
  }

  async createUpdatePreview(
    session: WorkbenchSession,
    requestId?: string,
  ): Promise<void> {
    const candidates = await this.host.collectScopeCandidates(session);
    const base = buildUpdateScopePreview(session.scope, candidates);
    let remoteChanges:
      Awaited<ReturnType<typeof checkUpdateScopeRemoteChanges>> | undefined;
    let remoteCheckError: string | undefined;
    try {
      remoteChanges = await checkUpdateScopeRemoteChanges(
        session.svnPath,
        session.scope,
      );
    } catch (error) {
      remoteCheckError = errorMessage(error);
    }
    const risk = summarizeUpdateScopeRisk(
      session.scope,
      candidates,
      remoteChanges,
      remoteCheckError,
    );
    // v0.1.6 V016-F1：预览携带生成时绑定，Webview 意向单据此自检 stale
    //（Host 执行前仍以会话权威状态复验，不信任 Webview 回传）。
    const candidateHash = hashCandidateState(candidates, "", []);
    session.updateState = {
      preview: {
        token: randomUUID(),
        canExecute: !remoteCheckError && base.localChanges.blocked === 0,
        localCount: base.localChanges.total,
        remoteCount: remoteChanges?.total,
        checkedRevision: remoteChanges?.checkedRevision,
        risk: risk.level,
        overlapPaths: risk.overlapPaths,
        messages: risk.messages,
        commands: [
          `svn update --accept postpone ${session.scope.roots.map((root) => quoteRelative(root.relativePath)).join(" ")}`,
        ],
        error: remoteCheckError,
        scopeHash: session.scopeHash,
        candidateHash,
        repositoryUuid: session.repositoryUuid,
      },
      candidateHash,
      result: session.updateState?.result,
    };
    await this.sendUpdateSnapshot(session, requestId);
  }

  async executeUpdate(
    session: WorkbenchSession,
    previewToken: string | undefined,
    requestId?: string,
  ): Promise<void> {
    const update = session.updateState?.preview;
    if (
      !previewToken ||
      !update ||
      previewToken !== update.token ||
      !update.canExecute
    ) {
      await this.host.sendError(
        "update",
        "更新预览已失效",
        "请重新检查远端更新与本地风险。",
        true,
        requestId,
      );
      return;
    }
    const candidates = await this.host.collectScopeCandidates(session);
    const currentHash = hashCandidateState(candidates, "", []);
    // v0.0.14 批次 B：更新通用意向单校验（远端为操作对象）
    const updateIntent = {
      token: update.token,
      kind: "update" as const,
      title:
        typeof update.remoteCount === "number"
          ? `更新 ${update.remoteCount} 个远端变更`
          : "更新当前范围",
      summary:
        typeof update.remoteCount === "number"
          ? `更新 ${update.remoteCount} 个远端变更`
          : "更新当前范围",
      paths: update.overlapPaths,
      scopeHash: session.scopeHash,
      candidateHash: session.updateState?.candidateHash,
      repositoryUuid: session.repositoryUuid,
      createdAt: new Date().toISOString(),
      canExecute: update.canExecute,
      issues: [] as string[],
      stale: false,
    };
    const genericCheck = validateOperationIntentForExecute(
      updateIntent,
      previewToken,
      {
        repositoryUuid: session.repositoryUuid,
        scopeHash: session.scopeHash,
        candidateHash: currentHash,
      },
    );
    if (!genericCheck.ok) {
      session.updateState!.preview = undefined;
      await this.host.sendError(
        "update",
        "更新预览已失效",
        genericCheck.reason,
        true,
        requestId,
      );
      // v0.1.6 V016-F1：作废预览后主动推送快照，Webview 对话框随之关闭，
      // 不再停留可确认态造成重复确认。拒绝错误已下发，快照构建含真实 SVN
      // 查询，异常环境下失败不得掩盖原拒绝或二次抛错，仅尽力而为。
      try {
        await this.sendUpdateSnapshot(session, requestId);
      } catch {
        // 忽略：原拒绝已送达，旧预览已作废。
      }
      return;
    }
    if (currentHash !== session.updateState?.candidateHash) {
      session.updateState!.preview = undefined;
      await this.host.sendError(
        "update",
        "工作副本已变化",
        "本地状态已变化，请重新生成更新预览。",
        true,
        requestId,
      );
      // v0.1.6 V016-F1：作废预览后主动推送快照，Webview 对话框随之关闭。
      // 拒绝错误已下发，快照构建含真实 SVN 查询，异常环境下失败不得掩盖
      // 原拒绝或二次抛错，仅尽力而为。
      try {
        await this.sendUpdateSnapshot(session, requestId);
      } catch {
        // 忽略：原拒绝已送达，旧预览已作废。
      }
      return;
    }
    await this.host.post({
      protocolVersion: WORKBENCH_PROTOCOL_VERSION,
      type: "operation/progress",
      requestId,
      moduleId: "update",
      payload: {
        title: "正在更新当前范围",
        message: "SVN update --accept postpone",
        cancellable: true,
      },
    });
    const controller = new AbortController();
    session.activeOperation = { moduleId: "update", controller };
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
      session.updateState = {
        preview: undefined,
        candidateHash: undefined,
        result: {
          ok: false,
          hasConflicts: false,
          message: "更新已取消；请重新检查工作副本状态。",
        },
      };
      await this.host.post({
        protocolVersion: WORKBENCH_PROTOCOL_VERSION,
        type: "operation/cancelled",
        requestId,
        moduleId: "update",
        payload: {
          title: "更新已取消",
          message: "SVN 进程已停止，当前状态将重新采集。",
        },
      });
      await this.sendUpdateSnapshot(session, requestId);
      return;
    }
    const isUpdateSuccess = result.result.exitCode === 0;
    const updateMsg = isUpdateSuccess
      ? result.revision
        ? `已更新到 r${result.revision}`
        : "当前范围更新完成。"
      : result.result.stderr || result.result.stdout || "SVN 更新失败。";
    session.updateState = {
      preview: undefined,
      candidateHash: undefined,
      result: {
        ok: isUpdateSuccess,
        revision: result.revision,
        hasConflicts: result.hasConflicts,
        message: updateMsg,
      },
    };
    this.host.appendActivityRecord({
      kind: "operation-execution",
      moduleId: "update",
      taskId: "update/preview",
      scopeHash: session.scopeHash,
      repositoryUuid: session.repositoryUuid,
      scopeLabel:
        typeof update.remoteCount === "number"
          ? `更新 ${update.remoteCount} 个远端变更`
          : "更新当前范围",
      impactedCount:
        typeof update.remoteCount === "number" ? update.remoteCount : 0,
      previewSummary: update.commands?.join(" ").slice(0, 200) ?? "svn update",
      result: isUpdateSuccess ? "success" : "failed",
      errorReason: isUpdateSuccess ? undefined : updateMsg,
      projectName: session.scopeView.projectName,
      capturedRevision: result.revision ?? session.workingCopyRevision,
    });
    await this.sendUpdateSnapshot(session, requestId);
  }
}
