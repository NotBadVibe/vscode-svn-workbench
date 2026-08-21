<script lang="ts">
  import { ContextMenu } from "bits-ui";
  import type {
    ChangesSnapshot,
    HostToWebviewMessage,
    WebviewAction,
    WorkbenchFileStatus,
    WorkbenchFileView,
  } from "@protocol/workbenchProtocol";
  import { formatZhTime } from "../../i18n/formatters";
  import { fileStatusLabels } from "../../i18n/terminology";
  import FilePathDetail from "../../components/svn/FilePathDetail.svelte";
  import PathCell from "../../components/list/PathCell.svelte";
  import SortHeader from "../../components/list/SortHeader.svelte";
  import SelectionSummary from "../../components/list/SelectionSummary.svelte";
  import BulkActionBar from "../../components/list/BulkActionBar.svelte";
  import SearchInput from "../../components/list/SearchInput.svelte";
  import ResultCount from "../../components/list/ResultCount.svelte";
  import PreviewPathList from "../../components/list/PreviewPathList.svelte";
  import OperationIntentDialog from "../../components/operation/OperationIntentDialog.svelte";
  import { useFileList } from "../../components/list/useFileList.svelte";
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
  }: {
    snapshot: ChangesSnapshot;
    onAction: (action: WebviewAction, data?: Record<string, unknown>) => void;
    /** v0.0.7 路径详情结果（Host 一次性下发）。 */
    pathDetail?: Extract<
      HostToWebviewMessage,
      { type: "file/path-detail-result" }
    >["payload"];
  } = $props();

  const MODE = "changes" as const;

  let query = $state("");
  let activeStatus = $state<WorkbenchFileStatus | "all">("all");
  let onlySelected = $state(false);
  let selected = $state<ReadonlySet<SelectionKey>>(emptySelection());
  let sortField = $state<SortField | undefined>();
  let sortDirection = $state<SortDirection>("asc");
  let density = $state<ListDensity>("comfortable");
  let announcement = $state("");
  let contextFile = $state<WorkbenchFileView | undefined>();
  /** 行菜单受控打开状态（Shift+F10 / Menu 键由键盘导航触发）。 */
  let rowMenuOpen = $state(false);
  let commitDraft = $state("");
  let synchronizedCommitDraft = $state("");
  let draftExpanded = $state(false);
  let destructiveConfirmed = $state(false);
  let operationPreviewToken = $state<string | undefined>();
  // v0.0.14 批次 D：文件操作意向单（还原/删除等）
  let fileOpIntentOpen = $state(false);
  let fileOpTriggerEl = $state<HTMLElement | null>(null);
  const fileOpIntent = $derived.by(() => {
    const preview = snapshot.operationPreview;
    if (!preview) return undefined;
    const count = preview.paths.length;
    const actionLabel = operationLabels[preview.operation] ?? preview.operation;
    const title = `${actionLabel} ${count} 个文件`;
    const summary = `${title} · 执行前将重新校验范围与候选状态`;
    const stale = previewSelectionOutOfSync;
    return {
      token: preview.token,
      kind: "file-operation" as const,
      title,
      summary,
      paths: preview.paths,
      createdAt: new Date().toISOString(),
      canExecute:
        preview.canExecute &&
        !stale &&
        (!preview.destructive || destructiveConfirmed),
      issues: preview.issues,
      commands: [preview.command],
      stale,
    };
  });

  // 列表偏好按模块本地保存（workspace 容器 + module），不跨模块串用。
  const savedPreferences = loadListPreferences("changes");
  sortField = savedPreferences.sortField;
  sortDirection = savedPreferences.sortDirection ?? "asc";
  density = savedPreferences.density ?? "comfortable";

  const rowHeight = $derived(density === "compact" ? 36 : 48);
  const virtualizeAfter = 300;

  const keyToPath = $derived(buildKeyPathMap(snapshot.files));
  const fileByKey = $derived(
    new Map(snapshot.files.map((file) => [file.selectionKey, file])),
  );

  const filteredFiles = $derived(
    snapshot.files.filter((file) => {
      if (activeStatus !== "all" && file.status !== activeStatus) return false;
      if (onlySelected && !selected.has(file.selectionKey)) return false;
      return matchesFileQuery(file, query);
    }),
  );

  // 排序作用于完整筛选数据集，不遍历已挂载 DOM；默认顺序 = Host 快照顺序。
  const sortedFiles = $derived(
    sortField
      ? sortFileViews(filteredFiles, {
          field: sortField,
          direction: sortDirection,
        })
      : filteredFiles,
  );

  const filteredSelectable = $derived(toSelectableItems(sortedFiles, MODE));
  const triState = $derived(computeTriState(filteredSelectable, selected));
  const actionableCount = $derived(actionableKeys(filteredSelectable).size);
  const hiddenCount = $derived(
    hiddenSelectionKeys(toSelectableItems(filteredFiles, MODE), selected).size,
  );

  /**
   * Changes → Commit 动作资格：excluded/blocked 可在此逐项选择（非提交
   * 动作），但不得进入“检查并提交所选”。含不可提交项时按钮禁用并提示，
   * 不静默过滤；按钮数量 = 可提交数量，payload 与显示一致。
   */
  const commitBlockedSelectedCount = $derived(
    [...selected].filter((key) => {
      const file = fileByKey.get(key);
      return (
        file === undefined ||
        file.selection === "excluded" ||
        file.selection === "blocked"
      );
    }).length,
  );
  const committableSelectedCount = $derived(
    selected.size - commitBlockedSelectedCount,
  );

  // 刷新合法交集：只保留新快照中仍存在且未变 blocked 的选择；新文件不自动加入。
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
        retained: file.selection !== "blocked",
        removalReason:
          file.selection === "blocked" ? "状态已变为阻止项" : undefined,
      })),
    );
    if (outcome.removed.length > 0) {
      selected = outcome.selected;
      const reasons = [
        ...new Set(outcome.removed.map((item) => item.reason)),
      ].join("；");
      announcement = `刷新后移除 ${outcome.removed.length} 个失效选择（${reasons}）。`;
    }
  });

  /*
   * v0.0.10 共享列表行控制器：键盘导航、活动行焦点、窗口化与路径详情
   * 开合使用统一实现；选择语义经回调接回本模块的 selectionCore 运算。
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
      (selected = selectActionable(filteredSelectable, selected)),
    onSelectRange: (range) => {
      const next = cloneSelection(selected);
      for (const file of range) {
        if (isActionableForMode(file, MODE)) next.add(file.selectionKey);
      }
      selected = next;
    },
    onToggleActive: (file) => {
      if (file.selection !== "blocked") toggleKey(file.selectionKey);
    },
    onOpenRowMenu: (file) => {
      contextFile = file;
      rowMenuOpen = true;
      return true;
    },
  });

  $effect(() => {
    query;
    activeStatus;
    onlySelected;
    list.resetNavigation();
  });

  $effect(() => {
    const next = snapshot.commitDraft;
    if (commitDraft === synchronizedCommitDraft) commitDraft = next;
    synchronizedCommitDraft = next;
    // 脏草稿始终可见。
    if (next.trim().length > 0) draftExpanded = true;
  });

  $effect(() => {
    const token = snapshot.operationPreview?.token;
    if (token !== operationPreviewToken) {
      operationPreviewToken = token;
      destructiveConfirmed = false;
    }
  });

  // 新的路径详情结果到达时自动展开；关闭后恢复触发按钮焦点。
  $effect(() => {
    if (pathDetail) list.markPathDetailArrived();
  });

  const selectionLabels = {
    selected: "建议提交",
    needsReview: "需要确认",
    excluded: "已排除",
    blocked: "不可提交",
  } as const;

  function selectedPaths(): string[] {
    return pathsFromKeys(selected, keyToPath);
  }

  function selectionSignature(paths: readonly string[]): string {
    return [...paths].sort().join("\n");
  }

  /**
   * 本地选择改变后旧操作预览不可继续执行（Host 也会按 token 复验）。
   * 仅当存在批量选择时比对：单文件右键操作（未选任何文件）不依赖列表
   * 选择，选择状态变化不影响其合法性。
   */
  const previewSelectionOutOfSync = $derived(
    selected.size > 0 &&
      snapshot.operationPreview !== undefined &&
      selectionSignature(snapshot.operationPreview.paths) !==
        selectionSignature(selectedPaths()),
  );

  function toggleKey(key: SelectionKey): void {
    const next = cloneSelection(selected);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    selected = next;
  }

  function selectRecommended(): void {
    selected = mergeRecommendedSelection(filteredSelectable, selected);
  }

  function clearHidden(): void {
    selected = clearHiddenSelection(
      toSelectableItems(filteredFiles, MODE),
      selected,
    );
  }

  function toggleSort(field: SortField): void {
    if (sortField === field) {
      sortDirection = sortDirection === "asc" ? "desc" : "asc";
    } else {
      sortField = field;
      sortDirection = "asc";
    }
    saveListPreferences("changes", {
      sortField,
      sortDirection,
      density,
    });
  }

  function resetSort(): void {
    sortField = undefined;
    sortDirection = "asc";
    saveListPreferences("changes", { sortDirection, density });
  }

  function toggleDensity(): void {
    density = density === "comfortable" ? "compact" : "comfortable";
    saveListPreferences("changes", { sortField, sortDirection, density });
  }

  function operationPaths(file: WorkbenchFileView): string[] {
    return selected.has(file.selectionKey) && selected.size > 0
      ? selectedPaths()
      : [file.relativePath];
  }

  function afterContextMenuClose(callback: () => void): void {
    window.setTimeout(callback, 0);
  }

  function preview(
    operation: "add" | "remove" | "revert" | "lock" | "unlock" | "ignore",
    file: WorkbenchFileView,
    ignoreMode?: "directory" | "repository",
  ): void {
    onAction("changes/preview-operation", {
      operation,
      paths: operationPaths(file),
      ignoreMode,
    });
  }

  const operationLabels = {
    add: "加入版本控制",
    remove: "标记删除",
    revert: "还原本地修改",
    lock: "锁定文件",
    unlock: "解锁文件",
    ignore: "添加到忽略列表",
  };
</script>

<section class="feature-layout">
  <div class="feature-toolbar">
    <SearchInput
      bind:value={query}
      ariaLabel="筛选变更文件"
      placeholder="筛选文件…"
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
        <option value="recommendation">按选择建议</option>
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

  {#if snapshot.feedback}<div class="notice notice--success" role="status">
      {snapshot.feedback}
    </div>{/if}

  <section class="shared-draft" aria-labelledby="shared-commit-draft-title">
    <div>
      <span class="eyebrow">当前范围共享草稿</span>
      <h2 id="shared-commit-draft-title">提交草稿</h2>
      <p>
        与“智能提交”使用同一份扩展主机草稿；切换模块不会生成第二份提交说明。
      </p>
      <button
        class="button button--secondary"
        aria-expanded={draftExpanded}
        onclick={() => (draftExpanded = !draftExpanded)}
        >{draftExpanded ? "折叠草稿" : "展开草稿"}</button
      >
    </div>
    {#if draftExpanded}
      <textarea
        bind:value={commitDraft}
        aria-label="共享提交草稿"
        rows="3"
        placeholder="先记录本次提交意图…"></textarea>
      <div class="toolbar-actions">
        <button
          class="button button--secondary"
          disabled={commitDraft === snapshot.commitDraft}
          onclick={() =>
            onAction("commit/update-draft", { message: commitDraft })}
          >保存共享草稿</button
        >
      </div>
    {/if}
  </section>

  <div class="status-filters" aria-label="状态筛选">
    <button
      class:active={activeStatus === "all"}
      onclick={() => (activeStatus = "all")}
      >全部 {snapshot.files.length}</button
    >
    {#each Object.entries(snapshot.summary) as [status, count] (status)}
      <button
        class:active={activeStatus === status}
        onclick={() => (activeStatus = status as WorkbenchFileStatus)}
      >
        {fileStatusLabels[status as WorkbenchFileStatus]}
        {count}
      </button>
    {/each}
  </div>

  <SelectionSummary
    selectedCount={selected.size}
    {actionableCount}
    {hiddenCount}
    {onlySelected}
    {announcement}
    onToggleOnlySelected={() => (onlySelected = !onlySelected)}
    onClearHidden={clearHidden}
    onClearAll={() => (selected = emptySelection())}
    onSelectRecommended={selectRecommended}
  />

  <div class="table-card">
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
    <div role="table" aria-label="变更文件列表" class="table-head-wrap">
      <div role="rowgroup">
        <div class="table-header table-header--grid" role="row">
          <span class="table-header__select" role="columnheader">
            <input
              type="checkbox"
              aria-label={`选择当前筛选可操作项（${actionableCount}）`}
              checked={triState === "all"}
              indeterminate={triState === "partial"}
              disabled={actionableCount === 0}
              onchange={() =>
                (selected = toggleActionable(filteredSelectable, selected))}
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
            label="选择建议"
            field="recommendation"
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
    {#if filteredFiles.length === 0}
      <div class="empty-state">
        <span class="codicon codicon-check-all" aria-hidden="true"></span>
        <strong
          >{snapshot.files.length === 0
            ? "工作副本很干净"
            : onlySelected
              ? "已选文件不在当前筛选中"
              : "没有匹配的文件"}</strong
        >
        <p>
          {snapshot.files.length === 0
            ? "当前范围没有本地修改。"
            : onlySelected
              ? "关闭“只看已选”或调整筛选条件。"
              : "调整搜索词或状态筛选，或清除搜索后重试。"}
        </p>
      </div>
    {:else}
      <ContextMenu.Root
        open={rowMenuOpen}
        onOpenChange={(value) => (rowMenuOpen = value)}
      >
        <ContextMenu.Trigger>
          {#snippet child({ props })}
            <!-- svelte-ignore a11y_no_noninteractive_tabindex -- 文件列表需要键盘焦点，以支持 PageUp/PageDown 和 End 滚动。 -->
            <div
              {...props}
              class="file-list scroll-region"
              class:file-list--virtual={list.isVirtualized}
              class:file-list--compact={density === "compact"}
              role="list"
              aria-label="SVN 变更文件"
              tabindex="0"
              data-scroll-region
              bind:this={list.element}
              onscroll={list.handleScroll}
              onkeydown={list.handleKeydown}
            >
              <div
                class:file-list-inner--virtual={list.isVirtualized}
                style:height={list.isVirtualized
                  ? `${sortedFiles.length * rowHeight}px`
                  : undefined}
              >
                {#each list.visibleRows as { row: file, index } (file.selectionKey)}
                  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -- 行点击只设置活动行；键盘操作由列表容器统一处理。 -->
                  <div
                    class="file-row"
                    class:file-row--virtual={list.isVirtualized}
                    class:file-row--blocked={file.selection === "blocked"}
                    class:file-row--selected={selected.has(file.selectionKey)}
                    class:file-row--active={list.activeIndex === index}
                    style:transform={list.isVirtualized
                      ? `translateY(${index * rowHeight}px)`
                      : undefined}
                    style:height={list.isVirtualized
                      ? `${rowHeight}px`
                      : undefined}
                    role="listitem"
                    aria-posinset={index + 1}
                    aria-setsize={sortedFiles.length}
                    data-row-index={index}
                    tabindex="-1"
                    oncontextmenu={() => (contextFile = file)}
                    onclick={() => list.markActive(index)}
                  >
                    <input
                      type="checkbox"
                      aria-label={`选择 ${displayPathOf(file)}`}
                      checked={selected.has(file.selectionKey)}
                      disabled={!canSelectIndividually(file, MODE)}
                      onclick={(event) => {
                        event.stopPropagation();
                        // Shift+Click 连续选择（只加入可操作项）。
                        if (event.shiftKey && list.anchorIndex >= 0) {
                          const range = rangeItems(
                            sortedFiles,
                            list.anchorIndex,
                            index,
                          );
                          const next = cloneSelection(selected);
                          for (const item of range) {
                            if (isActionableForMode(item, MODE)) {
                              next.add(item.selectionKey);
                            }
                          }
                          selected = next;
                        } else {
                          toggleKey(file.selectionKey);
                        }
                        list.markActive(index);
                      }}
                    />
                    <span class="file-path" title={file.relativePath}>
                      <PathCell
                        {file}
                        selected={selected.has(file.selectionKey)}
                        onOpenDiff={() =>
                          onAction("open-diff", {
                            relativePath: file.relativePath,
                          })}
                        onOpenDetail={(trigger) =>
                          list.requestPathDetail(file.relativePath, trigger)}
                      />
                    </span>
                    <span class={`status-badge status-badge--${file.status}`}
                      >{fileStatusLabels[file.status]}</span
                    >
                    <span class="selection-note" title={file.reason}
                      >{file.reason ??
                        (file.selection
                          ? selectionLabels[file.selection]
                          : "—")}</span
                    >
                    <span class="file-row__ownership"
                      >{file.projectName ?? file.repositoryName ?? "—"}</span
                    >
                    <button
                      class="icon-button icon-button--small"
                      aria-label={`查看 ${file.relativePath} 差异`}
                      onclick={() =>
                        onAction("open-diff", {
                          relativePath: file.relativePath,
                        })}
                      ><span class="codicon codicon-diff" aria-hidden="true"
                      ></span></button
                    >
                  </div>
                {/each}
              </div>
            </div>
          {/snippet}
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content
            class="context-menu"
            aria-label={`${contextFile?.relativePath ?? "文件"} 操作菜单`}
          >
            {#if contextFile}
              {#if selected.has(contextFile.selectionKey) && selected.size > 1}
                <div class="context-menu__hint" role="note">
                  对 {selected.size} 个已选文件操作
                </div>
              {/if}
              <ContextMenu.Item
                class="context-menu-item"
                onSelect={() =>
                  afterContextMenuClose(() =>
                    onAction("open-diff", {
                      relativePath: contextFile?.relativePath,
                    }),
                  )}
                ><span class="codicon codicon-diff" aria-hidden="true"
                ></span>查看差异</ContextMenu.Item
              >
              <ContextMenu.Item
                class="context-menu-item"
                onSelect={() =>
                  afterContextMenuClose(() =>
                    onAction("open-module", {
                      moduleId: "history",
                      taskId: "history/revisions",
                    }),
                  )}
                ><span class="codicon codicon-history" aria-hidden="true"
                ></span>查看历史</ContextMenu.Item
              >
              <ContextMenu.Item
                class="context-menu-item"
                disabled={contextFile.status === "unversioned"}
                onSelect={() =>
                  afterContextMenuClose(() =>
                    onAction("changes/copy-url", {
                      relativePath: contextFile?.relativePath,
                    }),
                  )}
                ><span class="codicon codicon-link" aria-hidden="true"
                ></span>复制仓库 URL</ContextMenu.Item
              >
              <ContextMenu.Item
                class="context-menu-item"
                disabled={contextFile.status === "unversioned"}
                onSelect={() =>
                  afterContextMenuClose(() =>
                    onAction("changes/show-in-repository", {
                      relativePath: contextFile?.relativePath,
                    }),
                  )}
                ><span class="codicon codicon-repo" aria-hidden="true"
                ></span>在仓库浏览器中显示</ContextMenu.Item
              >
              <ContextMenu.Separator class="context-menu-separator" />
              {#if contextFile.status === "unversioned"}
                <ContextMenu.Item
                  class="context-menu-item"
                  onSelect={() =>
                    afterContextMenuClose(() => preview("add", contextFile!))}
                  ><span class="codicon codicon-add" aria-hidden="true"
                  ></span>加入版本控制</ContextMenu.Item
                >
                <ContextMenu.Item
                  class="context-menu-item"
                  onSelect={() =>
                    afterContextMenuClose(() =>
                      preview("ignore", contextFile!, "directory"),
                    )}
                  ><span class="codicon codicon-eye-closed" aria-hidden="true"
                  ></span>目录忽略（svn:ignore）</ContextMenu.Item
                >
                <ContextMenu.Item
                  class="context-menu-item"
                  onSelect={() =>
                    afterContextMenuClose(() =>
                      preview("ignore", contextFile!, "repository"),
                    )}
                  ><span class="codicon codicon-repo" aria-hidden="true"
                  ></span>仓库继承忽略（svn:global-ignores）</ContextMenu.Item
                >
              {:else}
                <ContextMenu.Item
                  class="context-menu-item"
                  disabled={contextFile.status === "conflicted"}
                  onSelect={() =>
                    afterContextMenuClose(() => preview("lock", contextFile!))}
                  ><span class="codicon codicon-lock" aria-hidden="true"
                  ></span>加锁</ContextMenu.Item
                >
                <ContextMenu.Item
                  class="context-menu-item"
                  disabled={contextFile.status === "conflicted"}
                  onSelect={() =>
                    afterContextMenuClose(() =>
                      preview("unlock", contextFile!),
                    )}
                  ><span class="codicon codicon-unlock" aria-hidden="true"
                  ></span>解锁</ContextMenu.Item
                >
                <ContextMenu.Item
                  class="context-menu-item context-menu-item--danger"
                  disabled={contextFile.status === "conflicted"}
                  onSelect={() =>
                    afterContextMenuClose(() =>
                      preview("revert", contextFile!),
                    )}
                  ><span class="codicon codicon-discard" aria-hidden="true"
                  ></span>还原本地变更</ContextMenu.Item
                >
                <ContextMenu.Item
                  class="context-menu-item context-menu-item--danger"
                  disabled={contextFile.status === "conflicted"}
                  onSelect={() =>
                    afterContextMenuClose(() =>
                      preview("remove", contextFile!),
                    )}
                  ><span class="codicon codicon-trash" aria-hidden="true"
                  ></span>标记为删除</ContextMenu.Item
                >
              {/if}
            {/if}
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>
    {/if}
    <BulkActionBar summary={`已选 ${selected.size}`}>
      <button
        class="button button--secondary"
        disabled={selected.size === 0}
        onclick={() =>
          onAction("open-module", {
            moduleId: "changelists",
            taskId: "changelists/manage",
            selectedPaths: selectedPaths(),
          })}
      >
        <span class="codicon codicon-list-tree" aria-hidden="true"></span>
        加入变更集（{selected.size}）
      </button>
      {#if commitBlockedSelectedCount > 0}
        <span class="bulk-action-notice" role="status"
          >有 {commitBlockedSelectedCount} 个所选文件不可提交，请取消选择后继续</span
        >
      {/if}
      <button
        class="button button--primary"
        disabled={selected.size === 0 || commitBlockedSelectedCount > 0}
        title={selected.size === 0
          ? "先选择至少 1 个文件"
          : commitBlockedSelectedCount > 0
            ? "所选文件包含不可提交项"
            : undefined}
        onclick={() =>
          onAction("open-module", {
            moduleId: "commit",
            taskId: "commit/compose",
            selectedPaths: selectedPaths(),
          })}
      >
        检查并提交所选（{committableSelectedCount}）
      </button>
      <button
        class="button button--secondary"
        onclick={() =>
          onAction("open-module", {
            moduleId: "commit",
            taskId: "commit/compose",
          })}
      >
        检查当前范围并提交（{snapshot.files.length}）
      </button>
    </BulkActionBar>
  </div>
  <footer class="feature-footer">
    <span>更新于 {formatZhTime(snapshot.refreshedAt)}</span>
    {#if selected.size === 0}
      <span>先选择至少 1 个文件再进行批量操作</span>
    {/if}
  </footer>
  {#if snapshot.operationPreview}
    <div
      class="operation-preview scroll-region"
      role="dialog"
      aria-label="SVN 文件操作预览"
      tabindex="0"
      data-scroll-region
    >
      <div class="section-heading">
        <div>
          <span class="eyebrow">操作确认</span>
          <h2>
            {operationLabels[snapshot.operationPreview.operation]}{snapshot
              .operationPreview.operation === "ignore"
              ? ` · ${snapshot.operationPreview.ignoreMode === "repository" ? "仓库继承" : "当前目录"}`
              : ""}
          </h2>
        </div>
        <span class="status-badge"
          >{snapshot.operationPreview.paths.length} 个文件</span
        >
      </div>
      {#each snapshot.operationPreview.consequences as item, consequenceIndex (consequenceIndex)}<p
        >
          <span class="codicon codicon-warning" aria-hidden="true"></span>{item}
        </p>{/each}
      <div
        class={`notice ${snapshot.operationPreview.destructive ? "notice--warning" : ""}`}
      >
        <span class="codicon codicon-history" aria-hidden="true"></span><span
          ><strong>可恢复性：</strong>{snapshot.operationPreview
            .recoverability}</span
        >
      </div>
      <details>
        <summary>查看文件与命令</summary>
        <!-- v0.0.10：预览路径可搜索、复制与查看详情；不可勾选改范围。 -->
        <PreviewPathList
          paths={snapshot.operationPreview.paths}
          label="操作文件清单"
          {onAction}
          {pathDetail}
        />
        <code>{snapshot.operationPreview.command}</code>
      </details>
      {#each snapshot.operationPreview.issues as issue, issueIndex (issueIndex)}<div
          class="notice notice--error"
        >
          {issue}
        </div>{/each}
      {#if previewSelectionOutOfSync}
        <div class="notice notice--warning" role="status">
          选择已变化，旧预览已失效；请重新预览后再执行。
        </div>
      {/if}
      {#if snapshot.operationPreview.destructive}<label
          class="destructive-confirm"
          ><input type="checkbox" bind:checked={destructiveConfirmed} /><span
            >我已逐项核对文件清单，并理解未提交内容可能无法从 SVN 恢复。</span
          ></label
        >{/if}
      <button
        class="button button--primary commit-button"
        disabled={!snapshot.operationPreview.canExecute ||
          previewSelectionOutOfSync ||
          (snapshot.operationPreview.destructive && !destructiveConfirmed)}
        onclick={(event) => {
          fileOpTriggerEl = event.currentTarget as HTMLElement;
          fileOpIntentOpen = true;
        }}>确认{operationLabels[snapshot.operationPreview.operation]}</button
      >
      <OperationIntentDialog
        intent={fileOpIntent}
        open={fileOpIntentOpen && Boolean(fileOpIntent)}
        confirmLabel={`确认${snapshot.operationPreview ? operationLabels[snapshot.operationPreview.operation] : ""}（${fileOpIntent?.paths.length ?? 0}）`}
        cancelLabel="取消"
        triggerElement={fileOpTriggerEl}
        {onAction}
        {pathDetail}
        onConfirm={(token) => {
          fileOpIntentOpen = false;
          onAction("changes/execute-operation", { previewToken: token });
        }}
        onCancel={() => (fileOpIntentOpen = false)}
      />
    </div>
  {/if}
</section>
