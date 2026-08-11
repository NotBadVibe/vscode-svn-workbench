import * as vscode from "vscode";
import type { CommitSelectionRuleService } from "../../commit/commitSelectionRuleService";
import type { WorkbenchModuleId } from "../../protocol/workbenchProtocol";
import { SvnSecurityContextRegistry } from "../../security/svnSecurityContextRegistry";
import type { OpenWorkbenchRequest } from "./workbenchSession";
import { WorkbenchController } from "./WorkbenchController";
import { WorkbenchWindowRegistry } from "./workbenchWindowRegistry";

/** 模块窗口最小契约：WorkbenchController 实现；测试可注入假窗口。 */
export interface ModuleWindow {
  open(request: OpenWorkbenchRequest): Promise<void>;
  openNativeDiffInEditor?(requestId?: string): Promise<void>;
  handleSecurityInvalidated?(repositoryRoot: string): void;
  readonly isDisposed: boolean;
  dispose(): void;
}

export interface WorkbenchWindowManagerOptions {
  /** 测试接缝：自定义窗口工厂（缺省创建真实 WorkbenchController）。 */
  createWindow?: (
    moduleId: WorkbenchModuleId,
    routing: {
      onOpenInOtherWindow: (request: OpenWorkbenchRequest) => Promise<void>;
    },
  ) => ModuleWindow;
}

/**
 * 0.0.5 统一模块窗口管理器。
 *
 * - 每个 WorkbenchModuleId 惰性创建、单例复用的 WorkbenchController
 *   （一控制器、一面板、一活动会话；面板关闭后按需重建）；
 * - 跨模块打开请求由控制器回传本管理器，路由到目标模块窗口；
 * - 共享 SVN 安全上下文注册表：认证与证书信任按仓库身份管理，
 *   失效时向相关窗口广播明确事件；
 * - 扩展停用时统一释放全部窗口与订阅。
 */
export class WorkbenchWindowManager implements vscode.Disposable {
  private readonly windows: WorkbenchWindowRegistry<ModuleWindow>;
  private readonly securityRegistry: SvnSecurityContextRegistry;
  private readonly invalidationSubscription: vscode.Disposable;
  private disposed = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    commitSelectionRuleService: CommitSelectionRuleService,
    options?: WorkbenchWindowManagerOptions,
  ) {
    this.securityRegistry = new SvnSecurityContextRegistry();
    this.invalidationSubscription = this.securityRegistry.onDidInvalidate(
      (repositoryRoot) => {
        for (const window of this.windows.all()) {
          window.handleSecurityInvalidated?.(repositoryRoot);
        }
      },
    );
    const createWindow =
      options?.createWindow ??
      ((moduleId: WorkbenchModuleId, routing) =>
        new WorkbenchController(this.context, commitSelectionRuleService, {
          servedModule: moduleId,
          onOpenInOtherWindow: routing.onOpenInOtherWindow,
          securityRegistry: this.securityRegistry,
        }));
    this.windows = new WorkbenchWindowRegistry<ModuleWindow>((moduleId) =>
      createWindow(moduleId, {
        onOpenInOtherWindow: (request) => this.open(request),
      }),
    );
  }

  /** 统一打开入口：按模块路由到对应窗口（同模块单例复用并加载新目标）。 */
  async open(request: OpenWorkbenchRequest): Promise<void> {
    const window = this.windows.getOrCreate(request.moduleId);
    await window.open(request);
  }

  /** 原生编辑器对比入口：转发给独立 Diff 窗口（未打开 Diff 会话时明确报错）。 */
  async openNativeDiffInEditor(requestId?: string): Promise<void> {
    const diffWindow = this.windows.get("diff");
    if (!diffWindow?.openNativeDiffInEditor) {
      throw new Error(
        "没有可用的 SVN Diff 会话，请先打开 Working Copy ↔ BASE。",
      );
    }
    await diffWindow.openNativeDiffInEditor(requestId);
  }

  /** 测试与诊断：当前是否已有该模块的活动窗口。 */
  hasController(moduleId: WorkbenchModuleId): boolean {
    return this.windows.has(moduleId);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.invalidationSubscription.dispose();
    this.windows.disposeAll();
  }
}
