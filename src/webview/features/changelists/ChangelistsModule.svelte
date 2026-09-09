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
  import ListShortcutHint from "../../components/help/ListShortcutHint.svelte";
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
  import {
    buildPathListText,
    buildStatusPathListText,
    orderSelectedForCopy,
  } from "../../components/list/copySelectionList";
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
    draftStorageLabels,
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
  /** V023-R26：移动目标（已有组名或新建入口）；空表示未选择。 */
  const NEW_CHANGESET_OPTION = "__new__";
  let moveTarget = $state("");
  let moveFeedback = $state("");
  /** V023-R24：复制就地反馈，不改选择、不发起写操作。 */
  let copyFeedback = $state("");
  let query = $state("");
  /** V023-R23：`/` 聚焦搜索目标（集中 keymap `list/searchFocus`）。 */
  let searchInputRef = $state<{ focusInput: () => void } | undefined>();
  let onlySelected = $state(false);
  let sortField = $state<ChangelistSortField | undefined>();
  let sortDirection = $state<SortDirection>("asc");
  let announcement = $state("");
  let selected = $state<ReadonlySet<SelectionKey>>(emptySelection());
  let collapsedGroups = new SvelteSet<string>();
  /**
   * V023-R21：搜索期间折叠覆盖（组名→是否折叠），清空搜索后丢弃，
   * 用户折叠偏好（collapsedGroups）全程保留，恢复不受影响。
   */
  let searchCollapseOverride = new SvelteMap<string, boolean>();
  const isSearching = $derived(query.trim().length > 0);

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

  /**
   * V020-R04：筛选谓词（搜索 + 只看已选），与分组折叠正交。
   * 折叠只影响渲染行，不改变匹配集合定义。
   */
  function matchesEntry(entry: ChangelistGroupFileView): boolean {
    if (
      onlySelected &&
      (!entry.selectionKey || !selected.has(entry.selectionKey))
    ) {
      return false;
    }
    return matchesFileQuery(entry, query);
  }

  /**
   * V020-R04：当前匹配集合（忽略折叠与排序，只看筛选）。
   * 隐藏选择计数、清除隐藏、选择当前筛选均以它为准；
   * 全量候选刷新求交仍用 allEntries()，两者语义分离。
   */
  const matchedEntries = $derived.by(() => [
    ...snapshot.groups.flatMap((group) => group.files.filter(matchesEntry)),
    ...snapshot.unassigned.filter(matchesEntry),
  ]);

  /** 全部条目按筛选与排序组织成节；折叠的分组不渲染，但仍计入匹配集合。 */
  const sections = $derived.by(() => {
    const filterEntry = matchesEntry;
    const searching = query.trim().length > 0;
    const result: ListSection[] = [];
    let start = 0;
    for (const group of snapshot.groups) {
      const matched = group.files.filter(filterEntry);
      // V023-R21：搜索默认展开命中组（无命中默认收起），用户在搜索期间的手动
      // 折叠写入覆盖层；清空搜索后覆盖层丢弃，用户偏好恢复。
      let collapsed: boolean;
      if (searching && searchCollapseOverride.has(group.name)) {
        collapsed = searchCollapseOverride.get(group.name) ?? false;
      } else if (searching) {
        collapsed = matched.length === 0;
      } else {
        collapsed = collapsedGroups.has(group.name);
      }
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

  /**
   * 渲染行（匹配集合减去折叠分组，含排序）：键盘导航、活动行索引、
   * Shift 范围选择的索引空间。筛选定义以 matchedEntries 为准，不随折叠变化。
   */
  const allRows = $derived(sections.flatMap((section) => section.entries));
  const matchedCount = $derived(matchedEntries.length);

  const pathByKey = $derived.by(() => {
    const map = new SvelteMap<SelectionKey, string>();
    for (const entry of allEntries()) {
      if (entry.selectionKey) map.set(entry.selectionKey, entry.relativePath);
    }
    return map;
  });

  /** 不受筛选/折叠影响的全量候选（路径查表与刷新合法交集使用）。 */
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

  /** V020-R04：当前筛选可操作项基于匹配集合（含折叠但匹配的项），与渲染行分离。 */
  const filteredSelectable = $derived(toSelectable(matchedEntries));
  const actionableCount = $derived(actionableKeys(filteredSelectable).size);
  const hiddenCount = $derived(
    hiddenSelectionKeys(toSelectable(matchedEntries), selected).size,
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
    // 中文注释：V020-R16 锚点稳定身份；无身份键的行不可选，不参与锚点。
    keyOf: (entry) => entry.selectionKey,
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
    // V023-R23：`/` 聚焦搜索（集中 keymap `list/searchFocus`，空结果同样可用）。
    onFocusSearch: () => searchInputRef?.focusInput(),
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
    if (isSearching) {
      // 搜索期间只写覆盖层：清空搜索后用户偏好原样恢复。
      const section = sections.find(
        (item) => item.kind === "group" && item.name === groupName,
      );
      const current = isGroupCollapsed(groupName, section?.matchedCount ?? 0);
      searchCollapseOverride.set(groupName, !current);
      return;
    }
    if (collapsedGroups.has(groupName)) {
      collapsedGroups.delete(groupName);
    } else {
      collapsedGroups.add(groupName);
    }
  }

  // V023-R21：清空搜索后丢弃搜索覆盖层，恢复用户折叠偏好（不改变已选）。
  $effect(() => {
    if (!isSearching && searchCollapseOverride.size > 0) {
      searchCollapseOverride.clear();
    }
  });

  /** V023-R21：组级选择本组全部匹配项（只改选择，不改变操作 scope）。 */
  function selectGroupMatched(groupName: string): void {
    const group = snapshot.groups.find((item) => item.name === groupName);
    if (!group) return;
    const matched = group.files.filter(matchesEntry);
    const next = cloneSelection(selected);
    for (const entry of matched) {
      if (entry.selectionKey) next.add(entry.selectionKey);
    }
    selected = next;
  }

  /**
   * V023-R21：有效折叠态（模板与节头共用）：搜索期间命中组默认展开，
   * 覆盖层优先；非搜索沿用用户偏好。aria-expanded 据此播报。
   */
  function isGroupCollapsed(groupName: string, matchedLength: number): boolean {
    if (isSearching && searchCollapseOverride.has(groupName)) {
      return searchCollapseOverride.get(groupName) ?? false;
    }
    if (isSearching) return matchedLength === 0;
    return collapsedGroups.has(groupName);
  }

  /**
   * V023-R22：字段选择只定字段（同字段不反转，方向由独立按钮切换）。
   * select onchange 难再触发同值，方向切换不再依赖重复选择字段。
   */
  function setSortField(field: ChangelistSortField | undefined): void {
    if (field === undefined) {
      resetSort();
      return;
    }
    if (sortField !== field) {
      sortField = field;
      sortDirection = "asc";
      saveListPreferences("changelists", { sortField, sortDirection });
    }
  }

  /** V023-R22：独立方向切换（同一字段可明确切升/降）。 */
  function toggleSortDirection(): void {
    if (!sortField) {
      sortField = "path";
    }
    sortDirection = sortDirection === "asc" ? "desc" : "asc";
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

  /**
   * V025-R50：语义拆分默认按明确勾选集合生成回执；空选择不回退为全部候选，
   * 要求明确选择分析范围（当前范围全部候选为显式选项，仍不得超出原 scope）。
   */
  let splitScopePrompt = $state(false);
  function requestSemanticSplit(): void {
    if (selectedPaths.length > 0) {
      splitScopePrompt = false;
      onAction("changelist/preview-receipt", { selectedPaths });
    } else {
      splitScopePrompt = true;
      announcement = changelistAssistanceLabels.splitScopeRequired;
    }
  }

  function requestSemanticSplitAll(): void {
    splitScopePrompt = false;
    onAction("changelist/preview-receipt", { selectAll: true });
  }

  function confirmSemanticSplit(): void {
    if (!changelistReceipt) return;
    // V025-R50：确认时回传当前选择；改选后 Host 拒绝旧 token。
    onAction("changelist/run-semantic", {
      receiptToken: changelistReceipt.token,
      selectedPaths,
    });
    changelistReceipt = undefined;
    receiptSelectionFingerprint = undefined;
  }

  function continueMetadataSplit(): void {
    const receipt = changelistReceipt;
    if (receipt) {
      onAction("changelist/receipt-dismiss", { token: receipt.token });
    }
    changelistReceipt = undefined;
    receiptSelectionFingerprint = undefined;
    onAction("changelist/suggest", { mode: "metadata" });
  }

  function dismissSplitReceipt(): void {
    const receipt = changelistReceipt;
    if (receipt) {
      onAction("changelist/receipt-dismiss", { token: receipt.token });
    }
    changelistReceipt = undefined;
    receiptSelectionFingerprint = undefined;
  }

  let receiptExpanded = $state(false);
  /*
   * v0.1.6 V016-D + V025-R49：语义拆分收进 AssistancePanel（单一「需要帮助」入口）。
   * - 页头「自动整理」是本地确定性动作（changelist/suggest metadata，Host 纯本地规则，
   *   不经模型、不外发，来源固定“本地检查”）。
   * - 面板本地组唯一本地入口「自动整理」（kind:local），模型组唯一模型入口
   *   「按改动意图拆分」（kind:model），回执卡与三动作移入面板 children，
   *   回执 token 仍由页面闭包持有，绝不进入组件。
   * - 页面级唯一 primary=意向单入口（确认应用/移出变更集）；面板内展开动作不计。
   * - 仅元数据模式不声称理解业务意图（purpose 声明未读取差异正文）。
   */
  let assistanceExpanded = $state(false);
  const assistanceConfigured = $derived(
    !snapshot.aiPrivacy.model.includes("未配置"),
  );
  const assistanceSource = $derived<AssistanceSourceState>(snapshot.source);
  /*
   * V025-R49：本地入口唯一性——页头「自动整理」是唯一的本地整理入口
   * （本地确定性，不外发）；面板只承载唯一的模型入口，避免同名双按钮
   * 造成键盘/读屏歧义。本地来源/输入类型见页头说明、外发预览与建议来源标注。
   */
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
  /* 回执到达自动展开面板，保证“生成后可见”；用户可手动收起。
   * V025-R50：回执绑定到达时的明确选择；选择变化即作废旧回执——本地作废
   * 回执视图并通知 Host 放弃（未确认前未外发），Host 侧同样复验。 */
  let receiptSelectionFingerprint = $state<string | undefined>(undefined);
  let receiptFingerprintToken = $state<string | undefined>(undefined);
  function selectionFingerprint(): string {
    return [...selectedPaths].sort().join("\n");
  }
  $effect(() => {
    if (changelistReceipt) {
      assistanceExpanded = true;
      // 只在新回执到达时钉住指纹；选择变化不得跟随刷新指纹，
      // 否则改选作废检查永远比对一致。
      if (receiptFingerprintToken !== changelistReceipt.token) {
        receiptFingerprintToken = changelistReceipt.token;
        receiptSelectionFingerprint = selectionFingerprint();
      }
    } else {
      receiptFingerprintToken = undefined;
    }
  });
  $effect(() => {
    const current = selectionFingerprint();
    const receipt = changelistReceipt;
    if (
      receipt &&
      receiptSelectionFingerprint !== undefined &&
      current !== receiptSelectionFingerprint
    ) {
      onAction("changelist/receipt-dismiss", { token: receipt.token });
      changelistReceipt = undefined;
      receiptSelectionFingerprint = undefined;
      splitScopePrompt = false;
      announcement = changelistAssistanceLabels.splitSelectionChanged;
    }
  });
  // v0.0.14 批次 D：变更集应用意向单
  let changelistTriggerEl = $state<HTMLElement | null>(null);
  let changelistIntentOpen = $state(false);
  /*
   * V020-R08：方案漂移追踪——预览后改名、删应用栏文件、改目标组
   * 只改变本地状态，旧预览必须立即只读并关闭执行入口。
   * 移出类预览（remove=true）无编辑器方案，直接以预览路径为准，
   * 不受名称/应用栏编辑影响，仍由 Host 绑定复验。
   */
  const previewPlanChanged = $derived.by(() => {
    const preview = snapshot.preview;
    if (!preview || preview.remove) return false;
    if ((name ?? "").trim() !== (preview.name ?? "").trim()) return true;
    const current = [...applyPaths].sort();
    const previewPaths = [...preview.paths].sort();
    if (current.length !== previewPaths.length) return true;
    return current.some((path, index) => path !== previewPaths[index]);
  });
  /*
   * V020-R08：旧响应晚到不得恢复旧预览可执行状态——只承认最新到达
   * 的预览令牌；携带旧令牌的延迟快照一律只读。
   */
  let seenPreviewTokens = $state<string[]>([]);
  $effect(() => {
    const token = snapshot.preview?.token;
    if (token && !seenPreviewTokens.includes(token)) {
      seenPreviewTokens = [...seenPreviewTokens, token];
    }
  });
  const newestPreviewToken = $derived(
    seenPreviewTokens[seenPreviewTokens.length - 1],
  );
  const isLatePreview = $derived(
    Boolean(snapshot.preview?.token) &&
      snapshot.preview?.token !== newestPreviewToken,
  );
  const previewStale = $derived(previewPlanChanged || isLatePreview);

  /**
   * V020-R08：按用户当前看到的方案重新预览，新预览产生新令牌。
   * 应用类用编辑器中的名称/路径；移出类沿用预览自身的路径集合。
   */
  function repreviewCurrentPlan(): void {
    const current = snapshot.preview;
    if (!current) return;
    if (current.remove) {
      onAction("changelist/preview-apply", {
        remove: true,
        paths: current.paths,
      });
    } else {
      onAction("changelist/preview-apply", {
        name,
        paths: applyPaths,
        remove: false,
      });
    }
  }
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
      stale: previewStale,
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
    // V023-R24：按当前列表顺序输出，隐藏选择稳定追加；只含相对路径。
    try {
      const pathSet = new Set(selectedPaths);
      const ordered = orderSelectedForCopy(allRows, allEntries(), pathSet);
      onAction("copy-text", { text: buildPathListText(ordered) });
      copyFeedback =
        hiddenCount > 0
          ? `已复制 ${selectedPaths.length} 个已选路径（含 ${hiddenCount} 个隐藏选择）。`
          : `已复制 ${selectedPaths.length} 个已选路径。`;
    } catch {
      copyFeedback = "复制失败，请重试；选择未改动，未发起写操作。";
    }
  }

  /** V023-R24：复制状态+路径清单（顺序与当前列表一致，失败就地反馈）。 */
  function copySelectedStatusPaths(): void {
    if (selectedPaths.length === 0) return;
    try {
      const pathSet = new Set(selectedPaths);
      const ordered = orderSelectedForCopy(allRows, allEntries(), pathSet);
      onAction("copy-text", { text: buildStatusPathListText(ordered) });
      copyFeedback =
        hiddenCount > 0
          ? `已复制 ${selectedPaths.length} 个状态+路径（含 ${hiddenCount} 个隐藏选择）。`
          : `已复制 ${selectedPaths.length} 个状态+路径。`;
    } catch {
      copyFeedback = "复制失败，请重试；选择未改动，未发起写操作。";
    }
  }

  /*
   * V023-R26：移动到变更集选择器。选中已有组后把当前已选填入目标并
   * 直接走既有预览/令牌执行链（changelist/preview-apply）；选“新建”时只
   * 填入应用栏，由用户命名后再预览。取消只清本地草稿，不触发写操作。
   * V023-R26 终审：新下拉路径先本地拒绝未版本化/不可操作/过期文件
   * （status=unversioned、selection=blocked/无身份键、selection=needsReview），
   * 拒绝时保留选择、不发预览；Host 预览/执行前仍复验（不信任 Webview）。
   */
  function entryByRelativePath(
    relativePath: string,
  ): ChangelistGroupFileView | undefined {
    return allEntries().find((entry) => entry.relativePath === relativePath);
  }

  function moveToSelectedTarget(): void {
    if (selectedPaths.length === 0 || !moveTarget) return;
    if (moveTarget === NEW_CHANGESET_OPTION) {
      applyPaths = [...selectedPaths];
      name = "";
      moveFeedback = `已把 ${applyPaths.length} 个已选文件加入应用栏，请填写新变更集名称后生成预览。`;
      return;
    }
    const rejected = selectedPaths.filter((relativePath) => {
      const entry = entryByRelativePath(relativePath);
      if (!entry || !entry.selectionKey) return true;
      if (entry.status === "unversioned") return true;
      if (entry.selection === "blocked") return true;
      if (entry.selection === "needsReview") return true;
      return false;
    });
    if (rejected.length > 0) {
      const shown = rejected.slice(0, 3).join("、");
      const more = rejected.length > 3 ? `等 ${rejected.length} 个文件` : "";
      moveFeedback = `有 ${rejected.length} 个已选文件不能移动到变更集“${moveTarget}”（未纳入版本控制、阻止提交或需要确认），已保留全部选择，未发起预览与写操作：${shown}${more}。请取消选择这些文件后重试。`;
      return;
    }
    name = moveTarget;
    applyPaths = [...selectedPaths];
    moveFeedback = "";
    onAction("changelist/preview-apply", {
      name,
      paths: applyPaths,
      remove: false,
    });
  }

  /** V023-R26：取消只清本地名称与应用栏，不发 Host 动作、不写操作。 */
  function cancelMoveDraft(): void {
    name = "";
    applyPaths = [];
    moveFeedback = "已取消，未发起写操作。";
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
        自动整理是本地确定性分组（按目录和文件类型，不外发，不理解业务意图）。按改动意图拆分需确认外发回执后才调用模型；{draftStorageLabels.changelistCheckHint}
      </p>
    </div>
    <!-- V025-R49：页头「自动整理」是唯一的本地确定性入口（不弹回执预告，不外发）；语义拆分收进下方 AssistancePanel。 -->
    <button
      class="button button--secondary"
      title={changelistAssistanceLabels.autoTidyHint}
      onclick={() => onAction("changelist/suggest", { mode: "metadata" })}
      >{changelistAssistanceLabels.autoTidy}</button
    >
  </header>
  {#if snapshot.feedback}<div class="notice notice--success" role="status">
      {snapshot.feedback}
    </div>{/if}
  <div class="privacy-note">
    <strong>外发预览</strong><span
      >自动整理是本地确定性动作，不发送任何内容；最多 {snapshot.aiPrivacy
        .fileLimit} 个文件；模型
      {snapshot.aiPrivacy
        .model}；不含历史。只有“按改动意图拆分”确认回执后才会发送。</span
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
    {#if splitScopePrompt}
      <!-- V025-R50：空选择时要求明确选择分析范围，不回退为全部候选。 -->
      <div
        class="commit-receipt"
        role="region"
        aria-label="选择语义拆分分析范围"
      >
        <p role="status">
          {changelistAssistanceLabels.splitScopeRequired}
        </p>
        <div class="commit-receipt__actions">
          <button
            type="button"
            class="button button--primary"
            onclick={requestSemanticSplitAll}
            >{changelistAssistanceLabels.splitSelectAll}（{allEntries()
              .length}）</button
          >
          <button
            type="button"
            class="button button--secondary"
            onclick={() => (splitScopePrompt = false)}
            >{changelistAssistanceLabels.splitScopeCancel}</button
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
          bind:this={searchInputRef}
          bind:value={query}
          ariaLabel="筛选变更集文件"
          placeholder="筛选文件…"
          compact
        />
        <ResultCount count={matchedCount} suffix="个匹配" />
        <!-- V023-R22：变更集文件列表为非表格分组列表，无语义列头；排序菜单为小屏等效能力
          （交互基线 §7.3），方向由中文升序/降序按钮（含 aria-label）承担，不虚构 columnheader。 -->
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
                setSortField(value as ChangelistSortField);
              }
            }}
          >
            <option value="">默认顺序</option>
            <option value="path">按路径</option>
            <option value="status">按状态</option>
          </select>
          {#if sortField}
            <button
              type="button"
              class="button button--secondary"
              aria-label={`排序方向：当前${sortDirection === "asc" ? "升序" : "降序"}，点击切换`}
              onclick={toggleSortDirection}
              >{sortDirection === "asc" ? "升序" : "降序"}</button
            >
            <button class="button button--secondary" onclick={resetSort}
              >恢复默认顺序</button
            >
          {/if}
        </div>
      </div>
      <ListShortcutHint
        region="list"
        hintKey="changelists-list"
        searchAvailable
      />
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
            toSelectable(matchedEntries),
            selected,
          ))}
        onClearAll={() => (selected = emptySelection())}
      />
      <div class="changelist-select-actions">
        <button
          class="button button--secondary"
          disabled={actionableCount === 0}
          title="包含折叠分组中的匹配文件"
          onclick={() =>
            (selected = selectActionable(filteredSelectable, selected))}
          >选择全部匹配项（{actionableCount}）</button
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
      <!-- V017-D P2-5 豁免：changelist-list 与 useFileList 元素绑定 + 节内 role=list 共存，暂保持原生 scroll-region div（已带 scroll-region/data-scroll-region），不接入 ScrollArea；缺统一 data 状态为已知取舍。 -->
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
                  aria-expanded={!isGroupCollapsed(
                    section.name,
                    section.matchedCount,
                  )}
                  aria-label={`${section.name}，匹配 ${section.matchedCount}，共 ${section.totalCount}`}
                  onclick={() => toggleCollapse(section.name)}
                  ><span
                    class="codicon"
                    class:codicon-chevron-right={isGroupCollapsed(
                      section.name,
                      section.matchedCount,
                    )}
                    class:codicon-chevron-down={!isGroupCollapsed(
                      section.name,
                      section.matchedCount,
                    )}
                    aria-hidden="true"
                  ></span>{section.name}</button
                >
              {:else}
                <strong class="changelist-section-name">{section.name}</strong>
              {/if}
              <span
                class="changelist-section-count"
                role="status"
                aria-label={`匹配 ${section.matchedCount}，共 ${section.totalCount}`}
                title={`匹配 ${section.matchedCount} / 共 ${section.totalCount}`}
                >{section.matchedCount}/{section.totalCount}</span
              >
              {#if section.kind === "group" && section.totalCount > 0}
                <button
                  type="button"
                  class="text-action"
                  disabled={section.matchedCount === 0}
                  title="只改变选择，不改变变更集归属范围"
                  onclick={() => selectGroupMatched(section.name)}
                  >选择本组匹配项（{section.matchedCount}）</button
                >
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
          title={selectedPaths.length === 0
            ? "先选择至少 1 个文件再复制"
            : hiddenCount > 0
              ? `复制 ${selectedPaths.length} 个已选相对路径（含 ${hiddenCount} 个隐藏选择），只含相对路径`
              : "复制已选相对路径，只含相对路径"}
          onclick={copySelectedPaths}
          >复制已选路径（{selectedPaths.length}{hiddenCount > 0
            ? `，含隐藏 ${hiddenCount}`
            : ""}）</button
        >
        <button
          class="button button--secondary"
          disabled={selectedPaths.length === 0}
          title={selectedPaths.length === 0
            ? "先选择至少 1 个文件再复制"
            : hiddenCount > 0
              ? `复制 ${selectedPaths.length} 个状态+路径（含 ${hiddenCount} 个隐藏选择），只含相对路径`
              : "复制状态与相对路径，只含相对路径"}
          onclick={copySelectedStatusPaths}
          >复制状态+路径（{selectedPaths.length}{hiddenCount > 0
            ? `，含隐藏 ${hiddenCount}`
            : ""}）</button
        >
        {#if copyFeedback}<span role="status">{copyFeedback}</span>{/if}
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
          <span class="eyebrow">按目录和文件类型生成</span>
          <h2>分组建议（仅建议，不直接移动）</h2>
          <p role="note">
            此处为本地规则或模型生成的分组建议，仅供参考；人工移动文件请走右侧“应用到
            SVN”，无需先理解建议栏。
          </p>
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
          <span class="eyebrow">人工移动到变更集</span>
          <h2>应用到 SVN</h2>
          <p role="note">
            人工操作入口：选择目标后走预览确认执行；分组建议仅在左侧展示，不直接移动文件。
          </p>
        </div>
      </div>
      <!-- V023-R26：移动到变更集选择器（已有组 + 新建入口），确认后复用既有预览/令牌执行链。 -->
      <div class="move-target-row" role="group" aria-label="移动到变更集">
        <label class="field"
          ><span>目标变更集</span><select
            aria-label="目标变更集"
            bind:value={moveTarget}
          >
            <option value="">请选择目标…</option>
            {#each snapshot.groups as group (group.name)}
              <option value={group.name}
                >{group.name}（{group.files.length} 个文件）</option
              >
            {/each}
            <option value={NEW_CHANGESET_OPTION}>新建变更集…</option>
          </select></label
        >
        <button
          class="button button--secondary"
          disabled={selectedPaths.length === 0 || !moveTarget}
          title={selectedPaths.length === 0
            ? "先在左侧选择至少 1 个文件"
            : !moveTarget
              ? "先选择目标变更集"
              : moveTarget === NEW_CHANGESET_OPTION
                ? "把已选填入应用栏，命名后生成预览"
                : `把 ${selectedPaths.length} 个已选文件移入“${moveTarget}”并生成预览`}
          onclick={moveToSelectedTarget}
          >{moveTarget === NEW_CHANGESET_OPTION
            ? `填入应用栏（${selectedPaths.length}）`
            : `移动到所选变更集（${selectedPaths.length}）`}</button
        >
        {#if moveFeedback}<span role="status">{moveFeedback}</span>{/if}
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
      <!-- V023-R26：取消只清本地草稿，不发 Host 动作、不触发写操作。 -->
      <button
        class="button button--secondary commit-button"
        disabled={!name && applyPaths.length === 0}
        title="清空名称与应用栏，不发起写操作"
        onclick={cancelMoveDraft}>取消</button
      >
      {#if snapshot.preview}
        <div class="changelist-preview">
          <code>{snapshot.preview.command}</code>
          {#each snapshot.preview.issues as issue, issueIndex (issueIndex)}<div
              class="notice notice--error"
            >
              {issue}
            </div>{/each}
          {#if previewStale}
            <div class="notice notice--warning" role="alert">
              方案已更改，旧预览已只读失效，不能凭旧确认继续执行。请重新生成预览后再确认。
            </div>
            <button
              class="button button--secondary commit-button"
              onclick={repreviewCurrentPlan}>重新生成预览</button
            >
          {/if}
          <button
            class="button button--primary commit-button"
            disabled={!snapshot.preview.canExecute || previewStale}
            title={previewStale ? "方案已更改，请重新生成预览" : undefined}
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
              // V020-R08：确认时回传用户当前看到的最终方案，Host 比对
              // 保存的方案指纹，不一致则旧 token 不得执行。
              const current = snapshot.preview;
              if (!current) return;
              if (current.remove) {
                onAction("changelist/execute-apply", {
                  previewToken: token,
                  remove: true,
                  paths: current.paths,
                });
              } else {
                onAction("changelist/execute-apply", {
                  previewToken: token,
                  name,
                  paths: applyPaths,
                  remove: false,
                });
              }
            }}
            onCancel={() => (changelistIntentOpen = false)}
            onRecheck={() => {
              changelistIntentOpen = false;
              // V020-R08：重新检查按当前方案生成新预览（新令牌），
              // 不沿用已失效的旧预览内容。
              repreviewCurrentPlan();
            }}
          />
        </div>
      {/if}
    </ScrollArea>
  </div>
</section>
