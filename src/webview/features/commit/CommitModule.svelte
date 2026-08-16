<script lang="ts">
  import type {
    CommitSnapshot,
    HostToWebviewMessage,
    WebviewAction,
    WorkbenchFileView,
  } from "@protocol/workbenchProtocol";
  import ScrollArea from "../../components/ui/ScrollArea.svelte";
  import FilePathDetail from "../../components/svn/FilePathDetail.svelte";
  import PathCell from "../../components/list/PathCell.svelte";
  import SortHeader from "../../components/list/SortHeader.svelte";
  import SelectionSummary from "../../components/list/SelectionSummary.svelte";
  import { isExplicitSubmitShortcut } from "../../i18n/keyboard";
  import { formatZhDateTime } from "../../i18n/formatters";
  import {
    commitSelectionAiSourceLabels,
    describeCommitSelectionEvaluation,
    fileStatusLabels,
    sourceLabels,
  } from "../../i18n/terminology";
  import {
    diffDraftAgainstSuggestion,
    insertSuggestionBlankFields,
  } from "../../../commit/commitMessageSuggestion";
  import {
    computeTriState,
    toggleActionable,
    selectActionable,
    actionableKeys,
    hiddenSelectionKeys,
    clearHiddenSelection,
    emptySelection,
    mergeRecommendedSelection,
    type SelectionKey,
  } from "../../../selection/selectionCore";
  import { refreshSelectionSet } from "../../../selection/selectionRefresh";
  import type {
    SortDirection,
    SortField,
  } from "../../../selection/selectionSort";
  import {
    buildKeyPathMap,
    buildPathKeyMap,
    canSelectIndividually,
    cloneSelection,
    isActionableForMode,
    pathsFromKeys,
    toSelectableItems,
  } from "../../app/fileSelection";
  import {
    displayPathOf,
    matchesFileQuery,
    moveActiveIndex,
    edgeActiveIndex,
    pageSizeOf,
    rangeItems,
    shouldHandleListKeydown,
    sortFileViews,
    windowedRows,
  } from "../../components/list/listModel";
  import {
    loadListPreferences,
    saveListPreferences,
    type ListDensity,
  } from "../../app/listPreferences";

  let {
    snapshot,
    onAction,
    pathDetail,
  }: {
    snapshot: CommitSnapshot;
    onAction: (action: WebviewAction, data?: Record<string, unknown>) => void;
    /** v0.0.7 路径详情结果（Host 一次性下发）。 */
    pathDetail?: Extract<
      HostToWebviewMessage,
      { type: "file/path-detail-result" }
    >["payload"];
  } = $props();

  const MODE = "commit" as const;

  type CommitFilter =
    "all" | "selected" | "recommended" | "needsReview" | "excluded" | "blocked";

  let query = $state("");
  let filter = $state<CommitFilter>("all");
  let onlySelected = $state(false);
  let message = $state("");
  let pathDetailOpen = $state(false);
  let pathDetailTrigger = $state<HTMLButtonElement | null>(null);
  let selected = $state<ReadonlySet<SelectionKey>>(emptySelection());
  /** 回声防护：最后一次发给 Host 的选择签名；未匹配前忽略快照回声。 */
  let pendingEcho = $state<string | undefined>();
  let sortField = $state<SortField | undefined>();
  let sortDirection = $state<SortDirection>("asc");
  let announcement = $state("");
  let activeIndex = $state(-1);
  let anchorIndex = $state(-1);
  let fileList = $state<HTMLDivElement>();
  let scrollTop = $state(0);
  let viewportHeight = $state(500);
  let density = $state<ListDensity>("comfortable");
  /** v0.0.9 §4：替换前确认态（展示字符数，等待用户确认）。 */
  let replaceConfirmOpen = $state(false);
  /** 替换确认对应的目标字符数（打开时计算）。 */
  let replaceTargetLength = $state(0);

  const savedPreferences = loadListPreferences("commit");
  sortField = savedPreferences.sortField;
  sortDirection = savedPreferences.sortDirection ?? "asc";
  density = savedPreferences.density ?? "comfortable";

  const rowHeight = $derived(density === "compact" ? 36 : 48);
  const virtualizeAfter = 300;
  const overscan = 8;
  const filteredFiles = $derived(
    snapshot.files.filter((file) => {
      if (filter === "selected" && !selected.has(file.selectionKey)) {
        return false;
      }
      if (filter === "recommended" && file.selection !== "selected") {
        return false;
      }
      if (filter === "needsReview" && file.selection !== "needsReview") {
        return false;
      }
      if (filter === "excluded" && file.selection !== "excluded") return false;
      if (filter === "blocked" && file.selection !== "blocked") return false;
      if (onlySelected && !selected.has(file.selectionKey)) return false;
      return matchesFileQuery(file, query);
    }),
  );

  const sortedFiles = $derived(
    sortField
      ? sortFileViews(filteredFiles, {
          field: sortField,
          direction: sortDirection,
          includeRuleSource: true,
        })
      : filteredFiles,
  );

  const visibleWindow = $derived(
    windowedRows({
      total: sortedFiles.length,
      scrollTop,
      viewportHeight,
      rowHeight,
      overscan,
      virtualizeAfter,
    }),
  );
  const visibleRows = $derived(
    sortedFiles
      .slice(visibleWindow.start, visibleWindow.end)
      .map((file, offset) => ({ file, index: visibleWindow.start + offset })),
  );

  const keyToPath = $derived(buildKeyPathMap(snapshot.files));
  const pathToKey = $derived(buildPathKeyMap(snapshot.files));

  function selectionSignature(paths: readonly string[]): string {
    return [...paths].sort().join("\n");
  }

  function adoptSnapshotSelection(paths: readonly string[]): void {
    const next = emptySelection() as Set<SelectionKey>;
    for (const path of paths) {
      const key = pathToKey.get(path);
      if (key) next.add(key);
    }
    selected = next;
  }

  /*
   * Host authoritative selectedPaths 同步：本地刚发出的选择未回显前，
   * 忽略旧快照回声，不覆盖用户刚操作的状态；无回声时（本地规则/AI 等
   * Host 侧变更）直接采用权威选择。
   */
  $effect(() => {
    const paths = snapshot.selectedPaths;
    const signature = selectionSignature(paths);
    if (pendingEcho !== undefined) {
      if (signature === pendingEcho) pendingEcho = undefined;
      return;
    }
    if (signature !== selectionSignature(selectedPaths())) {
      adoptSnapshotSelection(paths);
    }
  });

  $effect(() => {
    message = snapshot.message;
  });

  // 刷新合法交集：Commit 下消失/变 blocked/变 excluded 的选择自动移除。
  let lastRefreshedFiles: WorkbenchFileView[] | undefined;
  $effect(() => {
    const files = snapshot.files;
    if (files === lastRefreshedFiles) return;
    lastRefreshedFiles = files;
    if (selected.size === 0) return;
    const outcome = refreshSelectionSet(
      selected,
      files.map((file) => ({
        key: file.selectionKey,
        retained: file.selection !== "blocked" && file.selection !== "excluded",
        removalReason:
          file.selection === "blocked"
            ? "状态已变为阻止项"
            : file.selection === "excluded"
              ? "状态已变为排除项"
              : undefined,
      })),
    );
    if (outcome.removed.length > 0) {
      selected = outcome.selected;
      const reasons = [
        ...new Set(outcome.removed.map((item) => item.reason)),
      ].join("；");
      announcement = `刷新后移除 ${outcome.removed.length} 个失效选择（${reasons}）。`;
      syncSelectionToHost();
    }
  });

  const filteredSelectable = $derived(toSelectableItems(sortedFiles, MODE));
  const triState = $derived(computeTriState(filteredSelectable, selected));
  const actionableCount = $derived(actionableKeys(filteredSelectable).size);
  const hiddenCount = $derived(
    hiddenSelectionKeys(toSelectableItems(filteredFiles, MODE), selected).size,
  );

  function selectedPaths(): string[] {
    return pathsFromKeys(selected, keyToPath);
  }

  /** 本地选择与 Host 权威选择的偏差：选择变化即撤销旧预览可用性。 */
  const selectionOutOfSync = $derived(
    selectionSignature(selectedPaths()) !==
      selectionSignature(snapshot.selectedPaths),
  );
  const usablePreview = $derived(
    snapshot.preview && !selectionOutOfSync ? snapshot.preview : undefined,
  );

  function syncSelectionToHost(): void {
    const paths = selectedPaths();
    pendingEcho = selectionSignature(paths);
    onAction("commit/update-selection", { selectedPaths: paths });
  }

  function setSelected(next: ReadonlySet<SelectionKey>): void {
    selected = next;
    syncSelectionToHost();
  }

  function toggleKey(key: SelectionKey): void {
    const next = cloneSelection(selected);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    setSelected(next);
  }

  function selectRecommended(): void {
    setSelected(mergeRecommendedSelection(filteredSelectable, selected));
  }

  function clearHidden(): void {
    setSelected(
      clearHiddenSelection(toSelectableItems(filteredFiles, MODE), selected),
    );
  }

  function toggleSort(field: SortField): void {
    if (sortField === field) {
      sortDirection = sortDirection === "asc" ? "desc" : "asc";
    } else {
      sortField = field;
      sortDirection = "asc";
    }
    saveListPreferences("commit", { sortField, sortDirection, density });
  }

  function resetSort(): void {
    sortField = undefined;
    sortDirection = "asc";
    saveListPreferences("commit", { sortDirection, density });
  }

  function toggleDensity(): void {
    density = density === "comfortable" ? "compact" : "comfortable";
    saveListPreferences("commit", { sortField, sortDirection, density });
  }

  function handleScroll(event: Event): void {
    const target = event.currentTarget as HTMLDivElement;
    scrollTop = target.scrollTop;
    viewportHeight = target.clientHeight || viewportHeight;
  }

  function setActiveRow(index: number): void {
    activeIndex = index;
    // 窗口化下先把活动行滚动进可视区，再聚焦已挂载行。
    if (fileList) {
      const top = index * rowHeight;
      const bottom = top + rowHeight;
      let nextScrollTop: number | undefined;
      if (top < fileList.scrollTop) nextScrollTop = top;
      if (bottom > fileList.scrollTop + fileList.clientHeight) {
        nextScrollTop = bottom - fileList.clientHeight;
      }
      if (nextScrollTop !== undefined) {
        fileList.scrollTop = nextScrollTop;
        // 同步组件滚动状态：真实浏览器经 scroll 事件更新；程序化滚动
        // （键盘导航）直接同步，窗口立即重算。
        scrollTop = nextScrollTop;
      }
    }
    requestAnimationFrame(() => {
      fileList
        ?.querySelector<HTMLElement>(`[data-row-index="${index}"]`)
        ?.focus();
    });
  }

  function openDetail(
    file: WorkbenchFileView,
    trigger: HTMLButtonElement,
  ): void {
    pathDetailTrigger = trigger;
    onAction("file/path-detail", { relativePath: file.relativePath });
  }

  function closeDetail(): void {
    pathDetailOpen = false;
    pathDetailTrigger?.focus();
  }

  // 新的路径详情结果到达时自动展开；用户可手动关闭。
  $effect(() => {
    if (pathDetail) pathDetailOpen = true;
  });

  // v0.0.7 §7.2：跨项目 scope 的提交预览按项目分组；单项目不分组。
  const previewGroups = $derived.by(() => {
    const preview = usablePreview;
    if (!preview) return undefined;
    const groups: { project: string; paths: string[] }[] = [];
    let crossProject = false;
    for (const selectedPath of preview.selectedPaths) {
      const file = snapshot.files.find(
        (candidate) => candidate.relativePath === selectedPath,
      );
      const project = file?.projectName ?? "";
      if (project) crossProject = true;
      const group = groups.find((item) => item.project === project);
      if (group) {
        group.paths.push(selectedPath);
      } else {
        groups.push({ project, paths: [selectedPath] });
      }
    }
    if (!crossProject) return undefined;
    return groups;
  });

  function previewDisplayPath(relativePath: string): string {
    const file = snapshot.files.find(
      (candidate) => candidate.relativePath === relativePath,
    );
    return file?.projectRelativePath ?? relativePath;
  }
  const selectionPrivacy = $derived(
    snapshot.selectionAi.configured
      ? snapshot.aiPrivacy.find((item) => item.scenario === "selection")
      : undefined,
  );
  const messagePrivacy = $derived(
    snapshot.aiPrivacy.find((item) => item.scenario === "message"),
  );

  function updateDraft(): void {
    onAction("commit/update-draft", { message });
  }

  /*
   * v0.0.9 §4 建议草稿：快照中的建议只在本地计算差异对比；
   * message 本地状态不被建议覆盖（不覆盖回归保护在 Host 侧强制）。
   */
  const suggestion = $derived(snapshot.messageSuggestion);
  const suggestionDiff = $derived.by(() => {
    if (!suggestion) return undefined;
    return diffDraftAgainstSuggestion(message, suggestion.message);
  });
  const suggestionCharacterCount = $derived(suggestion?.message.length ?? 0);

  function requestInsertBlankFields(): void {
    if (!suggestion) return;
    // 本地先行插入（保留用户已填字段），同时把结果同步给 Host 作为权威。
    const outcome = insertSuggestionBlankFields(message, suggestion.message);
    message = outcome.message;
    onAction("commit/adopt-suggestion", {
      token: suggestion.token,
      mode: "insert-blank-fields",
      currentMessage: message,
    });
  }

  function openReplaceConfirm(): void {
    if (!suggestion) return;
    replaceTargetLength = suggestion.message.trim().length;
    replaceConfirmOpen = true;
  }

  function confirmReplace(): void {
    if (!suggestion) return;
    const previousMessage = message;
    replaceConfirmOpen = false;
    message = suggestion.message.trim();
    onAction("commit/adopt-suggestion", {
      token: suggestion.token,
      mode: "replace",
      currentMessage: previousMessage,
    });
  }

  function copySuggestion(): void {
    if (!suggestion) return;
    onAction("copy-text", { text: suggestion.message });
  }

  function discardSuggestion(): void {
    if (!suggestion) return;
    onAction("commit/discard-suggestion", { token: suggestion.token });
  }

  function undoSuggestionReplace(): void {
    onAction("commit/undo-suggestion-replace");
  }

  function handleMessageKeydown(event: KeyboardEvent): void {
    if (!isExplicitSubmitShortcut(event)) return;
    event.preventDefault();
    onAction("commit/preview", {
      selectedPaths: selectedPaths(),
      message,
    });
  }

  function handleListKeydown(event: KeyboardEvent): void {
    if (!shouldHandleListKeydown(event)) return;
    // Escape 必须先于空列表早退处理：详情响应到达后候选刷新为空时仍可关闭。
    if (event.key === "Escape") {
      // Escape 关闭路径详情并恢复触发点焦点，滚动位置不变（规格 §6/§9）。
      if (pathDetailOpen) {
        event.preventDefault();
        closeDetail();
      }
      return;
    }
    const count = sortedFiles.length;
    if (count === 0) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
      // 幂等“选择当前筛选可操作项”：已全选时连按不反向清空。
      event.preventDefault();
      setSelected(selectActionable(filteredSelectable, selected));
      return;
    }
    let nextIndex: number | undefined;
    if (event.key === "ArrowDown") {
      nextIndex = moveActiveIndex(activeIndex, 1, count);
    } else if (event.key === "ArrowUp") {
      nextIndex = moveActiveIndex(activeIndex, -1, count);
    } else if (event.key === "PageDown" || event.key === "PageUp") {
      // 无活动行时保留原生区域滚动（局部滚动验收）；有活动行时按一页
      // 可见行数分页导航并滚动到目标行。
      if (activeIndex < 0) return;
      event.preventDefault();
      const page = pageSizeOf(viewportHeight, rowHeight);
      const direction = event.key === "PageDown" ? page : -page;
      nextIndex = moveActiveIndex(activeIndex, direction, count);
      setActiveRow(nextIndex);
      return;
    } else if (event.key === "Home") {
      nextIndex = edgeActiveIndex("home", count);
    } else if (event.key === "End") {
      nextIndex = edgeActiveIndex("end", count);
    }
    if (nextIndex !== undefined) {
      event.preventDefault();
      if (event.shiftKey) {
        const anchor = anchorIndex < 0 ? activeIndex : anchorIndex;
        const range = rangeItems(sortedFiles, anchor, nextIndex);
        const next = cloneSelection(selected);
        for (const file of range) {
          if (isActionableForMode(file, MODE)) next.add(file.selectionKey);
        }
        setSelected(next);
      } else {
        anchorIndex = nextIndex;
      }
      setActiveRow(nextIndex);
      return;
    }
    if (event.key === " " && activeIndex >= 0) {
      event.preventDefault();
      const file = sortedFiles[activeIndex];
      // Commit：excluded/blocked 不可提交，不能勾选。
      if (canSelectIndividually(file, MODE)) {
        toggleKey(file.selectionKey);
      }
      return;
    }
    if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      onAction("open-diff", {
        relativePath: sortedFiles[activeIndex].relativePath,
      });
    }
  }

  const filterLabels: Record<CommitFilter, string> = {
    all: "全部",
    selected: "已选",
    recommended: "推荐",
    needsReview: "需要确认",
    excluded: "排除",
    blocked: "阻止",
  };
</script>

<section class="commit-layout">
  <div class="commit-files">
    <div class="feature-toolbar feature-toolbar--compact">
      <div>
        <h2>提交文件</h2>
        <p>
          已选 {selected.size} / 候选 {snapshot.files.length} 个文件{hiddenCount >
          0
            ? `，另有 ${hiddenCount} 个隐藏选择`
            : ""}
        </p>
      </div>
      <div class="search-field search-field--compact">
        <span class="codicon codicon-search" aria-hidden="true"></span>
        <input
          bind:value={query}
          aria-label="筛选提交文件"
          placeholder="筛选文件…"
        />
        {#if query}
          <button
            class="icon-button icon-button--small"
            aria-label="清除筛选"
            onclick={() => (query = "")}
            ><span class="codicon codicon-close" aria-hidden="true"
            ></span></button
          >
        {/if}
      </div>
      <div class="toolbar-actions">
        <select
          class="sort-menu"
          aria-label="排序方式"
          value={sortField ?? ""}
          onchange={(event) => {
            const value = (event.currentTarget as HTMLSelectElement).value;
            if (value === "") {
              resetSort();
            } else {
              toggleSort(value as SortField);
            }
          }}
        >
          <option value="">默认顺序</option>
          <option value="path">按路径</option>
          <option value="fileName">按文件名</option>
          <option value="status">按状态</option>
          <option value="recommendation">按最终决策</option>
          <option value="ruleSource">按规则来源</option>
          <option value="ownership">按项目或仓库归属</option>
        </select>
        <button
          class="button button--secondary"
          onclick={toggleDensity}
          aria-pressed={density === "compact"}
          >{density === "compact" ? "紧凑" : "宽松"}</button
        >
        {#if sortField}
          <button class="button button--secondary" onclick={resetSort}
            >恢复默认顺序</button
          >
        {/if}
      </div>
    </div>
    <div class="status-filters" aria-label="提交文件筛选">
      {#each Object.entries(filterLabels) as [value, label] (value)}
        <button
          class:active={filter === value}
          onclick={() => (filter = value as CommitFilter)}>{label}</button
        >
      {/each}
    </div>
    <div class="commit-summary">
      <span>推荐 {snapshot.summary.selected}</span>
      <span>待确认 {snapshot.summary.needsReview}</span>
      <span>排除 {snapshot.summary.excluded}</span>
      <span class:danger={snapshot.summary.blocked > 0}
        >阻止 {snapshot.summary.blocked}</span
      >
    </div>
    {#if snapshot.feedback}
      <div
        class={`commit-feedback commit-feedback--${snapshot.feedback.tone}`}
        role="status"
      >
        {snapshot.feedback.message}
      </div>
    {/if}
    <div class="commit-action-row">
      <button class="button button--secondary" onclick={selectRecommended}
        ><span class="codicon codicon-checklist" aria-hidden="true"
        ></span>选择推荐项</button
      >
      <button
        class="button button--secondary"
        onclick={() => onAction("commit/apply-local-rules")}
        ><span class="codicon codicon-checklist" aria-hidden="true"
        ></span>应用本地规则</button
      >
      {#if snapshot.selectionAi.configured}
        <button
          class="button button--secondary"
          onclick={() => onAction("commit/ai-select")}
          ><span class="codicon codicon-sparkle" aria-hidden="true"></span>获取
          AI 建议</button
        >
      {:else}
        <button
          class="button button--secondary"
          onclick={() =>
            onAction("open-module", {
              moduleId: "settings",
              taskId: "settings/ai",
            })}
          ><span class="codicon codicon-settings-gear" aria-hidden="true"
          ></span>配置 AI</button
        >
      {/if}
    </div>
    {#if selectionPrivacy}<div class="privacy-note">
        <strong>外发预览</strong><span
          >{selectionPrivacy.data}；最多 {selectionPrivacy.fileLimit} 个文件；模型
          {selectionPrivacy.model}；不含历史。</span
        >
      </div>{/if}
    <SelectionSummary
      selectedCount={selected.size}
      {actionableCount}
      {hiddenCount}
      {onlySelected}
      {announcement}
      onToggleOnlySelected={() => (onlySelected = !onlySelected)}
      onClearHidden={clearHidden}
      onClearAll={() => setSelected(emptySelection())}
      onSelectRecommended={selectRecommended}
    />
    <div role="table" aria-label="提交候选文件列表" class="table-head-wrap">
      <div role="rowgroup">
        <div class="table-header table-header--grid" role="row">
          <span class="table-header__select" role="columnheader">
            <input
              type="checkbox"
              aria-label={`选择当前筛选可提交项（${actionableCount}）`}
              checked={triState === "all"}
              indeterminate={triState === "partial"}
              disabled={actionableCount === 0}
              onchange={() =>
                setSelected(toggleActionable(filteredSelectable, selected))}
            />
          </span>
          <SortHeader
            label="文件"
            field="path"
            activeField={sortField}
            direction={sortDirection}
            onToggle={toggleSort}
          />
          <SortHeader
            label="状态"
            field="status"
            activeField={sortField}
            direction={sortDirection}
            onToggle={toggleSort}
          />
          <SortHeader
            label="最终决策"
            field="recommendation"
            activeField={sortField}
            direction={sortDirection}
            onToggle={toggleSort}
          />
          <SortHeader
            label="规则来源"
            field="ruleSource"
            activeField={sortField}
            direction={sortDirection}
            onToggle={toggleSort}
          />
          <SortHeader
            label="归属"
            field="ownership"
            activeField={sortField}
            direction={sortDirection}
            onToggle={toggleSort}
          />
          <span class="table-header__actions" aria-hidden="true"></span>
        </div>
      </div>
    </div>
    <ScrollArea
      class="commit-file-list"
      role="list"
      label="提交候选文件"
      bind:element={fileList}
      onScroll={handleScroll}
      onKeydown={handleListKeydown}
    >
      {#if visibleWindow.start > 0}<div
          style:height={`${visibleWindow.start * rowHeight}px`}
          aria-hidden="true"
        ></div>{/if}
      {#if pathDetail && pathDetailOpen}
        <div class="path-detail-host">
          <div class="path-detail-host__bar">
            <span class="path-detail-host__target"
              >{pathDetail.relativePath}</span
            >
            <button
              class="icon-button icon-button--small"
              aria-label="关闭路径详情"
              onclick={closeDetail}
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
      {#each visibleRows as { file, index: rowIndex } (file.selectionKey)}
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -- 行点击只设置活动行；键盘操作由列表容器统一处理。 -->
        <div
          class="commit-file-row"
          class:commit-file-row--blocked={file.selection === "blocked"}
          class:commit-file-row--selected={selected.has(file.selectionKey)}
          class:commit-file-row--active={activeIndex === rowIndex}
          role="listitem"
          tabindex="-1"
          data-row-index={rowIndex}
          onclick={() => {
            activeIndex = rowIndex;
            anchorIndex = rowIndex;
          }}
        >
          <input
            type="checkbox"
            aria-label={`选择 ${displayPathOf(file)}`}
            checked={selected.has(file.selectionKey)}
            disabled={!canSelectIndividually(file, MODE)}
            onclick={(event) => {
              event.stopPropagation();
              if (event.shiftKey && anchorIndex >= 0) {
                const range = rangeItems(sortedFiles, anchorIndex, rowIndex);
                const next = cloneSelection(selected);
                for (const item of range) {
                  if (isActionableForMode(item, MODE)) {
                    next.add(item.selectionKey);
                  }
                }
                setSelected(next);
              } else {
                toggleKey(file.selectionKey);
              }
              activeIndex = rowIndex;
              anchorIndex = rowIndex;
            }}
          />
          <PathCell
            {file}
            selected={selected.has(file.selectionKey)}
            onOpenDiff={() =>
              onAction("open-diff", { relativePath: file.relativePath })}
            onOpenDetail={(trigger) => openDetail(file, trigger)}
          />
          {#if file.evaluation}<span
              class="commit-file-decision"
              title={describeCommitSelectionEvaluation(file.evaluation)}
              >{describeCommitSelectionEvaluation(file.evaluation)}</span
            >{/if}
          <span class={`status-badge status-badge--${file.status}`}
            >{fileStatusLabels[file.status]}</span
          >
          <button
            type="button"
            class="icon-button icon-button--small"
            aria-label={`查看 ${file.relativePath} 差异`}
            onclick={(event) => {
              event.preventDefault();
              onAction("open-diff", { relativePath: file.relativePath });
            }}
          >
            <span class="codicon codicon-diff" aria-hidden="true"></span>
          </button>
        </div>
      {/each}
      {#if visibleWindow.end < sortedFiles.length}<div
          style:height={`${(sortedFiles.length - visibleWindow.end) * rowHeight}px`}
          aria-hidden="true"
        ></div>{/if}
    </ScrollArea>
  </div>

  <ScrollArea class="commit-compose" label="提交说明与提交前检查">
    <div class="compose-section">
      <div class="section-heading">
        <div>
          <span class="eyebrow">提交内容</span>
          <h2>提交说明</h2>
        </div>
        <button
          class="button button--secondary"
          onclick={() =>
            onAction("commit/generate-message", {
              selectedPaths: selectedPaths(),
              message,
            })}
        >
          <span class="codicon codicon-sparkle" aria-hidden="true"></span>
          生成建议草稿
        </button>
      </div>
      {#if messagePrivacy}<div class="privacy-note">
          <strong>外发预览</strong><span
            >{messagePrivacy.data}；最多 {messagePrivacy.fileLimit} 个文件；模型 {messagePrivacy.model}；{messagePrivacy.historyIncluded
              ? `包含 ${messagePrivacy.historyCount ?? 0} 条已脱敏历史摘要`
              : "不含历史"}。</span
          >
        </div>{/if}
      <div class="template-row" aria-label="提交说明模板">
        {#each snapshot.templates as template (template.id)}
          <button
            title={template.body}
            onclick={() =>
              onAction("commit/apply-template", { templateId: template.id })}
            >{template.label}</button
          >
        {/each}
      </div>
      <textarea
        bind:value={message}
        onblur={updateDraft}
        oninput={() => onAction("commit/update-draft", { message })}
        onkeydown={handleMessageKeydown}
        aria-label="提交说明"
        aria-describedby="commit-message-shortcut"
        placeholder="说明改动意图、范围与影响…"
        maxlength="2000"></textarea>
      <div class="compose-meta">
        <span>{message.length}/2000 个字符</span>
        <span id="commit-message-shortcut">按 Ctrl/⌘ + Enter 生成提交预览</span>
        {#if snapshot.conventionHint}<span title={snapshot.conventionHint}
            >团队规范已加载</span
          >{/if}
      </div>
      {#if snapshot.messageIssues.length > 0}
        <div class="issue-list" role="alert">
          {#each snapshot.messageIssues as issue, issueIndex (issueIndex)}
            <div>
              <span class="codicon codicon-warning" aria-hidden="true"
              ></span>{issue}
            </div>
          {/each}
        </div>
      {/if}
      {#if suggestion}
        <div
          class="commit-suggestion"
          class:commit-suggestion--stale={suggestion.stale}
          role="region"
          aria-label="提交说明建议草稿"
        >
          <div class="commit-suggestion__head">
            <span class="codicon codicon-sparkle" aria-hidden="true"></span>
            <strong>建议草稿（不覆盖当前提交说明）</strong>
            {#if suggestion.stale}<span
                class="commit-suggestion__stale"
                role="status">已过期</span
              >{/if}
          </div>
          <small>
            来源：{sourceLabels[suggestion.source]} · 生成输入仅包含文件信息与差异统计，不能证明具体行为
            {#if suggestion.model}· 模型 {suggestion.model}{/if}
          </small>
          {#if suggestion.metadataOnly}<small class="commit-suggestion__note"
              >基于文件信息生成，未读取差异正文；请结合实际改动确认。</small
            >{/if}
          {#if suggestion.stale}<p class="commit-suggestion__note">
              范围或候选已变化，该建议只能查看，不能直接采用；当前提交说明保持不变。
            </p>{/if}
          <pre class="commit-suggestion__body">{suggestion.message}</pre>
          {#if !suggestion.stale && suggestionDiff}
            <details class="commit-suggestion__diff" open>
              <summary>与当前草稿的差异</summary>
              {#if suggestionDiff.removed.length > 0}<div
                  class="commit-suggestion__diffgroup"
                >
                  <span class="commit-suggestion__removed-label"
                    >替换将移除（{suggestionDiff.removed.length} 行）</span
                  >
                  {#each suggestionDiff.removed as line, lineIndex (lineIndex)}<code
                      class="commit-suggestion__removed"
                      >{line || "（空行）"}</code
                    >{/each}
                </div>{/if}
              {#if suggestionDiff.added.length > 0}<div
                  class="commit-suggestion__diffgroup"
                >
                  <span class="commit-suggestion__added-label"
                    >建议新增（{suggestionDiff.added.length} 行）</span
                  >
                  {#each suggestionDiff.added as line, lineIndex (lineIndex)}<code
                      class="commit-suggestion__added"
                      >{line || "（空行）"}</code
                    >{/each}
                </div>{/if}
              {#if suggestionDiff.added.length === 0 && suggestionDiff.removed.length === 0}
                <p class="commit-suggestion__note">建议与当前草稿内容相同。</p>
              {/if}
            </details>
          {/if}
          <div class="commit-suggestion__actions">
            <button
              type="button"
              class="button button--secondary"
              disabled={suggestion.stale}
              onclick={requestInsertBlankFields}>插入空白字段</button
            >
            <button
              type="button"
              class="button button--secondary"
              disabled={suggestion.stale}
              onclick={openReplaceConfirm}
              >替换草稿（{suggestionCharacterCount} 字符）</button
            >
            <button
              type="button"
              class="button button--secondary"
              onclick={copySuggestion}>复制建议</button
            >
            <button
              type="button"
              class="button button--secondary"
              onclick={discardSuggestion}>放弃</button
            >
          </div>
          {#if suggestion.warnings.length > 0}
            {#each suggestion.warnings as warning, warningIndex (warningIndex)}<p
                class="commit-suggestion__note"
              >
                {warning}
              </p>{/each}
          {/if}
        </div>
      {/if}
      {#if replaceConfirmOpen && suggestion}
        <div
          class="commit-suggestion__confirm"
          role="alertdialog"
          aria-modal="false"
          aria-label="确认替换提交说明"
        >
          <strong
            >将用建议替换当前提交说明：当前 {message.length} 字符 → 建议
            {replaceTargetLength} 字符。</strong
          >
          <p class="commit-suggestion__note">
            替换后可用“撤销替换”恢复原内容；当前选择与范围不受影响。
          </p>
          <div class="commit-suggestion__actions">
            <button
              type="button"
              class="button button--primary"
              onclick={confirmReplace}
              >确认替换（{replaceTargetLength} 字符）</button
            >
            <button
              type="button"
              class="button button--secondary"
              onclick={() => (replaceConfirmOpen = false)}>不替换</button
            >
          </div>
        </div>
      {/if}
      {#if snapshot.feedback?.message.includes("已用建议替换提交说明")}
        <div class="commit-suggestion__undo">
          <button
            type="button"
            class="button button--secondary"
            onclick={undoSuggestionReplace}>撤销替换</button
          >
        </div>
      {/if}
      {#if snapshot.ai}
        <div class="ai-summary">
          <span class="codicon codicon-sparkle" aria-hidden="true"></span>
          <div>
            {#if snapshot.ai.failed}
              <strong>{snapshot.ai.summary}</strong>
              <small>来源：{commitSelectionAiSourceLabels.failed}</small>
              {#if snapshot.ai.fallbackReason}<p>
                  失败原因：{snapshot.ai.fallbackReason}
                </p>{/if}
              <button
                type="button"
                class="button button--secondary ai-recover-button"
                onclick={() => onAction("commit/apply-local-rules")}
                ><span class="codicon codicon-checklist" aria-hidden="true"
                ></span>应用本地规则</button
              >
            {:else}
              <strong>{snapshot.ai.summary}</strong>
              <small
                >来源：{sourceLabels[
                  snapshot.ai.source
                ]}{#if snapshot.ai.source === "configured-model" && snapshot.ai.binding}
                  · 模型 {snapshot.ai.binding.model ?? "已配置模型"} · {formatZhDateTime(
                    snapshot.ai.binding.generatedAt,
                  )}{/if}{#if snapshot.ai.stale}
                  · {commitSelectionAiSourceLabels.staleBadge}{/if}</small
              >
              {#if snapshot.ai.stale}<p>
                  {commitSelectionAiSourceLabels.staleHint}
                </p>{/if}
              {#if snapshot.ai.fallbackReason}<p>
                  降级原因：{snapshot.ai.fallbackReason}
                </p>{/if}
              {#each snapshot.ai.warnings as warning, warningIndex (warningIndex)}<p
                >
                  {warning}
                </p>{/each}
            {/if}
          </div>
        </div>
      {/if}
    </div>

    <div class="compose-section compose-section--preview">
      <div class="section-heading">
        <div>
          <span class="eyebrow">执行前确认</span>
          <h2>提交前检查</h2>
        </div>
        <button
          class="button button--secondary"
          onclick={() =>
            onAction("commit/preview", {
              selectedPaths: selectedPaths(),
              message,
            })}>重新检查</button
        >
      </div>
      {#if selectionOutOfSync && snapshot.preview}
        <div class="notice notice--warning" role="status">
          选择已变化，旧预览已失效；请重新生成提交预览。
        </div>
      {/if}
      {#if usablePreview}
        <div class="preview-facts">
          <span>{usablePreview.selectedPaths.length} 个文件</span>
          <span>{usablePreview.addPaths.length} 个文件待加入版本控制</span>
          <span>{usablePreview.removePaths.length} 个文件待标记删除</span>
          {#if usablePreview.remoteRevision}<span
              >远端 r{usablePreview.remoteRevision}</span
            >{/if}
        </div>
        {#if usablePreview.issues.length > 0}
          <div class="issue-list" role="alert">
            {#each usablePreview.issues as issue, issueIndex (issueIndex)}<div>
                <span class="codicon codicon-error" aria-hidden="true"
                ></span>{issue}
              </div>{/each}
          </div>
        {:else}
          <div class="ready-banner">
            <span class="codicon codicon-pass-filled" aria-hidden="true"
            ></span>范围、状态和远端检查已通过
          </div>
        {/if}
        {#if previewGroups}
          <details class="command-preview" open>
            <summary>按项目分组的提交文件</summary>
            {#each previewGroups as group (group.project)}
              <div class="preview-project-group">
                <strong>{group.project || "未归属项目"}</strong>
                {#each group.paths as selectedPath (selectedPath)}<code
                    >{previewDisplayPath(selectedPath)}</code
                  >{/each}
              </div>
            {/each}
          </details>
        {/if}
        <details class="command-preview">
          <summary>查看命令预览</summary>
          {#each usablePreview.commands as command, commandIndex (commandIndex)}<code
              >{command}</code
            >{/each}
        </details>
        <button
          class="button button--primary commit-button"
          disabled={!usablePreview.canExecute}
          onclick={() =>
            onAction("commit/execute", {
              previewToken: usablePreview?.token,
            })}
        >
          <span class="codicon codicon-cloud-upload" aria-hidden="true"></span>
          确认提交（{usablePreview.selectedPaths.length}）
        </button>
      {:else}
        <div class="preview-empty">
          <span class="codicon codicon-shield" aria-hidden="true"></span>
          <p>执行前将重新校验范围、文件状态、团队规范和远端更新。</p>
          {#if selected.size === 0}
            <p class="preview-empty__hint" role="note">
              先选择至少 1 个可提交文件。
            </p>
          {/if}
          <button
            class="button button--primary"
            disabled={selected.size === 0}
            onclick={() =>
              onAction("commit/preview", {
                selectedPaths: selectedPaths(),
                message,
              })}>生成提交预览（{selected.size}）</button
          >
        </div>
      {/if}
    </div>
  </ScrollArea>
</section>
