<script lang="ts">
  import type {
    RepositorySnapshot,
    WebviewAction,
  } from "@protocol/workbenchProtocol";
  import ScrollArea from "../../../components/ui/ScrollArea.svelte";
  import SearchInput from "../../../components/list/SearchInput.svelte";
  import ResultCount from "../../../components/list/ResultCount.svelte";
  import { naturalCompare } from "../../../../selection/selectionSort";
  import type { SortDirection } from "../../../../selection/selectionSort";
  import {
    loadListPreferences,
    saveListPreferences,
  } from "../../../app/listPreferences";
  import { formatZhDateTime, formatZhFileSize } from "../../../i18n/formatters";
  import { buildRepositoryChildUrl } from "../../../../svn/svnUrl";

  /*
   * v0.0.10 跨模块列表迁移：仓库浏览器复用共享搜索、结果数量与排序；
   * 面包屑区分 SVN 仓库根与项目根（检出 URL）；目录优先可切换；文件
   * 行提供复制 URL，目录行进入下级；只读浏览语义不变。
   */

  let {
    snapshot,
    onAction,
  }: {
    snapshot: RepositorySnapshot;
    onAction: (action: WebviewAction, data?: Record<string, unknown>) => void;
  } = $props();

  type BrowseSortField =
    "name" | "type" | "revision" | "author" | "date" | "size";

  let browserUrl = $state("");
  let initializedRepository = $state("");
  let query = $state("");
  /* V026-R46：远端比较表单（只读，不写本地）。修订为空由 Host 提示补填。 */
  let compareUrl = $state("");
  let compareFrom = $state("");
  let compareTo = $state("");
  let sortField = $state<BrowseSortField>("name");
  let sortDirection = $state<SortDirection>("asc");
  let dirsFirst = $state(true);

  /**
   * V023-R22：各字段默认方向（名称/类型/作者升序，其余降序）；用户可独立切换。
   * 偏好按 `repository-browse` 模块存储，不串入 AI 建议等有意顺序。
   */
  const BROWSE_DEFAULT_DIRECTION: Record<BrowseSortField, SortDirection> = {
    name: "asc",
    type: "asc",
    author: "asc",
    revision: "desc",
    date: "desc",
    size: "desc",
  };

  function isBrowseSortField(value: unknown): value is BrowseSortField {
    return (
      value === "name" ||
      value === "type" ||
      value === "revision" ||
      value === "author" ||
      value === "date" ||
      value === "size"
    );
  }

  const savedBrowsePreferences = loadListPreferences("repository-browse");
  sortField = isBrowseSortField(savedBrowsePreferences.customSortField)
    ? savedBrowsePreferences.customSortField
    : "name";
  sortDirection =
    savedBrowsePreferences.sortDirection === "asc" ||
    savedBrowsePreferences.sortDirection === "desc"
      ? savedBrowsePreferences.sortDirection
      : (BROWSE_DEFAULT_DIRECTION[sortField] ?? "asc");

  function persistBrowseSort(): void {
    saveListPreferences("repository-browse", {
      customSortField: sortField,
      sortDirection,
    });
  }

  /** V023-R22：字段选择只定字段并取该字段默认方向（方向由独立按钮切换）。 */
  function setBrowseSortField(field: BrowseSortField): void {
    if (sortField !== field) {
      sortField = field;
      sortDirection = BROWSE_DEFAULT_DIRECTION[field];
      persistBrowseSort();
    }
  }

  /** V023-R22：同一字段可明确切升/降。 */
  function toggleBrowseSortDirection(): void {
    sortDirection = sortDirection === "asc" ? "desc" : "asc";
    persistBrowseSort();
  }

  /** V023-R22：恢复默认顺序（按名称升序）。 */
  function resetBrowseSort(): void {
    sortField = "name";
    sortDirection = BROWSE_DEFAULT_DIRECTION.name;
    persistBrowseSort();
  }

  $effect(() => {
    const identity =
      snapshot.info.url ?? snapshot.info.repositoryRoot ?? snapshot.info.name;
    if (identity !== initializedRepository) {
      initializedRepository = identity;
      // 从项目入口默认定位项目 URL（工作副本检出地址）。
      browserUrl = snapshot.info.url ?? snapshot.info.repositoryRoot ?? "";
    }
  });

  function openBrowser(url = browserUrl): void {
    browserUrl = url;
    onAction("repository/browse", { url });
  }

  function childUrl(name: string): string {
    return buildRepositoryChildUrl(
      snapshot.advanced.browser?.url ?? browserUrl,
      name,
    );
  }

  /** V026-R46：只读远端内容（svn cat 内存读取，不写本地文件）。 */
  function viewRemoteFile(url: string, revision?: string): void {
    onAction(
      "repository/preview-remote-file",
      revision ? { url, revision } : { url },
    );
  }

  /** V026-R46：只读远端历史（svn log URL，不进入工作副本范围）。 */
  function viewRemoteHistory(url: string): void {
    onAction("repository/query-remote-history", { url });
  }

  /** V026-R46：远端 revision 比较只读预览（复用 revision-patch 只读语义）。 */
  function compareRemote(url = compareUrl): void {
    compareUrl = url;
    onAction("repository/compare-remote-revisions", {
      url: compareUrl,
      fromRevision: compareFrom,
      toRevision: compareTo,
    });
  }

  /** V026-R46：失败后返回上次有效位置（不丢导航状态）。 */
  function backToLastGood(): void {
    const lastGood = snapshot.advanced.browser?.lastGoodUrl;
    if (lastGood) openBrowser(lastGood);
  }

  interface BreadcrumbItem {
    url: string;
    label: string;
    marker?: "repo" | "project";
  }

  /** 面包屑：仓库根为起点，检出 URL（项目根）所在段标记徽标。 */
  const breadcrumb = $derived.by(() => {
    const browser = snapshot.advanced.browser;
    if (!browser) return [] as BreadcrumbItem[];
    const url = browser.url.replace(/\/+$/, "");
    const root = (snapshot.info.repositoryRoot ?? "").replace(/\/+$/, "");
    const project = (snapshot.info.url ?? "").replace(/\/+$/, "");
    if (!root || root === "" || !url.startsWith(`${root}/`)) {
      return [{ url, label: url } satisfies BreadcrumbItem];
    }
    const items: BreadcrumbItem[] = [
      // 仓库根以文字徽标呈现一次（label 留空，避免“仓库根仓库根”重复）。
      { url: root, label: "", marker: "repo" },
    ];
    const rest = url.slice(root.length + 1);
    if (rest.length === 0) return items;
    let prefix = root;
    for (const segment of rest.split("/")) {
      prefix = `${prefix}/${segment}`;
      items.push({
        url: prefix,
        label: decodeURIComponent(segment),
        marker: prefix === project ? "project" : undefined,
      });
    }
    return items;
  });

  const filteredEntries = $derived.by(() => {
    const entries = snapshot.advanced.browser?.entries ?? [];
    const needle = query.trim().toLowerCase();
    if (!needle) return entries;
    return entries.filter((entry) => entry.name.toLowerCase().includes(needle));
  });

  const orderedEntries = $derived.by(() => {
    const list = [...filteredEntries];
    const dir = sortDirection === "asc" ? 1 : -1;
    list.sort((left, right) => {
      if (dirsFirst && left.kind !== right.kind) {
        return left.kind === "dir" ? -1 : 1;
      }
      switch (sortField) {
        case "type":
          return dir * left.kind.localeCompare(right.kind);
        case "revision":
          return (
            dir * ((Number(left.revision) || 0) - (Number(right.revision) || 0))
          );
        case "author":
          return dir * (left.author ?? "").localeCompare(right.author ?? "");
        case "date":
          return dir * (left.date ?? "").localeCompare(right.date ?? "");
        case "size":
          return dir * ((left.size ?? -1) - (right.size ?? -1));
        default:
          return dir * naturalCompare(left.name, right.name);
      }
    });
    return list;
  });
</script>

<section class="operation-card operation-card--wide repository-task-card">
  <div class="section-heading">
    <div>
      <span class="eyebrow">只读浏览</span>
      <h2>仓库浏览器</h2>
    </div>
    <span class="status-badge">只读</span>
  </div>
  <div class="repository-browser-toolbar">
    <label class="field"
      ><span>仓库 URL</span><input
        bind:value={browserUrl}
        placeholder="https://…/trunk"
      /></label
    ><button
      class="button button--secondary"
      disabled={!browserUrl}
      onclick={() => openBrowser()}>打开 URL</button
    ><button
      class="button button--secondary"
      onclick={() => openBrowser(snapshot.info.url ?? "")}>返回项目路径</button
    >
  </div>
  {#if snapshot.advanced.browser}
    <!-- V026-R46：当前浏览修订与本地项目根关系（只读，不进入工作副本范围）。 -->
    <div class="notice" role="status">
      <span class="codicon codicon-info" aria-hidden="true"></span><span>
        正在浏览远端{snapshot.advanced.browser.revision
          ? ` r${snapshot.advanced.browser.revision}`
          : "（修订未知）"}；本地工作副本 r{snapshot.info.revision ??
          "未知"}。远端预览不写入本地文件，也不改变本地操作范围。
      </span>
    </div>
    <nav class="browser-location" aria-label="仓库浏览位置">
      <button
        class="icon-button"
        aria-label="打开上级目录"
        disabled={!snapshot.advanced.browser.parentUrl}
        onclick={() =>
          snapshot.advanced.browser?.parentUrl &&
          openBrowser(snapshot.advanced.browser.parentUrl)}
        ><span class="codicon codicon-arrow-up" aria-hidden="true"
        ></span></button
      >
      <ol class="browser-breadcrumb">
        {#each breadcrumb as item, index (`${item.url}`)}
          <li>
            <button
              type="button"
              class="browser-breadcrumb__item"
              class:browser-breadcrumb__item--current={index ===
                breadcrumb.length - 1}
              aria-current={index === breadcrumb.length - 1
                ? "page"
                : undefined}
              onclick={() => openBrowser(item.url)}
              >{item.label}{#if item.marker === "repo"}
                <small class="browser-breadcrumb__marker">仓库根</small
                >{:else if item.marker === "project"}
                <small class="browser-breadcrumb__marker">项目根</small
                >{/if}</button
            >
          </li>
        {/each}
      </ol>
      <button
        class="icon-button"
        aria-label="复制当前浏览 URL"
        onclick={() =>
          onAction("copy-text", { text: snapshot.advanced.browser?.url })}
        ><span class="codicon codicon-copy" aria-hidden="true"></span></button
      >
    </nav>
    <!-- V023-R22：仓库条目非表格列头，方向经中文按钮展示；不用 role=columnheader 以免 ARIA 父子违规。 -->
    <div class="browser-filter-bar">
      <SearchInput
        bind:value={query}
        ariaLabel="筛选仓库条目"
        placeholder="名称…"
        compact
      />
      <ResultCount count={orderedEntries.length} suffix="个条目" />
      <select
        class="sort-menu"
        aria-label="仓库条目排序"
        value={sortField}
        onchange={(event) => {
          const value = (event.currentTarget as HTMLSelectElement).value;
          setBrowseSortField(isBrowseSortField(value) ? value : "name");
        }}
      >
        <option value="name">按名称</option>
        <option value="type">按类型</option>
        <option value="revision">按修订</option>
        <option value="author">按作者</option>
        <option value="date">按日期</option>
        <option value="size">按大小</option>
      </select>
      <button
        type="button"
        class="button button--secondary"
        aria-label={`排序方向：当前${sortDirection === "asc" ? "升序" : "降序"}，点击切换`}
        onclick={toggleBrowseSortDirection}
        >{sortDirection === "asc" ? "升序" : "降序"}</button
      >
      <button
        type="button"
        class="button button--secondary"
        onclick={resetBrowseSort}>恢复默认顺序</button
      >
      <button
        class="button button--secondary"
        aria-pressed={dirsFirst}
        onclick={() => (dirsFirst = !dirsFirst)}
        >{dirsFirst ? "目录优先：开" : "目录优先：关"}</button
      >
    </div>
    {#if query.trim() && orderedEntries.length === 0 && (snapshot.advanced.browser.entries.length ?? 0) > 0 && !snapshot.advanced.browser.error}
      <div class="notice notice--warning" role="status">
        当前名称筛选“{query.trim()}”无匹配（共 {snapshot.advanced.browser
          .entries.length} 个条目）。可能是切换目录后保留的旧筛选，清除后恢复全部条目显示。
        <button
          type="button"
          class="button button--secondary"
          onclick={() => (query = "")}>清除名称筛选</button
        >
      </div>
    {/if}
    {#if snapshot.advanced.browser.error}<div class="notice notice--error">
        {snapshot.advanced.browser.error}
      </div>{/if}
    {#if snapshot.advanced.browser.error && snapshot.advanced.browser.lastGoodUrl}<div
        class="notice notice--warning"
        role="status"
      >
        导航状态已保留，可返回上次有效位置继续浏览。
        <button
          type="button"
          class="button button--secondary"
          onclick={backToLastGood}>返回上次有效位置</button
        >
      </div>{/if}
    <ScrollArea class="repository-browser-list" label="仓库目录内容"
      >{#if orderedEntries.length === 0 && !snapshot.advanced.browser.error}<div
          class="mini-empty"
        >
          {snapshot.advanced.browser.entries.length === 0
            ? "这个仓库目录为空。"
            : "没有匹配的条目；调整名称筛选后重试。"}
        </div>{/if}{#each orderedEntries as entry (entry.name)}<div
          class="browser-entry"
        >
          <span
            class={`codicon codicon-${entry.kind === "dir" ? "folder" : "file"}`}
            aria-hidden="true"
          ></span><strong>{entry.name}</strong><small>
            r{entry.revision ?? "?"} · {entry.author ?? "未知"}{entry.date
              ? ` · ${formatZhDateTime(entry.date)}`
              : ""}{entry.kind === "file"
              ? ` · ${formatZhFileSize(entry.size)}`
              : ""}
          </small>
          {#if entry.kind === "dir"}
            <button
              type="button"
              class="button button--secondary browser-entry__action"
              onclick={() => openBrowser(childUrl(entry.name))}>打开目录</button
            >
          {:else}
            <button
              type="button"
              class="button button--secondary browser-entry__action"
              onclick={() =>
                viewRemoteFile(childUrl(entry.name), entry.revision)}
              >查看内容</button
            >
            <button
              type="button"
              class="button button--secondary browser-entry__action"
              onclick={() => viewRemoteHistory(childUrl(entry.name))}
              >查看历史</button
            >
            <button
              type="button"
              class="button button--secondary browser-entry__action"
              onclick={() => {
                compareUrl = childUrl(entry.name);
                compareFrom = entry.revision ?? "";
                compareTo = snapshot.advanced.browser?.revision ?? "";
              }}>比较修订</button
            >
            <button
              type="button"
              class="button button--secondary browser-entry__action"
              onclick={() =>
                onAction("copy-text", { text: childUrl(entry.name) })}
              >复制 URL</button
            >
          {/if}
        </div>{/each}</ScrollArea
    >
    {#if snapshot.advanced.remoteFile}<section
        class="remote-preview"
        aria-label="远端内容只读预览"
      >
        <h3>远端内容（只读）</h3>
        <p>{snapshot.advanced.remoteFile.sourceLabel}</p>
        {#if snapshot.advanced.remoteFile.error}<div
            class="notice notice--error"
          >
            {snapshot.advanced.remoteFile.error}
          </div>{/if}
        {#if !snapshot.advanced.remoteFile.error && !snapshot.advanced.remoteFile.binary && snapshot.advanced.remoteFile.contentPreview !== undefined}<pre
            class="remote-preview__content">{snapshot.advanced.remoteFile
              .contentPreview}</pre>{/if}
        <button
          type="button"
          class="button button--secondary"
          onclick={() =>
            onAction("copy-text", { text: snapshot.advanced.remoteFile?.url })}
          >复制远端 URL</button
        >
      </section>{/if}
    {#if snapshot.advanced.remoteHistory}<section
        class="remote-preview"
        aria-label="远端历史只读预览"
      >
        <h3>
          远端历史（只读，共 {snapshot.advanced.remoteHistory.revisions.length} 条）
        </h3>
        <p>{snapshot.advanced.remoteHistory.url}（未进入工作副本范围）</p>
        {#if snapshot.advanced.remoteHistory.error}<div
            class="notice notice--error"
          >
            {snapshot.advanced.remoteHistory.error}
          </div>{:else}
          <ol class="remote-history-list">
            {#each snapshot.advanced.remoteHistory.revisions as item (item.revision)}<li
              >
                <strong>r{item.revision}</strong>
                <span
                  >{item.author ?? "未知"}{item.date
                    ? ` · ${formatZhDateTime(item.date)}`
                    : ""}</span
                >
                {#if item.message}<p>{item.message}</p>{/if}
                <button
                  type="button"
                  class="button button--secondary"
                  onclick={() =>
                    viewRemoteFile(
                      snapshot.advanced.remoteHistory?.url ?? "",
                      item.revision,
                    )}>查看该修订内容</button
                >
              </li>{/each}
          </ol>
        {/if}
      </section>{/if}
    <section class="remote-preview" aria-label="远端修订比较">
      <h3>远端修订比较（只读）</h3>
      <div class="repository-browser-toolbar">
        <label class="field"
          ><span>远端 URL</span><input
            bind:value={compareUrl}
            placeholder="https://…/path/file"
          /></label
        ><label class="field"
          ><span>起始修订</span><input
            bind:value={compareFrom}
            placeholder="rN 或 HEAD"
            inputmode="numeric"
          /></label
        ><label class="field"
          ><span>结束修订</span><input
            bind:value={compareTo}
            placeholder="rN 或 HEAD"
            inputmode="numeric"
          /></label
        ><button
          type="button"
          class="button button--secondary"
          disabled={!compareUrl}
          onclick={() => compareRemote()}>比较远端修订</button
        >
      </div>
      {#if snapshot.advanced.remoteCompare}<p>
          {snapshot.advanced.remoteCompare.url} · r{snapshot.advanced
            .remoteCompare.fromRevision} → r{snapshot.advanced.remoteCompare
            .toRevision}（只读，无本地路径操作）
        </p>
        {#if snapshot.advanced.remoteCompare.error}<div
            class="notice notice--error"
          >
            {snapshot.advanced.remoteCompare.error}
          </div>{/if}
        {#if snapshot.advanced.remoteCompare.diffPreview}<pre
            class="remote-preview__content">{snapshot.advanced.remoteCompare
              .diffPreview}</pre>
          {#if snapshot.advanced.remoteCompare.truncated}<div
              class="notice notice--warning"
              role="status"
            >
              差异过长已截断，只展示前部内容。
            </div>{/if}
        {/if}{/if}
    </section>
  {:else}<div class="preview-empty preview-empty--compact">
      <span class="codicon codicon-repo" aria-hidden="true"></span>
      <p>按需浏览仓库端目录，不读取文件正文。</p>
    </div>{/if}
</section>
