<script lang="ts">
  import { ContextMenu } from "bits-ui";
  import { SvelteSet } from "svelte/reactivity";
  import type {
    ChangesSnapshot,
    HostToWebviewMessage,
    WebviewAction,
    WorkbenchFileStatus,
  } from "@protocol/workbenchProtocol";
  import { formatZhTime } from "../../i18n/formatters";
  import { fileStatusLabels } from "../../i18n/terminology";
  import FilePathDetail from "../../components/svn/FilePathDetail.svelte";

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

  let query = $state("");
  let activeStatus = $state<WorkbenchFileStatus | "all">("all");
  const selected = new SvelteSet<string>();
  let contextFile = $state<ChangesSnapshot["files"][number] | undefined>();
  let fileList = $state<HTMLDivElement>();
  let scrollTop = $state(0);
  let viewportHeight = $state(500);
  let commitDraft = $state("");
  let synchronizedCommitDraft = $state("");
  let destructiveConfirmed = $state(false);
  let operationPreviewToken = $state<string | undefined>();
  let pathDetailOpen = $state(false);

  const rowHeight = 34;
  const virtualizeAfter = 300;
  const overscan = 8;

  const filteredFiles = $derived(
    snapshot.files.filter((file) => {
      const matchesStatus =
        activeStatus === "all" || file.status === activeStatus;
      const matchesQuery = file.relativePath
        .toLowerCase()
        .includes(query.trim().toLowerCase());
      return matchesStatus && matchesQuery;
    }),
  );
  const isVirtualized = $derived(filteredFiles.length > virtualizeAfter);
  const visibleStart = $derived(
    isVirtualized
      ? Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
      : 0,
  );
  const visibleEnd = $derived(
    isVirtualized
      ? Math.min(
          filteredFiles.length,
          Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan,
        )
      : filteredFiles.length,
  );
  const visibleFiles = $derived(
    filteredFiles
      .slice(visibleStart, visibleEnd)
      .map((file, offset) => ({ file, index: visibleStart + offset })),
  );

  $effect(() => {
    query;
    activeStatus;
    scrollTop = 0;
    if (fileList) fileList.scrollTop = 0;
  });

  $effect(() => {
    const next = snapshot.commitDraft;
    if (commitDraft === synchronizedCommitDraft) commitDraft = next;
    synchronizedCommitDraft = next;
  });

  $effect(() => {
    const token = snapshot.operationPreview?.token;
    if (token !== operationPreviewToken) {
      operationPreviewToken = token;
      destructiveConfirmed = false;
    }
  });

  // 新的路径详情结果到达时自动展开；用户可手动关闭。
  $effect(() => {
    if (pathDetail) pathDetailOpen = true;
  });

  const selectionLabels = {
    selected: "建议提交",
    needsReview: "需要确认",
    excluded: "已排除",
    blocked: "不可提交",
  } as const;

  function toggle(relativePath: string): void {
    if (selected.has(relativePath)) {
      selected.delete(relativePath);
    } else {
      selected.add(relativePath);
    }
  }

  function operationPaths(relativePath: string): string[] {
    return selected.has(relativePath) && selected.size > 0
      ? [...selected]
      : [relativePath];
  }

  function handleScroll(event: Event): void {
    const target = event.currentTarget as HTMLDivElement;
    scrollTop = target.scrollTop;
    viewportHeight = target.clientHeight || viewportHeight;
  }

  function afterContextMenuClose(callback: () => void): void {
    window.setTimeout(callback, 0);
  }

  function preview(
    operation: "add" | "remove" | "revert" | "lock" | "unlock" | "ignore",
    relativePath: string,
    ignoreMode?: "directory" | "repository",
  ): void {
    onAction("changes/preview-operation", {
      operation,
      paths: operationPaths(relativePath),
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
    <div class="search-field">
      <span class="codicon codicon-search" aria-hidden="true"></span>
      <input
        bind:value={query}
        aria-label="筛选变更文件"
        placeholder="筛选文件…"
      />
    </div>
    <div class="toolbar-actions">
      <button
        class="button button--secondary"
        disabled={selected.size === 0}
        onclick={() =>
          onAction("open-module", {
            moduleId: "commit",
            taskId: "commit/compose",
            selectedPaths: [...selected],
          })}
      >
        <span class="codicon codicon-checklist" aria-hidden="true"></span>
        提交所选
      </button>
      <button
        class="button button--secondary"
        disabled={selected.size === 0}
        onclick={() =>
          onAction("open-module", {
            moduleId: "changelists",
            taskId: "changelists/manage",
            selectedPaths: [...selected],
          })}
      >
        <span class="codicon codicon-list-tree" aria-hidden="true"></span>变更集
      </button>
      <button
        class="button button--primary"
        onclick={() =>
          onAction("open-module", {
            moduleId: "commit",
            taskId: "commit/compose",
          })}
      >
        提交当前范围
      </button>
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
    </div>
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
      <button
        class="button button--primary"
        onclick={() =>
          onAction("open-module", {
            moduleId: "commit",
            taskId: "commit/compose",
            selectedPaths: [...selected],
          })}>进入提交页面</button
      >
    </div>
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

  <div class="table-card">
    {#if pathDetail && pathDetailOpen}
      <div class="path-detail-host">
        <div class="path-detail-host__bar">
          <span class="path-detail-host__target">{pathDetail.relativePath}</span
          >
          <button
            class="icon-button icon-button--small"
            aria-label="关闭路径详情"
            onclick={() => (pathDetailOpen = false)}
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
    <div class="table-header" aria-hidden="true">
      <span></span><span>文件</span><span>状态</span><span>选择建议</span><span
      ></span>
    </div>
    {#if filteredFiles.length === 0}
      <div class="empty-state">
        <span class="codicon codicon-check-all" aria-hidden="true"></span>
        <strong
          >{snapshot.files.length === 0
            ? "工作副本很干净"
            : "没有匹配的文件"}</strong
        >
        <p>
          {snapshot.files.length === 0
            ? "当前范围没有本地修改。"
            : "调整搜索词或状态筛选。"}
        </p>
      </div>
    {:else}
      <ContextMenu.Root>
        <ContextMenu.Trigger>
          {#snippet child({ props })}
            <!-- svelte-ignore a11y_no_noninteractive_tabindex -- 文件列表需要键盘焦点，以支持 PageUp/PageDown 和 End 滚动。 -->
            <div
              {...props}
              class="file-list scroll-region"
              class:file-list--virtual={isVirtualized}
              role="list"
              aria-label="SVN 变更文件"
              tabindex="0"
              data-scroll-region
              bind:this={fileList}
              onscroll={handleScroll}
            >
              <div
                class:file-list-inner--virtual={isVirtualized}
                style:height={isVirtualized
                  ? `${filteredFiles.length * rowHeight}px`
                  : undefined}
              >
                {#each visibleFiles as row (row.file.relativePath)}
                  <div
                    class="file-row"
                    class:file-row--virtual={isVirtualized}
                    class:file-row--blocked={row.file.selection === "blocked"}
                    style:transform={isVirtualized
                      ? `translateY(${row.index * rowHeight}px)`
                      : undefined}
                    role="listitem"
                    aria-posinset={row.index + 1}
                    aria-setsize={filteredFiles.length}
                    oncontextmenu={() => (contextFile = row.file)}
                  >
                    <input
                      type="checkbox"
                      aria-label={`选择 ${row.file.relativePath}`}
                      checked={selected.has(row.file.relativePath)}
                      disabled={row.file.selection === "blocked"}
                      onchange={() => toggle(row.file.relativePath)}
                    />
                    <button
                      class="file-path"
                      title={row.file.relativePath}
                      onclick={() =>
                        onAction("open-diff", {
                          relativePath: row.file.relativePath,
                        })}
                      ><span
                        class="codicon codicon-file-code"
                        aria-hidden="true"
                      ></span><span class="file-path__label"
                        >{row.file.projectRelativePath ??
                          row.file.relativePath}</span
                      >{#if row.file.projectName}<small class="project-badge"
                          ><span
                            class="codicon codicon-project"
                            aria-hidden="true"
                          ></span>{row.file.projectName}</small
                        >{/if}{#if row.file.repositoryName}<small
                          class={`ownership-badge ownership-badge--${row.file.ownership ?? "current"}`}
                          ><span class="codicon codicon-repo" aria-hidden="true"
                          ></span>{row.file.repositoryName}{row.file
                            .ownership === "external"
                            ? " · 外部"
                            : row.file.ownership === "nested"
                              ? " · 嵌套"
                              : ""}</small
                        >{/if}</button
                    >
                    <span
                      class={`status-badge status-badge--${row.file.status}`}
                      >{fileStatusLabels[row.file.status]}</span
                    >
                    <span class="selection-note" title={row.file.reason}
                      >{row.file.reason ??
                        (row.file.selection
                          ? selectionLabels[row.file.selection]
                          : "—")}</span
                    >
                    <button
                      class="icon-button icon-button--small"
                      aria-label={`查看 ${row.file.relativePath} 路径详情`}
                      onclick={() =>
                        onAction("file/path-detail", {
                          relativePath: row.file.relativePath,
                        })}
                      ><span class="codicon codicon-info" aria-hidden="true"
                      ></span></button
                    >
                    <button
                      class="icon-button icon-button--small"
                      aria-label={`查看 ${row.file.relativePath} 差异`}
                      onclick={() =>
                        onAction("open-diff", {
                          relativePath: row.file.relativePath,
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
                    afterContextMenuClose(() =>
                      preview("add", contextFile!.relativePath),
                    )}
                  ><span class="codicon codicon-add" aria-hidden="true"
                  ></span>加入版本控制</ContextMenu.Item
                >
                <ContextMenu.Item
                  class="context-menu-item"
                  onSelect={() =>
                    afterContextMenuClose(() =>
                      preview("ignore", contextFile!.relativePath, "directory"),
                    )}
                  ><span class="codicon codicon-eye-closed" aria-hidden="true"
                  ></span>目录忽略（svn:ignore）</ContextMenu.Item
                >
                <ContextMenu.Item
                  class="context-menu-item"
                  onSelect={() =>
                    afterContextMenuClose(() =>
                      preview(
                        "ignore",
                        contextFile!.relativePath,
                        "repository",
                      ),
                    )}
                  ><span class="codicon codicon-repo" aria-hidden="true"
                  ></span>仓库继承忽略（svn:global-ignores）</ContextMenu.Item
                >
              {:else}
                <ContextMenu.Item
                  class="context-menu-item"
                  disabled={contextFile.status === "conflicted"}
                  onSelect={() =>
                    afterContextMenuClose(() =>
                      preview("lock", contextFile!.relativePath),
                    )}
                  ><span class="codicon codicon-lock" aria-hidden="true"
                  ></span>加锁</ContextMenu.Item
                >
                <ContextMenu.Item
                  class="context-menu-item"
                  disabled={contextFile.status === "conflicted"}
                  onSelect={() =>
                    afterContextMenuClose(() =>
                      preview("unlock", contextFile!.relativePath),
                    )}
                  ><span class="codicon codicon-unlock" aria-hidden="true"
                  ></span>解锁</ContextMenu.Item
                >
                <ContextMenu.Item
                  class="context-menu-item context-menu-item--danger"
                  disabled={contextFile.status === "conflicted"}
                  onSelect={() =>
                    afterContextMenuClose(() =>
                      preview("revert", contextFile!.relativePath),
                    )}
                  ><span class="codicon codicon-discard" aria-hidden="true"
                  ></span>还原本地变更</ContextMenu.Item
                >
                <ContextMenu.Item
                  class="context-menu-item context-menu-item--danger"
                  disabled={contextFile.status === "conflicted"}
                  onSelect={() =>
                    afterContextMenuClose(() =>
                      preview("remove", contextFile!.relativePath),
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
  </div>
  <footer class="feature-footer">
    <span>更新于 {formatZhTime(snapshot.refreshedAt)}</span>
    <span>{selected.size} 个已选</span>
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
        <ul>
          {#each snapshot.operationPreview.paths as item (item)}<li>
              {item}
            </li>{/each}
        </ul>
        <code>{snapshot.operationPreview.command}</code>
      </details>
      {#each snapshot.operationPreview.issues as issue, issueIndex (issueIndex)}<div
          class="notice notice--error"
        >
          {issue}
        </div>{/each}
      {#if snapshot.operationPreview.destructive}<label
          class="destructive-confirm"
          ><input type="checkbox" bind:checked={destructiveConfirmed} /><span
            >我已逐项核对文件清单，并理解未提交内容可能无法从 SVN 恢复。</span
          ></label
        >{/if}
      <button
        class="button button--primary commit-button"
        disabled={!snapshot.operationPreview.canExecute ||
          (snapshot.operationPreview.destructive && !destructiveConfirmed)}
        onclick={() =>
          onAction("changes/execute-operation", {
            previewToken: snapshot.operationPreview?.token,
          })}>确认{operationLabels[snapshot.operationPreview.operation]}</button
      >
    </div>
  {/if}
</section>
