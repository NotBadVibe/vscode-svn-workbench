/**
 * V018-F · 外部合并工具 Host 助手（Extension Host 侧）
 *
 * - 配置读取走 VS Code 设置 `svnWorkbench.mergeTool.path/args`；
 * - 可执行文件解析：用户显式配置优先，否则 PATH 白名单探测已知工具
 *  （Windows 可识别 TortoiseMerge 绝对路径，macOS/Linux 不自造路径）；
 * - 启动一律 `spawn(command, argsArray, { shell: false })`，超时上限
 *   EXTERNAL_MERGE_TOOL_TIMEOUT_MS；凭据/token/AI 上下文绝不外传。
 */

import { spawn } from "node:child_process";
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
  return { command, argsTemplate };
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

function findOnPath(
  basename: string,
  pathEnv: string | undefined,
  delimiter: string,
  pathExists: (candidate: string) => boolean,
): string | undefined {
  if (!pathEnv) return undefined;
  for (const dir of pathEnv.split(delimiter)) {
    const trimmed = dir.trim();
    if (!trimmed) continue;
    const candidate = path.join(trimmed, basename);
    try {
      if (pathExists(candidate)) return candidate;
    } catch {
      // 忽略不可访问目录，继续探测下一个。
    }
  }
  return undefined;
}

/**
 * 解析可执行文件（fail-closed：找不到返回 found=false，不猜测执行）。
 * PATH 探测只接受白名单基名；绝对/相对路径形式必须经 pathExists 复验存在。
 */
export function resolveExternalMergeExecutable(
  candidates: readonly string[],
  options: {
    platform?: NodeJS.Platform;
    pathEnv?: string;
    delimiter?: string;
    pathExists?: (candidate: string) => boolean;
  } = {},
): ExternalMergeResolution {
  const platform = options.platform ?? os.platform();
  const pathExists = options.pathExists ?? fs.existsSync;
  const pathEnv = options.pathEnv ?? process.env.PATH;
  const delimiter = options.delimiter ?? path.delimiter;
  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    if (!trimmed) continue;
    if (isPathLike(trimmed)) {
      try {
        if (pathExists(trimmed)) {
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
      const onPath = findOnPath(name, pathEnv, delimiter, pathExists);
      if (onPath) {
        return { found: true, command: onPath, label: trimmed };
      }
    }
    // fail-closed：PATH 中无命中即视为未安装，不猜测执行，
    // 调用方走未配置降级三出口。
  }
  return { found: false, label: "外部合并工具" };
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

/**
 * 启动外部合并工具并等待退出（不接管 stdin/stdout，不传递任何敏感数据）。
 * args 必须为数组；shell 恒为 false。
 */
export function runExternalMergeTool(
  command: string,
  args: readonly string[],
  options: { timeoutMs?: number } = {},
): Promise<ExternalMergeRunResult> {
  const timeoutMs = options.timeoutMs ?? EXTERNAL_MERGE_TOOL_TIMEOUT_MS;
  appendOutput(`> 外部合并工具：${command}（${args.length} 个参数）`);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: ExternalMergeRunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    let child;
    try {
      child = spawn(command, [...args], {
        shell: false,
        windowsHide: true,
        timeout: timeoutMs,
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
    const timer = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {
        // 忽略终止失败，按超时结果返回。
      }
      finish({
        ok: false,
        exitCode: null,
        timedOut: true,
        error: `外部工具超过 ${Math.round(timeoutMs / 60000)} 分钟未退出，已终止。`,
      });
    }, timeoutMs);
    child.on("error", (error) => {
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
      appendOutput(`外部合并工具已退出：exit=${exitCode}`);
      finish({ ok: true, exitCode, timedOut: false });
    });
  });
}

/** 未配置三出口之一：用户选择可执行文件，仅写 mergeTool.path。 */
export async function handleSelectMergeToolExecutable(): Promise<
  string | undefined
> {
  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    openLabel: "选择外部合并工具",
    title: "选择外部合并工具可执行文件",
  });
  if (!picked || picked.length === 0) return undefined;
  const fsPath = picked[0].fsPath;
  await vscode.workspace
    .getConfiguration("svnWorkbench")
    .update("mergeTool.path", fsPath, vscode.ConfigurationTarget.Global);
  vscode.window.showInformationMessage(`已将外部合并工具设置为：${fsPath}`);
  return fsPath;
}
