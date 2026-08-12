import type { OperationScope } from "../scope/operationScope";
import {
  analyzeUtf8,
  hashBytes,
  validateDiffEditTarget,
} from "./diffPathGuard";
import { DiffEditTokenRegistry } from "./diffEditTokenRegistry";
import { DiffDraftService } from "./diffDraftService";
import { DiffAtomicWriterService } from "./diffAtomicWriter";
import type {
  DiffSaveWorkingInput,
  DiffSaveWorkingResult,
  DiffTargetFreshness,
  OpenDiffEditInput,
} from "./diffEditTypes";

/**
 * v0.0.6 页内编辑编排服务（纯领域，不依赖 vscode；真实依赖由 Host 注入）。
 *
 * openEdit：路径守卫 → 签发 editToken（绑定 session/module/task/repo/scope/
 *   目标/磁盘 hash/BASE/draftRevision/TTL）。
 * saveWorking：消耗单次 token → 绑定校验 → 路径守卫复验 → 脏 TextDocument
 *   拒绝 → expectedContentHash 与磁盘复验 → 原子写入（临界区重算）→
 *   签发新 token、更新草稿、返回 acceptedRevision。
 */

export interface DiffEditingServiceDeps {
  tokens: DiffEditTokenRegistry;
  drafts: DiffDraftService;
  writer: DiffAtomicWriterService;
  /** 打开/保存前的路径守卫（真实环境注入 vscode 无关的 Node 校验）。 */
  validateTarget?: typeof validateDiffEditTarget;
  /** 保存临界区前的磁盘现状复验（真实环境注入 lstat/realpath/hash）。 */
  freshness?: (targetPath: string) => Promise<DiffTargetFreshness>;
  /** 打开编辑态前的 TextDocument 脏状态查询（真实环境注入）。 */
  isDocumentDirty?: (targetPath: string) => Promise<boolean>;
  /** 读取目标当前磁盘字节（BOM/EOL 分析用；真实环境注入）。 */
  readBytes?: (targetPath: string) => Promise<Buffer>;
}

export interface OpenDiffEditResult {
  ok: true;
  targetId: string;
  editToken: string;
  draftRevision: number;
  baseHash: string;
  baseRevision: string;
  rawHash: string;
  baseContents: string;
  message: string;
}

export type OpenDiffEditOutcome =
  OpenDiffEditResult | { ok: false; reason: string; message: string };

/** 确定性目标标识：快照能力标记、编辑服务与草稿查询共用同一 id。 */
export function buildDiffTargetId(targetPath: string): string {
  const name = targetPath.split(/[\\/]/).pop() ?? "file";
  return `diff-target-${name}-${hashBytes(Buffer.from(targetPath)).slice(0, 8)}`;
}

export class DiffEditingService {
  private readonly tokens: DiffEditTokenRegistry;
  private readonly drafts: DiffDraftService;
  private readonly writer: DiffAtomicWriterService;
  private readonly validateTarget: typeof validateDiffEditTarget;
  private readonly freshness: (
    targetPath: string,
  ) => Promise<DiffTargetFreshness>;
  private readonly isDocumentDirty: (targetPath: string) => Promise<boolean>;
  private readonly readBytes: (targetPath: string) => Promise<Buffer>;

  constructor(private readonly deps: DiffEditingServiceDeps) {
    this.tokens = deps.tokens;
    this.drafts = deps.drafts;
    this.writer = deps.writer;
    this.validateTarget = deps.validateTarget ?? validateDiffEditTarget;
    this.freshness =
      deps.freshness ??
      (async () => ({
        exists: true,
        isRegularFile: true,
        realPath: "",
        rawHash: "",
        sizeBytes: 0,
      }));
    this.isDocumentDirty = deps.isDocumentDirty ?? (async () => false);
    this.readBytes = deps.readBytes ?? (async () => Buffer.alloc(0));
  }

  async openEdit(
    input: OpenDiffEditInput & {
      scope: OperationScope;
      repositoryRoot: string;
    },
  ): Promise<OpenDiffEditOutcome> {
    const guard = await this.validateTarget({
      scope: input.scope,
      repositoryRoot: input.repositoryRoot,
      targetPath: input.targetPath,
      baseContents: input.baseContents,
      baseRevision: input.baseRevision,
    });
    if (!guard.ok) {
      return { ok: false, reason: guard.code, message: guard.message };
    }
    if (await this.isDocumentDirty(input.targetPath)) {
      return {
        ok: false,
        reason: "documentDirty",
        message:
          "VS Code 编辑器中该文件存在未保存内容，页内编辑已禁用；请先在编辑器中保存或使用原生对比。",
      };
    }
    const targetId = buildDiffTargetId(input.targetPath);
    const existingDraft = this.drafts.get(targetId);
    let initialRevision = 1;
    if (existingDraft) {
      // 恢复既有草稿：不重置；Webview 直接编辑快照中已展示的草稿内容。
      initialRevision = existingDraft.revision;
    } else {
      this.drafts.upsert({
        targetId,
        repositoryUuid: input.repositoryUuid,
        scopeHash: input.scopeHash,
        baseHash: guard.context.baseHash,
        baseRevision: guard.context.baseRevision,
        baseContents: guard.context.baseContents,
        diskHash: guard.context.rawHash,
        targetPath: guard.context.absolutePath,
        content: guard.context.baseContents,
        baseRevisionOfClient: -1,
      });
    }
    const token = this.tokens.issue({
      sessionId: input.sessionId,
      moduleId: "diff",
      taskId: "diff/working",
      repositoryUuid: input.repositoryUuid,
      scopeHash: input.scopeHash,
      targetId,
      targetPath: guard.context.absolutePath,
      rawHash: guard.context.rawHash,
      baseHash: guard.context.baseHash,
      baseRevision: guard.context.baseRevision,
      documentVersion: guard.context.documentVersion,
      draftRevision: initialRevision,
    });
    return {
      ok: true,
      targetId,
      editToken: token,
      draftRevision: initialRevision,
      baseHash: guard.context.baseHash,
      baseRevision: guard.context.baseRevision,
      rawHash: guard.context.rawHash,
      baseContents: guard.context.baseContents,
      message: "已进入页内编辑；保存将写入工作副本当前范围。",
    };
  }

  async saveWorking(
    input: DiffSaveWorkingInput & {
      scope: OperationScope;
      repositoryRoot: string;
    },
  ): Promise<DiffSaveWorkingResult> {
    const consumed = this.tokens.consume(input.editToken);
    if (!consumed.ok) {
      return {
        ok: false,
        reason: "tokenExpired",
        message:
          "编辑令牌已失效（过期、已保存或范围/会话变化）。请刷新差异后重新编辑，草稿已保留。",
        recoverable: true,
        draftRevision: this.drafts.get(input.targetId)?.revision,
      };
    }
    const binding = consumed.binding;
    if (
      binding.sessionId !== input.sessionId ||
      binding.moduleId !== input.moduleId ||
      binding.taskId !== input.taskId ||
      binding.repositoryUuid !== input.repositoryUuid ||
      binding.scopeHash !== input.scopeHash ||
      binding.targetId !== input.targetId
    ) {
      return {
        ok: false,
        reason: "scopeChanged",
        message: "操作范围或会话已变化，拒绝保存；请重新打开差异。",
        recoverable: true,
        draftRevision: this.drafts.get(input.targetId)?.revision,
      };
    }

    const guard = await this.validateTarget({
      scope: input.scope,
      repositoryRoot: input.repositoryRoot,
      targetPath: binding.targetPath,
      baseContents: "",
      baseRevision: binding.baseRevision,
    });
    if (!guard.ok) {
      const reason =
        guard.code === "tooLarge"
          ? "tooLarge"
          : guard.code === "unsupportedEncoding"
            ? "unsupportedEncoding"
            : guard.code === "notFound" ||
                guard.code === "notRegularFile" ||
                guard.code === "symlink"
              ? "targetMoved"
              : "scopeChanged";
      return {
        ok: false,
        reason,
        message: guard.message,
        recoverable: true,
        draftRevision: this.drafts.get(input.targetId)?.revision,
      };
    }

    if (await this.isDocumentDirty(binding.targetPath)) {
      return {
        ok: false,
        reason: "documentDirty",
        message:
          "VS Code 编辑器中该文件存在未保存内容，拒绝覆盖；请先在编辑器中保存或使用原生对比。",
        recoverable: true,
        draftRevision: this.drafts.get(input.targetId)?.revision,
      };
    }

    // expectedContentHash 必须等于打开时签发的磁盘 hash（防重放/乱序）。
    if (input.expectedContentHash !== binding.rawHash) {
      return {
        ok: false,
        reason: "diskChanged",
        message: "编辑基准已变化（文件被外部修改）；草稿已保留，请刷新后重试。",
        recoverable: true,
        draftRevision: this.drafts.get(input.targetId)?.revision,
      };
    }

    // draftRevision 递增校验：拒绝重放与乱序请求。
    const currentDraft = this.drafts.get(input.targetId);
    if (
      currentDraft === undefined ||
      input.draftRevision < currentDraft.revision
    ) {
      return {
        ok: false,
        reason: "tokenExpired",
        message: "草稿版本落后或未知，拒绝保存；请以最新草稿重试。",
        recoverable: true,
        draftRevision: currentDraft?.revision,
      };
    }

    // 读取当前磁盘字节，按原文件 BOM/EOL/末尾换行特征还原保存。
    const currentBytes = await this.readBytes(binding.targetPath);
    const analysis = analyzeUtf8(currentBytes);
    const raw = await this.freshness(binding.targetPath);
    if (!raw.exists || !raw.isRegularFile) {
      return {
        ok: false,
        reason: "targetMoved",
        message: "目标文件在保存前被移动或删除；草稿已保留。",
        recoverable: true,
        draftRevision: currentDraft.revision,
      };
    }
    if (raw.rawHash !== binding.rawHash) {
      return {
        ok: false,
        reason: "diskChanged",
        message: "文件在编辑期间被外部修改；草稿已保留，请刷新后重试。",
        recoverable: true,
        draftRevision: currentDraft.revision,
      };
    }
    const saved = await this.writer.save({
      targetPath: binding.targetPath,
      content: input.content,
      analysis: {
        bom: analysis.bom,
        eol: analysis.eol,
        finalNewline: analysis.finalNewline,
      },
      expectedRawHash: binding.rawHash,
      freshness: async (targetPath: string) => {
        const fresh = await this.freshness(targetPath);
        return {
          exists: fresh.exists,
          isRegularFile: fresh.isRegularFile,
          realPath: fresh.realPath,
          rawHash: fresh.rawHash,
        };
      },
    });
    if (!saved.ok) {
      return {
        ok: false,
        reason: saved.reason,
        message: saved.message,
        recoverable: true,
        draftRevision: currentDraft.revision,
      };
    }

    // 成功：更新草稿到已保存状态（磁盘 hash=新 hash），并签发新 token。
    this.drafts.upsert({
      targetId: input.targetId,
      repositoryUuid: binding.repositoryUuid,
      scopeHash: binding.scopeHash,
      baseHash: binding.baseHash,
      baseRevision: binding.baseRevision,
      baseContents: currentDraft?.baseContents,
      diskHash: saved.newHash,
      targetPath: binding.targetPath,
      content: input.content,
      baseRevisionOfClient: currentDraft.revision,
    });
    const nextDraft = this.drafts.get(input.targetId);
    const newEditToken = this.tokens.issue({
      sessionId: binding.sessionId,
      moduleId: binding.moduleId,
      taskId: binding.taskId,
      repositoryUuid: binding.repositoryUuid,
      scopeHash: binding.scopeHash,
      targetId: input.targetId,
      targetPath: binding.targetPath,
      rawHash: saved.newHash,
      baseHash: binding.baseHash,
      baseRevision: binding.baseRevision,
      documentVersion: binding.documentVersion,
      draftRevision: nextDraft?.revision ?? currentDraft.revision + 1,
    });
    return {
      ok: true,
      acceptedRevision: nextDraft?.revision ?? currentDraft.revision + 1,
      newContentHash: saved.newHash,
      newEditToken,
      snapshotVersion: Date.now(),
    };
  }

  /** 会话替换/面板销毁后撤销该会话的全部 token。 */
  revokeForSession(sessionId: string): void {
    this.tokens.revokeAllForSession(sessionId);
  }

  revokeForScope(scopeHash: string): void {
    this.tokens.revokeAllForScope(scopeHash);
  }

  revokeForRepository(repositoryUuid: string): void {
    this.tokens.revokeAllForRepository(repositoryUuid);
  }

  /** 草稿查询/放弃/导出（供快照与 UI 恢复路径）。 */
  getDraft(
    targetId: string,
  ): import("./diffDraftService").DiffDraft | undefined {
    return this.drafts.get(targetId);
  }

  abandonDraft(targetId: string): boolean {
    return this.drafts.abandon(targetId);
  }

  exportPatch(targetId: string, baseContents?: string): string | undefined {
    return this.drafts.exportPatch(targetId, baseContents);
  }

  /** 是否存在绑定该 targetId + sessionId 的未过期编辑会话（token 未消耗）。 */
  hasActiveSession(targetId: string, sessionId: string): boolean {
    return this.tokens.hasActiveFor(targetId, sessionId);
  }

  /** 编辑态检查点（debounce）：要求活动会话存在，返回新 draftRevision。 */
  checkpointDraft(input: {
    targetId: string;
    sessionId: string;
    repositoryUuid: string;
    scopeHash: string;
    baseHash: string;
    baseRevision: string;
    baseContents?: string;
    diskHash: string;
    targetPath: string;
    content: string;
    baseRevisionOfClient: number;
  }): { ok: true; draftRevision: number } | { ok: false; reason: string } {
    if (!this.hasActiveSession(input.targetId, input.sessionId)) {
      return { ok: false, reason: "noActiveSession" };
    }
    const result = this.drafts.upsert({
      targetId: input.targetId,
      repositoryUuid: input.repositoryUuid,
      scopeHash: input.scopeHash,
      baseHash: input.baseHash,
      baseRevision: input.baseRevision,
      baseContents: input.baseContents,
      diskHash: input.diskHash,
      targetPath: input.targetPath,
      content: input.content,
      baseRevisionOfClient: input.baseRevisionOfClient,
    });
    if (!result.ok) return { ok: false, reason: result.reason };
    return { ok: true, draftRevision: result.draft.revision };
  }
}
