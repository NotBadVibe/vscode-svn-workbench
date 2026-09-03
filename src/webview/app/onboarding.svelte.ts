import { workbenchBridge } from "../bridge/vscodeBridge";

/*
 * v0.0.18 批次 A（C-03）：三分钟核心闭环引导。
 * 引导复用真实任务窗口（Changes/Commit），不做平行演示 UI：步骤推进
 * 由真实交互事件驱动，演示止步于“最终确认前”，绝不实际提交。
 * 状态经 Webview state 持久化（跳过/完成后不再自动出现），可经命令
 * `svnWorkbench.openGuide` 或完成态入口重新打开。
 */

export type OnboardingStepId =
  | "open-workbench"
  | "view-changes"
  | "select-files"
  | "preview-commit"
  | "before-confirm";

export interface OnboardingStep {
  id: OnboardingStepId;
  title: string;
  description: string;
}

export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: "open-workbench",
    title: "从右键打开一个范围",
    description:
      "在资源管理器中右键一个文件或文件夹，选择“SVN Workbench → 查看工作副本修改”。你现在已经在工作台里，这一步完成了。",
  },
  {
    id: "view-changes",
    title: "查看范围与本地修改",
    description:
      "顶部范围栏显示当前范围、候选数量与工作副本修订版本；下方列表按状态展示每个文件。点击状态旁的 ⓘ 可以查看状态词解释。",
  },
  {
    id: "select-files",
    title: "选择建议提交的文件",
    description:
      "勾选你想提交的文件（也可以点击“推荐项”按本地规则选择）。注意：存在冲突的文件不能进入提交，需要先在冲突模块解决。",
  },
  {
    id: "preview-commit",
    title: "查看提交预览与来源说明",
    description:
      "点击“检查并提交所选”进入提交页，预览提交。预览会显示将执行的命令、每个文件的推荐来源（本地规则）与检查结果。",
  },
  {
    id: "before-confirm",
    title: "最终确认前结束",
    description:
      "演示到此结束：真实提交需要你在最终确认中点击“确认提交（N）”，并由扩展在执行前重新校验范围与文件状态。本次引导不会执行任何提交或写操作。",
  },
];

export interface OnboardingState {
  /** 全部步骤完成（含用户确认结束）。 */
  completed: boolean;
  /** 用户显式跳过。 */
  skipped: boolean;
  /** 已完成的步骤数（0..ONBOARDING_STEPS.length）。 */
  completedSteps: number;
}

const STATE_KEY = "svnWorkbench.onboarding.v1";

const memoryFallback: { state: OnboardingState } = {
  state: { completed: false, skipped: false, completedSteps: 0 },
};

export function initialOnboardingState(): OnboardingState {
  return { completed: false, skipped: false, completedSteps: 0 };
}

/** 跳过引导：保留已完成记录，但不再展示。 */
export function skipOnboarding(state: OnboardingState): OnboardingState {
  return { ...state, skipped: true };
}

/** 完成引导（最后一步的用户确认）。 */
export function completeOnboarding(state: OnboardingState): OnboardingState {
  return { ...state, completed: true, completedSteps: ONBOARDING_STEPS.length };
}

/** 重新打开引导：清除完成/跳过标记与进度，从头开始。 */
export function restartOnboarding(): OnboardingState {
  return initialOnboardingState();
}

/**
 * 推进引导：事件步骤必须是当前步骤或已完成步骤（跳步只记录到当前
 * 进度，不回退）；返回新状态（无变化时返回原引用）。
 */
export function advanceOnboarding(
  state: OnboardingState,
  stepId: OnboardingStepId,
): OnboardingState {
  if (state.completed || state.skipped) return state;
  const index = ONBOARDING_STEPS.findIndex((step) => step.id === stepId);
  if (index < 0) return state;
  // 只允许推进到当前步骤（index === completedSteps）或确认已完成步骤。
  if (index > state.completedSteps) return state;
  if (index < state.completedSteps) return state;
  const completedSteps = index + 1;
  const isLast = completedSteps === ONBOARDING_STEPS.length;
  return {
    ...state,
    completedSteps,
    // 最后一步完成即视为走完闭环；结束语文案仍由界面展示。
    completed: isLast ? true : state.completed,
  };
}

function loadPersisted(): OnboardingState {
  const state = workbenchBridge.getState() as
    Record<string, unknown> | undefined;
  const stored = state?.[STATE_KEY];
  if (
    typeof stored === "object" &&
    stored !== null &&
    typeof (stored as OnboardingState).completedSteps === "number"
  ) {
    return stored as OnboardingState;
  }
  return memoryFallback.state;
}

function persist(state: OnboardingState): void {
  memoryFallback.state = state;
  if (workbenchBridge.isMock) return;
  const stateAll =
    (workbenchBridge.getState() as Record<string, unknown> | undefined) ?? {};
  workbenchBridge.setState({ ...stateAll, [STATE_KEY]: state });
}

/**
 * 引导响应式单例：AppShell 渲染引导条，Changes/Commit 模块埋点推进。
 */
class OnboardingStore {
  state = $state<OnboardingState>(initialOnboardingState());

  constructor() {
    this.state = loadPersisted();
  }

  /** 引导条是否应展示（未完成且未跳过，或用户显式重开）。 */
  get active(): boolean {
    return !this.state.completed && !this.state.skipped;
  }

  get currentStep(): OnboardingStep | undefined {
    if (!this.active) return undefined;
    return ONBOARDING_STEPS[this.state.completedSteps];
  }

  recordStep(stepId: OnboardingStepId): void {
    const next = advanceOnboarding(this.state, stepId);
    if (next !== this.state) {
      this.state = next;
      persist(next);
    }
  }

  skip(): void {
    this.state = skipOnboarding(this.state);
    persist(this.state);
  }

  finish(): void {
    this.state = completeOnboarding(this.state);
    persist(this.state);
  }

  restart(): void {
    this.state = restartOnboarding();
    persist(this.state);
  }
}

export const onboarding = new OnboardingStore();
