<script lang="ts">
  import type {
    ImpactSnapshot,
    WebviewAction,
  } from "@protocol/workbenchProtocol";
  import ScrollArea from "../../components/ui/ScrollArea.svelte";
  import { riskLabels, sourceLabels } from "../../i18n/terminology";
  let {
    snapshot,
    onAction,
  }: {
    snapshot: ImpactSnapshot;
    onAction: (action: WebviewAction, data?: Record<string, unknown>) => void;
  } = $props();
</script>

<section class="intelligence-page">
  <header class="page-heading page-heading--actions">
    <div>
      <span class="eyebrow">变更智能分析</span>
      <h1>影响与测试建议</h1>
      <p>
        {snapshot.changedFiles} 个变更文件 · {sourceLabels[snapshot.source]}
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
      <div class="impact-areas">
        {#each snapshot.areas as area (area.id)}
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
              <summary>{area.paths.length} 条路径</summary
              >{#each area.paths as item, pathIndex (`${area.id}:${pathIndex}`)}<button
                  onclick={() => onAction("open-diff", { relativePath: item })}
                  >{item}</button
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
