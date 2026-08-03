import { SvnExecutable } from "../svn/svnTypes";

export type EnvironmentDiagnosticStatus = "pass" | "warn" | "fail";

export interface EnvironmentDiagnosticWorkspace {
  name: string;
  path: string;
  isSvnWorkingCopy: boolean;
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

export interface EnvironmentDiagnosticCheck {
  id: string;
  label: string;
  status: EnvironmentDiagnosticStatus;
  detail: string;
  action?: string;
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
    },
    {
      id: "vscode",
      label: "VS Code 版本",
      status: input.vscodeVersion ? "pass" : "fail",
      detail: input.vscodeVersion || "未知",
      action: input.vscodeVersion
        ? undefined
        : "需要在 VS Code Extension Host 中运行。",
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
      detail: `${svnWorkspaces.length}/${workspaces.length} 个工作区包含 .svn`,
      action: undefined,
    };
  }

  return {
    id: "workspace",
    label: "工作区",
    status: "warn",
    detail: `${workspaces.length} 个工作区均未检测到 .svn`,
    action:
      "确认打开的是 SVN 工作副本根目录，或在资源管理器中选择 SVN 工作副本内的文件夹。",
  };
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
