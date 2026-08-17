<script lang="ts">
  import type {
    AiReviewSnapshot,
    WebviewAction,
  } from "@protocol/workbenchProtocol";
  import ScrollArea from "../../components/ui/ScrollArea.svelte";
  import SearchInput from "../../components/list/SearchInput.svelte";
  import ResultCount from "../../components/list/ResultCount.svelte";
  import { formatZhNumber } from "../../i18n/formatters";
  import {
    confidenceLabels,
    findingCategoryLabels,
    localPurposeHeading,
    sourceLabels,
  } from "../../i18n/terminology";
  /*
   * v0.0.10 过渡迁移（只读）：标题/证据/路径搜索与严重度、分类筛选；
   * 不为形式增加复选框或批量动作（完整合并页留给 v0.0.12）。
   */
  let {
    snapshot,
    onAction,
  }: {
    snapshot: AiReviewSnapshot;
    onAction: (action: WebviewAction, data?: Record<string, unknown>) => void;
  } = $props();
  let severity = $state<"all" | "critical" | "warning" | "note">("all");
  let category = $state<
    "all" | AiReviewSnapshot["findings"][number]["category"]
  >("all");
  let query = $state("");
  /** 分类选项从当前发现推导，不虚构不存在的分类。 */
  const availableCategories = $derived([
    ...new Set(snapshot.findings.map((item) => item.category)),
  ]);
  const visible = $derived(
    snapshot.findings.filter((item) => {
      if (severity !== "all" && item.severity !== severity) return false;
      if (category !== "all" && item.category !== category) return false;
      const needle = query.trim().toLowerCase();
      if (!needle) return true;
      return [
        item.title,
        item.evidence,
        item.relativePath ?? "",
        item.recommendation,
      ].some((value) => value.toLowerCase().includes(needle));
    }),
  );
  const severityLabels = { critical: "高风险", warning: "提醒", note: "建议" };
</script>

<section class="intelligence-page">
  <header class="page-heading page-heading--actions">
    <div>
      <span class="eyebrow">基于本地规则的检查</span>
      <h1>{localPurposeHeading.review}</h1>
      <p>
        本页运行未外发的本地规则（敏感信息、调试残留、生成物与缺少测试文件），不调用外部模型。结论关联文件、位置和证据；当前来源：{sourceLabels[
          snapshot.source
        ]}
      </p>
      <p class="purpose-note">
        适用：当前项目与右键范围。使用的数据类型：候选文件内容与文件类型规则。得到结果后下一步：根据证据决定是否调整提交范围，或进入提交前检查。本页不修改文件，也不执行
        SVN 写操作。
      </p>
    </div>
    <button
      class="button button--primary"
      onclick={() => onAction("ai-review/run")}
      ><span class="codicon codicon-sparkle" aria-hidden="true"
      ></span>重新检查</button
    >
  </header>

  <div class="privacy-strip">
    <span class="codicon codicon-shield" aria-hidden="true"></span>
    <span><strong>{snapshot.privacy.files}</strong> 个文件</span><span
      ><strong>{formatZhNumber(snapshot.privacy.characters)}</strong
      >/{formatZhNumber(snapshot.privacy.maxCharacters)} 个字符</span
    ><span>历史：{snapshot.privacy.historyIncluded ? "包含" : "不包含"}</span
    ><span>模型：{snapshot.privacy.model}</span>
  </div>
  <div class="review-summary">
    <button class:active={severity === "all"} onclick={() => (severity = "all")}
      ><strong>{snapshot.findings.length}</strong><span>全部</span></button
    >
    <button
      class:active={severity === "critical"}
      onclick={() => (severity = "critical")}
      ><strong>{snapshot.summary.critical}</strong><span>高风险</span></button
    >
    <button
      class:active={severity === "warning"}
      onclick={() => (severity = "warning")}
      ><strong>{snapshot.summary.warning}</strong><span>提醒</span></button
    >
    <button
      class:active={severity === "note"}
      onclick={() => (severity = "note")}
      ><strong>{snapshot.summary.note}</strong><span>建议</span></button
    >
  </div>
  {#each snapshot.warnings as warning, warningIndex (warningIndex)}<div
      class="notice notice--warning"
    >
      {warning}
    </div>{/each}

  <div class="review-filter-bar" aria-label="发现筛选">
    <SearchInput
      bind:value={query}
      ariaLabel="筛选检查发现"
      placeholder="标题、证据、路径…"
      compact
    />
    <ResultCount count={visible.length} suffix="条发现" />
    <div class="status-filters" aria-label="分类筛选">
      <button
        class:active={category === "all"}
        onclick={() => (category = "all")}>全部分类</button
      >
      {#each availableCategories as value (value)}
        <button
          class:active={category === value}
          onclick={() => (category = value)}
          >{findingCategoryLabels[value]}</button
        >
      {/each}
    </div>
  </div>

  {#if visible.length === 0}
    <div class="empty-state empty-state--large">
      <span class="codicon codicon-pass-filled" aria-hidden="true"></span>
      <div>
        <strong>当前筛选没有发现项</strong>
        <p>
          本地检查未命中规则，没有发现确定问题；这不等于代码已经完成全部验证。
        </p>
      </div>
    </div>
  {:else}
    <ScrollArea class="finding-list" label="本地检查发现">
      {#each visible as finding (finding.id)}
        <article class={`finding-card finding-card--${finding.severity}`}>
          <div class="finding-heading">
            <span
              class={`severity-dot severity-dot--${finding.severity}`}
              aria-hidden="true"
            ></span>
            <div>
              <span class="eyebrow"
                >{severityLabels[finding.severity]} · {findingCategoryLabels[
                  finding.category
                ]}</span
              >
              <h2>{finding.title}</h2>
            </div>
            <span class={`confidence confidence--${finding.confidence}`}
              >{confidenceLabels[finding.confidence]}</span
            >
          </div>
          {#if finding.relativePath}<button
              class="evidence-location"
              onclick={() =>
                onAction("open-diff", { relativePath: finding.relativePath })}
              ><span class="codicon codicon-file-code" aria-hidden="true"
              ></span>{finding.relativePath}{finding.line
                ? `:${finding.line}`
                : ""}</button
            >{/if}
          <blockquote>{finding.evidence}</blockquote>
          <p><strong>建议：</strong>{finding.recommendation}</p>
        </article>
      {/each}
    </ScrollArea>
  {/if}
</section>
