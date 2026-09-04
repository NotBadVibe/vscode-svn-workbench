<script lang="ts">
  import type {
    CommitSnapshot,
    HostToWebviewMessage,
    WebviewAction,
    WorkbenchFileView,
  } from "@protocol/workbenchProtocol";
  import { isCommitHandoffView } from "@protocol/workbenchProtocol";
  import ScrollArea from "../../components/ui/ScrollArea.svelte";
  import FilePathDetail from "../../components/svn/FilePathDetail.svelte";
  import PathCell from "../../components/list/PathCell.svelte";
  import SortHeader from "../../components/list/SortHeader.svelte";
  import SelectionSummary from "../../components/list/SelectionSummary.svelte";
  import SearchInput from "../../components/list/SearchInput.svelte";
  import ResultCount from "../../components/list/ResultCount.svelte";
  import { useFileList } from "../../components/list/useFileList.svelte";
  import CommitMessageEditor from "./CommitMessageEditor.svelte";
  import { formatZhDateTime } from "../../i18n/formatters";
  import {
    commitSelectionAiSourceLabels,
    describeCommitSelectionEvaluation,
    fileStatusLabels,
    sourceLabels,
    statusExplanations,
  } from "../../i18n/terminology";
  import StatusExplanation from "../../components/svn/StatusExplanation.svelte";
  import TaskEmptyState from "../../components/task/TaskEmptyState.svelte";
  import AssistancePanel from "../../components/assistance/AssistancePanel.svelte";
  import {
    commitAssistanceLabels,
    taskStateCopy,
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
    deriveFileTypeOptions,
    fileTypeToPattern,
    matchesFilePatterns,
    NO_EXTENSION_KEY,
  } from "../../components/list/filterPresets";
  import OperationIntentDialog from "../../components/operation/OperationIntentDialog.svelte";
  import { onboarding } from "../../app/onboarding.svelte";
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
  // v0.0.17 批次 E（C-13）：文件类型筛选与命名预设（与 Changes 共读同一份会话预设）。
  let activeFileType = $state("all");
  let activePresetId = $state<string | undefined>();
  let presetNameInput = $state("");
  let presetNameComposing = $state(false);
  let presetFeedback = $state("");
  /** v0.0.9 §4：替换前确认态（展示字符数，等待用户确认）。 */
  let replaceConfirmOpen = $state(false);
  /** 替换确认对应的目标字符数（打开时计算）。 */
  let replaceTargetLength = $state(0);
  /*
   * v0.1.4 V014-D Commit 紧凑模式：首屏只保留摘要条、提交说明、
   * 本地检查摘要与唯一主操作；完整文件选择、AI 回执/建议、团队规则
   * 与完整命令/证据分别收进按需展开区（默认收起）。
   */
  let filesExpanded = $state(false);
  let aiExpanded = $state(false);
  let teamRulesExpanded = $state(false);
  let evidenceExpanded = $state(false);

  const savedPreferences = loadListPreferences("commit");
  sortField = savedPreferences.sortField;
  sortDirection = savedPreferences.sortDirection ?? "asc";
  density = savedPreferences.density ?? "comfortable";

  const rowHeight = $derived(density === "compact" ? 36 : 48);
  const virtualizeAfter = 300;

  // v0.0.17 批次 E：类型选项从当前候选推导；预设与 Changes 共读。
  const fileTypeOptions = $derived(deriveFileTypeOptions(snapshot.files));
  const filterPresets = $derived(snapshot.filterPresets ?? []);
  const activePreset = $derived(
    filterPresets.find((preset) => preset.id === activePresetId),
  );

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

  function deletePreset(presetId: string): void {
    if (activePresetId === presetId) activePresetId = undefined;
    onAction("list/delete-filter-preset", { id: presetId });
  }

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
      // v0.0.17 批次 E：类型/预设是视图维度，不改变选择与提交范围。
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

  // v0.0.18 批次 A（C-03）：看到有效提交预览即完成引导第 4 步；
  // 第 5 步（最终确认前结束）只做说明，不出现在何执行按钮。
  $effect(() => {
    if (usablePreview) onboarding.recordStep("preview-commit");
  });

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
  const messagePrivacy = $derived(
    snapshot.aiPrivacy.find((item) => item.scenario === "message"),
  );

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

  /*
   * v0.1.6 V016-C：AssistancePanel 接线（只表达状态与事件）。
   * 回执 token 生成/绑定/消费、scope 校验、stale 判定与模型调用留在页面
   * 闭包与 Host；组件只展示来源、回执与结果状态，不持有业务状态机。
   * V016-C3a：生成建议草稿走 commitMessage 场景（aiPrivacy[message]），
   * 不得取选择场景 selectionAi（commitSelection）；判定同式 ConflictsModule
   * conflictAdviceConfigured：看相应 privacy.model 是否含「未配置」。
   */
  const assistanceConfigured = $derived(
    messagePrivacy?.model !== undefined &&
      !messagePrivacy.model.includes("未配置"),
  );
  const assistanceSourceState = $derived<
    "local-rule" | "configured-model" | "local-rule-fallback" | "unconfigured"
  >(
    suggestion
      ? suggestion.source
      : snapshot.ai
        ? snapshot.ai.source
        : assistanceConfigured
          ? "local-rule"
          : "unconfigured",
  );
  const assistanceStale = $derived(
    suggestion?.stale ?? snapshot.ai?.stale ?? false,
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
    // v0.1.6 V016-C：采用后回到提交主流程，面板自动折叠（建议由页面持有不丢失）。
    aiExpanded = false;
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
    // v0.1.6 V016-C：采用后回到提交主流程，面板自动折叠（备份与撤销契约不变）。
    aiExpanded = false;
  }

  function copySuggestion(): void {
    if (!suggestion) return;
    onAction("copy-text", { text: suggestion.message });
  }

  function discardSuggestion(): void {
    if (!suggestion) return;
    onAction("commit/discard-suggestion", { token: suggestion.token });
    // v0.1.6 V016-C：放弃后不长期挤压提交主表单，面板自动折叠。
    aiExpanded = false;
  }

  function undoSuggestionReplace(): void {
    onAction("commit/undo-suggestion-replace");
    // v0.1.6 V016-C：撤销后回到提交主流程，面板自动折叠。
    aiExpanded = false;
  }

  /*
   * v0.0.11 §3：生成入口按输入模式分支。受限差异先请求外发回执
   * （commit/preview-receipt，不调用模型），用户确认后再经
   * commit/generate-message 携带 receiptToken 实际生成。
   */
  function requestGenerate(): void {
    // V016-C3a：消息场景未配置时入口已禁用；此处再守卫一次，误触不外发。
    if (!assistanceConfigured) return;
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
    // v0.1.6 V016-C：放弃后不长期挤压提交主表单，面板自动折叠。
    aiExpanded = false;
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

  const filterLabels: Record<CommitFilter, string> = {
    all: "全部",
    selected: "已选",
    recommended: "推荐",
    needsReview: "需要确认",
    excluded: "排除",
    blocked: "阻止",
  };

  // v0.0.14 通用操作意向单：提交确认对话框（批次 C）
  let intentOpen = $state(false);
  let intentTriggerEl = $state<HTMLElement | null>(null);
  const commitIntent = $derived.by(() => {
    const preview = usablePreview;
    if (!preview) return undefined;
    const count = preview.selectedPaths.length;
    const title = `提交 ${count} 个文件`;
    const summary = `提交 ${count} 个文件 · 执行前将重新校验范围、文件状态与远端更新`;
    const stale = selectionOutOfSync;
    // v0.1.5 V015-C1 九要素补齐：revision 取预览远端修订；scope 摘要取已选文件的
    // 项目/仓库分组（与首屏摘要条同一快照来源，不虚构）；可恢复性复用活动记录固定文案。
    const scopeNames: string[] = [];
    for (const selectedPath of preview.selectedPaths) {
      const file = snapshot.files.find(
        (candidate) => candidate.relativePath === selectedPath,
      );
      const name = file?.projectName ?? file?.repositoryName ?? "";
      if (name && !scopeNames.includes(name)) scopeNames.push(name);
    }
    return {
      token: preview.token,
      kind: "commit" as const,
      title,
      summary,
      paths: preview.selectedPaths,
      scopeText: scopeNames.length > 0 ? scopeNames.join("、") : undefined,
      revision: preview.remoteRevision
        ? `r${preview.remoteRevision}`
        : undefined,
      recoverability: "此操作不能在工作台中一键撤销。",
      createdAt: preview.createdAt,
      canExecute: preview.canExecute && !stale,
      issues: preview.issues,
      commands: preview.commands,
      stale,
    };
  });

  /* V014-D 首屏摘要条：计数来自 Host 权威 selectedPaths 与 snapshot，
   * 不来自过滤后可见行；项目/仓库分组按 projectName（回退 repositoryName）。 */
  const authoritativeCount = $derived(snapshot.selectedPaths.length);
  const blockedCount = $derived(snapshot.summary.blocked);
  const selectedProjectGroups = $derived.by(() => {
    const counts: Record<string, number> = {};
    const order: string[] = [];
    for (const selectedPath of snapshot.selectedPaths) {
      const file = snapshot.files.find(
        (candidate) => candidate.relativePath === selectedPath,
      );
      const name = file?.projectName ?? file?.repositoryName ?? "";
      if (!(name in counts)) {
        counts[name] = 0;
        order.push(name);
      }
      counts[name] += 1;
    }
    return order.map((name) => [name, counts[name]] as [string, number]);
  });
  /** 本地确定性规则结果摘要（写“本地检查”字样；无自动结果时首屏仍展示
   * 既有 messageIssues 与提交前检查状态，手动入口折叠进团队规则详情）。 */
  const localRuleSummary = $derived.by(() => {
    const ai = snapshot.ai;
    // 失败态（failed）是通知不是规则结果：只在 AI 折叠区展示，不冒充本地检查。
    if (
      ai &&
      (ai.source === "local-rule" || ai.source === "local-rule-fallback") &&
      !ai.failed
    ) {
      return ai.summary;
    }
    return undefined;
  });

  /*
   * v0.1.4 V014-E2 Changes → Commit 交接显示：handoff 渲染前经
   * isCommitHandoffView 过滤，非法载荷按无交接处理（不扩大范围，不抛错）。
   * 手动改选/规则/AI 接管后 Host 即清除 handoff，快照无该字段时回到常态。
   */
  const handoff = $derived(
    snapshot.handoff && isCommitHandoffView(snapshot.handoff)
      ? snapshot.handoff
      : undefined,
  );
  /** 交接移除原因：文字标签 + 图标分组展示，不只靠颜色区分。 */
  const handoffReasonLabels: Record<string, string> = {
    disappeared: "已消失",
    excluded: "已排除",
    blocked: "阻止项",
    "cross-repository": "跨仓库",
  };
  const handoffReasonIcons: Record<string, string> = {
    disappeared: "codicon-trash",
    excluded: "codicon-eye-closed",
    blocked: "codicon-error",
    "cross-repository": "codicon-repo",
  };
  /*
   * v0.1.4 V014-E2 冲突指引：Host 在交接/刷新收缩出冲突项时置空旧 preview
   * 并在 feedback 中写入“请先到冲突模块处理冲突”；摘要区据此给出次级入口
   * （open-module conflicts/resolve）。旧 preview 区保持空态：usablePreview
   * 已在选择偏离或 Host 置空时失效，此处不渲染旧预览主操作。
   */
  const hasConflictGuidance = $derived(
    snapshot.feedback?.message.includes("请先到冲突模块处理冲突") ?? false,
  );

  /* 按需展开区的按需打开：回执/建议到达、选择 AI 结果到达时自动展开
   * AI 折叠区，保证“生成后可见”；用户可手动收起。 */
  $effect(() => {
    if (commitReceipt) aiExpanded = true;
  });
  $effect(() => {
    if (suggestion) aiExpanded = true;
  });
  $effect(() => {
    if (snapshot.ai) aiExpanded = true;
  });

  /* v0.1.5 V015-E：提交空态动作（无候选时去本地修改确认范围 / 检查远端更新）。 */
  function handlePreviewEmptyAction(action: string): void {
    if (action === "commit-goto-changes") {
      onAction("open-module", {
        moduleId: "changes",
        taskId: "changes/overview",
      });
      return;
    }
    if (action === "commit-check-update") {
      onAction("open-module", {
        moduleId: "update",
        taskId: "update/preview",
      });
      return;
    }
  }
</script>

<section class="commit-layout commit-layout--compact">
  <ScrollArea class="commit-compact" label="提交紧凑视图">
    <!-- V014-D 首屏要素 1：待提交摘要条（权威计数 + 分组 + 阻止项 + 调整入口）。 -->
    <div
      class="commit-compact-summary"
      role="region"
      aria-label="待提交文件摘要"
    >
      <div class="commit-compact-summary__head">
        <strong>待提交 {authoritativeCount} 个文件</strong>
        {#if blockedCount > 0}
          <span class="commit-compact-summary__blocked" role="status"
            ><span class="codicon codicon-error" aria-hidden="true"
            ></span>阻止项 {blockedCount} 个</span
          >
        {:else}
          <span>阻止项 0 个</span>
        {/if}
      </div>
      {#if selectedProjectGroups.length > 0}
        <p class="commit-compact-summary__groups">
          {#each selectedProjectGroups as [project, count] (project)}
            <span>{project || "未归属项目"} {count} 个文件</span>
          {/each}
        </p>
      {/if}
      <!-- v0.1.4 V014-E2：交接来源行（secondary 信息，不抢主操作）。 -->
      {#if handoff}
        <p class="commit-compact-summary__handoff">
          <span class="codicon codicon-arrow-right" aria-hidden="true"></span>
          <span>来自本地修改，范围未扩大</span>
          <!-- prettier-ignore -->
          <span role="status">已带入 {handoff.keptCount} 个文件{#if handoff.requestedCount !== handoff.keptCount}（共请求 {handoff.requestedCount} 个）{/if}</span>
        </p>
        {#if handoff.removedEntries.length > 0}
          <ul
            class="commit-compact-summary__removed"
            role="status"
            aria-label="交接时移除的文件"
          >
            {#each handoff.removedEntries as entry (entry.path)}
              <li>
                <span
                  class={`codicon ${handoffReasonIcons[entry.reason] ?? "codicon-warning"}`}
                  aria-hidden="true"
                ></span>
                <span>{handoffReasonLabels[entry.reason] ?? "已移除"}</span>
                <span>{entry.message}</span>
              </li>
            {/each}
          </ul>
        {/if}
      {/if}
      <!-- v0.1.4 V014-E2：冲突指引次级入口（button--secondary，唯一主操作不变）。 -->
      {#if hasConflictGuidance}
        <button
          type="button"
          class="button button--secondary"
          onclick={() =>
            onAction("open-module", {
              moduleId: "conflicts",
              taskId: "conflicts/resolve",
            })}
          ><span class="codicon codicon-warning" aria-hidden="true"
          ></span>处理冲突</button
        >
      {/if}
      <button
        type="button"
        class="button button--secondary"
        aria-expanded={filesExpanded}
        onclick={() => (filesExpanded = !filesExpanded)}
        >{filesExpanded ? "收起文件选择" : "调整文件"}</button
      >
    </div>
    <!-- V014-D 按需展开：完整文件选择与策略（左栏控制台原样移入，展开后功能一致）。 -->
    <details
      class="commit-compact-details commit-compact-details--files"
      bind:open={filesExpanded}
    >
      <summary>完整文件选择与策略</summary>
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
                <option value={option.value}
                  >{option.label}（{option.count}）</option
                >
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
                activePresetId = value || undefined;
                presetFeedback = "";
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
        </div>
        <!-- v0.1.6 V016-C：选择辅助降级为本地规则默认（结果进本地检查摘要，不再设“AI”按钮）。 -->
        <p class="commit-selection-demoted" role="note">
          {commitAssistanceLabels.selectionDemotedHint}
        </p>
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
              <!-- v0.0.18 批次 B（C-05）：状态词键盘可达的就地解释。 -->
              <StatusExplanation
                term={fileStatusLabels[file.status]}
                explanation={statusExplanations[file.status]}
              />
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
    </details>

    <!-- V014-D 首屏要素 2：提交说明（模板行 + 输入框 + 字数与规范保持原位语义）。 -->
    <div class="compose-section">
      <div class="section-heading">
        <div>
          <span class="eyebrow">提交内容</span>
          <h2>提交说明</h2>
        </div>
        <div class="generate-actions">
          <!-- v0.1.6 V016-C：提交说明旁只保留一个“生成建议草稿”入口；模式选择收进下方帮助面板展开区。 -->
          <!-- V016-C3a：消息场景（commitMessage）未配置时禁用，本地检查仍可用；配置后恢复。 -->
          <button
            class="button button--secondary"
            disabled={!assistanceConfigured}
            title={!assistanceConfigured
              ? commitAssistanceLabels.unconfiguredDisabledReason
              : undefined}
            aria-disabled={!assistanceConfigured}
            onclick={requestGenerate}
          >
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
      <!-- v0.1.6 V016-E：提交说明编辑区已抽取为 CommitMessageEditor（受控展示 + 事件透传，state 仍由本模块权威）。 -->
      <CommitMessageEditor
        bind:message
        templates={snapshot.templates}
        messageIssues={snapshot.messageIssues}
        conventionHint={snapshot.conventionHint}
        onApplyTemplate={(templateId) =>
          onAction("commit/apply-template", { templateId })}
        onDraftUpdate={(next) =>
          onAction("commit/update-draft", { message: next })}
        onPreviewRequest={() =>
          onAction("commit/preview", {
            selectedPaths: selectedPaths(),
            message,
          })}
      />
    </div>

    <!-- v0.1.6 V016-C：AI 建议与外发回执迁移进 AssistancePanel（回执卡的“开始模型生成”是面板内的确认动作，未展开时不出现；回执 token 仍由页面闭包携带，绝不进入组件）。 -->
    <AssistancePanel
      title={commitAssistanceLabels.panelTitle}
      summary={commitAssistanceLabels.panelSummary}
      sourceState={assistanceSourceState}
      configured={assistanceConfigured}
      expanded={aiExpanded}
      stale={assistanceStale}
      onExpand={() => (aiExpanded = true)}
      onCollapse={() => (aiExpanded = false)}
    >
      <!-- v0.1.6 V016-C：生成输入模式选择收进面板展开区（提交说明旁不再平铺）。 -->
      <div class="commit-assistance__mode">
        <label class="generate-mode">
          <span class="generate-mode__label"
            >{commitAssistanceLabels.generateModeLabel}</span
          >
          <select
            aria-label={commitAssistanceLabels.generateModeLabel}
            value={diffMode}
            onchange={(event) => {
              diffMode = (event.currentTarget as HTMLSelectElement).value as
                "metadata-only" | "limited-diff";
            }}
          >
            <option value="metadata-only"
              >{commitAssistanceLabels.metadataOnly}</option
            >
            <option value="limited-diff"
              >{commitAssistanceLabels.limitedDiff}</option
            >
          </select>
        </label>
        {#if diffMode === "limited-diff"}<p class="commit-suggestion__note">
            {commitAssistanceLabels.limitedDiffNote}
          </p>{/if}
      </div>
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
          {#if suggestion.userConfirmations?.length}<small
              class="commit-suggestion__note"
              role="status"
              >已使用 {suggestion.userConfirmations.length} 条变更解读中的会话内确认事实；过期或待复核确认不会被采用。</small
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
          <!-- v0.1.6 V016-C3b（低危 5）：建议区采用/查看动作保留内联 disabled={suggestion.stale}，
            不迁移为 AssistancePanel 的 adopt:true——它们位于 children 插槽而非 localActions/
            modelActions，组件级 stale 禁采用链仅作用于 action items；此处内联即等效禁采用。 -->
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
    </AssistancePanel>

    <!-- V014-D 按需展开：团队规则详情（规范原文 + 本地规则应用入口；首屏不再放该按钮）。 -->
    <details
      class="commit-compact-details commit-compact-details--team"
      bind:open={teamRulesExpanded}
    >
      <summary>团队规则详情</summary>
      {#if snapshot.conventionHint}
        <p class="commit-compact-details__hint">{snapshot.conventionHint}</p>
      {:else}
        <p class="commit-compact-details__hint">
          暂无团队提交规范提示；可直接手写提交说明并预览提交。
        </p>
      {/if}
      <button
        type="button"
        class="button button--secondary"
        onclick={() => onAction("commit/apply-local-rules")}
        ><span class="codicon codicon-checklist" aria-hidden="true"
        ></span>应用本地规则</button
      >
    </details>

    <!-- V014-D 首屏要素 3：本地检查摘要（自动运行的本地确定性规则结果写“本地检查”；
      无自动结果时展示既有 messageIssues 与检查状态摘要，手动规则入口已折叠）。 -->
    <div
      class="compose-section compose-section--preview"
      role="region"
      aria-label="本地检查摘要"
    >
      <div class="section-heading">
        <div>
          <span class="eyebrow">执行前确认</span>
          <h2>本地检查</h2>
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
      {#if localRuleSummary}
        <p class="commit-local-check__auto" role="status">
          本地检查：{localRuleSummary}
        </p>
      {/if}
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
        <!-- V014-D 按需展开：完整命令/证据（多仓库拆分语义保持不变）。 -->
        <details
          class="commit-compact-details commit-compact-details--evidence"
          bind:open={evidenceExpanded}
        >
          <summary>完整命令与证据</summary>
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
        </details>
        <button
          class="button button--primary commit-button"
          disabled={!usablePreview.canExecute}
          onclick={(event) => {
            intentTriggerEl = event.currentTarget as HTMLElement;
            intentOpen = true;
          }}
        >
          <span class="codicon codicon-cloud-upload" aria-hidden="true"></span>
          确认提交（{usablePreview.selectedPaths.length}）
        </button>
      {:else}
        <div class="preview-empty">
          <span class="codicon codicon-shield" aria-hidden="true"></span>
          <p>执行前将重新校验范围、文件状态、团队规范和远端更新。</p>
          {#if selected.size === 0}
            <!-- v0.1.5 V015-E：预览空态→TaskEmptyState（三句复用 taskStateCopy，第三句带明确下一步）。 -->
            {#if snapshot.files.length === 0}
              <TaskEmptyState
                icon="codicon-shield"
                what={taskStateCopy.emptyNoCandidate.what}
                whyNormal={taskStateCopy.emptyNoCandidate.whyNormal}
                whatNow={taskStateCopy.emptyNoCandidate.whatNow}
                actions={[
                  {
                    label: "回到本地修改",
                    action: "commit-goto-changes",
                    kind: "secondary",
                  },
                  {
                    label: "检查远端更新",
                    action: "commit-check-update",
                    kind: "secondary",
                  },
                ]}
                onAction={handlePreviewEmptyAction}
              />
            {:else}
              <TaskEmptyState
                icon="codicon-shield"
                what={taskStateCopy.emptyUnselected.what}
                whyNormal={taskStateCopy.emptyUnselected.whyNormal}
                whatNow={taskStateCopy.emptyUnselected.whatNow}
                actions={[]}
                onAction={handlePreviewEmptyAction}
              />
            {/if}
          {/if}
          <button
            class="button button--primary"
            disabled={selected.size === 0}
            onclick={() =>
              onAction("commit/preview", {
                selectedPaths: selectedPaths(),
                message,
              })}>预览提交 {selected.size} 个文件</button
          >
        </div>
      {/if}
    </div>
  </ScrollArea>
  <OperationIntentDialog
    intent={commitIntent}
    open={intentOpen && Boolean(commitIntent)}
    confirmLabel={`确认提交（${commitIntent?.paths.length ?? 0}）`}
    cancelLabel="取消"
    recheckLabel="重新检查"
    triggerElement={intentTriggerEl}
    {onAction}
    {pathDetail}
    onConfirm={(token) => {
      intentOpen = false;
      onAction("commit/execute", { previewToken: token });
    }}
    onCancel={() => (intentOpen = false)}
    onRecheck={() => {
      intentOpen = false;
      onAction("commit/preview", {
        selectedPaths: selectedPaths(),
        message,
      });
    }}
  />
</section>

<style>
  /*
   * v0.1.4 V014-D Commit 紧凑模式：两栏改单栏 + 按需展开区。
   * 滚动归属沿用现有 ScrollArea/scroll-region 模式，不使用全局 overflow 覆盖。
   */
  .commit-layout--compact {
    grid-template-columns: 1fr;
  }
  /* ScrollArea 将 class 透传到自身模板渲染的滚动区，需用 :global 穿透作用域；
     紧凑区本身是单栏页面的唯一纵向滚动容器（文件列表是第二层）。 */
  .commit-layout--compact > :global(.commit-compact) {
    display: flex;
    flex-direction: column;
    gap: 14px;
    height: 100%;
    min-height: 0;
    padding: 16px;
  }
  .commit-compact-summary {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    font-size: 12px;
  }
  .commit-compact-summary__head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
    font-size: 13px;
  }
  .commit-compact-summary__blocked {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-weight: 600;
  }
  .commit-compact-summary__groups {
    margin: 0;
    color: var(--muted);
    font-size: 11px;
  }
  .commit-compact-summary__groups {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 10px;
  }
  /* v0.1.4 V014-E2：交接来源行与移除清单（secondary 信息，文字 + 图标，不只靠颜色）。 */
  .commit-compact-summary__handoff {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 8px;
    margin: 0;
    color: var(--muted);
    font-size: 12px;
  }
  .commit-compact-summary__removed {
    margin: 0;
    padding-left: 18px;
    color: var(--muted);
    font-size: 12px;
  }
  .commit-compact-summary__removed li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 6px;
    margin: 2px 0;
  }
  .commit-compact-details {
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-1);
  }
  .commit-compact-details > summary {
    cursor: pointer;
    padding: 10px 12px;
    font-size: 13px;
    font-weight: 600;
  }
  .commit-compact-details > summary:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .commit-compact-details__hint {
    margin: 0 12px 8px;
    color: var(--muted);
    font-size: 12px;
  }
  .commit-compact-details--team .button {
    margin: 0 12px 12px;
  }
  .commit-compact-details--files .commit-files {
    overflow: visible;
    border-right: 0;
    padding: 4px 12px 12px;
  }
  .commit-compact-details--files :global(.commit-file-list) {
    flex: none;
    max-height: 360px;
  }
  .commit-local-check__auto {
    margin: 0 0 8px;
    font-size: 12px;
  }
  /* v0.1.6 V016-C：选择降级提示与面板内模式选择（scoped，无全局 overflow）。 */
  .commit-selection-demoted {
    margin: 8px 0 0;
    color: var(--muted);
    font-size: 12px;
  }
  .commit-assistance__mode {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
</style>
