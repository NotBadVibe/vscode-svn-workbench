<script lang="ts">
  import { EditorState } from "@codemirror/state";
  import { EditorView, lineNumbers } from "@codemirror/view";
  import { untrack } from "svelte";
  import type {
    ConflictSnapshot,
    HostToWebviewMessage,
    WebviewAction,
  } from "@protocol/workbenchProtocol";
  import {
    applyTextConflictResolution,
    parseTextConflictBlocks,
  } from "../../../conflict/conflictMerge";
  import ScrollArea from "../../components/ui/ScrollArea.svelte";
  import SearchInput from "../../components/list/SearchInput.svelte";
  import ResultCount from "../../components/list/ResultCount.svelte";
  import FilePathDetail from "../../components/svn/FilePathDetail.svelte";
  import { useFileList } from "../../components/list/useFileList.svelte";
  import { naturalCompare } from "../../../selection/selectionSort";
  import { confidenceLabels, sourceLabels } from "../../i18n/terminology";

  /*
   * v0.0.10 跨模块列表迁移：冲突列表复用共享搜索、排序、键盘导航与
   * 路径详情；提供上一个/下一个未解决冲突导航与处理进度。Conflict
   * 不提供批量 Resolve——每个 Resolve 仍单独预览、确认与复验。
   */

  let {
    snapshot,
    onAction,
    pathDetail,
    conflictReceipt,
  }: {
    snapshot: ConflictSnapshot;
    onAction: (action: WebviewAction, data?: Record<string, unknown>) => void;
    /** v0.0.10：路径详情结果（Host 一次性下发）。 */
    pathDetail?: Extract<
      HostToWebviewMessage,
      { type: "file/path-detail-result" }
    >["payload"];
    /** v0.0.12 批次 C：冲突意图解释外发回执（conflict/receipt 一次性）。 */
    conflictReceipt?: Extract<
      HostToWebviewMessage,
      { type: "conflict/receipt" }
    >["payload"];
  } = $props();

  let activePane = $state<"mine" | "theirs" | "base" | "working">("working");
  let receiptExpanded = $state(false);

  /** v0.0.12 批次 C：解释冲突意图（先展示受限回执，确认后调用模型）。 */
  function requestInterpret(): void {
    onAction("conflict/preview-receipt", {
      relativePath: snapshot.selected?.relativePath,
    });
  }
  function confirmInterpret(): void {
    if (!conflictReceipt) return;
    onAction("conflict/interpret", { receiptToken: conflictReceipt.token });
    conflictReceipt = undefined;
  }
  function continueLocalAdvice(): void {
    const receipt = conflictReceipt;
    if (receipt) {
      onAction("conflict/receipt-dismiss", { token: receipt.token });
    }
    conflictReceipt = undefined;
    onAction("conflict/advise", {
      relativePath: snapshot.selected?.relativePath,
    });
  }
  function dismissInterpretReceipt(): void {
    const receipt = conflictReceipt;
    if (receipt) {
      onAction("conflict/receipt-dismiss", { token: receipt.token });
    }
    conflictReceipt = undefined;
  }
  let query = $state("");
  let typeFilter = $state("all");
  let operationFilter = $state("all");
  let sortField = $state<"path" | "type" | "operation">("path");
  let navAnnouncement = $state("");
  /** v0.0.9：模型未配置时按钮不标“AI”，如实指向本地建议（AI09-TRUTH-01）。 */
  const conflictAdviceConfigured = $derived(
    snapshot.aiPrivacy?.model !== undefined &&
      !snapshot.aiPrivacy.model.includes("未配置"),
  );
  let editorHost = $state<HTMLDivElement>();
  let editorView = $state<EditorView>();
  let editorToken = $state("");
  let mergeDraft = $state("");
  let savedWorking = $state("");
  const content = $derived(snapshot.selected?.contents[activePane]);
  const conflictBlocks = $derived(parseTextConflictBlocks(mergeDraft));
  const workingDirty = $derived(mergeDraft !== savedWorking);
  const recommendationLabels = {
    acceptWorking: "保留当前工作副本内容",
    acceptMine: "采用本地版本",
    acceptTheirs: "采用远端版本",
    manualMerge: "建议人工合并",
    noSafeSuggestion: "没有安全建议",
  };
  const paneLabels = {
    working: "工作副本",
    mine: "我的修改",
    theirs: "对方修改",
    base: "修改前版本",
  } as const;
  const conflictTypeLabels: Record<string, string> = {
    text: "文本冲突",
    tree: "树冲突",
    property: "属性冲突",
    unknown: "未知类型",
  };
  const conflictOperationLabels: Record<string, string> = {
    update: "更新产生",
    merge: "合并产生",
    switch: "切换产生",
    unknown: "来源未知",
  };

  /** 类型与产生操作的排序优先级（未知值恒排末尾）。 */
  const CONFLICT_TYPE_ORDER = ["text", "tree", "property", "unknown"];
  const CONFLICT_OPERATION_ORDER = ["update", "merge", "switch", "unknown"];

  const filteredConflicts = $derived(
    snapshot.conflicts.filter((conflict) => {
      if (typeFilter !== "all" && (conflict.type ?? "unknown") !== typeFilter) {
        return false;
      }
      if (
        operationFilter !== "all" &&
        (conflict.operation ?? "unknown") !== operationFilter
      ) {
        return false;
      }
      const needle = query.trim().toLowerCase();
      if (!needle) return true;
      const haystacks = [
        conflict.relativePath,
        conflictTypeLabels[conflict.type ?? "unknown"] ?? "",
        conflict.type ?? "",
        conflictOperationLabels[conflict.operation ?? "unknown"] ?? "",
        conflict.operation ?? "",
      ];
      return haystacks.some((value) => value.toLowerCase().includes(needle));
    }),
  );

  const orderedConflicts = $derived.by(() => {
    if (sortField === "path") {
      return [...filteredConflicts].sort((left, right) =>
        naturalCompare(left.relativePath, right.relativePath),
      );
    }
    const order =
      sortField === "type" ? CONFLICT_TYPE_ORDER : CONFLICT_OPERATION_ORDER;
    const keyOf = (conflict: (typeof snapshot.conflicts)[number]) =>
      sortField === "type"
        ? (conflict.type ?? "unknown")
        : (conflict.operation ?? "unknown");
    return [...filteredConflicts].sort((left, right) => {
      const leftOrder = order.indexOf(keyOf(left));
      const rightOrder = order.indexOf(keyOf(right));
      const leftRank = leftOrder < 0 ? order.length : leftOrder;
      const rightRank = rightOrder < 0 ? order.length : rightOrder;
      if (leftRank !== rightRank) return leftRank - rightRank;
      return naturalCompare(left.relativePath, right.relativePath);
    });
  });

  const selectedIndexInOrder = $derived(
    orderedConflicts.findIndex(
      (conflict) => conflict.relativePath === snapshot.selected?.relativePath,
    ),
  );

  const list = useFileList<(typeof snapshot.conflicts)[number]>({
    rows: () => orderedConflicts,
    rowHeight: () => 56,
    onPathDetailRequest: (relativePath) =>
      onAction("file/path-detail", { relativePath }),
    onActivate: (conflict) => selectConflict(conflict.relativePath),
  });

  $effect(() => {
    query;
    typeFilter;
    operationFilter;
    list.resetNavigation();
  });

  // 新的路径详情结果到达时自动展开；关闭后恢复触发按钮焦点。
  $effect(() => {
    if (pathDetail) list.markPathDetailArrived();
  });

  function selectConflict(relativePath: string): void {
    onAction("conflict/select", { relativePath });
  }

  function moveToConflict(delta: -1 | 1): void {
    const next =
      delta === 1
        ? (orderedConflicts[selectedIndexInOrder + 1] ?? orderedConflicts[0])
        : (orderedConflicts[selectedIndexInOrder - 1] ??
          orderedConflicts[orderedConflicts.length - 1]);
    if (!next) return;
    selectConflict(next.relativePath);
    navAnnouncement = `已切换到 ${next.relativePath}（剩余 ${snapshot.progress?.remaining ?? orderedConflicts.length} 个未解决冲突）`;
  }

  $effect(() => {
    const token = snapshot.selected?.mergeEditor.token ?? "";
    if (token !== editorToken) {
      editorToken = token;
      mergeDraft = snapshot.selected?.contents.working?.content ?? "";
      savedWorking = mergeDraft;
    }
  });

  $effect(() => {
    const parent = editorHost;
    const token = editorToken;
    const editable = snapshot.selected?.mergeEditor.editable ?? false;
    if (!parent || !token || activePane !== "working") return;
    const view = new EditorView({
      state: EditorState.create({
        doc: untrack(() => mergeDraft),
        extensions: [
          lineNumbers(),
          EditorState.readOnly.of(!editable),
          EditorView.editable.of(editable),
          EditorView.contentAttributes.of({
            "aria-label": `${snapshot.selected?.relativePath ?? ""} 可编辑工作副本合并结果`,
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) mergeDraft = update.state.doc.toString();
          }),
          EditorView.theme({
            "&": {
              height: "100%",
              color: "var(--vscode-editor-foreground)",
              backgroundColor: "var(--vscode-editor-background)",
              fontSize: "var(--vscode-editor-font-size, 12px)",
            },
            ".cm-content": {
              fontFamily: "var(--vscode-editor-font-family, monospace)",
              caretColor: "var(--vscode-editorCursor-foreground)",
            },
            ".cm-gutters": {
              color: "var(--vscode-editorLineNumber-foreground)",
              backgroundColor:
                "var(--vscode-editorGutter-background, var(--vscode-editor-background))",
              border: "none",
            },
            ".cm-activeLine": {
              backgroundColor: "var(--vscode-editor-lineHighlightBackground)",
            },
          }),
        ],
      }),
      parent,
    });
    editorView = view;
    return () => {
      if (editorView === view) editorView = undefined;
      view.destroy();
    };
  });

  function applyBlock(
    index: number,
    resolution: "mine" | "theirs" | "both",
  ): void {
    const next = applyTextConflictResolution(mergeDraft, index, resolution);
    mergeDraft = next;
    if (editorView)
      editorView.dispatch({
        changes: { from: 0, to: editorView.state.doc.length, insert: next },
      });
  }
</script>

<section class="conflict-layout">
  <aside class="conflict-list-pane">
    <div class="feature-toolbar feature-toolbar--compact">
      <div>
        <h2>待处理冲突</h2>
        <p>
          剩余 {snapshot.conflicts.length} 个{snapshot.progress
            ? `，已处理 ${snapshot.progress.resolvedCount} / ${snapshot.progress.initialCount}`
            : ""}
        </p>
      </div>
      <span class="status-badge status-badge--conflicted">阻断提交</span>
    </div>
    <div class="conflict-filter-bar">
      <SearchInput
        bind:value={query}
        ariaLabel="筛选冲突文件"
        placeholder="路径、类型…"
        compact
      />
      <select
        class="sort-menu"
        aria-label="冲突类型筛选"
        value={typeFilter}
        onchange={(event) => {
          typeFilter = (event.currentTarget as HTMLSelectElement).value;
        }}
      >
        <option value="all">全部类型</option>
        <option value="text">文本冲突</option>
        <option value="tree">树冲突</option>
        <option value="property">属性冲突</option>
      </select>
      <select
        class="sort-menu"
        aria-label="产生操作筛选"
        value={operationFilter}
        onchange={(event) => {
          operationFilter = (event.currentTarget as HTMLSelectElement).value;
        }}
      >
        <option value="all">全部来源</option>
        <option value="update">更新产生</option>
        <option value="merge">合并产生</option>
        <option value="switch">切换产生</option>
      </select>
      <select
        class="sort-menu"
        aria-label="冲突排序"
        value={sortField}
        onchange={(event) => {
          const value = (event.currentTarget as HTMLSelectElement).value;
          sortField =
            value === "type" || value === "operation" ? value : "path";
        }}
      >
        <option value="path">按路径</option>
        <option value="type">按冲突类型</option>
        <option value="operation">按产生操作</option>
      </select>
    </div>
    <div class="conflict-nav-bar">
      <ResultCount count={orderedConflicts.length} suffix="个冲突" />
      <div class="toolbar-actions">
        <button
          class="button button--secondary"
          disabled={orderedConflicts.length < 2}
          onclick={() => moveToConflict(-1)}>上一个未解决</button
        >
        <button
          class="button button--secondary"
          disabled={orderedConflicts.length < 2}
          onclick={() => moveToConflict(1)}>下一个未解决</button
        >
      </div>
    </div>
    {#if navAnnouncement}<div class="sr-only-announcement" role="status">
        {navAnnouncement}
      </div>{/if}
    {#if pathDetail && list.detailOpen}
      <div class="path-detail-host">
        <div class="path-detail-host__bar">
          <span class="path-detail-host__target">{pathDetail.relativePath}</span
          >
          <button
            class="icon-button icon-button--small"
            aria-label="关闭路径详情"
            onclick={list.closePathDetail}
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
    {#if snapshot.conflicts.length === 0}
      <div class="empty-state">
        <span class="codicon codicon-pass-filled"></span>
        <div>
          <strong>没有冲突</strong>
          <p>当前范围可以继续提交。</p>
        </div>
      </div>
    {:else if orderedConflicts.length === 0}
      <div class="mini-empty">没有匹配的冲突；调整搜索词或筛选条件后重试。</div>
    {:else}
      <ScrollArea
        class="conflict-list"
        role="list"
        label="冲突文件"
        bind:element={list.element}
        onScroll={list.handleScroll}
        onKeydown={list.handleKeydown}
      >
        {#each list.visibleRows as { row: conflict, index } (conflict.relativePath)}
          <div role="listitem" class="conflict-item">
            <button
              class:active={snapshot.selected?.relativePath ===
                conflict.relativePath}
              class:conflict-row--keyboard-active={list.activeIndex === index}
              class="conflict-row"
              data-row-index={index}
              onclick={() => {
                list.markActive(index);
                selectConflict(conflict.relativePath);
              }}
            >
              <span class="codicon codicon-warning" aria-hidden="true"></span>
              <span
                ><strong>{conflict.relativePath}</strong><small
                  >{conflictTypeLabels[conflict.type ?? "unknown"] ??
                    conflict.type} · {conflictOperationLabels[
                    conflict.operation ?? "unknown"
                  ] ?? conflict.operation}</small
                ></span
              >
              <span class="codicon codicon-chevron-right" aria-hidden="true"
              ></span>
            </button>
            <div class="conflict-row-actions">
              <button
                type="button"
                class="icon-button icon-button--small"
                aria-label={`查看 ${conflict.relativePath} 路径详情`}
                title="路径详情"
                onclick={(event) =>
                  list.requestPathDetail(
                    conflict.relativePath,
                    event.currentTarget,
                  )}
                ><span class="codicon codicon-info" aria-hidden="true"
                ></span></button
              >
              <button
                type="button"
                class="icon-button icon-button--small"
                aria-label={`在仓库浏览器中显示 ${conflict.relativePath}`}
                title="在仓库浏览器中显示"
                onclick={() =>
                  onAction("changes/show-in-repository", {
                    relativePath: conflict.relativePath,
                  })}
                ><span class="codicon codicon-repo" aria-hidden="true"
                ></span></button
              >
            </div>
          </div>
        {/each}
      </ScrollArea>
    {/if}
  </aside>

  <ScrollArea class="conflict-workspace" label="冲突处理工作区">
    {#if snapshot.selected}
      <div class="conflict-header">
        <div class="file-title">
          <span class="codicon codicon-merge"></span>
          <div>
            <strong>{snapshot.selected.relativePath}</strong><span
              >r{snapshot.selected.sourceLeftRevision ?? "?"} ↔ r{snapshot
                .selected.sourceRightRevision ?? "?"}</span
            >
          </div>
        </div>
        <div class="toolbar-actions">
          <button
            class="button button--secondary"
            onclick={() =>
              onAction("conflict/advise", {
                relativePath: snapshot.selected?.relativePath,
              })}
            ><span class="codicon codicon-sparkle"
            ></span>{conflictAdviceConfigured ? "AI 分析" : "本地建议"}</button
          >
          <button class="button button--secondary" onclick={requestInterpret}
            ><span class="codicon codicon-sparkle"></span>解释冲突意图</button
          >
          <button
            class="button button--secondary"
            onclick={() =>
              onAction("open-file", {
                relativePath: snapshot.selected?.relativePath,
              })}>打开工作副本文件</button
          >
        </div>
      </div>
      {#if conflictReceipt}
        <div class="commit-receipt" role="region" aria-label="冲突意图解释回执">
          <div class="commit-receipt__head">
            <span class="codicon codicon-arrow-up" aria-hidden="true"></span>
            <strong>冲突意图解释回执（尚未发送）</strong>
            <span class="commit-receipt__tag" role="status">等待确认</span>
          </div>
          <dl class="commit-receipt__meta">
            <div>
              <dt>任务</dt>
              <dd>冲突意图解释（{conflictReceipt.receipt.task}）</dd>
            </div>
            <div>
              <dt>模型</dt>
              <dd>{conflictReceipt.receipt.model}</dd>
            </div>
            <div>
              <dt>数据类型</dt>
              <dd>{conflictReceipt.receipt.dataTypes.join("、")}</dd>
            </div>
            <div>
              <dt>文件数</dt>
              <dd>{conflictReceipt.receipt.files} 个冲突正文</dd>
            </div>
            <div>
              <dt>预算</dt>
              <dd>
                单文件 {conflictReceipt.receipt.perFileBudget} 字符 / 总计 {conflictReceipt
                  .receipt.totalBudget} 字符
              </dd>
            </div>
          </dl>
          <button
            type="button"
            class="commit-receipt__toggle"
            aria-expanded={receiptExpanded}
            onclick={() => (receiptExpanded = !receiptExpanded)}
            >{receiptExpanded ? "收起" : "展开"}冲突正文预算清单</button
          >
          {#if receiptExpanded}
            <ul class="commit-receipt__files" aria-label="冲突正文预算清单">
              {#each conflictReceipt.files as file (file.name)}
                <li class="commit-receipt__file">
                  <span>{file.name}</span>
                  <small
                    >{file.characters} / {file.maxCharacters} 字符{file.truncated
                      ? "（已截断）"
                      : ""}{file.readError
                      ? `（${file.readError}）`
                      : ""}</small
                  >
                </li>
              {/each}
            </ul>
          {/if}
          <p class="commit-receipt__note">
            不会发送：{conflictReceipt.notSent.join("；")}。
          </p>
          <p class="commit-receipt__note">{conflictReceipt.retentionNote}</p>
          <div class="commit-receipt__actions">
            <button
              type="button"
              class="button button--primary"
              onclick={confirmInterpret}>开始解释</button
            >
            <button
              type="button"
              class="button button--secondary"
              onclick={continueLocalAdvice}>继续仅本地建议</button
            >
            <button
              type="button"
              class="button button--secondary"
              onclick={dismissInterpretReceipt}>放弃</button
            >
          </div>
        </div>
      {/if}
      <div class="conflict-tabs" role="tablist" aria-label="冲突版本">
        {#each ["working", "mine", "theirs", "base"] as pane (pane)}
          <button
            role="tab"
            aria-selected={activePane === pane}
            class:active={activePane === pane}
            onclick={() => (activePane = pane as typeof activePane)}
            >{paneLabels[pane as keyof typeof paneLabels]}</button
          >
        {/each}
      </div>
      {#if activePane === "working"}
        <div class="merge-block-toolbar">
          <div>
            <strong>块级合并</strong><span
              >{conflictBlocks.length > 0
                ? `仍有 ${conflictBlocks.length} 个冲突块`
                : "未检测到冲突标记"}</span
            >
          </div>
          {#if conflictBlocks.length > 0}
            <!-- svelte-ignore a11y_no_noninteractive_tabindex -- 冲突块列表需要获得键盘焦点以便滚动。 -->
            <div
              class="merge-block-list scroll-region"
              role="region"
              aria-label="冲突块操作"
              tabindex="0"
              data-scroll-region
            >
              {#each conflictBlocks as block, index (block.start)}
                <article>
                  <span>块 {index + 1}</span><small
                    >{block.mine.split(/\r?\n/).filter(Boolean).length} 行本地 / {block.theirs
                      .split(/\r?\n/)
                      .filter(Boolean).length} 行对方</small
                  >
                  <div>
                    <button
                      class="button button--secondary"
                      onclick={() => applyBlock(index, "mine")}
                      >采用我的修改</button
                    ><button
                      class="button button--secondary"
                      onclick={() => applyBlock(index, "theirs")}
                      >采用对方修改</button
                    ><button
                      class="button button--secondary"
                      onclick={() => applyBlock(index, "both")}>保留两者</button
                    >
                  </div>
                </article>
              {/each}
            </div>
          {/if}
        </div>
        {#if snapshot.selected.mergeEditor.feedback}<div
            class="notice notice--success"
            role="status"
          >
            {snapshot.selected.mergeEditor.feedback}
          </div>{/if}
        {#each snapshot.selected.mergeEditor.issues as issue, issueIndex (issueIndex)}<div
            class="notice notice--warning"
          >
            {issue}
          </div>{/each}
        <div
          class="conflict-editor conflict-editor--editable"
          role="region"
          aria-label="可编辑工作副本合并区域"
        >
          <div class="conflict-codemirror-host" bind:this={editorHost}></div>
        </div>
        <div class="merge-save-bar">
          <span
            >{workingDirty
              ? "有尚未保存的合并修改"
              : "工作副本与已保存内容一致"}</span
          ><button
            class="button button--primary"
            disabled={!snapshot.selected.mergeEditor.editable || !workingDirty}
            onclick={() =>
              onAction("conflict/save-working", {
                editToken: snapshot.selected?.mergeEditor.token,
                content: mergeDraft,
              })}>保存工作副本合并结果</button
          >
        </div>
      {:else}
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -- 冲突正文需要获得键盘焦点以便滚动。 -->
        <div
          class="conflict-editor scroll-region"
          role="region"
          aria-label={`${paneLabels[activePane]}内容`}
          tabindex="0"
          data-scroll-region
        >
          {#if content?.readError}
            <div class="module-state module-state--error">
              <span class="codicon codicon-error"></span>
              <div>
                <strong>读取失败</strong>
                <p>{content.readError}</p>
              </div>
            </div>
          {:else}
            <pre><code>{content?.content ?? "（没有可用内容）"}</code></pre>
            {#if content?.truncated}<div class="notice notice--warning">
                内容已截断，仅用于辅助判断。
              </div>{/if}
          {/if}
        </div>
      {/if}

      <div class="conflict-bottom">
        <section class="conflict-advice">
          <div class="section-heading">
            <div>
              <span class="eyebrow">冲突建议来源</span>
              <h2>合并建议</h2>
            </div>
            {#if snapshot.advice}<span
                class={`confidence confidence--${snapshot.advice.confidence}`}
                >{confidenceLabels[snapshot.advice.confidence]}</span
              >{/if}
          </div>
          {#if snapshot.aiPrivacy}<div class="privacy-note">
              <strong>外发预览</strong><span
                >{snapshot.aiPrivacy.data}；{snapshot.aiPrivacy
                  .characters}/{snapshot.aiPrivacy.maxCharacters} 个字符；模型 {snapshot
                  .aiPrivacy.model}；不含历史。{conflictAdviceConfigured
                  ? "点击“AI 分析”后才会发送。"
                  : "未配置外部模型，将运行本地规则，不会外发。"}</span
              >
            </div>{/if}
          {#if snapshot.advice}
            <strong
              >{recommendationLabels[snapshot.advice.recommendation]}</strong
            >
            <small class="ai-source"
              >{sourceLabels[snapshot.advice.source]}</small
            >
            <p>{snapshot.advice.summary}</p>
            {#if snapshot.advice.fallbackReason}<div
                class="notice notice--warning"
              >
                降级原因：{snapshot.advice.fallbackReason}
              </div>{/if}
            {#if snapshot.advice.risks.length}<h3>风险</h3>
              <ul>
                {#each snapshot.advice.risks as risk, riskIndex (riskIndex)}<li>
                    {risk}
                  </li>{/each}
              </ul>{/if}
            {#if snapshot.advice.steps.length}<h3>验证步骤</h3>
              <ol>
                {#each snapshot.advice.steps as step, stepIndex (stepIndex)}<li>
                    {step}
                  </li>{/each}
              </ol>{/if}
          {:else}
            <div class="preview-empty">
              <span class="codicon codicon-sparkle"></span>
              <p>AI 只提供解释和候选，不会自动标记解决。</p>
              <button
                class="button button--secondary"
                onclick={() =>
                  onAction("conflict/advise", {
                    relativePath: snapshot.selected?.relativePath,
                  })}>分析两侧意图</button
              >
            </div>
          {/if}
        </section>
        {#if snapshot.interpretation}
          <section class="conflict-advice" aria-label="冲突意图解释">
            <div class="section-heading">
              <div>
                <span class="eyebrow">冲突意图解释（§7 六段）</span>
                <h2>意图解释</h2>
              </div>
              <span class="conflict-advice__source"
                >来源：{sourceLabels[
                  snapshot.interpretation.source
                ]}{#if snapshot.interpretation.stale}
                  · 已过期（冲突或修订已变化，只读）{/if}</span
              >
            </div>
            {#if snapshot.interpretation.fallbackReason}<div
                class="notice notice--warning"
              >
                降级原因：{snapshot.interpretation.fallbackReason}
              </div>{/if}
            <h3>我的修改意图</h3>
            <p>{snapshot.interpretation.myIntent}</p>
            <h3>对方修改意图</h3>
            <p>{snapshot.interpretation.theirIntent}</p>
            <h3>共同点</h3>
            <ul>
              {#each snapshot.interpretation.commonPoints as point, pointIndex (pointIndex)}<li
                >
                  {point}
                </li>{/each}
            </ul>
            <h3>冲突点</h3>
            <ul>
              {#each snapshot.interpretation.conflictPoints as point, pointIndex (pointIndex)}<li
                >
                  {point}
                </li>{/each}
            </ul>
            <h3>推荐处理方式及证据</h3>
            <p>{snapshot.interpretation.recommendedHandling.summary}</p>
            {#if snapshot.interpretation.recommendedHandling.evidence.length}<ul
              >
                {#each snapshot.interpretation.recommendedHandling.evidence as evidence, evidenceIndex (evidenceIndex)}<li
                  >
                    {evidence}
                  </li>{/each}
              </ul>{/if}
            <h3>无法判断的业务选择</h3>
            <ul>
              {#each snapshot.interpretation.businessUnknowns as unknown, unknownIndex (unknownIndex)}<li
                >
                  {unknown}
                </li>{/each}
            </ul>
            <h3>保存后应运行的验证</h3>
            <ol>
              {#each snapshot.interpretation.postSaveVerification as item, itemIndex (itemIndex)}<li
                >
                  {item.title}{#if item.command}<code class="conflict-command"
                      >{item.command}</code
                    >{/if}
                </li>{/each}
            </ol>
          </section>
        {/if}
        <section class="resolve-panel">
          <div class="section-heading">
            <div>
              <span class="eyebrow">解决确认</span>
              <h2>标记为已解决</h2>
            </div>
          </div>
          {#if snapshot.resolvePreview}
            <div class="notice">
              <span class="codicon codicon-terminal"></span><code
                >{snapshot.resolvePreview.command}</code
              >
            </div>
            {#each snapshot.resolvePreview.issues as issue, issueIndex (issueIndex)}<div
                class="issue-list"
              >
                <div>{issue}</div>
              </div>{/each}
            <button
              class="button button--primary commit-button"
              disabled={!snapshot.resolvePreview.canResolve}
              onclick={() =>
                onAction("conflict/resolve", {
                  previewToken: snapshot.resolvePreview?.token,
                })}>确认使用当前工作副本内容并标记解决</button
            >
          {:else}
            <p class="muted">
              请先在内嵌工作副本编辑器完成合并并保存。解决预览不会修改文件。
            </p>
            <button
              class="button button--secondary"
              onclick={() =>
                onAction("conflict/preview-resolve", {
                  relativePath: snapshot.selected?.relativePath,
                })}>生成解决预览</button
            >
          {/if}
        </section>
      </div>
    {:else}
      <div class="empty-state empty-state--large">
        <span class="codicon codicon-merge"></span>
        <div>
          <strong>选择一个冲突文件</strong>
          <p>比较本地、远端、BASE 和当前工作副本内容。</p>
        </div>
      </div>
    {/if}
  </ScrollArea>
</section>
