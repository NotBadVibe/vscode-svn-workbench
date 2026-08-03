<script lang="ts">
  import type {
    RepositorySnapshot,
    WebviewAction,
    WorkbenchTaskId,
  } from "@protocol/workbenchProtocol";

  type AdvancedOperation = "branch" | "tag" | "switch" | "relocate" | "merge";

  let {
    snapshot,
    taskId,
    onAction,
  }: {
    snapshot: RepositorySnapshot;
    taskId: WorkbenchTaskId;
    onAction: (action: WebviewAction, data?: Record<string, unknown>) => void;
  } = $props();

  const operationLabels: Record<AdvancedOperation, string> = {
    branch: "创建分支（Branch）",
    tag: "创建标签（Tag）",
    switch: "切换工作副本（Switch）",
    relocate: "重定位仓库地址（Relocate）",
    merge: "合并到工作副本（Merge）",
  };
  const operation = $derived(taskId.split("/")[1] as AdvancedOperation);
  let sourceUrl = $state("");
  let targetUrl = $state("");
  let operationMessage = $state("");
  let initializedRepository = $state("");

  $effect(() => {
    const identity =
      snapshot.info.url ?? snapshot.info.repositoryRoot ?? snapshot.info.name;
    if (identity !== initializedRepository) {
      initializedRepository = identity;
      sourceUrl = snapshot.info.url ?? "";
    }
  });

  function preview(): void {
    onAction("repository/preview-advanced", {
      operation,
      sourceUrl,
      targetUrl,
      message: operationMessage,
    });
  }
</script>

<section class="operation-card operation-card--wide repository-task-card">
  <div class="section-heading">
    <div>
      <span class="eyebrow">高级仓库操作</span>
      <h2>{operationLabels[operation]}</h2>
    </div>
    <span class="status-badge">先预览</span>
  </div>
  <div class="advanced-operation-form">
    {#if operation === "branch" || operation === "tag" || operation === "merge"}<label
        class="field"><span>源 URL</span><input bind:value={sourceUrl} /></label
      >{/if}
    {#if operation !== "merge"}<label class="field"
        ><span>{operation === "relocate" ? "新的仓库根地址" : "目标 URL"}</span
        ><input
          bind:value={targetUrl}
          placeholder={operation === "branch"
            ? "…/branches/feature-name"
            : operation === "tag"
              ? "…/tags/v1.0.0"
              : "https://…"}
        /></label
      >{/if}
    {#if operation === "branch" || operation === "tag"}<label
        class="field advanced-operation-form__wide"
        ><span>仓库提交说明</span><input
          bind:value={operationMessage}
          placeholder="创建原因与关联任务"
        /></label
      >{/if}
    <div class="advanced-operation-form__wide operation-guidance">
      <span class="codicon codicon-shield" aria-hidden="true"
      ></span>{operation === "branch" || operation === "tag"
        ? "使用仓库端复制，不会夹带本地未提交修改。"
        : operation === "merge"
          ? "只写入工作副本，不自动提交；冲突保持待处理。"
          : "本地有未提交修改时，扩展主机会阻止执行。"}
    </div>
    <button
      class="button button--primary advanced-operation-form__wide"
      onclick={preview}>生成{operationLabels[operation]}预览</button
    >
  </div>
</section>
