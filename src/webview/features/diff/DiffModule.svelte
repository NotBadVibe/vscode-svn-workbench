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
  import FilePathDetail from "../../components/svn/FilePathDetail.svelte";
  import {
    diffFallbackNotices,
    diffHunkPositionLabel,
    diffViewLabels,
  } from "../../i18n/terminology";
  import { computeDiffHunks, computePatchHunks } from "./diffHunks";
  import type { DiffErrorInfo } from "./diffErrorTaxonomy";

  let {
    snapshot,
    onAction,
    editSession,
    diffSaveResult,
    draftAck,
    targetSwitchRequest,
    pathDetail,
  }: {
    snapshot: DiffSnapshot;
    onAction: (action: WebviewAction, data?: Record<string, unknown>) => void;
    /** v0.0.10：路径详情结果（Host 一次性下发）。 */
    pathDetail?: Extract<
      HostToWebviewMessage,
      { type: "file/path-detail-result" }
    >["payload"];
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
  /** v0.1.0：结构化渲染失败信息（三要素 + 重试入口）。 */
  let fallbackInfo = $state<DiffErrorInfo | undefined>();
  /** v0.1.0：重试计数（传入 DiffView 触发高亮重载与实例重建）。 */
  let renderRetryToken = $state(0);
  /** v0.1.0：语法高亮失败（非阻塞，纯文本降级）。 */
  let highlightInfo = $state<DiffErrorInfo | undefined>();
  /** v0.1.0：统一工具区的视图偏好（仅影响呈现，不改变内容与范围）。 */
  let diffStyle = $state<"unified" | "split">("split");
  let expandUnchanged = $state(false);
  let viewSettingsOpen = $state(false);
  let viewSettingsTrigger = $state<HTMLButtonElement>();
  /**
   * v0.1.0：进入编辑前的视图偏好（统一视图不支持页内编辑时暂存，
   * 退出编辑后恢复；见 diffViewLabels.editForcesSplit）。
   */
  let diffStyleBeforeEdit = $state<"unified" | "split" | undefined>();

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
  /** v0.0.10：路径详情开合与触发按钮焦点恢复。 */
  let pathDetailOpen = $state(false);
  let pathDetailTrigger = $state<HTMLButtonElement | null>(null);
  $effect(() => {
    if (pathDetail) pathDetailOpen = true;
  });
  function closePathDetail(): void {
    pathDetailOpen = false;
    pathDetailTrigger?.focus();
  }
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

  /**
   * v0.1.0：差异块导航在只读与编辑态一致可用；
   * 修订比较（patch 直渲）从 @@ 头解析块位置。
   */
  const hunks = $derived(
    snapshot.binary
      ? []
      : snapshot.language === "diff"
        ? computePatchHunks(snapshot.modified)
        : computeDiffHunks(snapshot.original, snapshot.modified),
  );
  /** v0.1.0：保存进行中与上次保存时间（状态不只靠颜色）。 */
  let saving = $state(false);
  let savedAtText = $state("");
  /** v0.1.0：导航到达首尾的非阻塞反馈。 */
  let navBoundary = $state<"first" | "last" | undefined>();

  /**
   * v0.1.0：用户主动退出编辑（回到审阅/放弃草稿）时记住已退出的会话对象，
   * 防止 effect 因 editSession prop 仍在而反弹回编辑态（v0.0.6 遗留缺陷：
   * “回到审阅”点击后立刻被重新置回编辑态）。新会话对象（重新建立会话、
   * 恢复草稿、目标切换后的新会话）身份不同，不受影响。
   */
  let dismissedEditSession: typeof editSession | undefined;

  // 进入编辑：编辑会话就绪且目标一致时开启编辑态；重新建立会话（token
  // 失效恢复）只刷新令牌/哈希/草稿版本，不打断当前编辑内容与脏状态。
  $effect(() => {
    if (!editSession || !targetId || editSession.targetId !== targetId) return;
    if (editSession === dismissedEditSession) return;
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
    saving = false;
    if (diffSaveResult.result.ok) {
      saveError = undefined;
      dirty = false;
      savedAtText = new Intl.DateTimeFormat("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date());
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
    // 统一视图下页内编辑不可用（pierre 1.3.4 受限能力）：临时切换分栏，
    // 退出编辑后由下方 effect 恢复用户偏好。
    if (diffStyle === "unified" && diffStyleBeforeEdit === undefined) {
      diffStyleBeforeEdit = "unified";
      diffStyle = "split";
    }
    onAction("diff/open-edit");
  }

  // 退出编辑（回到审阅/放弃草稿/目标切换）后恢复进入前的视图偏好。
  // 只在确实建立过编辑态后恢复：enterEdit 到 editSession 到达之间存在
  // editing=false 的间隙，不能提前恢复（否则会短暂闪回统一视图且丢失暂存）。
  let wasEditing = false;
  $effect(() => {
    if (editing) {
      wasEditing = true;
      return;
    }
    if (wasEditing && diffStyleBeforeEdit !== undefined) {
      diffStyle = diffStyleBeforeEdit;
      diffStyleBeforeEdit = undefined;
    }
    wasEditing = false;
  });

  function saveWorkingCopy(): void {
    if (!editing || !editSession || !targetId || !dirty || saving) return;
    const text = diffViewRef?.getText() ?? "";
    pendingSaveContent = text;
    saving = true;
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
    // Esc 先关闭“显示设置”浮层并恢复触发按钮焦点，不误退出任务。
    if (event.key === "Escape" && viewSettingsOpen) {
      event.preventDefault();
      viewSettingsOpen = false;
      viewSettingsTrigger?.focus();
      return;
    }
    if (
      (event.ctrlKey || event.metaKey) &&
      event.key.toLowerCase() === "s" &&
      editing
    ) {
      event.preventDefault();
      saveWorkingCopy();
      return;
    }
    // v0.1.0：与导航按钮一致的键盘行为（Alt+↑/↓ 浏览差异块）。
    if (event.altKey && event.key === "ArrowUp") {
      event.preventDefault();
      navigate(-1);
    } else if (event.altKey && event.key === "ArrowDown") {
      event.preventDefault();
      navigate(1);
    }
  }

  // 目标切换后从头开始导航并清除首尾提示。
  $effect(() => {
    void snapshot.relativePath;
    navIndex = 0;
    navBoundary = undefined;
  });

  /**
   * v0.1.0：导航到达首尾不环绕，给出非阻塞文字反馈；
   * 只读态经 FileDiff.revealLine、编辑态经 Editor.focus 滚入目标块。
   */
  function navigate(offset: number): void {
    if (hunks.length === 0) return;
    const next = navIndex + offset;
    if (next < 0) {
      navBoundary = "first";
      return;
    }
    if (next >= hunks.length) {
      navBoundary = "last";
      return;
    }
    navBoundary = undefined;
    navIndex = next;
    diffViewRef?.focusLine(hunks[navIndex].newStart);
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
    dismissedEditSession = editSession;
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

  function handlePierreFallback(info: DiffErrorInfo, error: unknown): void {
    console.warn("差异渲染组件失败，已切换到降级视图。", error);
    fallbackInfo = info;
    failedSnapshot = snapshot;
  }

  /** v0.1.0：重试渲染（清空降级状态并重建差异实例）。 */
  function retryRender(): void {
    failedSnapshot = undefined;
    fallbackInfo = undefined;
    renderRetryToken += 1;
  }

  /** v0.1.0：重试加载语法高亮（重新预热并重建实例）。 */
  function retryHighlight(): void {
    highlightInfo = undefined;
    renderRetryToken += 1;
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
          <span class="edit-mode-badge" role="status"
            >{diffViewLabels.editingBadge}</span
          >
        {/if}
      </div>
    </div>
    <div class="toolbar-actions">
      <!-- v0.0.10：复用共享路径操作（复制、路径详情、仓库定位）。 -->
      <button
        class="icon-button icon-button--small"
        aria-label={`复制路径 ${snapshot.relativePath}`}
        title="复制路径"
        onclick={() => onAction("copy-text", { text: snapshot.relativePath })}
        ><span class="codicon codicon-copy" aria-hidden="true"></span></button
      >
      <button
        class="icon-button icon-button--small"
        aria-label={`查看 ${snapshot.relativePath} 路径详情`}
        title="路径详情"
        onclick={(event) => {
          pathDetailTrigger = event.currentTarget;
          onAction("file/path-detail", { relativePath: snapshot.relativePath });
        }}><span class="codicon codicon-info" aria-hidden="true"></span></button
      >
      <button
        class="icon-button icon-button--small"
        aria-label={`在仓库浏览器中显示 ${snapshot.relativePath}`}
        title="在仓库浏览器中显示"
        onclick={() =>
          onAction("changes/show-in-repository", {
            relativePath: snapshot.relativePath,
          })}
        ><span class="codicon codicon-repo" aria-hidden="true"></span></button
      >
      {#if !snapshot.binary}
        <!-- v0.1.0：差异块导航（只读与编辑态一致；首尾给出非阻塞反馈）。 -->
        <div
          class="diff-hunk-nav"
          role="group"
          aria-label={diffViewLabels.hunkNavGroup}
        >
          <button
            type="button"
            class="button button--secondary"
            disabled={hunks.length === 0}
            title={hunks.length === 0
              ? diffViewLabels.noHunks
              : `${diffViewLabels.prevHunk}（Alt+↑）`}
            aria-label={diffViewLabels.prevHunk}
            onclick={() => navigate(-1)}
          >
            <span class="codicon codicon-arrow-up" aria-hidden="true"
            ></span>上一处
          </button>
          {#if hunks.length > 0}
            <span class="diff-hunk-position" role="status"
              >{diffHunkPositionLabel(navIndex + 1, hunks.length)}</span
            >
          {/if}
          <button
            type="button"
            class="button button--secondary"
            disabled={hunks.length === 0}
            title={hunks.length === 0
              ? diffViewLabels.noHunks
              : `${diffViewLabels.nextHunk}（Alt+↓）`}
            aria-label={diffViewLabels.nextHunk}
            onclick={() => navigate(1)}
          >
            <span class="codicon codicon-arrow-down" aria-hidden="true"
            ></span>下一处
          </button>
          {#if navBoundary}
            <span class="diff-nav-feedback" role="status"
              >{navBoundary === "first"
                ? diffViewLabels.firstHunkReached
                : diffViewLabels.lastHunkReached}</span
            >
          {/if}
        </div>
      {/if}
      {#if !pierreFailed && !snapshot.binary}
        <!-- v0.1.0：split/unified 与展开控制收敛进单一“显示设置”。 -->
        <div class="diff-view-settings">
          <button
            type="button"
            class="button button--secondary"
            aria-expanded={viewSettingsOpen}
            bind:this={viewSettingsTrigger}
            onclick={() => (viewSettingsOpen = !viewSettingsOpen)}
          >
            <span class="codicon codicon-settings-gear" aria-hidden="true"
            ></span>{diffViewLabels.viewSettings}
          </button>
          {#if viewSettingsOpen}
            <div
              class="diff-view-settings-panel"
              role="group"
              aria-label={diffViewLabels.viewSettingsRegion}
            >
              <label class="diff-view-settings-option">
                <input
                  type="radio"
                  name="diff-style"
                  checked={diffStyle === "split"}
                  onchange={() => (diffStyle = "split")}
                />
                {diffViewLabels.split}
              </label>
              <label
                class="diff-view-settings-option"
                title={editing
                  ? diffViewLabels.unifiedDisabledWhileEditing
                  : undefined}
              >
                <input
                  type="radio"
                  name="diff-style"
                  checked={diffStyle === "unified"}
                  disabled={editing}
                  onchange={() => (diffStyle = "unified")}
                />
                {diffViewLabels.unified}
                {#if editing}
                  <span class="diff-view-settings-hint"
                    >{diffViewLabels.unifiedDisabledWhileEditing}</span
                  >
                {/if}
              </label>
              <label class="diff-view-settings-option">
                <input
                  type="checkbox"
                  checked={expandUnchanged}
                  onchange={() => (expandUnchanged = !expandUnchanged)}
                />
                {diffViewLabels.expandUnchangedLabel}
              </label>
            </div>
          {/if}
        </div>
      {/if}
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
            disabled={!dirty || saving}
            title={saving
              ? diffViewLabels.saving
              : dirty
                ? `${diffViewLabels.saveToWorkingCopy}（Ctrl/Cmd+S）`
                : "没有未保存的修改"}
            onclick={saveWorkingCopy}>{diffViewLabels.saveToWorkingCopy}</button
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
              dismissedEditSession = editSession;
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
      <!--
        V014-C2 · 返回本地修改：回到 Changes 唯一主路径（不新建全局导航
        Rail）；返回后的选择/活动行/滚动恢复由 Changes 消费 continuityRestore
        完成，本按钮只发起模块路由，不传递可写操作身份。
      -->
      <button
        class="button button--secondary"
        onclick={() =>
          onAction("open-module", {
            moduleId: "changes",
            taskId: "changes/overview",
          })}
      >
        <span class="codicon codicon-arrow-left" aria-hidden="true"
        ></span>返回本地修改
      </button>
    </div>
  </div>

  {#if pathDetail && pathDetailOpen}
    <div class="path-detail-host">
      <div class="path-detail-host__bar">
        <span class="path-detail-host__target">{pathDetail.relativePath}</span>
        <button
          type="button"
          class="icon-button icon-button--small"
          aria-label="关闭路径详情"
          onclick={closePathDetail}
          ><span class="codicon codicon-close" aria-hidden="true"
          ></span></button
        >
      </div>
      <FilePathDetail
        detail={pathDetail}
        onCopyLocalPath={() =>
          onAction("file/copy-path", {
            relativePath: pathDetail.relativePath,
          })}
      />
    </div>
  {/if}

  {#if editing && diffStyleBeforeEdit === "unified"}
    <div class="notice" role="status">
      <span class="codicon codicon-info" aria-hidden="true"></span>
      <span>{diffViewLabels.editForcesSplit}</span>
    </div>
  {/if}

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

  {#if editing && saving}
    <div class="notice" role="status">
      <span class="codicon codicon-loading" aria-hidden="true"></span>
      <span>{diffViewLabels.saving}</span>
    </div>
  {:else if editing && !dirty && savedAtText !== ""}
    <div class="notice notice--success" role="status">
      <span class="codicon codicon-check" aria-hidden="true"></span>
      <span>已于 {savedAtText} {diffViewLabels.saveToWorkingCopy}。</span>
    </div>
  {/if}

  {#if highlightInfo}
    <div class="notice" role="status">
      <span class="codicon codicon-warning" aria-hidden="true"></span>
      <span>{highlightInfo.what} {highlightInfo.cause}</span>
      <button
        class="button button--secondary"
        disabled={editing && dirty}
        title={editing && dirty
          ? "请先保存或放弃草稿，再重试加载高亮"
          : diffViewLabels.retryHighlight}
        onclick={retryHighlight}>{diffViewLabels.retryHighlight}</button
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
        {#if fallbackInfo}
          {fallbackInfo.what} {fallbackInfo.cause} {fallbackInfo.recovery}
        {:else}
          {snapshot.language === "diff"
            ? diffFallbackNotices.rawPatch
            : diffFallbackNotices.mergeView}
        {/if}
        （{diffViewLabels.simplifiedView}）
      </span>
      <button
        class="button button--secondary"
        disabled={editing && dirty}
        title={editing && dirty
          ? "请先保存或放弃草稿，再重试渲染"
          : diffViewLabels.retryRender}
        onclick={retryRender}>{diffViewLabels.retryRender}</button
      >
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
        {diffStyle}
        {expandUnchanged}
        retryToken={renderRetryToken}
        onReady={handleDiffReady}
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
      {diffStyle}
      {expandUnchanged}
      retryToken={renderRetryToken}
      onEditChange={handleEditChange}
      onReady={handleDiffReady}
      onFallback={handlePierreFallback}
      onHighlightError={(info) => (highlightInfo = info)}
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
