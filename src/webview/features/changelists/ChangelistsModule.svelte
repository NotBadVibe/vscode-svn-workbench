<script lang="ts">
  import type {
    ChangelistGroupFileView,
    ChangelistsSnapshot,
    HostToWebviewMessage,
    WebviewAction,
    WorkbenchFileStatus,
  } from "@protocol/workbenchProtocol";
  import ScrollArea from "../../components/ui/ScrollArea.svelte";
  // 中文注释：V017-C T6——模块主区落点（挂载聚焦一次，刷新不抢焦点）。
  import { focusOnMount } from "../../components/ui/focusOnMount";
  import SearchInput from "../../components/list/SearchInput.svelte";
  import ResultCount from "../../components/list/ResultCount.svelte";
  import PathCell from "../../components/list/PathCell.svelte";
  import SelectionSummary from "../../components/list/SelectionSummary.svelte";
  import BulkActionBar from "../../components/list/BulkActionBar.svelte";
  import FilePathDetail from "../../components/svn/FilePathDetail.svelte";
  import { useFileList } from "../../components/list/useFileList.svelte";
  import {
    FILE_STATUS_ORDER,
    matchesFileQuery,
    rangeItems,
  } from "../../components/list/listModel";
  import { naturalCompare } from "../../../selection/selectionSort";
  import type {
    SortDirection,
    SortField,
  } from "../../../selection/selectionSort";
  import {
    actionableKeys,
    clearHiddenSelection,
    emptySelection,
    hiddenSelectionKeys,
    selectActionable,
    type SelectableItem,
    type SelectionKey,
  } from "../../../selection/selectionCore";
  import { refreshSelectionSet } from "../../../selection/selectionRefresh";
  import { cloneSelection } from "../../app/fileSelection";
  import {
    loadListPreferences,
    saveListPreferences,
  } from "../../app/listPreferences";
  import { SvelteMap, SvelteSet } from "svelte/reactivity";
  import OperationIntentDialog from "../../components/operation/OperationIntentDialog.svelte";
  import TaskEmptyState from "../../components/task/TaskEmptyState.svelte";
  import AssistancePanel from "../../components/assistance/AssistancePanel.svelte";
  import type {
    AssistanceActionItem,
    AssistanceSourceState,
  } from "../../components/assistance/assistanceTypes";
  import {
    changelistAssistanceLabels,
    fileStatusLabels,
    sourceLabels,
    taskStateCopy,
  } from "../../i18n/terminology";

  /*
   * v0.0.10 跨模块列表迁移：变更集与未分组文件复用 v0.0.8 共享底座
   * （搜索、自然排序、多选、Shift 连续选择、选择当前筛选、键盘导航与
   * 路径详情）。AI/本地建议保持有意顺序，不套用文件排序；移入/移出
   * 继续经过 Host 预览与确认令牌。
   */

  let {
    snapshot,
    onAction,
    pathDetail,
    changelistReceipt,
  }: {
    snapshot: ChangelistsSnapshot;
    onAction: (action: WebviewAction, data?: Record<string, unknown>) => void;
    /** v0.0.10：路径详情结果（Host 一次性下发）。 */
    pathDetail?: Extract<
      HostToWebviewMessage,
      { type: "file/path-detail-result" }
    >["payload"];
    /** v0.0.12 批次 B：语义拆分外发回执（changelist/receipt 一次性）。 */
    changelistReceipt?: Extract<
      HostToWebviewMessage,
      { type: "changelist/receipt" }
    >["payload"];
  } = $props();

  type ChangelistSortField = Extract<SortField, "path" | "status">;

  let name = $state("");
  let applyPaths = $state<string[]>([]);
  let query = $state("");
  let onlySelected = $state(false);
  let sortField = $state<ChangelistSortField | undefined>();
  let sortDirection = $state<SortDirection>("asc");
  let announcement = $state("");
  let selected = $state<ReadonlySet<SelectionKey>>(emptySelection());
  let collapsedGroups = new SvelteSet<string>();

  const savedPreferences = loadListPreferences("changelists");
  sortField =
    savedPreferences.sortField === "path" ||
    savedPreferences.sortField === "status"
      ? savedPreferences.sortField
      : undefined;
  sortDirection = savedPreferences.sortDirection ?? "asc";

  interface ListSection {
    key: string;
    kind: "group" | "unassigned";
    name: string;
    entries: ChangelistGroupFileView[];
    /** 展开节内首行在扁平行序列中的起始索引。 */
    start: number;
    totalCount: number;
    /** 筛选命中数量（折叠时也可显示）。 */
    matchedCount: number;
  }

  /** 状态在产品优先级表中的位置；不在表内（含 unknown）恒排末尾。 */
  function statusOrder(status: WorkbenchFileStatus): number {
    const order: readonly string[] = FILE_STATUS_ORDER;
    return order.indexOf(status);
  }

  function sortEntries(
    entries: ChangelistGroupFileView[],
  ): ChangelistGroupFileView[] {
    if (!sortField) return entries;
    return [...entries].sort((left, right) => {
      if (sortField === "status") {
        const leftOrder = left.status
          ? statusOrder(left.status)
          : FILE_STATUS_ORDER.length;
        const rightOrder = right.status
          ? statusOrder(right.status)
          : FILE_STATUS_ORDER.length;
        if (leftOrder !== rightOrder) {
          return sortDirection === "asc"
            ? leftOrder - rightOrder
            : rightOrder - leftOrder;
        }
      }
      const cmp = naturalCompare(left.relativePath, right.relativePath);
      return sortDirection === "asc" ? cmp : -cmp;
    });
  }

  /** 全部条目（分组 + 未分组）按筛选与排序组织成节；折叠的分组不渲染。 */
  const sections = $derived.by(() => {
    const filterEntry = (entry: ChangelistGroupFileView): boolean => {
      if (
        onlySelected &&
        (!entry.selectionKey || !selected.has(entry.selectionKey))
      ) {
        return false;
      }
      return matchesFileQuery(entry, query);
    };
    const result: ListSection[] = [];
    let start = 0;
    for (const group of snapshot.groups) {
      const matched = group.files.filter(filterEntry);
      const collapsed = collapsedGroups.has(group.name);
      const entries = collapsed ? [] : sortEntries(matched);
      result.push({
        key: `group:${group.name}`,
        kind: "group",
        name: group.name,
        entries,
        start,
        totalCount: group.files.length,
        matchedCount: matched.length,
      });
      start += entries.length;
    }
    const unassigned = snapshot.unassigned.filter(filterEntry);
    const unassignedEntries = sortField ? sortEntries(unassigned) : unassigned;
    result.push({
      key: "unassigned",
      kind: "unassigned",
      name: "未分组",
      entries: unassignedEntries,
      start,
      totalCount: snapshot.unassigned.length,
      matchedCount: unassigned.length,
    });
    return result;
  });

  /** 展开节内的扁平行序列（键盘导航的活动行索引空间）。 */
  const allRows = $derived(sections.flatMap((section) => section.entries));
  const matchedCount = $derived(allRows.length);

  const pathByKey = $derived.by(() => {
    const map = new SvelteMap<SelectionKey, string>();
    for (const entry of allEntries()) {
      if (entry.selectionKey) map.set(entry.selectionKey, entry.relativePath);
    }
    return map;
  });

  /** 不受筛选影响的全量条目（隐藏选择计数与刷新交集使用）。 */
  function allEntries(): ChangelistGroupFileView[] {
    return [
      ...snapshot.groups.flatMap((group) => group.files),
      ...snapshot.unassigned,
    ];
  }

  function toSelectable(
    entries: readonly ChangelistGroupFileView[],
  ): SelectableItem[] {
    return entries.flatMap((entry) =>
      entry.selectionKey
        ? [
            {
              key: entry.selectionKey,
              actionable: true,
              blocked: false,
              excluded: false,
              needsReview: false,
              recommended: false,
            },
          ]
        : [],
    );
  }

  const filteredSelectable = $derived(toSelectable(allRows));
  const actionableCount = $derived(actionableKeys(filteredSelectable).size);
  const hiddenCount = $derived(
    hiddenSelectionKeys(toSelectable(allEntries()), selected).size,
  );

  /** 已选且属于某个变更集的路径（移出动作的作用范围）。 */
  const assignedPathSet = $derived(
    new Set(
      snapshot.groups.flatMap((group) =>
        group.files.map((file) => file.relativePath),
      ),
    ),
  );
  const selectedPaths = $derived(
    [...selected]
      .flatMap((key) => {
        const path = pathByKey.get(key);
        return path ? [path] : [];
      })
      .sort(),
  );
  const selectedAssignedPaths = $derived(
    selectedPaths.filter((path) => assignedPathSet.has(path)),
  );

  // 快照刷新：只保留仍存在的选择；消失的文件说明原因并移除。
  let lastEntries: ChangelistGroupFileView[] | undefined;
  $effect(() => {
    const entries = allEntries();
    if (entries === lastEntries) return;
    lastEntries = entries;
    if (selected.size === 0) return;
    const outcome = refreshSelectionSet(
      selected,
      allEntries().flatMap((entry) =>
        entry.selectionKey ? [{ key: entry.selectionKey, retained: true }] : [],
      ),
    );
    if (outcome.removed.length > 0) {
      selected = outcome.selected;
      const reasons = [
        ...new Set(
          outcome.removed.map((item) => item.reason ?? "文件已不在当前范围"),
        ),
      ].join("；");
      announcement = `刷新后移除 ${outcome.removed.length} 个失效选择（${reasons}）。`;
    }
  });
  // v0.0.13：会话共享选择带入（已带入 N 个文件），首次加载时若本地无选择则同步 preselected
  $effect(() => {
    const preselected = snapshot.preselected;
    if (!preselected || selected.size > 0) return;
    const keyByPath = new Map(
      allEntries().flatMap((e) =>
        e.selectionKey ? ([[e.relativePath, e.selectionKey]] as const) : [],
      ),
    );
    const next = new SvelteSet<SelectionKey>();
    for (const p of preselected.paths) {
      const k = keyByPath.get(p);
      if (k) next.add(k);
    }
    if (next.size > 0) selected = next as unknown as ReadonlySet<SelectionKey>;
  });

  const list = useFileList<ChangelistGroupFileView>({
    rows: () => allRows,
    rowHeight: () => 44,
    onPathDetailRequest: (relativePath) =>
      onAction("file/path-detail", { relativePath }),
    onActivate: (entry) =>
      onAction("open-diff", { relativePath: entry.relativePath }),
    onSelectAll: () =>
      (selected = selectActionable(filteredSelectable, selected)),
    onSelectRange: (range) => {
      const next = cloneSelection(selected);
      for (const entry of range) {
        if (entry.selectionKey) next.add(entry.selectionKey);
      }
      selected = next;
    },
    onToggleActive: (entry) => {
      if (entry.selectionKey) toggleKey(entry.selectionKey);
    },
  });

  $effect(() => {
    query;
    onlySelected;
    list.resetNavigation();
  });

  // 新的路径详情结果到达时自动展开；关闭后恢复触发按钮焦点。
  $effect(() => {
    if (pathDetail) list.markPathDetailArrived();
  });

  function toggleKey(key: SelectionKey): void {
    const next = cloneSelection(selected);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    selected = next;
  }

  function toggleCollapse(groupName: string): void {
    if (collapsedGroups.has(groupName)) {
      collapsedGroups.delete(groupName);
    } else {
      collapsedGroups.add(groupName);
    }
  }

  function toggleSort(field: ChangelistSortField): void {
    if (sortField === field) {
      sortDirection = sortDirection === "asc" ? "desc" : "asc";
    } else {
      sortField = field;
      sortDirection = "asc";
    }
    saveListPreferences("changelists", { sortField, sortDirection });
  }

  function resetSort(): void {
    sortField = undefined;
    sortDirection = "asc";
    saveListPreferences("changelists", { sortDirection });
  }

  function useSuggestion(id: string): void {
    const suggestion = snapshot.suggestions.find((item) => item.id === id);
    if (!suggestion) return;
    name = sanitizeName(suggestion.title);
    applyPaths = [...suggestion.paths];
  }

  /** v0.0.12 批次 B：语义拆分（先展示受限差异回执，确认后调用模型）。 */
  function requestSemanticSplit(): void {
    onAction("changelist/preview-receipt", {});
  }

  function confirmSemanticSplit(): void {
    if (!changelistReceipt) return;
    onAction("changelist/run-semantic", {
      receiptToken: changelistReceipt.token,
    });
    changelistReceipt = undefined;
  }

  function continueMetadataSplit(): void {
    const receipt = changelistReceipt;
    if (receipt) {
      onAction("changelist/receipt-dismiss", { token: receipt.token });
    }
    changelistReceipt = undefined;
    onAction("changelist/suggest", { mode: "metadata" });
  }

  function dismissSplitReceipt(): void {
    const receipt = changelistReceipt;
    if (receipt) {
      onAction("changelist/receipt-dismiss", { token: receipt.token });
    }
    changelistReceipt = undefined;
  }

  let receiptExpanded = $state(false);
  /*
   * v0.1.6 V016-D：语义拆分收进 AssistancePanel（单一「需要帮助」入口）。
   * - 页头只保留次级「自动整理」（去 sparkle，直接 changelist/suggest metadata，
   *   无回执预告；模型可用时 Host 实际可调模型，来源徽章如实标“模型建议”）。
   * - 面板模型组唯一模型入口「按改动意图拆分」（kind:model），回执卡与三动作
   *   移入面板 children，回执 token 仍由页面闭包持有，绝不进入组件。
   * - 页面级唯一 primary=意向单入口（确认应用/移出变更集）；面板内展开动作不计。
   * - 协议与 Host 零改动。
   */
  let assistanceExpanded = $state(false);
  const assistanceConfigured = $derived(
    !snapshot.aiPrivacy.model.includes("未配置"),
  );
  const assistanceSource = $derived<AssistanceSourceState>(snapshot.source);
  const assistanceModelActions = $derived.by((): AssistanceActionItem[] => [
    {
      label: changelistAssistanceLabels.semanticSplit,
      kind: "model",
      hint: changelistAssistanceLabels.semanticSplitHint,
      disabled: !assistanceConfigured,
      disabledReason: assistanceConfigured
        ? undefined
        : changelistAssistanceLabels.unconfiguredDisabledReason,
      onSelect: requestSemanticSplit,
    },
  ]);
  /* 回执到达自动展开面板，保证“生成后可见”；用户可手动收起。 */
  $effect(() => {
    if (changelistReceipt) assistanceExpanded = true;
  });
  // v0.0.14 批次 D：变更集应用意向单
  let changelistIntentOpen = $state(false);
  let changelistTriggerEl = $state<HTMLElement | null>(null);
  const changelistIntent = $derived.by(() => {
    const preview = snapshot.preview;
    if (!preview) return undefined;
    const count = preview.paths.length;
    const title = preview.remove
      ? `移出变更集 ${count} 个文件`
      : `应用变更集到 ${count} 个文件`;
    const summary = `${title} · 目标：${preview.name ?? "未命名"}，执行前将重新校验`;
    // v0.1.5 V015-C1 九要素补齐：scope 即目标变更集；可恢复性说明 changelist 语义
    // （只调本地归属，不改文件内容）；revision 无权威来源，不虚构。
    return {
      token: preview.token,
      kind: "changelist-apply" as const,
      title,
      summary,
      paths: preview.paths,
      scopeText: `变更集“${preview.name ?? "未命名"}”`,
      recoverability: "只调整本地变更集归属，不修改文件内容；不会自动提交。",
      createdAt: new Date().toISOString(),
      canExecute: preview.canExecute,
      issues: preview.issues,
      commands: [preview.command],
      stale: false,
    };
  });

  function sanitizeName(value: string): string {
    return (
      value
        .replace(/^(?:拆分|分组)\s*\d+\s*[:：]\s*/, "")
        .replace(/\s+/g, "-")
        .slice(0, 60) || "workbench-change"
    );
  }

  function previewRemove(paths: string[]): void {
    onAction("changelist/preview-apply", { remove: true, paths });
  }

  function copySelectedPaths(): void {
    if (selectedPaths.length === 0) return;
    onAction("copy-text", { text: selectedPaths.join("\n") });
  }

  function sendSelectionToEditor(): void {
    if (selectedPaths.length === 0) return;
    applyPaths = [...selectedPaths];
    announcement = `已把 ${applyPaths.length} 个已选文件加入应用栏。`;
  }

  /** 行内 Shift+Click 连续选择（以活动行锚点为起点，只加入可选行）。 */
  function handleEntryClick(event: MouseEvent, index: number): void {
    if (event.shiftKey && list.anchorIndex >= 0) {
      const range = rangeItems(allRows, list.anchorIndex, index);
      const next = cloneSelection(selected);
      for (const entry of range) {
        if (entry.selectionKey) next.add(entry.selectionKey);
      }
      selected = next;
    } else {
      const entry = allRows[index];
      if (entry.selectionKey) toggleKey(entry.selectionKey);
    }
    list.markActive(index);
  }
</script>

<section class="changelist-page" use:focusOnMount tabindex="-1">
  <header class="page-heading page-heading--actions">
    <div>
      <span class="eyebrow">SVN 变更集</span>
      <h1>变更集管理</h1>
      <p>
        建议分组按目录和文件类型生成，不表示语义或依赖关系分析。模型可用时来源为“模型建议”，否则为本地检查；应用前仍由扩展主机校验范围与最新工作副本状态。
      </p>
    </div>
    <!-- v0.1.6 V016-D：页头只保留次级「自动整理」（去 sparkle，不弹回执预告）；语义拆分收进下方 AssistancePanel。 -->
    <button
      class="button button--secondary"
      onclick={() => onAction("changelist/suggest", { mode: "metadata" })}
      >{changelistAssistanceLabels.autoTidy}</button
    >
  </header>
  {#if snapshot.feedback}<div class="notice notice--success" role="status">
      {snapshot.feedback}
    </div>{/if}
  <div class="privacy-note">
    <strong>外发预览</strong><span
      >{snapshot.aiPrivacy.data}；最多 {snapshot.aiPrivacy.fileLimit} 个文件；模型
      {snapshot.aiPrivacy.model}；不含历史。点击“自动整理”才会发送。</span
    >
  </div>
  <!-- v0.1.6 V016-D：分组帮助单一「需要帮助」入口（默认折叠；回执卡与三动作收进面板，token 链原样）。 -->
  <AssistancePanel
    title={changelistAssistanceLabels.panelTitle}
    summary={changelistAssistanceLabels.panelSummary}
    sourceState={assistanceSource}
    model={assistanceConfigured ? snapshot.aiPrivacy.model : undefined}
    configured={assistanceConfigured}
    expanded={assistanceExpanded}
    modelActions={assistanceModelActions}
    onExpand={() => (assistanceExpanded = true)}
    onCollapse={() => (assistanceExpanded = false)}
  >
    {#if changelistReceipt}
      <div
        class="commit-receipt"
        role="region"
        aria-label="语义拆分外发回执"
        data-confirmation-zone="receipt"
      >
        <div class="commit-receipt__head">
          <span class="codicon codicon-arrow-up" aria-hidden="true"></span>
          <strong>语义拆分外发回执（尚未发送）</strong>
          <span class="commit-receipt__tag" role="status">等待确认</span>
        </div>
        <dl class="commit-receipt__meta">
          <div>
            <dt>任务</dt>
            <dd>语义拆分（{changelistReceipt.receipt.task}）</dd>
          </div>
          <div>
            <dt>模型</dt>
            <dd>{changelistReceipt.receipt.model}</dd>
          </div>
          <div>
            <dt>数据类型</dt>
            <dd>{changelistReceipt.receipt.dataTypes.join("、")}</dd>
          </div>
          <div>
            <dt>文件数</dt>
            <dd>{changelistReceipt.receipt.files} 个已发送候选</dd>
          </div>
          <div>
            <dt>预算</dt>
            <dd>
              单文件 {changelistReceipt.receipt.perFileBudget} 字符 / 总计 {changelistReceipt
                .receipt.totalBudget} 字符
            </dd>
          </div>
        </dl>
        <p class="commit-receipt__coverage">
          覆盖率：已分析 {changelistReceipt.coverage.analyzed} · 截断
          {changelistReceipt.coverage.truncated} · 二进制
          {changelistReceipt.coverage.binary} · 读取失败
          {changelistReceipt.coverage.readFailed} · 预算外
          {changelistReceipt.coverage.budgetExcluded}（共
          {changelistReceipt.coverage.total} 个候选）
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
            {#each changelistReceipt.files as file (file.candidateId)}
              <li
                class="commit-receipt__file"
                class:commit-receipt__file--excluded={file.state !== "analyzed"}
              >
                <span>{file.projectRelativePath}</span>
                <small
                  >{file.state}{file.reason ? `（${file.reason}）` : ""}</small
                >
              </li>
            {/each}
          </ul>
        {/if}
        <p class="commit-receipt__note">
          不会发送：{changelistReceipt.notSent.join("；")}。
        </p>
        <p class="commit-receipt__note">{changelistReceipt.retentionNote}</p>
        <div class="commit-receipt__actions">
          <button
            type="button"
            class="button button--primary"
            onclick={confirmSemanticSplit}>开始语义拆分</button
          >
          <button
            type="button"
            class="button button--secondary"
            onclick={continueMetadataSplit}>继续仅目录分组</button
          >
          <button
            type="button"
            class="button button--secondary"
            onclick={dismissSplitReceipt}>放弃</button
          >
        </div>
      </div>
    {/if}
  </AssistancePanel>
  {#if snapshot.suggestions.length > 0}<div class="ai-source">
      建议来源：{sourceLabels[snapshot.source]}
    </div>{/if}
  {#if snapshot.fallbackReason}<div class="notice notice--warning">
      降级原因：{snapshot.fallbackReason}
    </div>{/if}
  {#each snapshot.warnings as warning, warningIndex (warningIndex)}<div
      class="notice notice--warning"
    >
      {warning}
    </div>{/each}
  {#if snapshot.preselected}<div class="notice notice--info" role="status">
      <span class="codicon codicon-info" aria-hidden="true"></span>已带入 {snapshot
        .preselected.count} 个文件（来自会话共享选择，右键范围未扩大）
      <small
        >包含：{snapshot.preselected.paths.slice(0, 5).join("、")}{snapshot
          .preselected.paths.length > 5
          ? ` 等 ${snapshot.preselected.paths.length} 个`
          : ""}</small
      >
    </div>{/if}
  {#if snapshot.preselectedFeedback}<div
      class="notice notice--warning"
      role="status"
    >
      {snapshot.preselectedFeedback}
    </div>{/if}

  <div class="changelist-layout">
    <div class="changelist-column changelist-column--files">
      <div class="feature-toolbar feature-toolbar--compact">
        <SearchInput
          bind:value={query}
          ariaLabel="筛选变更集文件"
          placeholder="筛选文件…"
          compact
        />
        <ResultCount count={matchedCount} />
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
                toggleSort(value as ChangelistSortField);
              }
            }}
          >
            <option value="">默认顺序</option>
            <option value="path">按路径</option>
            <option value="status">按状态</option>
          </select>
          {#if sortField}
            <button class="button button--secondary" onclick={resetSort}
              >恢复默认顺序</button
            >
          {/if}
        </div>
      </div>
      <SelectionSummary
        selectedCount={selected.size}
        {actionableCount}
        {hiddenCount}
        {onlySelected}
        recommendedAvailable={false}
        {announcement}
        onToggleOnlySelected={() => (onlySelected = !onlySelected)}
        onClearHidden={() =>
          (selected = clearHiddenSelection(
            toSelectable(allEntries()),
            selected,
          ))}
        onClearAll={() => (selected = emptySelection())}
      />
      <div class="changelist-select-actions">
        <button
          class="button button--secondary"
          disabled={actionableCount === 0}
          onclick={() =>
            (selected = selectActionable(filteredSelectable, selected))}
          >选择当前筛选（{actionableCount}）</button
        >
      </div>
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
      <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_static_element_interactions -- 文件列表需要键盘焦点与统一键盘导航；各节自身是 role=list。 -->
      <div
        class="changelist-list scroll-region"
        data-scroll-region
        role="region"
        tabindex="0"
        aria-label="变更集与未分组文件"
        bind:this={list.element}
        onscroll={list.handleScroll}
        onkeydown={list.handleKeydown}
      >
        {#if sections.every((section) => section.matchedCount === 0)}
          <!-- v0.1.5 V015-E：手写 mini-empty→TaskEmptyState（三句复用 taskStateCopy）。 -->
          {#if allEntries().length === 0}
            <TaskEmptyState
              icon="codicon-folder"
              what="当前范围没有可分组的本地修改"
              whyNormal={taskStateCopy.emptyClean.whyNormal}
              whatNow={taskStateCopy.emptyClean.whatNow}
              actions={[]}
              onAction={() => {}}
            />
          {:else if onlySelected}
            <TaskEmptyState
              icon="codicon-filter"
              what={taskStateCopy.filterSelectedHidden.what}
              whyNormal={taskStateCopy.filterSelectedHidden.whyNormal}
              whatNow={taskStateCopy.filterSelectedHidden.whatNow}
              actions={[]}
              onAction={() => {}}
            />
          {:else}
            <TaskEmptyState
              icon="codicon-search"
              what={taskStateCopy.filterNoMatch.what}
              whyNormal={taskStateCopy.filterNoMatch.whyNormal}
              whatNow={taskStateCopy.filterNoMatch.whatNow}
              actions={[]}
              onAction={() => {}}
            />
          {/if}
        {:else}
          {#each sections as section (section.key)}
            <div class="changelist-section-head">
              {#if section.kind === "group"}
                <button
                  type="button"
                  class="changelist-section-toggle"
                  aria-expanded={!collapsedGroups.has(section.name)}
                  onclick={() => toggleCollapse(section.name)}
                  ><span
                    class="codicon"
                    class:codicon-chevron-right={collapsedGroups.has(
                      section.name,
                    )}
                    class:codicon-chevron-down={!collapsedGroups.has(
                      section.name,
                    )}
                    aria-hidden="true"
                  ></span>{section.name}</button
                >
              {:else}
                <strong class="changelist-section-name">{section.name}</strong>
              {/if}
              <span class="changelist-section-count"
                >{section.matchedCount}/{section.totalCount}</span
              >
              {#if section.kind === "group" && section.totalCount > 0}
                <button
                  class="text-action text-action--danger"
                  onclick={() =>
                    previewRemove(
                      snapshot.groups
                        .find((group) => group.name === section.name)
                        ?.files.map((file) => file.relativePath) ?? [],
                    )}>移出整组（{section.totalCount}）</button
                >
              {/if}
            </div>
            <div
              class="changelist-section"
              role="list"
              aria-label={section.name}
            >
              {#each section.entries as entry, entryIndex (entry.relativePath)}
                {@const rowIndex = section.start + entryIndex}
                <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -- 行点击只设置活动行；键盘操作由列表容器统一处理。 -->
                <div
                  class="changelist-row"
                  class:changelist-row--active={list.activeIndex === rowIndex}
                  role="listitem"
                  data-row-index={rowIndex}
                  tabindex="-1"
                  onclick={() => list.markActive(rowIndex)}
                >
                  <input
                    type="checkbox"
                    aria-label={`选择 ${entry.relativePath}`}
                    checked={entry.selectionKey
                      ? selected.has(entry.selectionKey)
                      : false}
                    disabled={!entry.selectionKey}
                    title={entry.selectionKey
                      ? undefined
                      : "当前候选中不存在该文件，无法选择"}
                    onclick={(event) => {
                      event.stopPropagation();
                      handleEntryClick(event, rowIndex);
                    }}
                  />
                  <span class="changelist-row-path">
                    <PathCell
                      file={entry}
                      selected={entry.selectionKey
                        ? selected.has(entry.selectionKey)
                        : false}
                      onOpenDiff={() =>
                        onAction("open-diff", {
                          relativePath: entry.relativePath,
                        })}
                      onOpenDetail={(trigger) =>
                        list.requestPathDetail(entry.relativePath, trigger)}
                    />
                  </span>
                  {#if entry.status}
                    <span class={`status-badge status-badge--${entry.status}`}
                      >{fileStatusLabels[entry.status]}</span
                    >
                  {:else}
                    <span class="status-badge">—</span>
                  {/if}
                </div>
              {/each}
            </div>
          {/each}
        {/if}
      </div>
      <BulkActionBar summary={`已选 ${selected.size}`}>
        <button
          class="button button--secondary"
          disabled={selectedAssignedPaths.length === 0}
          title={selectedAssignedPaths.length === 0
            ? "已选文件都不在变更集中"
            : undefined}
          onclick={() => previewRemove(selectedAssignedPaths)}
          >移出变更集（{selectedAssignedPaths.length}）</button
        >
        <button
          class="button button--secondary"
          disabled={selectedPaths.length === 0}
          onclick={sendSelectionToEditor}
          >加入应用栏（{selectedPaths.length}）</button
        >
        <button
          class="button button--secondary"
          disabled={selectedPaths.length === 0}
          onclick={copySelectedPaths}>复制已选路径</button
        >
        <button
          class="button button--secondary"
          disabled={selectedPaths.length !== 1}
          title={selectedPaths.length !== 1
            ? "差异对比一次只支持 1 个文件"
            : undefined}
          onclick={() =>
            onAction("open-diff", { relativePath: selectedPaths[0] })}
          >打开差异</button
        >
      </BulkActionBar>
    </div>

    <ScrollArea
      class="changelist-column changelist-column--suggestions"
      label="分组建议"
    >
      <div class="section-heading">
        <div>
          <span class="eyebrow">按目录和文件类型分组</span>
          <h2>分组候选</h2>
        </div>
      </div>
      {#if snapshot.suggestions.length === 0}<div class="preview-empty">
          <span class="codicon codicon-sparkle" aria-hidden="true"></span>
          <p>按目录与文件类型生成可调整的本地建议，不表示语义拆分。</p>
        </div>{/if}
      {#each snapshot.suggestions as suggestion (suggestion.id)}
        <article class="split-card">
          <div class="split-card-heading">
            <strong>{suggestion.title}</strong><span
              >{suggestion.paths.length} 个文件</span
            >
          </div>
          <p>{suggestion.summary}</p>
          <small>{suggestion.reason}</small>{#if suggestion.purpose}<p
              class="split-purpose"
            >
              目的：{suggestion.purpose}
            </p>{/if}{#if suggestion.dependencies?.length}<ul
              class="split-dependencies"
            >
              {#each suggestion.dependencies as dep, depIndex (`${suggestion.id}:dep:${depIndex}`)}<li
                >
                  {dep}
                </li>{/each}
            </ul>{/if}{#if suggestion.risks.length}<ul>
              {#each suggestion.risks as risk, riskIndex (`${suggestion.id}:${riskIndex}`)}<li
                >
                  {risk}
                </li>{/each}
            </ul>{/if}<button
            class="button button--secondary"
            onclick={() => useSuggestion(suggestion.id)}>套用并调整</button
          >
        </article>
      {/each}
    </ScrollArea>

    <ScrollArea
      class="changelist-column changelist-editor"
      label="应用 SVN 变更集"
    >
      <div class="section-heading">
        <div>
          <span class="eyebrow">应用分组</span>
          <h2>应用到 SVN</h2>
        </div>
      </div>
      <label class="field"
        ><span>变更集名称</span><input
          bind:value={name}
          placeholder="例如 workbench-ui"
        /></label
      >
      <div class="selected-paths">
        <strong>将分组的文件（{applyPaths.length}）</strong
        >{#each applyPaths as item (item)}<div>
            <span>{item}</span><button
              aria-label={`移除 ${item}`}
              onclick={() =>
                (applyPaths = applyPaths.filter((path) => path !== item))}
              ><span class="codicon codicon-close" aria-hidden="true"
              ></span></button
            >
          </div>{/each}
      </div>
      <!-- v0.1.6 V016-D：页面级唯一 primary=意向单入口（确认应用/移出变更集），此处降为次级。 -->
      <button
        class="button button--secondary commit-button"
        disabled={!name || applyPaths.length === 0}
        onclick={() =>
          onAction("changelist/preview-apply", {
            name,
            paths: applyPaths,
            remove: false,
          })}>生成应用预览</button
      >
      {#if snapshot.preview}
        <div class="changelist-preview">
          <code>{snapshot.preview.command}</code>
          {#each snapshot.preview.issues as issue, issueIndex (issueIndex)}<div
              class="notice notice--error"
            >
              {issue}
            </div>{/each}
          <button
            class="button button--primary commit-button"
            disabled={!snapshot.preview.canExecute}
            onclick={(event) => {
              changelistTriggerEl = event.currentTarget as HTMLElement;
              changelistIntentOpen = true;
            }}
            >{snapshot.preview.remove
              ? "确认移出变更集"
              : "确认应用变更集"}</button
          >
          <OperationIntentDialog
            intent={changelistIntent}
            open={changelistIntentOpen && Boolean(changelistIntent)}
            confirmLabel={snapshot.preview.remove
              ? "确认移出变更集"
              : "确认应用变更集"}
            cancelLabel="取消"
            recheckLabel="重新检查"
            triggerElement={changelistTriggerEl}
            {onAction}
            {pathDetail}
            onConfirm={(token) => {
              changelistIntentOpen = false;
              onAction("changelist/execute-apply", { previewToken: token });
            }}
            onCancel={() => (changelistIntentOpen = false)}
            onRecheck={() => {
              changelistIntentOpen = false;
              const current = snapshot.preview;
              if (!current) return;
              onAction("changelist/preview-apply", {
                name: current.name,
                paths: current.paths,
                remove: current.remove,
              });
            }}
          />
        </div>
      {/if}
    </ScrollArea>
  </div>
</section>
