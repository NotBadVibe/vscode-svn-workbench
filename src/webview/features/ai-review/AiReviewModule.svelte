<script lang="ts">
  import type { AiReviewSnapshot, WebviewAction } from '@protocol/workbenchProtocol';
  import ScrollArea from '../../components/ui/ScrollArea.svelte';
  import { formatZhNumber } from '../../i18n/formatters';
  import { confidenceLabels, findingCategoryLabels, sourceLabels } from '../../i18n/terminology';
  let { snapshot, onAction }: { snapshot: AiReviewSnapshot; onAction: (action: WebviewAction, data?: Record<string, unknown>) => void } = $props();
  let severity = $state<'all' | 'critical' | 'warning' | 'note'>('all');
  const visible = $derived(snapshot.findings.filter((item) => severity === 'all' || item.severity === severity));
  const severityLabels = { critical: '高风险', warning: '提醒', note: '建议' };
</script>

<section class="intelligence-page">
  <header class="page-heading page-heading--actions">
    <div><span class="eyebrow">基于证据的审查</span><h1>AI 变更审查</h1><p>结论必须关联文件、位置和证据；当前来源：{sourceLabels[snapshot.source]}</p></div>
    <button class="button button--primary" onclick={() => onAction('ai-review/run')}><span class="codicon codicon-sparkle" aria-hidden="true"></span>重新审查</button>
  </header>

  <div class="privacy-strip">
    <span class="codicon codicon-shield" aria-hidden="true"></span>
    <span><strong>{snapshot.privacy.files}</strong> 个文件</span><span><strong>{formatZhNumber(snapshot.privacy.characters)}</strong>/{formatZhNumber(snapshot.privacy.maxCharacters)} 个字符</span><span>历史：{snapshot.privacy.historyIncluded ? '包含' : '不包含'}</span><span>模型：{snapshot.privacy.model}</span>
  </div>
  <div class="review-summary">
    <button class:active={severity === 'all'} onclick={() => (severity = 'all')}><strong>{snapshot.findings.length}</strong><span>全部</span></button>
    <button class:active={severity === 'critical'} onclick={() => (severity = 'critical')}><strong>{snapshot.summary.critical}</strong><span>高风险</span></button>
    <button class:active={severity === 'warning'} onclick={() => (severity = 'warning')}><strong>{snapshot.summary.warning}</strong><span>提醒</span></button>
    <button class:active={severity === 'note'} onclick={() => (severity = 'note')}><strong>{snapshot.summary.note}</strong><span>建议</span></button>
  </div>
  {#each snapshot.warnings as warning}<div class="notice notice--warning">{warning}</div>{/each}

  {#if visible.length === 0}
    <div class="empty-state empty-state--large"><span class="codicon codicon-pass-filled" aria-hidden="true"></span><div><strong>当前筛选没有发现项</strong><p>本地规则未发现确定问题；这不等于代码已经完成全部验证。</p></div></div>
  {:else}
    <ScrollArea class="finding-list" label="AI 审查发现">
      {#each visible as finding (finding.id)}
        <article class={`finding-card finding-card--${finding.severity}`}>
          <div class="finding-heading"><span class={`severity-dot severity-dot--${finding.severity}`} aria-hidden="true"></span><div><span class="eyebrow">{severityLabels[finding.severity]} · {findingCategoryLabels[finding.category]}</span><h2>{finding.title}</h2></div><span class={`confidence confidence--${finding.confidence}`}>{confidenceLabels[finding.confidence]}</span></div>
          {#if finding.relativePath}<button class="evidence-location" onclick={() => onAction('open-diff', { relativePath: finding.relativePath })}><span class="codicon codicon-file-code" aria-hidden="true"></span>{finding.relativePath}{finding.line ? `:${finding.line}` : ''}</button>{/if}
          <blockquote>{finding.evidence}</blockquote>
          <p><strong>建议：</strong>{finding.recommendation}</p>
        </article>
      {/each}
    </ScrollArea>
  {/if}
</section>
