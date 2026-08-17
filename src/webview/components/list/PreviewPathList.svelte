<script lang="ts">
  import type {
    HostToWebviewMessage,
    WebviewAction,
  } from "@protocol/workbenchProtocol";
  import SearchInput from "./SearchInput.svelte";
  import ResultCount from "./ResultCount.svelte";
  import FilePathDetail from "../svn/FilePathDetail.svelte";
  import { naturalCompare } from "../../../selection/selectionSort";

  /*
   * v0.0.10 共享写操作预览路径清单：搜索、结果数量、复制整份清单与
   * 逐条复制/路径详情。清单不可勾选——确认页文件集合不可二次改变
   * 范围；修改范围必须返回上一步重新预览（UX10-PREVIEW-01）。
   */

  let {
    paths,
    label = "预览路径清单",
    emptyHint = "没有匹配的路径；调整搜索词后重试。",
    onAction,
    pathDetail,
  }: {
    paths: string[];
    label?: string;
    emptyHint?: string;
    onAction: (action: WebviewAction, data?: Record<string, unknown>) => void;
    /** 模块透传的 Host 路径详情结果；缺省时不渲染详情浮层。 */
    pathDetail?: Extract<
      HostToWebviewMessage,
      { type: "file/path-detail-result" }
    >["payload"];
  } = $props();

  let query = $state("");
  let detailOpen = $state(false);
  let detailTrigger = $state<HTMLButtonElement | null>(null);
  let detailPath = $state("");

  const filteredPaths = $derived.by(() => {
    const needle = query.trim().toLowerCase();
    const matched = needle
      ? paths.filter((path) => path.toLowerCase().includes(needle))
      : paths;
    return [...matched].sort((left, right) => naturalCompare(left, right));
  });

  $effect(() => {
    if (pathDetail && pathDetail.relativePath === detailPath) {
      detailOpen = true;
    }
  });

  function openDetail(path: string, trigger: HTMLButtonElement): void {
    detailPath = path;
    detailTrigger = trigger;
    onAction("file/path-detail", { relativePath: path });
  }

  function closeDetail(): void {
    detailOpen = false;
    detailTrigger?.focus();
  }
</script>

<div class="preview-path-list" aria-label={label}>
  <div class="preview-path-list__toolbar">
    <SearchInput
      bind:value={query}
      ariaLabel={`筛选${label}`}
      placeholder="路径…"
      compact
    />
    <ResultCount count={filteredPaths.length} suffix="条路径" />
    <button
      type="button"
      class="button button--secondary"
      disabled={filteredPaths.length === 0}
      onclick={() => onAction("copy-text", { text: filteredPaths.join("\n") })}
      >复制清单（{filteredPaths.length}）</button
    >
  </div>
  {#if pathDetail && detailOpen}
    <div class="path-detail-host">
      <div class="path-detail-host__bar">
        <span class="path-detail-host__target">{pathDetail.relativePath}</span>
        <button
          type="button"
          class="icon-button icon-button--small"
          aria-label="关闭路径详情"
          onclick={closeDetail}
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
  <ul class="preview-path-list__items">
    {#each filteredPaths as path (path)}
      <li>
        <span class="preview-path-list__path" title={path}>{path}</span>
        <span class="preview-path-list__actions">
          <button
            type="button"
            class="icon-button icon-button--small"
            aria-label={`复制路径 ${path}`}
            title="复制路径"
            onclick={() => onAction("copy-text", { text: path })}
            ><span class="codicon codicon-copy" aria-hidden="true"
            ></span></button
          >
          <button
            type="button"
            class="icon-button icon-button--small"
            aria-label={`查看 ${path} 路径详情`}
            title="路径详情"
            onclick={(event) => openDetail(path, event.currentTarget)}
            ><span class="codicon codicon-info" aria-hidden="true"
            ></span></button
          >
        </span>
      </li>
    {/each}
  </ul>
  {#if filteredPaths.length === 0}
    <p class="preview-path-list__empty">{emptyHint}</p>
  {/if}
</div>
