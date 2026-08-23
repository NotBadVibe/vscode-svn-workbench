<script lang="ts">
  import { SvelteSet } from "svelte/reactivity";
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
  import { naturalCompare } from "../../../selection/selectionSort";
  import { formatZhDateTime } from "../../i18n/formatters";

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
  }: {
    snapshot: HistorySnapshot;
    onAction: (action: WebviewAction, data?: Record<string, unknown>) => void;
    /** v0.0.10：路径详情结果（Host 一次性下发）。 */
    pathDetail?: Extract<
      HostToWebviewMessage,
      { type: "file/path-detail-result" }
    >["payload"];
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

  function requestMoreHistory(): void {
    onAction("history/load-more", { ...loadQuery });
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
</script>

<section class="history-layout">
  <div class="history-list-pane">
    <div class="feature-toolbar feature-toolbar--compact">
      <div>
        <h2>修订历史</h2>
        <!-- v0.0.18 批次 C（C-06）：明确“已加载最近 N 条”，区分没有更多与尚未加载。 -->
        <p>
          已加载最近 {snapshot.revisions.length} 条修订{snapshot.hasMore
            ? "（可能还有更早修订）"
            : "（已是全部历史）"}
        </p>
      </div>
      <SearchInput
        bind:value={query}
        ariaLabel="筛选历史"
        placeholder="作者、说明、修订号…"
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
    {#if appliedQueryDescription}
      <p class="history-load-conditions__applied" role="status">
        当前按{appliedQueryDescription}加载；再次加载会保留这些条件。
      </p>
    {/if}
    <div class="history-compare-bar">
      <span role="status"
        >已选择 {compare.size}/2 条修订；再选一条会替换最早选择的修订</span
      >
      <button
        class="button button--secondary"
        disabled={compare.size === 0}
        onclick={clearCompare}>清空比较选择</button
      >
      <button
        class="button button--primary"
        disabled={compare.size !== 2}
        onclick={() => onAction("history/compare", { revisions: [...compare] })}
        >比较所选修订（{compare.size}/2）</button
      >
    </div>
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
              onclick={() =>
                onAction("history/preview-restore", {
                  revision: selected.revision,
                })}>从此修订恢复</button
            >{/if}
          <span class="status-badge">{selected.author}</span>
        </div>
      </div>
      {#if staleness.stale}<div class="notice notice--warning" role="status">
          <span class="codicon codicon-warning" aria-hidden="true"></span>
          <span
            >此结果基于 {staleness.minutesAgo} 分钟前的状态，工作副本可能已变化，建议刷新</span
          >
        </div>{/if}
      {#if snapshot.feedback}<div class="notice notice--success" role="status">
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
      {#if snapshot.restorePreview}
        <div
          class="restore-preview scroll-region"
          role="dialog"
          aria-label="修订恢复预览"
          tabindex="0"
          data-scroll-region
        >
          <div class="section-heading">
            <div>
              <span class="eyebrow">危险操作预览</span>
              <h2>恢复 {snapshot.restorePreview.relativePath}</h2>
            </div>
            <div class="toolbar-actions">
              <button
                type="button"
                class="icon-button icon-button--small"
                aria-label={`复制恢复目标路径 ${snapshot.restorePreview.relativePath}`}
                title="复制恢复目标路径"
                onclick={() =>
                  onAction("copy-text", {
                    text: snapshot.restorePreview?.relativePath ?? "",
                  })}
                ><span class="codicon codicon-copy" aria-hidden="true"
                ></span></button
              >
              <button
                type="button"
                class="icon-button icon-button--small"
                aria-label={`查看 ${snapshot.restorePreview.relativePath} 路径详情`}
                title="路径详情"
                onclick={(event) =>
                  list.requestPathDetail(
                    snapshot.restorePreview?.relativePath ?? "",
                    event.currentTarget,
                  )}
                ><span class="codicon codicon-info" aria-hidden="true"
                ></span></button
              >
              <span class="status-badge"
                >r{snapshot.restorePreview.revision}</span
              >
            </div>
          </div>
          <div class="notice notice--warning">
            将用所选修订覆盖工作副本文件，但不会自动提交。现有未提交内容会丢失。
          </div>
          <code>{snapshot.restorePreview.command}</code>
          {#each snapshot.restorePreview.issues as issue, issueIndex (issueIndex)}<div
              class="notice notice--error"
            >
              {issue}
            </div>{/each}
          <button
            class="button button--primary commit-button"
            disabled={!snapshot.restorePreview.canExecute}
            onclick={() =>
              onAction("history/execute-restore", {
                previewToken: snapshot.restorePreview?.token,
              })}>确认覆盖工作副本文件</button
          >
        </div>
      {/if}
    {:else}
      <div class="empty-state empty-state--large">
        <span class="codicon codicon-history"></span>
        <div>
          <strong>暂无历史</strong>
          <p>当前范围没有可显示的修订记录。</p>
        </div>
      </div>
    {/if}
  </ScrollArea>
</section>
