<script lang="ts">
  import type {
    HostToWebviewMessage,
    ImpactSnapshot,
    WebviewAction,
  } from "@protocol/workbenchProtocol";
  import ScrollArea from "../../components/ui/ScrollArea.svelte";
  import SearchInput from "../../components/list/SearchInput.svelte";
  import ResultCount from "../../components/list/ResultCount.svelte";
  import FilePathDetail from "../../components/svn/FilePathDetail.svelte";
  import { naturalCompare } from "../../../selection/selectionSort";
  import {
    localPurposeHeading,
    riskLabels,
    sourceLabels,
  } from "../../i18n/terminology";
  /*
   * v0.0.10 过渡迁移（只读）：风险/标题排序、影响路径搜索与路径详情；
   * 不为形式增加复选框（完整合并页留给 v0.0.12）。
   */
  let {
    snapshot,
    onAction,
    pathDetail,
  }: {
    snapshot: ImpactSnapshot;
    onAction: (action: WebviewAction, data?: Record<string, unknown>) => void;
    /** v0.0.10：路径详情结果（Host 一次性下发）。 */
    pathDetail?: Extract<
      HostToWebviewMessage,
      { type: "file/path-detail-result" }
    >["payload"];
  } = $props();

  let pathQuery = $state("");
  let sortField = $state<"default" | "risk" | "title">("default");
  let detailOpen = $state(false);
  let detailTrigger = $state<HTMLButtonElement | null>(null);
  let detailPath = $state("");

  const RISK_ORDER = ["high", "medium", "low"] as const;

  const visibleAreas = $derived.by(() => {
    const needle = pathQuery.trim().toLowerCase();
    const matched = snapshot.areas.filter((area) => {
      if (!needle) return true;
      return (
        area.title.toLowerCase().includes(needle) ||
        area.detail.toLowerCase().includes(needle) ||
        area.paths.some((path) => path.toLowerCase().includes(needle))
      );
    });
    if (sortField === "default") return matched;
    return [...matched].sort((left, right) => {
      if (sortField === "risk") {
        const leftRank = RISK_ORDER.indexOf(left.risk);
        const rightRank = RISK_ORDER.indexOf(right.risk);
        if (leftRank !== rightRank) return leftRank - rightRank;
      }
      return naturalCompare(left.title, right.title);
    });
  });

  /** 搜索命中时隐藏未命中的路径行，命中数量如实展示。 */
  function areaPaths(area: ImpactSnapshot["areas"][number]): string[] {
    const needle = pathQuery.trim().toLowerCase();
    if (!needle) return area.paths;
    return area.paths.filter((path) => path.toLowerCase().includes(needle));
  }

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

<section class="intelligence-page">
  <header class="page-heading page-heading--actions">
    <div>
      <span class="eyebrow">按路径与本地规则生成的建议</span>
      <h1>{localPurposeHeading.impact}</h1>
      <p>
        本页依据变更文件路径、数量与本地规则生成固定建议，不进行依赖关系分析，也不调用外部模型。当前来源：{sourceLabels[
          snapshot.source
        ]}
      </p>
      <p class="purpose-note">
        适用：当前项目与右键范围（{snapshot.changedFiles} 个变更文件）。使用的数据类型：文件相对路径与文件类型。得到结果后下一步：人工核对这些建议并决定验证命令。本页不修改文件，也不执行
        SVN 写操作。
      </p>
    </div>
    <button
      class="button button--primary"
      onclick={() => onAction("impact/run")}
      ><span class="codicon codicon-pulse" aria-hidden="true"
      ></span>重新分析</button
    >
  </header>
  {#each snapshot.warnings as warning, warningIndex (warningIndex)}<div
      class="notice notice--warning"
    >
      {warning}
    </div>{/each}
  <div class="impact-layout">
    <ScrollArea label="影响区域">
      <div class="section-heading">
        <div>
          <span class="eyebrow">影响范围</span>
          <h2>影响区域</h2>
        </div>
      </div>
      <div class="impact-filter-bar" aria-label="影响区域筛选">
        <SearchInput
          bind:value={pathQuery}
          ariaLabel="筛选影响区域与路径"
          placeholder="标题、说明、路径…"
          compact
        />
        <ResultCount count={visibleAreas.length} suffix="个区域" />
        <select
          class="sort-menu"
          aria-label="影响区域排序"
          value={sortField}
          onchange={(event) => {
            const value = (event.currentTarget as HTMLSelectElement).value;
            sortField =
              value === "risk" || value === "title" ? value : "default";
          }}
        >
          <option value="default">默认顺序</option>
          <option value="risk">按风险（高优先）</option>
          <option value="title">按标题</option>
        </select>
      </div>
      {#if pathDetail && detailOpen}
        <div class="path-detail-host">
          <div class="path-detail-host__bar">
            <span class="path-detail-host__target"
              >{pathDetail.relativePath}</span
            >
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
      {#if visibleAreas.length === 0}
        <div class="mini-empty">
          {snapshot.areas.length === 0
            ? "当前变更没有生成影响区域。"
            : "没有匹配的影响区域；调整搜索词后重试。"}
        </div>
      {/if}
      <div class="impact-areas">
        {#each visibleAreas as area (area.id)}
          <article>
            <div>
              <span class="codicon codicon-symbol-namespace" aria-hidden="true"
              ></span><strong>{area.title}</strong><span
                class={`risk-badge risk-badge--${area.risk}`}
                >{riskLabels[area.risk]}</span
              >
            </div>
            <p>{area.detail}</p>
            <details>
              <summary>{areaPaths(area).length} 条路径</summary
              >{#each areaPaths(area) as item (item)}<span
                  class="impact-path-row"
                  ><button
                    onclick={() =>
                      onAction("open-diff", { relativePath: item })}
                    >{item}</button
                  ><button
                    type="button"
                    class="icon-button icon-button--small"
                    aria-label={`查看 ${item} 路径详情`}
                    title="路径详情"
                    onclick={(event) => openDetail(item, event.currentTarget)}
                    ><span class="codicon codicon-info" aria-hidden="true"
                    ></span></button
                  ></span
                >{/each}
            </details>
          </article>
        {/each}
      </div>
    </ScrollArea>
    <ScrollArea label="测试建议与上线观察">
      <div class="section-heading">
        <div>
          <span class="eyebrow">测试计划</span>
          <h2>建议验证</h2>
        </div>
      </div>
      <div class="test-plan">
        {#each snapshot.tests as item (item.title)}<article>
            <span class="codicon codicon-beaker" aria-hidden="true"></span>
            <div>
              <strong>{item.title}</strong>
              <p>{item.reason}</p>
              {#if item.command}<code>{item.command}</code>{/if}
            </div>
          </article>{/each}
      </div>
      <div class="section-heading observation-heading">
        <div>
          <span class="eyebrow">上线观察</span>
          <h2>上线观察点</h2>
        </div>
      </div>
      <ul class="observation-list">
        {#each snapshot.observations as item, observationIndex (observationIndex)}<li
          >
            {item}
          </li>{/each}
      </ul>
    </ScrollArea>
  </div>
</section>
