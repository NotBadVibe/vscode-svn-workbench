<script lang="ts">
  import type {
    RepositorySnapshot,
    WebviewAction,
    WorkbenchTaskId,
  } from "@protocol/workbenchProtocol";
  import { draftStorageLabels } from "../../../i18n/terminology";
  import {
    composeBranchTagUrl,
    isSvnUrlWithinRepository,
    normalizeSvnUrl,
  } from "../../../../svn/svnUrl";

  type AdvancedOperation = "branch" | "tag" | "switch" | "relocate" | "merge";
  type UrlOrigin = "browse" | "manual" | "shortcut";

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
  let sourceOrigin = $state<UrlOrigin>("manual");
  let targetOrigin = $state<UrlOrigin>("manual");
  let initializedRepository = $state("");
  /* V026-R43：常用路径组合（branches/tags + 名称），保留手填。 */
  let nameFamily = $state<"branches" | "tags">("branches");
  let nameInput = $state("");
  /* V026-R44：分支/标签源修订版本显式模式（远端 HEAD 或指定 rN）。 */
  let sourceRevisionMode = $state<"HEAD" | "revision">("HEAD");
  let sourceRevisionInput = $state("");
  /* V026-R43：同一预览 token 只自动作废一次，避免输入过程中反复发消息。 */
  let discardedToken = $state<string | undefined>(undefined);

  $effect(() => {
    const identity =
      snapshot.info.url ?? snapshot.info.repositoryRoot ?? snapshot.info.name;
    if (identity !== initializedRepository) {
      initializedRepository = identity;
      sourceUrl = snapshot.info.url ?? "";
      sourceOrigin = "manual";
    }
  });

  const previewForOperation = $derived(
    snapshot.advanced.preview?.operation === operation
      ? snapshot.advanced.preview
      : undefined,
  );
  /**
   * V026-R43：表单与生成该预览的绑定不一致时，旧预览视为失效。
   * V026-R44：分支/标签同时比对源修订版本绑定；旧预览缺失冻结字段时
   * 视为失效，必须重新预览以固定源 URL@revision。
   */
  const effectiveSourceRevision = $derived(
    sourceRevisionMode === "HEAD" ? "HEAD" : sourceRevisionInput.trim(),
  );
  const previewStale = $derived.by(() => {
    if (!previewForOperation) return false;
    if (
      (operation === "branch" ||
        operation === "tag" ||
        operation === "merge") &&
      (previewForOperation.sourceUrl ?? "") !== normalizeSvnUrl(sourceUrl)
    ) {
      return true;
    }
    if (operation === "branch" || operation === "tag") {
      // 旧预览无冻结字段：视为失效，要求按新契约重新预览。
      if (
        previewForOperation.sourceResolvedRevision === undefined &&
        (previewForOperation as Record<string, unknown>).sourceRevision ===
          undefined
      ) {
        return true;
      }
      const normalizeRevision = (value: string): string => {
        const trimmed = value.trim();
        if (!trimmed || /^head$/i.test(trimmed)) return "HEAD";
        return trimmed.replace(/^r/i, "").replace(/^0+(?=\d)/, "");
      };
      const bound = normalizeRevision(
        previewForOperation.sourceRevision ??
          previewForOperation.sourceResolvedRevision ??
          "HEAD",
      );
      const current = normalizeRevision(
        sourceRevisionMode === "HEAD" ? "HEAD" : effectiveSourceRevision,
      );
      // 指定模式下空输入归一化为 HEAD 会掩盖缺失：显式视为不一致。
      if (sourceRevisionMode === "revision" && !sourceRevisionInput.trim()) {
        return true;
      }
      if (bound !== current) return true;
    }
    if (
      operation !== "merge" &&
      (previewForOperation.targetUrl ?? "") !== normalizeSvnUrl(targetUrl)
    ) {
      return true;
    }
    return false;
  });

  /* V026-R43：输入变化后立即作废旧预览（同一 token 只发一次）。 */
  $effect(() => {
    const preview = previewForOperation;
    if (preview && previewStale && discardedToken !== preview.token) {
      discardedToken = preview.token;
      onAction("repository/discard-advanced-preview", {
        operation,
        reason: "source-target-changed",
      });
    }
    if (!preview && discardedToken !== undefined) {
      discardedToken = undefined;
    }
  });

  const browserUrl = $derived(snapshot.advanced.browser?.url ?? "");
  const repositoryRoot = $derived(snapshot.info.repositoryRoot ?? "");

  function describeBelonging(url: string): string {
    const trimmed = url.trim();
    if (!trimmed) return "尚未填写。";
    if (!repositoryRoot) return "仓库根未知，预览时由 Host 复验归属。";
    try {
      return isSvnUrlWithinRepository(trimmed, repositoryRoot)
        ? "位于当前仓库内。"
        : "与当前仓库归属不一致（跨仓库），预览将被阻止或要求确认。";
    } catch {
      return "地址格式待校验，预览时由 Host 复验。";
    }
  }

  function useBrowserUrl(which: "source" | "target"): void {
    if (!browserUrl) return;
    if (which === "source") {
      sourceUrl = browserUrl;
      sourceOrigin = "browse";
    } else {
      targetUrl = browserUrl;
      targetOrigin = "browse";
    }
  }

  function composeTargetFromName(): void {
    if (!repositoryRoot || !nameInput.trim()) return;
    const composed = composeBranchTagUrl(
      repositoryRoot,
      operation === "tag" ? "tags" : nameFamily,
      nameInput,
    );
    if (composed) {
      targetUrl = composed;
      targetOrigin = "shortcut";
    }
  }

  function preview(): void {
    // V026-R44：分支/标签显式源修订版本（HEAD 或指定 rN），Host 预览时固定。
    const sourceRevision =
      operation === "branch" || operation === "tag"
        ? sourceRevisionMode === "HEAD"
          ? "HEAD"
          : sourceRevisionInput.trim()
        : undefined;
    onAction("repository/preview-advanced", {
      operation,
      // 旧扁平字段保留兼容；新结构化意图优先，Host 归一化复验。
      sourceUrl,
      targetUrl,
      source:
        operation === "branch" || operation === "tag"
          ? { url: sourceUrl, origin: sourceOrigin, revision: sourceRevision }
          : { url: sourceUrl, origin: sourceOrigin },
      target: { url: targetUrl, origin: targetOrigin },
      sourceOrigin,
      targetOrigin,
      sourceRevision,
      sourceRevisionMode:
        operation === "branch" || operation === "tag"
          ? sourceRevisionMode
          : undefined,
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
        class="field"
        ><span>源 URL</span><input
          bind:value={sourceUrl}
          oninput={() => (sourceOrigin = "manual")}
        /></label
      >{/if}
    {#if operation === "branch" || operation === "tag" || operation === "merge"}
      <div class="advanced-operation-form__wide operation-guidance">
        <span
          >完整地址：{sourceUrl || "未填写"} · {describeBelonging(
            sourceUrl,
          )}</span
        >
        {#if browserUrl}<button
            type="button"
            class="button button--secondary"
            onclick={() => useBrowserUrl("source")}
            >使用当前浏览位置填入源</button
          >{/if}
      </div>
    {/if}
    {#if operation === "branch" || operation === "tag"}
      <fieldset class="advanced-operation-form__wide operation-guidance">
        <legend>源修订版本（预览时固定为 rN，执行不再跟随新的 HEAD）</legend>
        <label
          ><input
            type="radio"
            name="source-revision-mode"
            value="HEAD"
            bind:group={sourceRevisionMode}
          />远端 HEAD（预览时解析为固定修订版本）</label
        >
        <label
          ><input
            type="radio"
            name="source-revision-mode"
            value="revision"
            bind:group={sourceRevisionMode}
          />指定修订版本</label
        >
        {#if sourceRevisionMode === "revision"}<input
            bind:value={sourceRevisionInput}
            placeholder="例如 r42"
            inputmode="numeric"
            aria-label="指定源修订版本"
          />{/if}
      </fieldset>
    {/if}
    {#if operation !== "merge"}<label class="field"
        ><span>{operation === "relocate" ? "新的仓库根地址" : "目标 URL"}</span
        ><input
          bind:value={targetUrl}
          oninput={() => (targetOrigin = "manual")}
          placeholder={operation === "branch"
            ? "…/branches/feature-name"
            : operation === "tag"
              ? "…/tags/v1.0.0"
              : "https://…"}
        /></label
      >{/if}
    {#if operation !== "merge"}
      <div class="advanced-operation-form__wide operation-guidance">
        <span
          >完整地址：{targetUrl || "未填写"} · {describeBelonging(
            targetUrl,
          )}</span
        >
        {#if browserUrl}<button
            type="button"
            class="button button--secondary"
            onclick={() => useBrowserUrl("target")}
            >使用当前浏览位置填入目标</button
          >{/if}
      </div>
    {/if}
    {#if (operation === "branch" || operation === "tag") && repositoryRoot}
      <div class="advanced-operation-form__wide operation-guidance">
        <label class="field"
          ><span>常用路径组合（保留手填）</span>
          <span class="advanced-shortcut-row">
            {#if operation === "branch"}<select
                aria-label="分支目录"
                bind:value={nameFamily}
              >
                <option value="branches">branches/</option>
                <option value="tags">tags/</option>
              </select>{/if}
            <input
              bind:value={nameInput}
              placeholder={operation === "branch"
                ? "feature-name，可含多段"
                : "v1.0.0"}
              aria-label={operation === "branch" ? "分支名称" : "标签名称"}
            />
            <button
              type="button"
              class="button button--secondary"
              disabled={!nameInput.trim()}
              onclick={composeTargetFromName}>组合为目标 URL</button
            >
          </span>
        </label>
      </div>
    {/if}
    {#if operation === "branch" || operation === "tag"}<label
        class="field advanced-operation-form__wide"
        ><span>仓库提交说明</span><input
          bind:value={operationMessage}
          placeholder="创建原因与关联任务"
        /></label
      >{/if}
    {#if previewStale}
      <div
        class="advanced-operation-form__wide notice notice--warning"
        role="status"
      >
        源、源修订版本或目标已变化，旧预览已自动作废。请重新生成预览后再确认执行；最终写入仍走原有安全契约。
      </div>
    {/if}
    <div class="advanced-operation-form__wide operation-guidance">
      <span class="codicon codicon-shield" aria-hidden="true"
      ></span>{operation === "branch" || operation === "tag"
        ? "使用仓库端复制，不会夹带本地未提交修改；浏览选择只填充地址，不改变本地工作副本范围。"
        : operation === "merge"
          ? "只写入工作副本，不自动提交；冲突保持待处理；浏览选择只填充源，不改变本地范围。"
          : `${draftStorageLabels.advancedGuardHint}浏览选择只填充地址，不改变本地工作副本范围。`}
    </div>
    <button
      class="button button--primary advanced-operation-form__wide"
      onclick={preview}>生成{operationLabels[operation]}预览</button
    >
  </div>
</section>

<style>
  .advanced-shortcut-row {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .advanced-shortcut-row select {
    max-width: 140px;
  }
  .advanced-shortcut-row input {
    flex: 1;
  }
</style>
