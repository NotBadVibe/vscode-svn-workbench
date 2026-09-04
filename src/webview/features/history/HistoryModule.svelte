<script lang="ts">
  import { SvelteSet } from "svelte/reactivity";
  // 中文注释：V017-C T6——模块主区落点（挂载聚焦一次，刷新不抢焦点）。
  import { focusOnMount } from "../../components/ui/focusOnMount";
  import type {
    HistoryQueryView,
    HistorySnapshot,
    HostToWebviewMessage,
    WebviewAction,
  } from "@protocol/workbenchProtocol";
  import ScrollArea from "../../components/ui/ScrollArea.svelte";
  import SearchInput from "../../components/list/SearchInput.svelte";
  import ResultCount from "../../components/list/ResultCount.svelte";
  import FilePathDetail from "../../components/svn/FilePathDetail.svelte";
  import { useFileList } from "../../components/list/useFileList.svelte";
  import PrimaryActionBar from "../../components/task/PrimaryActionBar.svelte";
  import ResultNextStep from "../../components/task/ResultNextStep.svelte";
  import TaskEmptyState from "../../components/task/TaskEmptyState.svelte";
  import TaskSummary from "../../components/task/TaskSummary.svelte";
  import OperationIntentDialog from "../../components/operation/OperationIntentDialog.svelte";
  import type { OperationIntentView } from "../../../operation/operationIntent";
  import { isOperationIntentStale } from "../../../operation/operationIntent";
  import { naturalCompare } from "../../../selection/selectionSort";
  import { formatZhDateTime } from "../../i18n/formatters";
  import {
    historyCompareCount,
    historyLoadedStatus,
  } from "../../i18n/terminology";

  /*
   * v0.0.10 跨模块列表迁移：修订列表复用共享搜索（清除、结果数量）、
   * 最新/最早排序与键盘导航；比较固定 2 条（无全选）；Changed Paths
   * 支持路径搜索、操作类型筛选与路径/操作排序，路径行提供复制与
   * 路径详情（范围外路径由 Host 如实拒绝并说明原因）。
   */

  let {
    snapshot,
    onAction,
    pathDetail,
    scopeHash,
    repositoryUuid,
  }: {
    snapshot: HistorySnapshot;
    onAction: (action: WebviewAction, data?: Record<string, unknown>) => void;
    /** v0.0.10：路径详情结果（Host 一次性下发）。 */
    pathDetail?: Extract<
      HostToWebviewMessage,
      { type: "file/path-detail-result" }
    >["payload"];
    /**
     * v0.1.6 V016-F1：信封当前绑定（意向单自检 stale 的“当前值”侧）。
     * 缺省时回退快照内绑定，不误判。
     */
    scopeHash?: string;
    repositoryUuid?: string;
  } = $props();

  let query = $state("");
  /** 修订排序：默认最新在前（Host 快照顺序）；可切换最早在前。 */
  let revisionOrder = $state<"newest" | "oldest">("newest");
  let pathQuery = $state("");
  let pathActionFilter = $state<string>("all");
  let pathSort = $state<"path" | "action">("path");
  /** v0.0.18 C-06：仅用于下一次“加载更早”的只读请求，不影响本地搜索。 */
  let loadQuery = $state<HistoryQueryView>({});
  const compare = new SvelteSet<string>();

  $effect(() => {
    compare.clear();
    for (const revision of snapshot.compareRevisions) {
      compare.add(revision);
    }
  });

  // Host 成功应用条件后，以快照中的实际条件回填；未成功请求不会覆盖用户输入。
  $effect(() => {
    loadQuery = { ...(snapshot.query ?? {}) };
  });

  const visible = $derived(
    snapshot.revisions.filter((item) => {
      const value = query.trim().toLowerCase();
      return (
        !value ||
        item.message.toLowerCase().includes(value) ||
        item.author.toLowerCase().includes(value) ||
        item.revision.includes(value)
      );
    }),
  );

  const orderedRevisions = $derived(
    revisionOrder === "newest"
      ? visible
      : [...visible].sort(
          (left, right) =>
            Number(left.revision) - Number(right.revision) ||
            naturalCompare(left.revision, right.revision),
        ),
  );

  const selected = $derived(
    snapshot.revisions.find(
      (item) => item.revision === snapshot.selectedRevision,
    ) ?? snapshot.revisions[0],
  );

  const staleness = $derived.by(() => {
    if (!snapshot.freshness) return { stale: false, minutesAgo: 0 };
    const minutesAgo = Math.floor(
      (Date.now() - new Date(snapshot.freshness.capturedAt).getTime()) / 60000,
    );
    const isStale = minutesAgo >= 5;
    return { stale: isStale, minutesAgo };
  });

  const changeActionLabels: Record<string, string> = {
    A: "新增",
    M: "修改",
    D: "删除",
    R: "替换",
  };

  /** 当前修订里实际出现的操作类型（筛选按钮据此生成，不虚构类型）。 */
  const availableActions = $derived(
    [
      ...new Set(selected?.changedPaths.map((item) => item.action) ?? []),
    ].sort(),
  );

  const filteredChangedPaths = $derived.by(() => {
    const paths = selected?.changedPaths ?? [];
    const needle = pathQuery.trim().toLowerCase();
    const filtered = paths.filter((item) => {
      if (pathActionFilter !== "all" && item.action !== pathActionFilter) {
        return false;
      }
      if (!needle) return true;
      return (
        item.path.toLowerCase().includes(needle) ||
        (item.copyFromPath ?? "").toLowerCase().includes(needle)
      );
    });
    return [...filtered].sort((left, right) => {
      if (pathSort === "action" && left.action !== right.action) {
        return naturalCompare(left.action, right.action);
      }
      return naturalCompare(left.path, right.path);
    });
  });

  const list = useFileList<(typeof orderedRevisions)[number]>({
    rows: () => orderedRevisions,
    rowHeight: () => 64,
    onPathDetailRequest: (relativePath) =>
      onAction("file/path-detail", { relativePath }),
    onActivate: (revision) =>
      onAction("history/select", {
        revision: revision.revision,
        compareRevisions: [...compare],
      }),
    onToggleActive: (revision) => toggleCompare(revision.revision),
  });

  $effect(() => {
    query;
    revisionOrder;
    list.resetNavigation();
  });

  // 新的路径详情结果到达时自动展开；关闭后恢复触发按钮焦点。
  $effect(() => {
    if (pathDetail) list.markPathDetailArrived();
  });

  function toggleCompare(revision: string): void {
    if (compare.has(revision)) {
      compare.delete(revision);
    } else {
      if (compare.size >= 2) {
        // 固定两条：加入第三条时淘汰最早选择，不提供全选。
        compare.delete([...compare][0]);
      }
      compare.add(revision);
    }
  }

  function clearCompare(): void {
    compare.clear();
  }

  function updateLoadQuery(key: keyof HistoryQueryView, value: string): void {
    loadQuery = { ...loadQuery, [key]: value };
  }

  // v0.1.5 V015-D2：加载更多携带本地比较选择，Host 回显后快照刷新不丢选中；
  // 为空时不发送该键，保持既有只读请求契约不变。
  function requestMoreHistory(): void {
    const selection = [...compare];
    onAction(
      "history/load-more",
      selection.length > 0
        ? { ...loadQuery, compareRevisions: selection }
        : { ...loadQuery },
    );
  }

  function describeHistoryQuery(query: HistoryQueryView | undefined): string {
    if (!query) return "";
    const parts: string[] = [];
    if (query.revisionFrom || query.revisionTo) {
      parts.push(
        `修订 r${query.revisionFrom ?? "1"} 至 r${query.revisionTo ?? "HEAD"}`,
      );
    }
    if (query.author) parts.push(`作者“${query.author}”`);
    if (query.dateFrom || query.dateTo) {
      parts.push(
        `日期 ${query.dateFrom ?? "最早"} 至 ${query.dateTo ?? "今天"}`,
      );
    }
    return parts.join("、");
  }

  const appliedQueryDescription = $derived(
    describeHistoryQuery(snapshot.query),
  );

  // v0.1.5 V015-B2：已加载数量 + 只读条件 + 快照新鲜度收敛进一条 TaskSummary compact（计算逻辑不动）。
  const loadedStatus = $derived(
    historyLoadedStatus(snapshot.revisions.length, snapshot.hasMore),
  );
  const loadedReason = $derived(
    appliedQueryDescription
      ? `当前按${appliedQueryDescription}加载；再次加载会保留这些条件。`
      : undefined,
  );
  const loadedNextStep = $derived(
    staleness.stale
      ? `此结果基于 ${staleness.minutesAgo} 分钟前的状态，工作副本可能已变化，建议刷新`
      : undefined,
  );

  /**
   * v0.1.5 V015-B2：恢复执行结果（Host 模板“已恢复为 rN 内容；尚未提交。”）
   * 才走 ResultNextStep；blame / 加载更早等其他 feedback 保持原 notice。
   */
  const isRestoreFeedback = $derived(
    Boolean(
      snapshot.feedback &&
      snapshot.feedback.includes("已恢复为") &&
      snapshot.feedback.includes("尚未提交"),
    ),
  );

  /*
   * v0.1.5 V015-C1：历史恢复接入通用意向单（唯一未走意向单的写操作）。
   * kind 扩展为 history-restore（单文件覆盖恢复与 revert 语义不同，不复用
   * file-operation）；Host 侧 token + contentHash 复验链不动。
   * 新 token 到达即打开对话框；取消后同 token 不再自动重开，重新预览
   * 产生新 token 才会再次打开。
   */
  let restoreIntentOpen = $state(false);
  let restoreTriggerEl = $state<HTMLElement | null>(null);
  let seenRestoreToken = $state<string | undefined>(undefined);
  /*
   * v0.1.6 V016-F1：恢复预览生成时绑定（token 首见时快照，Host 随预览下发）。
   * 与当前绑定比对自检 stale：范围/仓库变化后，对话框在确认前即只读展示
   * （文件内容变化仍由 Host 的 contentHash 复验拒绝并作废预览）。
   */
  let restoreBinding = $state<
    | {
        token: string;
        scopeHash?: string;
        repositoryUuid?: string;
        revision?: string;
      }
    | undefined
  >(undefined);
  const restoreIntent = $derived.by((): OperationIntentView | undefined => {
    const preview = snapshot.restorePreview;
    if (!preview) return undefined;
    const title = `历史恢复 1 个文件`;
    return {
      token: preview.token,
      kind: "history-restore" as const,
      title,
      summary: `${title} · 将用 r${preview.revision} 覆盖工作副本文件，执行前将重新校验`,
      paths: [preview.relativePath],
      scopeText: preview.relativePath,
      revision: `r${preview.revision}`,
      recoverability:
        "将用所选修订覆盖工作副本文件，但不会自动提交；原内容不可自动恢复。",
      createdAt: new Date().toISOString(),
      canExecute: preview.canExecute,
      issues: preview.issues,
      commands: [preview.command],
      scopeHash: preview.scopeHash,
      repositoryUuid: preview.repositoryUuid,
      stale: restoreBinding
        ? isOperationIntentStale(
            {
              scopeHash: restoreBinding.scopeHash,
              repositoryUuid: restoreBinding.repositoryUuid,
              revision: restoreBinding.revision,
            },
            {
              repositoryUuid:
                repositoryUuid ?? restoreBinding.repositoryUuid ?? "",
              scopeHash:
                scopeHash ??
                restoreBinding.scopeHash ??
                snapshot.freshness?.scopeHash ??
                "",
              candidateHash: undefined,
              revision: snapshot.freshness?.revision,
            },
          )
        : false,
    };
  });
  $effect(() => {
    const preview = snapshot.restorePreview;
    if (preview && restoreBinding?.token !== preview.token) {
      restoreBinding = {
        token: preview.token,
        scopeHash: preview.scopeHash,
        repositoryUuid: preview.repositoryUuid,
        revision: snapshot.freshness?.revision,
      };
    }
    if (!preview) restoreBinding = undefined;
  });
  $effect(() => {
    const preview = snapshot.restorePreview;
    const token = preview?.token;
    if (token && token !== seenRestoreToken) {
      seenRestoreToken = token;
      // v0.1.6 V016-F1：blocked 预览（canExecute:false）不自动弹模态，
      // 走内联错误 + 重试入口；仅可执行预览自动打开确认对话框。
      if (preview?.canExecute) restoreIntentOpen = true;
    }
    if (!token) {
      seenRestoreToken = undefined;
      restoreIntentOpen = false;
    }
  });

  /** blocked 预览的内联重试入口（与意向单“重新检查”同一动作）。 */
  function recheckRestore(): void {
    restoreIntentOpen = false;
    onAction("history/preview-restore", {
      revision: snapshot.restorePreview?.revision,
    });
  }

  /** ResultNextStep / TaskEmptyState 动作纯透传：只映射页面已知标识。 */
  function handleHistoryResultAction(action: string): void {
    if (action === "history-view-changes") {
      onAction("open-module", {
        moduleId: "changes",
        taskId: "changes/overview",
      });
      return;
    }
    if (action === "history/load-more") {
      requestMoreHistory();
    }
  }
</script>

<section class="history-layout" use:focusOnMount tabindex="-1">
  <div class="history-list-pane">
    <div class="feature-toolbar feature-toolbar--compact">
      <div>
        <h2>修订历史</h2>
        <!-- v0.1.5 V015-B2：已加载数量 + 条件 + 新鲜度→TaskSummary compact（v0.0.18 C-06 文案不动）。 -->
        <TaskSummary
          variant="compact"
          tone={staleness.stale ? "warning" : "info"}
          icon="codicon-history"
          status={loadedStatus}
          reason={loadedReason}
          nextStep={loadedNextStep}
        />
      </div>
      <SearchInput
        bind:value={query}
        ariaLabel="筛选历史"
        placeholder="筛选已加载结果：作者、说明、修订号…"
        compact
      />
      <ResultCount count={orderedRevisions.length} suffix="条修订" />
      <div class="toolbar-actions">
        {#if snapshot.hasMore}
          <button
            class="button button--secondary"
            data-load-more
            onclick={requestMoreHistory}
            >加载更早修订（已加载 {snapshot.revisions.length}）</button
          >
        {/if}
        <select
          class="sort-menu"
          aria-label="修订排序"
          value={revisionOrder}
          onchange={(event) => {
            const value = (event.currentTarget as HTMLSelectElement).value;
            revisionOrder = value === "oldest" ? "oldest" : "newest";
          }}
        >
          <option value="newest">最新在前</option>
          <option value="oldest">最早在前</option>
        </select>
      </div>
    </div>
    <!-- v0.1.5 V015-D2：本地筛选与仓库查询的语义边界——搜索框只过滤已加载结果，历史请求只走下方条件。 -->
    <p class="history-filter-hint">
      修订搜索仅在已加载结果内筛选，不会向仓库请求；需要更早修订时，请用下方的条件表单发起新的只读请求。
    </p>
    <details class="history-load-conditions">
      <summary>按条件加载更早修订</summary>
      <div class="history-load-conditions__fields">
        <label
          >较早修订号
          <input
            aria-label="较早修订号"
            inputmode="numeric"
            placeholder="例如 100"
            value={loadQuery.revisionFrom ?? ""}
            oninput={(event) =>
              updateLoadQuery(
                "revisionFrom",
                (event.currentTarget as HTMLInputElement).value,
              )}
          />
        </label>
        <label
          >较晚修订号
          <input
            aria-label="较晚修订号"
            inputmode="numeric"
            placeholder="例如 200"
            value={loadQuery.revisionTo ?? ""}
            oninput={(event) =>
              updateLoadQuery(
                "revisionTo",
                (event.currentTarget as HTMLInputElement).value,
              )}
          />
        </label>
        <label
          >作者
          <input
            aria-label="历史作者"
            placeholder="包含匹配"
            value={loadQuery.author ?? ""}
            oninput={(event) =>
              updateLoadQuery(
                "author",
                (event.currentTarget as HTMLInputElement).value,
              )}
          />
        </label>
        <label
          >开始日期
          <input
            aria-label="历史开始日期"
            type="date"
            value={loadQuery.dateFrom ?? ""}
            oninput={(event) =>
              updateLoadQuery(
                "dateFrom",
                (event.currentTarget as HTMLInputElement).value,
              )}
          />
        </label>
        <label
          >结束日期
          <input
            aria-label="历史结束日期"
            type="date"
            value={loadQuery.dateTo ?? ""}
            oninput={(event) =>
              updateLoadQuery(
                "dateTo",
                (event.currentTarget as HTMLInputElement).value,
              )}
          />
        </label>
      </div>
      <p>
        条件只限制本次只读历史请求，不改变当前范围；条件变化后会从首批重新读取。加载期间可使用页面顶部的“取消”。
      </p>
    </details>
    <!-- v0.1.5 V015-B2：比较栏→PrimaryActionBar（唯一 primary + 数量口径一致；修订不可变，不接 stale）。 -->
    <PrimaryActionBar
      countText={historyCompareCount(compare.size)}
      primary={{
        label: "比较所选修订",
        disabled: compare.size !== 2,
        disabledReason: "请选择 2 条修订后再比较。",
        onClick: () => onAction("history/compare", { revisions: [...compare] }),
      }}
      secondary={[
        {
          label: "清空比较选择",
          disabled: compare.size === 0,
          onClick: clearCompare,
        },
      ]}
      ariaLabel="修订比较操作栏"
    />
    <ScrollArea
      class="revision-list"
      role="list"
      label="SVN 修订列表"
      bind:element={list.element}
      onScroll={list.handleScroll}
      onKeydown={list.handleKeydown}
    >
      {#if orderedRevisions.length === 0}
        <div class="mini-empty">
          {snapshot.revisions.length === 0
            ? "当前范围没有可显示的修订记录。"
            : snapshot.hasMore
              ? "已加载的最近修订中没有匹配；更早的修订尚未加载，可点击“加载更早修订”后再搜索。"
              : "没有匹配的修订；调整搜索词或清除筛选后重试。"}
        </div>
      {/if}
      {#each list.visibleRows as { row: revision, index } (revision.revision)}
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -- 行点击只设置活动行；键盘操作由列表容器统一处理。 -->
        <div
          class:active={selected?.revision === revision.revision}
          class:revision-row--compare-selected={compare.has(revision.revision)}
          class:revision-row--keyboard-active={list.activeIndex === index}
          class="revision-row"
          role="listitem"
          data-row-index={index}
          tabindex="-1"
          onclick={() => list.markActive(index)}
        >
          <button
            class="revision-select"
            aria-label={`查看修订 ${revision.revision}`}
            onclick={() =>
              onAction("history/select", {
                revision: revision.revision,
                compareRevisions: [...compare],
              })}
          >
            <span class="revision-dot" aria-hidden="true"></span>
            <span class="revision-content">
              <strong>r{revision.revision} · {revision.author}</strong>
              <span>{revision.message || "无提交说明"}</span>
              <small>{formatZhDateTime(revision.date)}</small>
            </span>
          </button>
          <input
            type="checkbox"
            aria-label={`选择修订 ${revision.revision} 进行比较`}
            checked={compare.has(revision.revision)}
            onchange={() => toggleCompare(revision.revision)}
          />
        </div>
      {/each}
    </ScrollArea>
  </div>
  <ScrollArea class="revision-detail" label="修订详情">
    {#if selected}
      <div class="revision-detail-header">
        <div>
          <span class="eyebrow">修订详情</span>
          <h2>r{selected.revision}</h2>
        </div>
        <div class="toolbar-actions">
          {#if snapshot.fileActionsAvailable}<button
              class="button button--secondary"
              onclick={() => onAction("history/blame")}>查看逐行责任</button
            ><button
              class="button button--secondary"
              onclick={(event) => {
                restoreTriggerEl = event.currentTarget as HTMLElement | null;
                onAction("history/preview-restore", {
                  revision: selected.revision,
                });
              }}>从此修订恢复</button
            >{/if}
          <span class="status-badge">{selected.author}</span>
        </div>
      </div>
      <!-- v0.1.5 V015-B2：新鲜度已并入列表区 TaskSummary；恢复结果用 ResultNextStep，其余 feedback 保持原 notice。 -->
      {#if isRestoreFeedback && snapshot.feedback}
        <ResultNextStep
          tone="success"
          result={snapshot.feedback}
          nextStep="下一步：查看本地修改，确认恢复内容符合预期后再决定是否提交。"
          recoveryHint="如需撤销，可从历史记录再次恢复，或在本地修改中还原该文件。"
          actions={[
            {
              label: "查看本地修改",
              action: "history-view-changes",
              kind: "primary",
            },
          ]}
          onAction={handleHistoryResultAction}
        />
      {:else if snapshot.feedback}<div
          class="notice notice--success"
          role="status"
        >
          {snapshot.feedback}
        </div>{/if}
      <p class="revision-message">{selected.message || "无提交说明"}</p>
      <div class="detail-meta">
        <span>{formatZhDateTime(selected.date)}</span><span
          >{selected.changedPaths.length} 条变更路径</span
        >
      </div>
      <h3>变更路径</h3>
      <div class="changed-paths-toolbar">
        <SearchInput
          bind:value={pathQuery}
          ariaLabel="筛选变更路径"
          placeholder="路径…"
          compact
        />
        <ResultCount count={filteredChangedPaths.length} suffix="条路径" />
        <div class="status-filters" aria-label="操作类型筛选">
          <button
            class:active={pathActionFilter === "all"}
            onclick={() => (pathActionFilter = "all")}
            >全部 {selected.changedPaths.length}</button
          >
          {#each availableActions as action (action)}
            <button
              class:active={pathActionFilter === action}
              onclick={() => (pathActionFilter = action)}
              >{changeActionLabels[action] ?? action}
              {selected.changedPaths.filter((item) => item.action === action)
                .length}</button
            >
          {/each}
        </div>
        <select
          class="sort-menu"
          aria-label="变更路径排序"
          value={pathSort}
          onchange={(event) => {
            const value = (event.currentTarget as HTMLSelectElement).value;
            pathSort = value === "action" ? "action" : "path";
          }}
        >
          <option value="path">按路径</option>
          <option value="action">按操作类型</option>
        </select>
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
      <ScrollArea class="changed-paths" label="当前修订的变更路径">
        {#if filteredChangedPaths.length === 0}
          <div class="mini-empty">
            {selected.changedPaths.length === 0
              ? "该修订没有变更路径。"
              : "没有匹配的变更路径；调整搜索词或操作类型筛选。"}
          </div>
        {/if}
        {#each filteredChangedPaths as item (`${item.action}:${item.path}`)}
          <div class="changed-path-row">
            <span
              class={`change-action change-action--${item.action.toLowerCase()}`}
              title={changeActionLabels[item.action] ?? item.action}
              >{item.action}</span
            >
            <span class="changed-path-text" title={item.path}>{item.path}</span>
            <button
              type="button"
              class="icon-button icon-button--small"
              aria-label={`复制路径 ${item.path}`}
              title="复制路径"
              onclick={() => onAction("copy-text", { text: item.path })}
              ><span class="codicon codicon-copy" aria-hidden="true"
              ></span></button
            >
            <button
              type="button"
              class="icon-button icon-button--small"
              aria-label={`查看 ${item.path} 路径详情`}
              title="路径详情"
              onclick={(event) =>
                list.requestPathDetail(item.path, event.currentTarget)}
              ><span class="codicon codicon-info" aria-hidden="true"
              ></span></button
            >
            {#if item.copyFromPath}<small
                >来自 {item.copyFromPath}@{item.copyFromRevision}</small
              >{/if}
          </div>
        {/each}
      </ScrollArea>
      {#if snapshot.blame}
        <h3>逐行责任</h3>
        <ScrollArea class="blame-view" label="文件逐行责任">
          {#each snapshot.blame as line (line.line)}<div>
              <span>{line.line}</span><span>r{line.revision}</span><span
                >{line.author}</span
              ><code>{line.content}</code>
            </div>{/each}
        </ScrollArea>
      {/if}
      <!-- v0.1.6 V016-F1：blocked 预览走内联错误 + 重试入口，不自动弹模态。 -->
      {#if snapshot.restorePreview && !snapshot.restorePreview.canExecute}
        <div class="notice notice--warning" role="alert">
          <span class="codicon codicon-warning" aria-hidden="true"></span>
          <span
            >恢复预览暂不可执行：{snapshot.restorePreview.issues.join("；") ||
              "请重新检查后恢复。"}</span
          >
          <button
            type="button"
            class="button button--secondary"
            onclick={recheckRestore}>重新检查</button
          >
        </div>
      {/if}
      <!-- v0.1.5 V015-C1：恢复预览改走通用意向单（自建 dialog 已删除；issues/命令并入意向单）。
           Host 侧 history/execute-restore 的 token + contentHash 复验链不动。 -->
      <OperationIntentDialog
        intent={restoreIntent}
        open={restoreIntentOpen && Boolean(restoreIntent)}
        confirmLabel={`确认覆盖 ${restoreIntent?.paths.length ?? 0} 个文件`}
        cancelLabel="取消"
        recheckLabel="重新检查"
        triggerElement={restoreTriggerEl}
        {onAction}
        {pathDetail}
        onConfirm={(token) => {
          restoreIntentOpen = false;
          onAction("history/execute-restore", { previewToken: token });
        }}
        onCancel={() => (restoreIntentOpen = false)}
        onRecheck={recheckRestore}
      />
    {:else}
      <!-- v0.1.5 V015-B2：空态两句→TaskEmptyState，补齐第三句（调整条件 / 加载更早）。 -->
      <TaskEmptyState
        icon="codicon-history"
        what="暂无历史"
        whyNormal="当前范围没有可显示的修订记录。"
        whatNow="调整加载条件，或加载更早修订后重试。"
        actions={snapshot.hasMore
          ? [
              {
                label: "加载更早修订",
                action: "history/load-more",
                kind: "primary",
              },
            ]
          : []}
        onAction={handleHistoryResultAction}
      />
    {/if}
  </ScrollArea>
</section>
