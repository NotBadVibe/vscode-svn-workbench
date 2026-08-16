<script lang="ts">
  import type {
    RepositorySnapshot,
    WebviewAction,
  } from "@protocol/workbenchProtocol";
  import ScrollArea from "../../../components/ui/ScrollArea.svelte";
  import SearchInput from "../../../components/list/SearchInput.svelte";
  import ResultCount from "../../../components/list/ResultCount.svelte";
  import { naturalCompare } from "../../../../selection/selectionSort";
  import { formatZhDateTime, formatZhFileSize } from "../../../i18n/formatters";

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

  let browserUrl = $state("");
  let initializedRepository = $state("");
  let query = $state("");
  let sortField = $state<
    "name" | "type" | "revision" | "author" | "date" | "size"
  >("name");
  let dirsFirst = $state(true);

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
    return `${(snapshot.advanced.browser?.url ?? browserUrl).replace(/\/+$/, "")}/${encodeURIComponent(name)}`;
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
    list.sort((left, right) => {
      if (dirsFirst && left.kind !== right.kind) {
        return left.kind === "dir" ? -1 : 1;
      }
      switch (sortField) {
        case "type":
          return left.kind.localeCompare(right.kind);
        case "revision":
          return (Number(right.revision) || 0) - (Number(left.revision) || 0);
        case "author":
          return (left.author ?? "").localeCompare(right.author ?? "");
        case "date":
          return (right.date ?? "").localeCompare(left.date ?? "");
        case "size":
          return (right.size ?? -1) - (left.size ?? -1);
        default:
          return naturalCompare(left.name, right.name);
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
          if (
            value === "type" ||
            value === "revision" ||
            value === "author" ||
            value === "date" ||
            value === "size"
          ) {
            sortField = value;
          } else {
            sortField = "name";
          }
        }}
      >
        <option value="name">按名称</option>
        <option value="type">按类型</option>
        <option value="revision">按修订（新优先）</option>
        <option value="author">按作者</option>
        <option value="date">按日期（新优先）</option>
        <option value="size">按大小（大优先）</option>
      </select>
      <button
        class="button button--secondary"
        aria-pressed={dirsFirst}
        onclick={() => (dirsFirst = !dirsFirst)}
        >{dirsFirst ? "目录优先：开" : "目录优先：关"}</button
      >
    </div>
    {#if snapshot.advanced.browser.error}<div class="notice notice--error">
        {snapshot.advanced.browser.error}
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
                onAction("copy-text", { text: childUrl(entry.name) })}
              >复制 URL</button
            >
          {/if}
        </div>{/each}</ScrollArea
    >
  {:else}<div class="preview-empty preview-empty--compact">
      <span class="codicon codicon-repo" aria-hidden="true"></span>
      <p>按需浏览仓库端目录，不读取文件正文。</p>
    </div>{/if}
</section>
