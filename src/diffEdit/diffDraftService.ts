import { diffLines } from "./diffPatch";

/**
 * v0.0.6 页内编辑草稿服务。
 *
 * 持久化策略（明确）：**仅内存**，不跨 Extension Host 重启持久化——
 * 避免引入权限、TTL、容量、隔离与清理的持久化复杂度；基准变化后不自动
 * 保存，仅提供恢复为对比、导出 Patch 与人工复制。进程重启即视为草稿失效
 * （界面在重启后回到只读 Diff，天然满足“不自动保存”语义）。
 *
 * 容量上限：MAX_DRAFTS 个草稿，超出时清除最旧；单个草稿字节数上限
 * MAX_DRAFT_BYTES。targetId 唯一。
 */

export interface DiffDraft {
  targetId: string;
  repositoryUuid: string;
  scopeHash: string;
  baseHash: string;
  baseRevision: string;
  /** 打开编辑时的 BASE 原文（导出/恢复对比用，不随检查点改变）。 */
  baseContents: string;
  diskHash: string;
  targetPath: string;
  content: string;
  /**
   * 打开时（或上次成功保存后）的 Working Copy 内容（编辑器文本模型）。
   * content !== cleanContent 才是“脏草稿”；绝不允许 BASE 进入该字段。
   */
  cleanContent: string;
  /** 递增检查点版本；保存/恢复/放弃请求必须携带以拒绝重放与乱序。 */
  revision: number;
  updatedAt: number;
}

export const MAX_DRAFTS = 32;
export const MAX_DRAFT_BYTES = 5 * 1024 * 1024;

export interface UpsertDraftInput {
  targetId: string;
  repositoryUuid: string;
  scopeHash: string;
  baseHash: string;
  baseRevision: string;
  baseContents?: string;
  diskHash: string;
  targetPath: string;
  content: string;
  /** 干净基准内容（仅首次创建需要；既有草稿保留原值）。 */
  cleanContent?: string;
  /** 客户端已确认的最新 draftRevision（无则 -1）。 */
  baseRevisionOfClient: number;
}

export type UpsertResult =
  | { ok: true; draft: DiffDraft }
  | { ok: false; reason: "staleRevision" | "tooLarge" };

export class DiffDraftService {
  private readonly drafts = new Map<string, DiffDraft>();
  private revisionCounter = 1;

  /** 检查点：content 超过容量上限或客户端 revision 乱序时拒绝。 */
  upsert(input: UpsertDraftInput): UpsertResult {
    const bytes = Buffer.byteLength(input.content, "utf8");
    if (bytes > MAX_DRAFT_BYTES) {
      return { ok: false, reason: "tooLarge" };
    }
    const existing = this.drafts.get(input.targetId);
    if (
      existing !== undefined &&
      input.baseRevisionOfClient > -1 &&
      input.baseRevisionOfClient !== existing.revision
    ) {
      return { ok: false, reason: "staleRevision" };
    }
    const revision = this.revisionCounter++;
    const draft: DiffDraft = {
      targetId: input.targetId,
      repositoryUuid: input.repositoryUuid,
      scopeHash: input.scopeHash,
      baseHash: input.baseHash,
      baseRevision: input.baseRevision,
      baseContents:
        existing?.baseContents ?? input.baseContents ?? input.content,
      diskHash: input.diskHash,
      targetPath: input.targetPath,
      content: input.content,
      cleanContent:
        existing?.cleanContent ?? input.cleanContent ?? input.content,
      revision,
      updatedAt: Date.now(),
    };
    this.drafts.set(input.targetId, draft);
    this.evictOldest();
    return { ok: true, draft };
  }

  get(targetId: string): DiffDraft | undefined {
    return this.drafts.get(targetId);
  }

  abandon(targetId: string): boolean {
    return this.drafts.delete(targetId);
  }

  list(): DiffDraft[] {
    return [...this.drafts.values()];
  }

  /** 生成 base → draft 的统一 diff（导出/恢复对比用）。 */
  exportPatch(targetId: string, baseContents?: string): string | undefined {
    const draft = this.drafts.get(targetId);
    if (draft === undefined) return undefined;
    const base = (baseContents ?? draft.baseContents).split(/\r\n|\n/);
    const edited = draft.content.split(/\r\n|\n/);
    return diffLines(base, edited, draft.targetPath);
  }

  private evictOldest(): void {
    if (this.drafts.size <= MAX_DRAFTS) return;
    let oldestKey: string | undefined;
    let oldestAt = Number.POSITIVE_INFINITY;
    for (const [key, draft] of this.drafts) {
      if (draft.updatedAt < oldestAt) {
        oldestAt = draft.updatedAt;
        oldestKey = key;
      }
    }
    if (oldestKey !== undefined) this.drafts.delete(oldestKey);
  }
}
