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

/*
 * V024-R41：按工作副本状态分支的新手引导。分支只由 Webview 已有的快照/
 * 错误派生（纯函数，不发起任何 SVN 调用），随状态变化重新计算下一步。
 * 五态：clean（干净）/ modified（有修改）/ conflict（有冲突且无可提交项）/
 * non-svn（非工作副本）/ cli-missing（CLI 缺失）。冲突与修改并存且仍有
 * 可提交项时走修改分支（冲突文件由既有阻止语义隔离，步骤文案已说明先解决冲突）。
 */
export type OnboardingBranch =
  "clean" | "modified" | "conflict" | "non-svn" | "cli-missing";

/** 分支输入信号：纯数字/布尔，与平台无关，可单元断言。 */
export interface OnboardingBranchSignals {
  fileCount: number;
  conflictedCount: number;
  /** 范围内是否存在可提交项（与 Changes 唯一主操作同一口径）。 */
  hasCommittable: boolean;
  cliMissing: boolean;
  nonSvn: boolean;
}

/**
 * 推导分支（优先级：CLI 缺失 > 非工作副本 > 冲突阻塞 > 干净 > 有修改）。
 * 冲突只在“无可提交项”时独立成支（与 Changes conflicts-only 同口径，
 * 此时选择→预览已不可能，必须先处理冲突）；冲突与可提交项并存时走修改分支。
 * 纯函数，不读取磁盘、不调用 SVN。
 */
export function deriveOnboardingBranch(
  signals: OnboardingBranchSignals,
): OnboardingBranch {
  if (signals.cliMissing) return "cli-missing";
  if (signals.nonSvn) return "non-svn";
  if (signals.conflictedCount > 0 && !signals.hasCommittable) return "conflict";
  if (signals.fileCount === 0) return "clean";
  return "modified";
}

/**
 * 分支必需步骤（ONBOARDING_STEPS 的子序列，保持原顺序）。
 * 干净/冲突分支跳过“选择→预览”（冲突阻塞时无可提交项、干净无候选），
 * 非 SVN/CLI 缺失分支只保留“打开→结束”（恢复优先于演示流程）。
 */
export function requiredStepsForBranch(
  branch: OnboardingBranch,
): OnboardingStepId[] {
  switch (branch) {
    case "clean":
    case "conflict":
      return ["open-workbench", "view-changes", "before-confirm"];
    case "non-svn":
    case "cli-missing":
      return ["open-workbench", "before-confirm"];
    case "modified":
      return ONBOARDING_STEPS.map((step) => step.id);
  }
}

/**
 * 随状态变化重新计算下一步：首个仍未达到的分支必需步骤；
 * 分支全部走完返回 undefined（引导条隐藏逻辑沿用 active）。
 */
export function nextRequiredStep(
  state: OnboardingState,
  branch: OnboardingBranch,
): OnboardingStepId | undefined {
  for (const id of requiredStepsForBranch(branch)) {
    const index = ONBOARDING_STEPS.findIndex((step) => step.id === id);
    if (index >= state.completedSteps) return id;
  }
  return undefined;
}

/** 分支中文说明：解释状态是否正常 + 只读下一步，不含任何写操作入口。 */
export const ONBOARDING_BRANCH_COPY: Record<
  OnboardingBranch,
  { statusLine: string; nextAction: string }
> = {
  clean: {
    statusLine: "当前工作副本没有本地修改，这是正常状态，不需要制造修改。",
    nextAction:
      "只读下一步：去“历史”查看修订，或到“更新”检查远端（均不改工作副本）。",
  },
  modified: {
    statusLine: "当前范围有本地修改，走完选择→预览即可熟悉提交流程。",
    nextAction: "按步骤继续即可；引导在最终写确认前停止。",
  },
  conflict: {
    statusLine: "当前范围存在冲突，冲突解决前不能提交。",
    nextAction: "先到冲突模块处理冲突；本引导只演示流程，不替你解决或提交。",
  },
  "non-svn": {
    statusLine: "当前目录不是 SVN 工作副本，不能执行 SVN 任务。",
    nextAction:
      "可打开文件夹选择工作副本，或查看环境诊断；检出（Checkout）不在本引导承诺范围。",
  },
  "cli-missing": {
    statusLine: "未找到 SVN 命令行工具，SVN 命令暂不可用。",
    nextAction: "可选择 SVN 可执行文件路径，或重新检测；浏览与引导不受影响。",
  },
};

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
  /*
   * V024-R41：当前分支（瞬态，不持久化）。由持有权威数据的模块按状态重算：
   * Changes 模块按候选/冲突更新 clean/modified/conflict；AppShell 按错误与
   * 诊断快照覆盖 cli-missing/non-svn。分支切换只改变“下一步”展示，不触碰
   * 选择、草稿与已完成记录（刷新不丢手工草稿）。
   */
  branch = $state<OnboardingBranch>("modified");

  constructor() {
    this.state = loadPersisted();
  }

  setBranch(next: OnboardingBranch): void {
    this.branch = next;
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
    this.branch = "modified";
    persist(this.state);
  }
}

export const onboarding = new OnboardingStore();
