/**
 * 提交选择规则运行时解析服务（v0.0.3 阶段 2）。
 *
 * 按仓库（工作副本根路径）解析有效规则：VS Code 用户/工作区层
 * （svnWorkbench.commitSelection，经 commitSelectionSettings 适配层）+ 仓库层
 * （.svn-workbench.json 的 commitSelection 键，经统一读写层），合并由纯领域
 * resolver 完成。解析结果按仓库缓存；失效来源见
 * registerCommitSelectionRuleWatchers（VS Code 配置变更、.svn-workbench.json
 * 变更、工作区文件夹变化）。
 *
 * 降级语义：单层校验失败由 resolver 回退到更低优先级层；读取或解析出现意外
 * 异常时服务回退内置默认规则并记录错误——服务本身不向调用方抛错。
 * 规划依据：docs/releases/v0.0.3/README.md 第 5.3、7.3、8 节。
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import {
  SVN_WORKBENCH_CONFIG_FILE,
  describeSvnWorkbenchConfigError,
  getSvnWorkbenchConfigPath,
  readSvnWorkbenchConfig,
  readSvnWorkbenchConfigContent,
  removeSvnWorkbenchConfigKey,
  updateSvnWorkbenchConfig,
} from "../config/svnWorkbenchConfig";
import { readCommitSelectionVscodeLayers } from "../config/commitSelectionSettings";
import {
  createDefaultSvnWorkbenchProjectConfig,
  serializeSvnWorkbenchProjectConfig,
} from "./commitConvention";
import {
  ResolvedCommitSelectionRules,
  resolveCommitSelectionRules,
} from "./commitSelectionRuleResolver";
import {
  CommitSelectionLayerConfig,
  extractCommitSelectionLayerConfig,
} from "./commitSelectionRules";
import { mergeCommitSelectionForSave } from "./commitSelectionSettingsSupport";

export interface CommitSelectionRepositoryLayerReadResult {
  layer?: unknown;
  warnings: string[];
}

export interface CommitSelectionRuleServiceDeps {
  /** 读取 VS Code 用户/工作区两层原始配置；缺省走 VS Code 配置 API。 */
  readVscodeLayers?: () => { user?: unknown; workspace?: unknown };
  /** 读取仓库层原始配置；缺省走 .svn-workbench.json 统一读写层。 */
  readRepositoryLayer?: (
    repositoryRoot: string,
  ) => Promise<CommitSelectionRepositoryLayerReadResult>;
}

export type CommitSelectionRulesInvalidationReason =
  "vscode-configuration" | "repository-config" | "workspace-folders" | "manual";

export interface CommitSelectionSaveRulesResult {
  ok: boolean;
  configPath?: string;
  /** 写回时产生的警告；保存被拒绝时为读取/解析产生的警告。 */
  warnings: string[];
  error?: string;
}

export interface CommitSelectionRestoreRulesResult {
  ok: boolean;
  configPath?: string;
  /** 是否实际删除了 commitSelection 键；键或文件本就不存在时为 false（幂等）。 */
  removed?: boolean;
  error?: string;
}

export interface CommitSelectionRulesInvalidationEvent {
  /** 失效的仓库根；undefined 表示所有仓库。 */
  repositoryRoot?: string;
  reason: CommitSelectionRulesInvalidationReason;
}

export interface CommitSelectionRuleInvalidationListener {
  (event: CommitSelectionRulesInvalidationEvent): void;
}

/**
 * 从 `.svn-workbench.json` 读取仓库层 commitSelection 原始配置。
 * 文件不存在、非法 JSON 或读取失败都不抛错：层缺省为空，问题以警告呈现，
 * 由 resolver/调用方按降级语义处理。
 */
export async function readRepositoryCommitSelectionLayer(
  repositoryRoot: string,
): Promise<CommitSelectionRepositoryLayerReadResult> {
  const result = await readSvnWorkbenchConfig(repositoryRoot);
  const warnings = [...result.warnings];
  if (result.readError) {
    warnings.push(
      `读取 ${SVN_WORKBENCH_CONFIG_FILE} 失败：${describeSvnWorkbenchConfigError(result.readError)}`,
    );
  }
  const extracted = extractCommitSelectionLayerConfig(result.raw);
  warnings.push(...extracted.warnings);
  return { layer: extracted.layer, warnings };
}

export class CommitSelectionRuleService implements vscode.Disposable {
  // 缓存进行中的 Promise：同一仓库并发首次解析只执行一次，调用方共享同一结果。
  private readonly cache = new Map<
    string,
    Promise<ResolvedCommitSelectionRules>
  >();
  private readonly listeners =
    new Set<CommitSelectionRuleInvalidationListener>();
  private disposed = false;

  constructor(private readonly deps: CommitSelectionRuleServiceDeps = {}) {}

  /**
   * 解析指定仓库的有效规则（带缓存）。返回值可被多处调用方共享；
   * 调用方不得修改返回对象。
   */
  async getEffectiveRules(
    repositoryRoot: string,
  ): Promise<ResolvedCommitSelectionRules> {
    const key = normalizeRepositoryRootKey(repositoryRoot);
    const cached = this.cache.get(key);
    if (cached) {
      return cached;
    }
    // resolveRules 内部捕获全部异常（降级内置默认），缓存的 Promise 不会拒绝。
    const pending = this.resolveRules(key);
    if (!this.disposed) {
      this.cache.set(key, pending);
    }
    return pending;
  }

  /** 使指定仓库的缓存失效（例如对应 .svn-workbench.json 变更）。 */
  invalidateRepository(
    repositoryRoot: string,
    reason: CommitSelectionRulesInvalidationReason = "manual",
  ): void {
    this.cache.delete(normalizeRepositoryRootKey(repositoryRoot));
    this.emit({ repositoryRoot, reason });
  }

  /** `.svn-workbench.json` 变更入口：按文件所在目录定位受影响仓库。 */
  invalidateRepositoryConfig(configFilePath: string): void {
    this.invalidateRepository(
      path.dirname(configFilePath),
      "repository-config",
    );
  }

  /**
   * 保存仓库级提交选择规则：读取-合并-写回 `.svn-workbench.json` 的
   * commitSelection 键（mergeCommitSelectionForSave 保留其内部未知字段，
   * 统一读写层保留文件其他键）。成功后显式失效本仓库缓存——FileSystemWatcher
   * 覆盖不到工作区外路径，不能依赖文件事件（阶段 2 结论）。
   * 调用前必须先经 validateCommitSelectionSaveInput 完整校验。
   * 文件存在但损坏（非法 JSON、顶层非对象）或读取失败时拒绝保存：原文件保持
   * 字节不变，避免统一读写层按空配置重建而丢失其他团队配置与未识别字段
   * （V003-CR-03）；拒绝时不失效缓存，错误提示用户打开文件修复后重试。
   */
  async saveRepositoryRules(
    repositoryRoot: string,
    config: CommitSelectionLayerConfig,
  ): Promise<CommitSelectionSaveRulesResult> {
    try {
      const existing = await readSvnWorkbenchConfig(repositoryRoot);
      if (existing.readError) {
        return {
          ok: false,
          warnings: [...existing.warnings],
          error: `读取 ${SVN_WORKBENCH_CONFIG_FILE} 失败，未执行保存：${describeSvnWorkbenchConfigError(existing.readError)}。请检查文件状态后重试。`,
        };
      }
      if (existing.exists && existing.raw === undefined) {
        return {
          ok: false,
          warnings: [...existing.warnings],
          error: `${SVN_WORKBENCH_CONFIG_FILE} 配置损坏（${existing.warnings.join("；")}），保存已拒绝，文件内容保持原样。请打开 ${SVN_WORKBENCH_CONFIG_FILE} 修复后重试。`,
        };
      }
      const mergedSection = mergeCommitSelectionForSave(
        existing.raw?.commitSelection,
        config,
      );
      const result = await updateSvnWorkbenchConfig(
        repositoryRoot,
        { commitSelection: mergedSection },
        serializeSvnWorkbenchProjectConfig(
          createDefaultSvnWorkbenchProjectConfig(),
        ),
      );
      this.invalidateRepository(repositoryRoot, "repository-config");
      return {
        ok: true,
        configPath: result.configPath,
        warnings: result.warnings,
      };
    } catch (error) {
      return {
        ok: false,
        warnings: [],
        error: `保存提交选择规则失败：${describeSvnWorkbenchConfigError(error)}`,
      };
    }
  }

  /**
   * 恢复仓库级默认：精确删除 `.svn-workbench.json` 中的 commitSelection 键，
   * 文件其余内容不动。配置损坏时拒绝删除（不重建文件），返回结构化中文错误。
   */
  async restoreRepositoryRulesToDefault(
    repositoryRoot: string,
  ): Promise<CommitSelectionRestoreRulesResult> {
    const configPath = getSvnWorkbenchConfigPath(repositoryRoot);
    try {
      const existing = await readSvnWorkbenchConfig(repositoryRoot);
      if (!existing.exists && !existing.readError) {
        return { ok: true, configPath, removed: false };
      }
      if (existing.readError) {
        return {
          ok: false,
          configPath,
          error: `读取 ${SVN_WORKBENCH_CONFIG_FILE} 失败，未执行恢复默认：${describeSvnWorkbenchConfigError(existing.readError)}`,
        };
      }
      const content = await readSvnWorkbenchConfigContent(repositoryRoot);
      const removal = removeSvnWorkbenchConfigKey(content, "commitSelection");
      if (!removal.ok) {
        return { ok: false, configPath, error: removal.error };
      }
      if (removal.removed) {
        await fs.writeFile(configPath, removal.content, "utf8");
        this.invalidateRepository(repositoryRoot, "repository-config");
      }
      return { ok: true, configPath, removed: removal.removed };
    } catch (error) {
      return {
        ok: false,
        configPath,
        error: `恢复默认提交选择规则失败：${describeSvnWorkbenchConfigError(error)}`,
      };
    }
  }

  /** 使全部仓库缓存失效（例如 VS Code 配置或工作区集合变化）。 */
  invalidateAll(reason: CommitSelectionRulesInvalidationReason): void {
    this.cache.clear();
    this.emit({ reason });
  }

  onDidInvalidate(
    listener: CommitSelectionRuleInvalidationListener,
  ): vscode.Disposable {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      },
    };
  }

  dispose(): void {
    this.disposed = true;
    this.cache.clear();
    this.listeners.clear();
  }

  private async resolveRules(
    repositoryRootKey: string,
  ): Promise<ResolvedCommitSelectionRules> {
    try {
      const vscodeLayers = (
        this.deps.readVscodeLayers ?? readCommitSelectionVscodeLayers
      )();
      const repository = await (
        this.deps.readRepositoryLayer ?? readRepositoryCommitSelectionLayer
      )(repositoryRootKey);
      const resolved = resolveCommitSelectionRules({
        user: vscodeLayers.user,
        workspace: vscodeLayers.workspace,
        repository: repository.layer,
      });
      resolved.warnings.push(...repository.warnings);
      return resolved;
    } catch (error) {
      // 不向调用方抛错：意外失败回退内置默认规则，并保留错误信息。
      const resolved = resolveCommitSelectionRules({});
      resolved.errors.push(
        `解析提交选择规则失败，已使用内置默认规则：${error instanceof Error ? error.message : String(error)}`,
      );
      return resolved;
    }
  }

  private emit(event: CommitSelectionRulesInvalidationEvent): void {
    if (this.disposed) {
      return;
    }
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

/**
 * 注册规则来源监听：VS Code 配置变更（仅 svnWorkbench.commitSelection）、
 * 工作区内 `.svn-workbench.json` 变更、工作区文件夹集合变化。
 * 返回的 Disposable 由调用方（扩展激活入口）统一管理。
 */
export function registerCommitSelectionRuleWatchers(
  service: CommitSelectionRuleService,
): vscode.Disposable[] {
  const configurationListener = vscode.workspace.onDidChangeConfiguration(
    (event) => {
      if (event.affectsConfiguration("svnWorkbench.commitSelection")) {
        service.invalidateAll("vscode-configuration");
      }
    },
  );
  const configFileWatcher = vscode.workspace.createFileSystemWatcher(
    `**/${SVN_WORKBENCH_CONFIG_FILE}`,
  );
  const onConfigFileChange = (uri: vscode.Uri) =>
    service.invalidateRepositoryConfig(uri.fsPath);
  configFileWatcher.onDidChange(onConfigFileChange);
  configFileWatcher.onDidCreate(onConfigFileChange);
  configFileWatcher.onDidDelete(onConfigFileChange);
  const workspaceFoldersListener = vscode.workspace.onDidChangeWorkspaceFolders(
    () => service.invalidateAll("workspace-folders"),
  );
  return [configurationListener, configFileWatcher, workspaceFoldersListener];
}

function normalizeRepositoryRootKey(repositoryRoot: string): string {
  const resolved = path.resolve(repositoryRoot);
  return process.platform === "win32" ? resolved.toLocaleLowerCase() : resolved;
}
