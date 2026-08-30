<script lang="ts">
  import {
    applyMergeAction,
    isRegionManuallyModified,
    verifyExpectedContent,
    applyTextEdits,
    type MergeDocumentState,
  } from "../../../conflict/mergeDocumentModel";
  import { hashText } from "../../../conflict/conflictDiffModel";
  import {
    CONFLICT_SHORTCUTS,
    CONFLICT_SHORTCUT_LIST,
    REPLACE_DEFERRED_NOTE,
    isImeComposingEvent,
  } from "./conflictShortcuts";

  /**
   * V012-C 可撤销取舍工具栏（当前块作用域）。
   * 六个动作：take-mine / take-theirs / take-both(mine-first) / take-both(theirs-first)
   *          / restore-original / delete（空替换）。
   * 全部经 verifyExpectedContent 复核后通过 ConflictResultEditor.applyRegionEdit 进同一 undo 栈。
   * 中文文案、行数预览、aria-live 播报、禁用态、X/Y、IME 保护。
   * V012-E：快捷键单一来源（CONFLICT_SHORTCUTS）、实时 canUndo/canRedo、查找经 keymap、IME 全局守卫。
   */

  let {
    resultEditor,
    onDraftChange,
  }: {
    resultEditor: {
      getMergeState: () => MergeDocumentState | undefined;
      syncMergeState: (s: MergeDocumentState) => void;
      setActiveRegion: (id: string | undefined) => void;
      applyRegionEdit: (
        edits: { start: number; end: number; newText: string }[],
      ) => void;
      canUndo: () => boolean;
      canRedo: () => boolean;
      undo: () => void;
      redo: () => void;
      focusLine: (line: number) => void;
      isComposing: () => boolean;
      getText: () => string;
    };
    onDraftChange?: (text: string, revision?: number) => void;
  } = $props();

  let isBusy = $state(false);
  let announcement = $state("");
  let currentIndex = $state(0);
  let moreOpen = $state(false);
  let errorTip = $state("");

  /** 计行：按 \r?\n 计数，末尾换行不计额外行 */
  function countLines(text: string): number {
    if (!text) return 0;
    const endsWithNewline = text.endsWith("\n");
    const parts = text.split(/\r?\n/);
    return endsWithNewline ? parts.length - 1 : parts.length;
  }

  function toPositionLine(text: string, offset: number): number {
    let line = 0;
    const clamped = Math.max(0, Math.min(offset, text.length));
    for (let i = 0; i < clamped; i++) if (text.charCodeAt(i) === 10) line++;
    return line;
  }

  /** 当前状态与当前块派生 — 轮询以跟随 resultEditor 内部 mergeState 变化 */
  // svelte-ignore state_referenced_locally
  let mergeState = $state(resultEditor?.getMergeState?.());
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  $effect(() => {
    const poll = () => {
      const next = resultEditor?.getMergeState?.();
      // 仅在引用或内容变化时更新，避免无谓刷新
      if (next !== mergeState) mergeState = next as never;
      else if (
        next &&
        mergeState &&
        next.draftRevision !==
          (mergeState as { draftRevision?: number }).draftRevision
      ) {
        mergeState = next as never;
      }
    };
    poll();
    // 中文注释：适度降低轮询频率，减少 100 块时的渲染压力（原 120ms）
    pollTimer = setInterval(poll, 180);
    return () => {
      if (pollTimer) clearInterval(pollTimer);
    };
  });
  let total = $derived(mergeState?.regions.length ?? 0);
  // 活动块优先取 editorState，否则按 currentIndex
  let currentRegion = $derived.by(() => {
    const st = mergeState;
    if (!st || !st.regions.length) return undefined;
    const clamped = Math.max(0, Math.min(currentIndex, st.regions.length - 1));
    return st.regions[clamped];
  });
  let currentPos = $derived.by(() => {
    const st = mergeState;
    if (!st || !currentRegion) return { current: 0, total: 0 };
    return {
      current: currentIndex + 1,
      total: st.regions.length,
    };
  });

  // 当总数变化时夹紧 currentIndex
  $effect(() => {
    const t = total;
    if (t === 0) {
      currentIndex = 0;
      return;
    }
    if (currentIndex >= t) currentIndex = t - 1;
    if (currentIndex < 0) currentIndex = 0;
  });

  // 同步 activeRegion 到 toolbar 选择
  $effect(() => {
    const r = currentRegion;
    if (!r) return;
    const st = mergeState;
    if (!st) return;
    if (st.editorState.activeRegionBaseIdentity !== r.baseIdentity) {
      // 不在此处自动写回，避免循环；仅在用户切换时写回
    }
  });

  function setCurrent(idx: number): void {
    const st = mergeState;
    if (!st || !st.regions[idx]) return;
    currentIndex = idx;
    const baseId = st.regions[idx]?.baseIdentity;
    try {
      resultEditor.setActiveRegion(baseId as string | undefined);
    } catch (_e) {
      void _e;
    }
    // 聚焦到块首
    const line = toPositionLine(st.draftContents, st.regions[idx]!.start);
    try {
      resultEditor.focusLine(line);
    } catch (_e) {
      void _e;
    }
    announcement = `已切换到块 ${idx + 1}/${st.regions.length}`;
  }

  /** 预览：计算替换文本与删除行数 */
  function previewFor(
    action:
      "take-mine" | "take-theirs" | "take-both" | "restore-original" | "delete",
    order?: "mine-first" | "theirs-first",
  ): { inserted: number; deleted: number; label: string } {
    const st = mergeState;
    const region = currentRegion;
    if (!st || !region) return { inserted: 0, deleted: 0, label: "—" };
    const raw = st.draftContents.slice(region.start, region.end);
    const deleted = countLines(raw);
    let replacement = "";
    if (action === "take-mine") replacement = region.mine;
    else if (action === "take-theirs") replacement = region.theirs;
    else if (action === "take-both") {
      const first = order === "theirs-first" ? region.theirs : region.mine;
      const second = order === "theirs-first" ? region.mine : region.theirs;
      if (!first) replacement = second;
      else if (!second) replacement = first;
      else {
        const needs = !first.endsWith("\n") && !second.startsWith("\n");
        replacement = needs ? `${first}\n${second}` : `${first}${second}`;
      }
    } else if (action === "restore-original") {
      const snap = region.baseIdentity
        ? st.originalRegions[region.baseIdentity]
        : undefined;
      replacement = snap?.anchorText ?? raw;
    } else if (action === "delete") replacement = "";
    // 末尾换行语义：若在文末且原文无末尾换行，去掉 replacement 末尾换行
    if (
      region.end === st.draftContents.length &&
      !st.draftContents.endsWith("\n")
    ) {
      if (replacement.endsWith("\r\n")) replacement = replacement.slice(0, -2);
      else if (replacement.endsWith("\n"))
        replacement = replacement.slice(0, -1);
    }
    const inserted = countLines(replacement);
    const orderLabel =
      action === "take-both"
        ? order === "mine-first"
          ? "·先我后他"
          : "·先他后我"
        : "";
    const label =
      action === "delete"
        ? `-${deleted} 行`
        : `+${inserted}/-${deleted} 行${orderLabel}`;
    return { inserted, deleted, label };
  }

  let disabledReason = $derived.by(() => {
    const st = mergeState;
    if (!st) return "无可编辑文档";
    if (!currentRegion) return "无冲突块";
    return "";
  });

  // 中文注释：预览缓存，避免每次渲染重复 joinBoth/countLines（100 块时每次轮询都会重算）
  let previewCache = $derived.by(() => {
    const st = mergeState;
    const region = currentRegion;
    if (!st || !region) return null;
    // 依赖 revision 与 region 关键字段， revision 不变时不重算
    void st.draftRevision;
    void region.start;
    void region.end;
    void region.mine;
    void region.theirs;
    void st.draftContents.length;
    return {
      mine: previewFor("take-mine"),
      theirs: previewFor("take-theirs"),
      bothMineFirst: previewFor("take-both", "mine-first"),
      bothTheirsFirst: previewFor("take-both", "theirs-first"),
      restore: previewFor("restore-original"),
      del: previewFor("delete"),
    };
  });

  // V012-E：实时刷新 canUndo/canRedo（轮询，避免 derived 仅依赖引用）
  let canUndoState = $state(false);
  let canRedoState = $state(false);
  $effect(() => {
    const tick = () => {
      try {
        canUndoState = resultEditor?.canUndo?.() ?? false;
      } catch {
        canUndoState = false;
      }
      try {
        canRedoState = resultEditor?.canRedo?.() ?? false;
      } catch {
        canRedoState = false;
      }
    };
    tick();
    // 中文注释：降低 canUndo 轮询频率，减少 100 块时的无效渲染
    const timer = setInterval(tick, 220);
    return () => clearInterval(timer);
  });
  let canUndo = $derived(canUndoState);
  let canRedo = $derived(canRedoState);
  let showShortcutHelp = $state(false);

  async function runAction(
    action: "take-mine" | "take-theirs" | "take-both" | "restore-original",
    order?: "mine-first" | "theirs-first",
  ): Promise<void> {
    if (isBusy) return;
    const st = resultEditor.getMergeState();
    if (!st || !currentRegion) {
      announcement = "无可操作冲突块";
      return;
    }
    const baseIdentity = (currentRegion.baseIdentity ??
      st.editorState.activeRegionBaseIdentity) as string | undefined;
    if (!baseIdentity) {
      announcement = "未找到当前块标识";
      return;
    }
    // IME 保护：组合期间不触发
    if (resultEditor.isComposing()) {
      announcement = "输入法组合中，请完成后再操作";
      return;
    }
    isBusy = true;
    errorTip = "";
    try {
      // 手工修改拦截（恢复除外允许先恢复）
      if (
        action !== "restore-original" &&
        isRegionManuallyModified(st, baseIdentity as never)
      ) {
        errorTip = "当前块已手工修改";
        announcement = "当前块已手工修改，请先预览或恢复到打开时状态";
        return;
      }
      const result = applyMergeAction(st, {
        expectedRevision: st.draftRevision,
        action,
        regionBaseIdentity: baseIdentity as never,
        order,
        expected: {
          scopeHash: st.scopeHash,
          workingCopyRevision: st.workingCopyRevision,
          expectedAuthoritativeContents: st.authoritativeContents,
        },
      });
      if (!result.ok) {
        if (result.code === "region-manually-modified") {
          errorTip = "当前块已手工修改";
          announcement = "当前块已手工修改，请先预览或恢复";
        } else if (
          result.code === "stale-revision" ||
          result.code === "stale-identity"
        ) {
          announcement = "内容已过期，请刷新后重试";
          errorTip = "内容已过期";
        } else if (result.code === "region-invalidated") {
          announcement = "目标块已失效，无法操作";
          errorTip = "块已失效";
        } else if (result.code === "anchor-not-unique") {
          announcement = "锚点不唯一，无法恢复";
          errorTip = "锚点不唯一";
        } else {
          announcement = result.message;
          errorTip = result.message;
        }
        return;
      }
      // 应用前复核（块级）
      const edit = result.edits[0];
      if (edit) {
        const expectedOld = st.draftContents.slice(edit.start, edit.end);
        const currentText = (() => {
          try {
            return resultEditor.getText();
          } catch {
            return st.draftContents;
          }
        })();
        // 优先用当前编辑器文本复核，若不一致则仍以 st 为准但需 verify
        const textForVerify =
          currentText.length === st.draftContents.length
            ? currentText
            : st.draftContents;
        if (!verifyExpectedContent(textForVerify, edit, expectedOld)) {
          announcement = "应用前复核失败，内容已变化";
          errorTip = "复核失败";
          return;
        }
      }
      // 进同一 undo 栈：通过 Editor applyEdits
      resultEditor.applyRegionEdit(result.edits);
      // 立即同步状态，避免 debounce 期间再次操作拿到旧 revision 导致幂等失败
      try {
        resultEditor.syncMergeState(result.state);
      } catch (_e) {
        void _e;
      }
      const inserted = result.edits[0]
        ? countLines(result.edits[0].newText)
        : 0;
      const nameMap: Record<string, string> = {
        "take-mine": "已采用我的修改",
        "take-theirs": "已采用对方修改",
        "take-both":
          order === "mine-first"
            ? "已保留双方·先我后他"
            : "已保留双方·先他后我",
        "restore-original": "已恢复到打开时状态",
      };
      announcement = `${nameMap[action] ?? "已应用"}（+${inserted} 行）`;
      // 选区恢复到可理解位置：块首
      const line = edit
        ? toPositionLine(result.state.draftContents, edit.start)
        : 0;
      try {
        resultEditor.focusLine(line);
      } catch (_e) {
        void _e;
      }
      onDraftChange?.(result.state.draftContents);
      // 轻微延迟后刷新轻量轮询，使工具栏跟随新 regions
      queueMicrotask(() => {
        // 保持 currentIndex 指向同一逻辑块或下一个
        const nextTotal = result.state.regions.length;
        if (nextTotal === 0) currentIndex = 0;
        else if (currentIndex >= nextTotal) currentIndex = nextTotal - 1;
      });
    } finally {
      isBusy = false;
    }
  }

  async function runDelete(): Promise<void> {
    if (isBusy) return;
    const st = resultEditor.getMergeState();
    if (!st || !currentRegion) {
      announcement = "无可删除块";
      return;
    }
    const baseIdentity = currentRegion.baseIdentity as string | undefined;
    if (!baseIdentity) {
      announcement = "未找到当前块";
      return;
    }
    if (resultEditor.isComposing()) {
      announcement = "输入法组合中，请完成后再操作";
      return;
    }
    isBusy = true;
    errorTip = "";
    try {
      if (isRegionManuallyModified(st, baseIdentity as never)) {
        errorTip = "当前块已手工修改";
        announcement = "当前块已手工修改，请先预览或恢复";
        return;
      }
      const entry = st.tracked.find(
        (t) => t.baseIdentity === baseIdentity && !t.invalidated && !t.resolved,
      );
      // 若已被解决则无法删除
      if (!entry) {
        announcement = "目标块已失效或已解决，无法删除";
        errorTip = "块已失效";
        return;
      }
      const expectedOld = st.draftContents.slice(entry.start, entry.end);
      let newText = "";
      // 末尾换行语义：与 mergeDocumentModel 一致
      if (
        entry.end === st.draftContents.length &&
        !st.draftContents.endsWith("\n")
      ) {
        newText = "";
      }
      const edit = { start: entry.start, end: entry.end, newText };
      const currentText = (() => {
        try {
          return resultEditor.getText();
        } catch {
          return st.draftContents;
        }
      })();
      const textForVerify =
        currentText.length === st.draftContents.length
          ? currentText
          : st.draftContents;
      if (!verifyExpectedContent(textForVerify, edit, expectedOld)) {
        announcement = "应用前复核失败，内容已变化";
        errorTip = "复核失败";
        return;
      }
      // 幂等：revision 校验由 model 侧保证，此处直接送入 Editor
      resultEditor.applyRegionEdit([edit]);
      // 同步状态：本地计算新文本与 hash，保持 revision 递增，便于连续操作幂等
      const nextContents = applyTextEdits(st.draftContents, [edit]);
      const nextState: MergeDocumentState = {
        ...st,
        draftContents: nextContents,
        draftRevision: st.draftRevision + 1,
        draftContentHash: hashText(nextContents) as never,
        // tracked 交由 onChange 的 applyMergeEdit 更新，此处先乐观更新为失效，避免重复删除
        tracked: st.tracked.map((t) =>
          t.baseIdentity === baseIdentity && t.start === entry.start
            ? { ...t, invalidated: true }
            : t,
        ),
        regions: st.regions.filter(
          (r) => r.baseIdentity !== baseIdentity || r.start !== entry.start,
        ),
      } as unknown as MergeDocumentState;
      try {
        resultEditor.syncMergeState(nextState);
      } catch (_e) {
        void _e;
      }
      const deleted = countLines(expectedOld);
      announcement = `已删除当前块（-${deleted} 行）`;
      moreOpen = false;
      onDraftChange?.(nextContents);
      queueMicrotask(() => {
        if (
          currentIndex >= nextState.regions.length &&
          nextState.regions.length > 0
        )
          currentIndex = nextState.regions.length - 1;
      });
    } finally {
      isBusy = false;
    }
  }

  function handleUndo(): void {
    if (resultEditor.isComposing()) return;
    try {
      resultEditor.undo();
      announcement = "已撤销";
      // 选区恢复：聚焦到新的当前位置块首
      const st = resultEditor.getMergeState();
      if (st && st.regions[currentIndex]) {
        const line = toPositionLine(
          st.draftContents,
          st.regions[currentIndex]!.start,
        );
        resultEditor.focusLine(line);
      }
    } catch (_e) {
      void _e;
    }
  }
  function handleRedo(): void {
    if (resultEditor.isComposing()) return;
    try {
      resultEditor.redo();
      announcement = "已重做";
      const st = resultEditor.getMergeState();
      if (st && st.regions[currentIndex]) {
        const line = toPositionLine(
          st.draftContents,
          st.regions[currentIndex]!.start,
        );
        resultEditor.focusLine(line);
      }
    } catch (_e) {
      void _e;
    }
  }

  function onKeydown(e: KeyboardEvent): void {
    // V012-E：IME 期间所有快捷键不触发
    if (isImeComposingEvent(e) || resultEditor.isComposing()) return;
    // ? 帮助（单一来源）
    if (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      showShortcutHelp = !showShortcutHelp;
      return;
    }
    // Alt+↑/↓ 块导航（与 Diff 一致，沿用现有行为确认可用）
    if (e.altKey && !e.ctrlKey && !e.metaKey) {
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setCurrent(Math.max(0, currentIndex - 1));
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setCurrent(Math.min(total - 1, currentIndex + 1));
        return;
      }
    }
    const isMod = e.ctrlKey || e.metaKey;
    if (!isMod) return;
    if (e.key.toLowerCase() === "z" && !e.shiftKey) {
      e.preventDefault();
      handleUndo();
    } else if (
      (e.key.toLowerCase() === "z" && e.shiftKey) ||
      (e.key.toLowerCase() === "y" && isMod)
    ) {
      e.preventDefault();
      handleRedo();
    }
  }
</script>

<div
  class="merge-action-toolbar"
  role="toolbar"
  aria-label="当前块取舍工具"
  data-testid="merge-action-toolbar"
  tabindex="0"
  onkeydown={onKeydown}
>
  <div class="toolbar-head">
    <span class="toolbar-title">合并取舍（当前块）</span>
    <span
      class="toolbar-progress"
      data-testid="merge-block-progress"
      role="status"
      aria-live="polite">{currentPos.current}/{currentPos.total || 0}</span
    >
    <div class="toolbar-actions" role="group" aria-label="块导航">
      <button
        class="button button--secondary"
        aria-label="上一个块"
        data-testid="toolbar-prev-block"
        disabled={total <= 1 || isBusy}
        onclick={() => setCurrent(Math.max(0, currentIndex - 1))}
        title={CONFLICT_SHORTCUTS.prevBlock.title}>上一个块</button
      >
      <button
        class="button button--secondary"
        aria-label="下一个块"
        data-testid="toolbar-next-block"
        disabled={total <= 1 || isBusy}
        onclick={() => setCurrent(Math.min(total - 1, currentIndex + 1))}
        title={CONFLICT_SHORTCUTS.nextBlock.title}>下一个块</button
      >
      <button
        class="button button--secondary"
        data-testid="toolbar-shortcut-help"
        aria-label="快捷键帮助"
        title={CONFLICT_SHORTCUTS.help.title}
        onclick={() => (showShortcutHelp = !showShortcutHelp)}
      >
        ?
      </button>
    </div>
  </div>

  {#if disabledReason}
    <div class="toolbar-empty muted" role="status">{disabledReason}</div>
  {:else}
    <div class="toolbar-buttons" role="group" aria-label="取舍动作">
      <button
        class="button button--secondary"
        data-testid="action-take-mine"
        disabled={isBusy || !currentRegion}
        onclick={() => runAction("take-mine")}
        title="采用我的修改"
      >
        采用我的修改 <small data-testid="preview-take-mine"
          >{(previewCache?.mine ?? previewFor("take-mine")).label}</small
        >
      </button>
      <button
        class="button button--secondary"
        data-testid="action-take-theirs"
        disabled={isBusy || !currentRegion}
        onclick={() => runAction("take-theirs")}
        title="采用对方修改"
      >
        采用对方修改 <small data-testid="preview-take-theirs"
          >{(previewCache?.theirs ?? previewFor("take-theirs")).label}</small
        >
      </button>
      <button
        class="button button--secondary"
        data-testid="action-take-both-mine-first"
        disabled={isBusy || !currentRegion}
        onclick={() => runAction("take-both", "mine-first")}
        title="保留双方·先我的后对方"
      >
        保留双方·先我后他 <small data-testid="preview-both-mine-first"
          >{(
            previewCache?.bothMineFirst ?? previewFor("take-both", "mine-first")
          ).label}</small
        >
      </button>
      <button
        class="button button--secondary"
        data-testid="action-take-both-theirs-first"
        disabled={isBusy || !currentRegion}
        onclick={() => runAction("take-both", "theirs-first")}
        title="保留双方·先对方后我的"
      >
        保留双方·先他后我 <small data-testid="preview-both-theirs-first"
          >{(
            previewCache?.bothTheirsFirst ??
            previewFor("take-both", "theirs-first")
          ).label}</small
        >
      </button>
      <button
        class="button button--secondary"
        data-testid="action-restore-original"
        disabled={isBusy || !currentRegion}
        onclick={() => runAction("restore-original")}
        title="恢复当前块到打开时状态"
      >
        恢复块 <small data-testid="preview-restore"
          >{(previewCache?.restore ?? previewFor("restore-original"))
            .label}</small
        >
      </button>
      <div class="toolbar-more" data-testid="more-menu-host">
        <button
          class="button button--secondary"
          data-testid="action-more-toggle"
          aria-haspopup="menu"
          aria-expanded={moreOpen}
          onclick={() => (moreOpen = !moreOpen)}
          disabled={isBusy || !currentRegion}
        >
          更多
        </button>
        {#if moreOpen}
          <div class="toolbar-more-menu" role="menu" data-testid="more-menu">
            <button
              role="menuitem"
              class="button button--secondary"
              data-testid="action-delete-block"
              disabled={isBusy}
              onclick={runDelete}
              title="删除当前块双方内容"
            >
              删除当前块双方内容 <small data-testid="preview-delete"
                >{(previewCache?.del ?? previewFor("delete")).label}</small
              >
            </button>
            <div class="toolbar-more-hint muted" role="note">
              将删除 {(previewCache?.del ?? previewFor("delete")).deleted} 行，非默认动作
            </div>
          </div>
        {/if}
      </div>
    </div>
  {/if}

  <div class="toolbar-undo" role="group" aria-label="撤销重做">
    <button
      class="button button--secondary"
      data-testid="action-undo"
      aria-label="撤销"
      disabled={!canUndo || isBusy}
      onclick={handleUndo}
      title={CONFLICT_SHORTCUTS.undo.title}
    >
      撤销
    </button>
    <button
      class="button button--secondary"
      data-testid="action-redo"
      aria-label="重做"
      disabled={!canRedo || isBusy}
      onclick={handleRedo}
      title={CONFLICT_SHORTCUTS.redo.title}
    >
      重做
    </button>
  </div>

  {#if showShortcutHelp}
    <div
      class="toolbar-shortcut-help"
      role="region"
      aria-label="快捷键帮助"
      data-testid="shortcut-help"
    >
      <strong>快捷键</strong>
      <ul>
        {#each CONFLICT_SHORTCUT_LIST as sc (sc.id)}
          <li>
            <span>{sc.label}</span><code>{sc.display}</code><small
              >{sc.title}</small
            >
          </li>
        {/each}
      </ul>
      <small class="muted" data-testid="replace-deferred-note"
        >{REPLACE_DEFERRED_NOTE}</small
      >
      <button
        class="button button--secondary"
        data-testid="shortcut-help-close"
        onclick={() => (showShortcutHelp = false)}>关闭</button
      >
    </div>
  {/if}

  {#if errorTip}
    <div
      class="notice notice--warning"
      role="alert"
      data-testid="merge-action-error"
    >
      {errorTip}
    </div>
  {/if}
  <div
    class="sr-only-announcement"
    role="status"
    aria-live="polite"
    data-testid="merge-action-announcement"
  >
    {announcement}
  </div>
</div>

<style>
  .merge-action-toolbar {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px;
    border: 1px solid var(--vscode-panel-border);
    border-radius: 6px;
    background: var(--vscode-editor-background);
  }
  .merge-action-toolbar:focus {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: -1px;
  }
  .toolbar-head {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .toolbar-title {
    font-weight: 600;
  }
  .toolbar-progress {
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
  }
  .toolbar-buttons {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    align-items: center;
  }
  .toolbar-buttons small {
    margin-left: 4px;
    color: var(--vscode-descriptionForeground);
  }
  .toolbar-more {
    position: relative;
  }
  .toolbar-more-menu {
    position: absolute;
    top: 100%;
    right: 0;
    min-width: 220px;
    padding: 8px;
    border: 1px solid var(--vscode-panel-border);
    background: var(--vscode-dropdown-background);
    border-radius: 6px;
    z-index: 2;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .toolbar-more-hint {
    font-size: 12px;
  }
  .toolbar-undo {
    display: flex;
    gap: 6px;
  }
  .toolbar-empty {
    font-size: 12px;
  }
  .sr-only-announcement {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    clip-path: inset(50%);
    white-space: nowrap;
  }
</style>
