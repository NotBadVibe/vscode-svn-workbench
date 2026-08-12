<script lang="ts">
  import { onMount } from "svelte";
  import { workbenchBridge } from "./bridge/vscodeBridge";
  import { WorkbenchState } from "./app/workbenchState.svelte";
  import FeatureRouter from "./app/FeatureRouter.svelte";
  import AppShell from "./components/ui/AppShell.svelte";
  import { startMockWorkbench } from "./mocks/mockWorkbench";

  const state = new WorkbenchState();

  onMount(() => {
    state.ready();
    if (workbenchBridge.isMock) {
      startMockWorkbench();
    }
    return state.dispose;
  });
</script>

<AppShell {state}>
  {#if state.loading}
    <section class="module-state" aria-busy="true" aria-live="polite">
      <span class="loading-ring" aria-hidden="true"></span>
      <div>
        <strong>正在读取工作副本</strong>
        <p>正在加载当前范围与 SVN 状态…</p>
      </div>
    </section>
  {:else if state.error}
    <section class="module-state module-state--error" role="alert">
      <span class="codicon codicon-error" aria-hidden="true"></span>
      <div>
        <strong>{state.error.title}</strong>
        {#if state.error.categoryLabel}<small class="error-category"
            >{state.error.categoryLabel}</small
          >{/if}
        <p>{state.error.message}</p>
        {#if state.error.network}<div class="network-failure-kind">
            <span class="codicon codicon-radio-tower" aria-hidden="true"
            ></span><strong>网络诊断：</strong>{state.error.network.kind}
          </div>{/if}
        {#if state.error.certificate}
          <dl class="certificate-details">
            <div>
              <dt>服务器</dt>
              <dd>{state.error.certificate.host ?? "未能解析"}</dd>
            </div>
            <div>
              <dt>SHA-256 指纹</dt>
              <dd>
                <code
                  >{state.error.certificate.fingerprint ??
                    "未能解析，禁止信任"}</code
                >
              </dd>
            </div>
            {#if state.error.certificate.issuer}<div>
                <dt>颁发者</dt>
                <dd>{state.error.certificate.issuer}</dd>
              </div>{/if}
            {#if state.error.certificate.validFrom || state.error.certificate.validUntil}<div
              >
                <dt>有效期</dt>
                <dd>
                  {state.error.certificate.validFrom ?? "?"} → {state.error
                    .certificate.validUntil ?? "?"}
                </dd>
              </div>{/if}
            <div>
              <dt>校验失败</dt>
              <dd>{state.error.certificate.failures.join("、")}</dd>
            </div>
          </dl>
        {/if}
        {#if state.error.guidance?.length}<ul class="recovery-guidance">
            {#each state.error.guidance as item, index (index)}<li>
                {item}
              </li>{/each}
          </ul>{/if}
        <div class="toolbar-actions">
          {#if state.error.recoverable}<button
              class="button button--secondary"
              onclick={() => state.action("refresh")}>重新加载</button
            >{/if}
          <button
            class="button button--secondary"
            onclick={() => state.openModule("diagnostics")}>打开诊断</button
          >
          {#if state.error.category === "authentication"}
            <button
              class="button button--primary"
              onclick={() => state.action("security/configure-authentication")}
              >配置认证</button
            >
            <button
              class="button button--secondary"
              onclick={() => state.action("security/clear-authentication")}
              >清除已保存凭据</button
            >
          {/if}
          {#if state.error.category === "certificate"}<button
              class="button button--primary"
              disabled={!state.error.certificate?.canTrust}
              onclick={() => state.action("security/review-certificate")}
              >核对并信任证书</button
            >{/if}
          {#if state.error.category === "network" && state.error.network?.kind === "proxy"}<button
              class="button button--secondary"
              onclick={() => state.action("security/open-proxy-settings")}
              >打开 VS Code 代理设置</button
            >{/if}
          {#if state.error.recovery?.moduleId === "repository"}<button
              class="button button--primary"
              onclick={() => state.openModule("repository")}
              >进入仓库恢复</button
            >{/if}
        </div>
      </div>
    </section>
  {:else if state.snapshot}
    {#if state.loading}
      <!-- 模块刷新（如保存后重新读取）时保持模块挂载，避免编辑会话/输入被卸载打断。 -->
      <div class="module-refresh-strip" role="status" aria-live="polite">
        <span class="loading-ring loading-ring--small" aria-hidden="true"
        ></span>
        <span>正在刷新当前范围…</span>
      </div>
    {/if}
    <FeatureRouter
      snapshot={state.snapshot}
      taskId={state.taskId}
      editSession={state.editSession}
      diffSaveResult={state.diffSaveResult}
      draftAck={state.draftAck}
      targetSwitchRequest={state.targetSwitchRequest}
      onAction={(action, data) => state.action(action, data)}
    />
  {:else}
    <section class="module-state">
      <span class="codicon codicon-inbox" aria-hidden="true"></span>
      <div>
        <strong>暂无模块数据</strong>
        <p>重新加载工作台，或从右键菜单重新进入当前任务。</p>
        <div class="toolbar-actions">
          <button
            class="button button--secondary"
            onclick={() => state.action("refresh")}>重新加载</button
          >
          <button
            class="button button--secondary"
            onclick={() => state.openModule("diagnostics")}>打开诊断</button
          >
          <button
            class="button button--secondary"
            onclick={() => state.openModule("settings")}>打开设置</button
          >
        </div>
      </div>
    </section>
  {/if}
</AppShell>
