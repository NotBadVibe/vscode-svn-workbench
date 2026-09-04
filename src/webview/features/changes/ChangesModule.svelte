<script lang="ts">
  import { ContextMenu } from "bits-ui";
  // 中文注释：V017-C T6——模块主区落点（挂载聚焦一次，刷新不抢焦点）。
  import { focusOnMount } from "../../components/ui/focusOnMount";
  import { tick } from "svelte";
  import type {
    ChangesSnapshot,
    HostToWebviewMessage,
    WebviewAction,
    WorkbenchFileStatus,
    WorkbenchFileView,
  } from "@protocol/workbenchProtocol";
  import { isContinuityRestoreView } from "@protocol/workbenchProtocol";
  import { formatZhTime } from "../../i18n/formatters";
  import {
    fileStatusLabels,
    selectionDecisionExplanations,
    statusExplanations,
  } from "../../i18n/terminology";
  import FilePathDetail from "../../components/svn/FilePathDetail.svelte";
  import StatusExplanation from "../../components/svn/StatusExplanation.svelte";
  import PathCell from "../../components/list/PathCell.svelte";
  import SortHeader from "../../components/list/SortHeader.svelte";
  import SelectionSummary from "../../components/list/SelectionSummary.svelte";
  import BulkActionBar from "../../components/list/BulkActionBar.svelte";
  import SearchInput from "../../components/list/SearchInput.svelte";
  import ResultCount from "../../components/list/ResultCount.svelte";
  import ListShortcutHint from "../../components/help/ListShortcutHint.svelte";
  import PreviewPathList from "../../components/list/PreviewPathList.svelte";
  import OperationIntentDialog from "../../components/operation/OperationIntentDialog.svelte";
  import TaskEmptyState from "../../components/task/TaskEmptyState.svelte";
  import { taskStateCopy } from "../../i18n/terminology";
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
    deriveFileTypeOptions,
    fileTypeToPattern,
    matchesFilePatterns,
    NO_EXTENSION_KEY,
  } from "../../components/list/filterPresets";
  import {
    loadListPreferences,
    saveListPreferences,
    type ListDensity,
  } from "../../app/listPreferences";
  import { onboarding } from "../../app/onboarding.svelte";

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
  /** V017-B `/` 聚焦搜索目标（集中 keymap `list/searchFocus`）。 */
  let searchInputRef = $state<{ focusInput: () => void } | undefined>();
  let activeStatus = $state<WorkbenchFileStatus | "all">("all");
  // v0.0.17 批次 E（C-13）：文件类型筛选（选项从当前候选推导）与命名预设。
  let activeFileType = $state("all");
  let activePresetId = $state<string | undefined>();
  let presetNameInput = $state("");
  let presetNameComposing = $state(false);
  let presetFeedback = $state("");
  let onlySelected = $state(false);
  let selected = $state<ReadonlySet<SelectionKey>>(emptySelection());
  let sortField = $state<SortField | undefined>();
  let sortDirection = $state<SortDirection>("asc");
  let density = $state<ListDensity>("comfortable");
  let announcement = $state("");
  /*
   * V014-C2 · 往返恢复一次性消费标记（只记已消费的载荷标识，不缓存复用载荷值）。
   * Host 恢复载荷只随快照下发一次；同一载荷对象重复渲染不再重放，保证用户
   * 在恢复后对选择/草稿/视图的手动改动拥有最终决定权。
   */
  let consumedRestorePayload: unknown;
  /*
   * V014-C2 · 恢复当次的 reset 观察只跳过这一次（非响应式标记，避免二次调度
   * 把重放后的活动行/滚动再清掉）；定位统一在 tick 后重放。
   */
  let suppressResetForRestore = false;
  let contextFile = $state<WorkbenchFileView | undefined>();
  /** 行菜单受控打开状态（Shift+F10 / Menu 键由键盘导航触发）。 */
  let rowMenuOpen = $state(false);
  let commitDraft = $state("");
  let synchronizedCommitDraft = $state("");
  let draftExpanded = $state(false);
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
    // v0.1.5 V015-C1 九要素补齐：可恢复性直传 Host 预览权威文案
    // （fileOperationRecoverability）；scope 摘要取候选文件的项目/仓库分组
    // （快照同一来源，不虚构）；revision 无权威来源，不虚构。
    const scopeNames: string[] = [];
    for (const previewPath of preview.paths) {
      const file = snapshot.files.find(
        (candidate) => candidate.relativePath === previewPath,
      );
      const name = file?.projectName ?? file?.repositoryName ?? "";
      if (name && !scopeNames.includes(name)) scopeNames.push(name);
    }
    return {
      token: preview.token,
      kind: "file-operation" as const,
      title,
      summary,
      paths: preview.paths,
      scopeText: scopeNames.length > 0 ? scopeNames.join("、") : undefined,
      recoverability: preview.recoverability,
      createdAt: new Date().toISOString(),
      // v0.1.5 V015-C2：一次确认——前置“我已核对”复选框已移除，
      // 可恢复性与清单由意向单承担；Host 复验链不变。
      canExecute: preview.canExecute && !stale,
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

  // v0.0.17 批次 E：类型选项从当前候选路径推导，不虚构取值。
  const fileTypeOptions = $derived(deriveFileTypeOptions(snapshot.files));
  const filterPresets = $derived(snapshot.filterPresets ?? []);
  const activePreset = $derived(
    filterPresets.find((preset) => preset.id === activePresetId),
  );
  const conflictedCount = $derived(snapshot.summary.conflicted ?? 0);

  const filteredFiles = $derived(
    snapshot.files.filter((file) => {
      if (activeStatus !== "all" && file.status !== activeStatus) return false;
      if (onlySelected && !selected.has(file.selectionKey)) return false;
      // 预设与类型筛选都是视图维度：只缩小可见集合，不改变选择与操作范围。
      if (
        activePreset &&
        !matchesFilePatterns(file.relativePath, activePreset.patterns)
      )
        return false;
      if (!activePreset && activeFileType !== "all") {
        const fileName = file.relativePath.split("/").pop() ?? "";
        const dot = fileName.lastIndexOf(".");
        const ext =
          dot > 0 ? fileName.slice(dot).toLowerCase() : NO_EXTENSION_KEY;
        if (ext !== activeFileType) return false;
      }
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

  /*
   * V014-B · Changes 唯一主操作派生（五态互斥，每态只渲染一个 button--primary）。
   * 数量口径均为权威合法集合（整快照 snapshot.files + isActionableForMode），
   * 禁止来自 filteredFiles 等过滤后可见行数；blocked 永不进入可提交集合。
   */
  const committableTotalCount = $derived(
    snapshot.files.filter((file) => isActionableForMode(file, MODE)).length,
  );
  const recommendedCommittableCount = $derived(
    snapshot.files.filter(
      (file) =>
        file.selection === "selected" && isActionableForMode(file, MODE),
    ).length,
  );
  const blockedRangeFiles = $derived(
    snapshot.files.filter(
      (file) => file.selection === "blocked" || file.selection === "excluded",
    ),
  );
  /** 阻止态主按钮数量：有选择时取所选阻止数，否则取范围阻止数。 */
  const blockedRelevantCount = $derived(
    selected.size > 0 ? commitBlockedSelectedCount : blockedRangeFiles.length,
  );
  type PrimaryActionKind =
    | "clean"
    | "ready"
    | "conflicts-only"
    | "blocked"
    | "suggest"
    | "select-committable";
  /**
   * V014-B · 唯一主操作判定（优先级从上到下互斥）：
   * clean（空工作副本）> ready（已选含可提交）> conflicts-only（可提交为 0 且有冲突）
   * > blocked（所选全阻止或范围无可提交）> suggest（无选择且有推荐）
   * > select-committable（无选择、有可提交但无推荐时的兜底，只灌选择）。
   */
  const primaryAction = $derived.by((): { kind: PrimaryActionKind } => {
    if (snapshot.files.length === 0) return { kind: "clean" };
    if (committableSelectedCount > 0) return { kind: "ready" };
    if (committableTotalCount === 0 && conflictedCount > 0)
      return { kind: "conflicts-only" };
    if (
      committableSelectedCount === 0 &&
      (selected.size > 0 || committableTotalCount === 0)
    )
      return { kind: "blocked" };
    if (selected.size === 0 && recommendedCommittableCount > 0)
      return { kind: "suggest" };
    return { kind: "select-committable" };
  });
  let moreOpen = $state(false);
  let moreTriggerEl = $state<HTMLElement | null>(null);
  let blockedReasonsOpen = $state(false);
  let blockedReasonsEl = $state<HTMLElement | null>(null);
  // 中文注释：V017-C T5——绑定的触发按钮引用；Esc 返回焦点用此引用，
  // 避免全局 querySelector 在状态切换时选中错误按钮。
  let blockedReasonsTrigger = $state<HTMLElement | null>(null);

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
    // V017-B `/` 聚焦搜索（集中 keymap `list/searchFocus`，仅有搜索框的列表）。
    onFocusSearch: () => searchInputRef?.focusInput(),
  });

  $effect(() => {
    query;
    activeStatus;
    onlySelected;
    // V014-C2：恢复当次跳过回顶清活动行，定位由恢复流程在 tick 后重放。
    if (suppressResetForRestore) return;
    list.resetNavigation();
  });

  /*
   * V014-C2 · Changes ↔ Diff 往返恢复一次性消费（C1 协议字段，契约七步）。
   * ① 非法载荷 fail-closed：视为缺省，不半应用；② 选择只接受与最新候选的交集；
   * ③ 身份锚优先定位、像素仅辅助钳制；④ 视图有值回填、缺省保持现状；⑤ 本地已有
   * 输入时丢弃载荷草稿；⑥ 移除原因与恢复提示经 role=status 逐条播报；⑦ 联调见
   * `?continuity=restore` mock。同一载荷对象只消费一次，值不缓存、不复用。
   */
  $effect(() => {
    const restore = snapshot.continuityRestore;
    if (restore === undefined || restore === consumedRestorePayload) return;
    consumedRestorePayload = restore;
    if (!isContinuityRestoreView(restore)) return;
    // ② 选择回填：只接受交集，不并入新文件（onlySelected 仅视图过滤）。
    // V014-E3 纵深：Host 回归时 Webview 仍排除 blocked/excluded（防旧
    // preview/选择残留进入提交篮）。
    const validKeys = new Set(snapshot.files.map((file) => file.selectionKey));
    const selectableKeys = new Set(
      snapshot.files
        .filter(
          (file) =>
            file.selection !== "blocked" && file.selection !== "excluded",
        )
        .map((file) => file.selectionKey),
    );
    selected = new Set(
      restore.selectedKeys.filter(
        (key) => validKeys.has(key) && selectableKeys.has(key),
      ),
    );
    // ④ 视图回填：有值才回填，缺省保持现状。
    const view = restore.changesView;
    suppressResetForRestore = true;
    if (view.query !== undefined) query = view.query;
    if (
      view.activeStatus !== undefined &&
      (view.activeStatus === "all" || view.activeStatus in fileStatusLabels)
    ) {
      activeStatus = view.activeStatus as WorkbenchFileStatus | "all";
    }
    if (view.activeFileType !== undefined) {
      activeFileType = view.activeFileType;
    }
    if (view.activePresetId !== undefined) {
      activePresetId = view.activePresetId;
    }
    if (view.sort !== undefined) {
      const [sortFieldText, sortDirectionText] = view.sort.split(":");
      if (
        (sortFieldText === "path" ||
          sortFieldText === "fileName" ||
          sortFieldText === "status" ||
          sortFieldText === "recommendation" ||
          sortFieldText === "ownership") &&
        (sortDirectionText === "asc" || sortDirectionText === "desc")
      ) {
        sortField = sortFieldText;
        sortDirection = sortDirectionText;
        saveListPreferences("changes", {
          sortField,
          sortDirection,
          density,
        });
      }
    }
    if (view.density !== undefined) {
      density = view.density;
      saveListPreferences("changes", { sortField, sortDirection, density });
    }
    if (view.onlySelected !== undefined) onlySelected = view.onlySelected;
    // ⑤ 草稿第二道保守：本地已有输入时丢弃载荷草稿。
    if (restore.commitDraft !== undefined && commitDraft.trim().length === 0) {
      commitDraft = restore.commitDraft;
      if (restore.commitDraft.trim().length > 0) draftExpanded = true;
    }
    // ⑥ 播报：移除原因逐条 + 恢复提示（SelectionSummary 经 role=status 播报）。
    const restoreMessages = [
      ...restore.removedEntries.map((entry) => entry.message),
      ...restore.notices,
    ].filter((message) => message.trim().length > 0);
    if (restoreMessages.length > 0) announcement = restoreMessages.join("；");
    // ③ 活动行/滚动：锚命中直接定位，像素仅锚失效时钳制，绝不用像素单独定位。
    const activeKey = restore.activeFileKey;
    const anchorKey = restore.scrollAnchorKey;
    const assistPixels = restore.scrollAssistPixels;
    void tick().then(() => {
      suppressResetForRestore = false;
      const fallbackAnchor =
        anchorKey !== undefined && anchorKey !== activeKey
          ? anchorKey
          : undefined;
      const directIndex =
        activeKey !== undefined
          ? sortedFiles.findIndex((file) => file.selectionKey === activeKey)
          : -1;
      const anchorIndex =
        fallbackAnchor !== undefined
          ? sortedFiles.findIndex(
              (file) => file.selectionKey === fallbackAnchor,
            )
          : -1;
      // 活动行优先；活动行缺失时回退到滚动锚对应行（邻项恢复已由 Host 定 active）。
      const targetIndex = directIndex >= 0 ? directIndex : anchorIndex;
      if (targetIndex >= 0) {
        list.markActive(targetIndex);
        list.setActiveRow(targetIndex);
        return;
      }
      if (typeof assistPixels === "number" && list.element) {
        const maxScrollTop =
          list.element.scrollHeight - list.element.clientHeight;
        list.element.scrollTop = Math.max(
          0,
          Math.min(assistPixels, Math.max(0, maxScrollTop)),
        );
      }
    });
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
    }
  });

  /*
   * v0.0.18 批次 A（C-03）：引导埋点——看到候选文件完成第 2 步；
   * 勾选至少一个文件完成第 3 步（冲突文件不可提交的说明在引导文案里）。
   */
  $effect(() => {
    if (snapshot.files.length > 0) onboarding.recordStep("view-changes");
  });
  $effect(() => {
    if (selected.size > 0) onboarding.recordStep("select-files");
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

  /*
   * V014-B · 权威推荐灌选择：作用于整快照可提交集合（非可见行），只灌入
   * 选择、不跳转、不打开 Commit；数量口径 = recommendedCommittableCount。
   */
  function selectRecommendedAuthoritative(): void {
    selected = mergeRecommendedSelection(
      toSelectableItems(snapshot.files, MODE),
      selected,
    );
  }

  /*
   * V014-B · 范围可提交全灌选择：等效表头全选可操作项语义，但作用于整快照
   * 权威集合（非可见行）；只灌入选择，不直接打开 Commit。
   */
  function selectAllCommittableInScope(): void {
    selected = selectActionable(
      toSelectableItems(snapshot.files, MODE),
      selected,
    );
    moreOpen = false;
  }

  function toggleBlockedReasons(trigger: HTMLElement | null): void {
    blockedReasonsOpen = !blockedReasonsOpen;
    if (blockedReasonsOpen) {
      window.setTimeout(() => blockedReasonsEl?.focus(), 0);
    } else if (trigger) {
      trigger.focus();
    }
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

  /*
   * v0.1.5 V015-E：空态动作纯透传（只映射页面已知标识，不拼接协议名）。
   * 文案三句复用 taskStateCopy，动作保持原“检查远端更新 / 查看历史”。
   */
  function handleEmptyAction(action: string): void {
    if (action === "changes-check-update") {
      onAction("open-module", {
        moduleId: "update",
        taskId: "update/preview",
      });
      return;
    }
    if (action === "changes-view-history") {
      onAction("open-module", {
        moduleId: "history",
        taskId: "history/revisions",
      });
      return;
    }
  }

  /*
   * v0.0.17 批次 E：预设保存/应用/删除。预设经会话状态总线存取
   * （list/save-filter-preset、list/delete-filter-preset），Changes 与
   * 提交页共读；保存输入带 IME composition 保护。
   */
  function saveCurrentPreset(): void {
    const name = presetNameInput.trim();
    if (!name) {
      presetFeedback = "请先填写预设名称。";
      return;
    }
    const patterns = activePreset
      ? activePreset.patterns
      : fileTypeToPattern(activeFileType);
    if (patterns.length === 0) {
      presetFeedback = "“无扩展名”筛选暂不支持保存为预设；请选择具体文件类型。";
      return;
    }
    onAction("list/save-filter-preset", { name, patterns });
    presetNameInput = "";
    presetFeedback = `已保存筛选预设“${name}”。`;
  }

  function applyPreset(presetId: string | undefined): void {
    activePresetId = presetId;
    presetFeedback = "";
  }

  function deletePreset(presetId: string): void {
    if (activePresetId === presetId) activePresetId = undefined;
    onAction("list/delete-filter-preset", { id: presetId });
  }
</script>

<section class="feature-layout" use:focusOnMount tabindex="-1">
  <div class="feature-toolbar">
    <SearchInput
      bind:this={searchInputRef}
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
    <!-- V014-B：冲突 CTA 主次由 primaryAction 决定；conflicts-only 态升为唯一 primary。 -->
    {#if conflictedCount > 0}
      <button
        class={primaryAction.kind === "conflicts-only"
          ? "button button--primary"
          : "button button--secondary"}
        data-changes-conflict-cta
        onclick={() =>
          onAction("open-module", {
            moduleId: "conflicts",
            taskId: "conflicts/resolve",
          })}
        ><span class="codicon codicon-warning" aria-hidden="true"></span>处理 {conflictedCount}
        个冲突</button
      >
    {/if}
  </div>

  <!-- v0.0.17 批次 E（C-13）：文件类型筛选与命名筛选预设（只影响视图）。 -->
  <div class="filter-preset-row" aria-label="文件类型与筛选预设">
    <select
      class="sort-menu"
      aria-label="文件类型筛选"
      disabled={Boolean(activePreset)}
      value={activePreset ? "preset" : activeFileType}
      onchange={(event) => {
        activeFileType = (event.currentTarget as HTMLSelectElement).value;
        presetFeedback = "";
      }}
    >
      {#if activePreset}
        <option value="preset">预设：{activePreset.name}</option>
      {:else}
        <option value="all">全部类型</option>
        {#each fileTypeOptions as option (option.value)}
          <option value={option.value}>{option.label}（{option.count}）</option>
        {/each}
      {/if}
    </select>
    {#if filterPresets.length > 0}
      <select
        class="sort-menu"
        aria-label="筛选预设"
        value={activePresetId ?? ""}
        onchange={(event) => {
          const value = (event.currentTarget as HTMLSelectElement).value;
          applyPreset(value || undefined);
        }}
      >
        <option value="">不使用预设</option>
        {#each filterPresets as preset (preset.id)}
          <option value={preset.id}
            >{preset.name}（{preset.patterns.join("、")}）</option
          >
        {/each}
      </select>
      {#if activePreset}
        <button
          class="button button--secondary"
          aria-label={`删除筛选预设 ${activePreset.name}`}
          onclick={() => deletePreset(activePreset.id)}>删除预设</button
        >
      {/if}
    {/if}
    <input
      class="filter-preset-name"
      aria-label="筛选预设名称"
      placeholder="预设名称…"
      bind:value={presetNameInput}
      oncompositionstart={() => (presetNameComposing = true)}
      oncompositionend={() => (presetNameComposing = false)}
      onkeydown={(event) => {
        // IME 候选阶段的 Enter 不触发保存。
        if (event.key === "Enter" && !presetNameComposing) {
          event.preventDefault();
          saveCurrentPreset();
        }
      }}
    />
    <button
      class="button button--secondary"
      disabled={activeFileType === "all" && !activePreset}
      title={activeFileType === "all" && !activePreset
        ? "先选择文件类型或预设，再保存"
        : undefined}
      onclick={saveCurrentPreset}>保存为预设</button
    >
    {#if presetFeedback}<span role="status">{presetFeedback}</span>{/if}
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
    <!-- V017-B 列表紧凑提示条（按区域实际绑定生成，可忽略、可关闭）。 -->
    <ListShortcutHint region="list" hintKey="changes-list" searchAvailable />
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
      <!-- v0.1.5 V015-E：手写空态→TaskEmptyState（三句复用 taskStateCopy，动作与语义不变）。 -->
      {#if snapshot.files.length === 0}
        <TaskEmptyState
          icon="codicon-check-all"
          what={taskStateCopy.emptyClean.what}
          whyNormal={taskStateCopy.emptyClean.whyNormal}
          whatNow={taskStateCopy.emptyClean.whatNow}
          actions={[
            {
              label: "检查远端更新",
              action: "changes-check-update",
              kind: "primary",
              icon: "codicon-sync",
            },
            {
              label: "查看历史",
              action: "changes-view-history",
              kind: "secondary",
            },
          ]}
          onAction={handleEmptyAction}
        />
      {:else if onlySelected}
        <TaskEmptyState
          icon="codicon-filter"
          what={taskStateCopy.filterSelectedHidden.what}
          whyNormal={taskStateCopy.filterSelectedHidden.whyNormal}
          whatNow={taskStateCopy.filterSelectedHidden.whatNow}
          actions={[]}
          onAction={handleEmptyAction}
        />
      {:else}
        <TaskEmptyState
          icon="codicon-search"
          what={taskStateCopy.filterNoMatch.what}
          whyNormal={taskStateCopy.filterNoMatch.whyNormal}
          whatNow={taskStateCopy.filterNoMatch.whatNow}
          actions={[]}
          onAction={handleEmptyAction}
        />
      {/if}
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
                    <!-- v0.0.18 批次 B（C-05）：状态词键盘可达的就地解释。 -->
                    <StatusExplanation
                      term={fileStatusLabels[file.status]}
                      explanation={statusExplanations[file.status]}
                    />
                    <span class="selection-note" title={file.reason}
                      >{file.reason ??
                        (file.selection
                          ? selectionLabels[file.selection]
                          : "—")}</span
                    >
                    {#if file.selection}
                      <StatusExplanation
                        term={selectionLabels[file.selection]}
                        explanation={selectionDecisionExplanations[
                          file.selection
                        ]}
                      />
                    {/if}
                    <span class="file-row__ownership"
                      >{file.projectName ?? file.repositoryName ?? "—"}</span
                    >
                    {#if file.status === "conflicted"}
                      <!-- v0.0.17 批次 B（U-06）：冲突行直达冲突处理（范围不变）。 -->
                      <button
                        class="icon-button icon-button--small"
                        aria-label={`处理 ${file.relativePath} 的冲突`}
                        onclick={() =>
                          onAction("open-module", {
                            moduleId: "conflicts",
                            taskId: "conflicts/resolve",
                          })}
                        ><span
                          class="codicon codicon-warning"
                          aria-hidden="true"
                        ></span></button
                      >
                    {/if}
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
    <!--
      V014-B · 唯一主操作底栏：五态互斥，每态最多一个 button--primary。
      ready 态主操作“检查并提交所选”；suggest/select-committable 态主操作只灌选择
      不跳转；blocked 态主操作展开阻止原因；conflicts-only/clean 态主操作分别位于
      状态筛选区与空状态，本栏只保留次级动作（加入变更集 + 更多），不渲染 primary。
    -->
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
      {#if primaryAction.kind === "ready"}
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
          <span class="codicon codicon-check" aria-hidden="true"></span>
          检查并提交所选（{committableSelectedCount}）
        </button>
      {:else if primaryAction.kind === "suggest"}
        <button
          class="button button--primary"
          onclick={selectRecommendedAuthoritative}
        >
          <span class="codicon codicon-checklist" aria-hidden="true"></span>
          选择建议的 {recommendedCommittableCount} 个文件
        </button>
      {:else if primaryAction.kind === "select-committable"}
        <button
          class="button button--primary"
          disabled={committableTotalCount === 0}
          onclick={selectAllCommittableInScope}
        >
          <span class="codicon codicon-checklist" aria-hidden="true"></span>
          选择当前范围可提交的 {committableTotalCount} 个文件
        </button>
      {:else if primaryAction.kind === "blocked"}
        <button
          class="button button--primary"
          bind:this={blockedReasonsTrigger}
          onclick={(event) =>
            toggleBlockedReasons(event.currentTarget as HTMLElement)}
          aria-expanded={blockedReasonsOpen}
        >
          <span class="codicon codicon-warning" aria-hidden="true"></span>
          查看阻止原因（{blockedRelevantCount}）
        </button>
      {/if}
      <div class="toolbar-more">
        <button
          class="button button--secondary"
          bind:this={moreTriggerEl}
          aria-haspopup="menu"
          aria-expanded={moreOpen}
          aria-label="更多批量操作"
          onclick={() => (moreOpen = !moreOpen)}
          onkeydown={(event) => {
            if (event.key === "Escape" && moreOpen) {
              event.stopPropagation();
              moreOpen = false;
              moreTriggerEl?.focus();
            }
          }}>更多</button
        >
        {#if moreOpen}
          <div class="toolbar-more-menu" role="menu" aria-label="更多批量操作">
            <button
              role="menuitem"
              class="button button--secondary"
              disabled={committableTotalCount === 0}
              title="只把当前范围全部可提交项加入选择，不打开提交页"
              onclick={selectAllCommittableInScope}
            >
              选择当前范围可提交的 {committableTotalCount} 个文件
            </button>
            <div class="toolbar-more-hint" role="note">
              只灌入选择、不打开提交页；等效表头全选可操作项，作用于当前范围权威集合
            </div>
          </div>
        {/if}
      </div>
    </BulkActionBar>
    {#if primaryAction.kind === "blocked" && blockedReasonsOpen}
      <div
        class="blocked-reasons"
        role="status"
        aria-label="阻止提交原因"
        tabindex="-1"
        bind:this={blockedReasonsEl}
        onkeydown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            blockedReasonsOpen = false;
            blockedReasonsTrigger?.focus();
          }
        }}
      >
        <p>
          <span class="codicon codicon-warning" aria-hidden="true"></span>
          当前没有可提交项：所选或范围内文件被安全规则阻止（冲突、外部工作副本或已排除项不会进入提交）。
        </p>
        {#if blockedRangeFiles.length > 0}
          <ul>
            {#each blockedRangeFiles as file (file.selectionKey)}
              <li>
                {file.relativePath} · {file.reason ??
                  (file.selection === "blocked" ? "不可提交" : "已排除")}
              </li>
            {/each}
          </ul>
        {:else}
          <p>请选择可提交文件，或前往环境诊断排查工作副本状态。</p>
        {/if}
      </div>
    {/if}
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
      {#if snapshot.operationPreview.destructive}
        <div class="notice notice--warning" role="note">
          <span class="codicon codicon-warning" aria-hidden="true"></span><span
            >还原/删除将丢弃未提交内容，清单与可恢复性以弹出的意向单为准，确认前请逐项核对。</span
          >
        </div>
      {/if}
      <button
        class="button button--primary commit-button"
        disabled={!snapshot.operationPreview.canExecute ||
          previewSelectionOutOfSync}
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
        recheckLabel="重新检查"
        triggerElement={fileOpTriggerEl}
        {onAction}
        {pathDetail}
        onConfirm={(token) => {
          fileOpIntentOpen = false;
          onAction("changes/execute-operation", { previewToken: token });
        }}
        onCancel={() => (fileOpIntentOpen = false)}
        onRecheck={() => {
          fileOpIntentOpen = false;
          const current = snapshot.operationPreview;
          if (!current) return;
          onAction("changes/preview-operation", {
            operation: current.operation,
            paths: current.paths,
            ignoreMode: current.ignoreMode,
          });
        }}
      />
    </div>
  {/if}
</section>

<style>
  /* V014-B · 更多菜单与阻止原因区（复用冲突页 toolbar-more 模式，不引入新依赖）。 */
  .toolbar-more {
    position: relative;
  }
  .toolbar-more-menu {
    position: absolute;
    bottom: 100%;
    right: 0;
    min-width: 240px;
    padding: 8px;
    border: 1px solid var(--vscode-panel-border);
    background: var(--vscode-dropdown-background);
    border-radius: 6px;
    z-index: 4;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .toolbar-more-hint {
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
  }
  .blocked-reasons {
    border-top: 1px solid var(--border);
    padding: 8px 10px;
    font-size: 12px;
  }
  .blocked-reasons ul {
    margin: 6px 0 0;
    padding-left: 18px;
  }
</style>
