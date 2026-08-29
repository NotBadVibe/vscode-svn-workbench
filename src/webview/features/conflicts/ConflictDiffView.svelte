<script lang="ts" module>
  import { installDiffCspCompatibilityShim } from "../diff/cspCompatObserver";
  installDiffCspCompatibilityShim();
</script>

<script lang="ts">
  import type { MergeConflictActionPayload } from "@pierre/diffs";
  import {
    mountConflictDiffView,
    type ConflictDiffViewApi,
  } from "./conflictDiffViewAdapter";
  import {
    buildPierreUnresolvedInput,
    hashText,
    parseConflictRegions,
  } from "../../../conflict/conflictDiffModel";
  import type {
    ConflictParseError,
    ConflictFileIdentity,
    ContentHash,
  } from "../../../conflict/conflictDiffModel";
  import {
    applyConflictResolution,
    isStaleConflictAction,
    type ConflictResolution,
  } from "../../../conflict/conflictResolution";
  import { diffErrorInfo } from "../diff/diffErrorTaxonomy";

  let {
    workingText,
    relativePath = "src/example.ts",
    language = "typescript",
    fileIdentity,
    onMergeConflictAction,
    onError,
    onReady,
    onBlockProgress,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    readonly: _readonly = false,
  }: {
    workingText: string;
    relativePath?: string;
    language?: string;
    fileIdentity?: string;
    onMergeConflictAction?: (
      payload: MergeConflictActionPayload & {
        fileIdentity: ConflictFileIdentity;
        expectedHash: ContentHash;
        newHash?: ContentHash;
      },
    ) => void;
    onError?: (info: ReturnType<typeof diffErrorInfo>, error: unknown) => void;
    onReady?: (api: ConflictDiffViewApi) => void;
    onBlockProgress?: (progress: { current: number; total: number }) => void;
    readonly?: boolean;
  } = $props();

  let host = $state<HTMLDivElement>();
  let error = $state<ConflictParseError | null>(null);
  let diffInfo = $state<ReturnType<typeof diffErrorInfo> | null>(null);
  let isComposing = $state(false);
  let mountedHandle: ReturnType<typeof mountConflictDiffView> | undefined;
  let blockTotal = $state(0);
  let currentBlock = $state(1);
  // svelte-ignore state_referenced_locally
  let controlledText = $state(workingText);
  let staleMessage = $state<string | null>(null);
  // svelte-ignore state_referenced_locally
  let lastExternalText = $state(workingText);
  let mountedHash = $state<ContentHash | null>(null);
  let mountedIdentity = $state<ConflictFileIdentity | null>(null);

  const displayRoles = $derived({
    mine: "我的修改（本地）",
    theirs: "对方修改（仓库）",
    base: "共同基线（BASE）",
    merged: "合并结果",
  });

  const currentFileIdentity = $derived(
    (fileIdentity ?? relativePath) as ConflictFileIdentity,
  );
  const currentHash = $derived(hashText(controlledText));

  function notifyProgress() {
    onBlockProgress?.({ current: currentBlock, total: blockTotal });
  }

  function syncBlockCount(text: string) {
    try {
      const parsed = parseConflictRegions(text);
      blockTotal = parsed.error ? 0 : parsed.regions.length;
    } catch {
      blockTotal = 0;
    }
  }

  $effect(() => {
    if (workingText !== lastExternalText) {
      lastExternalText = workingText;
      controlledText = workingText;
      currentBlock = 1;
      staleMessage = null;
    }
  });

  function handleAction(payload: MergeConflictActionPayload) {
    const conflictIndex = payload.conflict.conflictIndex;
    const resolution = payload.resolution as ConflictResolution;
    const expectedIdentity = mountedIdentity ?? currentFileIdentity;
    const expectedHash = mountedHash ?? currentHash;
    if (
      isStaleConflictAction(
        expectedIdentity,
        expectedHash,
        currentFileIdentity,
        currentHash,
      )
    ) {
      const msg = "内容已过期，请刷新后重试";
      staleMessage = msg;
      const info = diffErrorInfo("pierre-mount-failed");
      onError?.(info, new Error(msg));
      return;
    }
    const result = applyConflictResolution(
      controlledText,
      conflictIndex,
      resolution,
    );
    if ("error" in result) {
      error = result.error;
      diffInfo = diffErrorInfo("pierre-mount-failed");
      onError?.(diffInfo, result.error);
      return;
    }
    const newText = result.newText;
    const newHash = result.newHash;
    controlledText = newText;
    staleMessage = null;
    error = null;
    diffInfo = null;
    // 保持视口在同一块附近
    const nextBlock = Math.min(conflictIndex + 1, blockTotal);
    currentBlock = nextBlock || 1;
    notifyProgress();
    const enriched = {
      ...payload,
      fileIdentity: currentFileIdentity,
      expectedHash,
      newHash,
      conflict: {
        ...payload.conflict,
        // 确保包含完整行号字段（透传 Pierre 原始）
      },
    } as MergeConflictActionPayload & {
      fileIdentity: ConflictFileIdentity;
      expectedHash: ContentHash;
      newHash: ContentHash;
    };
    onMergeConflictAction?.(enriched);
  }

  $effect(() => {
    const container = host;
    if (!container) return;
    void fileIdentity;
    const text = controlledText;
    const rel = relativePath;
    const lang = language;

    const pierreInput = buildPierreUnresolvedInput(text);
    if (pierreInput.error) {
      // 0 块（已解决）不视为挂载失败，避免误报 fallback 导致 E2E 严格模式冲突
      if (pierreInput.error.code === "missingStart" && !text.includes("<<<")) {
        error = null;
        diffInfo = null;
        blockTotal = 0;
        notifyProgress();
        if (mountedHandle) {
          mountedHandle.dispose();
          mountedHandle = undefined;
        }
        mountedHash = null;
        mountedIdentity = null;
        return;
      }
      error = pierreInput.error;
      diffInfo = diffErrorInfo("pierre-mount-failed");
      onError?.(diffInfo, pierreInput.error);
      blockTotal = 0;
      notifyProgress();
      if (mountedHandle) {
        mountedHandle.dispose();
        mountedHandle = undefined;
      }
      mountedHash = null;
      mountedIdentity = null;
      return;
    }
    error = null;
    diffInfo = null;
    staleMessage = null;
    syncBlockCount(text);
    notifyProgress();
    mountedHash = hashText(text);
    mountedIdentity = currentFileIdentity;

    if (mountedHandle) {
      mountedHandle.dispose();
      mountedHandle = undefined;
    }

    const handle = mountConflictDiffView(
      container,
      { relativePath: rel, workingText: text, language: lang },
      {
        onMergeConflictAction: handleAction,
        onError: (info, err) => {
          diffInfo = info;
          onError?.(info, err);
        },
        onReady: (api) => {
          onReady?.(api);
        },
      },
    );
    mountedHandle = handle;
    if (!handle) {
      if (!error) {
        diffInfo = diffErrorInfo("pierre-mount-failed");
      }
      return;
    }

    return () => {
      handle.dispose();
      if (mountedHandle === handle) mountedHandle = undefined;
    };
  });

  $effect(() => {
    return () => {
      if (mountedHandle) {
        mountedHandle.dispose();
        mountedHandle = undefined;
      }
    };
  });

  export function focusConflict(index: number): void {
    mountedHandle?.getApi().focusConflict(index);
    currentBlock = index + 1;
    notifyProgress();
  }

  export function getBlockProgress(): { current: number; total: number } {
    return { current: currentBlock, total: blockTotal };
  }

  export function getControlledResult(): string {
    return controlledText;
  }

  export function cleanup(): void {
    if (mountedHandle) {
      mountedHandle.dispose();
      mountedHandle = undefined;
    }
  }

  // theme 动态重建延期：当前 UnresolvedFile 以 system 主题初始化，切换时依赖外层重建；后续可在 V011-D 统一处理（记录延期原因：需监听 vscode 主题消息并重建实例，避免复杂状态同步在本批引入）
</script>

<div
  class="conflict-diff-view"
  data-testid="conflict-diff-view"
  data-file-identity={fileIdentity}
>
  <div class="conflict-roles" role="note" aria-label="冲突角色说明">
    <span class="role role--mine">{displayRoles.mine}</span>
    <span class="role role--theirs">{displayRoles.theirs}</span>
    <span class="role role--base">{displayRoles.base}</span>
    <span class="role role--merged">{displayRoles.merged}</span>
    <span class="muted">块 {currentBlock}/{blockTotal || 0}</span>
  </div>
  {#if staleMessage}
    <div
      class="module-state module-state--warning"
      data-testid="conflict-stale"
      role="alert"
    >
      <span class="codicon codicon-warning"></span>
      <span>{staleMessage}</span>
    </div>
  {/if}
  {#if error}
    <div
      class="module-state module-state--error"
      data-testid="conflict-diff-error"
      role="alert"
    >
      <span class="codicon codicon-error"></span>
      <div>
        <strong>冲突内容无法渲染</strong>
        <p>{error.message}（行 {error.line + 1}：{error.snippet}）</p>
        {#if diffInfo}
          <p class="muted">{diffInfo.recovery}</p>
        {/if}
      </div>
      <div class="toolbar-actions">
        <button
          class="button button--secondary"
          onclick={() => onError?.(diffInfo!, error)}
          type="button">查看详情</button
        >
      </div>
    </div>
  {:else}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex --><!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      bind:this={host}
      class="conflict-diff-host"
      data-testid="conflict-diff-host"
      role="region"
      aria-label="冲突差异视图"
      tabindex="0"
      oncompositionstart={() => (isComposing = true)}
      oncompositionend={() => (isComposing = false)}
      onkeydown={(e) => {
        if (isComposing) return;
        if (e.key === "ArrowUp" && e.altKey) {
          e.preventDefault();
          focusConflict(Math.max(0, currentBlock - 2));
        } else if (e.key === "ArrowDown" && e.altKey) {
          e.preventDefault();
          focusConflict(Math.min(blockTotal - 1, currentBlock));
        }
      }}
    ></div>
  {/if}
</div>

<style>
  .conflict-diff-view {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .conflict-roles {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
    font-size: 12px;
  }
  .role {
    padding: 2px 6px;
    border-radius: 4px;
    border: 1px solid var(--vscode-panel-border, #444);
  }
  .role--mine {
    background: var(
      --vscode-diffEditor-insertedTextBackground,
      rgba(155, 185, 85, 0.2)
    );
  }
  .role--theirs {
    background: var(
      --vscode-diffEditor-removedTextBackground,
      rgba(255, 0, 0, 0.2)
    );
  }
  .role--base {
    background: var(--vscode-editor-background, #1e1e1e);
  }
  .role--merged {
    background: var(--vscode-editor-selectionBackground, #264f78);
  }
  .conflict-diff-host {
    min-height: 240px;
    overflow: auto;
    border: 1px solid var(--vscode-panel-border);
    border-radius: 6px;
  }
  .conflict-diff-host:focus {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: -1px;
  }
</style>
