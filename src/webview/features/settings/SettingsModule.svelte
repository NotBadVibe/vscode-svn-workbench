<script lang="ts">
  import type {
    SettingsSnapshot,
    WebviewAction,
    WorkbenchTaskId,
  } from "@protocol/workbenchProtocol";
  import ScrollArea from "../../components/ui/ScrollArea.svelte";
  import { formatZhDateTime } from "../../i18n/formatters";
  import { confidenceLabels, sourceLabels } from "../../i18n/terminology";

  let {
    snapshot,
    taskId = "settings/ai",
    onAction,
  }: {
    snapshot: SettingsSnapshot;
    taskId: WorkbenchTaskId;
    onAction: (action: WebviewAction, data?: Record<string, unknown>) => void;
  } = $props();

  let tab = $state<"ai" | "team" | "svn">("ai");
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

  $effect(() => {
    tab =
      taskId === "settings/team"
        ? "team"
        : taskId === "settings/svn"
          ? "svn"
          : "ai";
    providerPreset = snapshot.ai.providerPreset;
    baseUrl = snapshot.ai.baseUrl;
    model = snapshot.ai.model;
    scenarioModels = { ...snapshot.ai.scenarioModels };
    apiKey = "";
    clearApiKey = false;
    includeCommitHistory = snapshot.ai.includeCommitHistory;
    historyLimit = snapshot.ai.historyLimit;
    enabled = snapshot.team.enabled;
    requiredIssueId = snapshot.team.requiredIssueId;
    issueIdPattern = snapshot.team.issueIdPattern;
    requiredModule = snapshot.team.requiredModule;
    allowedModulesText = snapshot.team.allowedModulesText;
    requiredPrefix = snapshot.team.requiredPrefix;
    allowedPrefixesText = snapshot.team.allowedPrefixesText;
  });

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

  function selectTab(next: "ai" | "team" | "svn"): void {
    tab = next;
    onAction("open-module", {
      moduleId: "settings",
      taskId: `settings/${next}`,
    });
  }
</script>

<section class="settings-page">
  <header class="page-heading">
    <div>
      <span class="eyebrow">工作台设置</span>
      <h1>设置与团队规范</h1>
      <p>模型密钥仅保存在 VS Code 安全存储中，不会发送到页面快照。</p>
    </div>
  </header>

  <div class="settings-tabs" role="tablist" aria-label="设置分类">
    <button
      role="tab"
      aria-selected={tab === "ai"}
      class:active={tab === "ai"}
      onclick={() => selectTab("ai")}>AI 模型</button
    >
    <button
      role="tab"
      aria-selected={tab === "team"}
      class:active={tab === "team"}
      onclick={() => selectTab("team")}>团队提交规范</button
    >
    <button
      role="tab"
      aria-selected={tab === "svn"}
      class:active={tab === "svn"}
      onclick={() => selectTab("svn")}>SVN 安全</button
    >
  </div>

  {#if tab === "ai"}
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
        <div class="toolbar-actions">
          <button
            class="button button--primary"
            onclick={() => onAction("settings/save-ai", aiPayload())}
            >保存配置</button
          >
          <button
            class="button button--secondary"
            onclick={() => onAction("settings/test-ai", aiPayload())}
            >测试连接</button
          >
          <button
            class="button button--secondary"
            onclick={() => onAction("settings/list-models", aiPayload())}
            >读取模型列表</button
          >
        </div>
      </section>

      <section class="settings-card">
        <div class="section-heading">
          <div>
            <span class="eyebrow">场景模型</span>
            <h2>按场景选择模型</h2>
          </div>
        </div>
        <p class="muted">留空时继承默认模型；高成本任务可单独选择更强模型。</p>
        <ScrollArea class="scenario-list" label="AI 场景模型列表">
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
        <div class="toolbar-actions">
          <button
            class="button button--primary"
            onclick={() => onAction("settings/save-team", teamPayload())}
            >保存团队规则</button
          >
          <button
            class="button button--secondary"
            title="只发送仓库名、目录与样例文件路径，不发送文件正文或历史"
            onclick={() => onAction("settings/recommend-team", teamPayload())}
            ><span class="codicon codicon-sparkle" aria-hidden="true"></span>AI
            推荐</button
          >
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
