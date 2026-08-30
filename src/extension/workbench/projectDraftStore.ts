import {
  normalizePathIdentity,
  type PathSemantics,
} from "../../scope/pathIdentity";

/*
 * v0.0.13 会话状态总线：草稿总线（批次 A）——按 projectId + moduleId + scopeHash 隔离；
 * 容器边界由 VS Code workspaceState 本身保证（按工作区容器存储）。
 * 草稿仅保存在 Host 侧；冲突合并稿不写磁盘、仅内存（但复用同一隔离键与容量上限）；
 * 预览、确认 token 与 AI 结果永不恢复。保存检查点不等于写入工作副本，不得绕过最终预览和确认。
 */

export type DraftKind = "commit" | "conflict-merge" | "patch";

export interface BaseDraft {
  kind: DraftKind;
  /** 保存时的 scopeHash：同时是草稿键的一部分（隔离条件）。 */
  scopeHash: string;
  savedAt: number;
}

export interface CommitDraft extends BaseDraft {
  kind: "commit";
  message: string;
  selectedPaths: string[];
}

export interface ConflictFileDraft {
  content: string;
  updatedAt: number;
  revision: number;
  /** v0.0.13 批次 B：打开时的原始工作副本内容，用于无 SVN 重采的脏判断 */
  baseContent: string;
  /** v0.1.2 V012-D：草稿所属工作副本 revision，用于返回时的 stale-identity 复核 */
  workingCopyRevision?: string;
  /** v0.1.2 V012-D：编辑器 selection/视口，快照恢复时尽量还原 */
  editorState?: {
    selection?: { start: number; end: number };
    viewport?: { top: number; left: number };
  };
}

export interface ConflictMergeDraft extends BaseDraft {
  kind: "conflict-merge";
  /** 按相对路径索引的冲突文件草稿；键为工作副本内相对路径（归一化后）。 */
  drafts: Record<string, ConflictFileDraft>;
}

export interface PatchDraft extends BaseDraft {
  kind: "patch";
  /** Patch 内容（由 Host 内存持有，不持久化到磁盘）。 */
  content: string;
  description?: string;
}

export type GenericDraft = CommitDraft | ConflictMergeDraft | PatchDraft;

/*
 * 向后兼容：历史代码与测试使用 ProjectDraft 表示 commit 草稿；
 * 不带 kind 的旧数据视为 commit。
 */
export interface ProjectDraft {
  message: string;
  selectedPaths: string[];
  scopeHash: string;
  savedAt: number;
  kind?: DraftKind;
}

export type ProjectDraftMap = Record<string, GenericDraft | ProjectDraft>;

export const MAX_PROJECT_DRAFTS = 32;
export const MAX_CONFLICT_FILE_DRAFTS = 32;

export function projectDraftKey(
  projectRoot: string,
  moduleId: string,
  scopeHash: string,
  options: PathSemantics,
): string {
  // §8 批次 A：草稿按 projectId + moduleId + operationScope（scopeHash）隔离；
  // workspace container 由 workspaceState 本身隐式隔离；kind 已在 value 内，不参与 key。
  return `${normalizePathIdentity(projectRoot, options)}::${moduleId}::${scopeHash}`;
}

export function isCommitDraft(
  draft: GenericDraft | ProjectDraft | undefined,
): draft is CommitDraft {
  if (!draft) return false;
  return (
    (draft as GenericDraft).kind === "commit" ||
    (draft as ProjectDraft).message !== undefined
  );
}

export function isConflictMergeDraft(
  draft: GenericDraft | ProjectDraft | undefined,
): draft is ConflictMergeDraft {
  return (draft as GenericDraft)?.kind === "conflict-merge";
}

export function isPatchDraft(
  draft: GenericDraft | ProjectDraft | undefined,
): draft is PatchDraft {
  return (draft as GenericDraft)?.kind === "patch";
}

export function normalizeCommitDraft(
  draft: GenericDraft | ProjectDraft | undefined,
): CommitDraft | undefined {
  if (!draft) return undefined;
  if ((draft as GenericDraft).kind === "commit") return draft as CommitDraft;
  if (
    (draft as ProjectDraft).message !== undefined &&
    (draft as GenericDraft).kind === undefined
  ) {
    // 旧数据：无 kind，视为 commit
    return {
      kind: "commit",
      message: (draft as ProjectDraft).message,
      selectedPaths: (draft as ProjectDraft).selectedPaths ?? [],
      scopeHash: draft.scopeHash,
      savedAt: draft.savedAt,
    };
  }
  if (isCommitDraft(draft)) {
    return draft as CommitDraft;
  }
  return undefined;
}

export function readProjectDraft(
  store: ProjectDraftMap,
  key: string,
): ProjectDraft | undefined {
  const draft = store[key];
  if (!draft) return undefined;
  const commit = normalizeCommitDraft(draft);
  if (commit) {
    return {
      message: commit.message,
      selectedPaths: commit.selectedPaths,
      scopeHash: commit.scopeHash,
      savedAt: commit.savedAt,
      kind: commit.kind,
    };
  }
  return undefined;
}

export function readGenericDraft(
  store: ProjectDraftMap,
  key: string,
): GenericDraft | undefined {
  const draft = store[key];
  if (!draft) return undefined;
  if ((draft as GenericDraft).kind) return draft as GenericDraft;
  const commit = normalizeCommitDraft(draft);
  if (commit) return commit;
  return undefined;
}

export function writeProjectDraft(
  store: ProjectDraftMap,
  key: string,
  draft: ProjectDraft | GenericDraft,
): ProjectDraftMap {
  // 保证写入时补齐 kind（旧调用传入无 kind 的 commit 视为 commit）
  let normalized: GenericDraft;
  if ((draft as GenericDraft).kind) {
    normalized = draft as GenericDraft;
  } else {
    const legacy = draft as ProjectDraft;
    normalized = {
      kind: "commit",
      message: legacy.message,
      selectedPaths: legacy.selectedPaths ?? [],
      scopeHash: legacy.scopeHash,
      savedAt: legacy.savedAt,
    };
  }
  return writeGenericDraft(store, key, normalized);
}

export function writeGenericDraft(
  store: ProjectDraftMap,
  key: string,
  draft: GenericDraft,
): ProjectDraftMap {
  const next = { ...store, [key]: draft };
  const keys = Object.keys(next);
  if (keys.length > MAX_PROJECT_DRAFTS) {
    const oldest = keys.reduce((left, right) =>
      (next[left] as GenericDraft).savedAt <=
      (next[right] as GenericDraft).savedAt
        ? left
        : right,
    );
    delete next[oldest];
  }
  return next;
}

export function deleteProjectDraft(
  store: ProjectDraftMap,
  key: string,
): ProjectDraftMap {
  if (!(key in store)) return store;
  const next = { ...store };
  delete next[key];
  return next;
}

/*
 * 冲突合并草稿的细粒度操作：在同一隔离键下按文件路径维护 drafts 映射；
 * 总 drafts 数同样受 MAX_PROJECT_DRAFTS 约束，最旧隔离键淘汰；
 * 单个隔离键内文件数受 MAX_CONFLICT_FILE_DRAFTS 约束，最旧文件淘汰。
 */

export function readConflictMergeDraft(
  store: ProjectDraftMap,
  key: string,
): ConflictMergeDraft | undefined {
  const draft = store[key];
  if (isConflictMergeDraft(draft)) return draft;
  return undefined;
}

export function writeConflictFileDraft(
  store: ProjectDraftMap,
  key: string,
  scopeHash: string,
  relativePath: string,
  content: string,
  baseContent: string,
  revision?: number,
  workingCopyRevision?: string,
  editorState?: {
    selection?: { start: number; end: number };
    viewport?: { top: number; left: number };
  },
): ProjectDraftMap {
  const existing = readConflictMergeDraft(store, key);
  const now = Date.now();
  const prev = existing?.drafts[relativePath];
  const nextDrafts: Record<string, ConflictFileDraft> = {
    ...(existing?.drafts ?? {}),
    [relativePath]: {
      content,
      updatedAt: now,
      revision: revision ?? (prev?.revision ?? 0) + 1,
      baseContent: prev?.baseContent ?? baseContent,
      workingCopyRevision: workingCopyRevision ?? prev?.workingCopyRevision,
      editorState: editorState ?? prev?.editorState,
    },
  };
  // 单键内文件数容量控制
  const fileKeys = Object.keys(nextDrafts);
  if (fileKeys.length > MAX_CONFLICT_FILE_DRAFTS) {
    const oldestFile = fileKeys.reduce((left, right) =>
      nextDrafts[left].updatedAt <= nextDrafts[right].updatedAt ? left : right,
    );
    delete nextDrafts[oldestFile];
  }
  const draft: ConflictMergeDraft = {
    kind: "conflict-merge",
    scopeHash,
    savedAt: now,
    drafts: nextDrafts,
  };
  return writeGenericDraft(store, key, draft);
}

export function deleteConflictFileDraft(
  store: ProjectDraftMap,
  key: string,
  relativePath: string,
): ProjectDraftMap {
  const existing = readConflictMergeDraft(store, key);
  if (!existing || !(relativePath in existing.drafts)) return store;
  const nextDrafts = { ...existing.drafts };
  delete nextDrafts[relativePath];
  if (Object.keys(nextDrafts).length === 0) {
    return deleteProjectDraft(store, key);
  }
  const draft: ConflictMergeDraft = {
    ...existing,
    drafts: nextDrafts,
    savedAt: Date.now(),
  };
  return writeGenericDraft(store, key, draft);
}

export function getConflictFileDraft(
  store: ProjectDraftMap,
  key: string,
  relativePath: string,
): ConflictFileDraft | undefined {
  return readConflictMergeDraft(store, key)?.drafts[relativePath];
}

export function isConflictFileDirty(
  store: ProjectDraftMap,
  key: string,
  relativePath: string,
): boolean {
  const draft = getConflictFileDraft(store, key, relativePath);
  if (!draft) return false;
  return draft.content !== draft.baseContent;
}

export function isConflictDraftEmpty(
  store: ProjectDraftMap,
  key: string,
): boolean {
  const draft = readConflictMergeDraft(store, key);
  return !draft || Object.keys(draft.drafts).length === 0;
}
