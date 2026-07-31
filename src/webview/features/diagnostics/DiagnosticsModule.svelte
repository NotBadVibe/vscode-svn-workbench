<script lang="ts">
  import type { DiagnosticsSnapshot, WebviewAction, WorkbenchTaskId } from '@protocol/workbenchProtocol';
  import ScrollArea from '../../components/ui/ScrollArea.svelte';
  import { formatZhDateTime } from '../../i18n/formatters';

  let { snapshot, taskId = 'diagnostics/environment', onAction }: { snapshot: DiagnosticsSnapshot; taskId?: WorkbenchTaskId; onAction: (action: WebviewAction, data?: Record<string, unknown>) => void } = $props();
  let expanded = $state<string | undefined>();
  const statusLabels = { pass: '通过', warn: '提醒', fail: '失败' };
</script>

<section class="diagnostics-page">
  <header class="page-heading page-heading--actions">
    <div><span class="eyebrow">运行状态与验收</span><h1>{taskId === 'diagnostics/acceptance' ? '人工验收清单' : '环境诊断'}</h1><p>生成于 {formatZhDateTime(snapshot.generatedAt)}</p></div>
    <div class="toolbar-actions"><button class="button button--secondary" onclick={() => onAction('diagnostics/show-output')}>查看输出</button><button class="button button--primary" onclick={() => onAction('diagnostics/run')}>重新检查</button></div>
  </header>

  <div class="settings-tabs" role="tablist" aria-label="诊断分类">
    <button role="tab" aria-selected={taskId === 'diagnostics/environment'} class:active={taskId === 'diagnostics/environment'} onclick={() => onAction('open-module', { moduleId: 'diagnostics', taskId: 'diagnostics/environment' })}>运行环境</button>
    <button role="tab" aria-selected={taskId === 'diagnostics/acceptance'} class:active={taskId === 'diagnostics/acceptance'} onclick={() => onAction('open-module', { moduleId: 'diagnostics', taskId: 'diagnostics/acceptance' })}>验收清单</button>
  </div>

  {#if taskId === 'diagnostics/environment'}
  <div class="diagnostic-summary diagnostic-summary--{snapshot.status}">
    <span class={`codicon codicon-${snapshot.status === 'pass' ? 'pass-filled' : snapshot.status === 'warn' ? 'warning' : 'error'}`} aria-hidden="true"></span>
    <div><strong>总体{statusLabels[snapshot.status]}</strong><p>{snapshot.checks.filter((item) => item.status === 'pass').length} 项通过，{snapshot.checks.filter((item) => item.status !== 'pass').length} 项需要关注。</p></div>
  </div>

  <div class="diagnostics-layout diagnostics-layout--single">
    <section>
      <div class="section-heading"><div><span class="eyebrow">环境检查</span><h2>运行环境</h2></div></div>
      <ScrollArea class="diagnostic-list" label="环境检查项目">
        {#each snapshot.checks as check (check.id)}
          <article class="diagnostic-row">
            <span class={`check-icon check-icon--${check.status}`} role="img" aria-label={statusLabels[check.status]}><span class={`codicon codicon-${check.status === 'pass' ? 'pass-filled' : check.status === 'warn' ? 'warning' : 'error'}`} aria-hidden="true"></span></span>
            <div><strong>{check.label}</strong><p>{check.detail}</p>{#if check.action}<small>{check.action}</small>{/if}</div>
          </article>
        {/each}
      </ScrollArea>
    </section>
  </div>
  {:else}
  <div class="diagnostics-layout diagnostics-layout--single">
    <section>
      <div class="section-heading"><div><span class="eyebrow">验收步骤</span><h2>人工验收清单</h2></div><span class="status-badge">{snapshot.acceptance.summary.items} 项</span></div>
      <div class="acceptance-facts"><span>{snapshot.acceptance.summary.sections} 个分组</span><span>{snapshot.acceptance.summary.steps} 个步骤</span><span>{snapshot.acceptance.summary.expectedResults} 个期望</span></div>
      <ScrollArea class="acceptance-list" label="人工验收项目">
        {#each snapshot.acceptance.sections as section (section.id)}
          <button class="acceptance-section" aria-expanded={expanded === section.id} onclick={() => (expanded = expanded === section.id ? undefined : section.id)}>
            <span><strong>{section.title}</strong><small>{section.items.length} 项</small></span><span class={`codicon codicon-chevron-${expanded === section.id ? 'up' : 'down'}`} aria-hidden="true"></span>
          </button>
          {#if expanded === section.id}
            <div class="acceptance-items">
              {#each section.items as item (item.id)}
                <article><strong>{item.title}</strong><p>{item.description}</p><details><summary>步骤与期望</summary><ol>{#each item.steps as step}<li>{step}</li>{/each}</ol><ul>{#each item.expected as expected}<li>{expected}</li>{/each}</ul></details></article>
              {/each}
            </div>
          {/if}
        {/each}
      </ScrollArea>
      <button class="button button--secondary copy-report" onclick={() => onAction('copy-text', { text: snapshot.reportText })}>复制诊断报告</button>
    </section>
  </div>
  {/if}
</section>
