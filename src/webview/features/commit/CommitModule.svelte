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
  import SearchInput from "../../components/list/SearchInput.svelte";
  import ResultCount from "../../components/list/ResultCount.svelte";
  import { useFileList } from "../../components/list/useFileList.svelte";
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
    rangeItems,
    sortFileViews,
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
    commitReceipt,
  }: {
    snapshot: CommitSnapshot;
    onAction: (action: WebviewAction, data?: Record<string, unknown>) => void;
    /** v0.0.7 路径详情结果（Host 一次性下发）。 */
    pathDetail?: Extract<
      HostToWebviewMessage,
      { type: "file/path-detail-result" }
    >["payload"];
    /** v0.0.11 受限差异外发回执（commit/receipt 一次性下发）。 */
    commitReceipt?: Extract<
      HostToWebviewMessage,
      { type: "commit/receipt" }
    >["payload"];
  } = $props();

  const MODE = "commit" as const;

  type CommitFilter =
    "all" | "selected" | "recommended" | "needsReview" | "excluded" | "blocked";

  let query = $state("");
  let filter = $state<CommitFilter>("all");
  let onlySelected = $state(false);
  let message = $state("");
  /** v0.0.11 §2 生成输入模式：仅文件信息（默认）/ 受限差异（需回执确认）。 */
  let diffMode = $state<"metadata-only" | "limited-diff">("metadata-only");
  let receiptExpanded = $state(false);
  let selected = $state<ReadonlySet<SelectionKey>>(emptySelection());
  /** 回声防护：最后一次发给 Host 的选择签名；未匹配前忽略快照回声。 */
  let pendingEcho = $state<string | undefined>();
  let sortField = $state<SortField | undefined>();
  let sortDirection = $state<SortDirection>("asc");
  let announcement = $state("");
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

  /*
   * v0.0.10 共享列表行控制器：键盘导航、活动行焦点、窗口化与路径详情
   * 开合使用统一实现；Commit 的选择变化经 setSelected 同步 Host。
   */
  const list = useFileList<WorkbenchFileView>({
    rows: () => sortedFiles,
    rowHeight: () => rowHeight,
    virtualizeAfter,
    onPathDetailRequest: (relativePath) =>
      onAction("file/path-detail", { relativePath }),
    onActivate: (file) =>
      onAction("open-diff", { relativePath: file.relativePath }),
    onSelectAll: () =>
      setSelected(selectActionable(filteredSelectable, selected)),
    onSelectRange: (range) => {
      const next = cloneSelection(selected);
      for (const file of range) {
        if (isActionableForMode(file, MODE)) next.add(file.selectionKey);
      }
      setSelected(next);
    },
    onToggleActive: (file) => {
      // Commit：excluded/blocked 不可提交，不能勾选。
      if (canSelectIndividually(file, MODE)) toggleKey(file.selectionKey);
    },
  });
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

  // 新的路径详情结果到达时自动展开；用户可手动关闭。
  $effect(() => {
    if (pathDetail) list.markPathDetailArrived();
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
  /** v0.0.11 §6：可重试的失败项（上次读取失败/预算外的文件数）。 */
  const failedRetryCount = $derived(
    suggestion?.coverageFiles?.filter(
      (file) => file.state === "readFailed" || file.state === "budgetExcluded",
    ).length ?? 0,
  );

  /** v0.0.11 §6：只重试失败项——Host 对失败文件重新采集并下发回执。 */
  function requestRetryFailed(): void {
    if (!suggestion) return;
    onAction("commit/retry-failed-diff", { token: suggestion.token });
  }

  /** v0.0.11 §4：打开 Host 校验过的证据对应的文件差异。 */
  function openEvidence(reference: {
    candidateId: string;
    hunkId?: string;
    projectRelativePath: string;
  }): void {
    if (!suggestion) return;
    onAction("commit/open-evidence", {
      token: suggestion.token,
      candidateId: reference.candidateId,
      ...(reference.hunkId ? { hunkId: reference.hunkId } : {}),
      projectRelativePath: reference.projectRelativePath,
    });
  }

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

  /*
   * v0.0.11 §3：生成入口按输入模式分支。受限差异先请求外发回执
   * （commit/preview-receipt，不调用模型），用户确认后再经
   * commit/generate-message 携带 receiptToken 实际生成。
   */
  function requestGenerate(): void {
    if (diffMode === "limited-diff") {
      onAction("commit/preview-receipt", {
        selectedPaths: selectedPaths(),
        message,
      });
      return;
    }
    onAction("commit/generate-message", {
      selectedPaths: selectedPaths(),
      message,
      diffMode: "metadata-only",
    });
  }

  /** 确认回执：开始受限差异模型生成（Host 校验 token 与范围后调用模型）。 */
  function confirmReceiptGenerate(): void {
    const receipt = commitReceipt;
    if (!receipt) return;
    onAction("commit/generate-message", {
      selectedPaths: selectedPaths(),
      message,
      diffMode: "limited-diff",
      receiptToken: receipt.token,
    });
    commitReceipt = undefined;
  }

  /** 回执降级：不发送差异，继续仅文件信息生成。 */
  function continueMetadataOnly(): void {
    const receipt = commitReceipt;
    if (receipt) {
      onAction("commit/receipt-dismiss", { token: receipt.token });
    }
    commitReceipt = undefined;
    diffMode = "metadata-only";
    onAction("commit/generate-message", {
      selectedPaths: selectedPaths(),
      message,
      diffMode: "metadata-only",
    });
  }

  /** 放弃回执：取消后未确认前模型不会被调用。 */
  function dismissReceipt(): void {
    const receipt = commitReceipt;
    if (receipt) {
      onAction("commit/receipt-dismiss", { token: receipt.token });
    }
    commitReceipt = undefined;
  }

  const coverageLabels: Record<
    "analyzed" | "truncated" | "binary" | "readFailed" | "budgetExcluded",
    string
  > = {
    analyzed: "已分析",
    truncated: "已截断",
    binary: "二进制",
    readFailed: "读取失败",
    budgetExcluded: "预算外",
  };

  /** v0.0.11 §5 声明状态中文标签。 */
  const claimStatusLabels: Record<
    "confirmed" | "inferred" | "toConfirm",
    string
  > = {
    confirmed: "已证实",
    inferred: "推断",
    toConfirm: "待确认",
  };

  function handleMessageKeydown(event: KeyboardEvent): void {
    if (!isExplicitSubmitShortcut(event)) return;
    event.preventDefault();
    onAction("commit/preview", {
      selectedPaths: selectedPaths(),
      message,
    });
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
      <SearchInput
        bind:value={query}
        ariaLabel="筛选提交文件"
        placeholder="筛选文件…"
        compact
      />
      <ResultCount count={filteredFiles.length} />
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
      bind:element={list.element}
      onScroll={list.handleScroll}
      onKeydown={list.handleKeydown}
    >
      {#if list.visibleWindow.start > 0}<div
          style:height={`${list.visibleWindow.start * rowHeight}px`}
          aria-hidden="true"
        ></div>{/if}
      {#if pathDetail && list.detailOpen}
        <div class="path-detail-host">
          <div class="path-detail-host__bar">
            <span class="path-detail-host__target"
              >{pathDetail.relativePath}</span
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
      {#each list.visibleRows as { row: file, index: rowIndex } (file.selectionKey)}
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -- 行点击只设置活动行；键盘操作由列表容器统一处理。 -->
        <div
          class="commit-file-row"
          class:commit-file-row--blocked={file.selection === "blocked"}
          class:commit-file-row--selected={selected.has(file.selectionKey)}
          class:commit-file-row--active={list.activeIndex === rowIndex}
          role="listitem"
          tabindex="-1"
          data-row-index={rowIndex}
          onclick={() => list.markActive(rowIndex)}
        >
          <input
            type="checkbox"
            aria-label={`选择 ${displayPathOf(file)}`}
            checked={selected.has(file.selectionKey)}
            disabled={!canSelectIndividually(file, MODE)}
            onclick={(event) => {
              event.stopPropagation();
              if (event.shiftKey && list.anchorIndex >= 0) {
                const range = rangeItems(
                  sortedFiles,
                  list.anchorIndex,
                  rowIndex,
                );
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
              list.markActive(rowIndex);
            }}
          />
          <PathCell
            {file}
            selected={selected.has(file.selectionKey)}
            onOpenDiff={() =>
              onAction("open-diff", { relativePath: file.relativePath })}
            onOpenDetail={(trigger) =>
              list.requestPathDetail(file.relativePath, trigger)}
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
      {#if list.visibleWindow.end < sortedFiles.length}<div
          style:height={`${(sortedFiles.length - list.visibleWindow.end) * rowHeight}px`}
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
        <div class="generate-actions">
          <label class="generate-mode">
            <span class="generate-mode__label">生成输入</span>
            <select
              aria-label="生成输入模式"
              value={diffMode}
              onchange={(event) => {
                diffMode = (event.currentTarget as HTMLSelectElement).value as
                  "metadata-only" | "limited-diff";
              }}
            >
              <option value="metadata-only">仅文件信息</option>
              <option value="limited-diff">含差异（需确认）</option>
            </select>
          </label>
          <button class="button button--secondary" onclick={requestGenerate}>
            <span class="codicon codicon-sparkle" aria-hidden="true"></span>
            生成建议草稿
          </button>
        </div>
      </div>
      {#if messagePrivacy}<div class="privacy-note">
          <strong>外发预览</strong><span
            >{messagePrivacy.data}；最多 {messagePrivacy.fileLimit} 个文件；模型 {messagePrivacy.model}；{messagePrivacy.historyIncluded
              ? `包含 ${messagePrivacy.historyCount ?? 0} 条已脱敏历史摘要`
              : "不含历史"}。</span
          >
        </div>{/if}
      {#if diffMode === "limited-diff"}<p class="commit-suggestion__note">
          受限差异模式：生成前会先展示外发回执（数据类型、文件数、预算与
          排除项），确认后才发送脱敏差异正文；不会发送本地绝对路径、范围外
          内容或凭据。
        </p>{/if}
      {#if commitReceipt}
        <div class="commit-receipt" role="region" aria-label="受限差异外发回执">
          <div class="commit-receipt__head">
            <span class="codicon codicon-arrow-up" aria-hidden="true"></span>
            <strong>受限差异外发回执（尚未发送）</strong>
            <span class="commit-receipt__tag" role="status">等待确认</span>
          </div>
          <dl class="commit-receipt__meta">
            <div>
              <dt>任务</dt>
              <dd>提交说明（{commitReceipt.receipt.task}）</dd>
            </div>
            <div>
              <dt>模型</dt>
              <dd>{commitReceipt.receipt.model}</dd>
            </div>
            <div>
              <dt>数据类型</dt>
              <dd>{commitReceipt.receipt.dataTypes.join("、")}</dd>
            </div>
            <div>
              <dt>文件数</dt>
              <dd>{commitReceipt.receipt.files} 个已发送候选</dd>
            </div>
            <div>
              <dt>预算</dt>
              <dd>
                单文件 {commitReceipt.receipt.perFileBudget} 字符 / 总计
                {commitReceipt.receipt.totalBudget} 字符
              </dd>
            </div>
            <div>
              <dt>历史</dt>
              <dd>
                {commitReceipt.historyIncluded
                  ? `包含 ${commitReceipt.historyCount ?? 0} 条已脱敏历史摘要`
                  : "不包含"}
              </dd>
            </div>
          </dl>
          <p class="commit-receipt__coverage">
            覆盖率：已分析 {commitReceipt.coverage.analyzed} · 截断
            {commitReceipt.coverage.truncated} · 二进制
            {commitReceipt.coverage.binary} · 读取失败
            {commitReceipt.coverage.readFailed} · 预算外
            {commitReceipt.coverage.budgetExcluded}（共
            {commitReceipt.coverage.total} 个候选）
          </p>
          <button
            type="button"
            class="commit-receipt__toggle"
            aria-expanded={receiptExpanded}
            onclick={() => (receiptExpanded = !receiptExpanded)}
            >{receiptExpanded ? "收起" : "展开"}包含 / 排除文件清单</button
          >
          {#if receiptExpanded}
            <ul class="commit-receipt__files" aria-label="包含与排除文件清单">
              {#each commitReceipt.files as file (file.candidateId)}
                <li
                  class="commit-receipt__file"
                  class:commit-receipt__file--excluded={file.state !==
                    "analyzed"}
                >
                  <span>{file.projectRelativePath}</span>
                  <small
                    >{coverageLabels[file.state]}{file.reason
                      ? `（${file.reason}）`
                      : ""} · {file.charCount} 字符 / {file.hunkCount} 块</small
                  >
                </li>
              {/each}
            </ul>
          {/if}
          <p class="commit-receipt__note">
            不会发送：{commitReceipt.notSent.join("；")}。
          </p>
          <p class="commit-receipt__note">
            {commitReceipt.retentionNote}
          </p>
          <div class="commit-receipt__actions">
            <button
              type="button"
              class="button button--primary"
              onclick={confirmReceiptGenerate}>开始模型生成</button
            >
            <button
              type="button"
              class="button button--secondary"
              onclick={continueMetadataOnly}>继续仅文件信息</button
            >
            <button
              type="button"
              class="button button--secondary"
              onclick={dismissReceipt}>放弃</button
            >
          </div>
        </div>
      {/if}
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
            来源：{sourceLabels[
              suggestion.source
            ]}{#if suggestion.diffMode === "metadata-only"}
              · 生成输入仅包含文件信息与差异统计，不能证明具体行为{/if}{#if suggestion.model}
              · 模型 {suggestion.model}{/if}
          </small>
          {#if suggestion.metadataOnly}<small class="commit-suggestion__note"
              >基于文件信息生成，未读取差异正文；请结合实际改动确认。</small
            >{/if}
          {#if suggestion.diffMode === "limited-diff" && suggestion.coverage}
            <p class="commit-suggestion__note" role="status">
              差异覆盖率：已分析 {suggestion.coverage.analyzed} · 截断
              {suggestion.coverage.truncated} · 二进制
              {suggestion.coverage.binary} · 读取失败
              {suggestion.coverage.readFailed} · 预算外
              {suggestion.coverage.budgetExcluded}（共
              {suggestion.coverage.total} 个候选）。
            </p>
          {/if}
          {#if suggestion.coverageFiles && suggestion.coverageFiles.length > 0}
            <details class="commit-suggestion__coverage-files">
              <summary
                >逐文件覆盖情况（{suggestion.coverageFiles.length} 个候选）</summary
              >
              <ul aria-label="建议逐文件覆盖情况">
                {#each suggestion.coverageFiles as file (file.candidateId)}
                  <li
                    class="commit-suggestion__coverage-item"
                    class:commit-suggestion__coverage-item--failed={file.state ===
                      "readFailed" || file.state === "budgetExcluded"}
                  >
                    <span>{file.projectRelativePath}</span>
                    <small
                      >{coverageLabels[file.state]}{file.reason
                        ? `（${file.reason}）`
                        : ""} · {file.charCount} 字符 / {file.hunkCount} 块</small
                    >
                  </li>
                {/each}
              </ul>
            </details>
          {/if}
          {#if failedRetryCount > 0 && !suggestion.stale}
            <div class="commit-suggestion__retry">
              <button
                type="button"
                class="button button--secondary"
                onclick={requestRetryFailed}
                >重试失败项（{failedRetryCount}）</button
              >
              <small
                >仅重新采集上次读取失败或预算外的文件，并重新展示外发回执。</small
              >
            </div>
          {/if}
          {#if suggestion.stale}<p class="commit-suggestion__note">
              范围或候选已变化，该建议只能查看，不能直接采用；当前提交说明保持不变。
            </p>{/if}
          <pre class="commit-suggestion__body">{suggestion.message}</pre>
          {#if suggestion.claims && suggestion.claims.length > 0}
            <details class="commit-suggestion__claims" open>
              <summary>逐条说明与证据状态</summary>
              <ul aria-label="建议逐条说明">
                {#each suggestion.claims as claim, claimIndex (claimIndex)}
                  <li
                    class="commit-suggestion__claim"
                    class:commit-suggestion__claim--toConfirm={claim.status ===
                      "toConfirm"}
                  >
                    <div class="commit-suggestion__claim-head">
                      <span class="commit-suggestion__claim-status"
                        >{claimStatusLabels[claim.status]}</span
                      >
                      {#if claim.downgraded}<span
                          class="commit-suggestion__claim-downgrade"
                          title="模型标为已证实但缺少可核对证据">已降级</span
                        >{/if}
                      <span class="commit-suggestion__claim-text">
                        {claim.text}
                      </span>
                    </div>
                    {#if claim.evidence.length > 0 || claim.invalidEvidence.length > 0}
                      <ul
                        class="commit-suggestion__claim-evidence"
                        aria-label="声明证据"
                      >
                        {#each claim.evidence as reference (reference.candidateId + (reference.hunkId ?? ""))}
                          <li>
                            {reference.projectRelativePath}{#if reference.hunkId}
                              · 差异块已验证{/if}
                            <button
                              type="button"
                              class="commit-suggestion__evidence-open"
                              disabled={suggestion.stale}
                              onclick={() => openEvidence(reference)}
                              >打开差异</button
                            >
                          </li>
                        {/each}
                        {#each claim.invalidEvidence as invalid (invalid.reference.candidateId + (invalid.reference.hunkId ?? ""))}
                          <li class="commit-suggestion__claim-invalid">
                            {invalid.reference.projectRelativePath}：
                            {invalid.reason}
                          </li>
                        {/each}
                      </ul>
                    {/if}
                  </li>
                {/each}
              </ul>
            </details>
          {/if}
          {#if suggestion.evidence && suggestion.evidence.length > 0}
            <details class="commit-suggestion__evidence" open>
              <summary
                >证据引用（{suggestion.evidence.filter((item) => item.valid)
                  .length} 条有效）</summary
              >
              <ul aria-label="建议证据引用">
                {#each suggestion.evidence as item (item.reference.candidateId + (item.reference.hunkId ?? ""))}
                  <li
                    class="commit-suggestion__evidence-item"
                    class:commit-suggestion__evidence-item--invalid={!item.valid}
                  >
                    {#if item.valid}
                      <span class="codicon codicon-check" aria-hidden="true"
                      ></span>
                    {:else}
                      <span class="codicon codicon-warning" aria-hidden="true"
                      ></span>
                    {/if}
                    {item.reference
                      .projectRelativePath}{#if item.reference.hunkId}
                      · 差异块已验证{/if}
                    {#if item.valid}
                      <button
                        type="button"
                        class="commit-suggestion__evidence-open"
                        disabled={suggestion.stale}
                        onclick={() => openEvidence(item.reference)}
                        >打开差异</button
                      >
                    {/if}
                    {#if !item.valid && item.reason}<small>
                        {item.reason}
                      </small>{/if}
                  </li>
                {/each}
              </ul>
            </details>
          {/if}
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
