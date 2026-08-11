import type { WorkbenchModuleId } from "../../protocol/workbenchProtocol";

/**
 * 模块窗口句柄：控制器必须提供“是否已释放”标记，注册表据此判断是否需要重建。
 */
export interface WorkbenchWindowHandle {
  readonly isDisposed: boolean;
}

/**
 * 0.0.5 按模块的单例窗口注册表（纯逻辑，不依赖 vscode API，可单测）。
 *
 * - 惰性创建：首次请求某模块时才调用工厂；
 * - 单例复用：同模块已有可用（未释放）句柄时直接返回；
 * - 关闭后重建：句柄已释放（面板关闭/控制器释放）时用新实例替换；
 * - 跨模块分离：不同模块各自持有独立句柄；
 * - disposeAll：扩展停用时统一释放全部窗口。
 */
export class WorkbenchWindowRegistry<T extends WorkbenchWindowHandle> {
  private readonly windows = new Map<WorkbenchModuleId, T>();

  constructor(private readonly factory: (moduleId: WorkbenchModuleId) => T) {}

  getOrCreate(moduleId: WorkbenchModuleId): T {
    const existing = this.windows.get(moduleId);
    if (existing && !existing.isDisposed) {
      return existing;
    }
    const created = this.factory(moduleId);
    this.windows.set(moduleId, created);
    return created;
  }

  /** 返回当前可用的句柄；已释放或不存在时返回 undefined。 */
  get(moduleId: WorkbenchModuleId): T | undefined {
    const window = this.windows.get(moduleId);
    return window && !window.isDisposed ? window : undefined;
  }

  has(moduleId: WorkbenchModuleId): boolean {
    return this.get(moduleId) !== undefined;
  }

  all(): T[] {
    return [...this.windows.values()].filter((window) => !window.isDisposed);
  }

  disposeAll(): void {
    for (const window of this.windows.values()) {
      const candidate = window as { dispose?: () => void };
      candidate.dispose?.();
    }
    this.windows.clear();
  }
}
