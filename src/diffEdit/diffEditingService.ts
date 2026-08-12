import type { OperationScope } from "../scope/operationScope";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  analyzeUtf8,
  hashBytes,
  validateDiffEditTarget,
} from "./diffPathGuard";
import { DiffEditTokenRegistry } from "./diffEditTokenRegistry";
import { DiffDraftService } from "./diffDraftService";
import { DiffAtomicWriterService } from "./diffAtomicWriter";
import { MAX_EDITABLE_BYTES } from "./diffPathGuard";
import type {
  DiffSaveWorkingInput,
  DiffSaveWorkingResult,
  DiffSvnBindingProbeResult,
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
  /** 已打开 TextDocument 的真实 version；无打开文档时返回 -1。 */
  getDocumentVersion?: (targetPath: string) => Promise<number>;
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
  private readonly getDocumentVersion: (targetPath: string) => Promise<number>;
  private readonly readBytes: (targetPath: string) => Promise<Buffer>;

  /**
   * SVN 绑定复验（打开与每次保存）：目标当前所属工作副本根、仓库 UUID 与
   * BASE hash 必须与签发时一致。wcroot 不一致 = 目标落入 svn:externals 或
   * 嵌套工作副本。未注入 probe 时跳过（纯领域单测）；生产路径总是注入。
   */
  private async verifySvnBinding(input: {
    probe?: (targetPath: string) => Promise<DiffSvnBindingProbeResult>;
    targetPath: string;
    repositoryRoot: string;
    expectedUuid: string;
    expectedBaseHash: string;
  }): Promise<
    | { ok: true }
    | {
        ok: false;
        code:
          "nestedOrExternal" | "scopeChanged" | "diskChanged" | "targetMoved";
        message: string;
      }
  > {
    if (!input.probe) return { ok: true };
    const probe = await input.probe(input.targetPath);
    if (!probe.ok) {
      return {
        ok: false,
        code: "targetMoved",
        message:
          probe.code === "noBase"
            ? "无法读取当前 BASE（目标可能已脱离版本控制），拒绝继续。"
            : "无法读取目标 SVN 信息（目标可能已脱离工作副本），拒绝继续。",
      };
    }
    const canonical = async (value: string): Promise<string> =>
      path.resolve(await fs.realpath(value).catch(() => value));
    const [actualRoot, expectedRoot] = await Promise.all([
      canonical(probe.workingCopyRoot),
      canonical(input.repositoryRoot),
    ]);
    if (actualRoot !== expectedRoot) {
      return {
        ok: false,
        code: "nestedOrExternal",
        message:
          "目标位于 svn:externals 或嵌套工作副本，不属于当前工作副本边界，拒绝页内编辑；请使用原生编辑器。",
      };
    }
    if (probe.fileExternal) {
      return {
        ok: false,
        code: "nestedOrExternal",
        message:
          "目标是 svn:externals 文件引用，不属于当前工作副本边界，拒绝页内编辑；请使用原生编辑器。",
      };
    }
    if (probe.repositoryUuid !== input.expectedUuid) {
      return {
        ok: false,
        code: "scopeChanged",
        message: "仓库标识（UUID）已变化，拒绝保存；请重新打开差异。",
      };
    }
    if (probe.baseHash !== input.expectedBaseHash) {
      return {
        ok: false,
        code: "diskChanged",
        message:
          "BASE 已变化（可能执行了 SVN Update/Switch）；草稿已保留，可恢复为对比后导出补丁或人工复制。",
      };
    }
    return { ok: true };
  }

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
    this.getDocumentVersion = deps.getDocumentVersion ?? (async () => -1);
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
    // SVN 绑定复验：仓库 UUID、工作副本归属（拒绝 external/嵌套 WC）与 BASE。
    const openBinding = await this.verifySvnBinding({
      probe: input.probeSvnBinding,
      targetPath: input.targetPath,
      repositoryRoot: input.repositoryRoot,
      expectedUuid: input.repositoryUuid,
      expectedBaseHash: guard.context.baseHash,
    });
    if (!openBinding.ok) {
      return {
        ok: false,
        reason: openBinding.code,
        message: openBinding.message,
      };
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
      // 草稿初始内容必须是 Working Copy 当前内容（绝不是 BASE）：
      // 未修改即干净（cleanContent === content），不会触发三选一，
      // saveDraft 也无可写内容。draftRevision 必须取 upsert 分配的全局
      // 递增版本，否则多目标会话的后续保存会被误判为乱序。
      const created = this.drafts.upsert({
        targetId,
        repositoryUuid: input.repositoryUuid,
        scopeHash: input.scopeHash,
        baseHash: guard.context.baseHash,
        baseRevision: guard.context.baseRevision,
        baseContents: guard.context.baseContents,
        diskHash: guard.context.rawHash,
        targetPath: guard.context.absolutePath,
        content: guard.context.workingContents,
        cleanContent: guard.context.workingContents,
        baseRevisionOfClient: -1,
      });
      if (created.ok) initialRevision = created.draft.revision;
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
      documentVersion: await this.getDocumentVersion(
        guard.context.absolutePath,
      ),
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
    // 先消耗 token（契约 §5.2：成功、失败后旧 token 均失效），再做廉价
    // 体量校验：内容超过 5 MB 直接拒绝。
    const consumed = this.tokens.consume(input.editToken);
    if (Buffer.byteLength(input.content, "utf8") > MAX_EDITABLE_BYTES) {
      return {
        ok: false,
        reason: "tooLarge",
        message: "保存内容超过 5 MB，拒绝写入；请使用原生编辑器。",
        recoverable: true,
        draftRevision: this.drafts.get(input.targetId)?.revision,
      };
    }
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
          : guard.code === "unsupportedEncoding" || guard.code === "binary"
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

    // 保存前 SVN 绑定复验：UUID/归属/BASE 任一变化都拒绝（token 已消耗、
    // 草稿保留）。
    const saveBinding = await this.verifySvnBinding({
      probe: input.probeSvnBinding,
      targetPath: binding.targetPath,
      repositoryRoot: input.repositoryRoot,
      expectedUuid: binding.repositoryUuid,
      expectedBaseHash: binding.baseHash,
    });
    if (!saveBinding.ok) {
      return {
        ok: false,
        reason:
          saveBinding.code === "nestedOrExternal"
            ? "scopeChanged"
            : saveBinding.code,
        message: saveBinding.message,
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

    // 成功：显式把草稿标记为已保存（cleanContent 更新为已保存内容），
    // 使 isDraftDirty 回到 false；随后签发新 token（rawHash=新磁盘 hash）。
    this.drafts.markSaved(input.targetId, {
      content: input.content,
      diskHash: saved.newHash,
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

  /**
   * 保存既有草稿（单例窗口“保存并打开”路径）：不经过 Webview token，但复用
   * 同一条安全链——路径守卫复验、脏 TextDocument 拒绝、磁盘 hash 复验、
   * 临界区重算与原子写入。干净草稿（content === cleanContent，未修改）
   * 不写盘，直接清除并放行；脏草稿只写入用户编辑内容，绝不写 BASE。
   * 成功后放弃草稿并撤销该目标全部 token。
   */
  async saveDraft(input: {
    targetId: string;
    scope: OperationScope;
    repositoryRoot: string;
    /** 保存前复验 UUID/归属/BASE（Host 注入；与 saveWorking 同一语义）。 */
    probeSvnBinding?: (
      targetPath: string,
    ) => Promise<DiffSvnBindingProbeResult>;
  }): Promise<DiffSaveWorkingResult> {
    const draft = this.drafts.get(input.targetId);
    if (!draft) {
      return {
        ok: false,
        reason: "tokenExpired",
        message: "没有可保存的草稿；请重新进入编辑。",
        recoverable: false,
      };
    }
    // 干净草稿（content === cleanContent，未做任何修改）：无可写内容，
    // 直接清除草稿并放行切换——绝不能把草稿初始化内容写回磁盘。
    if (draft.content === draft.cleanContent) {
      this.drafts.abandon(input.targetId);
      this.tokens.revokeAllForTarget(input.targetId);
      return {
        ok: true,
        acceptedRevision: draft.revision,
        newContentHash: draft.diskHash,
        newEditToken: "",
        snapshotVersion: Date.now(),
      };
    }
    const guard = await this.validateTarget({
      scope: input.scope,
      repositoryRoot: input.repositoryRoot,
      targetPath: draft.targetPath,
      baseContents: "",
      baseRevision: draft.baseRevision,
    });
    if (!guard.ok) {
      const reason =
        guard.code === "tooLarge"
          ? "tooLarge"
          : guard.code === "unsupportedEncoding" || guard.code === "binary"
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
        draftRevision: draft.revision,
      };
    }
    // 与 saveWorking 同一复验：UUID/归属/BASE 变化拒绝，草稿保留。
    const draftBinding = await this.verifySvnBinding({
      probe: input.probeSvnBinding,
      targetPath: draft.targetPath,
      repositoryRoot: input.repositoryRoot,
      expectedUuid: draft.repositoryUuid,
      expectedBaseHash: draft.baseHash,
    });
    if (!draftBinding.ok) {
      return {
        ok: false,
        reason:
          draftBinding.code === "nestedOrExternal"
            ? "scopeChanged"
            : draftBinding.code,
        message: draftBinding.message,
        recoverable: true,
        draftRevision: draft.revision,
      };
    }
    if (await this.isDocumentDirty(draft.targetPath)) {
      return {
        ok: false,
        reason: "documentDirty",
        message:
          "VS Code 编辑器中该文件存在未保存内容，拒绝覆盖；请先在编辑器中保存或使用原生对比。",
        recoverable: true,
        draftRevision: draft.revision,
      };
    }
    const currentBytes = await this.readBytes(draft.targetPath);
    const analysis = analyzeUtf8(currentBytes);
    const saved = await this.writer.save({
      targetPath: draft.targetPath,
      content: draft.content,
      analysis: {
        bom: analysis.bom,
        eol: analysis.eol,
        finalNewline: analysis.finalNewline,
      },
      expectedRawHash: draft.diskHash,
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
        draftRevision: draft.revision,
      };
    }
    // 草稿使命完成：清除草稿；旧编辑会话 token 全部失效（基准已变化）。
    this.drafts.abandon(input.targetId);
    this.tokens.revokeAllForTarget(input.targetId);
    return {
      ok: true,
      acceptedRevision: draft.revision,
      newContentHash: saved.newHash,
      newEditToken: "",
      snapshotVersion: Date.now(),
    };
  }

  /** 草稿是否为脏（content 偏离打开/上次保存时的 Working Copy 内容）。 */
  isDraftDirty(targetId: string): boolean {
    const draft = this.drafts.get(targetId);
    return draft !== undefined && draft.content !== draft.cleanContent;
  }

  /** 会话替换/面板销毁后撤销该会话的全部 token。 */
  revokeForSession(sessionId: string): void {
    this.tokens.revokeAllForSession(sessionId);
  }

  /**
   * 文档/磁盘变化监听命中后按路径撤销 token（下一次保存必失效）。
   * hash 感知：草稿登记的磁盘 hash 与当前磁盘一致时跳过——我们自己的
   * 原子写入（saveWorking/saveDraft）也会触发文件 watcher，不能因此撤销
   * 刚签发的新 token；只有内容真实偏离记录状态的外部变化才撤销。
   */
  async revokeForPath(targetPath: string): Promise<void> {
    // token 绑定的是 realpath 规范路径；监听给出的路径可能差一层系统链接
    // （如 macOS /var → /private/var），两侧都撤销。
    const canonical = await fs.realpath(targetPath).catch(() => targetPath);
    const tracked = this.drafts
      .list()
      .find(
        (draft) =>
          draft.targetPath === canonical || draft.targetPath === targetPath,
      );
    if (tracked !== undefined) {
      const current = await this.freshness(tracked.targetPath);
      if (current.exists && current.rawHash === tracked.diskHash) {
        return;
      }
    }
    this.tokens.revokeAllForPath(canonical);
    if (canonical !== targetPath) this.tokens.revokeAllForPath(targetPath);
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
    // 活动会话存在时直接接受；token 已消耗（保存失败/过期）但草稿仍在且
    // 仓库与范围一致时也接受——这是“重新建立编辑会话”恢复链的前置检查点。
    if (!this.hasActiveSession(input.targetId, input.sessionId)) {
      const draft = this.drafts.get(input.targetId);
      const resumable =
        draft !== undefined &&
        draft.repositoryUuid === input.repositoryUuid &&
        draft.scopeHash === input.scopeHash;
      if (!resumable) return { ok: false, reason: "noActiveSession" };
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
