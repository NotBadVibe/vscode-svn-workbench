<script lang="ts">
  import { EditorState } from "@codemirror/state";
  import { MergeView } from "@codemirror/merge";
  import { EditorView, lineNumbers } from "@codemirror/view";
  import { isImeComposing } from "../../i18n/keyboard";
  import type {
    DiffSaveWorkingResult,
    DiffSnapshot,
    HostToWebviewMessage,
    WebviewAction,
  } from "@protocol/workbenchProtocol";
  import DiffView from "./DiffView.svelte";
  import { diffFallbackNotices } from "../../i18n/terminology";
  import { computeDiffHunks } from "./diffHunks";

  let {
    snapshot,
    onAction,
    editSession,
    diffSaveResult,
    draftAck,
    targetSwitchRequest,
  }: {
    snapshot: DiffSnapshot;
    onAction: (action: WebviewAction, data?: Record<string, unknown>) => void;
    editSession?: Extract<
      HostToWebviewMessage,
      { type: "diff/edit-opened" }
    >["payload"];
    diffSaveResult?: Extract<
      HostToWebviewMessage,
      { type: "diff/save-result" }
    >["payload"];
    draftAck?: Extract<
      HostToWebviewMessage,
      { type: "diff/draft-checkpointed" }
    >["payload"];
    targetSwitchRequest?: Extract<
      HostToWebviewMessage,
      { type: "diff/target-switch-confirm" }
    >["payload"];
  } = $props();

  let mergeHost = $state<HTMLDivElement>();
  let diffViewRef = $state<
    | {
        getText: () => string;
        focusLine: (line: number) => void;
        applyRegionEdit: (start: number, end: number, text: string) => void;
      }
    | undefined
  >();
  let failedSnapshot = $state.raw<DiffSnapshot>();
  const pierreFailed = $derived(
    failedSnapshot !== undefined && failedSnapshot === snapshot,
  );

  // ---- v0.0.6 编辑态 ----
  const canEdit = $derived(
    snapshot.edit?.supported === true &&
      snapshot.language !== "diff" &&
      !snapshot.binary &&
      !snapshot.truncated,
  );
  const targetId = $derived(snapshot.edit?.targetId);
  const hasDraft = $derived(snapshot.draft !== undefined);
  let editing = $state(false);
  let dirty = $state(false);
  let savedText = $state("");
  let currentDraftRevision = $state(1);
  /** 当前编辑基准的磁盘 hash（保存成功后随 newContentHash 更新）。 */
  let currentRawHash = $state("");
  let saveError = $state<(DiffSaveWorkingResult & { ok: false }) | undefined>();
  let navIndex = $state(0);
  let checkpointTimer: number | undefined;
  /** 已发出保存请求的正文（保存成功时作为新的 savedText 基准）。 */
  let pendingSaveContent: string | undefined;
  /** 目标切换三选一对话框引用（焦点管理）。 */
  let switchDialog = $state<HTMLDivElement>();

  /** 仅当确认请求针对当前目标且确有脏内容（编辑中脏或已有脏草稿）时展示。 */
  const showTargetSwitchDialog = $derived(
    targetSwitchRequest !== undefined &&
      (targetId === undefined ||
        targetSwitchRequest.currentTargetId === targetId) &&
      (dirty || hasDraft),
  );

  const hunks = $derived(
    canEdit ? computeDiffHunks(snapshot.original, snapshot.modified) : [],
  );

  // 进入编辑：编辑会话就绪且目标一致时开启编辑态；重新建立会话（token
  // 失效恢复）只刷新令牌/哈希/草稿版本，不打断当前编辑内容与脏状态。
  $effect(() => {
    if (!editSession || !targetId || editSession.targetId !== targetId) return;
    currentRawHash = editSession.rawHash;
    currentDraftRevision = editSession.draftRevision;
    if (!editing) {
      editing = true;
      savedText = snapshot.modified;
      saveError = undefined;
    }
  });

  // 目标切换（快照换文件）：退出编辑态，草稿保留在 Host 供恢复。
  $effect(() => {
    const active = editing;
    const currentTarget = targetId;
    if (active && currentTarget && editSession?.targetId !== currentTarget) {
      editing = false;
    }
  });

  /** 最近一次已消费的 save-result 对象（按对象身份只消费一次）。 */
  let lastProcessedSaveResult:
    | Extract<HostToWebviewMessage, { type: "diff/save-result" }>["payload"]
    | undefined;

  // 保存结果消费（按消息对象只消费一次：随后的快照刷新/重渲染不得重放）。
  $effect(() => {
    if (!diffSaveResult || diffSaveResult === lastProcessedSaveResult) return;
    lastProcessedSaveResult = diffSaveResult;
    if (diffSaveResult.result.ok) {
      saveError = undefined;
      dirty = false;
      // 保存基准以实际提交的正文为准，不依赖快照刷新时序。
      savedText = pendingSaveContent ?? snapshot.modified;
      pendingSaveContent = undefined;
      currentDraftRevision = diffSaveResult.result.acceptedRevision;
      // 保存成功后磁盘 hash 已变化：更新基准，否则下一次保存会被
      // expectedContentHash 复验拒绝（diskChanged）。token 轮换由
      // workbenchState 统一应用（组件重挂载后以 editSession 为准）。
      currentRawHash = diffSaveResult.result.newContentHash;
    } else {
      pendingSaveContent = undefined;
      saveError = diffSaveResult.result;
      if (diffSaveResult.result.draftRevision !== undefined) {
        currentDraftRevision = diffSaveResult.result.draftRevision;
      }
    }
  });

  // 草稿检查点 ACK。
  $effect(() => {
    if (draftAck && draftAck.targetId === targetId) {
      currentDraftRevision = draftAck.draftRevision;
    }
  });

  function handleEditChange(text: string): void {
    if (!editing) return;
    dirty = text !== savedText;
    if (!dirty) return;
    if (checkpointTimer !== undefined) window.clearTimeout(checkpointTimer);
    checkpointTimer = window.setTimeout(() => {
      onAction("diff/draft-checkpoint", {
        targetId,
        content: text,
        draftRevision: currentDraftRevision,
      });
    }, 800);
  }

  function enterEdit(): void {
    if (!canEdit) return;
    saveError = undefined;
    onAction("diff/open-edit");
  }

  function saveWorkingCopy(): void {
    if (!editing || !editSession || !targetId || !dirty) return;
    const text = diffViewRef?.getText() ?? "";
    pendingSaveContent = text;
    onAction("diff/save-working", {
      targetId,
      editToken: editSession.editToken,
      draftRevision: currentDraftRevision,
      expectedContentHash: currentRawHash,
      content: text,
    });
  }

  /** token 失效后的恢复：刷新检查点保留草稿，再向 Host 申请新编辑会话。 */
  function reestablishEditSession(): void {
    if (!targetId) return;
    flushCheckpoint();
    saveError = undefined;
    onAction("diff/open-edit");
  }

  /** 立即把当前编辑内容作为检查点提交（取代 debounce 定时器）。 */
  function flushCheckpoint(): void {
    if (checkpointTimer !== undefined) {
      window.clearTimeout(checkpointTimer);
      checkpointTimer = undefined;
    }
    const text = diffViewRef?.getText();
    if (editing && dirty && text !== undefined && targetId) {
      onAction("diff/draft-checkpoint", {
        targetId,
        content: text,
        draftRevision: currentDraftRevision,
      });
    }
  }

  /** 脏草稿三选一：保存并打开 / 暂存并打开 / 留在当前文件。 */
  function decideTargetSwitch(decision: "save" | "stash" | "stay"): void {
    // 保存与暂存都先刷新检查点，确保 Host 草稿与编辑器内容一致。
    if (decision !== "stay") flushCheckpoint();
    onAction("diff/target-switch-decision", {
      decision,
      targetId: targetSwitchRequest?.currentTargetId ?? targetId,
    });
  }

  /** 对话框键盘：Escape = 留在当前文件；Tab 在按钮间循环（无键盘陷阱）。 */
  function onSwitchDialogKeydown(event: KeyboardEvent): void {
    if (isImeComposing(event)) return;
    if (event.key === "Escape") {
      event.preventDefault();
      decideTargetSwitch("stay");
      return;
    }
    if (event.key === "Tab" && switchDialog) {
      const buttons = Array.from(
        switchDialog.querySelectorAll<HTMLButtonElement>("button"),
      );
      if (buttons.length === 0) return;
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  // 陈旧请求（目标已变化）或干净会话（无脏修改也无脏草稿）：不打扰用户，
  // 自动按“暂存”回复，解除 Host 挂起。
  $effect(() => {
    if (!targetSwitchRequest) return;
    const matches =
      targetId === undefined ||
      targetSwitchRequest.currentTargetId === targetId;
    if (!matches || (!dirty && !hasDraft)) {
      onAction("diff/target-switch-decision", {
        decision: "stash",
        targetId: targetSwitchRequest.currentTargetId,
      });
    }
  });

  // 对话框打开时焦点进入主操作（读屏与键盘可达）。
  $effect(() => {
    if (showTargetSwitchDialog && switchDialog) {
      const primary = switchDialog.querySelector<HTMLButtonElement>(
        "button[data-primary]",
      );
      queueMicrotask(() => primary?.focus());
    }
  });

  function onKeydown(event: KeyboardEvent): void {
    // 中文 IME composition 保护：候选阶段 Enter 不触发；Ctrl/Cmd+S 保存。
    if (isImeComposing(event)) return;
    if (
      (event.ctrlKey || event.metaKey) &&
      event.key.toLowerCase() === "s" &&
      editing
    ) {
      event.preventDefault();
      saveWorkingCopy();
    }
  }

  function navigate(offset: number): void {
    if (hunks.length === 0) return;
    navIndex = (navIndex + offset + hunks.length) % hunks.length;
    const hunk = hunks[navIndex];
    diffViewRef?.focusLine(hunk.newStart);
  }

  function adoptCurrentHunk(): void {
    const hunk = hunks[navIndex];
    if (!hunk) return;
    // 逐块采用：把该块工作副本侧还原为 BASE（丢弃该块的本地编辑）。
    const baseText = hunk.oldLines.join("\n");
    diffViewRef?.applyRegionEdit(hunk.newStart, hunk.newEnd, baseText);
  }

  function abandonDraft(): void {
    if (!targetId) return;
    editing = false;
    dirty = false;
    onAction("diff/draft-abandon", { targetId });
  }

  function exportDraft(): void {
    if (targetId) onAction("diff/draft-export", { targetId });
  }

  function focusOnMount(node: HTMLElement): void {
    queueMicrotask(() => node.focus());
  }

  function handleDiffReady(api: {
    getText: () => string;
    focusLine: (line: number) => void;
    applyRegionEdit: (start: number, end: number, text: string) => void;
  }): void {
    diffViewRef = api;
  }

  function handlePierreFallback(error: unknown): void {
    console.warn("差异渲染组件失败，已切换到降级视图。", error);
    failedSnapshot = snapshot;
  }

  const readonlyExtensions = [
    lineNumbers(),
    EditorState.readOnly.of(true),
    EditorView.editable.of(false),
    EditorView.theme({
      "&": {
        height: "100%",
        color: "var(--vscode-editor-foreground)",
        backgroundColor: "var(--vscode-editor-background)",
        fontSize: "var(--vscode-editor-font-size, 12px)",
      },
      ".cm-content": {
        fontFamily: "var(--vscode-editor-font-family, monospace)",
        caretColor: "transparent",
      },
      ".cm-gutters": {
        color: "var(--vscode-editorLineNumber-foreground)",
        backgroundColor:
          "var(--vscode-editorGutter-background, var(--vscode-editor-background))",
        border: "none",
      },
      ".cm-activeLine, .cm-activeLineGutter": {
        backgroundColor: "transparent",
      },
      ".cm-selectionBackground": {
        backgroundColor: "var(--vscode-editor-selectionBackground) !important",
      },
    }),
  ];

  // MergeView 仅作为差异组件失败后的内部回退路径挂载。
  $effect(() => {
    const parent = mergeHost;
    const original = snapshot.original;
    const modified = snapshot.modified;
    const showMergeView =
      pierreFailed && !snapshot.binary && snapshot.language !== "diff";
    if (!parent || !showMergeView) return;

    const mergeView = new MergeView({
      a: {
        doc: original,
        extensions: [
          ...readonlyExtensions,
          EditorView.contentAttributes.of({
            "aria-label": `${snapshot.relativePath} BASE 内容`,
          }),
        ],
      },
      b: {
        doc: modified,
        extensions: [
          ...readonlyExtensions,
          EditorView.contentAttributes.of({
            "aria-label": `${snapshot.relativePath} 工作副本内容`,
          }),
        ],
      },
      parent,
      gutter: true,
      highlightChanges: true,
      collapseUnchanged: { margin: 3, minSize: 8 },
    });

    return () => mergeView.destroy();
  });

  $effect(() => {
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  });
</script>

<section
  use:focusOnMount
  class="feature-layout diff-feature"
  tabindex="-1"
  aria-label={`差异：${snapshot.relativePath}`}
>
  <div class="feature-toolbar">
    <div class="file-title">
      <span class="codicon codicon-diff" aria-hidden="true"></span>
      <div>
        <strong>{snapshot.relativePath}</strong>
        <span>BASE ↔ 工作副本 · {snapshot.language}</span>
        {#if editing}
          <span class="edit-mode-badge" role="status">编辑模式</span>
        {/if}
      </div>
    </div>
    <div class="toolbar-actions">
      {#if canEdit}
        {#if !editing}
          {#if hasDraft}
            <button class="button button--primary" onclick={enterEdit}
              >恢复草稿并编辑</button
            >
            <button class="button button--secondary" onclick={exportDraft}
              >导出草稿补丁</button
            >
          {:else}
            <button class="button button--primary" onclick={enterEdit}
              >页内编辑</button
            >
          {/if}
        {:else}
          <button
            class="button button--primary"
            disabled={!dirty}
            title={dirty ? "保存到工作副本（Ctrl/Cmd+S）" : "没有未保存的修改"}
            onclick={saveWorkingCopy}>保存修改</button
          >
          <button
            class="button button--secondary"
            disabled={hunks.length === 0}
            onclick={() => navigate(-1)}
            title="上一个差异"
            aria-label="上一个差异">上一个</button
          >
          <button
            class="button button--secondary"
            disabled={hunks.length === 0}
            onclick={() => navigate(1)}
            title="下一个差异"
            aria-label="下一个差异">下一个</button
          >
          <button
            class="button button--secondary"
            disabled={hunks.length === 0}
            onclick={adoptCurrentHunk}
            title="把当前差异块还原为 BASE 内容"
            aria-label="还原当前差异块为 BASE">还原此块</button
          >
          <button class="button button--secondary" onclick={exportDraft}
            >导出补丁</button
          >
          <button
            class="button button--secondary"
            onclick={abandonDraft}
            title="放弃未保存草稿">放弃草稿</button
          >
          <button
            class="button button--secondary"
            onclick={() => {
              editing = false;
            }}>回到审阅</button
          >
        {/if}
      {/if}
      {#if snapshot.language !== "diff"}
        <button
          class="button button--secondary"
          disabled={snapshot.binary || snapshot.truncated}
          title={snapshot.binary
            ? "二进制文件不支持文本对比"
            : snapshot.truncated
              ? "超过 5 MB 的文件不支持原生对比"
              : undefined}
          onclick={() => onAction("diff/open-in-editor")}
        >
          在编辑器中对比
        </button>
      {/if}
      <button
        class="button button--secondary"
        onclick={() =>
          onAction("open-file", { relativePath: snapshot.relativePath })}
      >
        在编辑器中打开
      </button>
      <button
        class="button button--secondary"
        onclick={() =>
          onAction("open-module", {
            moduleId: "commit",
            selectedPaths: [snapshot.relativePath],
          })}
      >
        提交此文件
      </button>
    </div>
  </div>

  {#if editing}
    <div class="notice" role="status">
      <span class="codicon codicon-edit" aria-hidden="true"></span>
      <span
        >编辑只作用于工作副本；BASE 与历史修订保持只读。保存前 Host
        会复验范围、令牌与磁盘状态。</span
      >
    </div>
  {/if}

  {#if dirty}
    <div class="notice notice--warning" role="status">
      <span class="codicon codicon-circle-filled" aria-hidden="true"></span>
      <span
        >有未保存的修改（草稿已自动暂存）。按 Ctrl/Cmd+S
        或点击“保存修改”写入工作副本。</span
      >
    </div>
  {/if}

  {#if saveError}
    <div class="notice notice--error" role="alert">
      <span class="codicon codicon-error" aria-hidden="true"></span>
      <span>
        保存被拒绝：{saveError.message}
        {#if saveError.draftRevision !== undefined}
          （草稿已保留，版本 {saveError.draftRevision}）
        {/if}
      </span>
      {#if saveError.reason === "tokenExpired" || saveError.reason === "scopeChanged"}
        <button
          class="button button--secondary"
          onclick={reestablishEditSession}
          title="保留当前编辑内容，重新向 Host 申请编辑令牌"
          >重新建立编辑会话（保留草稿）</button
        >
      {/if}
    </div>
  {/if}

  {#if snapshot.message}
    <div
      class="notice"
      class:notice--warning={snapshot.truncated || snapshot.binary}
      role="status"
    >
      <span class="codicon codicon-info" aria-hidden="true"></span>
      <span>{snapshot.message}</span>
    </div>
  {/if}

  {#if pierreFailed && !snapshot.binary}
    <div class="notice notice--warning" role="status">
      <span class="codicon codicon-warning" aria-hidden="true"></span>
      <span>
        {snapshot.language === "diff"
          ? diffFallbackNotices.rawPatch
          : diffFallbackNotices.mergeView}
      </span>
    </div>
  {/if}

  {#if !canEdit && snapshot.edit && !snapshot.edit.supported}
    <div class="notice notice--warning" role="status">
      <span class="codicon codicon-info" aria-hidden="true"></span>
      <span>{snapshot.edit.reason}</span>
    </div>
  {/if}

  {#if snapshot.binary}
    <div class="empty-state empty-state--large">
      <span class="codicon codicon-file-binary" aria-hidden="true"></span>
      <strong>二进制文件无法进行文本对比</strong>
      <p>可以在编辑器中打开文件，或查看 SVN 属性与历史。</p>
    </div>
  {:else if snapshot.language === "diff"}
    {#if pierreFailed}
      <pre
        class="unified-diff"
        aria-label={`${snapshot.relativePath} 统一差异`}><code
          >{snapshot.modified}</code
        ></pre>
    {:else}
      <DiffView
        relativePath={snapshot.relativePath}
        patch={snapshot.modified}
        onFallback={handlePierreFallback}
      />
    {/if}
  {:else if pierreFailed}
    <div class="merge-view-frame" aria-label={`${snapshot.relativePath} 差异`}>
      <div class="merge-view-labels" aria-hidden="true">
        <span>BASE</span><span>工作副本</span>
      </div>
      <div class="codemirror-merge-host" bind:this={mergeHost}></div>
    </div>
  {:else}
    <DiffView
      relativePath={snapshot.relativePath}
      language={snapshot.language}
      oldContents={snapshot.original}
      newContents={snapshot.modified}
      editMode={editing}
      onEditChange={handleEditChange}
      onReady={handleDiffReady}
      onFallback={handlePierreFallback}
    />
  {/if}

  {#if showTargetSwitchDialog && targetSwitchRequest}
    <div class="diff-switch-backdrop">
      <div
        class="diff-switch-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="diff-switch-dialog-title"
        tabindex="-1"
        bind:this={switchDialog}
        onkeydown={onSwitchDialogKeydown}
      >
        <h3 id="diff-switch-dialog-title">当前文件有未保存的草稿</h3>
        <p>
          “{snapshot.relativePath}”存在未保存的页内编辑草稿。打开“{targetSwitchRequest.nextRelativePath}”之前，请选择草稿的处理方式。
        </p>
        <div class="diff-switch-actions">
          <button
            class="button button--primary"
            data-primary
            onclick={() => decideTargetSwitch("save")}
            title="先把草稿写入工作副本，再打开新文件">保存并打开新文件</button
          >
          <button
            class="button button--secondary"
            onclick={() => decideTargetSwitch("stash")}
            title="草稿保留在本窗口内，回到该文件时可恢复"
            >暂存并打开新文件</button
          >
          <button
            class="button button--secondary"
            onclick={() => decideTargetSwitch("stay")}
            title="不打开新文件，继续处理当前草稿">留在当前文件</button
          >
        </div>
        <p class="diff-switch-hint">
          “暂存”不会丢失草稿：回到该文件后可恢复、导出补丁或放弃；按 Esc
          等同于“留在当前文件”。
        </p>
      </div>
    </div>
  {/if}
</section>
