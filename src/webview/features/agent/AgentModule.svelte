<script lang="ts">
  import type {
    AgentSnapshot,
    WebviewAction,
  } from "@protocol/workbenchProtocol";
  import ScrollArea from "../../components/ui/ScrollArea.svelte";
  import { isExplicitSubmitShortcut } from "../../i18n/keyboard";
  let {
    snapshot,
    onAction,
  }: {
    snapshot: AgentSnapshot;
    onAction: (action: WebviewAction, data?: Record<string, unknown>) => void;
  } = $props();
  let objective = $state("");
  $effect(() => {
    if (snapshot.objective) objective = snapshot.objective;
  });
  const statusLabels = {
    idle: "待运行",
    planned: "等待运行",
    running: "执行中",
    completed: "已完成",
    cancelled: "已取消",
    failed: "失败/过期",
  };
  const capabilityLabels = {
    "svn-read": "SVN 只读",
    "local-analysis": "本地分析",
  } as const;
  function handleObjectiveKeydown(event: KeyboardEvent): void {
    if (
      !isExplicitSubmitShortcut(event) ||
      !objective.trim() ||
      snapshot.status === "running"
    )
      return;
    event.preventDefault();
    onAction("agent/create-plan", { objective });
  }
</script>

<section class="agent-page">
  <header class="page-heading">
    <div>
      <span class="eyebrow">固定只读流水线</span>
      <h1>本地检查流水线</h1>
      <p>
        本页按固定顺序运行三步只读检查：重新采集 SVN
        状态、本地证据检查、影响与测试计划。步骤不根据输入目标改变，也不调用外部模型；任何步骤都不修改文件或执行
        SVN 写操作。
      </p>
    </div>
  </header>

  <div class="agent-layout">
    <section class="agent-main">
      <div class="agent-objective">
        <label class="field"
          ><span>任务目标</span><textarea
            bind:value={objective}
            disabled={snapshot.status === "running"}
            onkeydown={handleObjectiveKeydown}
            aria-describedby="agent-objective-shortcut"
            placeholder="例如：检查当前范围是否适合提交，并给出测试建议"
          ></textarea><small id="agent-objective-shortcut"
            >按 Ctrl/⌘ + Enter 生成计划</small
          ></label
        >
        <button
          class="button button--primary"
          disabled={!objective.trim() || snapshot.status === "running"}
          onclick={() => onAction("agent/create-plan", { objective })}
          >运行固定流水线</button
        >
      </div>
      {#if snapshot.message}<div
          class={`notice notice--${snapshot.status === "failed" ? "error" : snapshot.status === "completed" ? "success" : "warning"}`}
          role="status"
        >
          {snapshot.message}
        </div>{/if}
      <div class="agent-status">
        <span class={`agent-state agent-state--${snapshot.status}`}
          >{statusLabels[snapshot.status]}</span
        >{#if snapshot.steps.length}<button
            class="button button--secondary"
            disabled={snapshot.status === "completed" ||
              snapshot.status === "cancelled"}
            onclick={() => onAction("agent/cancel")}>取消计划</button
          >{/if}
      </div>

      {#if snapshot.steps.length === 0}
        <div class="preview-empty">
          <span class="codicon codicon-hubot" aria-hidden="true"></span>
          <p>
            固定只读流水线不会扩大范围或执行写操作。输入目标后运行，步骤按序执行。
          </p>
        </div>
      {:else}
        <ScrollArea class="agent-steps" label="本地检查流水线步骤">
          {#each snapshot.steps as step, index (step.id)}
            <article class={`agent-step agent-step--${step.status}`}>
              <div class="agent-step-index">
                {step.status === "completed" ? "✓" : index + 1}
              </div>
              <div class="agent-step-body">
                <div>
                  <strong>{step.title}</strong><span class="status-badge"
                    >{capabilityLabels[step.capability]}</span
                  >
                </div>
                <p>{step.detail}</p>
                <dl class="agent-step-facts">
                  <div>
                    <dt>范围</dt>
                    <dd>{step.scope}</dd>
                  </div>
                  <div>
                    <dt>风险</dt>
                    <dd>{step.risk}</dd>
                  </div>
                  <div>
                    <dt>可撤销性</dt>
                    <dd>{step.reversibility}</dd>
                  </div>
                </dl>
                {#if step.command}<code>{step.command}</code
                  >{/if}{#if step.output}<div class="step-output">
                    {step.output}
                  </div>{/if}
              </div>
              <button
                class="button button--secondary"
                disabled={snapshot.nextStepId !== step.id ||
                  snapshot.status === "running"}
                onclick={() =>
                  onAction("agent/approve-step", { stepId: step.id })}
                >{step.status === "completed"
                  ? "已完成"
                  : step.status === "running"
                    ? "执行中"
                    : "执行此步"}</button
              >
            </article>
          {/each}
        </ScrollArea>
      {/if}
      {#if snapshot.status === "completed"}
        <div class="agent-next-actions">
          <button
            class="button button--secondary"
            onclick={() =>
              onAction("open-module", {
                moduleId: "ai-review",
                taskId: "ai-review/review",
              })}>查看审查证据</button
          ><button
            class="button button--secondary"
            onclick={() =>
              onAction("open-module", {
                moduleId: "impact",
                taskId: "impact/analyze",
              })}>查看影响分析</button
          ><button
            class="button button--primary"
            onclick={() =>
              onAction("open-module", {
                moduleId: "commit",
                taskId: "commit/compose",
              })}>进入提交前检查</button
          >
        </div>
      {/if}
    </section>

    <ScrollArea class="agent-guardrails" label="本地检查流水线执行边界">
      <div class="section-heading">
        <div>
          <span class="eyebrow">安全边界</span>
          <h2>执行边界</h2>
        </div>
        <span class="codicon codicon-shield" aria-hidden="true"></span>
      </div>
      <ul>
        {#each snapshot.guardrails as item, guardrailIndex (guardrailIndex)}<li>
            <span class="codicon codicon-pass" aria-hidden="true"></span>{item}
          </li>{/each}
      </ul>
      <div class="notice">
        <span class="codicon codicon-lock" aria-hidden="true"></span><span
          >本流水线只执行 SVN
          只读采集和本地分析。提交、标记冲突已解决、更新等写操作必须回到对应模块重新预览确认。</span
        >
      </div>
    </ScrollArea>
  </div>
</section>
