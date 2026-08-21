import { SvnExecutable } from "../svn/svnTypes";
import {
  workingCopyBindingLabels,
  type WorkingCopyBinding,
} from "../scope/workingCopyClassification";

export type EnvironmentDiagnosticStatus = "pass" | "warn" | "fail";

export interface EnvironmentDiagnosticWorkspace {
  name: string;
  path: string;
  /** 是否属于某个 SVN 工作副本（含上层工作副本、嵌套与 external）。 */
  isSvnWorkingCopy: boolean;
  /** v0.0.7：工作副本归属分类；旧调用方未提供时缺省。 */
  binding?: WorkingCopyBinding;
}

export interface EnvironmentDiagnosticAiConfig {
  providerPreset: string;
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
}

export interface EnvironmentDiagnosticInput {
  platform: NodeJS.Platform;
  arch: string;
  vscodeVersion: string;
  configuredSvnPath?: string | null;
  svnExecutable?: SvnExecutable;
  workspaces: EnvironmentDiagnosticWorkspace[];
  ai?: EnvironmentDiagnosticAiConfig;
}

export type DiagnosticActionId =
  | "selectSvnExecutable"
  | "openSettings"
  | "rerunDiagnostics"
  | "openFolder"
  | "copyDiagnostics"
  | "openUrl";

export interface DiagnosticAction {
  id: DiagnosticActionId;
  /** 按钮展示文案（中文）。 */
  label: string;
  /** 动作参数：openSettings 的 query、openFolder 的 path、openUrl 的 url 等。 */
  params?: Record<string, unknown>;
}

export interface EnvironmentDiagnosticCheck {
  id: string;
  label: string;
  status: EnvironmentDiagnosticStatus;
  detail: string;
  /** 人可读建议文案（保留兼容）。 */
  action?: string;
  /** 可执行动作（批次 A 协议化）。 */
  actions?: DiagnosticAction[];
}

export interface EnvironmentDiagnosticReport {
  status: EnvironmentDiagnosticStatus;
  checks: EnvironmentDiagnosticCheck[];
}

export function buildEnvironmentDiagnosticReport(
  input: EnvironmentDiagnosticInput,
): EnvironmentDiagnosticReport {
  const checks: EnvironmentDiagnosticCheck[] = [
    buildPlatformCheck(input.platform),
    {
      id: "architecture",
      label: "CPU 架构",
      status: input.arch === "x64" || input.arch === "arm64" ? "pass" : "warn",
      detail: input.arch,
      action:
        input.arch === "x64" || input.arch === "arm64"
          ? undefined
          : "建议在 x64 或 arm64 环境完成正式验收。",
      actions:
        input.arch === "x64" || input.arch === "arm64"
          ? undefined
          : [
              { id: "rerunDiagnostics", label: "重新检测" },
              { id: "copyDiagnostics", label: "复制诊断信息" },
            ],
    },
    {
      id: "vscode",
      label: "VS Code 版本",
      status: input.vscodeVersion ? "pass" : "fail",
      detail: input.vscodeVersion || "未知",
      action: input.vscodeVersion
        ? undefined
        : "需要在 VS Code Extension Host 中运行。",
      actions: input.vscodeVersion
        ? undefined
        : [
            { id: "rerunDiagnostics", label: "重新检测" },
            { id: "copyDiagnostics", label: "复制诊断信息" },
          ],
    },
    buildSvnCliCheck(input.svnExecutable, input.configuredSvnPath),
    buildWorkspaceCheck(input.workspaces),
    buildAiCheck(input.ai),
  ];

  return {
    status: summarizeEnvironmentStatus(checks),
    checks,
  };
}

export function formatEnvironmentDiagnosticReport(
  report: EnvironmentDiagnosticReport,
): string {
  const statusLabel = getEnvironmentStatusLabel(report.status);
  const lines = [
    `SVN 工作台环境诊断：${statusLabel}`,
    ...report.checks.map((check) => {
      const action = check.action ? `\n  建议: ${check.action}` : "";
      return `[${getEnvironmentStatusLabel(check.status)}] ${check.label}: ${check.detail}${action}`;
    }),
  ];

  return lines.join("\n");
}

export function summarizeEnvironmentStatus(
  checks: EnvironmentDiagnosticCheck[],
): EnvironmentDiagnosticStatus {
  if (checks.some((check) => check.status === "fail")) {
    return "fail";
  }
  if (checks.some((check) => check.status === "warn")) {
    return "warn";
  }
  return "pass";
}

function buildPlatformCheck(
  platform: NodeJS.Platform,
): EnvironmentDiagnosticCheck {
  if (platform === "win32") {
    return {
      id: "platform",
      label: "操作系统",
      status: "pass",
      detail: "Windows",
      action: undefined,
    };
  }

  if (platform === "darwin") {
    return {
      id: "platform",
      label: "操作系统",
      status: "pass",
      detail: "macOS",
      action: undefined,
    };
  }

  return {
    id: "platform",
    label: "操作系统",
    status: "warn",
    detail: platform,
    action: "当前产品验收标准优先覆盖 Windows 和 macOS。",
    actions: [
      { id: "rerunDiagnostics", label: "重新检测" },
      { id: "copyDiagnostics", label: "复制诊断信息" },
    ],
  };
}

function buildSvnCliCheck(
  svnExecutable: SvnExecutable | undefined,
  configuredSvnPath: string | null | undefined,
): EnvironmentDiagnosticCheck {
  if (svnExecutable) {
    return {
      id: "svn-cli",
      label: "SVN CLI",
      status: "pass",
      detail: `${svnExecutable.path} (${svnExecutable.version})`,
      action: undefined,
    };
  }

  return {
    id: "svn-cli",
    label: "SVN CLI",
    status: "fail",
    detail: configuredSvnPath
      ? `未找到配置路径：${configuredSvnPath}`
      : "未找到 svn 可执行文件",
    action: "安装 SVN CLI，或配置 svnWorkbench.svn.path 指向 svn 可执行文件。",
    actions: [
      { id: "selectSvnExecutable", label: "选择 SVN 可执行文件" },
      {
        id: "openSettings",
        label: "打开设置",
        params: { query: "svnWorkbench.svn.path" },
      },
      { id: "copyDiagnostics", label: "复制诊断信息" },
      { id: "rerunDiagnostics", label: "重新检测" },
      {
        id: "openUrl",
        label: "查看安装帮助",
        params: { url: "https://subversion.apache.org/packages.html" },
      },
    ],
  };
}

function buildWorkspaceCheck(
  workspaces: EnvironmentDiagnosticWorkspace[],
): EnvironmentDiagnosticCheck {
  if (workspaces.length === 0) {
    return {
      id: "workspace",
      label: "工作区",
      status: "warn",
      detail: "未打开工作区",
      action: "打开 SVN 工作副本目录后再执行提交、更新和冲突处理。",
      actions: [
        { id: "openFolder", label: "打开文件夹" },
        { id: "copyDiagnostics", label: "复制诊断信息" },
        { id: "rerunDiagnostics", label: "重新检测" },
      ],
    };
  }

  const svnWorkspaces = workspaces.filter(
    (workspace) => workspace.isSvnWorkingCopy,
  );
  if (svnWorkspaces.length > 0) {
    return {
      id: "workspace",
      label: "工作区",
      status: "pass",
      detail: `${svnWorkspaces.length}/${workspaces.length} 个工作区位于 SVN 工作副本${describeWorkspaceBindings(workspaces)}`,
      action: undefined,
    };
  }

  return {
    id: "workspace",
    label: "工作区",
    status: "warn",
    detail: `${workspaces.length} 个工作区均未检测到 SVN 工作副本${describeWorkspaceBindings(workspaces)}`,
    action:
      "确认打开的是 SVN 工作副本内的目录；位于上层工作副本的项目会被自动识别，非 SVN 目录请先检出（Checkout）。",
    actions: [
      { id: "openFolder", label: "打开文件夹" },
      { id: "copyDiagnostics", label: "复制诊断信息" },
      { id: "rerunDiagnostics", label: "重新检测" },
    ],
  };
}

/** 汇总各工作区归属分类；没有分类信息时返回空串。 */
function describeWorkspaceBindings(
  workspaces: EnvironmentDiagnosticWorkspace[],
): string {
  if (workspaces.every((workspace) => !workspace.binding)) {
    return "";
  }
  const parts = workspaces.map(
    (workspace) =>
      `${workspace.name}：${workspace.binding ? workingCopyBindingLabels[workspace.binding] : "未知"}`,
  );
  return `（${parts.join("；")}）`;
}

function buildAiCheck(
  ai: EnvironmentDiagnosticAiConfig | undefined,
): EnvironmentDiagnosticCheck {
  if (!ai) {
    return {
      id: "ai-config",
      label: "AI 配置",
      status: "warn",
      detail: "未读取 AI 配置",
      action: "需要 AI 能力时，执行 SVN：AI 配置模型。",
      actions: [
        {
          id: "openSettings",
          label: "打开 AI 设置",
          params: { query: "svnWorkbench.ai" },
        },
        { id: "copyDiagnostics", label: "复制诊断信息" },
        { id: "rerunDiagnostics", label: "重新检测" },
      ],
    };
  }

  const missing = [
    ai.baseUrl ? undefined : "Base URL",
    ai.model ? undefined : "模型",
    ai.hasApiKey ? undefined : "API Key",
  ].filter(Boolean);

  if (missing.length === 0) {
    return {
      id: "ai-config",
      label: "AI 配置",
      status: "pass",
      detail: `${ai.providerPreset} / ${ai.model}`,
      action: undefined,
    };
  }

  return {
    id: "ai-config",
    label: "AI 配置",
    status: "warn",
    detail: `${ai.providerPreset} 缺少 ${missing.join("、")}`,
    action:
      "需要 AI 筛选、AI 拆分提交或 AI 冲突建议时，执行 SVN：AI 配置模型。",
    actions: [
      {
        id: "openSettings",
        label: "打开 AI 设置",
        params: { query: "svnWorkbench.ai" },
      },
      { id: "copyDiagnostics", label: "复制诊断信息" },
      { id: "rerunDiagnostics", label: "重新检测" },
    ],
  };
}

function getEnvironmentStatusLabel(
  status: EnvironmentDiagnosticStatus,
): string {
  if (status === "pass") {
    return "通过";
  }
  if (status === "warn") {
    return "提醒";
  }
  return "失败";
}
