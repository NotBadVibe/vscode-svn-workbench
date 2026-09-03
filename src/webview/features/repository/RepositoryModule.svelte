<script lang="ts">
  import type { Component } from "svelte";
  import { SvelteSet } from "svelte/reactivity";
  import type {
    HostToWebviewMessage,
    RepositorySnapshot,
    WebviewAction,
    WorkbenchTaskId,
  } from "@protocol/workbenchProtocol";
  import ScrollArea from "../../components/ui/ScrollArea.svelte";
  import PreviewPathList from "../../components/list/PreviewPathList.svelte";
  import OperationIntentDialog from "../../components/operation/OperationIntentDialog.svelte";
  import type { OperationIntentKind } from "../../../operation/operationIntent";
  import { taskLabels } from "../../i18n/terminology";
  import {
    loadListPreferences,
    saveListPreferences,
  } from "../../app/listPreferences";

  type RepositoryTaskId = Exclude<
    Extract<WorkbenchTaskId, `repository/${string}`>,
    never
  >;
  type TaskModule = {
    default: Component<{
      snapshot: RepositorySnapshot;
      taskId: WorkbenchTaskId;
      onAction: (action: WebviewAction, data?: Record<string, unknown>) => void;
      pathDetail?: Extract<
        HostToWebviewMessage,
        { type: "file/path-detail-result" }
      >["payload"];
    }>;
  };

  let {
    snapshot,
    taskId = "repository/browse",
    onAction,
    pathDetail,
  }: {
    snapshot: RepositorySnapshot;
    taskId: WorkbenchTaskId;
    onAction: (action: WebviewAction, data?: Record<string, unknown>) => void;
    /** v0.0.10：路径详情结果（Host 一次性下发），透传给任务组件。 */
    pathDetail?: Extract<
      HostToWebviewMessage,
      { type: "file/path-detail-result" }
    >["payload"];
  } = $props();

  /*
   * v0.0.17 批次 D（U-09 收尾）：Update 拆走后，剩余仓库任务按
   * “分支与集成 / 维护与迁移 / 危险操作”分组；高级区默认折叠并按模块
   * 记忆展开状态（listPreferences）。分组标题用组标签而非标题层级，
   * 页面保持单一主标题。
   */
  const taskGroups: Array<{
    id: string;
    label: string;
    hint: string;
    tasks: Array<{ id: RepositoryTaskId; label: string }>;
  }> = [
    {
      id: "integration",
      label: "分支与集成",
      hint: "在仓库端创建分支/标签，或把其他分支合并进来",
      tasks: [
        { id: "repository/branch", label: "创建分支" },
        { id: "repository/tag", label: "创建标签" },
        { id: "repository/merge", label: "合并" },
      ],
    },
    {
      id: "maintenance",
      label: "维护与迁移",
      hint: "浏览仓库、属性、清理恢复、补丁与发布说明",
      tasks: [
        { id: "repository/browse", label: "浏览仓库" },
        { id: "repository/properties", label: "SVN 属性" },
        { id: "repository/recovery", label: "清理与恢复" },
        { id: "repository/patch-shelf", label: "补丁与搁置" },
        { id: "repository/release-notes", label: "发布说明" },
      ],
    },
    {
      id: "dangerous",
      label: "危险操作",
      hint: "改变工作副本绑定地址，执行前必须二次确认",
      tasks: [
        { id: "repository/switch", label: "切换" },
        { id: "repository/relocate", label: "重定位" },
      ],
    },
  ];

  const taskLoaders: Record<RepositoryTaskId, () => Promise<TaskModule>> = {
    "repository/recovery": () =>
      import("./tasks/RecoveryTask.svelte") as Promise<TaskModule>,
    "repository/browse": () =>
      import("./tasks/BrowseTask.svelte") as Promise<TaskModule>,
    "repository/properties": () =>
      import("./tasks/PropertiesTask.svelte") as Promise<TaskModule>,
    "repository/branch": () =>
      import("./tasks/AdvancedTask.svelte") as Promise<TaskModule>,
    "repository/tag": () =>
      import("./tasks/AdvancedTask.svelte") as Promise<TaskModule>,
    "repository/switch": () =>
      import("./tasks/AdvancedTask.svelte") as Promise<TaskModule>,
    "repository/relocate": () =>
      import("./tasks/AdvancedTask.svelte") as Promise<TaskModule>,
    "repository/merge": () =>
      import("./tasks/AdvancedTask.svelte") as Promise<TaskModule>,
    "repository/patch-shelf": () =>
      import("./tasks/PatchShelfTask.svelte") as Promise<TaskModule>,
    "repository/release-notes": () =>
      import("./tasks/ReleaseNotesTask.svelte") as Promise<TaskModule>,
  };

  const previewOperationLabels: Record<
    NonNullable<RepositorySnapshot["advanced"]["preview"]>["operation"],
    string
  > = {
    branch: "创建分支",
    tag: "创建标签",
    switch: "切换工作副本",
    relocate: "重定位仓库地址",
    merge: "合并到工作副本",
    "apply-patch": "应用补丁",
    shelf: "创建本地搁置",
  };

  const currentTask = $derived(
    (taskId.startsWith("repository/")
      ? taskId
      : "repository/browse") as RepositoryTaskId,
  );
  const currentTaskLoader = $derived(taskLoaders[currentTask]);
  const showsAdvancedPreview = $derived(
    [
      "repository/branch",
      "repository/tag",
      "repository/switch",
      "repository/relocate",
      "repository/merge",
      "repository/patch-shelf",
    ].includes(currentTask),
  );

  // 分组展开状态：默认展开“分支与集成”，其余折叠；经 listPreferences 记忆。
  const DEFAULT_EXPANDED_GROUPS = ["integration"];
  const savedGroupPreferences = loadListPreferences("repository");
  const expandedGroups = new SvelteSet<string>(
    savedGroupPreferences.expandedGroups ?? DEFAULT_EXPANDED_GROUPS,
  );
  // 当前任务所在组始终可见（即使被折叠也强制展开导航入口）。
  const groupOfCurrentTask = $derived(
    taskGroups.find((group) =>
      group.tasks.some((task) => task.id === currentTask),
    )?.id,
  );
  const effectiveExpanded = $derived.by(() => {
    if (groupOfCurrentTask && !expandedGroups.has(groupOfCurrentTask)) {
      const expanded = new SvelteSet<string>(expandedGroups);
      expanded.add(groupOfCurrentTask);
      return expanded;
    }
    return expandedGroups;
  });

  function toggleGroup(groupId: string): void {
    // 偏好只记录用户显式展开的组；当前任务所在组的强制展开不写入偏好。
    if (expandedGroups.has(groupId)) {
      expandedGroups.delete(groupId);
    } else {
      expandedGroups.add(groupId);
    }
    saveListPreferences("repository", {
      expandedGroups: [...expandedGroups],
    });
  }

  let advancedConfirmed = $state(false);
  let previewToken = $state<string | undefined>();
  // v0.0.14 批次 D：高级操作意向单（Switch/Relocate/Merge 等）
  let advancedIntentOpen = $state(false);
  let advancedTriggerEl = $state<HTMLElement | null>(null);
  const advancedIntent = $derived.by(() => {
    const preview = snapshot.advanced.preview;
    if (!preview || !showsAdvancedPreview) return undefined;
    // 按 Lead 规则：标题写"动作 + 真实影响对象"，数量来自最终候选/计划值
    const title = preview.title;
    // Switch/Relocate/Merge 等已由 Host 生成具体标题（如“切换工作副本到 ...”），直接复用；
    // 为满足通用校验，summary 附加执行前复验说明
    const summary = `${title} · 执行前将重新校验范围与目标状态`;
    // 清单：details 来自预览详情（可能包含旧 URL/新 URL、revision 等）
    const paths = preview.details ?? [];
    // kind 诚实映射：preview.operation → OperationIntentKind，patch/shelf 复用 file-operation
    const kind: OperationIntentKind =
      preview.operation === "branch"
        ? "branch"
        : preview.operation === "tag"
          ? "tag"
          : preview.operation === "relocate"
            ? "relocate"
            : preview.operation === "merge"
              ? "merge"
              : preview.operation === "switch"
                ? "switch"
                : "file-operation";
    // v0.1.5 V015-C1 九要素补齐：scope 摘要取 Host 下发的仓库名；revision 取工作副本修订；
    // 可恢复性按操作诚实映射——远端生效类（branch/tag/switch/relocate/merge）复用活动记录
    // “此操作不能在工作台中一键撤销”固定文案，patch/shelf 复用“只写入工作副本，不会自动提交”。
    const recoverability =
      kind === "file-operation"
        ? "只写入工作副本，不会自动提交。"
        : "此操作不能在工作台中一键撤销。";
    return {
      token: preview.token,
      kind,
      title,
      summary,
      paths,
      scopeText: snapshot.info.name,
      revision: snapshot.info.revision
        ? `r${snapshot.info.revision}`
        : undefined,
      recoverability,
      createdAt: new Date().toISOString(),
      canExecute:
        preview.canExecute && (!preview.destructive || advancedConfirmed),
      issues: preview.issues,
      commands: preview.commands,
      stale: false,
    };
  });
  const advancedConfirmLabel = $derived.by(() => {
    const preview = snapshot.advanced.preview;
    if (!preview) return "确认执行";
    return `确认执行${previewOperationLabels[preview.operation]}`;
  });

  $effect(() => {
    const token = snapshot.advanced.preview?.token;
    if (token !== previewToken) {
      previewToken = token;
      advancedConfirmed = false;
    }
  });

  function openTask(next: RepositoryTaskId): void {
    onAction("open-module", { moduleId: "repository", taskId: next });
  }
</script>

<section class="repository-page" data-repository-task={currentTask}>
  <header class="page-heading">
    <div>
      <span class="eyebrow">当前仓库任务</span>
      <h1>{taskLabels[currentTask]}</h1>
      <p>当前页面只显示这项任务；任何写操作都先生成精确预览，再由你确认。</p>
    </div>
  </header>

  <ScrollArea class="repository-task-navigation" label="仓库任务导航">
    {#each taskGroups as group (group.id)}
      <div
        class="task-group"
        role="group"
        aria-label={`${group.label}（${group.tasks.length} 个任务）`}
        data-task-group={group.id}
      >
        <button
          class="task-group__toggle"
          aria-expanded={effectiveExpanded.has(group.id)}
          onclick={() => toggleGroup(group.id)}
        >
          <span
            class="codicon codicon-{effectiveExpanded.has(group.id)
              ? 'chevron-down'
              : 'chevron-right'}"
            aria-hidden="true"
          ></span>
          <span class="task-group__label">{group.label}</span>
          <span class="task-group__count">{group.tasks.length}</span>
        </button>
        {#if effectiveExpanded.has(group.id)}
          <p class="task-group__hint">{group.hint}</p>
          <div class="task-group__items">
            {#each group.tasks as item (item.id)}
              <button
                class:active={currentTask === item.id}
                aria-current={currentTask === item.id ? "page" : undefined}
                onclick={() => openTask(item.id)}>{item.label}</button
              >
            {/each}
          </div>
        {/if}
      </div>
    {/each}
  </ScrollArea>

  <div class="repository-hero">
    <div class="repo-mark">
      <span class="codicon codicon-repo" aria-hidden="true"></span>
    </div>
    <div>
      <strong>{snapshot.info.name}</strong><span title={snapshot.info.url}
        >{snapshot.info.url ?? "未读取到仓库 URL"}</span
      >
    </div>
    <div class="repo-facts">
      <span>工作副本 r{snapshot.info.revision ?? "?"}</span><button
        class="icon-button"
        aria-label="复制仓库 URL"
        disabled={!snapshot.info.url}
        onclick={() => onAction("copy-text", { text: snapshot.info.url })}
        ><span class="codicon codicon-copy" aria-hidden="true"></span></button
      >
    </div>
  </div>

  {#if snapshot.recovery && currentTask !== "repository/recovery"}
    <div class="notice notice--warning recovery-shortcut">
      <span class="codicon codicon-tools" aria-hidden="true"></span><span
        ><strong>{snapshot.recovery.title}</strong
        >，此前写操作预览已经失效。</span
      ><button
        class="button button--secondary"
        onclick={() => openTask("repository/recovery")}>进入清理与恢复</button
      >
    </div>
  {/if}

  {#await currentTaskLoader()}
    <div class="module-loading" role="status">
      <span
        class="codicon codicon-loading codicon-modifier-spin"
        aria-hidden="true"
      ></span><span>正在加载仓库任务…</span>
    </div>
  {:then taskModule}
    {@const Task = taskModule.default}
    <Task {snapshot} {taskId} {onAction} {pathDetail} />
  {:catch}
    <div class="notice notice--error" role="alert">
      仓库任务加载失败。请重新打开此任务；如果问题持续存在，请运行环境诊断。
    </div>
  {/await}

  {#if snapshot.advanced.feedback}<div
      class="notice notice--success"
      role="status"
    >
      {snapshot.advanced.feedback}
    </div>{/if}

  {#if snapshot.advanced.preview && showsAdvancedPreview}
    <section
      class={`advanced-preview ${snapshot.advanced.preview.destructive ? "advanced-preview--destructive" : ""}`}
      aria-labelledby="advanced-preview-title"
    >
      <div class="section-heading">
        <div>
          <span class="eyebrow">已签名操作预览</span>
          <h2 id="advanced-preview-title">{snapshot.advanced.preview.title}</h2>
        </div>
        <span class="status-badge"
          >{previewOperationLabels[snapshot.advanced.preview.operation]}</span
        >
      </div>
      <div class="advanced-preview-grid">
        <div>
          <strong>命令</strong
          >{#each snapshot.advanced.preview.commands as command, commandIndex (commandIndex)}<code
              >{command}</code
            >{/each}
        </div>
        <div>
          <strong>影响</strong>
          <!-- v0.0.10：预览路径清单可搜索、复制与查看详情；不可勾选改范围。 -->
          <PreviewPathList
            paths={snapshot.advanced.preview.details}
            label="预览影响清单"
            emptyHint="此操作没有附加影响清单。"
            {onAction}
            {pathDetail}
          />
        </div>
      </div>
      {#each snapshot.advanced.preview.issues as issue, issueIndex (issueIndex)}<div
          class="notice notice--error"
        >
          {issue}
        </div>{/each}
      {#if snapshot.advanced.preview.destructive}<label
          class="destructive-confirm"
          ><input type="checkbox" bind:checked={advancedConfirmed} /><span
            >我已核对命令、目标和影响；理解该操作会修改工作副本或其绑定地址。</span
          ></label
        >{/if}
      <button
        class="button button--primary"
        disabled={!snapshot.advanced.preview.canExecute ||
          (snapshot.advanced.preview.destructive && !advancedConfirmed)}
        onclick={(event) => {
          advancedTriggerEl = event.currentTarget as HTMLElement;
          advancedIntentOpen = true;
        }}
        >确认执行{previewOperationLabels[
          snapshot.advanced.preview.operation
        ]}</button
      >
      <OperationIntentDialog
        intent={advancedIntent}
        open={advancedIntentOpen && Boolean(advancedIntent)}
        confirmLabel={advancedConfirmLabel}
        cancelLabel="取消"
        triggerElement={advancedTriggerEl}
        {onAction}
        {pathDetail}
        onConfirm={(token) => {
          advancedIntentOpen = false;
          onAction("repository/execute-advanced", { previewToken: token });
        }}
        onCancel={() => (advancedIntentOpen = false)}
      />
    </section>
  {/if}
</section>
