import {
  normalizePathIdentity,
  type PathSemantics,
} from "../../scope/pathIdentity";

/*
 * v0.0.7 项目草稿存储（§8）：保留内容按 projectId + moduleId 隔离；
 * 容器边界由 VS Code workspaceState 本身保证（按工作区容器存储）。
 * 草稿只保存提交说明与手动选择；预览、确认 token 与 AI 结果永不恢复。
 */

export interface ProjectDraft {
  message: string;
  selectedPaths: string[];
  /** 保存时的 scopeHash：同时是草稿键的一部分（隔离条件）。 */
  scopeHash: string;
  savedAt: number;
}

export type ProjectDraftMap = Record<string, ProjectDraft>;

const MAX_PROJECT_DRAFTS = 32;

export function projectDraftKey(
  projectRoot: string,
  moduleId: string,
  scopeHash: string,
  options: PathSemantics,
): string {
  // §8：草稿按 projectId + moduleId + operationScope（scopeHash）隔离；
  // workspace container 由 workspaceState 本身隐式隔离。
  return `${normalizePathIdentity(projectRoot, options)}::${moduleId}::${scopeHash}`;
}

export function readProjectDraft(
  store: ProjectDraftMap,
  key: string,
): ProjectDraft | undefined {
  return store[key];
}

export function writeProjectDraft(
  store: ProjectDraftMap,
  key: string,
  draft: ProjectDraft,
): ProjectDraftMap {
  const next = { ...store, [key]: draft };
  const keys = Object.keys(next);
  if (keys.length > MAX_PROJECT_DRAFTS) {
    // 容量上限：淘汰最旧的草稿。
    const oldest = keys.reduce((left, right) =>
      next[left].savedAt <= next[right].savedAt ? left : right,
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
