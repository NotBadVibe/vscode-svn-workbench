<script lang="ts">
  import { untrack } from "svelte";
  import { createMergeDocument } from "../../../conflict/mergeDocumentModel";
  import type {
    MergeDocumentState,
    TextEdit,
  } from "../../../conflict/mergeDocumentModel";
  import {
    mountConflictResultEditor,
    type ConflictResultEditorMountHandle,
  } from "./conflictResultEditorAdapter";
  import type { DiffErrorInfo } from "../diff/diffErrorTaxonomy";

  /**
   * 可编辑合并结果薄组件（V012-B2）。
   * 包装 conflictResultEditorAdapter，仅做挂载/状态同步与导出接口，
   * 不发 Host 写操作、不接触绝对路径。
   */

  let {
    fileIdentity = "",
    relativePath = "",
    language = "typescript",
    initialText = "",
    readonly = false,
    onDraftChange,
    onFallback,
    onError,
  }: {
    fileIdentity?: string;
    relativePath: string;
    language?: string;
    initialText: string;
    readonly?: boolean;
    onDraftChange?: (text: string, revision: number) => void;
    onFallback?: (info: DiffErrorInfo, error: unknown) => void;
    onError?: (info: DiffErrorInfo, error: unknown) => void;
  } = $props();

  let containerEl = $state<HTMLDivElement>();
  let handle = $state<ConflictResultEditorMountHandle | undefined>(undefined);
  let mergeState = $state<MergeDocumentState | undefined>(undefined);
  let isComposingLocal = $state(false);

  function buildState(text: string): MergeDocumentState | undefined {
    const result = createMergeDocument({
      repositoryRoot: "",
      relativePath,
      authoritativeContents: text,
      baseContents: "",
      scopeHash: fileIdentity || relativePath || "scope",
      workingCopyRevision: "0",
      existingDraftContents: text,
      existingDraftRevision: 0,
    });
    if (!result.ok) return undefined;
    return result.state;
  }

  // 挂载：仅文件/语言/只读变化时重建；同文件 Host 刷新保持实例
  $effect(() => {
    const container = containerEl;
    const fid = fileIdentity;
    const rp = relativePath;
    const lang = language;
    const ro = readonly;
    if (!container) return;
    void fid;
    void rp;
    void lang;
    void ro;

    const textAtMount = untrack(() => initialText);
    const state = buildState(textAtMount);
    if (!state) {
      const info = {
        stage: "mount",
        what: "合并文档初始化失败",
        cause: "解析冲突标记失败，已保留文本",
        recovery: "可使用简化编辑器继续编辑",
      } as unknown as DiffErrorInfo;
      onFallback?.(info, new Error("createMergeDocument failed"));
      return;
    }
    // 写入 mergeState（不作为本 effect 依赖，避免自触发）
    untrack(() => {
      mergeState = state;
    });

    const prev = untrack(() => handle);
    if (prev) {
      try {
        prev.dispose();
      } catch (_e) {
        void _e;
      }
      untrack(() => {
        handle = undefined;
      });
    }

    const nextHandle = mountConflictResultEditor(container, {
      relativePath: rp,
      language: lang,
      getMergeState: () => untrack(() => mergeState)!,
      onDraftChange: (text: string, revision: number) => {
        untrack(() => {
          if (mergeState) {
            mergeState = {
              ...mergeState,
              draftContents: text,
              draftRevision: revision,
            } as MergeDocumentState;
          }
        });
        if (untrack(() => isComposingLocal)) return;
        onDraftChange?.(text, revision);
      },
      onError: (info, error) => {
        onError?.(info, error);
        onFallback?.(info, error);
      },
      readonly: ro,
    });

    if (!nextHandle) {
      untrack(() => {
        handle = undefined;
      });
      return;
    }
    // 下一行空块仅为占位，eslint 需要内容
    void 0;
    untrack(() => {
      handle = nextHandle;
    });

    const onCompStart = () => {
      isComposingLocal = true;
    };
    const onCompEnd = () => {
      isComposingLocal = false;
    };
    container.addEventListener("compositionstart", onCompStart);
    container.addEventListener("compositionend", onCompEnd);

    return () => {
      container.removeEventListener("compositionstart", onCompStart);
      container.removeEventListener("compositionend", onCompEnd);
      const cur = untrack(() => handle);
      if (cur === nextHandle) {
        try {
          nextHandle.dispose();
        } catch (_e) {
          void _e;
        }
        if (untrack(() => handle) === nextHandle) {
          untrack(() => {
            handle = undefined;
          });
        }
      }
    };
  });

  export function getText(): string {
    const h = untrack(() => handle);
    if (h) {
      try {
        return h.getApi().getText();
      } catch (_e) {
        void _e;
      }
    }
    return (
      untrack(() => mergeState)?.draftContents ?? untrack(() => initialText)
    );
  }

  export function focusLine(line: number): void {
    try {
      untrack(() => handle)
        ?.getApi()
        .focusLine(line);
    } catch (_e) {
      void _e;
    }
  }

  export function applyRegionEdit(edits: TextEdit[]): void {
    try {
      untrack(() => handle)
        ?.getApi()
        .applyRegionEdit(edits);
    } catch (_e) {
      void _e;
    }
  }

  export function canUndo(): boolean {
    try {
      return (
        untrack(() => handle)
          ?.getApi()
          .canUndo() ?? false
      );
    } catch (_e) {
      void _e;
      return false;
    }
  }

  export function canRedo(): boolean {
    try {
      return (
        untrack(() => handle)
          ?.getApi()
          .canRedo() ?? false
      );
    } catch (_e) {
      void _e;
      return false;
    }
  }

  export function undo(): void {
    try {
      untrack(() => handle)
        ?.getApi()
        .undo();
    } catch (_e) {
      void _e;
    }
  }

  export function redo(): void {
    try {
      untrack(() => handle)
        ?.getApi()
        .redo();
    } catch (_e) {
      void _e;
    }
  }

  export function cleanup(): void {
    const h = untrack(() => handle);
    if (h) {
      try {
        h.dispose();
      } catch (_e) {
        void _e;
      }
      untrack(() => {
        handle = undefined;
      });
    }
  }

  export function isComposing(): boolean {
    try {
      if (
        untrack(() => handle)
          ?.getApi()
          .isComposing()
      )
        return true;
    } catch (_e) {
      void _e;
    }
    return untrack(() => isComposingLocal);
  }
</script>

<div
  bind:this={containerEl}
  class="conflict-result-editor-host"
  data-testid="conflict-result-editor-host"
  role="region"
  aria-label="可编辑合并结果"
></div>

<style>
  .conflict-result-editor-host {
    min-height: 200px;
    overflow: auto;
    border: 1px solid var(--vscode-panel-border);
    border-radius: 6px;
  }
</style>
