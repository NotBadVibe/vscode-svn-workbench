<script lang="ts">
  import { untrack } from "svelte";
  import type {
    SettingsSnapshot,
    WebviewAction,
    WorkbenchTaskId,
  } from "@protocol/workbenchProtocol";
  import ScrollArea from "../../components/ui/ScrollArea.svelte";
  import { formatZhDateTime } from "../../i18n/formatters";
  // 中文注释：V017-C T6——模块主区落点（挂载聚焦一次，刷新不抢焦点）。
  import { focusOnMount } from "../../components/ui/focusOnMount";
  import { confidenceLabels, sourceLabels } from "../../i18n/terminology";
  import SelectionTask from "./SelectionTask.svelte";

  let {
    snapshot,
    taskId = "settings/ai",
    onAction,
  }: {
    snapshot: SettingsSnapshot;
    taskId: WorkbenchTaskId;
    onAction: (action: WebviewAction, data?: Record<string, unknown>) => void;
  } = $props();

  let tab = $state<"ai" | "selection" | "team" | "svn">("ai");
  let providerPreset = $state("");
  let baseUrl = $state("");
  let model = $state("");
  let apiKey = $state("");
  let clearApiKey = $state(false);
  let scenarioModels = $state<Record<string, string>>({});
  let includeCommitHistory = $state(false);
  let historyLimit = $state(10);
  let enabled = $state(false);
  let requiredIssueId = $state(false);
  let issueIdPattern = $state("");
  let requiredModule = $state(false);
  let allowedModulesText = $state("");
  let requiredPrefix = $state(false);
  let allowedPrefixesText = $state("");

  // 中文注释：V020-R07——表单草稿与快照反馈分离。baseline 记录上次应用的已保存
  // 配置；草稿仅在初次装载、保存成功确认或用户放弃修改时重置。测试连接与读取
  // 模型列表返回的快照只更新反馈与模型列表，不再回填草稿、不清空新密钥。
  // 密钥只走既有安全输入通道与 SecretStorage：快照仅携带 hasApiKey 布尔状态，
  // 本页不缓存、不回显密钥明文。
  interface AiConfigBaseline {
    providerPreset: string;
    baseUrl: string;
    model: string;
    scenarioModels: Record<string, string>;
    includeCommitHistory: boolean;
    historyLimit: number;
    storedFingerprint: string;
    draftFingerprint: string;
  }

  interface TeamConfigBaseline {
    enabled: boolean;
    requiredIssueId: boolean;
    issueIdPattern: string;
    requiredModule: boolean;
    allowedModulesText: string;
    requiredPrefix: boolean;
    allowedPrefixesText: string;
    fingerprint: string;
  }

  let aiBaseline = $state<AiConfigBaseline | null>(null);
  let aiInitialized = $state(false);
  let pendingAiSave = $state(false);
  let lastTestedFingerprint = $state<string | null>(null);
  let expectedAiFeedback = $state<"save" | "test" | "list" | null>(null);
  let shownAiFeedbackKind = $state<"save" | "test" | "list" | null>(null);
  let prevAiFeedbackMessage = $state<string | undefined>(undefined);
  let teamBaseline = $state<TeamConfigBaseline | null>(null);
  let teamInitialized = $state(false);

  function sortedRecord(value: Record<string, string>): Record<string, string> {
    return Object.fromEntries(
      Object.entries(value ?? {}).sort(([a], [b]) =>
        a < b ? -1 : a > b ? 1 : 0,
      ),
    );
  }

  function aiDraftFingerprintOf(ai: SettingsSnapshot["ai"]): string {
    return JSON.stringify([
      ai.providerPreset,
      ai.baseUrl,
      ai.model,
      sortedRecord(ai.scenarioModels),
      ai.includeCommitHistory,
      ai.historyLimit,
    ]);
  }

  function aiStoredFingerprintOf(ai: SettingsSnapshot["ai"]): string {
    return JSON.stringify([
      ai.providerPreset,
      ai.baseUrl,
      ai.model,
      sortedRecord(ai.scenarioModels),
      ai.includeCommitHistory,
      ai.historyLimit,
      ai.hasApiKey,
    ]);
  }

  function teamStoredFingerprintOf(team: SettingsSnapshot["team"]): string {
    return JSON.stringify([
      team.enabled,
      team.requiredIssueId,
      team.issueIdPattern,
      team.requiredModule,
      team.allowedModulesText,
      team.requiredPrefix,
      team.allowedPrefixesText,
    ]);
  }

  function currentAiFingerprint(): string {
    return JSON.stringify([
      providerPreset,
      baseUrl,
      model,
      sortedRecord(scenarioModels),
      includeCommitHistory,
      historyLimit,
    ]);
  }

  function currentTeamFingerprint(): string {
    return JSON.stringify([
      enabled,
      requiredIssueId,
      issueIdPattern,
      requiredModule,
      allowedModulesText,
      requiredPrefix,
      allowedPrefixesText,
    ]);
  }

  function isAiDirtyNow(): boolean {
    return (
      aiInitialized &&
      aiBaseline !== null &&
      (currentAiFingerprint() !== aiBaseline.draftFingerprint ||
        apiKey !== "" ||
        clearApiKey)
    );
  }

  function isTeamDirtyNow(): boolean {
    return (
      teamInitialized &&
      teamBaseline !== null &&
      currentTeamFingerprint() !== teamBaseline.fingerprint
    );
  }

  let aiDirty = $derived(isAiDirtyNow());
  let teamDirty = $derived(isTeamDirtyNow());
  // 异步测试结果绑定发起时的输入指纹：用户继续编辑后旧结果标为过期。
  let testResultStale = $derived(
    (shownAiFeedbackKind === "test" || shownAiFeedbackKind === "list") &&
      lastTestedFingerprint !== null &&
      currentAiFingerprint() !== lastTestedFingerprint,
  );

  function applyAiBaseline(
    ai: SettingsSnapshot["ai"],
    storedFingerprint: string,
  ): void {
    aiBaseline = {
      providerPreset: ai.providerPreset,
      baseUrl: ai.baseUrl,
      model: ai.model,
      scenarioModels: { ...ai.scenarioModels },
      includeCommitHistory: ai.includeCommitHistory,
      historyLimit: ai.historyLimit,
      storedFingerprint,
      draftFingerprint: aiDraftFingerprintOf(ai),
    };
    applyAiDraftFromBaseline();
  }

  function refreshAiBaseline(
    ai: SettingsSnapshot["ai"],
    storedFingerprint: string,
  ): void {
    aiBaseline = {
      providerPreset: ai.providerPreset,
      baseUrl: ai.baseUrl,
      model: ai.model,
      scenarioModels: { ...ai.scenarioModels },
      includeCommitHistory: ai.includeCommitHistory,
      historyLimit: ai.historyLimit,
      storedFingerprint,
      draftFingerprint: aiDraftFingerprintOf(ai),
    };
  }

  function applyAiDraftFromBaseline(): void {
    if (!aiBaseline) return;
    providerPreset = aiBaseline.providerPreset;
    baseUrl = aiBaseline.baseUrl;
    model = aiBaseline.model;
    scenarioModels = { ...aiBaseline.scenarioModels };
    apiKey = "";
    clearApiKey = false;
    includeCommitHistory = aiBaseline.includeCommitHistory;
    historyLimit = aiBaseline.historyLimit;
  }

  function applyTeamBaseline(
    team: SettingsSnapshot["team"],
    fingerprint: string,
  ): void {
    teamBaseline = {
      enabled: team.enabled,
      requiredIssueId: team.requiredIssueId,
      issueIdPattern: team.issueIdPattern,
      requiredModule: team.requiredModule,
      allowedModulesText: team.allowedModulesText,
      requiredPrefix: team.requiredPrefix,
      allowedPrefixesText: team.allowedPrefixesText,
      fingerprint,
    };
    applyTeamDraftFromBaseline();
  }

  function applyTeamDraftFromBaseline(): void {
    if (!teamBaseline) return;
    enabled = teamBaseline.enabled;
    requiredIssueId = teamBaseline.requiredIssueId;
    issueIdPattern = teamBaseline.issueIdPattern;
    requiredModule = teamBaseline.requiredModule;
    allowedModulesText = teamBaseline.allowedModulesText;
    requiredPrefix = teamBaseline.requiredPrefix;
    allowedPrefixesText = teamBaseline.allowedPrefixesText;
  }

  // 页签仅跟随 taskId，不触碰任何表单草稿；切换页签不再丢失未保存输入。
  // 注意：effect 内不得读取 tab（否则点击即自触发重置），只订阅 taskId。
  let lastTaskId = $state<string | undefined>(undefined);
  $effect(() => {
    const current = taskId;
    untrack(() => {
      if (current !== lastTaskId) {
        lastTaskId = current;
        tab =
          current === "settings/selection"
            ? "selection"
            : current === "settings/team"
              ? "team"
              : current === "settings/svn"
                ? "svn"
                : "ai";
      }
    });
  });

  // 已保存 AI 配置变化才动基线：初次装载应用；保存成功确认后清空密钥输入；
  // 脏草稿一律保留，外部变化不覆盖用户输入；纯反馈/模型列表快照不动草稿。
  $effect(() => {
    const ai = snapshot.ai;
    const storedFingerprint = aiStoredFingerprintOf(ai);
    const feedbackMessage = ai.feedback?.message;
    untrack(() => {
      if (!aiInitialized) {
        applyAiBaseline(ai, storedFingerprint);
        aiInitialized = true;
        prevAiFeedbackMessage = feedbackMessage;
        shownAiFeedbackKind =
          feedbackMessage === undefined ? null : expectedAiFeedback;
        expectedAiFeedback = null;
        return;
      }
      if (
        aiBaseline !== null &&
        storedFingerprint !== aiBaseline.storedFingerprint
      ) {
        const wasSaving = pendingAiSave;
        pendingAiSave = false;
        refreshAiBaseline(ai, storedFingerprint);
        if (wasSaving) {
          // 保存成功确认：密钥仍仅存于 SecretStorage，快照不回显，清空输入框。
          apiKey = "";
          clearApiKey = false;
        } else if (!isAiDirtyNow()) {
          applyAiDraftFromBaseline();
        }
      }
      if (feedbackMessage !== prevAiFeedbackMessage) {
        if (expectedAiFeedback === "save") {
          // 保存动作已有回执（成功或失败），不再等待存储变化。
          pendingAiSave = false;
        }
        prevAiFeedbackMessage = feedbackMessage;
        shownAiFeedbackKind = expectedAiFeedback;
        expectedAiFeedback = null;
      }
    });
  });

  // 团队规则同理：仅已保存配置变化且草稿干净时同步，推荐/迁移预览不碰草稿。
  $effect(() => {
    const team = snapshot.team;
    const fingerprint = teamStoredFingerprintOf(team);
    untrack(() => {
      if (!teamInitialized) {
        applyTeamBaseline(team, fingerprint);
        teamInitialized = true;
        return;
      }
      if (teamBaseline !== null && fingerprint !== teamBaseline.fingerprint) {
        teamBaseline = {
          enabled: team.enabled,
          requiredIssueId: team.requiredIssueId,
          issueIdPattern: team.issueIdPattern,
          requiredModule: team.requiredModule,
          allowedModulesText: team.allowedModulesText,
          requiredPrefix: team.requiredPrefix,
          allowedPrefixesText: team.allowedPrefixesText,
          fingerprint,
        };
        if (!isTeamDirtyNow()) {
          applyTeamDraftFromBaseline();
        }
      }
    });
  });

  function saveAi(): void {
    pendingAiSave = true;
    expectedAiFeedback = "save";
    onAction("settings/save-ai", aiPayload());
  }

  function testAi(): void {
    lastTestedFingerprint = currentAiFingerprint();
    expectedAiFeedback = "test";
    onAction("settings/test-ai", aiPayload());
  }

  function listModels(): void {
    lastTestedFingerprint = currentAiFingerprint();
    expectedAiFeedback = "list";
    onAction("settings/list-models", aiPayload());
  }

  function discardAi(): void {
    applyAiDraftFromBaseline();
    lastTestedFingerprint = null;
    shownAiFeedbackKind = null;
  }

  function saveTeam(): void {
    onAction("settings/save-team", teamPayload());
  }

  function discardTeam(): void {
    applyTeamDraftFromBaseline();
  }

  function applyPreset(): void {
    const preset = snapshot.ai.presets.find(
      (item) => item.id === providerPreset,
    );
    if (!preset || preset.id === "custom") return;
    baseUrl = preset.baseUrl;
    model = preset.model;
  }

  function aiPayload(): Record<string, unknown> {
    return {
      providerPreset,
      baseUrl,
      model,
      apiKey,
      clearApiKey,
      scenarioModels: { ...scenarioModels },
      includeCommitHistory,
      historyLimit,
    };
  }

  function teamPayload(): Record<string, unknown> {
    return {
      enabled,
      requiredIssueId,
      issueIdPattern,
      requiredModule,
      allowedModulesText,
      requiredPrefix,
      allowedPrefixesText,
    };
  }

  function selectTab(next: "ai" | "selection" | "team" | "svn"): void {
    tab = next;
    onAction("open-module", {
      moduleId: "settings",
      taskId: `settings/${next}`,
    });
  }
</script>

<section class="settings-page" use:focusOnMount tabindex="-1">
  <header class="page-heading">
    <div>
      <span class="eyebrow">工作台设置</span>
      <h1>设置与团队规范</h1>
      <p>
        模型密钥仅保存在 VS Code
        安全存储中，不会发送到页面快照。本页只列出有真实模型调用链的场景；未配置模型时，本地检查与人工
        SVN 流程不受影响。
      </p>
    </div>
  </header>

  <div class="settings-tabs" role="tablist" aria-label="设置分类">
    <button
      role="tab"
      aria-selected={tab === "ai"}
      class:active={tab === "ai"}
      onclick={() => selectTab("ai")}
      >AI 模型{#if aiDirty}（未保存）{/if}</button
    >
    <button
      role="tab"
      aria-selected={tab === "selection"}
      class:active={tab === "selection"}
      onclick={() => selectTab("selection")}>提交选择规则</button
    >
    <button
      role="tab"
      aria-selected={tab === "team"}
      class:active={tab === "team"}
      onclick={() => selectTab("team")}
      >团队提交规范{#if teamDirty}（未保存）{/if}</button
    >
    <button
      role="tab"
      aria-selected={tab === "svn"}
      class:active={tab === "svn"}
      onclick={() => selectTab("svn")}>SVN 安全</button
    >
  </div>

  {#if tab === "selection"}
    <SelectionTask {snapshot} {onAction} />
  {:else if tab === "ai"}
    <div class="settings-grid">
      <section class="settings-card settings-card--primary">
        <div class="section-heading">
          <div>
            <span class="eyebrow">模型服务商</span>
            <h2>模型连接</h2>
          </div>
          <span
            class:status-badge--modified={snapshot.ai.hasApiKey}
            class="status-badge"
            >{snapshot.ai.hasApiKey ? "密钥已配置" : "尚未配置密钥"}</span
          >
        </div>
        <p class="muted">
          本页配置外部模型连接与逐场景模型。未配置或调用失败时，本地检查与人工
          SVN 流程仍然可用。下方“按场景选择模型”只列出有真实调用链的场景。
        </p>
        <label class="field"
          ><span>服务商预设</span><select
            bind:value={providerPreset}
            onchange={applyPreset}
            >{#each snapshot.ai.presets as preset (preset.id)}<option
                value={preset.id}>{preset.label}</option
              >{/each}</select
          ></label
        >
        <div class="form-row">
          <label class="field"
            ><span>接口地址（Base URL）</span><input
              bind:value={baseUrl}
              type="url"
              placeholder="https://example.com/v1"
            /></label
          >
          <label class="field"
            ><span>默认模型</span><input
              bind:value={model}
              list="available-models"
              placeholder="model-name"
            /></label
          >
        </div>
        <datalist id="available-models"
          >{#each snapshot.ai.models as item (item.id)}<option value={item.id}
              >{item.owner ?? ""}</option
            >{/each}</datalist
        >
        <label class="field"
          ><span>API 密钥</span><input
            bind:value={apiKey}
            type="password"
            autocomplete="new-password"
            placeholder={snapshot.ai.hasApiKey
              ? "留空表示保留现有密钥"
              : "输入后保存到 VS Code 安全存储"}
          /></label
        >
        <label class="switch-row"
          ><input type="checkbox" bind:checked={clearApiKey} /><span
            >清除已保存的 API 密钥</span
          ></label
        >
        <div class="rule-block">
          <label class="switch-row switch-row--strong"
            ><input type="checkbox" bind:checked={includeCommitHistory} /><span
              ><strong>允许提交说明使用本地历史摘要</strong><small
                >只发送已脱敏的成功提交首行；默认关闭。</small
              ></span
            ></label
          ><label class="field"
            ><span>最多发送最近条数（1–20）</span><input
              type="number"
              min="1"
              max="20"
              bind:value={historyLimit}
              disabled={!includeCommitHistory}
            /></label
          >
        </div>
        {#if snapshot.ai.feedback}<div
            class={`notice notice--${snapshot.ai.feedback.tone}`}
            role="status"
          >
            {snapshot.ai.feedback.message}
          </div>{/if}
        {#if snapshot.ai.feedback && testResultStale}<div
            class="notice notice--warning"
            role="status"
          >
            连接配置已更改，上次测试或模型列表结果已过期，请重新操作后再保存。
          </div>{/if}
        {#if aiDirty}<div class="notice notice--warning" role="status">
            有未保存的修改，切换页签不会丢失草稿；保存后生效，放弃修改回到已保存值。
          </div>{/if}
        <div class="toolbar-actions">
          <button class="button button--primary" onclick={saveAi}
            >保存配置</button
          >
          <button class="button button--secondary" onclick={testAi}
            >测试连接</button
          >
          <button class="button button--secondary" onclick={listModels}
            >读取模型列表</button
          >
          {#if aiDirty}<button
              class="button button--secondary"
              onclick={discardAi}>放弃修改</button
            >{/if}
        </div>
      </section>

      <section class="settings-card">
        <div class="section-heading">
          <div>
            <span class="eyebrow">场景模型</span>
            <h2>按场景选择模型</h2>
          </div>
        </div>
        <p class="muted">
          留空时继承默认模型；每个场景只有在对应任务真实调用外部模型时才会生效。
        </p>
        <ScrollArea class="scenario-list" label="模型场景列表">
          {#each snapshot.ai.scenarios as scenario (scenario.id)}
            <label class="scenario-row">
              <span
                ><strong>{scenario.label}</strong><small
                  >{scenario.description}</small
                ></span
              >
              <input
                bind:value={scenarioModels[scenario.id]}
                list="available-models"
                placeholder="继承默认模型"
              />
            </label>
          {/each}
        </ScrollArea>
      </section>
    </div>
  {:else if tab === "team"}
    <div class="settings-grid">
      <section class="settings-card settings-card--primary">
        <div class="section-heading">
          <div>
            <span class="eyebrow">提交规范</span>
            <h2>仓库团队规则</h2>
          </div>
          <button
            class="button button--secondary"
            onclick={() => onAction("settings/open-team-file")}
            >打开原始配置</button
          >
        </div>
        <p class="path-hint" title={snapshot.team.configPath}>
          {snapshot.team.configPath}
        </p>
        {#if snapshot.team.configSource}
          <p class="config-source-note" role="note">
            来源：{snapshot.team.configSource === "project"
              ? "当前项目"
              : snapshot.team.configSource === "workingCopy"
                ? snapshot.team.inheritedFromWorkingCopy
                  ? "继承自工作副本根"
                  : "工作副本根"
                : "VS Code 设置"}
          </p>
        {/if}
        {#if snapshot.team.feedback}
          <div
            class={`notice notice--${snapshot.team.feedback.tone}`}
            role="status"
          >
            {snapshot.team.feedback.message}
          </div>
        {/if}
        {#if snapshot.team.migrationAvailable && !snapshot.team.migrationPreview}
          <div class="notice notice--info migration-note">
            <span>
              当前项目正在继承工作副本根的团队规则。可以把规则迁移到项目根，
              迁移后本项目使用独立配置。
            </span>
            <button
              class="button button--secondary"
              onclick={() => onAction("settings/preview-team-migration")}
              >预览迁移到项目根</button
            >
          </div>
        {/if}
        {#if snapshot.team.migrationPreview}
          {@const migration = snapshot.team.migrationPreview}
          <div class="migration-preview" role="group" aria-label="迁移预览">
            <strong>迁移预览</strong>
            <p>
              把 {migration.keys.join("、")} 从
              <code>{migration.sourcePath}</code> 迁移到
              <code>{migration.targetPath}</code>。
            </p>
            <details class="command-preview">
              <summary>查看迁移后的项目根配置</summary>
              <pre>{migration.targetContent}</pre>
            </details>
            <details class="command-preview">
              <summary>查看迁移后的工作副本根配置</summary>
              <pre>{migration.sourceContentAfter}</pre>
            </details>
            <p class="migration-preview__impact">
              影响：其他仍继承工作副本根配置的项目将不再继承这些规则；不迁移任何凭据或私密材料。
            </p>
            {#if migration.issues.length > 0}
              <div class="issue-list" role="alert">
                {#each migration.issues as issue, issueIndex (issueIndex)}
                  <div>
                    <span class="codicon codicon-error" aria-hidden="true"
                    ></span>
                    {issue}
                  </div>
                {/each}
              </div>
            {:else}
              <button
                class="button button--primary"
                onclick={() =>
                  onAction("settings/execute-team-migration", {
                    token: migration.token,
                  })}
                >确认迁移 {migration.keys.length} 项团队规则到项目根</button
              >
            {/if}
          </div>
        {/if}
        <label class="switch-row switch-row--strong"
          ><input type="checkbox" bind:checked={enabled} /><span
            ><strong>启用提交规范</strong><small
              >提交预检会阻止不符合要求的说明。</small
            ></span
          ></label
        >
        <div class="rule-block" class:disabled={!enabled}>
          <label class="switch-row"
            ><input
              type="checkbox"
              bind:checked={requiredPrefix}
              disabled={!enabled}
            /><span>要求约定式前缀（如 feat/fix）</span></label
          >
          <label class="field"
            ><span>允许的前缀（逗号分隔）</span><input
              bind:value={allowedPrefixesText}
              disabled={!enabled || !requiredPrefix}
            /></label
          >
        </div>
        <div class="rule-block" class:disabled={!enabled}>
          <label class="switch-row"
            ><input
              type="checkbox"
              bind:checked={requiredModule}
              disabled={!enabled}
            /><span>要求模块名</span></label
          >
          <label class="field"
            ><span>允许的模块（逗号分隔）</span><input
              bind:value={allowedModulesText}
              disabled={!enabled || !requiredModule}
            /></label
          >
        </div>
        <div class="rule-block" class:disabled={!enabled}>
          <label class="switch-row"
            ><input
              type="checkbox"
              bind:checked={requiredIssueId}
              disabled={!enabled}
            /><span>要求工单号</span></label
          >
          <label class="field"
            ><span>工单号正则</span><input
              bind:value={issueIdPattern}
              disabled={!enabled || !requiredIssueId}
            /></label
          >
        </div>
        {#each snapshot.team.warnings as warning, warningIndex (warningIndex)}<div
            class="notice notice--warning"
          >
            {warning}
          </div>{/each}
        {#if teamDirty}<div class="notice notice--warning" role="status">
            有未保存的修改，切换页签不会丢失草稿；保存后生效，放弃修改回到已保存值。
          </div>{/if}
        <div class="toolbar-actions">
          <button class="button button--primary" onclick={saveTeam}
            >保存团队规则</button
          >
          <button
            class="button button--secondary"
            title="只发送仓库名、目录与样例文件路径，不发送文件正文或历史"
            onclick={() => onAction("settings/recommend-team", teamPayload())}
            ><span class="codicon codicon-sparkle" aria-hidden="true"></span>AI
            推荐</button
          >
          {#if teamDirty}<button
              class="button button--secondary"
              onclick={discardTeam}>放弃修改</button
            >{/if}
        </div>
      </section>

      <section class="settings-card">
        <div class="section-heading">
          <div>
            <span class="eyebrow">规则建议</span>
            <h2>推荐依据</h2>
          </div>
          {#if snapshot.team.recommendation}<span
              class={`confidence confidence--${snapshot.team.recommendation.confidence}`}
              >{confidenceLabels[snapshot.team.recommendation.confidence]}</span
            >{/if}
        </div>
        {#if snapshot.team.recommendation}
          <strong>{snapshot.team.recommendation.summary}</strong>
          <p class="muted">
            来源：{sourceLabels[snapshot.team.recommendation.source]}
          </p>
          {#if snapshot.team.recommendation.fallbackReason}<div
              class="notice notice--warning"
            >
              模型不可用，已降级为本地规则：{snapshot.team.recommendation
                .fallbackReason}
            </div>{/if}
          <ul>
            {#each snapshot.team.recommendation.reasons as reason, reasonIndex (reasonIndex)}<li
              >
                {reason}
              </li>{/each}
          </ul>
          {#each snapshot.team.recommendation.warnings as warning, warningIndex (warningIndex)}<div
              class="notice notice--warning"
            >
              {warning}
            </div>{/each}
        {:else}
          <div class="preview-empty">
            <span class="codicon codicon-lightbulb" aria-hidden="true"></span>
            <p>根据仓库目录和文件样本生成可编辑建议，不会自动保存。</p>
          </div>
        {/if}
      </section>

      <section class="settings-card settings-card--wide">
        <div class="section-heading">
          <div>
            <span class="eyebrow">本地历史摘要</span>
            <h2>本地团队记忆</h2>
          </div>
          <span class="status-badge"
            >{snapshot.team.memory.count}/{snapshot.team.memory
              .maxEntries}</span
          >
        </div>
        <p class="muted">
          来源：{snapshot.team.memory
            .source}。只缓存脱敏后的首行摘要与修订号；{snapshot.ai
            .includeCommitHistory
            ? `提交说明生成已获准使用最近 ${snapshot.ai.historyLimit} 条。`
            : "当前不会把这些历史发送给外部 AI。"}
        </p>
        {#if snapshot.team.memory.recent.length}
          <ScrollArea class="memory-list" role="list" label="最近团队记忆">
            {#each snapshot.team.memory.recent as entry (entry.revision)}
              <div role="listitem">
                <strong
                  >{entry.revision ? `r${entry.revision}` : "本地提交"}</strong
                ><span>{entry.summary}</span><small
                  >{formatZhDateTime(entry.recordedAt)}</small
                >
              </div>
            {/each}
          </ScrollArea>
        {:else}
          <div class="preview-empty">
            <span class="codicon codicon-history" aria-hidden="true"></span>
            <p>完成一次真实 SVN 提交后，才会写入本地团队记忆。</p>
          </div>
        {/if}
        <div class="toolbar-actions">
          <button
            class="button button--secondary"
            disabled={snapshot.team.memory.count === 0}
            onclick={() => onAction("settings/clear-team-memory")}
            >清除团队记忆</button
          >
        </div>
      </section>
    </div>
  {:else}
    <div class="settings-grid">
      <section class="settings-card settings-card--primary">
        <div class="section-heading">
          <div>
            <span class="eyebrow">安全认证</span>
            <h2>SVN 用户认证</h2>
          </div>
          <span
            class:status-badge--modified={snapshot.svnSecurity
              .authenticationActive}
            class="status-badge"
            >{snapshot.svnSecurity.authenticationActive
              ? "当前会话已配置"
              : "尚未配置"}</span
          >
        </div>
        <p class="muted">
          用户名和密码通过 VS Code 原生安全输入采集。密码只写入 SVN
          标准输入，不会进入命令行参数、settings、Webview 快照或输出日志。
        </p>
        <div class="security-facts">
          <div>
            <span class="codicon codicon-terminal" aria-hidden="true"
            ></span><span
              ><strong>传输方式</strong><small>svn --password-from-stdin</small
              ></span
            >
          </div>
          <div>
            <span class="codicon codicon-key" aria-hidden="true"></span><span
              ><strong>保存位置</strong><small
                >{snapshot.svnSecurity.hasStoredAuthentication
                  ? "VS Code 安全存储 / 系统凭据存储"
                  : "仅当前工作台内存"}</small
              ></span
            >
          </div>
        </div>
        <div class="toolbar-actions">
          <button
            class="button button--primary"
            onclick={() => onAction("security/configure-authentication")}
            >配置 SVN 认证</button
          >
          <button
            class="button button--secondary"
            disabled={!snapshot.svnSecurity.authenticationActive &&
              !snapshot.svnSecurity.hasStoredAuthentication}
            onclick={() => onAction("security/clear-authentication")}
            >清除认证凭据</button
          >
        </div>
      </section>

      <section class="settings-card">
        <div class="section-heading">
          <div>
            <span class="eyebrow">证书信任</span>
            <h2>HTTPS 证书信任</h2>
          </div>
          <span class="codicon codicon-shield" aria-hidden="true"></span>
        </div>
        <p class="muted">
          工作台不会提供“忽略所有证书错误”。发生校验失败时，必须先核对主机、SHA-256
          指纹、颁发者、有效期和准确的失败类型。
        </p>
        <ol class="security-steps">
          <li>通过仓库管理员或其他可信渠道核对 SHA-256 指纹。</li>
          <li>选择“仅本次信任”，或明确选择“永久信任（由 SVN 缓存）”。</li>
          <li>证书发生变化时重新核对；不得沿用旧预览或旧信任决定。</li>
        </ol>
        <div class="notice">
          <span class="codicon codicon-info" aria-hidden="true"></span><span
            >证书信任入口只会在 SVN 返回可解析的主机与指纹后出现。</span
          >
        </div>
      </section>
    </div>
  {/if}
</section>
