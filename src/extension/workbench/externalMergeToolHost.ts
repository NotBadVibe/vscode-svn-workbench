/**
 * V018-F · 外部合并工具 Host 助手（Extension Host 侧）
 *
 * - 配置读取走 VS Code 设置 `svnWorkbench.mergeTool.path/args`
 *  （package.json 声明 scope=machine：可执行路径绝不接受工作区覆盖，
 *   选 machine 而非 machine-overridable 是为了 workspace 投毒默认即被拦截）；
 * - 可执行文件解析：用户显式配置优先，否则 PATH 白名单探测已知工具
 *  （Windows 可识别 TortoiseMerge 绝对路径，macOS/Linux 不自造路径）；
 * - 启动一律 `spawn(command, argsArray, { shell: false, stdio: "ignore" })`，
 *   超时上限 EXTERNAL_MERGE_TOOL_TIMEOUT_MS，
 *   SIGTERM→宽限→SIGKILL 二段终止；凭据/token/AI 上下文绝不外传。
 */

import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import {
  buildExternalMergeCandidates,
  EXTERNAL_MERGE_TOOL_TIMEOUT_MS,
} from "../../conflict/externalMergeTool";
import { appendOutput } from "../../diagnostics/outputChannel";

export interface ExternalMergeToolConfig {
  command: string | null;
  argsTemplate: string[];
  /**
   * true 表示工作区/文件夹级残留了 mergeTool 配置。
   * scope=machine 下生效值不受其影响，但必须在意向单/反馈明示核对。
   */
  fromWorkspace: boolean;
}

export interface MergeToolInspectLike {
  workspaceValue?: unknown;
  workspaceFolderValue?: unknown;
  workspaceLanguageValue?: unknown;
  globalValue?: unknown;
}

/** 纯函数：inspect 残留工作区值即视为 workspace 来源（平台无关，可单测）。 */
export function isWorkspaceMergeToolConfig(
  inspectPath?: MergeToolInspectLike | undefined,
  inspectArgs?: MergeToolInspectLike | undefined,
): boolean {
  for (const inspect of [inspectPath, inspectArgs]) {
    if (!inspect) continue;
    if (
      inspect.workspaceValue !== undefined ||
      inspect.workspaceFolderValue !== undefined ||
      inspect.workspaceLanguageValue !== undefined
    ) {
      return true;
    }
  }
  return false;
}

export function readExternalMergeToolConfig(): ExternalMergeToolConfig {
  const config = vscode.workspace.getConfiguration("svnWorkbench");
  const command = config.get<string | null>("mergeTool.path") ?? null;
  const rawArgs = config.get<unknown>("mergeTool.args");
  const argsTemplate = Array.isArray(rawArgs)
    ? rawArgs.filter(
        (item): item is string =>
          typeof item === "string" && item.trim().length > 0,
      )
    : [];
  let fromWorkspace = false;
  try {
    const inspectPath = config.inspect<string | null>("mergeTool.path") as
      MergeToolInspectLike | undefined;
    const inspectArgs = config.inspect<unknown>("mergeTool.args") as
      MergeToolInspectLike | undefined;
    fromWorkspace = isWorkspaceMergeToolConfig(inspectPath, inspectArgs);
  } catch {
    // inspect 不可用时保持 false（fail-open 不误报，生效值仍以 machine 为准）。
  }
  return { command, argsTemplate, fromWorkspace };
}

export interface ExternalMergeResolution {
  found: boolean;
  /** 实际启动命令（绝对路径或 PATH 基名，仅传给 spawn argv[0]）。 */
  command?: string;
  /** 展示用工具名。 */
  label: string;
}

function isPathLike(value: string): boolean {
  return (
    value.includes("/") || value.includes("\\") || /^[a-zA-Z]:/.test(value)
  );
}

export interface ExecutableStatLike {
  isFile(): boolean;
  mode: number;
}

function isExecutableStat(
  stat: ExecutableStatLike | undefined,
  platform: NodeJS.Platform,
): boolean {
  if (!stat || !stat.isFile()) return false;
  if (platform === "win32") return true;
  return (stat.mode & 0o111) !== 0;
}

function findOnPath(
  basename: string,
  pathEnv: string | undefined,
  delimiter: string,
  platform: NodeJS.Platform,
  isExecutable: (candidate: string) => boolean,
): string | undefined {
  if (!pathEnv) return undefined;
  // 按注入平台语义拼接（Windows 宿主上评估 linux 路径不能用宿主 path.join，
  // 否则 /usr/bin 会被转成盘符路径导致测试与跨平台探测失真）。
  const join = platform === "win32" ? path.win32.join : path.posix.join;
  for (const dir of pathEnv.split(delimiter)) {
    const trimmed = dir.trim();
    if (!trimmed) continue;
    const candidate = join(trimmed, basename);
    try {
      if (isExecutable(candidate)) return candidate;
    } catch {
      // 忽略不可访问目录，继续探测下一个。
    }
  }
  return undefined;
}

/**
 * 解析可执行文件（fail-closed：找不到返回 found=false，不猜测执行）。
 * PATH 探测只接受白名单基名；路径形式必须经 stat 复验 isFile，
 * POSIX 另验 X_OK（mode & 0o111），Windows 降级为 isFile。
 */
export function resolveExternalMergeExecutable(
  candidates: readonly string[],
  options: {
    platform?: NodeJS.Platform;
    pathEnv?: string;
    delimiter?: string;
    pathExists?: (candidate: string) => boolean;
    statSync?: (candidate: string) => ExecutableStatLike;
  } = {},
): ExternalMergeResolution {
  const platform = options.platform ?? os.platform();
  const statSync =
    options.statSync ??
    ((candidate: string): ExecutableStatLike => {
      const stat = fs.statSync(candidate);
      return { isFile: () => stat.isFile(), mode: stat.mode };
    });
  const isExecutable = (candidate: string): boolean => {
    if (options.pathExists) {
      try {
        if (!options.pathExists(candidate)) return false;
      } catch {
        return false;
      }
    }
    try {
      return isExecutableStat(statSync(candidate), platform);
    } catch {
      return false;
    }
  };
  const pathEnv = options.pathEnv ?? process.env.PATH;
  const delimiter = options.delimiter ?? path.delimiter;
  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    if (!trimmed) continue;
    if (trimmed.includes("\0") || /[\r\n]/.test(trimmed)) continue;
    if (isPathLike(trimmed)) {
      try {
        if (isExecutable(trimmed)) {
          return {
            found: true,
            command: trimmed,
            label: trimmed.replace(/\\/g, "/").split("/").pop() ?? trimmed,
          };
        }
      } catch {
        continue;
      }
      continue;
    }
    const probeNames =
      platform === "win32" && !trimmed.toLowerCase().endsWith(".exe")
        ? [trimmed, `${trimmed}.exe`]
        : [trimmed];
    for (const name of probeNames) {
      const onPath = findOnPath(
        name,
        pathEnv,
        delimiter,
        platform,
        isExecutable,
      );
      if (onPath) {
        return { found: true, command: onPath, label: trimmed };
      }
    }
    // fail-closed：PATH 中无命中即视为未安装，不猜测执行，
    // 调用方走未配置降级三出口。
  }
  return { found: false, label: "外部合并工具" };
}

/** open 前重验 toolCommand 存在性（TOCTOU）：缺失即拒绝启动。 */
export function isExternalMergeCommandStillValid(
  command: string | null | undefined,
  options: {
    platform?: NodeJS.Platform;
    pathExists?: (candidate: string) => boolean;
    statSync?: (candidate: string) => ExecutableStatLike;
    pathEnv?: string;
    delimiter?: string;
  } = {},
): boolean {
  const trimmed = (command ?? "").trim();
  if (!trimmed || trimmed.includes("\0") || /[\r\n]/.test(trimmed)) {
    return false;
  }
  try {
    return resolveExternalMergeExecutable([trimmed], {
      platform: options.platform ?? os.platform(),
      pathEnv: options.pathEnv,
      delimiter: options.delimiter,
      pathExists: options.pathExists,
      statSync: options.statSync,
    }).found;
  } catch {
    return false;
  }
}

export function buildExternalMergeSearchCandidates(
  configured: string | null | undefined,
  platform: NodeJS.Platform = os.platform(),
): string[] {
  return buildExternalMergeCandidates(configured, platform, fs.existsSync);
}

export interface ExternalMergeRunResult {
  ok: boolean;
  exitCode: number | null;
  timedOut: boolean;
  error?: string;
}

export type SpawnFn = (
  command: string,
  args: readonly string[],
  options: { shell: false; windowsHide: boolean; stdio: "ignore" },
) => ChildProcess;

/**
 * 启动外部合并工具并等待退出（stdio=ignore，不传递任何敏感数据）。
 * 超时执行 SIGTERM→宽限（默认 5s）→SIGKILL 二段终止；
 * error/close 双清 timer；args 必须为数组；shell 恒为 false。
 */
export function runExternalMergeTool(
  command: string,
  args: readonly string[],
  options: {
    timeoutMs?: number;
    killGraceMs?: number;
    spawnFn?: SpawnFn;
  } = {},
): Promise<ExternalMergeRunResult> {
  const timeoutMs = options.timeoutMs ?? EXTERNAL_MERGE_TOOL_TIMEOUT_MS;
  const killGraceMs = options.killGraceMs ?? 5000;
  const spawnFn =
    options.spawnFn ??
    ((cmd, argv, spawnOptions) =>
      spawn(cmd, [...argv], {
        shell: spawnOptions.shell,
        windowsHide: spawnOptions.windowsHide,
        stdio: spawnOptions.stdio,
      }));
  appendOutput(`> 外部合并工具：${command}（${args.length} 个参数）`);
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    const clearTimers = (): void => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      if (graceTimer !== undefined) {
        clearTimeout(graceTimer);
        graceTimer = undefined;
      }
    };
    const finish = (result: ExternalMergeRunResult): void => {
      if (settled) return;
      settled = true;
      clearTimers();
      resolve(result);
    };
    let child: ChildProcess;
    try {
      child = spawnFn(command, [...args], {
        shell: false,
        windowsHide: true,
        stdio: "ignore",
      });
    } catch (error) {
      finish({
        ok: false,
        exitCode: null,
        timedOut: false,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    timer = setTimeout(() => {
      timer = undefined;
      try {
        child.kill("SIGTERM");
      } catch {
        // 忽略终止失败，按超时结果返回。
      }
      // 宽限期内不等待退出：先返回超时结果，SIGKILL 兜底常驻进程。
      finish({
        ok: false,
        exitCode: null,
        timedOut: true,
        error: `外部工具超过 ${Math.round(timeoutMs / 60000)} 分钟未退出，已终止。`,
      });
      // finish 已清 timer，宽限 SIGKILL 仍需保留：重建 graceTimer。
      graceTimer = setTimeout(() => {
        graceTimer = undefined;
        try {
          child.kill("SIGKILL");
        } catch {
          // 忽略二次终止失败。
        }
      }, killGraceMs);
    }, timeoutMs);
    child.on("error", (error) => {
      if (settled) {
        // 超时后宽限期内的 error：进程即将被 SIGKILL，无需再次返回。
        return;
      }
      finish({
        ok: false,
        exitCode: null,
        timedOut: false,
        error:
          error instanceof Error
            ? `无法启动外部合并工具：${error.message}`
            : "无法启动外部合并工具。",
      });
    });
    child.on("close", (exitCode) => {
      if (settled) {
        // 超时后宽限期内已退出：取消兜底 SIGKILL。
        if (graceTimer !== undefined) {
          clearTimeout(graceTimer);
          graceTimer = undefined;
        }
        return;
      }
      appendOutput(`外部合并工具已退出：exit=${exitCode}`);
      finish({ ok: true, exitCode, timedOut: false });
    });
  });
}

/**
 * 未配置三出口之一：用户选择可执行文件，stat.isFile 校验后仅写 mergeTool.path。
 * 目录/设备/不可访问一律拒绝写入（fail-closed）。
 */
export async function handleSelectMergeToolExecutable(
  deps: {
    showOpenDialog?: typeof vscode.window.showOpenDialog;
    stat?: (path: string) => Promise<{ isFile(): boolean }>;
    updateConfiguration?: (value: string) => Promise<void> | Thenable<void>;
    showInformationMessage?: (message: string) => void;
  } = {},
): Promise<string | undefined> {
  const showOpenDialog =
    deps.showOpenDialog ?? vscode.window.showOpenDialog.bind(vscode.window);
  const statFn = deps.stat ?? ((target: string) => fs.promises.stat(target));
  const picked = await showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    openLabel: "选择外部合并工具",
    title: "选择外部合并工具可执行文件",
  });
  if (!picked || picked.length === 0) return undefined;
  const fsPath = picked[0].fsPath;
  if (!fsPath || fsPath.includes("\0") || /[\r\n]/.test(fsPath)) {
    vscode.window.showErrorMessage("所选路径包含非法字符，已拒绝。");
    return undefined;
  }
  let stat: { isFile(): boolean } | undefined;
  try {
    stat = await statFn(fsPath);
  } catch {
    stat = undefined;
  }
  if (!stat || !stat.isFile()) {
    vscode.window.showErrorMessage("所选不是可执行文件，请重新选择。");
    return undefined;
  }
  if (deps.updateConfiguration) {
    await deps.updateConfiguration(fsPath);
  } else {
    await vscode.workspace
      .getConfiguration("svnWorkbench")
      .update("mergeTool.path", fsPath, vscode.ConfigurationTarget.Global);
  }
  (
    deps.showInformationMessage ??
    vscode.window.showInformationMessage.bind(vscode.window)
  )(`已将外部合并工具设置为：${fsPath}`);
  return fsPath;
}
