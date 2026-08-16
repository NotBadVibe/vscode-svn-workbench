import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import * as vscode from "vscode";
import { removeTestTempDirectory } from "./testTempDirectory";
import {
  buildConflictAiRequest,
  containsSvnConflictMarkers,
  createMockConflictAdvice,
} from "../../ai/conflictAiAdvisor";
import {
  AI_PROVIDER_PRESETS,
  AI_USAGE_SCENARIOS,
  AI_VISIBLE_USAGE_SCENARIOS,
  getAiProviderPreset,
  getScenarioModel,
  normalizeAiBaseUrl,
  validateAiProviderConfig,
} from "../../ai/aiModelConfiguration";
import {
  createMockAiSelection,
  countAiSelection,
} from "../../ai/mockAiSelection";
import {
  buildCommitSelectionAiRequest,
  createLocalCommitSelectionResult,
} from "../../ai/commitSelectionAi";
import {
  buildCommitSplitAiRequest,
  createLocalCommitSplitResult,
  validateCommitSplitResult,
} from "../../ai/commitSplitAi";
import {
  filterCandidatesByAiDecision,
  getAiRecommendedCandidatePaths,
  getDefaultSelectedCandidatePaths,
} from "../../ai/commitSelectionActions";
import { buildCommitSelectionExplanation } from "../../ai/commitSelectionExplanation";
import { createDiffEditingService } from "../../extension/workbench/diffEditHost";
import { createSvnBindingProbe } from "../../extension/workbench/diffSvnBinding";
import { hashBytes } from "../../diffEdit/diffPathGuard";
import { parseModelListResponse } from "../../ai/openAiCompatibleProvider";
import {
  buildTeamRulesAiRequest,
  createLocalTeamRulesRecommendation,
  normalizeTeamRulesRecommendation,
} from "../../ai/teamRulesAiRecommender";
import { validateAiSelectionResult } from "../../ai/aiResultValidator";
import {
  collectConflictItems,
  parseConflictInfoXml,
  SvnConflictItem,
} from "../../conflict/conflictCollector";
import {
  buildResolveConflictPreview,
  isResolveSuccessful,
} from "../../conflict/conflictResolver";
import {
  buildCommitMessageAiRequest,
  createMockCommitMessageResult,
  mergeCommitMessagePreservingUserContent,
  normalizeCommitMessageResult,
} from "../../ai/commitMessageAiGenerator";
import {
  CommitCandidate,
  collectCommitCandidates,
} from "../../commit/commitCandidateCollector";
import {
  filterCommitCandidates,
  getCommitCandidateFilterPresets,
  parseRepositoryCommitCandidateFilterPresets,
  readRepositoryCommitCandidateFilterPresets,
  resolveCommitCandidateFilterPreset,
  getSelectableCommitCandidatePaths,
  summarizeCommitCandidateFilterPresetMatches,
} from "../../commit/commitCandidateFiltering";
import {
  getGroupSelectableCandidatePaths,
  groupCommitCandidates,
  inferCommitCandidateModuleGroup,
} from "../../commit/commitCandidateGrouping";
import { parseSvnUnifiedDiffSummary } from "../../commit/commitDiffSummary";
import { parseCommittedRevision, runCommitFlow } from "../../commit/commitFlow";
import {
  buildCommitPlanPreview,
  toCommitFlowPlan,
} from "../../commit/commitPlanBuilder";
import { buildCommitSplitPlanPreview } from "../../commit/commitSplitPlanPreview";
import {
  buildCommitSplitQueueDraftScopeKey,
  createCommitSplitQueueDraft,
  getCommitSplitQueueDraftStorageKey,
  restoreCommitSplitQueueDraft,
} from "../../commit/commitSplitQueueDraft";
import {
  addCommitSplitToQueue,
  addCommitSplitsToQueue,
  canApplyCommitSplitQueueItem,
  canRetryCommitSplitQueueItem,
  canSubmitCommitSplitQueueItem,
  classifyCommitSplitQueuePreviewIssue,
  collectCommitSplitQueuePreviewIssues,
  completeCommitSplitQueueBulkPreviewItem,
  createCommitSplitQueueBulkPreviewState,
  doesCommitSplitQueueItemMatchPreviewIssueCategory,
  getCommitSplitQueuePreviewIssueCategoryAction,
  getCommitSplitQueuePreviewIssuePathsByCategory,
  getFailedRepreviewableCommitSplitQueueItems,
  getFirstRetryableCommitSplitQueueItem,
  getFirstSubmittableCommitSplitQueueItem,
  getCommitSplitQueueNextAction,
  groupCommitSplitQueuePreviewIssues,
  getNextCommitSplitQueueItem,
  getNextSubmittableCommitSplitQueueItem,
  getNotPreviewedCommitSplitQueueItems,
  getRepreviewableCommitSplitQueueItems,
  getVisibleCommitSplitQueueItems,
  markCommitSplitQueueItemApplied,
  markCommitSplitQueueItemSubmissionResult,
  markCommitSplitQueueItemSubmitting,
  refreshCommitSplitQueueAfterCommit,
  removeCompletedCommitSplitQueueItems,
  removeCommitSplitFromQueue,
  summarizeCommitSplitQueueBulkPreview,
  summarizeCommitSplitQueueBulkPreviewResult,
  summarizeCommitSplitQueue,
  updateCommitSplitQueueItemPreviewStatus,
} from "../../commit/commitSplitQueue";
import {
  buildCommitConventionConfigFromEditorInput,
  defaultCommitConventionConfig,
  ensureSvnWorkbenchProjectConfig,
  formatCommitConventionList,
  parseSvnWorkbenchProjectConfig,
  resolveCommitConventionConfig,
  SVN_WORKBENCH_CONFIG_FILE,
  toAiCommitConventionHint,
  updateSvnWorkbenchProjectConfigContent,
  validateCommitConventionConfig,
  validateCommitMessageConvention,
} from "../../commit/commitConvention";
import {
  applyCommitMessageTemplate,
  validateCommitMessage,
} from "../../commit/commitMessageTemplates";
import {
  checkPreCommitRemoteUpdates,
  parseRemoteUpdateStatusXml,
} from "../../commit/preCommitRemoteCheck";
import { classifyGeneratedFile } from "../../commit/generatedFilePolicy";
import {
  acceptanceChecklistSections,
  formatAcceptanceChecklistMarkdown,
  summarizeAcceptanceChecklist,
} from "../../diagnostics/acceptanceChecklist";
import {
  buildEnvironmentDiagnosticReport,
  formatEnvironmentDiagnosticReport,
} from "../../diagnostics/environmentDiagnostics";
import {
  createScopeFromExplorer,
  OperationScope,
} from "../../scope/operationScope";
import { validatePathsInScope } from "../../scope/pathBoundaryGuard";
import {
  normalizePathIdentity as normalizeTestPath,
  type PathSemantics,
} from "../../scope/pathIdentity";
import { resolveWorkingCopySet } from "../../scope/workingCopyResolver";

/**
 * 真实 SVN fixture 的路径语义：fixture 创建在宿主真实文件系统上，路径比较
 * 必须与宿主平台一致。显式构造语义对象（不依赖 pathIdentity 默认回退）。
 */
const fixtureSemantics: PathSemantics = {
  platform: process.platform,
  cwd: process.cwd(),
};
import {
  buildReleaseNotes,
  parseSvnListXml,
  validatePatchText,
} from "../../repository/advancedRepositoryTools";
import {
  buildSvnExecutableCandidates,
  resolveSvnExecutable,
} from "../../svn/svnExecutableResolver";
import { runSvnCommand } from "../../svn/svnCommandRunner";
import { parseStatusXml } from "../../svn/parsers/statusXmlParser";
import {
  buildUpdateExecutionFollowUp,
  buildUpdateScopeRiskConfirmationMessage,
  buildUpdateScopePreview,
  hasUpdateConflicts,
  parseUpdatedRevision,
  summarizeUpdateScopeLocalChanges,
  summarizeUpdateScopeRemoteChanges,
  summarizeUpdateScopeRisk,
} from "../../update/updateFlow";

export interface TestCase {
  name: string;
  run: () => Promise<void>;
}

class SkippedTest extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkippedTest";
  }
}

export async function run(): Promise<void> {
  const tests = getExtensionTestCases();
  const failures: string[] = [];

  for (const test of tests) {
    try {
      await test.run();
      console.log(`PASS ${test.name}`);
    } catch (error) {
      if (error instanceof SkippedTest) {
        console.log(`SKIP ${test.name}: ${error.message}`);
        continue;
      }

      const message =
        error instanceof Error ? (error.stack ?? error.message) : String(error);
      failures.push(`${test.name}\n${message}`);
      console.error(`FAIL ${test.name}`);
      console.error(message);
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `${failures.length} extension test(s) failed.\n\n${failures.join("\n\n")}`,
    );
  }
}

export function getExtensionTestCases(): TestCase[] {
  return [
    {
      name: "activates and registers core commands",
      run: testCommandRegistration,
    },
    {
      name: "builds cross-platform svn executable candidates",
      run: testSvnExecutableCandidates,
    },
    {
      name: "builds environment diagnostic report",
      run: testEnvironmentDiagnosticReport,
    },
    {
      name: "builds UI acceptance checklist",
      run: testAcceptanceChecklist,
    },
    {
      name: "refreshes status for a validation working copy",
      run: testRefreshStatus,
    },
    {
      name: "normalizes native SCM resource state command arguments",
      run: testScmResourceStateCommandArguments,
    },
    {
      name: "opens and reuses Diff tabs and invokes native vscode.diff",
      run: testDiffWindowAndNativeEditor,
    },
    {
      name: "v0.0.5 opens independent per-module windows with reuse and rebuild",
      run: testV005ModuleWindows,
    },
    {
      name: "v0.0.6 edits a working copy file via the guarded save pipeline",
      run: testDiffEditIntegration,
    },
    {
      name: "v0.0.6 rejects nested/external/BASE-changed targets in isolated SVN fixture",
      run: testDiffEditSvnBindingIsolation,
    },
    {
      name: "classifies generated files for commit filtering",
      run: testGeneratedFilePolicy,
    },
    {
      name: "keeps folder operation scope inside the selected folder",
      run: testFolderOperationScope,
    },
    {
      name: "merges parent and child roots in multi selection",
      run: testParentChildScopeMerge,
    },
    {
      name: "rejects selections spanning independent working copies",
      run: testMixedWorkingCopyResolution,
    },
    {
      name: "collects root commit candidates with generated file decisions",
      run: testRootCommitCandidates,
    },
    {
      name: "collects folder commit candidates inside the selected folder only",
      run: testFolderCommitCandidates,
    },
    {
      name: "rejects out-of-scope AI mock selections",
      run: testAiMockScopeGuard,
    },
    {
      name: "builds commit selection AI request from commit candidates",
      run: testCommitSelectionAiRequest,
    },
    {
      name: "creates local commit selection fallback",
      run: testCommitSelectionAiFallback,
    },
    {
      name: "rejects invented commit selection AI paths",
      run: testCommitSelectionAiCandidateGuard,
    },
    {
      name: "builds commit selection AI explanation",
      run: testCommitSelectionAiExplanation,
    },
    {
      name: "marks untouched commit candidates as not analyzed",
      run: testCommitSelectionAiExplanationNone,
    },
    {
      name: "returns AI recommended commit candidate paths",
      run: testCommitSelectionAiRecommendedPaths,
    },
    {
      name: "filters commit candidates by AI decision",
      run: testCommitSelectionAiDecisionFilter,
    },
    {
      name: "filters commit candidates by current file filters",
      run: testCommitCandidateCurrentFilters,
    },
    {
      name: "returns selectable commit candidate paths after filters",
      run: testCommitCandidateFilteredSelectablePaths,
    },
    {
      name: "resolves commit candidate filter presets",
      run: testCommitCandidateFilterPresets,
    },
    {
      name: "summarizes commit candidate filter preset matches",
      run: testCommitCandidateFilterPresetMatchSummary,
    },
    {
      name: "parses repository commit candidate filter presets",
      run: testRepositoryCommitCandidateFilterPresetParsing,
    },
    {
      name: "reads repository commit candidate filter presets",
      run: testRepositoryCommitCandidateFilterPresetReading,
    },
    {
      name: "restores default selected commit candidate paths",
      run: testCommitSelectionDefaultSelectedPaths,
    },
    {
      name: "groups commit candidates by module directory",
      run: testCommitCandidateModuleGrouping,
    },
    {
      name: "groups commit candidates by AI decision",
      run: testCommitCandidateAiDecisionGrouping,
    },
    {
      name: "summarizes commit candidate groups",
      run: testCommitCandidateGroupSummary,
    },
    {
      name: "returns selectable commit candidate group paths only",
      run: testCommitCandidateGroupSelectablePaths,
    },
    {
      name: "builds commit split AI request from selected candidates",
      run: testCommitSplitAiRequest,
    },
    {
      name: "creates local commit split suggestions",
      run: testCommitSplitAiLocalSuggestion,
    },
    {
      name: "validates commit split suggestion paths",
      run: testCommitSplitAiValidation,
    },
    {
      name: "builds commit split plan preview",
      run: testCommitSplitPlanPreview,
    },
    {
      name: "manages commit split queue items",
      run: testCommitSplitQueueManagement,
    },
    {
      name: "adds commit split suggestions to queue in bulk",
      run: testCommitSplitQueueBulkAdd,
    },
    {
      name: "updates commit split queue preview status",
      run: testCommitSplitQueuePreviewStatus,
    },
    {
      name: "guards commit split queue apply by preview status",
      run: testCommitSplitQueueApplyGuard,
    },
    {
      name: "tracks commit split queue submission lifecycle",
      run: testCommitSplitQueueSubmissionLifecycle,
    },
    {
      name: "guards commit split queue dedicated submit action",
      run: testCommitSplitQueueDedicatedSubmitGuard,
    },
    {
      name: "returns first submittable commit split queue item",
      run: testCommitSplitQueueFirstSubmittableItem,
    },
    {
      name: "returns first retryable failed commit split queue item",
      run: testCommitSplitQueueFirstRetryableFailedItem,
    },
    {
      name: "recommends the next commit split queue action",
      run: testCommitSplitQueueNextAction,
    },
    {
      name: "summarizes commit split queue visibility and next item",
      run: testCommitSplitQueueVisibilityAndNextItem,
    },
    {
      name: "guards failed commit split queue retry and completed cleanup",
      run: testCommitSplitQueueRetryAndCompletedCleanup,
    },
    {
      name: "filters commit split queue by status view",
      run: testCommitSplitQueueStatusViewFilter,
    },
    {
      name: "filters commit split queue by plan view",
      run: testCommitSplitQueuePlanViewFilter,
    },
    {
      name: "returns repreviewable commit split queue items",
      run: testCommitSplitQueueBulkPreviewSelection,
    },
    {
      name: "returns failed repreviewable commit split queue items",
      run: testCommitSplitQueueFailedRepreviewSelection,
    },
    {
      name: "returns not-previewed commit split queue items",
      run: testCommitSplitQueueNotPreviewedSelection,
    },
    {
      name: "tracks commit split queue bulk preview progress",
      run: testCommitSplitQueueBulkPreviewProgress,
    },
    {
      name: "summarizes commit split queue bulk preview result",
      run: testCommitSplitQueueBulkPreviewResultSummary,
    },
    {
      name: "collects commit split queue preview issues",
      run: testCommitSplitQueuePreviewIssueSummary,
    },
    {
      name: "groups commit split queue preview issues by reason",
      run: testCommitSplitQueuePreviewIssueGrouping,
    },
    {
      name: "filters commit split queue items by preview issue reason",
      run: testCommitSplitQueuePreviewIssueCategoryFilter,
    },
    {
      name: "returns handling advice for commit split queue preview issue reasons",
      run: testCommitSplitQueuePreviewIssueCategoryAction,
    },
    {
      name: "returns quick actions for commit split queue preview issue reasons",
      run: testCommitSplitQueuePreviewIssueQuickActions,
    },
    {
      name: "collects commit split queue preview issue paths by reason",
      run: testCommitSplitQueuePreviewIssuePathsByCategory,
    },
    {
      name: "persists commit split queue drafts by operation scope",
      run: testCommitSplitQueueDraftPersistence,
    },
    {
      name: "lists editable AI provider presets",
      run: testAiProviderPresets,
    },
    {
      name: "validates AI provider configuration",
      run: testAiProviderConfigurationValidation,
    },
    {
      name: "resolves AI scenario model overrides",
      run: testAiScenarioModelOverrides,
    },
    {
      name: "builds team rules AI request from repository structure",
      run: testTeamRulesAiRequest,
    },
    {
      name: "creates local team rules recommendation",
      run: testTeamRulesAiLocalRecommendation,
    },
    {
      name: "normalizes team rules AI recommendation",
      run: testTeamRulesAiRecommendationNormalization,
    },
    {
      name: "parses OpenAI-compatible model list",
      run: testOpenAiCompatibleModelListParsing,
    },
    {
      name: "opens commit panel for the selected folder command",
      run: testCommitPanelCommand,
    },
    {
      name: "builds commit plan preview for missing files",
      run: testMissingFileCommitPlan,
    },
    {
      name: "blocks generated files in commit plan preview",
      run: testGeneratedFileCommitPlanBlock,
    },
    {
      name: "blocks out-of-scope files in commit plan preview",
      run: testOutOfScopeCommitPlanBlock,
    },
    {
      name: "validates commit message templates",
      run: testCommitMessageTemplates,
    },
    {
      name: "validates team commit convention requirements",
      run: testCommitConventionValidation,
    },
    {
      name: "parses repository team config commit convention",
      run: testRepositoryCommitConventionParsing,
    },
    {
      name: "resolves repository team config over workspace settings",
      run: testRepositoryCommitConventionResolution,
    },
    {
      name: "creates default repository team config file",
      run: testTeamConfigCreation,
    },
    {
      name: "normalizes visual team config form input",
      run: testVisualTeamConfigInputNormalization,
    },
    {
      name: "validates visual team config before saving",
      run: testVisualTeamConfigValidation,
    },
    {
      name: "updates team config while preserving other project config",
      run: testTeamConfigContentUpdatePreservesOtherFields,
    },
    {
      name: "builds commit message AI request from selected files",
      run: testCommitMessageAiRequest,
    },
    {
      name: "passes team commit convention into commit message AI request",
      run: testCommitConventionAiRequest,
    },
    {
      name: "creates safe fallback commit message",
      run: testCommitMessageAiFallback,
    },
    {
      name: "creates convention-aware fallback commit message",
      run: testCommitConventionAiFallback,
    },
    {
      name: "parses lightweight svn diff summary",
      run: testCommitDiffSummaryParsing,
    },
    {
      name: "attaches diff summary to commit message AI request",
      run: testCommitMessageAiRequestDiffSummary,
    },
    {
      name: "builds commit message AI request in template completion mode",
      run: testCommitMessageAiTemplateCompletionRequest,
    },
    {
      name: "preserves user commit message template fields",
      run: testCommitMessageTemplatePreserveMerge,
    },
    {
      name: "converts commit preview to commit flow plan",
      run: testCommitFlowPlanConversion,
    },
    {
      name: "parses committed revision from svn output",
      run: testCommittedRevisionParsing,
    },
    {
      name: "executes a guarded Windows Unicode-path commit in an isolated real SVN repository",
      run: testRealCommitFlow,
    },
    {
      name: "executes advanced repository operations in an isolated real SVN repository",
      run: testRealAdvancedRepositoryOperations,
    },
    {
      name: "parses remote update status from svn xml",
      run: testRemoteUpdateStatusParsing,
    },
    {
      name: "checks remote updates for validation working copy",
      run: testRemoteUpdateCheck,
    },
    {
      name: "builds update scope preview",
      run: testUpdateScopePreview,
    },
    {
      name: "summarizes update scope local changes",
      run: testUpdateScopeLocalChangeSummary,
    },
    {
      name: "summarizes update scope remote changes",
      run: testUpdateScopeRemoteChangeSummary,
    },
    {
      name: "summarizes update scope risk",
      run: testUpdateScopeRiskSummary,
    },
    {
      name: "builds update scope risk confirmation message",
      run: testUpdateScopeRiskConfirmationMessage,
    },
    {
      name: "builds update execution follow-up actions",
      run: testUpdateExecutionFollowUp,
    },
    {
      name: "parses update revision and conflicts",
      run: testUpdateOutputParsing,
    },
    {
      name: "parses svn conflict info xml",
      run: testConflictInfoParsing,
    },
    {
      name: "collects conflict items from validation working copy",
      run: testConflictCollection,
    },
    {
      name: "builds bounded conflict AI request",
      run: testConflictAiRequest,
    },
    {
      name: "keeps conflict AI advice decision only",
      run: testConflictAiAdvice,
    },
    {
      name: "builds resolve conflict preview",
      run: testResolveConflictPreview,
    },
    {
      name: "parses resolve conflict output",
      run: testResolveConflictOutputParsing,
    },
  ];
}

async function testCommandRegistration(): Promise<void> {
  const extension = vscode.extensions.getExtension("local.svn-workbench");
  assert.ok(
    extension,
    "Extension local.svn-workbench should be installed in the test host.",
  );

  const contributedMenus = extension.packageJSON.contributes?.menus as Record<
    string,
    Array<{ submenu?: string; when?: string }>
  >;
  for (const menuId of ["explorer/context", "editor/context"]) {
    const entry = contributedMenus[menuId]?.find(
      (item) => item.submenu === "svnWorkbench.explorer",
    );
    assert.ok(entry, `${menuId} 应贡献 SVN 工作台子菜单。`);
    assert.equal(entry.when, "resourceScheme == file");
  }

  await extension.activate();

  const commands = await vscode.commands.getCommands(true);
  assert.ok(commands.includes("svnWorkbench.checkEnvironment"));
  assert.ok(commands.includes("svnWorkbench.refreshStatus"));
  assert.ok(commands.includes("svnWorkbench.openConflictCenter"));
  assert.ok(commands.includes("svnWorkbench.openDiff"));
  assert.ok(commands.includes("svnWorkbench.openTeamConfig"));
  assert.ok(commands.includes("svnWorkbench.configureTeamConfig"));
  assert.ok(commands.includes("svnWorkbench.aiConfigure"));
  assert.ok(commands.includes("svnWorkbench.openAcceptanceChecklist"));
  assert.ok(commands.includes("svnWorkbench.updateScope"));
  assert.ok(commands.includes("svnWorkbench.openProperties"));
  assert.ok(commands.includes("svnWorkbench.openCleanup"));
  assert.ok(commands.includes("svnWorkbench.openRepositoryBrowser"));
  assert.ok(commands.includes("svnWorkbench.createBranch"));
  assert.ok(commands.includes("svnWorkbench.createTag"));
  assert.ok(commands.includes("svnWorkbench.switchWorkingCopy"));
  assert.ok(commands.includes("svnWorkbench.relocateWorkingCopy"));
  assert.ok(commands.includes("svnWorkbench.mergeToWorkingCopy"));
  assert.ok(commands.includes("svnWorkbench.openPatchShelf"));
  assert.ok(commands.includes("svnWorkbench.openReleaseNotes"));
  assert.ok(commands.includes("svnWorkbench.openHistory"));
  assert.ok(commands.includes("svnWorkbench.aiReviewScope"));
  assert.ok(commands.includes("svnWorkbench.analyzeImpact"));
  assert.ok(commands.includes("svnWorkbench.openChangelists"));
  assert.ok(commands.includes("svnWorkbench.openAgent"));
  assert.ok(commands.includes("svnWorkbench.scmRefresh"));
  assert.ok(commands.includes("svnWorkbench.add"));
  assert.ok(commands.includes("svnWorkbench.ignore"));
  assert.ok(commands.includes("svnWorkbench.revert"));
  assert.ok(commands.includes("svnWorkbench.lock"));
  assert.ok(commands.includes("svnWorkbench.unlock"));
}

async function testSvnExecutableCandidates(): Promise<void> {
  const windowsExisting = new Set([
    "C:\\Tools\\svn.exe",
    "C:\\Program Files\\VisualSVN Server\\bin\\svn.exe",
  ]);
  const windows = buildSvnExecutableCandidates(
    "C:\\Tools\\svn.exe",
    "win32",
    (candidate) => windowsExisting.has(candidate),
  );

  assert.equal(windows[0], "C:\\Tools\\svn.exe");
  assert.ok(windows.includes("svn.exe"));
  assert.ok(
    windows.includes("C:\\Program Files\\VisualSVN Server\\bin\\svn.exe"),
  );
  assert.equal(new Set(windows).size, windows.length);

  const mac = buildSvnExecutableCandidates(undefined, "darwin", () => true);
  assert.ok(mac.includes("svn"));
  assert.ok(mac.includes("/opt/homebrew/bin/svn"));
  assert.ok(mac.includes("/usr/local/bin/svn"));
  assert.ok(mac.includes("/usr/bin/svn"));

  const filteredMac = buildSvnExecutableCandidates(
    "/missing/svn",
    "darwin",
    (candidate) => candidate === "/usr/local/bin/svn",
  );
  assert.deepEqual(filteredMac, ["svn", "/usr/local/bin/svn"]);
}

async function testEnvironmentDiagnosticReport(): Promise<void> {
  const pass = buildEnvironmentDiagnosticReport({
    platform: "win32",
    arch: "x64",
    vscodeVersion: "1.92.0",
    svnExecutable: {
      path: "svn.exe",
      version: "1.14.3",
    },
    workspaces: [
      {
        name: "demo",
        path: "C:\\repo",
        isSvnWorkingCopy: true,
      },
    ],
    ai: {
      providerPreset: "deepseek",
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-coder",
      hasApiKey: true,
    },
  });

  assert.equal(pass.status, "pass");
  assert.match(formatEnvironmentDiagnosticReport(pass), /Windows/);
  assert.match(formatEnvironmentDiagnosticReport(pass), /SVN CLI/);

  const warn = buildEnvironmentDiagnosticReport({
    platform: "darwin",
    arch: "arm64",
    vscodeVersion: "1.92.0",
    svnExecutable: {
      path: "/opt/homebrew/bin/svn",
      version: "1.14.3",
    },
    workspaces: [
      {
        name: "plain-folder",
        path: "/Users/demo/plain-folder",
        isSvnWorkingCopy: false,
      },
    ],
    ai: {
      providerPreset: "deepseek",
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-coder",
      hasApiKey: false,
    },
  });
  assert.equal(warn.status, "warn");
  assert.ok(
    warn.checks.some(
      (check) => check.id === "workspace" && check.status === "warn",
    ),
  );
  assert.ok(
    warn.checks.some(
      (check) => check.id === "ai-config" && check.status === "warn",
    ),
  );

  const fail = buildEnvironmentDiagnosticReport({
    platform: "win32",
    arch: "x64",
    vscodeVersion: "1.92.0",
    configuredSvnPath: "C:\\missing\\svn.exe",
    workspaces: [],
    ai: undefined,
  });
  assert.equal(fail.status, "fail");
  assert.ok(
    fail.checks.some(
      (check) => check.id === "svn-cli" && check.status === "fail",
    ),
  );
  assert.match(
    formatEnvironmentDiagnosticReport(fail),
    /C:\\missing\\svn\.exe/,
  );
}

async function testAcceptanceChecklist(): Promise<void> {
  const summary = summarizeAcceptanceChecklist();
  assert.equal(summary.sections, 8);
  assert.equal(summary.items, 24);
  assert.ok(summary.steps >= 55);
  assert.ok(summary.expectedResults >= 40);

  const sectionIds = acceptanceChecklistSections.map((section) => section.id);
  assert.deepEqual(sectionIds, [
    "environment",
    "explorer",
    "chinese-ux",
    "layout-scroll",
    "commit",
    "update",
    "conflict",
    "cross-platform",
  ]);

  const itemIds = acceptanceChecklistSections.flatMap((section) =>
    section.items.map((item) => item.id),
  );
  assert.ok(itemIds.includes("explorer-folder-commit"));
  assert.ok(itemIds.includes("explorer-task-routing"));
  assert.ok(itemIds.includes("explorer-ai-actions"));
  assert.ok(itemIds.includes("chinese-ime-path"));
  assert.ok(itemIds.includes("local-scroll-regions"));
  assert.ok(itemIds.includes("compact-zoom"));
  assert.ok(itemIds.includes("commit-filters"));
  assert.ok(itemIds.includes("update-after-refresh"));
  assert.ok(itemIds.includes("conflict-ai-advice"));
  assert.ok(itemIds.includes("macos-acceptance"));
  assert.ok(itemIds.includes("linux-acceptance"));

  const markdown = formatAcceptanceChecklistMarkdown();
  assert.match(markdown, /SVN 工作台 UI 验收清单/);
  assert.match(markdown, /右键文件夹提交当前范围/);
  assert.match(markdown, /右键 AI 操作入口/);
  assert.match(markdown, /中文输入法与特殊路径/);
  assert.match(markdown, /720×480 与 200% 缩放/);
  assert.match(markdown, /更新后候选刷新与冲突入口/);
  assert.match(markdown, /macOS 安装与流程/);
  assert.match(markdown, /Linux 安装与流程/);
}

async function testRefreshStatus(): Promise<void> {
  const workspace = getSvnWorkspaceOrSkip();

  await vscode.commands.executeCommand(
    "svnWorkbench.refreshStatus",
    workspace.uri,
  );
}

async function testScmResourceStateCommandArguments(): Promise<void> {
  const workspace = getSvnWorkspaceOrSkip();
  const file = vscode.Uri.joinPath(
    workspace.uri,
    "src",
    "pages",
    "order",
    "OrderList.vue",
  );
  const resourceState = { resourceUri: file };

  await vscode.commands.executeCommand(
    "svnWorkbench.openHistory",
    resourceState,
  );
  await vscode.commands.executeCommand(
    "svnWorkbench.openConflictCenter",
    resourceState,
  );
  await vscode.commands.executeCommand("svnWorkbench.openDiff", resourceState);
}

async function waitForTab(
  predicate: (tab: vscode.Tab) => boolean,
  description: string,
): Promise<vscode.Tab> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const tab = vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .find(predicate);
    if (tab) return tab;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`等待 ${description} 超时。`);
}

async function testDiffWindowAndNativeEditor(): Promise<void> {
  const workspace = getSvnWorkspaceOrSkip();
  const file = vscode.Uri.joinPath(
    workspace.uri,
    "src",
    "pages",
    "order",
    "OrderList.vue",
  );
  const configuration = vscode.workspace.getConfiguration("svnWorkbench");

  await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  await configuration.update(
    "diff.openMode",
    "sameGroup",
    vscode.ConfigurationTarget.Workspace,
  );
  try {
    const source = await vscode.window.showTextDocument(file, {
      preview: false,
    });
    const sourceGroup = source.viewColumn;
    await vscode.commands.executeCommand("svnWorkbench.openDiff", file);
    const diffTab = await waitForTab(
      (tab) => tab.label === "SVN · 查看本地修改",
      "同组 SVN Diff 标签",
    );
    const diffGroup = vscode.window.tabGroups.all.find((group) =>
      group.tabs.includes(diffTab),
    );
    assert.equal(diffGroup?.viewColumn, sourceGroup);

    await vscode.commands.executeCommand("svnWorkbench.openDiff", file);
    assert.equal(
      vscode.window.tabGroups.all
        .flatMap((group) => group.tabs)
        .filter((tab) => tab.label === "SVN · 查看本地修改").length,
      1,
      "同一目标必须复用现有 Diff 标签",
    );

    await vscode.commands.executeCommand("svnWorkbench.openDiffInEditor");
    const nativeTab = await waitForTab(
      (tab) => tab.input instanceof vscode.TabInputTextDiff,
      "原生 vscode.diff 标签",
    );
    assert.ok(nativeTab.input instanceof vscode.TabInputTextDiff);
    assert.equal(nativeTab.input.original.scheme, "svn-workbench-base");
    assert.equal(
      path.resolve(nativeTab.input.modified.fsPath),
      path.resolve(file.fsPath),
    );
    assert.match(nativeTab.label, /BASE ↔ 工作副本/);
  } finally {
    await configuration.update(
      "diff.openMode",
      undefined,
      vscode.ConfigurationTarget.Workspace,
    );
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  }
}

async function countTabsWithLabel(label: string): Promise<number> {
  return vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .filter((tab) => tab.label === label).length;
}

async function waitForTabGone(
  label: string,
  description: string,
): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if ((await countTabsWithLabel(label)) === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`等待 ${description} 关闭超时。`);
}

/**
 * v0.0.5 真实 VS Code 多窗口冒烟（非 Webview mock）：
 * 每模块独立窗口、同模块单例复用、关闭后重建、跨模块路由不顶替、
 * 关闭一个窗口不影响其他窗口。
 */
async function testV005ModuleWindows(): Promise<void> {
  const workspace = getSvnWorkspaceOrSkip();
  const file = vscode.Uri.joinPath(
    workspace.uri,
    "src",
    "pages",
    "order",
    "OrderList.vue",
  );
  await vscode.commands.executeCommand("workbench.action.closeAllEditors");

  // 1) 不同模块各自独立窗口（互不顶替）。
  await vscode.commands.executeCommand("svnWorkbench.openWorkbench", file);
  await waitForTab((tab) => tab.label === "SVN · 工作副本修改", "Changes 窗口");
  await vscode.commands.executeCommand("svnWorkbench.openHistory", file);
  const historyTab = await waitForTab(
    (tab) => tab.label === "SVN · 历史记录",
    "History 窗口",
  );
  assert.equal(
    await countTabsWithLabel("SVN · 工作副本修改"),
    1,
    "Changes 窗口应保持独立存在",
  );

  // 2) 同模块重复打开复用单例窗口。
  await vscode.commands.executeCommand("svnWorkbench.openHistory", file);
  assert.equal(
    await countTabsWithLabel("SVN · 历史记录"),
    1,
    "同模块重复打开必须复用窗口",
  );

  // 3) 关闭后按需重建。
  await vscode.window.tabGroups.close(historyTab);
  await waitForTabGone("SVN · 历史记录", "History 窗口");
  await vscode.commands.executeCommand("svnWorkbench.openHistory", file);
  await waitForTab(
    (tab) => tab.label === "SVN · 历史记录",
    "重建的 History 窗口",
  );

  // 4) Diff 打开为独立窗口，不顶替 Changes。
  await vscode.commands.executeCommand("svnWorkbench.openDiff", file);
  await waitForTab((tab) => tab.label === "SVN · 查看本地修改", "Diff 窗口");
  assert.equal(
    await countTabsWithLabel("SVN · 工作副本修改"),
    1,
    "打开 Diff 不得关闭 Changes 窗口",
  );

  // 5) Commit 为独立窗口，且跨模块打开不顶替其他窗口。
  await vscode.commands.executeCommand("svnWorkbench.commitFolder", file);
  const commitTab = await waitForTab(
    (tab) => tab.label === "SVN · 提交当前范围",
    "Commit 窗口",
  );
  assert.equal(
    await countTabsWithLabel("SVN · 工作副本修改"),
    1,
    "打开 Commit 不得关闭 Changes 窗口",
  );
  assert.equal(
    await countTabsWithLabel("SVN · 查看本地修改"),
    1,
    "打开 Commit 不得关闭 Diff 窗口",
  );

  // 5a) 设置（AI 配置）为独立窗口，Commit→Settings 式跨模块路由不顶替。
  await vscode.commands.executeCommand("svnWorkbench.aiConfigure");
  const settingsTab = await waitForTab(
    (tab) => tab.label === "SVN · AI 模型设置",
    "Settings 窗口",
  );
  assert.equal(
    await countTabsWithLabel("SVN · 提交当前范围"),
    1,
    "打开 Settings 不得关闭 Commit 窗口",
  );

  // 6) 关闭一个窗口不影响同仓库另一窗口。
  await vscode.window.tabGroups.close(commitTab);
  await waitForTabGone("SVN · 提交当前范围", "Commit 窗口");
  await vscode.window.tabGroups.close(settingsTab);
  await waitForTabGone("SVN · AI 模型设置", "Settings 窗口");
  assert.equal(
    await countTabsWithLabel("SVN · 工作副本修改"),
    1,
    "关闭 Commit/Settings 后 Changes 窗口仍存在",
  );
  assert.equal(
    await countTabsWithLabel("SVN · 历史记录"),
    1,
    "关闭 Commit/Settings 后 History 窗口仍存在",
  );

  // 7) 冒烟完成后清理，避免影响后续用例。
  await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  await waitForTabGone("SVN · 工作副本修改", "Changes 窗口清理");
}

async function testDiffEditIntegration(): Promise<void> {
  const workspace = getSvnWorkspaceOrSkip();
  const scope: OperationScope = {
    id: "diff-edit-test",
    repositoryRoot: workspace.uri.fsPath,
    source: "editorFile",
    roots: [
      {
        absolutePath: workspace.uri.fsPath,
        relativePath: ".",
        kind: "folder",
      },
    ],
    allowExpandScope: false,
    includeExternals: false,
    includeNestedWorkingCopies: false,
    createdAt: 0,
  };
  // 使用专用临时文件，避免污染既有夹具。
  const target = path.join(workspace.uri.fsPath, "_diff-edit-integration.txt");
  const original = "line1\nline2\n";
  await fs.promises.writeFile(target, original, "utf8");
  const service = createDiffEditingService();
  try {
    const opened = await service.openEdit({
      sessionId: "ext-host-session",
      repositoryUuid: "test-uuid",
      scopeHash: "test-scope-hash",
      targetPath: target,
      baseContents: original,
      baseRevision: "BASE",
      baseHash: hashBytes(Buffer.from(original, "utf8")),
      rawHash: hashBytes(Buffer.from(original, "utf8")),
      scope,
      repositoryRoot: workspace.uri.fsPath,
    });
    assert.ok(opened.ok, "openEdit 应成功");
    if (!opened.ok) return;
    const saved = await service.saveWorking({
      sessionId: "ext-host-session",
      moduleId: "diff",
      taskId: "diff/working",
      repositoryUuid: "test-uuid",
      scopeHash: "test-scope-hash",
      targetId: opened.targetId,
      editToken: opened.editToken,
      draftRevision: opened.draftRevision,
      expectedContentHash: opened.rawHash,
      content: "line1\nline1.5\nline2\n",
      scope,
      repositoryRoot: workspace.uri.fsPath,
    });
    assert.ok(saved.ok, "saveWorking 应成功写入");
    if (!saved.ok) return;
    const after = await fs.promises.readFile(target, "utf8");
    assert.equal(after, "line1\nline1.5\nline2\n");
    // 旧 token 单次使用：重放必须拒绝。
    const replay = await service.saveWorking({
      sessionId: "ext-host-session",
      moduleId: "diff",
      taskId: "diff/working",
      repositoryUuid: "test-uuid",
      scopeHash: "test-scope-hash",
      targetId: opened.targetId,
      editToken: opened.editToken,
      draftRevision: opened.draftRevision,
      expectedContentHash: opened.rawHash,
      content: "hijack\n",
      scope,
      repositoryRoot: workspace.uri.fsPath,
    });
    assert.ok(!replay.ok, "旧 token 重放必须被拒绝");

    // 生产接线（v0.0.6 最终验收）：保存成功后的自写 watcher 事件不得撤销
    // 新 token（hash 感知），连续第二次保存必须成功；真实外部变化仍撤销。
    await service.revokeForPath(target);
    const draft = service.getDraft(opened.targetId);
    assert.ok(draft, "保存后草稿应保留");
    if (!draft) return;
    const checkpoint2 = service.checkpointDraft({
      targetId: opened.targetId,
      sessionId: "ext-host-session",
      repositoryUuid: "test-uuid",
      scopeHash: "test-scope-hash",
      baseHash: draft.baseHash,
      baseRevision: draft.baseRevision,
      baseContents: draft.baseContents,
      diskHash: saved.newContentHash,
      targetPath: target,
      content: "line1\nline1.5\nline2\nline3\n",
      baseRevisionOfClient: saved.acceptedRevision,
    });
    assert.ok(checkpoint2.ok, "保存后检查点应接受");
    const secondSave = await service.saveWorking({
      sessionId: "ext-host-session",
      moduleId: "diff",
      taskId: "diff/working",
      repositoryUuid: "test-uuid",
      scopeHash: "test-scope-hash",
      targetId: opened.targetId,
      editToken: saved.newEditToken,
      draftRevision: checkpoint2.ok ? checkpoint2.draftRevision : 0,
      expectedContentHash: saved.newContentHash,
      content: "line1\nline1.5\nline2\nline3\n",
      scope,
      repositoryRoot: workspace.uri.fsPath,
    });
    assert.ok(secondSave.ok, "自写事件后第二次保存必须成功");
    assert.equal(
      await fs.promises.readFile(target, "utf8"),
      "line1\nline1.5\nline2\nline3\n",
    );
    // 真实外部变化：撤销后旧 token 拒绝、不落盘。
    await fs.promises.writeFile(target, "external\n", "utf8");
    await service.revokeForPath(target);
    if (secondSave.ok) {
      const externalSave = await service.saveWorking({
        sessionId: "ext-host-session",
        moduleId: "diff",
        taskId: "diff/working",
        repositoryUuid: "test-uuid",
        scopeHash: "test-scope-hash",
        targetId: opened.targetId,
        editToken: secondSave.newEditToken,
        draftRevision: secondSave.acceptedRevision,
        expectedContentHash: secondSave.newContentHash,
        content: "hijack\n",
        scope,
        repositoryRoot: workspace.uri.fsPath,
      });
      assert.ok(!externalSave.ok, "外部变化后必须拒绝保存");
      assert.equal(
        await fs.promises.readFile(target, "utf8"),
        "external\n",
        "被拒绝的保存不得改动磁盘",
      );
    }
    // 还原供后续 TextDocument 链路断言使用。
    await fs.promises.writeFile(target, "line1\nline1.5\nline2\n", "utf8");

    // 真实 TextDocument 链路（v0.0.6 验收）：干净打开的文档可进入编辑；
    // 文档变脏后 openEdit 拒绝、已签发 token 的保存被拒绝且不落盘。
    const document = await vscode.workspace.openTextDocument(target);
    const liveOpen = await service.openEdit({
      sessionId: "ext-host-session",
      repositoryUuid: "test-uuid",
      scopeHash: "test-scope-hash",
      targetPath: target,
      baseContents: original,
      baseRevision: "BASE",
      baseHash: hashBytes(Buffer.from(original, "utf8")),
      rawHash: hashBytes(Buffer.from(original, "utf8")),
      scope,
      repositoryRoot: workspace.uri.fsPath,
    });
    assert.ok(liveOpen.ok, "干净打开的文档应允许进入编辑");
    if (!liveOpen.ok) return;
    // 通过 WorkspaceEdit 使文档变脏（不落盘）。
    const dirtyEdit = new vscode.WorkspaceEdit();
    dirtyEdit.insert(document.uri, new vscode.Position(0, 0), "// dirty\n");
    await vscode.workspace.applyEdit(dirtyEdit);
    assert.ok(document.isDirty, "文档应处于脏状态");
    try {
      const dirtyOpen = await service.openEdit({
        sessionId: "ext-host-session",
        repositoryUuid: "test-uuid",
        scopeHash: "test-scope-hash",
        targetPath: target,
        baseContents: original,
        baseRevision: "BASE",
        baseHash: hashBytes(Buffer.from(original, "utf8")),
        rawHash: hashBytes(Buffer.from(original, "utf8")),
        scope,
        repositoryRoot: workspace.uri.fsPath,
      });
      assert.ok(!dirtyOpen.ok, "脏文档必须拒绝 openEdit");
      if (!dirtyOpen.ok) {
        assert.equal(dirtyOpen.reason, "documentDirty");
      }
      const dirtySave = await service.saveWorking({
        sessionId: "ext-host-session",
        moduleId: "diff",
        taskId: "diff/working",
        repositoryUuid: "test-uuid",
        scopeHash: "test-scope-hash",
        targetId: liveOpen.targetId,
        editToken: liveOpen.editToken,
        draftRevision: liveOpen.draftRevision,
        expectedContentHash: liveOpen.rawHash,
        content: "hijack\n",
        scope,
        repositoryRoot: workspace.uri.fsPath,
      });
      assert.ok(!dirtySave.ok, "脏文档或已失效 token 必须拒绝保存");
      assert.equal(
        await fs.promises.readFile(target, "utf8"),
        "line1\nline1.5\nline2\n",
        "被拒绝的保存不得改动磁盘",
      );
    } finally {
      // 恢复文档为干净状态，避免污染后续用例。
      const revertEdit = new vscode.WorkspaceEdit();
      revertEdit.delete(
        document.uri,
        new vscode.Range(new vscode.Position(0, 0), new vscode.Position(1, 0)),
      );
      await vscode.workspace.applyEdit(revertEdit);
      await document.save();
    }
  } finally {
    await fs.promises.rm(target, { force: true });
  }
}

/*
 * v0.0.6 验收：真实 SVN fixture 下的绑定复验。
 * 覆盖嵌套工作副本、svn:externals 与 BASE 变化（working hash 未变）三条
 * Host 拒绝链；UUID 变化在单元层覆盖（svnadmin setuuid 后既有 WC 的
 * svn info 仍读本地元数据，真实 fixture 无法触发）。
 */
async function testDiffEditSvnBindingIsolation(): Promise<void> {
  const svnPath = await getSvnPathOrSkip();
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "svn-workbench-diff-bind-"),
  );
  const repository = path.join(tempRoot, "repository");
  const seed = path.join(tempRoot, "seed");
  const workingCopy = path.join(tempRoot, "wc");
  const secondCopy = path.join(tempRoot, "wc2");
  try {
    const admin = spawnSync("svnadmin", ["create", repository], {
      encoding: "utf8",
      shell: false,
    });
    if (admin.error || admin.status !== 0) {
      throw new SkippedTest("svnadmin is not available for binding fixture.");
    }
    fs.mkdirSync(path.join(seed, "ext-src"), { recursive: true });
    fs.writeFileSync(path.join(seed, "file.txt"), "base\n", "utf8");
    fs.writeFileSync(path.join(seed, "ext-src", "ext.txt"), "ext\n", "utf8");
    const repositoryUrl = `${pathToFileURL(repository).href}/trunk`;
    const imported = await runSvnCommand(
      svnPath,
      ["import", seed, repositoryUrl, "-m", "initial", "--encoding", "utf-8"],
      tempRoot,
    );
    assert.equal(imported.exitCode, 0, imported.stderr);
    const checkout = await runSvnCommand(
      svnPath,
      ["checkout", repositoryUrl, workingCopy],
      tempRoot,
    );
    assert.equal(checkout.exitCode, 0, checkout.stderr);

    const scope: OperationScope = {
      id: "diff-bind-test",
      repositoryRoot: workingCopy,
      source: "editorFile" as const,
      roots: [
        {
          absolutePath: workingCopy,
          relativePath: ".",
          kind: "folder" as const,
        },
      ],
      allowExpandScope: false,
      includeExternals: false,
      includeNestedWorkingCopies: false,
      createdAt: 0,
    };
    const probe = createSvnBindingProbe(svnPath);
    const service = createDiffEditingService();
    const target = path.join(workingCopy, "file.txt");
    // 本地修改（working 与 BASE 不同）。
    fs.writeFileSync(target, "base\nlocal\n", "utf8");
    const openInput = {
      sessionId: "bind-session",
      repositoryUuid: "",
      scopeHash: "bind-scope",
      baseContents: "base\n",
      baseRevision: "BASE",
      baseHash: "",
      rawHash: "",
      scope,
      repositoryRoot: workingCopy,
      probeSvnBinding: probe,
    };
    // UUID 从 probe 实测（openEdit 要求 session UUID 与 probe 一致）。
    const uuidProbe = await probe(target);
    assert.ok(uuidProbe.ok, "probe 应读取真实 SVN 信息");
    if (!uuidProbe.ok) return;
    const boundInput = {
      ...openInput,
      repositoryUuid: uuidProbe.repositoryUuid,
    };

    const opened = await service.openEdit({
      ...boundInput,
      targetPath: target,
    });
    assert.ok(opened.ok, "主工作副本目标应允许 openEdit");
    if (!opened.ok) return;

    // 嵌套工作副本：独立 checkout 形成自己的 wcroot。
    const nested = path.join(workingCopy, "nested");
    const nestedCheckout = await runSvnCommand(
      svnPath,
      ["checkout", repositoryUrl, nested],
      workingCopy,
    );
    assert.equal(nestedCheckout.exitCode, 0, nestedCheckout.stderr);
    const nestedOpen = await service.openEdit({
      ...boundInput,
      targetPath: path.join(nested, "file.txt"),
    });
    assert.ok(!nestedOpen.ok, "嵌套工作副本目标必须拒绝");
    if (!nestedOpen.ok) {
      assert.equal(nestedOpen.reason, "nestedOrExternal");
    }

    // svn:externals：外部引用目录形成独立 wcroot。
    const propset = await runSvnCommand(
      svnPath,
      ["propset", "svn:externals", "^/trunk/ext-src ext", workingCopy],
      workingCopy,
    );
    assert.equal(propset.exitCode, 0, propset.stderr);
    const updateForExternal = await runSvnCommand(
      svnPath,
      ["update", "--ignore-externals", workingCopy],
      workingCopy,
    );
    assert.equal(updateForExternal.exitCode, 0, updateForExternal.stderr);
    const fetchExternal = await runSvnCommand(
      svnPath,
      ["update", workingCopy],
      workingCopy,
    );
    assert.equal(fetchExternal.exitCode, 0, fetchExternal.stderr);
    const externalOpen = await service.openEdit({
      ...boundInput,
      targetPath: path.join(workingCopy, "ext", "ext.txt"),
    });
    assert.ok(!externalOpen.ok, "svn:externals 目标必须拒绝");
    if (!externalOpen.ok) {
      assert.equal(externalOpen.reason, "nestedOrExternal");
    }

    // 同仓库 file external：wc-root/UUID 与主 WC 相同，也必须拒绝。
    // 先建立正常版本化文件 file2.txt 并进入编辑，再把它转变为 file
    // external（内容字节不变），保存必须被拒绝——证明保存前 external
    // 状态变化同样被捕获。
    const file2 = path.join(workingCopy, "file2.txt");
    fs.writeFileSync(file2, "f2\n", "utf8");
    const addFile2 = await runSvnCommand(
      svnPath,
      ["add", "file2.txt"],
      workingCopy,
    );
    assert.equal(addFile2.exitCode, 0, addFile2.stderr);
    const commitFile2 = await runSvnCommand(
      svnPath,
      ["commit", "file2.txt", "-m", "add file2", "--encoding", "utf-8"],
      workingCopy,
    );
    assert.equal(commitFile2.exitCode, 0, commitFile2.stderr);
    const file2Open = await service.openEdit({
      ...boundInput,
      targetPath: file2,
      baseContents: "f2\n",
    });
    assert.ok(file2Open.ok, "正常文件应允许 openEdit");
    if (!file2Open.ok) return;
    const removeFile2 = await runSvnCommand(
      svnPath,
      ["rm", "file2.txt"],
      workingCopy,
    );
    assert.equal(removeFile2.exitCode, 0, removeFile2.stderr);
    const commitRemoval = await runSvnCommand(
      svnPath,
      ["commit", "file2.txt", "-m", "remove file2", "--encoding", "utf-8"],
      workingCopy,
    );
    assert.equal(commitRemoval.exitCode, 0, commitRemoval.stderr);
    const propsetFileExternals = await runSvnCommand(
      svnPath,
      [
        "propset",
        "svn:externals",
        "^/trunk/ext-src ext\n^/trunk/ext-src/ext.txt ext-file.txt\n^/trunk/file2.txt@2 file2.txt",
        workingCopy,
      ],
      workingCopy,
    );
    assert.equal(propsetFileExternals.exitCode, 0, propsetFileExternals.stderr);
    const fetchFileExternals = await runSvnCommand(
      svnPath,
      ["update", workingCopy],
      workingCopy,
    );
    assert.equal(fetchFileExternals.exitCode, 0, fetchFileExternals.stderr);
    const fileExternalOpen = await service.openEdit({
      ...boundInput,
      targetPath: path.join(workingCopy, "ext-file.txt"),
      baseContents: "ext\n",
    });
    assert.ok(!fileExternalOpen.ok, "同仓库 file external 必须拒绝");
    if (!fileExternalOpen.ok) {
      assert.equal(fileExternalOpen.reason, "nestedOrExternal");
    }
    // file2.txt 已变为 file external（内容字节不变）：保存必须拒绝且不落盘。
    assert.equal(fs.readFileSync(file2, "utf8"), "f2\n");
    const externalSave = await service.saveWorking({
      sessionId: "bind-session",
      moduleId: "diff",
      taskId: "diff/working",
      repositoryUuid: uuidProbe.repositoryUuid,
      scopeHash: "bind-scope",
      targetId: file2Open.targetId,
      editToken: file2Open.editToken,
      draftRevision: file2Open.draftRevision,
      expectedContentHash: file2Open.rawHash,
      content: "f2\nhijack\n",
      scope,
      repositoryRoot: workingCopy,
      probeSvnBinding: probe,
    });
    assert.ok(!externalSave.ok, "目标变为 file external 后必须拒绝保存");
    if (!externalSave.ok) {
      assert.equal(externalSave.reason, "scopeChanged");
    }
    assert.equal(
      fs.readFileSync(file2, "utf8"),
      "f2\n",
      "被拒绝的保存不得改动磁盘",
    );

    // BASE 变化但 working hash 未变：第二工作副本提交新内容后，本 WC
    // update（合并本地修改）再手动还原 working 内容为打开时字节。
    const checkout2 = await runSvnCommand(
      svnPath,
      ["checkout", repositoryUrl, secondCopy],
      tempRoot,
    );
    assert.equal(checkout2.exitCode, 0, checkout2.stderr);
    fs.writeFileSync(path.join(secondCopy, "file.txt"), "base-v2\n", "utf8");
    const commit2 = await runSvnCommand(
      svnPath,
      ["commit", secondCopy, "-m", "advance base", "--encoding", "utf-8"],
      secondCopy,
    );
    assert.equal(commit2.exitCode, 0, commit2.stderr);
    const updateTarget = await runSvnCommand(
      svnPath,
      ["update", target],
      workingCopy,
    );
    assert.equal(updateTarget.exitCode, 0, updateTarget.stderr);
    // 还原 working 为打开时内容（hash 与绑定一致，BASE 已前进）。
    fs.writeFileSync(target, "base\nlocal\n", "utf8");
    const staleBaseSave = await service.saveWorking({
      sessionId: "bind-session",
      moduleId: "diff",
      taskId: "diff/working",
      repositoryUuid: uuidProbe.repositoryUuid,
      scopeHash: "bind-scope",
      targetId: opened.targetId,
      editToken: opened.editToken,
      draftRevision: opened.draftRevision,
      expectedContentHash: opened.rawHash,
      content: "base\nlocal\nhijack\n",
      scope,
      repositoryRoot: workingCopy,
      probeSvnBinding: probe,
    });
    assert.ok(!staleBaseSave.ok, "BASE 变化后必须拒绝保存");
    if (!staleBaseSave.ok) {
      assert.equal(staleBaseSave.reason, "diskChanged");
    }
    assert.equal(
      fs.readFileSync(target, "utf8"),
      "base\nlocal\n",
      "被拒绝的保存不得改动磁盘",
    );
  } finally {
    removeTestTempDirectory(tempRoot);
  }
}

async function testGeneratedFilePolicy(): Promise<void> {
  assert.equal(classifyGeneratedFile("dist/app.js"), "exclude");
  assert.equal(classifyGeneratedFile("obj/Debug/net8.0/app.dll"), "exclude");
  assert.equal(classifyGeneratedFile("src/pages/order/debug.log"), "exclude");
  assert.equal(classifyGeneratedFile("bin/Debug/app.dll"), "exclude");
  assert.equal(classifyGeneratedFile("bin/deploy.sh"), "review");
  assert.equal(
    classifyGeneratedFile("src/pages/order/OrderList.vue"),
    "include",
  );
}

async function testFolderOperationScope(): Promise<void> {
  const workspace = getSvnWorkspaceOrSkip();
  const repositoryRoot = workspace.uri.fsPath;
  const selectedFolder = vscode.Uri.joinPath(
    workspace.uri,
    "src",
    "pages",
    "order",
  );
  const childFile = vscode.Uri.joinPath(selectedFolder, "OrderList.vue");
  const outOfScopeFile = vscode.Uri.joinPath(
    workspace.uri,
    "config",
    "app.json",
  );

  const scope = await createScopeFromExplorer(repositoryRoot, selectedFolder);
  assert.equal(scope.source, "explorerFolder");
  assert.equal(scope.allowExpandScope, false);
  assert.equal(scope.includeExternals, false);
  assert.equal(scope.includeNestedWorkingCopies, false);
  assert.equal(scope.roots.length, 1);
  assert.equal(scope.roots[0].kind, "folder");
  assert.equal(scope.roots[0].relativePath, path.join("src", "pages", "order"));

  const result = validatePathsInScope(
    scope,
    [childFile.fsPath, outOfScopeFile.fsPath],
    fixtureSemantics,
  );
  assert.deepEqual(result.validItems, [path.resolve(childFile.fsPath)]);
  assert.deepEqual(result.outOfScopeItems, [
    path.resolve(outOfScopeFile.fsPath),
  ]);
}

async function testParentChildScopeMerge(): Promise<void> {
  const workspace = getSvnWorkspaceOrSkip();
  const repositoryRoot = workspace.uri.fsPath;
  const selectedFolder = vscode.Uri.joinPath(
    workspace.uri,
    "src",
    "pages",
    "order",
  );
  const childFile = vscode.Uri.joinPath(selectedFolder, "OrderList.vue");

  const scope = await createScopeFromExplorer(repositoryRoot, selectedFolder, [
    selectedFolder,
    childFile,
  ]);
  assert.equal(scope.source, "explorerMultiSelection");
  assert.equal(scope.roots.length, 1);
  assert.equal(scope.roots[0].kind, "folder");
  assert.equal(scope.roots[0].relativePath, path.join("src", "pages", "order"));
}

async function testMixedWorkingCopyResolution(): Promise<void> {
  const workspace = getSvnWorkspaceOrSkip();
  const svnPath = await getSvnPathOrSkip();
  const secondWorkingCopy = path.join(
    path.dirname(workspace.uri.fsPath),
    "remote-wc",
  );
  if (!fs.existsSync(path.join(secondWorkingCopy, ".svn"))) {
    throw new SkippedTest(
      "The isolated second SVN working copy is not available.",
    );
  }
  const single = await resolveWorkingCopySet(svnPath, [workspace.uri.fsPath]);
  assert.equal(single.mixed, false);
  assert.equal(single.invalidTargets.length, 0);
  assert.equal(
    normalizeTestPath(single.root!, fixtureSemantics),
    normalizeTestPath(workspace.uri.fsPath, fixtureSemantics),
  );

  const mixed = await resolveWorkingCopySet(svnPath, [
    workspace.uri.fsPath,
    secondWorkingCopy,
  ]);
  assert.equal(mixed.mixed, true);
  assert.equal(mixed.root, undefined);
  assert.equal(mixed.roots.length, 2);

  const missingCli = await resolveWorkingCopySet(
    path.join(workspace.uri.fsPath, "missing-svn-executable"),
    [workspace.uri.fsPath],
  );
  assert.equal(
    normalizeTestPath(missingCli.root!, fixtureSemantics),
    normalizeTestPath(workspace.uri.fsPath, fixtureSemantics),
  );
  assert.equal(missingCli.invalidTargets.length, 0);
}

async function testRootCommitCandidates(): Promise<void> {
  const workspace = getSvnWorkspaceOrSkip();
  const svnPath = await getSvnPathOrSkip();
  const scope = await createScopeFromExplorer(
    workspace.uri.fsPath,
    workspace.uri,
  );
  const candidates = await collectCommitCandidates(svnPath, scope);

  assert.ok(candidates.length >= 5);

  const missingReadme = candidates.find(
    (candidate) => candidate.relativePath === "docs/readme.md",
  );
  assert.ok(missingReadme);
  assert.equal(missingReadme.status, "missing");
  assert.equal(missingReadme.selection, "needsReview");
  assert.equal(missingReadme.templateGroup, "document");

  const dist = candidates.find(
    (candidate) => candidate.relativePath === "dist",
  );
  assert.ok(dist);
  assert.equal(dist.generatedDecision, "exclude");
  assert.equal(dist.selection, "excluded");

  const debugLog = candidates.find(
    (candidate) => candidate.relativePath === "src/pages/order/debug.log",
  );
  assert.ok(debugLog);
  assert.equal(debugLog.fileType, "log");
  assert.equal(debugLog.generatedDecision, "exclude");
  assert.equal(debugLog.selection, "excluded");

  const specialPath = candidates.find(
    (candidate) => candidate.relativePath === "特殊 路径/订单(#1).ts",
  );
  assert.ok(specialPath);
  assert.equal(specialPath.status, "modified");
}

async function testFolderCommitCandidates(): Promise<void> {
  const workspace = getSvnWorkspaceOrSkip();
  const svnPath = await getSvnPathOrSkip();
  const selectedFolder = vscode.Uri.joinPath(
    workspace.uri,
    "src",
    "pages",
    "order",
  );
  const scope = await createScopeFromExplorer(
    workspace.uri.fsPath,
    selectedFolder,
  );
  const candidates = await collectCommitCandidates(svnPath, scope);

  assert.ok(candidates.length > 0);
  assert.ok(
    candidates.some(
      (candidate) => candidate.relativePath === "src/pages/order/debug.log",
    ),
  );
  assert.ok(
    candidates.every((candidate) =>
      candidate.relativePath.startsWith("src/pages/order/"),
    ),
    "Folder candidate collection must not expand beyond the selected folder.",
  );
}

async function testAiMockScopeGuard(): Promise<void> {
  const workspace = getSvnWorkspaceOrSkip();
  const svnPath = await getSvnPathOrSkip();
  const selectedFolder = vscode.Uri.joinPath(
    workspace.uri,
    "src",
    "pages",
    "order",
  );
  const scope = await createScopeFromExplorer(
    workspace.uri.fsPath,
    selectedFolder,
  );
  const candidates = await collectCommitCandidates(svnPath, scope);
  const raw = createMockAiSelection(scope, candidates);
  const validated = validateAiSelectionResult(scope, raw);

  assert.equal(countAiSelection(raw), countAiSelection(validated) + 1);
}

async function testCommitSelectionAiRequest(): Promise<void> {
  const workspace = getSvnWorkspaceOrSkip();
  const svnPath = await getSvnPathOrSkip();
  const scope = await createScopeFromExplorer(
    workspace.uri.fsPath,
    workspace.uri,
  );
  const candidates = await collectCommitCandidates(svnPath, scope);
  const request = buildCommitSelectionAiRequest(scope, candidates);

  assert.equal(request.locale, "zh-CN");
  assert.equal(request.policy?.rightClickScopeOnly, true);
  assert.ok(request.files.length > 0);

  const debugLog = request.files.find(
    (file) => file.path === "src/pages/order/debug.log",
  );
  assert.ok(debugLog);
  assert.equal(debugLog.generatedDecision, "exclude");
  assert.equal(debugLog.defaultSelection, "excluded");
}

async function testCommitSelectionAiFallback(): Promise<void> {
  const workspace = getSvnWorkspaceOrSkip();
  const svnPath = await getSvnPathOrSkip();
  const scope = await createScopeFromExplorer(
    workspace.uri.fsPath,
    workspace.uri,
  );
  const candidates = await collectCommitCandidates(svnPath, scope);
  const result = createLocalCommitSelectionResult(candidates);

  const debugLog = candidates.find(
    (candidate) => candidate.relativePath === "src/pages/order/debug.log",
  );
  assert.ok(debugLog);
  assert.ok(
    result.excluded.some(
      (item) => path.resolve(item.path) === path.resolve(debugLog.absolutePath),
    ),
  );

  const missingReadme = candidates.find(
    (candidate) => candidate.relativePath === "docs/readme.md",
  );
  assert.ok(missingReadme);
  assert.ok(
    result.needsReview.some(
      (item) =>
        path.resolve(item.path) === path.resolve(missingReadme.absolutePath),
    ),
  );
}

async function testCommitSelectionAiCandidateGuard(): Promise<void> {
  const workspace = getSvnWorkspaceOrSkip();
  const svnPath = await getSvnPathOrSkip();
  const scope = await createScopeFromExplorer(
    workspace.uri.fsPath,
    workspace.uri,
  );
  const candidates = await collectCommitCandidates(svnPath, scope);
  const missingReadme = candidates.find(
    (candidate) => candidate.relativePath === "docs/readme.md",
  );
  assert.ok(missingReadme);

  const validated = validateAiSelectionResult(
    scope,
    {
      recommended: [
        { path: "docs/readme.md", reason: "真实候选" },
        { path: "src/invented.ts", reason: "模型虚构的范围内文件" },
        {
          path: path.resolve(workspace.uri.fsPath, "..", "outside.txt"),
          reason: "范围外文件",
        },
      ],
      excluded: [],
      needsReview: [],
      blocked: [],
    },
    candidates.map((candidate) => candidate.absolutePath),
  );

  assert.deepEqual(
    validated.recommended.map((item) =>
      normalizeTestPath(item.path, fixtureSemantics),
    ),
    [normalizeTestPath(missingReadme.absolutePath, fixtureSemantics)],
  );
}

async function testCommitSelectionAiExplanation(): Promise<void> {
  const workspace = getSvnWorkspaceOrSkip();
  const svnPath = await getSvnPathOrSkip();
  const scope = await createScopeFromExplorer(
    workspace.uri.fsPath,
    workspace.uri,
  );
  const candidates = await collectCommitCandidates(svnPath, scope);
  const missingReadme = candidates.find(
    (candidate) => candidate.relativePath === "docs/readme.md",
  );
  const debugLog = candidates.find(
    (candidate) => candidate.relativePath === "src/pages/order/debug.log",
  );
  assert.ok(missingReadme);
  assert.ok(debugLog);

  const explanation = buildCommitSelectionExplanation(candidates, {
    recommended: [
      { path: missingReadme.absolutePath, reason: "文档删除需要提交" },
    ],
    needsReview: [],
    excluded: [{ path: debugLog.absolutePath, reason: "日志文件默认排除" }],
    blocked: [],
  });

  const missingItem = explanation.items.find(
    (item) => item.relativePath === "docs/readme.md",
  );
  const debugItem = explanation.items.find(
    (item) => item.relativePath === "src/pages/order/debug.log",
  );
  assert.equal(missingItem?.decision, "recommended");
  assert.equal(missingItem?.selectedByAi, true);
  assert.equal(debugItem?.decision, "excluded");
  assert.equal(debugItem?.reason, "日志文件默认排除");
  assert.equal(explanation.summary.recommended, 1);
  assert.equal(explanation.summary.excluded, 1);
}

async function testCommitSelectionAiExplanationNone(): Promise<void> {
  const workspace = getSvnWorkspaceOrSkip();
  const svnPath = await getSvnPathOrSkip();
  const scope = await createScopeFromExplorer(
    workspace.uri.fsPath,
    workspace.uri,
  );
  const candidates = await collectCommitCandidates(svnPath, scope);
  const explanation = buildCommitSelectionExplanation(candidates, {
    recommended: [],
    needsReview: [],
    excluded: [],
    blocked: [],
  });

  assert.equal(explanation.items.length, candidates.length);
  assert.equal(explanation.summary.none, candidates.length);
  assert.equal(
    explanation.items.every((item) => item.decision === "none"),
    true,
  );
}

async function testCommitSelectionAiRecommendedPaths(): Promise<void> {
  const candidates = createCommitSelectionActionCandidates();
  const explanation = buildCommitSelectionExplanation(candidates, {
    recommended: [
      { path: candidates[0].absolutePath, reason: "业务代码应提交" },
      { path: candidates[2].absolutePath, reason: "模型误判生成物" },
    ],
    needsReview: [],
    excluded: [],
    blocked: [],
  });

  assert.deepEqual(getAiRecommendedCandidatePaths(candidates, explanation), [
    candidates[0].absolutePath,
  ]);
}

async function testCommitSelectionAiDecisionFilter(): Promise<void> {
  const candidates = createCommitSelectionActionCandidates();
  const explanation = buildCommitSelectionExplanation(candidates, {
    recommended: [
      { path: candidates[0].absolutePath, reason: "业务代码应提交" },
    ],
    needsReview: [
      { path: candidates[1].absolutePath, reason: "新增配置需确认" },
    ],
    excluded: [{ path: candidates[2].absolutePath, reason: "生成物排除" }],
    blocked: [],
  });

  assert.deepEqual(
    filterCandidatesByAiDecision(candidates, explanation, "needsReview").map(
      (candidate) => candidate.relativePath,
    ),
    ["config/app.json"],
  );
  assert.deepEqual(
    filterCandidatesByAiDecision(candidates, explanation, "none").map(
      (candidate) => candidate.relativePath,
    ),
    ["src/order.conflicted"],
  );
  assert.equal(
    filterCandidatesByAiDecision(candidates, explanation, "all").length,
    candidates.length,
  );
}

async function testCommitCandidateCurrentFilters(): Promise<void> {
  const candidates = createCommitSelectionActionCandidates();
  const decisions = new Map<
    string,
    "recommended" | "needsReview" | "excluded" | "blocked" | "none"
  >([
    [candidates[0].absolutePath, "recommended"],
    [candidates[1].absolutePath, "needsReview"],
    [candidates[2].absolutePath, "excluded"],
    [candidates[3].absolutePath, "blocked"],
  ]);

  assert.deepEqual(
    filterCommitCandidates(candidates, {
      status: "unversioned",
      fileType: "json",
      templateGroup: "config",
      hideGenerated: true,
      aiDecision: "needsReview",
      getAiDecision: (candidate) =>
        decisions.get(candidate.absolutePath) ?? "none",
    }).map((candidate) => candidate.relativePath),
    ["config/app.json"],
  );

  assert.deepEqual(
    filterCommitCandidates(candidates, {
      search: "ORDER",
      hideGenerated: false,
    }).map((candidate) => candidate.relativePath),
    ["src/order.ts", "src/order.conflicted"],
  );

  assert.deepEqual(
    filterCommitCandidates(candidates, {
      hideGenerated: true,
    }).map((candidate) => candidate.relativePath),
    ["src/order.ts", "config/app.json", "src/order.conflicted"],
  );
}

async function testCommitCandidateFilteredSelectablePaths(): Promise<void> {
  const candidates = createCommitSelectionActionCandidates();
  const visible = filterCommitCandidates(candidates, {
    search: "order",
    hideGenerated: false,
  });

  assert.deepEqual(getSelectableCommitCandidatePaths(visible), [
    candidates[0].absolutePath,
  ]);
}

async function testCommitCandidateFilterPresets(): Promise<void> {
  const candidates = [
    ...createCommitCandidateGroupingCandidates(),
    ...createCommitSelectionActionCandidates(),
  ];
  const presets = getCommitCandidateFilterPresets();
  const frontendPreset = resolveCommitCandidateFilterPreset("frontend");
  const aiRecommendedPreset =
    resolveCommitCandidateFilterPreset("aiRecommended");

  assert.ok(presets.some((preset) => preset.id === "frontend"));
  assert.ok(frontendPreset);
  assert.ok(aiRecommendedPreset);

  assert.deepEqual(
    filterCommitCandidates(candidates, frontendPreset.filters).map(
      (candidate) => candidate.relativePath,
    ),
    [
      "src/pages/order/OrderList.vue",
      "src/pages/user/UserList.vue",
      "src/order.ts",
    ],
  );

  const recommended = new Set([
    candidates[0].absolutePath,
    candidates[3].absolutePath,
  ]);
  assert.deepEqual(
    filterCommitCandidates(candidates, {
      ...aiRecommendedPreset.filters,
      getAiDecision: (candidate) =>
        recommended.has(candidate.absolutePath) ? "recommended" : "none",
    }).map((candidate) => candidate.relativePath),
    ["src/pages/order/OrderList.vue", "src/order.ts"],
  );

  frontendPreset.filters.templateGroup = "config";
  assert.equal(
    resolveCommitCandidateFilterPreset("frontend")?.filters.templateGroup,
    "frontend",
  );
}

async function testCommitCandidateFilterPresetMatchSummary(): Promise<void> {
  const candidates = [
    ...createCommitCandidateGroupingCandidates(),
    ...createCommitSelectionActionCandidates(),
  ];
  const presets = getCommitCandidateFilterPresets();
  const recommended = new Set([
    candidates[0].absolutePath,
    candidates[2].absolutePath,
  ]);
  const summaries = summarizeCommitCandidateFilterPresetMatches(
    candidates,
    presets,
    (candidate) =>
      recommended.has(candidate.absolutePath) ? "recommended" : "none",
  );
  const frontend = summaries.find((summary) => summary.id === "frontend");
  const document = summaries.find((summary) => summary.id === "document");
  const aiRecommended = summaries.find(
    (summary) => summary.id === "aiRecommended",
  );

  assert.ok(frontend);
  assert.equal(frontend.total, 3);
  assert.equal(frontend.selectable, 3);
  assert.ok(document);
  assert.equal(document.total, 1);
  assert.equal(document.selectable, 1);
  assert.ok(aiRecommended);
  assert.equal(aiRecommended.total, 2);
  assert.equal(aiRecommended.selectable, 2);
}

async function testRepositoryCommitCandidateFilterPresetParsing(): Promise<void> {
  const parsed = parseRepositoryCommitCandidateFilterPresets(
    JSON.stringify({
      commitCandidateFilterPresets: [
        {
          id: "teamConfig",
          label: "团队配置",
          description: "只看团队配置变更",
          filters: {
            templateGroup: "config",
            fileType: "json",
            status: "unversioned",
            hideGenerated: true,
            aiDecision: "needsReview",
          },
        },
        {
          id: "frontend",
          label: "重复内置",
          filters: {
            templateGroup: "frontend",
          },
        },
        {
          id: "bad id!",
          label: "非法 ID",
          filters: {},
        },
      ],
    }),
  );

  assert.deepEqual(
    parsed.presets.map((preset) => preset.id),
    ["teamConfig"],
  );
  assert.equal(parsed.presets[0].filters.templateGroup, "config");
  assert.equal(parsed.presets[0].filters.fileType, "json");
  assert.equal(parsed.presets[0].filters.status, "unversioned");
  assert.equal(parsed.presets[0].filters.aiDecision, "needsReview");
  assert.equal(parsed.warnings.length, 2);

  const merged = getCommitCandidateFilterPresets(parsed.presets);
  assert.ok(merged.some((preset) => preset.id === "frontend"));
  assert.ok(merged.some((preset) => preset.id === "teamConfig"));
}

async function testRepositoryCommitCandidateFilterPresetReading(): Promise<void> {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "svn-workbench-filter-presets-"),
  );
  try {
    fs.writeFileSync(
      path.join(tempRoot, SVN_WORKBENCH_CONFIG_FILE),
      JSON.stringify({
        commitCandidateFilterPresets: [
          {
            id: "teamDocs",
            label: "团队文档",
            filters: {
              templateGroup: "document",
              search: "docs/",
              hideGenerated: true,
            },
          },
        ],
      }),
      "utf8",
    );

    const resolution =
      await readRepositoryCommitCandidateFilterPresets(tempRoot);
    assert.equal(
      path.basename(resolution.configPath),
      SVN_WORKBENCH_CONFIG_FILE,
    );
    assert.deepEqual(
      resolution.presets.map((preset) => preset.id),
      ["teamDocs"],
    );
    assert.equal(resolution.warnings.length, 0);
  } finally {
    removeTestTempDirectory(tempRoot);
  }
}

async function testCommitSelectionDefaultSelectedPaths(): Promise<void> {
  const candidates = createCommitSelectionActionCandidates();

  assert.deepEqual(getDefaultSelectedCandidatePaths(candidates), [
    candidates[0].absolutePath,
  ]);
}

async function testCommitCandidateModuleGrouping(): Promise<void> {
  const candidates = createCommitCandidateGroupingCandidates();
  const groups = groupCommitCandidates(candidates, { mode: "module" });

  assert.equal(inferCommitCandidateModuleGroup("README.md"), "repository-root");
  assert.deepEqual(
    groups.map((group) => group.label),
    ["docs", "src/pages/order", "src/pages/user"],
  );
}

async function testCommitCandidateAiDecisionGrouping(): Promise<void> {
  const candidates = createCommitSelectionActionCandidates();
  const decisions = new Map<
    string,
    "recommended" | "needsReview" | "excluded" | "none"
  >([
    [candidates[0].absolutePath, "recommended"],
    [candidates[1].absolutePath, "needsReview"],
    [candidates[2].absolutePath, "excluded"],
    [candidates[3].absolutePath, "none"],
  ]);
  const groups = groupCommitCandidates(candidates, {
    mode: "aiDecision",
    getAiDecision: (candidate) =>
      decisions.get(candidate.absolutePath) ?? "none",
  });

  assert.deepEqual(
    groups.map((group) => group.key),
    ["recommended", "needsReview", "excluded", "none"],
  );
}

async function testCommitCandidateGroupSummary(): Promise<void> {
  const candidates = createCommitSelectionActionCandidates();
  const [group] = groupCommitCandidates(candidates, { mode: "none" });

  assert.equal(group.total, 4);
  assert.equal(group.defaultSelected, 1);
  assert.equal(group.needsReview, 1);
  assert.equal(group.excluded, 1);
  assert.equal(group.blocked, 1);
}

async function testCommitCandidateGroupSelectablePaths(): Promise<void> {
  const candidates = createCommitSelectionActionCandidates();
  const [group] = groupCommitCandidates(candidates, { mode: "none" });

  assert.deepEqual(getGroupSelectableCandidatePaths(group), [
    candidates[0].absolutePath,
    candidates[1].absolutePath,
  ]);
}

async function testCommitSplitAiRequest(): Promise<void> {
  const candidates = createCommitCandidateGroupingCandidates();
  const scope = createTestOperationScope(
    path.join(os.tmpdir(), "svn-workbench-candidate-grouping"),
  );
  const request = buildCommitSplitAiRequest(
    scope,
    candidates,
    candidates.map((candidate) => candidate.absolutePath),
  );

  assert.equal(request.locale, "zh-CN");
  assert.equal(request.selectedFileCount, 3);
  assert.equal(request.policy.noAutoCommit, true);
  assert.ok(
    request.files.some(
      (file) =>
        file.path === "src/pages/order/OrderList.vue" &&
        file.moduleGroup === "src/pages/order",
    ),
  );
}

async function testCommitSplitAiLocalSuggestion(): Promise<void> {
  const candidates = createCommitCandidateGroupingCandidates();
  const scope = createTestOperationScope(
    path.join(os.tmpdir(), "svn-workbench-candidate-grouping"),
  );
  const request = buildCommitSplitAiRequest(
    scope,
    candidates,
    candidates.map((candidate) => candidate.absolutePath),
  );
  const result = createLocalCommitSplitResult(request);

  assert.equal(result.splits.length, 3);
  assert.ok(
    result.splits.some((split) => split.title.includes("src/pages/order")),
  );
  assert.ok(
    result.splits.some((split) =>
      split.risks.some((risk) => risk.includes("删除")),
    ),
  );
}

async function testCommitSplitAiValidation(): Promise<void> {
  const candidates = createCommitCandidateGroupingCandidates();
  const scope = createTestOperationScope(
    path.join(os.tmpdir(), "svn-workbench-candidate-grouping"),
  );
  const result = validateCommitSplitResult(
    scope,
    {
      splits: [
        {
          id: "split-1",
          title: "业务拆分",
          summary: "测试",
          message: "变更：测试",
          paths: [
            candidates[0].absolutePath,
            candidates[0].absolutePath,
            candidates[1].relativePath,
            "src/invented.ts",
            path.join(scope.repositoryRoot, "..", "outside.ts"),
          ],
          reason: "测试",
          risks: [],
        },
      ],
      warnings: [],
    },
    candidates.map((candidate) => candidate.absolutePath),
  );

  assert.deepEqual(
    result.splits[0].paths.map((filePath) =>
      normalizeTestPath(filePath, fixtureSemantics),
    ),
    [
      normalizeTestPath(candidates[0].absolutePath, fixtureSemantics),
      normalizeTestPath(candidates[1].absolutePath, fixtureSemantics),
    ],
  );
}

async function testCommitSplitPlanPreview(): Promise<void> {
  const candidates = createCommitCandidateGroupingCandidates();
  const scope = createTestOperationScope(
    path.join(os.tmpdir(), "svn-workbench-candidate-grouping"),
  );
  const preview = buildCommitSplitPlanPreview(scope, candidates, {
    id: "split-docs",
    title: "文档删除",
    summary: "docs，1 个文件",
    message: "docs: 删除过期文档",
    paths: [candidates[2].absolutePath],
    reason: "按文档拆分",
    risks: ["包含删除文件"],
  });

  assert.equal(preview.preview.canCommit, true);
  assert.deepEqual(preview.preview.removePaths, [
    path.resolve(candidates[2].absolutePath),
  ]);
  assert.equal(preview.message, "docs: 删除过期文档");
  assert.deepEqual(preview.risks, ["包含删除文件"]);
}

async function testCommitSplitQueueManagement(): Promise<void> {
  const first = {
    id: "split-1",
    title: "订单模块",
    summary: "订单模块变更",
    message: "feat(order): 整理订单模块",
    paths: ["src/pages/order/OrderList.vue"],
    reason: "按模块拆分",
    risks: [],
  };
  const duplicate = {
    ...first,
    id: "split-duplicate",
  };
  const second = {
    id: "split-2",
    title: "用户模块",
    summary: "用户模块变更",
    message: "feat(user): 整理用户模块",
    paths: ["src/pages/user/UserList.vue"],
    reason: "按模块拆分",
    risks: [],
  };

  const queued = addCommitSplitToQueue(
    addCommitSplitToQueue(addCommitSplitToQueue([], first, 1), duplicate, 2),
    second,
    3,
  );
  assert.equal(queued.length, 2);
  assert.equal(queued[0].status, "pending");

  const applied = markCommitSplitQueueItemApplied(queued, "split-1");
  assert.equal(applied[0].status, "applied");
  assert.equal(applied[1].status, "pending");

  const removed = removeCommitSplitFromQueue(applied, "split-1");
  assert.deepEqual(
    removed.map((item) => item.id),
    ["split-2"],
  );
}

async function testCommitSplitQueueBulkAdd(): Promise<void> {
  const first = {
    id: "split-1",
    title: "订单模块",
    summary: "订单模块变更",
    message: "feat(order): 整理订单模块",
    paths: ["src/pages/order/OrderList.vue"],
    reason: "按模块拆分",
    risks: [],
  };
  const duplicate = {
    ...first,
    id: "split-duplicate",
  };
  const second = {
    id: "split-2",
    title: "用户模块",
    summary: "用户模块变更",
    message: "feat(user): 整理用户模块",
    paths: ["src/pages/user/UserList.vue"],
    reason: "按模块拆分",
    risks: [],
  };
  const empty = {
    id: "split-empty",
    title: "空建议",
    summary: "",
    message: "",
    paths: [],
    reason: "",
    risks: [],
  };

  const result = addCommitSplitsToQueue(
    addCommitSplitToQueue([], first, 1),
    [duplicate, second, empty],
    10,
  );
  assert.equal(result.added, 1);
  assert.deepEqual(result.addedIds, ["split-2"]);
  assert.equal(result.skippedDuplicate, 1);
  assert.equal(result.skippedEmpty, 1);
  assert.deepEqual(
    result.queue.map((item) => item.id),
    ["split-1", "split-2"],
  );
  assert.equal(result.queue[1].addedAt, 11);
}

async function testCommitSplitQueuePreviewStatus(): Promise<void> {
  const candidates = createCommitCandidateGroupingCandidates();
  const scope = createTestOperationScope(
    path.join(os.tmpdir(), "svn-workbench-candidate-grouping"),
  );
  const suggestion = {
    id: "split-docs",
    title: "文档删除",
    summary: "docs，1 个文件",
    message: "docs: 删除过期文档",
    paths: [candidates[2].absolutePath],
    reason: "按文档拆分",
    risks: [],
  };
  const queue = addCommitSplitToQueue([], suggestion, 1);
  const readyPreview = buildCommitSplitPlanPreview(
    scope,
    candidates,
    suggestion,
  );
  const readyQueue = updateCommitSplitQueueItemPreviewStatus(
    queue,
    readyPreview,
  );

  assert.equal(readyQueue[0].planStatus, "ready");
  assert.equal(readyQueue[0].lastPreviewIssueCount, 0);

  const blockedPreview = buildCommitSplitPlanPreview(scope, candidates, {
    ...suggestion,
    paths: [path.join(scope.repositoryRoot, "src", "invented.ts")],
  });
  const blockedQueue = updateCommitSplitQueueItemPreviewStatus(
    queue,
    blockedPreview,
  );
  assert.equal(blockedQueue[0].planStatus, "blocked");
  assert.equal(blockedQueue[0].lastPreviewIssueCount, 1);
  assert.deepEqual(blockedQueue[0].lastPreviewIssues, [
    {
      path: path.join(scope.repositoryRoot, "src", "invented.ts"),
      reason: "文件不在当前 SVN 候选列表中，已阻止。",
    },
  ]);
}

async function testCommitSplitQueueApplyGuard(): Promise<void> {
  const candidates = createCommitCandidateGroupingCandidates();
  const scope = createTestOperationScope(
    path.join(os.tmpdir(), "svn-workbench-candidate-grouping"),
  );
  const suggestion = {
    id: "split-docs",
    title: "docs cleanup",
    summary: "remove stale docs",
    message: "docs: remove stale docs",
    paths: [candidates[2].absolutePath],
    reason: "split by documentation change",
    risks: [],
  };

  const queue = addCommitSplitToQueue([], suggestion, 1);
  const notPreviewed = canApplyCommitSplitQueueItem(queue[0]);
  assert.equal(notPreviewed.allowed, false);
  assert.equal(notPreviewed.reason, "notPreviewed");

  const readyPreview = buildCommitSplitPlanPreview(
    scope,
    candidates,
    suggestion,
  );
  const readyQueue = updateCommitSplitQueueItemPreviewStatus(
    queue,
    readyPreview,
  );
  const ready = canApplyCommitSplitQueueItem(readyQueue[0]);
  assert.equal(ready.allowed, true);

  const blockedPreview = buildCommitSplitPlanPreview(scope, candidates, {
    ...suggestion,
    paths: [path.join(scope.repositoryRoot, "src", "invented.ts")],
  });
  const blockedQueue = updateCommitSplitQueueItemPreviewStatus(
    queue,
    blockedPreview,
  );
  const blocked = canApplyCommitSplitQueueItem(blockedQueue[0]);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, "blocked");
}

async function testCommitSplitQueueSubmissionLifecycle(): Promise<void> {
  const candidates = createCommitCandidateGroupingCandidates();
  const scope = createTestOperationScope(
    path.join(os.tmpdir(), "svn-workbench-candidate-grouping"),
  );
  const suggestion = {
    id: "split-docs",
    title: "docs cleanup",
    summary: "remove stale docs",
    message: "docs: remove stale docs",
    paths: [candidates[2].absolutePath],
    reason: "split by documentation change",
    risks: [],
  };

  const queue = addCommitSplitToQueue([], suggestion, 1);
  const readyPreview = buildCommitSplitPlanPreview(
    scope,
    candidates,
    suggestion,
  );
  const readyQueue = updateCommitSplitQueueItemPreviewStatus(
    queue,
    readyPreview,
  );
  const submittingQueue = markCommitSplitQueueItemSubmitting(
    readyQueue,
    "split-docs",
  );

  assert.equal(submittingQueue[0].status, "submitting");
  assert.equal(
    canApplyCommitSplitQueueItem(submittingQueue[0]).reason,
    "submitting",
  );

  const completedQueue = markCommitSplitQueueItemSubmissionResult(
    submittingQueue,
    "split-docs",
    {
      ok: true,
      revision: "42",
    },
    10,
  );
  assert.equal(completedQueue[0].status, "completed");
  assert.equal(completedQueue[0].revision, "42");
  assert.equal(completedQueue[0].completedAt, 10);
  assert.equal(
    canApplyCommitSplitQueueItem(completedQueue[0]).reason,
    "completed",
  );

  const failedQueue = markCommitSplitQueueItemSubmissionResult(
    readyQueue,
    "split-docs",
    {
      ok: false,
      message: "remote has updates",
    },
    11,
  );
  assert.equal(failedQueue[0].status, "failed");
  assert.equal(failedQueue[0].lastSubmissionError, "remote has updates");

  const refreshedQueue = refreshCommitSplitQueueAfterCommit(failedQueue);
  assert.equal(refreshedQueue[0].status, "failed");
  assert.equal(refreshedQueue[0].planStatus, "notPreviewed");
  assert.equal(refreshedQueue[0].lastPreviewIssueCount, undefined);
  assert.equal(refreshedQueue[0].lastPreviewIssues, undefined);
}

async function testCommitSplitQueueDedicatedSubmitGuard(): Promise<void> {
  const candidates = createCommitCandidateGroupingCandidates();
  const scope = createTestOperationScope(
    path.join(os.tmpdir(), "svn-workbench-candidate-grouping"),
  );
  const suggestion = {
    id: "split-docs",
    title: "docs cleanup",
    summary: "remove stale docs",
    message: "docs: remove stale docs",
    paths: [candidates[2].absolutePath],
    reason: "split by documentation change",
    risks: [],
  };

  const queue = addCommitSplitToQueue([], suggestion, 1);
  const notPreviewed = canSubmitCommitSplitQueueItem(queue[0]);
  assert.equal(notPreviewed.allowed, false);
  assert.equal(notPreviewed.reason, "notPreviewed");

  const readyQueue = updateCommitSplitQueueItemPreviewStatus(
    queue,
    buildCommitSplitPlanPreview(scope, candidates, suggestion),
  );
  const ready = canSubmitCommitSplitQueueItem(readyQueue[0]);
  assert.equal(ready.allowed, true);

  const submittingQueue = markCommitSplitQueueItemSubmitting(
    readyQueue,
    "split-docs",
  );
  const submitting = canSubmitCommitSplitQueueItem(submittingQueue[0]);
  assert.equal(submitting.allowed, false);
  assert.equal(submitting.reason, "submitting");

  const completedQueue = markCommitSplitQueueItemSubmissionResult(
    readyQueue,
    "split-docs",
    {
      ok: true,
      revision: "43",
    },
    12,
  );
  const completed = canSubmitCommitSplitQueueItem(completedQueue[0]);
  assert.equal(completed.allowed, false);
  assert.equal(completed.reason, "completed");
}

async function testCommitSplitQueueFirstSubmittableItem(): Promise<void> {
  const candidates = createCommitCandidateGroupingCandidates();
  const scope = createTestOperationScope(
    path.join(os.tmpdir(), "svn-workbench-candidate-grouping"),
  );
  const first = {
    id: "split-first",
    title: "first",
    summary: "first change",
    message: "feat: first",
    paths: [candidates[0].absolutePath],
    reason: "first",
    risks: [],
  };
  const second = {
    id: "split-second",
    title: "second",
    summary: "second change",
    message: "fix: second",
    paths: [candidates[1].absolutePath],
    reason: "second",
    risks: [],
  };
  const third = {
    id: "split-third",
    title: "third",
    summary: "third change",
    message: "docs: third",
    paths: [candidates[2].absolutePath],
    reason: "third",
    risks: [],
  };

  let queue = addCommitSplitToQueue(
    addCommitSplitToQueue(addCommitSplitToQueue([], first, 1), second, 2),
    third,
    3,
  );
  queue = updateCommitSplitQueueItemPreviewStatus(
    queue,
    buildCommitSplitPlanPreview(scope, candidates, first),
  );
  queue = updateCommitSplitQueueItemPreviewStatus(
    queue,
    buildCommitSplitPlanPreview(scope, candidates, second),
  );
  queue = updateCommitSplitQueueItemPreviewStatus(
    queue,
    buildCommitSplitPlanPreview(scope, candidates, third),
  );
  queue = markCommitSplitQueueItemSubmitting(queue, "split-first");
  queue = markCommitSplitQueueItemSubmissionResult(
    queue,
    "split-second",
    { ok: true, revision: "44" },
    10,
  );

  assert.equal(
    getFirstSubmittableCommitSplitQueueItem(queue)?.id,
    "split-third",
  );
  assert.equal(
    getNextSubmittableCommitSplitQueueItem(queue, "split-second")?.id,
    "split-third",
  );
  assert.equal(
    getNextSubmittableCommitSplitQueueItem(queue, "split-third"),
    undefined,
  );
  assert.equal(
    getNextSubmittableCommitSplitQueueItem(queue, "missing")?.id,
    "split-third",
  );
}

async function testCommitSplitQueueFirstRetryableFailedItem(): Promise<void> {
  const candidates = createCommitCandidateGroupingCandidates();
  const scope = createTestOperationScope(
    path.join(os.tmpdir(), "svn-workbench-candidate-grouping"),
  );
  const first = {
    id: "split-first",
    title: "first",
    summary: "first change",
    message: "feat: first",
    paths: [candidates[0].absolutePath],
    reason: "first",
    risks: [],
  };
  const second = {
    id: "split-second",
    title: "second",
    summary: "second change",
    message: "fix: second",
    paths: [candidates[1].absolutePath],
    reason: "second",
    risks: [],
  };
  const third = {
    id: "split-third",
    title: "third",
    summary: "third change",
    message: "docs: third",
    paths: [candidates[2].absolutePath],
    reason: "third",
    risks: [],
  };

  let queue = addCommitSplitToQueue(
    addCommitSplitToQueue(addCommitSplitToQueue([], first, 1), second, 2),
    third,
    3,
  );
  queue = markCommitSplitQueueItemSubmissionResult(
    queue,
    "split-first",
    { ok: false, message: "failed before preview" },
    4,
  );
  queue = updateCommitSplitQueueItemPreviewStatus(
    queue,
    buildCommitSplitPlanPreview(scope, candidates, second),
  );
  queue = markCommitSplitQueueItemSubmissionResult(
    queue,
    "split-second",
    { ok: false, message: "network changed" },
    5,
  );
  queue = updateCommitSplitQueueItemPreviewStatus(
    queue,
    buildCommitSplitPlanPreview(scope, candidates, third),
  );
  queue = markCommitSplitQueueItemSubmissionResult(
    queue,
    "split-third",
    { ok: true, revision: "50" },
    6,
  );

  assert.equal(
    getFirstRetryableCommitSplitQueueItem(queue)?.id,
    "split-second",
  );
}

async function testCommitSplitQueueNextAction(): Promise<void> {
  const candidates = createCommitCandidateGroupingCandidates();
  const scope = createTestOperationScope(
    path.join(os.tmpdir(), "svn-workbench-candidate-grouping"),
  );
  const first = {
    id: "split-first",
    title: "first",
    summary: "first change",
    message: "feat: first",
    paths: [candidates[0].absolutePath],
    reason: "first",
    risks: [],
  };
  const second = {
    id: "split-second",
    title: "second",
    summary: "second change",
    message: "fix: second",
    paths: [candidates[1].absolutePath],
    reason: "second",
    risks: [],
  };

  assert.equal(getCommitSplitQueueNextAction([]).kind, "empty");

  let queue = addCommitSplitToQueue(
    addCommitSplitToQueue([], first, 1),
    second,
    2,
  );
  assert.deepEqual(
    pickCommitSplitQueueNextAction(getCommitSplitQueueNextAction(queue)),
    {
      kind: "previewNotPreviewed",
      primaryActionCommand: "previewNotPreviewed",
    },
  );

  const failedPreviewQueue = markCommitSplitQueueItemSubmissionResult(
    queue,
    "split-first",
    {
      ok: false,
      message: "plan expired",
    },
    8,
  );
  assert.deepEqual(
    pickCommitSplitQueueNextAction(
      getCommitSplitQueueNextAction(failedPreviewQueue),
    ),
    {
      kind: "previewFailed",
      primaryActionCommand: "previewFailed",
    },
  );

  assert.deepEqual(
    pickCommitSplitQueueNextAction(
      getCommitSplitQueueNextAction(queue, {
        total: 2,
        completed: 1,
        remaining: 1,
        active: true,
      }),
    ),
    {
      kind: "waitBulkPreview",
      primaryActionCommand: undefined,
    },
  );

  queue = updateCommitSplitQueueItemPreviewStatus(
    queue,
    buildCommitSplitPlanPreview(scope, candidates, first),
  );
  assert.deepEqual(
    pickCommitSplitQueueNextAction(getCommitSplitQueueNextAction(queue)),
    {
      kind: "submitReady",
      primaryActionCommand: "submitFirstReady",
    },
  );

  const retryQueue = markCommitSplitQueueItemSubmissionResult(
    queue,
    "split-first",
    {
      ok: false,
      message: "remote changed",
    },
    9,
  );
  assert.deepEqual(
    pickCommitSplitQueueNextAction(getCommitSplitQueueNextAction(retryQueue)),
    {
      kind: "retryFailed",
      primaryActionCommand: "retryFirstFailed",
    },
  );

  queue = updateCommitSplitQueueItemPreviewStatus(queue, {
    splitId: "split-second",
    title: "second",
    summary: "second change",
    message: "fix: second",
    risks: [],
    preview: {
      cwd: "",
      commitPaths: [],
      addPaths: [],
      removePaths: [],
      selectedPaths: [candidates[1].absolutePath],
      issues: [{ path: candidates[1].absolutePath, reason: "blocked" }],
      commands: [],
      canCommit: false,
    },
  });
  assert.deepEqual(
    pickCommitSplitQueueNextAction(getCommitSplitQueueNextAction(queue)),
    {
      kind: "reviewBlocked",
      primaryActionCommand: "showBlocked",
    },
  );

  const completedQueue = markCommitSplitQueueItemSubmissionResult(
    queue,
    "split-first",
    { ok: true, revision: "45" },
    10,
  ).map((item) =>
    item.id === "split-second"
      ? { ...item, status: "completed" as const }
      : item,
  );
  assert.deepEqual(
    pickCommitSplitQueueNextAction(
      getCommitSplitQueueNextAction(completedQueue),
    ),
    {
      kind: "allDone",
      primaryActionCommand: "clearCompleted",
    },
  );
}

function pickCommitSplitQueueNextAction(
  action: ReturnType<typeof getCommitSplitQueueNextAction>,
): {
  kind: string;
  primaryActionCommand?: string;
} {
  return {
    kind: action.kind,
    primaryActionCommand: action.primaryActionCommand,
  };
}

async function testCommitSplitQueueVisibilityAndNextItem(): Promise<void> {
  const first = {
    id: "split-1",
    title: "order",
    summary: "order change",
    message: "feat(order): update order",
    paths: ["src/pages/order/OrderList.vue"],
    reason: "split by module",
    risks: [],
  };
  const second = {
    id: "split-2",
    title: "user",
    summary: "user change",
    message: "feat(user): update user",
    paths: ["src/pages/user/UserList.vue"],
    reason: "split by module",
    risks: [],
  };
  const third = {
    id: "split-3",
    title: "docs",
    summary: "docs change",
    message: "docs: update docs",
    paths: ["docs/readme.md"],
    reason: "split by docs",
    risks: [],
  };

  const queue = addCommitSplitToQueue(
    addCommitSplitToQueue(addCommitSplitToQueue([], first, 1), second, 2),
    third,
    3,
  );
  const submittingQueue = markCommitSplitQueueItemSubmitting(queue, "split-2");
  const completedQueue = markCommitSplitQueueItemSubmissionResult(
    submittingQueue,
    "split-1",
    {
      ok: true,
      revision: "44",
    },
    13,
  );
  const summary = summarizeCommitSplitQueue(completedQueue, true);

  assert.equal(summary.total, 3);
  assert.equal(summary.visible, 2);
  assert.equal(summary.hiddenCompleted, 1);
  assert.equal(summary.completed, 1);
  assert.equal(summary.submitting, 1);
  assert.deepEqual(
    getVisibleCommitSplitQueueItems(completedQueue, true).map(
      (item) => item.id,
    ),
    ["split-2", "split-3"],
  );
  assert.equal(
    getNextCommitSplitQueueItem(completedQueue, "split-1")?.id,
    "split-3",
  );
  assert.equal(
    getNextCommitSplitQueueItem(completedQueue, "missing")?.id,
    "split-3",
  );
}

async function testCommitSplitQueueRetryAndCompletedCleanup(): Promise<void> {
  const candidates = createCommitCandidateGroupingCandidates();
  const scope = createTestOperationScope(
    path.join(os.tmpdir(), "svn-workbench-candidate-grouping"),
  );
  const failedSuggestion = {
    id: "split-failed",
    title: "docs retry",
    summary: "retry docs",
    message: "docs: retry docs",
    paths: [candidates[2].absolutePath],
    reason: "split by documentation change",
    risks: [],
  };
  const completedSuggestion = {
    id: "split-completed",
    title: "order done",
    summary: "done order",
    message: "feat(order): done",
    paths: [candidates[0].absolutePath],
    reason: "split by module",
    risks: [],
  };

  const queue = addCommitSplitToQueue(
    addCommitSplitToQueue([], failedSuggestion, 1),
    completedSuggestion,
    2,
  );
  const failedQueue = markCommitSplitQueueItemSubmissionResult(
    queue,
    "split-failed",
    {
      ok: false,
      message: "remote changed",
    },
    3,
  );
  const notPreviewedRetry = canRetryCommitSplitQueueItem(failedQueue[0]);
  assert.equal(notPreviewedRetry.allowed, false);
  assert.equal(notPreviewedRetry.reason, "notPreviewed");

  const readyFailedQueue = updateCommitSplitQueueItemPreviewStatus(
    failedQueue,
    buildCommitSplitPlanPreview(scope, candidates, failedSuggestion),
  );
  const readyRetry = canRetryCommitSplitQueueItem(readyFailedQueue[0]);
  assert.equal(readyRetry.allowed, true);

  const completedQueue = markCommitSplitQueueItemSubmissionResult(
    readyFailedQueue,
    "split-completed",
    {
      ok: true,
      revision: "45",
    },
    4,
  );
  const completedRetry = canRetryCommitSplitQueueItem(completedQueue[1]);
  assert.equal(completedRetry.allowed, false);
  assert.equal(completedRetry.reason, "notFailed");

  const cleanedQueue = removeCompletedCommitSplitQueueItems(completedQueue);
  assert.deepEqual(
    cleanedQueue.map((item) => item.id),
    ["split-failed"],
  );
}

async function testCommitSplitQueueStatusViewFilter(): Promise<void> {
  const first = {
    id: "split-pending",
    title: "pending",
    summary: "pending change",
    message: "feat: pending",
    paths: ["src/pending.ts"],
    reason: "pending",
    risks: [],
  };
  const second = {
    id: "split-failed",
    title: "failed",
    summary: "failed change",
    message: "fix: failed",
    paths: ["src/failed.ts"],
    reason: "failed",
    risks: [],
  };
  const third = {
    id: "split-completed",
    title: "completed",
    summary: "completed change",
    message: "docs: completed",
    paths: ["docs/completed.md"],
    reason: "completed",
    risks: [],
  };

  const queue = addCommitSplitToQueue(
    addCommitSplitToQueue(addCommitSplitToQueue([], first, 1), second, 2),
    third,
    3,
  );
  const failedQueue = markCommitSplitQueueItemSubmissionResult(
    queue,
    "split-failed",
    {
      ok: false,
      message: "remote changed",
    },
    4,
  );
  const completedQueue = markCommitSplitQueueItemSubmissionResult(
    failedQueue,
    "split-completed",
    {
      ok: true,
      revision: "46",
    },
    5,
  );

  assert.deepEqual(
    getVisibleCommitSplitQueueItems(completedQueue, false, "failed").map(
      (item) => item.id,
    ),
    ["split-failed"],
  );
  assert.deepEqual(
    getVisibleCommitSplitQueueItems(completedQueue, true, "completed").map(
      (item) => item.id,
    ),
    [],
  );

  const failedSummary = summarizeCommitSplitQueue(
    completedQueue,
    false,
    "failed",
  );
  assert.equal(failedSummary.visible, 1);
  assert.equal(failedSummary.failed, 1);
  assert.equal(failedSummary.completed, 1);

  const hiddenCompletedSummary = summarizeCommitSplitQueue(
    completedQueue,
    true,
    "completed",
  );
  assert.equal(hiddenCompletedSummary.visible, 0);
  assert.equal(hiddenCompletedSummary.hiddenCompleted, 1);
}

async function testCommitSplitQueuePlanViewFilter(): Promise<void> {
  const ready = {
    id: "split-ready",
    title: "ready",
    summary: "ready change",
    message: "feat: ready",
    paths: ["src/ready.ts"],
    reason: "ready",
    risks: [],
  };
  const blocked = {
    id: "split-blocked",
    title: "blocked",
    summary: "blocked change",
    message: "fix: blocked",
    paths: ["src/blocked.ts"],
    reason: "blocked",
    risks: [],
  };
  const notPreviewed = {
    id: "split-not-previewed",
    title: "not previewed",
    summary: "not previewed change",
    message: "chore: not previewed",
    paths: ["src/not-previewed.ts"],
    reason: "not previewed",
    risks: [],
  };

  let queue = addCommitSplitToQueue(
    addCommitSplitToQueue(addCommitSplitToQueue([], ready, 1), blocked, 2),
    notPreviewed,
    3,
  );
  queue = updateCommitSplitQueueItemPreviewStatus(queue, {
    splitId: "split-ready",
    title: "ready",
    summary: "ready change",
    message: "feat: ready",
    risks: [],
    preview: {
      cwd: "",
      commitPaths: ["src/ready.ts"],
      addPaths: [],
      removePaths: [],
      selectedPaths: ["src/ready.ts"],
      issues: [],
      commands: [],
      canCommit: true,
    },
  });
  queue = updateCommitSplitQueueItemPreviewStatus(queue, {
    splitId: "split-blocked",
    title: "blocked",
    summary: "blocked change",
    message: "fix: blocked",
    risks: [],
    preview: {
      cwd: "",
      commitPaths: [],
      addPaths: [],
      removePaths: [],
      selectedPaths: ["src/blocked.ts"],
      issues: [{ path: "src/blocked.ts", reason: "blocked" }],
      commands: [],
      canCommit: false,
    },
  });

  assert.deepEqual(
    getVisibleCommitSplitQueueItems(queue, false, "all", "blocked").map(
      (item) => item.id,
    ),
    ["split-blocked"],
  );
  assert.deepEqual(
    getVisibleCommitSplitQueueItems(queue, false, "all", "ready").map(
      (item) => item.id,
    ),
    ["split-ready"],
  );
  assert.deepEqual(
    getVisibleCommitSplitQueueItems(queue, false, "all", "notPreviewed").map(
      (item) => item.id,
    ),
    ["split-not-previewed"],
  );

  const blockedSummary = summarizeCommitSplitQueue(
    queue,
    false,
    "all",
    "blocked",
  );
  assert.equal(blockedSummary.visible, 1);
  assert.equal(blockedSummary.ready, 1);
  assert.equal(blockedSummary.blocked, 1);
  assert.equal(blockedSummary.notPreviewed, 1);
}

async function testCommitSplitQueueBulkPreviewSelection(): Promise<void> {
  const pending = {
    id: "split-pending",
    title: "pending",
    summary: "pending change",
    message: "feat: pending",
    paths: ["src/pending.ts"],
    reason: "pending",
    risks: [],
  };
  const applied = {
    id: "split-applied",
    title: "applied",
    summary: "applied change",
    message: "feat: applied",
    paths: ["src/applied.ts"],
    reason: "applied",
    risks: [],
  };
  const failed = {
    id: "split-failed",
    title: "failed",
    summary: "failed change",
    message: "fix: failed",
    paths: ["src/failed.ts"],
    reason: "failed",
    risks: [],
  };
  const completed = {
    id: "split-completed",
    title: "completed",
    summary: "completed change",
    message: "docs: completed",
    paths: ["docs/completed.md"],
    reason: "completed",
    risks: [],
  };
  const submitting = {
    id: "split-submitting",
    title: "submitting",
    summary: "submitting change",
    message: "fix: submitting",
    paths: ["src/submitting.ts"],
    reason: "submitting",
    risks: [],
  };

  let queue = addCommitSplitToQueue(
    addCommitSplitToQueue(
      addCommitSplitToQueue(
        addCommitSplitToQueue(
          addCommitSplitToQueue([], pending, 1),
          applied,
          2,
        ),
        failed,
        3,
      ),
      completed,
      4,
    ),
    submitting,
    5,
  );
  queue = markCommitSplitQueueItemApplied(queue, "split-applied");
  queue = markCommitSplitQueueItemSubmissionResult(
    queue,
    "split-failed",
    {
      ok: false,
      message: "remote changed",
    },
    6,
  );
  queue = markCommitSplitQueueItemSubmissionResult(
    queue,
    "split-completed",
    {
      ok: true,
      revision: "48",
    },
    7,
  );
  queue = markCommitSplitQueueItemSubmitting(queue, "split-submitting");

  assert.deepEqual(
    getRepreviewableCommitSplitQueueItems(queue).map((item) => item.id),
    ["split-pending", "split-applied", "split-failed"],
  );
}

async function testCommitSplitQueueFailedRepreviewSelection(): Promise<void> {
  const firstFailed = {
    id: "split-first-failed",
    title: "first failed",
    summary: "first failed change",
    message: "fix: first failed",
    paths: ["src/firstFailed.ts"],
    reason: "first failed",
    risks: [],
  };
  const secondFailed = {
    id: "split-second-failed",
    title: "second failed",
    summary: "second failed change",
    message: "fix: second failed",
    paths: ["src/secondFailed.ts"],
    reason: "second failed",
    risks: [],
  };
  const pending = {
    id: "split-pending",
    title: "pending",
    summary: "pending change",
    message: "feat: pending",
    paths: ["src/pending.ts"],
    reason: "pending",
    risks: [],
  };
  const completed = {
    id: "split-completed",
    title: "completed",
    summary: "completed change",
    message: "docs: completed",
    paths: ["docs/completed.md"],
    reason: "completed",
    risks: [],
  };
  const submitting = {
    id: "split-submitting",
    title: "submitting",
    summary: "submitting change",
    message: "fix: submitting",
    paths: ["src/submitting.ts"],
    reason: "submitting",
    risks: [],
  };

  let queue = addCommitSplitToQueue(
    addCommitSplitToQueue(
      addCommitSplitToQueue(
        addCommitSplitToQueue(
          addCommitSplitToQueue([], firstFailed, 1),
          secondFailed,
          2,
        ),
        pending,
        3,
      ),
      completed,
      4,
    ),
    submitting,
    5,
  );
  queue = markCommitSplitQueueItemSubmissionResult(
    queue,
    "split-first-failed",
    {
      ok: false,
      message: "remote changed",
    },
    6,
  );
  queue = markCommitSplitQueueItemSubmissionResult(
    queue,
    "split-second-failed",
    {
      ok: false,
      message: "plan expired",
    },
    7,
  );
  queue = markCommitSplitQueueItemSubmissionResult(
    queue,
    "split-completed",
    {
      ok: true,
      revision: "49",
    },
    8,
  );
  queue = markCommitSplitQueueItemSubmitting(queue, "split-submitting");

  assert.deepEqual(
    getFailedRepreviewableCommitSplitQueueItems(queue).map((item) => item.id),
    ["split-first-failed", "split-second-failed"],
  );
}

async function testCommitSplitQueueNotPreviewedSelection(): Promise<void> {
  const first = {
    id: "split-first",
    title: "first",
    summary: "first change",
    message: "feat: first",
    paths: ["src/first.ts"],
    reason: "first",
    risks: [],
  };
  const second = {
    id: "split-second",
    title: "second",
    summary: "second change",
    message: "fix: second",
    paths: ["src/second.ts"],
    reason: "second",
    risks: [],
  };
  const completed = {
    id: "split-completed",
    title: "completed",
    summary: "completed change",
    message: "docs: completed",
    paths: ["docs/completed.md"],
    reason: "completed",
    risks: [],
  };

  let queue = addCommitSplitToQueue(
    addCommitSplitToQueue(addCommitSplitToQueue([], first, 1), second, 2),
    completed,
    3,
  );
  queue = updateCommitSplitQueueItemPreviewStatus(queue, {
    splitId: "split-second",
    title: "second",
    summary: "second change",
    message: "fix: second",
    risks: [],
    preview: {
      cwd: "",
      commitPaths: ["src/second.ts"],
      addPaths: [],
      removePaths: [],
      selectedPaths: ["src/second.ts"],
      issues: [],
      commands: [],
      canCommit: true,
    },
  });
  queue = markCommitSplitQueueItemSubmissionResult(
    queue,
    "split-completed",
    {
      ok: true,
      revision: "49",
    },
    4,
  );

  assert.deepEqual(
    getNotPreviewedCommitSplitQueueItems(queue).map((item) => item.id),
    ["split-first"],
  );
}

async function testCommitSplitQueueBulkPreviewProgress(): Promise<void> {
  const first = {
    id: "split-first",
    title: "first",
    summary: "first change",
    message: "feat: first",
    paths: ["src/first.ts"],
    reason: "first",
    risks: [],
  };
  const second = {
    id: "split-second",
    title: "second",
    summary: "second change",
    message: "fix: second",
    paths: ["src/second.ts"],
    reason: "second",
    risks: [],
  };

  const queue = addCommitSplitToQueue(
    addCommitSplitToQueue([], first, 1),
    second,
    2,
  );
  const state = createCommitSplitQueueBulkPreviewState(queue, 3);
  assert.ok(state);
  assert.deepEqual(state.ids, ["split-first", "split-second"]);
  assert.equal(state.startedAt, 3);
  assert.deepEqual(summarizeCommitSplitQueueBulkPreview(state), {
    total: 2,
    completed: 0,
    remaining: 2,
    active: true,
  });

  const afterFirst = completeCommitSplitQueueBulkPreviewItem(
    state,
    "split-first",
  );
  assert.ok(afterFirst);
  assert.deepEqual(summarizeCommitSplitQueueBulkPreview(afterFirst), {
    total: 2,
    completed: 1,
    remaining: 1,
    active: true,
  });

  const afterDuplicate = completeCommitSplitQueueBulkPreviewItem(
    afterFirst,
    "split-first",
  );
  assert.ok(afterDuplicate);
  assert.deepEqual(summarizeCommitSplitQueueBulkPreview(afterDuplicate), {
    total: 2,
    completed: 1,
    remaining: 1,
    active: true,
  });

  assert.equal(
    completeCommitSplitQueueBulkPreviewItem(afterDuplicate, "split-second"),
    undefined,
  );
  assert.deepEqual(summarizeCommitSplitQueueBulkPreview(undefined), {
    total: 0,
    completed: 0,
    remaining: 0,
    active: false,
  });
  assert.equal(createCommitSplitQueueBulkPreviewState([], 4), undefined);
}

async function testCommitSplitQueueBulkPreviewResultSummary(): Promise<void> {
  const first = {
    id: "split-first",
    title: "first",
    summary: "first change",
    message: "feat: first",
    paths: ["src/first.ts"],
    reason: "first",
    risks: [],
  };
  const second = {
    id: "split-second",
    title: "second",
    summary: "second change",
    message: "fix: second",
    paths: ["src/second.ts"],
    reason: "second",
    risks: [],
  };
  const third = {
    id: "split-third",
    title: "third",
    summary: "third change",
    message: "chore: third",
    paths: ["src/third.ts"],
    reason: "third",
    risks: [],
  };

  let queue = addCommitSplitToQueue(
    addCommitSplitToQueue(addCommitSplitToQueue([], first, 1), second, 2),
    third,
    3,
  );
  queue = updateCommitSplitQueueItemPreviewStatus(queue, {
    splitId: "split-first",
    title: "first",
    summary: "first change",
    message: "feat: first",
    risks: [],
    preview: {
      cwd: "",
      commitPaths: ["src/first.ts"],
      addPaths: [],
      removePaths: [],
      selectedPaths: ["src/first.ts"],
      issues: [],
      commands: [],
      canCommit: true,
    },
  });
  queue = updateCommitSplitQueueItemPreviewStatus(queue, {
    splitId: "split-second",
    title: "second",
    summary: "second change",
    message: "fix: second",
    risks: [],
    preview: {
      cwd: "",
      commitPaths: [],
      addPaths: [],
      removePaths: [],
      selectedPaths: ["src/second.ts"],
      issues: [{ path: "src/second.ts", reason: "blocked" }],
      commands: [],
      canCommit: false,
    },
  });

  assert.deepEqual(
    summarizeCommitSplitQueueBulkPreviewResult(queue, [
      "split-first",
      "split-second",
      "split-third",
    ]),
    {
      total: 3,
      ready: 1,
      blocked: 1,
      notPreviewed: 1,
      firstBlockedId: "split-second",
      firstBlockedTitle: "second",
      firstReadyId: "split-first",
      firstReadyTitle: "first",
    },
  );
}

async function testCommitSplitQueuePreviewIssueSummary(): Promise<void> {
  const first = {
    id: "split-first",
    title: "first",
    summary: "first change",
    message: "feat: first",
    paths: ["src/first.ts"],
    reason: "first",
    risks: [],
  };
  const second = {
    id: "split-second",
    title: "second",
    summary: "second change",
    message: "fix: second",
    paths: ["src/second.ts"],
    reason: "second",
    risks: [],
  };

  let queue = addCommitSplitToQueue(
    addCommitSplitToQueue([], first, 1),
    second,
    2,
  );
  queue = updateCommitSplitQueueItemPreviewStatus(queue, {
    splitId: "split-first",
    title: "first",
    summary: "first change",
    message: "feat: first",
    risks: [],
    preview: {
      cwd: "",
      commitPaths: [],
      addPaths: [],
      removePaths: [],
      selectedPaths: ["src/first.ts"],
      issues: [{ path: "src/first.ts", reason: "blocked first" }],
      commands: [],
      canCommit: false,
    },
  });
  queue = queue.map((item) =>
    item.id === "split-second"
      ? {
          ...item,
          planStatus: "blocked" as const,
          lastPreviewIssueCount: 1,
          lastPreviewIssues: undefined,
        }
      : item,
  );

  assert.deepEqual(collectCommitSplitQueuePreviewIssues(queue), [
    {
      queueItemId: "split-first",
      queueItemTitle: "first",
      path: "src/first.ts",
      reason: "blocked first",
    },
    {
      queueItemId: "split-second",
      queueItemTitle: "second",
      reason: "该拆分项预览未通过，请重新预览查看详情。",
    },
  ]);
}

async function testCommitSplitQueuePreviewIssueGrouping(): Promise<void> {
  assert.equal(
    classifyCommitSplitQueuePreviewIssue("文件不在当前提交范围内，已阻止。"),
    "scope",
  );
  assert.equal(
    classifyCommitSplitQueuePreviewIssue(
      "文件不在当前 SVN 候选列表中，已阻止。",
    ),
    "candidate",
  );
  assert.equal(
    classifyCommitSplitQueuePreviewIssue(
      "文件已被规则排除，不能直接进入提交计划。",
    ),
    "excluded",
  );
  assert.equal(
    classifyCommitSplitQueuePreviewIssue(
      "文件处于阻止状态，需要先处理冲突或异常。",
    ),
    "blocked",
  );
  assert.equal(
    classifyCommitSplitQueuePreviewIssue(
      "当前 SVN 状态 conflicted 不支持直接提交。",
    ),
    "svnStatus",
  );
  assert.equal(
    classifyCommitSplitQueuePreviewIssue(
      "请选择至少一个文件后再生成提交计划。",
    ),
    "emptySelection",
  );
  assert.equal(
    classifyCommitSplitQueuePreviewIssue("custom reason"),
    "unknown",
  );

  const groups = groupCommitSplitQueuePreviewIssues([
    {
      queueItemId: "split-1",
      queueItemTitle: "first",
      path: "src/a.ts",
      reason: "文件不在当前 SVN 候选列表中，已阻止。",
    },
    {
      queueItemId: "split-2",
      queueItemTitle: "second",
      path: "src/b.ts",
      reason: "文件不在当前 SVN 候选列表中，已阻止。",
    },
    {
      queueItemId: "split-2",
      queueItemTitle: "second",
      path: "src/c.ts",
      reason: "文件不在当前提交范围内，已阻止。",
    },
  ]);

  assert.deepEqual(
    groups.map((group) => ({
      category: group.category,
      label: group.label,
      count: group.count,
      itemCount: group.itemCount,
    })),
    [
      {
        category: "candidate",
        label: "候选列表缺失",
        count: 2,
        itemCount: 2,
      },
      {
        category: "scope",
        label: "范围不匹配",
        count: 1,
        itemCount: 1,
      },
    ],
  );
}

async function testCommitSplitQueuePreviewIssueCategoryFilter(): Promise<void> {
  const candidate = {
    id: "split-candidate",
    title: "candidate",
    summary: "candidate change",
    message: "fix: candidate",
    paths: ["src/candidate.ts"],
    reason: "candidate",
    risks: [],
  };
  const scope = {
    id: "split-scope",
    title: "scope",
    summary: "scope change",
    message: "fix: scope",
    paths: ["src/scope.ts"],
    reason: "scope",
    risks: [],
  };
  const stale = {
    id: "split-stale",
    title: "stale",
    summary: "stale change",
    message: "fix: stale",
    paths: ["src/stale.ts"],
    reason: "stale",
    risks: [],
  };
  const ready = {
    id: "split-ready",
    title: "ready",
    summary: "ready change",
    message: "feat: ready",
    paths: ["src/ready.ts"],
    reason: "ready",
    risks: [],
  };

  let queue = addCommitSplitToQueue(
    addCommitSplitToQueue(
      addCommitSplitToQueue(addCommitSplitToQueue([], candidate, 1), scope, 2),
      stale,
      3,
    ),
    ready,
    4,
  );
  queue = updateCommitSplitQueueItemPreviewStatus(queue, {
    splitId: "split-candidate",
    title: "candidate",
    summary: "candidate change",
    message: "fix: candidate",
    risks: [],
    preview: {
      cwd: "",
      commitPaths: [],
      addPaths: [],
      removePaths: [],
      selectedPaths: ["src/candidate.ts"],
      issues: [
        {
          path: "src/candidate.ts",
          reason: "文件不在当前 SVN 候选列表中，已阻止。",
        },
      ],
      commands: [],
      canCommit: false,
    },
  });
  queue = updateCommitSplitQueueItemPreviewStatus(queue, {
    splitId: "split-scope",
    title: "scope",
    summary: "scope change",
    message: "fix: scope",
    risks: [],
    preview: {
      cwd: "",
      commitPaths: [],
      addPaths: [],
      removePaths: [],
      selectedPaths: ["src/scope.ts"],
      issues: [
        { path: "src/scope.ts", reason: "文件不在当前提交范围内，已阻止。" },
      ],
      commands: [],
      canCommit: false,
    },
  });
  queue = updateCommitSplitQueueItemPreviewStatus(queue, {
    splitId: "split-ready",
    title: "ready",
    summary: "ready change",
    message: "feat: ready",
    risks: [],
    preview: {
      cwd: "",
      commitPaths: ["src/ready.ts"],
      addPaths: [],
      removePaths: [],
      selectedPaths: ["src/ready.ts"],
      issues: [],
      commands: [],
      canCommit: true,
    },
  });
  queue = queue.map((item) =>
    item.id === "split-stale"
      ? {
          ...item,
          planStatus: "blocked" as const,
          lastPreviewIssueCount: 1,
          lastPreviewIssues: undefined,
        }
      : item,
  );

  const candidateItem = queue.find((item) => item.id === "split-candidate");
  const readyItem = queue.find((item) => item.id === "split-ready");
  assert.ok(candidateItem);
  assert.ok(readyItem);
  assert.equal(
    doesCommitSplitQueueItemMatchPreviewIssueCategory(
      candidateItem,
      "candidate",
    ),
    true,
  );
  assert.equal(
    doesCommitSplitQueueItemMatchPreviewIssueCategory(candidateItem, "scope"),
    false,
  );
  assert.equal(
    doesCommitSplitQueueItemMatchPreviewIssueCategory(readyItem, "candidate"),
    false,
  );

  assert.deepEqual(
    getVisibleCommitSplitQueueItems(
      queue,
      false,
      "all",
      "blocked",
      "candidate",
    ).map((item) => item.id),
    ["split-candidate"],
  );
  assert.deepEqual(
    getVisibleCommitSplitQueueItems(
      queue,
      false,
      "all",
      "blocked",
      "scope",
    ).map((item) => item.id),
    ["split-scope"],
  );
  assert.deepEqual(
    getVisibleCommitSplitQueueItems(
      queue,
      false,
      "all",
      "blocked",
      "unknown",
    ).map((item) => item.id),
    ["split-stale"],
  );
  assert.deepEqual(
    getVisibleCommitSplitQueueItems(
      queue,
      false,
      "all",
      "ready",
      "candidate",
    ).map((item) => item.id),
    [],
  );
}

async function testCommitSplitQueuePreviewIssueCategoryAction(): Promise<void> {
  const scopeAction = getCommitSplitQueuePreviewIssueCategoryAction("scope");
  assert.equal(scopeAction.category, "scope");
  assert.equal(scopeAction.title, "处理范围不匹配");
  assert.match(scopeAction.detail, /当前右键范围外/);
  assert.equal(scopeAction.primaryActionLabel, "切换提交范围后重预览");

  const candidateAction =
    getCommitSplitQueuePreviewIssueCategoryAction("candidate");
  assert.equal(candidateAction.category, "candidate");
  assert.match(candidateAction.detail, /SVN 候选列表/);
  assert.equal(candidateAction.primaryActionLabel, "刷新 SVN 状态后重预览");
  assert.equal(candidateAction.secondaryActionLabel, "重新生成拆分建议");

  const unknownAction =
    getCommitSplitQueuePreviewIssueCategoryAction("unknown");
  assert.equal(unknownAction.category, "unknown");
  assert.equal(unknownAction.title, "处理其他原因");
  assert.match(unknownAction.primaryActionLabel, /重新预览/);
}

async function testCommitSplitQueuePreviewIssueQuickActions(): Promise<void> {
  const candidateAction =
    getCommitSplitQueuePreviewIssueCategoryAction("candidate");
  assert.deepEqual(
    candidateAction.quickActions.map((action) => action.kind),
    ["refreshAndRepreview", "regenerateSplit"],
  );
  assert.equal(candidateAction.quickActions[0].label, "刷新候选并重预览此原因");

  const blockedAction =
    getCommitSplitQueuePreviewIssueCategoryAction("blocked");
  assert.deepEqual(
    blockedAction.quickActions.map((action) => action.kind),
    ["openConflictCenter", "refreshAndRepreview"],
  );
  assert.equal(blockedAction.quickActions[0].label, "打开冲突中心");

  const excludedAction =
    getCommitSplitQueuePreviewIssueCategoryAction("excluded");
  assert.deepEqual(
    excludedAction.quickActions.map((action) => action.kind),
    ["refreshAndRepreview", "manualReview"],
  );
}

async function testCommitSplitQueuePreviewIssuePathsByCategory(): Promise<void> {
  const candidate = {
    id: "split-candidate",
    title: "candidate",
    summary: "candidate change",
    message: "fix: candidate",
    paths: ["src/candidate.ts"],
    reason: "candidate",
    risks: [],
  };
  const mixed = {
    id: "split-mixed",
    title: "mixed",
    summary: "mixed change",
    message: "fix: mixed",
    paths: ["src/mixed.ts"],
    reason: "mixed",
    risks: [],
  };
  const stale = {
    id: "split-stale-paths",
    title: "stale paths",
    summary: "stale paths change",
    message: "fix: stale",
    paths: ["src/stale-a.ts", "src/stale-b.ts"],
    reason: "stale",
    risks: [],
  };

  let queue = addCommitSplitToQueue(
    addCommitSplitToQueue(addCommitSplitToQueue([], candidate, 1), mixed, 2),
    stale,
    3,
  );
  queue = updateCommitSplitQueueItemPreviewStatus(queue, {
    splitId: "split-candidate",
    title: "candidate",
    summary: "candidate change",
    message: "fix: candidate",
    risks: [],
    preview: {
      cwd: "",
      commitPaths: [],
      addPaths: [],
      removePaths: [],
      selectedPaths: ["src/candidate.ts"],
      issues: [
        {
          path: "src/candidate.ts",
          reason: "文件不在当前 SVN 候选列表中，已阻止。",
        },
      ],
      commands: [],
      canCommit: false,
    },
  });
  queue = updateCommitSplitQueueItemPreviewStatus(queue, {
    splitId: "split-mixed",
    title: "mixed",
    summary: "mixed change",
    message: "fix: mixed",
    risks: [],
    preview: {
      cwd: "",
      commitPaths: [],
      addPaths: [],
      removePaths: [],
      selectedPaths: ["src/mixed.ts", "src/candidate.ts"],
      issues: [
        { path: "src/mixed.ts", reason: "文件不在当前提交范围内，已阻止。" },
        {
          path: "src/candidate.ts",
          reason: "文件不在当前 SVN 候选列表中，已阻止。",
        },
      ],
      commands: [],
      canCommit: false,
    },
  });
  queue = queue.map((item) =>
    item.id === "split-stale-paths"
      ? {
          ...item,
          planStatus: "blocked" as const,
          lastPreviewIssueCount: 1,
          lastPreviewIssues: undefined,
        }
      : item,
  );

  assert.deepEqual(
    getCommitSplitQueuePreviewIssuePathsByCategory(queue, "candidate"),
    ["src/candidate.ts"],
  );
  assert.deepEqual(
    getCommitSplitQueuePreviewIssuePathsByCategory(queue, "scope"),
    ["src/mixed.ts"],
  );
  assert.deepEqual(
    getCommitSplitQueuePreviewIssuePathsByCategory(queue, "unknown"),
    ["src/stale-a.ts", "src/stale-b.ts"],
  );
}

async function testCommitSplitQueueDraftPersistence(): Promise<void> {
  const repositoryRoot = path.join(
    os.tmpdir(),
    "svn-workbench-split-queue-draft",
  );
  const scope = createTestOperationScope(repositoryRoot);
  const secondScope = createTestOperationScope(
    path.join(os.tmpdir(), "svn-workbench-split-queue-draft-other"),
  );
  const multiRootScope: OperationScope = {
    ...scope,
    roots: [
      {
        absolutePath: path.resolve(repositoryRoot, "src", "b"),
        relativePath: "src/b",
        kind: "folder",
      },
      {
        absolutePath: path.resolve(repositoryRoot, "src", "a.ts"),
        relativePath: "src/a.ts",
        kind: "file",
      },
    ],
  };
  const reorderedMultiRootScope: OperationScope = {
    ...multiRootScope,
    roots: [...multiRootScope.roots].reverse(),
  };
  const pending = {
    id: "split-pending",
    title: "pending",
    summary: "pending change",
    message: "feat: pending",
    paths: ["src/pending.ts"],
    reason: "pending",
    risks: [],
  };
  const completed = {
    id: "split-completed",
    title: "completed",
    summary: "completed change",
    message: "docs: completed",
    paths: ["docs/completed.md"],
    reason: "completed",
    risks: [],
  };
  const submitting = {
    id: "split-submitting",
    title: "submitting",
    summary: "submitting change",
    message: "fix: submitting",
    paths: ["src/submitting.ts"],
    reason: "submitting",
    risks: [],
  };

  const queue = markCommitSplitQueueItemSubmitting(
    updateCommitSplitQueueItemPreviewStatus(
      markCommitSplitQueueItemSubmissionResult(
        addCommitSplitToQueue(
          addCommitSplitToQueue(
            addCommitSplitToQueue([], pending, 1),
            completed,
            2,
          ),
          submitting,
          3,
        ),
        "split-completed",
        {
          ok: true,
          revision: "47",
        },
        4,
      ),
      {
        splitId: "split-pending",
        title: "pending",
        summary: "pending change",
        message: "feat: pending",
        risks: [],
        preview: {
          cwd: "",
          commitPaths: [],
          addPaths: [],
          removePaths: [],
          selectedPaths: ["src/pending.ts"],
          issues: [{ path: "src/pending.ts", reason: "stale preview" }],
          commands: [],
          canCommit: false,
        },
      },
    ),
    "split-submitting",
  );
  const draft = createCommitSplitQueueDraft(
    scope,
    {
      queue,
      splitQueueFilter: "completed",
      splitQueuePlanFilter: "blocked",
      hideCompletedSplitQueue: true,
    },
    5,
  );

  assert.ok(draft);
  assert.equal(draft.queue.length, 2);
  assert.deepEqual(
    draft.queue.map((item) => item.id),
    ["split-pending", "split-submitting"],
  );
  assert.deepEqual(
    draft.queue.map((item) => item.status),
    ["pending", "failed"],
  );
  assert.deepEqual(
    draft.queue.map((item) => item.planStatus),
    ["notPreviewed", "notPreviewed"],
  );
  assert.deepEqual(
    draft.queue.map((item) => item.lastPreviewIssues),
    [undefined, undefined],
  );
  assert.equal(draft.queue[0].revision, undefined);
  assert.equal(Boolean(draft.queue[1].lastSubmissionError), true);
  assert.equal(draft.splitQueueFilter, "completed");
  assert.equal(draft.splitQueuePlanFilter, "blocked");
  assert.equal(draft.hideCompletedSplitQueue, true);
  assert.equal(draft.savedAt, 5);
  assert.match(
    getCommitSplitQueueDraftStorageKey(scope),
    /^svnWorkbench\.commitSplitQueueDraft\./,
  );
  assert.equal(
    buildCommitSplitQueueDraftScopeKey(multiRootScope),
    buildCommitSplitQueueDraftScopeKey(reorderedMultiRootScope),
  );

  const restored = restoreCommitSplitQueueDraft(draft, scope);
  assert.ok(restored);
  assert.equal(restored.queue.length, 2);
  assert.equal(restoreCommitSplitQueueDraft(draft, secondScope), undefined);
  assert.equal(
    restoreCommitSplitQueueDraft({ ...draft, version: 0 }, scope),
    undefined,
  );
}

async function testAiProviderPresets(): Promise<void> {
  const ids = AI_PROVIDER_PRESETS.map((preset) => preset.id);
  assert.ok(ids.includes("deepseek"));
  assert.ok(ids.includes("qwenDashscope"));
  assert.ok(ids.includes("zhipuCoding"));
  assert.ok(ids.includes("zhipuGeneral"));
  assert.ok(ids.includes("kimi"));
  assert.ok(ids.includes("custom"));
  assert.deepEqual(
    AI_USAGE_SCENARIOS.map((scenario) => scenario.id),
    [
      "commitSelection",
      "conflictAdvice",
      "commitMessage",
      "commitSplit",
      "teamRules",
      "conflictMerge",
    ],
  );
  // v0.0.9 §6：设置页只展示有真实调用链的场景，伪场景（conflictMerge）不进入可见列表。
  assert.ok(
    AI_VISIBLE_USAGE_SCENARIOS.every(
      (scenario) => scenario.id !== "conflictMerge",
    ),
  );
  assert.equal(getAiProviderPreset("missing").id, "deepseek");
  assert.equal(
    AI_PROVIDER_PRESETS.some((preset) =>
      preset.baseUrl.includes("/chat/completions"),
    ),
    false,
  );
}

async function testAiProviderConfigurationValidation(): Promise<void> {
  assert.equal(
    normalizeAiBaseUrl(" https://api.example.com/v1/// "),
    "https://api.example.com/v1",
  );
  assert.equal(
    validateAiProviderConfig({ baseUrl: "", model: "m", apiKey: "k" }).valid,
    false,
  );
  assert.equal(
    validateAiProviderConfig({
      baseUrl: "https://api.example.com/v1",
      model: "",
      apiKey: "k",
    }).valid,
    false,
  );
  assert.equal(
    validateAiProviderConfig({
      baseUrl: "https://api.example.com/v1",
      model: "m",
      apiKey: "",
    }).valid,
    false,
  );
  assert.equal(
    validateAiProviderConfig({
      baseUrl: "https://api.example.com/v1",
      model: "m",
      apiKey: "k",
    }).valid,
    true,
  );
}

async function testAiScenarioModelOverrides(): Promise<void> {
  assert.equal(getScenarioModel("default-model", undefined), "default-model");
  assert.equal(
    getScenarioModel("default-model", {}, "commitSelection"),
    "default-model",
  );
  assert.equal(
    getScenarioModel(
      "default-model",
      { conflictAdvice: "strong-conflict-model" },
      "conflictAdvice",
    ),
    "strong-conflict-model",
  );
  assert.equal(
    getScenarioModel(
      "default-model",
      { conflictAdvice: "  " },
      "conflictAdvice",
    ),
    "default-model",
  );
}

async function testTeamRulesAiRequest(): Promise<void> {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "svn-workbench-team-rules-"),
  );
  try {
    fs.mkdirSync(path.join(tempRoot, "src", "pages", "order"), {
      recursive: true,
    });
    fs.mkdirSync(path.join(tempRoot, "src", "pages", "user"), {
      recursive: true,
    });
    fs.mkdirSync(path.join(tempRoot, "dist"), { recursive: true });
    fs.writeFileSync(
      path.join(tempRoot, "src", "pages", "order", "OrderList.vue"),
      "order",
      "utf8",
    );
    fs.writeFileSync(
      path.join(tempRoot, "src", "pages", "user", "UserList.vue"),
      "user",
      "utf8",
    );
    fs.writeFileSync(
      path.join(tempRoot, "dist", "bundle.js"),
      "bundle",
      "utf8",
    );

    const request = await buildTeamRulesAiRequest(
      tempRoot,
      defaultCommitConventionConfig,
    );
    assert.equal(request.locale, "zh-CN");
    assert.ok(request.directories.includes("src/pages/order"));
    assert.ok(request.directories.includes("src/pages/user"));
    assert.equal(request.directories.includes("dist"), false);
    assert.ok(request.sampleFiles.includes("src/pages/order/OrderList.vue"));
  } finally {
    removeTestTempDirectory(tempRoot);
  }
}

async function testTeamRulesAiLocalRecommendation(): Promise<void> {
  const recommendation = createLocalTeamRulesRecommendation({
    repositoryName: "demo",
    directories: ["src/pages/order", "src/pages/user", "config", "docs"],
    sampleFiles: [
      "src/pages/order/OrderList.vue",
      "config/app.json",
      "docs/readme.md",
    ],
    locale: "zh-CN",
  });

  assert.equal(recommendation.commitConvention.enabled, true);
  assert.ok(recommendation.commitConvention.allowedModules.includes("order"));
  assert.ok(recommendation.commitConvention.allowedModules.includes("user"));
  assert.ok(recommendation.commitConvention.allowedModules.includes("config"));
  assert.ok(recommendation.commitConvention.allowedModules.includes("docs"));
  assert.ok(recommendation.commitConvention.allowedPrefixes.includes("config"));
  assert.ok(recommendation.commitConvention.allowedPrefixes.includes("docs"));
  assert.equal(recommendation.confidence, "high");
}

async function testTeamRulesAiRecommendationNormalization(): Promise<void> {
  const normalized = normalizeTeamRulesRecommendation({
    commitConvention: {
      enabled: true,
      requiredPrefix: true,
      allowedPrefixes: [],
      requiredModule: true,
      allowedModules: ["payment"],
      requiredIssueId: true,
      issueIdPattern: "[",
      hint: "",
    },
    summary: "  generated\nsummary  ",
    reasons: ["  reason  ", 42 as unknown as string],
    warnings: ["  warning  "],
    confidence: "strong" as unknown as "high",
  });

  assert.equal(normalized.commitConvention.enabled, true);
  assert.deepEqual(
    normalized.commitConvention.allowedModules,
    defaultCommitConventionConfig.allowedModules,
  );
  assert.equal(normalized.summary, "generated summary");
  assert.deepEqual(normalized.reasons, ["reason"]);
  assert.equal(normalized.confidence, "medium");
  assert.ok(normalized.warnings.some((item) => /修正/.test(item)));
}

async function testOpenAiCompatibleModelListParsing(): Promise<void> {
  const models = parseModelListResponse({
    object: "list",
    data: [
      { id: "zeta-model", owner: "team" },
      { id: "alpha-model" },
      { id: 42 },
    ],
  });

  assert.deepEqual(models, [
    { id: "alpha-model", owner: undefined },
    { id: "zeta-model", owner: "team" },
  ]);
}

async function testCommitPanelCommand(): Promise<void> {
  const workspace = getSvnWorkspaceOrSkip();
  const selectedFolder = vscode.Uri.joinPath(
    workspace.uri,
    "src",
    "pages",
    "order",
  );

  await vscode.commands.executeCommand(
    "svnWorkbench.commitFolder",
    selectedFolder,
  );
}

async function testMissingFileCommitPlan(): Promise<void> {
  const workspace = getSvnWorkspaceOrSkip();
  const svnPath = await getSvnPathOrSkip();
  const scope = await createScopeFromExplorer(
    workspace.uri.fsPath,
    workspace.uri,
  );
  const candidates = await collectCommitCandidates(svnPath, scope);
  const missingReadme = candidates.find(
    (candidate) => candidate.relativePath === "docs/readme.md",
  );
  assert.ok(missingReadme);

  const preview = buildCommitPlanPreview(scope, candidates, [
    missingReadme.absolutePath,
  ]);
  assert.equal(preview.canCommit, true);
  assert.deepEqual(preview.addPaths, []);
  assert.deepEqual(preview.removePaths, [
    path.resolve(missingReadme.absolutePath),
  ]);
  assert.deepEqual(preview.commitPaths, [
    path.resolve(missingReadme.absolutePath),
  ]);
  assert.equal(preview.commands.length, 2);
}

async function testGeneratedFileCommitPlanBlock(): Promise<void> {
  const workspace = getSvnWorkspaceOrSkip();
  const svnPath = await getSvnPathOrSkip();
  const scope = await createScopeFromExplorer(
    workspace.uri.fsPath,
    workspace.uri,
  );
  const candidates = await collectCommitCandidates(svnPath, scope);
  const generated = candidates.find(
    (candidate) => candidate.relativePath === "dist",
  );
  assert.ok(generated);

  const preview = buildCommitPlanPreview(scope, candidates, [
    generated.absolutePath,
  ]);
  assert.equal(preview.canCommit, false);
  assert.equal(preview.commitPaths.length, 0);
  assert.equal(preview.issues.length, 1);
}

async function testOutOfScopeCommitPlanBlock(): Promise<void> {
  const workspace = getSvnWorkspaceOrSkip();
  const svnPath = await getSvnPathOrSkip();
  const selectedFolder = vscode.Uri.joinPath(
    workspace.uri,
    "src",
    "pages",
    "order",
  );
  const scope = await createScopeFromExplorer(
    workspace.uri.fsPath,
    selectedFolder,
  );
  const candidates = await collectCommitCandidates(svnPath, scope);
  const outOfScope = vscode.Uri.joinPath(
    workspace.uri,
    "docs",
    "readme.md",
  ).fsPath;

  const preview = buildCommitPlanPreview(scope, candidates, [outOfScope]);
  assert.equal(preview.canCommit, false);
  assert.equal(preview.commitPaths.length, 0);
  assert.equal(preview.issues.length, 1);
}

async function testCommitMessageTemplates(): Promise<void> {
  const template = applyCommitMessageTemplate("feature");
  assert.match(template, /需求/);
  assert.equal(validateCommitMessage("").valid, false);
  assert.equal(validateCommitMessage(template).valid, true);
}

async function testCommitConventionValidation(): Promise<void> {
  const config = {
    ...defaultCommitConventionConfig,
    enabled: true,
    requiredPrefix: true,
    allowedPrefixes: ["feat", "fix"],
    requiredModule: true,
    allowedModules: ["order", "user"],
    requiredIssueId: true,
  };

  assert.equal(
    validateCommitMessageConvention("fix(order): PROJ-123 修复订单列表", config)
      .valid,
    true,
  );

  const missing = validateCommitMessageConvention("修复订单列表", config);
  assert.equal(missing.valid, false);
  assert.equal(missing.issues.length, 3);

  const wrongModule = validateCommitMessageConvention(
    "fix(payment): PROJ-123 修复订单列表",
    config,
  );
  assert.equal(wrongModule.valid, false);
  assert.match(wrongModule.issues.join("\n"), /payment/);
}

async function testRepositoryCommitConventionParsing(): Promise<void> {
  const parsed = parseSvnWorkbenchProjectConfig(
    JSON.stringify({
      commitConvention: {
        enabled: true,
        requiredPrefix: true,
        allowedPrefixes: ["feat", "fix", "", 42],
        requiredModule: true,
        allowedModules: ["order", "user", "order"],
        requiredIssueId: true,
        issueIdPattern: "TASK-\\d+",
      },
    }),
  );

  assert.deepEqual(parsed.warnings, []);
  assert.equal(parsed.config?.enabled, true);
  assert.deepEqual(parsed.config?.allowedPrefixes, ["feat", "fix"]);
  assert.deepEqual(parsed.config?.allowedModules, ["order", "user"]);
  assert.equal(parsed.config?.issueIdPattern, "TASK-\\d+");

  const invalid = parseSvnWorkbenchProjectConfig("{ bad json");
  assert.equal(invalid.config, undefined);
  assert.equal(invalid.warnings.length, 1);
}

async function testRepositoryCommitConventionResolution(): Promise<void> {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "svn-workbench-team-config-"),
  );
  try {
    fs.writeFileSync(
      path.join(tempRoot, SVN_WORKBENCH_CONFIG_FILE),
      JSON.stringify({
        commitConvention: {
          enabled: true,
          requiredPrefix: true,
          allowedPrefixes: ["config"],
          requiredModule: true,
          allowedModules: ["payment"],
          requiredIssueId: true,
          issueIdPattern: "PAY-\\d+",
        },
      }),
      "utf8",
    );

    const resolution = await resolveCommitConventionConfig(tempRoot);
    assert.equal(resolution.source, "repository");
    assert.equal(resolution.config.enabled, true);
    assert.deepEqual(resolution.config.allowedPrefixes, ["config"]);
    assert.deepEqual(resolution.config.allowedModules, ["payment"]);
    assert.equal(
      validateCommitMessageConvention(
        "config(payment): PAY-321 调整支付配置",
        resolution.config,
      ).valid,
      true,
    );
  } finally {
    removeTestTempDirectory(tempRoot);
  }
}

async function testTeamConfigCreation(): Promise<void> {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "svn-workbench-create-config-"),
  );
  try {
    const configPath = await ensureSvnWorkbenchProjectConfig(tempRoot);
    assert.equal(path.basename(configPath), SVN_WORKBENCH_CONFIG_FILE);
    assert.equal(fs.existsSync(configPath), true);

    const content = fs.readFileSync(configPath, "utf8");
    const parsed = parseSvnWorkbenchProjectConfig(content);
    assert.equal(parsed.config?.enabled, true);
    assert.equal(parsed.config?.requiredIssueId, true);

    fs.writeFileSync(
      configPath,
      '{"commitConvention":{"enabled":false}}\n',
      "utf8",
    );
    await ensureSvnWorkbenchProjectConfig(tempRoot);
    assert.equal(
      fs.readFileSync(configPath, "utf8"),
      '{"commitConvention":{"enabled":false}}\n',
    );
  } finally {
    removeTestTempDirectory(tempRoot);
  }
}

async function testVisualTeamConfigInputNormalization(): Promise<void> {
  const config = buildCommitConventionConfigFromEditorInput({
    enabled: true,
    requiredPrefix: true,
    allowedPrefixesText: " feat, fix，docs\nfix ",
    requiredModule: true,
    allowedModulesText: " order； user;order ",
    requiredIssueId: true,
    issueIdPattern: "  TASK-\\d+  ",
  });

  assert.deepEqual(config.allowedPrefixes, ["feat", "fix", "docs"]);
  assert.deepEqual(config.allowedModules, ["order", "user"]);
  assert.equal(config.issueIdPattern, "TASK-\\d+");
  assert.equal(
    formatCommitConventionList(config.allowedPrefixes),
    "feat, fix, docs",
  );
}

async function testVisualTeamConfigValidation(): Promise<void> {
  const invalid = validateCommitConventionConfig({
    ...defaultCommitConventionConfig,
    enabled: true,
    requiredPrefix: true,
    allowedPrefixes: [],
    requiredModule: true,
    allowedModules: [],
    requiredIssueId: true,
    issueIdPattern: "[",
  });

  assert.equal(invalid.valid, false);
  assert.equal(invalid.issues.length, 3);

  const disabled = validateCommitConventionConfig({
    ...defaultCommitConventionConfig,
    enabled: false,
    requiredPrefix: true,
    allowedPrefixes: [],
    requiredIssueId: true,
    issueIdPattern: "[",
  });
  assert.equal(disabled.valid, true);
}

async function testTeamConfigContentUpdatePreservesOtherFields(): Promise<void> {
  const next = updateSvnWorkbenchProjectConfigContent(
    JSON.stringify({
      ai: {
        providerPreset: "deepseek",
      },
      commitConvention: {
        enabled: false,
      },
    }),
    {
      ...defaultCommitConventionConfig,
      enabled: true,
      requiredPrefix: true,
      allowedPrefixes: ["feat"],
      requiredModule: true,
      allowedModules: ["order"],
      requiredIssueId: true,
      issueIdPattern: "TASK-\\d+",
    },
  );

  assert.deepEqual(next.warnings, []);
  const parsed = JSON.parse(next.content);
  assert.equal(parsed.ai.providerPreset, "deepseek");
  assert.equal(parsed.commitConvention.enabled, true);
  assert.deepEqual(parsed.commitConvention.allowedModules, ["order"]);

  const rebuilt = updateSvnWorkbenchProjectConfigContent(
    "{ bad json",
    defaultCommitConventionConfig,
  );
  assert.equal(rebuilt.warnings.length, 1);
  assert.equal(JSON.parse(rebuilt.content).commitConvention.enabled, false);
}

async function testCommitMessageAiRequest(): Promise<void> {
  const workspace = getSvnWorkspaceOrSkip();
  const svnPath = await getSvnPathOrSkip();
  const scope = await createScopeFromExplorer(
    workspace.uri.fsPath,
    workspace.uri,
  );
  const candidates = await collectCommitCandidates(svnPath, scope);
  const missingReadme = candidates.find(
    (candidate) => candidate.relativePath === "docs/readme.md",
  );
  assert.ok(missingReadme);

  const request = buildCommitMessageAiRequest(scope, candidates, [
    missingReadme.absolutePath,
  ]);
  assert.equal(request.locale, "zh-CN");
  assert.equal(request.selectedFileCount, 1);
  assert.equal(request.omittedFileCount, 0);
  assert.deepEqual(
    request.files.map((file) => file.path),
    ["docs/readme.md"],
  );
  assert.equal(request.files[0].status, "missing");
}

async function testCommitConventionAiRequest(): Promise<void> {
  const workspace = getSvnWorkspaceOrSkip();
  const svnPath = await getSvnPathOrSkip();
  const scope = await createScopeFromExplorer(
    workspace.uri.fsPath,
    workspace.uri,
  );
  const candidates = await collectCommitCandidates(svnPath, scope);
  const missingReadme = candidates.find(
    (candidate) => candidate.relativePath === "docs/readme.md",
  );
  assert.ok(missingReadme);

  const convention = {
    ...defaultCommitConventionConfig,
    enabled: true,
    requiredPrefix: true,
    allowedPrefixes: ["docs"],
    requiredModule: true,
    allowedModules: ["docs"],
    requiredIssueId: true,
  };
  const request = buildCommitMessageAiRequest(
    scope,
    candidates,
    [missingReadme.absolutePath],
    [],
    {
      convention: toAiCommitConventionHint(convention),
    },
  );

  assert.equal(request.convention?.enabled, true);
  assert.equal(request.convention?.allowedPrefixes[0], "docs");
  assert.match(request.convention?.hint ?? "", /工单号/);
}

async function testCommitMessageAiFallback(): Promise<void> {
  const result = createMockCommitMessageResult({
    scope: ".",
    selectedFileCount: 2,
    omittedFileCount: 0,
    locale: "zh-CN",
    files: [
      {
        path: "src/order.ts",
        status: "modified",
        fileType: "ts",
        templateGroup: "frontend",
        reason: "regular change",
      },
      {
        path: "config/app.json",
        status: "modified",
        fileType: "json",
        templateGroup: "config",
        reason: "regular change",
      },
    ],
  });

  assert.match(result.message, /src\/order\.ts/);
  assert.equal(validateCommitMessage(result.message).valid, true);

  const normalized = normalizeCommitMessageResult({
    message: "  更新提交说明  ",
    summary: "  generated\nsummary  ",
    warnings: ["  注意检查  ", 42 as unknown as string],
  });
  assert.equal(normalized.message, "更新提交说明");
  assert.equal(normalized.summary, "generated summary");
  assert.deepEqual(normalized.warnings, ["注意检查"]);
}

async function testCommitConventionAiFallback(): Promise<void> {
  const convention = toAiCommitConventionHint({
    ...defaultCommitConventionConfig,
    enabled: true,
    requiredPrefix: true,
    allowedPrefixes: ["fix"],
    requiredModule: true,
    allowedModules: ["order"],
    requiredIssueId: true,
  });
  const result = createMockCommitMessageResult({
    scope: "src/pages/order",
    selectedFileCount: 1,
    omittedFileCount: 0,
    locale: "zh-CN",
    convention,
    files: [
      {
        path: "src/pages/order/OrderList.vue",
        status: "modified",
        fileType: "vue",
        templateGroup: "frontend",
        reason: "regular change",
      },
    ],
  });

  assert.match(result.message, /^fix\(order\):/);
  assert.match(result.warnings.join("\n"), /真实工单号/);
}

async function testCommitDiffSummaryParsing(): Promise<void> {
  const root = process.platform === "win32" ? "C:\\svn-wc" : "/tmp/svn-wc";
  const filePath = path.join(root, "src", "order.ts");
  const diff = [
    "Index: src/order.ts",
    "===================================================================",
    "--- src/order.ts\t(revision 1)",
    "+++ src/order.ts\t(working copy)",
    "@@ -1,3 +1,4 @@",
    " context",
    "-old line",
    "+new line",
    "+another line",
    "@@ -10,2 +11,2 @@",
    "-removed",
    "+added",
  ].join("\n");

  const summary = parseSvnUnifiedDiffSummary(diff, filePath, root);
  assert.equal(summary.relativePath, "src/order.ts");
  assert.equal(summary.addedLines, 3);
  assert.equal(summary.deletedLines, 2);
  assert.equal(summary.hunks, 2);
  assert.equal(summary.binary, false);
  assert.equal(summary.truncated, false);
}

async function testCommitMessageAiRequestDiffSummary(): Promise<void> {
  const workspace = getSvnWorkspaceOrSkip();
  const svnPath = await getSvnPathOrSkip();
  const scope = await createScopeFromExplorer(
    workspace.uri.fsPath,
    workspace.uri,
  );
  const candidates = await collectCommitCandidates(svnPath, scope);
  const missingReadme = candidates.find(
    (candidate) => candidate.relativePath === "docs/readme.md",
  );
  assert.ok(missingReadme);

  const request = buildCommitMessageAiRequest(
    scope,
    candidates,
    [missingReadme.absolutePath],
    [
      {
        absolutePath: missingReadme.absolutePath,
        relativePath: missingReadme.relativePath,
        addedLines: 1,
        deletedLines: 2,
        hunks: 1,
        binary: false,
        truncated: false,
      },
    ],
  );

  assert.equal(request.files[0].diff?.addedLines, 1);
  assert.equal(request.files[0].diff?.deletedLines, 2);
  assert.equal(
    createMockCommitMessageResult(request).summary.includes("+1 / -2"),
    true,
  );
}

async function testCommitMessageAiTemplateCompletionRequest(): Promise<void> {
  const workspace = getSvnWorkspaceOrSkip();
  const svnPath = await getSvnPathOrSkip();
  const scope = await createScopeFromExplorer(
    workspace.uri.fsPath,
    workspace.uri,
  );
  const candidates = await collectCommitCandidates(svnPath, scope);
  const missingReadme = candidates.find(
    (candidate) => candidate.relativePath === "docs/readme.md",
  );
  assert.ok(missingReadme);

  const request = buildCommitMessageAiRequest(
    scope,
    candidates,
    [missingReadme.absolutePath],
    [],
    {
      mode: "completeTemplate",
      templateId: "feature",
      templateLabel: "需求开发",
      currentMessage: "需求: 已写好的需求\n\n范围: \n影响: ",
    },
  );
  const result = createMockCommitMessageResult(request);

  assert.equal(request.mode, "completeTemplate");
  assert.equal(request.templateId, "feature");
  assert.equal(request.currentMessage?.includes("已写好的需求"), true);
  assert.match(result.message, /需求: 已写好的需求/);
  assert.match(result.message, /范围: /);
}

async function testCommitMessageTemplatePreserveMerge(): Promise<void> {
  const current = [
    "需求: 已写好的内容",
    "",
    "范围: ",
    "影响: 用户下单流程",
  ].join("\n");
  const generated = [
    "需求: AI 不应覆盖这里",
    "范围: src/pages/order，+3 / -1",
    "影响: AI 不应覆盖影响",
  ].join("\n");

  const merged = mergeCommitMessagePreservingUserContent(current, generated);
  assert.match(merged, /需求: 已写好的内容/);
  assert.match(merged, /范围: src\/pages\/order，\+3 \/ -1/);
  assert.match(merged, /影响: 用户下单流程/);
  assert.doesNotMatch(merged, /AI 不应覆盖这里/);
}

async function testCommitFlowPlanConversion(): Promise<void> {
  const workspace = getSvnWorkspaceOrSkip();
  const svnPath = await getSvnPathOrSkip();
  const scope = await createScopeFromExplorer(
    workspace.uri.fsPath,
    workspace.uri,
  );
  const candidates = await collectCommitCandidates(svnPath, scope);
  const missingReadme = candidates.find(
    (candidate) => candidate.relativePath === "docs/readme.md",
  );
  assert.ok(missingReadme);

  const preview = buildCommitPlanPreview(scope, candidates, [
    missingReadme.absolutePath,
  ]);
  const plan = toCommitFlowPlan(preview, "需求: 测试提交计划转换");
  assert.equal(plan.cwd, workspace.uri.fsPath);
  assert.deepEqual(plan.addPaths, []);
  assert.deepEqual(plan.removePaths, [
    path.resolve(missingReadme.absolutePath),
  ]);
  assert.deepEqual(plan.commitPaths, [
    path.resolve(missingReadme.absolutePath),
  ]);
  assert.equal(plan.message, "需求: 测试提交计划转换");
}

async function testCommittedRevisionParsing(): Promise<void> {
  assert.equal(
    parseCommittedRevision("Sending file\nCommitted revision 42.\n"),
    "42",
  );
  assert.equal(
    parseCommittedRevision("Enviando archivo\nConfirmada la revisión 43.\n"),
    "43",
  );
  assert.equal(parseCommittedRevision("No revision in this output"), undefined);
}

async function testRealCommitFlow(): Promise<void> {
  const svnPath = await getSvnPathOrSkip();
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "svn-workbench-real-commit-"),
  );
  const repository = path.join(tempRoot, "repository");
  const seed = path.join(tempRoot, "seed");
  const workingCopy = path.join(tempRoot, "working-copy");
  const trackedFileName =
    process.platform === "win32" ? "中文订单.txt" : "tracked.txt";
  try {
    const admin = spawnSync("svnadmin", ["create", repository], {
      encoding: "utf8",
      shell: false,
    });
    if (admin.error || admin.status !== 0)
      throw new SkippedTest(
        "svnadmin is not available for isolated commit acceptance.",
      );
    fs.mkdirSync(seed, { recursive: true });
    fs.writeFileSync(path.join(seed, trackedFileName), "base\n", "utf8");
    const repositoryUrl = `${pathToFileURL(repository).href}/trunk`;
    const imported = await runSvnCommand(
      svnPath,
      ["import", seed, repositoryUrl, "-m", "initial", "--encoding", "utf-8"],
      tempRoot,
    );
    assert.equal(imported.exitCode, 0, imported.stderr);
    const checkout = await runSvnCommand(
      svnPath,
      ["checkout", repositoryUrl, workingCopy],
      tempRoot,
    );
    assert.equal(checkout.exitCode, 0, checkout.stderr);
    fs.appendFileSync(
      path.join(workingCopy, trackedFileName),
      "changed\n",
      "utf8",
    );
    // The tracked Chinese path exercises the guarded Windows root fallback while
    // the added ASCII path proves that selected add operations remain scoped.
    const addedFileName = "added (#1).txt";
    fs.writeFileSync(path.join(workingCopy, addedFileName), "new\n", "utf8");
    const scope = createTestOperationScope(workingCopy);
    const candidates = await collectCommitCandidates(svnPath, scope);
    const selected = candidates
      .filter(
        (item) =>
          item.relativePath === trackedFileName ||
          item.relativePath === addedFileName,
      )
      .map((item) => item.absolutePath);
    const preview = buildCommitPlanPreview(scope, candidates, selected);
    assert.equal(preview.canCommit, true);
    assert.equal(preview.addPaths.length, 1);
    const result = await runCommitFlow(
      svnPath,
      toCommitFlowPlan(preview, "test: 真实提交链路"),
    );
    assert.equal(result.commitResult.exitCode, 0, result.commitResult.stderr);
    assert.equal(
      result.revision,
      "2",
      JSON.stringify({
        stdout: result.commitResult.stdout,
        stderr: result.commitResult.stderr,
      }),
    );
    const status = await runSvnCommand(
      svnPath,
      ["status", workingCopy],
      workingCopy,
    );
    assert.equal(status.stdout.trim(), "");

    if (process.platform === "win32") {
      fs.appendFileSync(
        path.join(workingCopy, trackedFileName),
        "selected unicode change\n",
        "utf8",
      );
      fs.appendFileSync(
        path.join(workingCopy, addedFileName),
        "unselected change\n",
        "utf8",
      );
      const refreshedCandidates = await collectCommitCandidates(svnPath, scope);
      const unicodeCandidate = refreshedCandidates.find(
        (item) => item.relativePath === trackedFileName,
      );
      assert.ok(unicodeCandidate);
      const guardedPreview = buildCommitPlanPreview(
        scope,
        refreshedCandidates,
        [unicodeCandidate.absolutePath],
      );
      await assert.rejects(
        runCommitFlow(
          svnPath,
          toCommitFlowPlan(guardedPreview, "test: 阻止中文路径范围扩大"),
        ),
        /未选中的可提交变更/,
      );
      const guardedStatus = await runSvnCommand(
        svnPath,
        ["status", "--xml", workingCopy],
        workingCopy,
      );
      const guardedItems = parseStatusXml(guardedStatus.stdout, workingCopy);
      assert.equal(
        guardedItems.filter((item) => item.status === "modified").length,
        2,
      );
    }
  } finally {
    removeTestTempDirectory(tempRoot);
  }
}

async function testRealAdvancedRepositoryOperations(): Promise<void> {
  const svnPath = process.env.SVN_WORKBENCH_TEST_SVN || "svn";
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "svn-workbench-advanced-"),
  );
  const repository = path.join(tempRoot, "repository");
  const seed = path.join(tempRoot, "seed");
  const workingCopy = path.join(tempRoot, "working-copy");
  try {
    fs.mkdirSync(path.join(seed, "trunk"), { recursive: true });
    fs.mkdirSync(path.join(seed, "branches"), { recursive: true });
    fs.mkdirSync(path.join(seed, "tags"), { recursive: true });
    fs.writeFileSync(
      path.join(seed, "trunk", "README.md"),
      "initial\n",
      "utf8",
    );
    const admin = spawnSync("svnadmin", ["create", repository], {
      encoding: "utf8",
      shell: false,
    });
    assert.equal(admin.status, 0, admin.stderr);
    const rootUrl = pathToFileURL(repository).href;
    assert.equal(
      (
        await runSvnCommand(
          svnPath,
          ["import", seed, rootUrl, "-m", "initialize layout"],
          tempRoot,
        )
      ).exitCode,
      0,
    );
    const trunkUrl = `${rootUrl}/trunk`;
    const branchUrl = `${rootUrl}/branches/feature-a`;
    const tagUrl = `${rootUrl}/tags/v1.0.0`;

    assert.equal(
      (
        await runSvnCommand(
          svnPath,
          ["copy", trunkUrl, branchUrl, "-m", "create branch"],
          tempRoot,
        )
      ).exitCode,
      0,
    );
    assert.equal(
      (
        await runSvnCommand(
          svnPath,
          ["copy", trunkUrl, tagUrl, "-m", "create tag"],
          tempRoot,
        )
      ).exitCode,
      0,
    );
    const list = await runSvnCommand(
      svnPath,
      ["list", "--xml", `${rootUrl}/branches`],
      tempRoot,
    );
    assert.equal(list.exitCode, 0);
    assert.ok(
      parseSvnListXml(list.stdout).some(
        (item) => item.name === "feature-a" && item.kind === "dir",
      ),
    );

    assert.equal(
      (
        await runSvnCommand(
          svnPath,
          ["checkout", trunkUrl, workingCopy],
          tempRoot,
        )
      ).exitCode,
      0,
    );
    assert.equal(
      (
        await runSvnCommand(
          svnPath,
          ["switch", branchUrl, workingCopy, "--accept", "postpone"],
          workingCopy,
        )
      ).exitCode,
      0,
    );
    const switchedInfo = await runSvnCommand(
      svnPath,
      ["info", "--show-item", "url", workingCopy],
      workingCopy,
    );
    assert.equal(decodeURI(switchedInfo.stdout.trim()), decodeURI(branchUrl));

    const readme = path.join(workingCopy, "README.md");
    fs.appendFileSync(readme, "shelved change\n", "utf8");
    const diff = await runSvnCommand(
      svnPath,
      ["diff", "README.md"],
      workingCopy,
    );
    assert.equal(diff.exitCode, 0);
    assert.equal(validatePatchText(diff.stdout).length, 0);
    const patchFile = path.join(tempRoot, "shelf.patch");
    fs.writeFileSync(patchFile, diff.stdout, { encoding: "utf8", mode: 0o600 });
    assert.equal(
      (
        await runSvnCommand(
          svnPath,
          ["revert", "--depth", "empty", readme],
          workingCopy,
        )
      ).exitCode,
      0,
    );
    assert.equal(
      (
        await runSvnCommand(
          svnPath,
          ["patch", "--dry-run", patchFile, workingCopy],
          workingCopy,
        )
      ).exitCode,
      0,
    );
    assert.equal(
      (
        await runSvnCommand(
          svnPath,
          ["patch", patchFile, workingCopy],
          workingCopy,
        )
      ).exitCode,
      0,
    );
    assert.match(fs.readFileSync(readme, "utf8"), /shelved change/);

    const log = await runSvnCommand(
      svnPath,
      ["log", "--xml", "-v", "--limit", "20", rootUrl],
      tempRoot,
    );
    assert.equal(log.exitCode, 0);
    const revisions = (
      await import("../../history/svnHistoryParser")
    ).parseSvnLogXml(log.stdout);
    const notes = buildReleaseNotes(revisions, "1", undefined, rootUrl);
    assert.ok(notes.count >= 3);
    assert.match(notes.markdown, /create branch/);
  } finally {
    removeTestTempDirectory(tempRoot);
  }
}

async function testRemoteUpdateStatusParsing(): Promise<void> {
  const workspace = getSvnWorkspaceOrSkip();
  const scope = await createScopeFromExplorer(
    workspace.uri.fsPath,
    workspace.uri,
  );
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<status>
<target path="${escapeXml(workspace.uri.fsPath)}">
<entry path="${escapeXml(vscode.Uri.joinPath(workspace.uri, "src", "pages", "order", "OrderList.vue").fsPath)}">
<wc-status item="modified" props="none"></wc-status>
<repos-status item="modified" props="none"></repos-status>
</entry>
<against revision="9"/>
</target>
</status>`;

  const result = parseRemoteUpdateStatusXml(xml, scope);
  assert.equal(result.checkedRevision, "9");
  assert.equal(result.outOfDateItems.length, 1);
  assert.equal(
    result.outOfDateItems[0].relativePath,
    "src/pages/order/OrderList.vue",
  );
  assert.equal(result.outOfDateItems[0].repositoryStatus, "modified");
}

async function testRemoteUpdateCheck(): Promise<void> {
  const workspace = getSvnWorkspaceOrSkip();
  const svnPath = await getSvnPathOrSkip();
  const scope = await createScopeFromExplorer(
    workspace.uri.fsPath,
    workspace.uri,
  );
  const candidates = await collectCommitCandidates(svnPath, scope);
  const missingReadme = candidates.find(
    (candidate) => candidate.relativePath === "docs/readme.md",
  );
  assert.ok(missingReadme);

  const result = await checkPreCommitRemoteUpdates(svnPath, scope, [
    missingReadme.absolutePath,
  ]);
  assert.equal(result.outOfDateItems.length, 0);
}

async function testUpdateScopePreview(): Promise<void> {
  const workspace = getSvnWorkspaceOrSkip();
  const selectedFolder = vscode.Uri.joinPath(
    workspace.uri,
    "src",
    "pages",
    "order",
  );
  const scope = await createScopeFromExplorer(
    workspace.uri.fsPath,
    selectedFolder,
  );
  const candidates = createCommitSelectionActionCandidates();
  const preview = buildUpdateScopePreview(scope, candidates);

  assert.equal(preview.cwd, workspace.uri.fsPath);
  assert.deepEqual(preview.updatePaths, [selectedFolder.fsPath]);
  assert.match(preview.commands[0], /svn update --accept postpone/);
  assert.equal(preview.localChanges.total, 0);
}

async function testUpdateScopeLocalChangeSummary(): Promise<void> {
  const candidates = createCommitSelectionActionCandidates();
  const repositoryRoot = path.dirname(path.dirname(candidates[0].absolutePath));
  const scope = createTestOperationScope(repositoryRoot);
  const summary = summarizeUpdateScopeLocalChanges(scope, candidates);

  assert.equal(summary.total, 4);
  assert.equal(summary.selectable, 2);
  assert.equal(summary.needsReview, 1);
  assert.equal(summary.excluded, 1);
  assert.equal(summary.blocked, 1);
  assert.equal(summary.generatedExcluded, 1);
  assert.equal(summary.byTemplateGroup.frontend, 1);
  assert.equal(summary.byTemplateGroup.config, 1);
  assert.equal(summary.byTemplateGroup.other, 2);
  assert.equal(summary.byFileType.ts, 1);
  assert.equal(summary.byFileType.json, 1);

  const srcScope: OperationScope = {
    ...scope,
    roots: [
      {
        absolutePath: path.join(repositoryRoot, "src"),
        relativePath: "src",
        kind: "folder",
      },
    ],
  };
  const srcSummary = summarizeUpdateScopeLocalChanges(srcScope, candidates);
  assert.equal(srcSummary.total, 2);
  assert.equal(srcSummary.selectable, 1);
  assert.equal(srcSummary.blocked, 1);
}

async function testUpdateScopeRemoteChangeSummary(): Promise<void> {
  const summary = summarizeUpdateScopeRemoteChanges({
    checkedRevision: "18",
    outOfDateItems: [
      {
        absolutePath: path.resolve("src/order.ts"),
        relativePath: "src/order.ts",
        repositoryStatus: "modified",
      },
      {
        absolutePath: path.resolve("docs/readme.md"),
        relativePath: "docs/readme.md",
        repositoryStatus: "modified",
      },
      {
        absolutePath: path.resolve("old/config.json"),
        relativePath: "old/config.json",
        repositoryStatus: "deleted",
      },
    ],
  });

  assert.equal(summary.checkedRevision, "18");
  assert.equal(summary.total, 3);
  assert.equal(summary.byRepositoryStatus.modified, 2);
  assert.equal(summary.byRepositoryStatus.deleted, 1);
  assert.deepEqual(
    summary.items.map((item) => item.relativePath),
    ["src/order.ts", "docs/readme.md", "old/config.json"],
  );
}

async function testUpdateScopeRiskSummary(): Promise<void> {
  const candidates = createCommitSelectionActionCandidates();
  const repositoryRoot = path.dirname(path.dirname(candidates[0].absolutePath));
  const scope = createTestOperationScope(repositoryRoot);
  const remoteChanges = summarizeUpdateScopeRemoteChanges({
    checkedRevision: "19",
    outOfDateItems: [
      {
        absolutePath: candidates[0].absolutePath,
        relativePath: candidates[0].relativePath,
        repositoryStatus: "modified",
      },
      {
        absolutePath: path.join(repositoryRoot, "docs", "readme.md"),
        relativePath: "docs/readme.md",
        repositoryStatus: "modified",
      },
    ],
  });

  const highRisk = summarizeUpdateScopeRisk(scope, candidates, remoteChanges);
  assert.equal(highRisk.level, "high");
  assert.equal(highRisk.overlapCount, 1);
  assert.deepEqual(highRisk.overlapPaths, [candidates[0].relativePath]);
  assert.match(highRisk.messages.join("\n"), /同路径重叠/);

  const failedRemoteCheck = summarizeUpdateScopeRisk(
    scope,
    [],
    undefined,
    "network timeout",
  );
  assert.equal(failedRemoteCheck.level, "medium");
  assert.match(failedRemoteCheck.messages.join("\n"), /network timeout/);

  const lowRisk = summarizeUpdateScopeRisk(scope, []);
  assert.equal(lowRisk.level, "low");
  assert.equal(lowRisk.overlapCount, 0);
}

async function testUpdateScopeRiskConfirmationMessage(): Promise<void> {
  const candidates = createCommitSelectionActionCandidates();
  const repositoryRoot = path.dirname(path.dirname(candidates[0].absolutePath));
  const scope = createTestOperationScope(repositoryRoot);
  const remoteChanges = summarizeUpdateScopeRemoteChanges({
    checkedRevision: "21",
    outOfDateItems: [
      {
        absolutePath: candidates[0].absolutePath,
        relativePath: candidates[0].relativePath,
        repositoryStatus: "modified",
      },
    ],
  });
  const preview = buildUpdateScopePreview(scope, candidates);
  preview.remoteChanges = remoteChanges;
  preview.risk = summarizeUpdateScopeRisk(scope, candidates, remoteChanges);

  const message = buildUpdateScopeRiskConfirmationMessage(preview);
  assert.match(message, /确认更新当前范围/);
  assert.match(message, /更新风险：高/);
  assert.match(message, /本地未提交：4/);
  assert.match(message, /远端变更：1/);
  assert.match(message, /同路径重叠：1/);
  assert.equal(message.includes(candidates[0].relativePath), true);
}

async function testUpdateExecutionFollowUp(): Promise<void> {
  const successWithConflict = buildUpdateExecutionFollowUp(
    {
      result: {
        command: "svn",
        args: ["update"],
        cwd: process.cwd(),
        exitCode: 0,
        stdout: "C    src/main.ts\nUpdated to revision 12.",
        stderr: "",
        durationMs: 5,
      },
      revision: "12",
      hasConflicts: true,
    },
    {
      refreshedCandidateCount: 3,
    },
  );

  assert.equal(successWithConflict.shouldRefreshCandidates, true);
  assert.equal(successWithConflict.shouldOpenConflictCenter, true);
  assert.match(successWithConflict.messages.join("\n"), /提交候选已刷新：3 个/);
  assert.match(successWithConflict.messages.join("\n"), /冲突中心/);

  const successWithRefreshError = buildUpdateExecutionFollowUp(
    {
      result: {
        command: "svn",
        args: ["update"],
        cwd: process.cwd(),
        exitCode: 0,
        stdout: "Updated to revision 12.",
        stderr: "",
        durationMs: 5,
      },
      revision: "12",
      hasConflicts: false,
    },
    {
      refreshError: "status failed",
    },
  );

  assert.equal(successWithRefreshError.shouldRefreshCandidates, true);
  assert.equal(successWithRefreshError.shouldOpenConflictCenter, false);
  assert.match(successWithRefreshError.messages.join("\n"), /status failed/);

  const failedUpdate = buildUpdateExecutionFollowUp({
    result: {
      command: "svn",
      args: ["update"],
      cwd: process.cwd(),
      exitCode: 1,
      stdout: "",
      stderr: "update failed",
      durationMs: 5,
    },
    hasConflicts: false,
  });

  assert.equal(failedUpdate.shouldRefreshCandidates, false);
  assert.equal(failedUpdate.shouldOpenConflictCenter, false);
  assert.deepEqual(failedUpdate.messages, []);
}

async function testUpdateOutputParsing(): Promise<void> {
  assert.equal(parseUpdatedRevision("Updated to revision 12."), "12");
  assert.equal(parseUpdatedRevision("At revision 13."), "13");
  assert.equal(parseUpdatedRevision("No revision"), undefined);
  assert.equal(
    hasUpdateConflicts("C    src/main.ts\nUpdated to revision 12."),
    true,
  );
  assert.equal(
    hasUpdateConflicts("U    src/main.ts\nUpdated to revision 12."),
    false,
  );
}

async function testConflictInfoParsing(): Promise<void> {
  const root =
    process.platform === "win32" ? "C:\\conflict-wc" : "/tmp/conflict-wc";
  const file = path.join(root, "order.txt");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<info>
<entry kind="file" path="${escapeXml(file)}" revision="3">
<conflict operation="update" type="text">
<version revision="2" side="source-left" kind="file" path-in-repos="trunk/order.txt" repos-url="file:///repo"/>
<version revision="3" side="source-right" kind="file" path-in-repos="trunk/order.txt" repos-url="file:///repo"/>
<prev-base-file>${escapeXml(path.join(root, "order.txt.r2"))}</prev-base-file>
<prev-wc-file>${escapeXml(path.join(root, "order.txt.mine"))}</prev-wc-file>
<cur-base-file>${escapeXml(path.join(root, "order.txt.r3"))}</cur-base-file>
</conflict>
</entry>
</info>`;

  const item = parseConflictInfoXml(xml, file, root);
  assert.equal(item.relativePath, "order.txt");
  assert.equal(item.operation, "update");
  assert.equal(item.type, "text");
  assert.equal(item.sourceLeftRevision, "2");
  assert.equal(item.sourceRightRevision, "3");
  assert.equal(item.mineFile, path.resolve(root, "order.txt.mine"));
  assert.equal(item.baseFile, path.resolve(root, "order.txt.r2"));
  assert.equal(item.theirsFile, path.resolve(root, "order.txt.r3"));
}

async function testConflictCollection(): Promise<void> {
  const workspace = getSvnWorkspaceOrSkip();
  const conflictRoot = workspace.uri.fsPath;
  const svnPath = await getSvnPathOrSkip();
  const scope = await createScopeFromExplorer(
    conflictRoot,
    vscode.Uri.file(conflictRoot),
  );
  const conflicts = await collectConflictItems(svnPath, scope);
  if (conflicts.length === 0) {
    throw new SkippedTest("The validation working copy has no conflict.");
  }
  assert.ok(conflicts.length >= 1);
  assert.equal(conflicts[0].operation, "update");
  assert.equal(conflicts[0].type, "text");
  assert.ok(conflicts[0].mineFile);
  assert.ok(conflicts[0].baseFile);
  assert.ok(conflicts[0].theirsFile);
}

async function testConflictAiRequest(): Promise<void> {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "svn-workbench-ai-conflict-"),
  );
  try {
    const baseFile = path.join(tempRoot, "order.txt.r2");
    const mineFile = path.join(tempRoot, "order.txt.mine");
    const theirsFile = path.join(tempRoot, "order.txt.r3");
    const workingFile = path.join(tempRoot, "order.txt");
    fs.writeFileSync(baseFile, "base line\n", "utf8");
    fs.writeFileSync(mineFile, "mine line\n", "utf8");
    fs.writeFileSync(theirsFile, "theirs line\n", "utf8");
    fs.writeFileSync(workingFile, "working line with long content\n", "utf8");

    const item: SvnConflictItem = {
      absolutePath: workingFile,
      relativePath: "order.txt",
      operation: "update",
      type: "text",
      sourceLeftRevision: "2",
      sourceRightRevision: "3",
      workingFile,
      mineFile,
      baseFile,
      theirsFile,
    };
    const request = await buildConflictAiRequest(item, 12);

    assert.equal(request.relativePath, "order.txt");
    assert.equal(request.contents.working?.content, "working line");
    assert.equal(request.contents.working?.truncated, true);
    assert.equal(request.contents.mine?.content, "mine line\n");
  } finally {
    removeTestTempDirectory(tempRoot);
  }
}

async function testConflictAiAdvice(): Promise<void> {
  const markerContent = [
    "<<<<<<< .mine",
    "mine value",
    "=======",
    "theirs value",
    ">>>>>>> .r3",
  ].join("\n");

  assert.equal(containsSvnConflictMarkers(markerContent), true);

  const advice = createMockConflictAdvice({
    relativePath: "order.txt",
    operation: "update",
    type: "text",
    contents: {
      working: {
        content: markerContent,
        truncated: false,
      },
    },
  });

  assert.equal(advice.recommendation, "manualMerge");
  assert.equal(advice.confidence, "low");
  assert.ok(advice.steps.length > 0);
}

async function testResolveConflictPreview(): Promise<void> {
  const workspace = getSvnWorkspaceOrSkip();
  const conflictRoot = workspace.uri.fsPath;
  const svnPath = await getSvnPathOrSkip();
  const scope = await createScopeFromExplorer(
    conflictRoot,
    vscode.Uri.file(conflictRoot),
  );
  const conflicts = await collectConflictItems(svnPath, scope);
  if (conflicts.length === 0) {
    throw new SkippedTest("The validation working copy has no conflict.");
  }
  const filePath = conflicts[0].workingFile;
  const preview = buildResolveConflictPreview(scope, filePath);
  assert.equal(preview.canResolve, true);
  assert.equal(preview.filePath, path.resolve(filePath));
  assert.match(preview.commands[0], /svn resolve --accept working/);

  const blocked = buildResolveConflictPreview(
    scope,
    path.join(path.dirname(conflictRoot), "outside.txt"),
  );
  assert.equal(blocked.canResolve, false);
  assert.equal(blocked.issues.length, 1);
}

async function testResolveConflictOutputParsing(): Promise<void> {
  assert.equal(
    isResolveSuccessful("Resolved conflicted state of 'order.txt'"),
    true,
  );
  assert.equal(isResolveSuccessful("No conflict here"), false);
}

function createSelectionEvaluation(
  decision: CommitCandidate["evaluation"]["decision"],
  overrides: Partial<CommitCandidate["evaluation"]> = {},
): CommitCandidate["evaluation"] {
  return {
    decision,
    reasonKey: "statusPolicy",
    safetyLocked: false,
    ...overrides,
  };
}

function createCommitSelectionActionCandidates(): CommitCandidate[] {
  const root = path.join(os.tmpdir(), "svn-workbench-selection-actions");
  return [
    {
      absolutePath: path.join(root, "src", "order.ts"),
      relativePath: "src/order.ts",
      status: "modified",
      fileType: "ts",
      templateGroup: "frontend",
      generatedDecision: "include",
      selection: "selected",
      reason: "常规可提交变更",
      evaluation: createSelectionEvaluation("recommended", {
        statusPolicyKey: "modified",
      }),
    },
    {
      absolutePath: path.join(root, "config", "app.json"),
      relativePath: "config/app.json",
      status: "unversioned",
      fileType: "json",
      templateGroup: "config",
      generatedDecision: "include",
      selection: "needsReview",
      reason: "未版本控制文件，需要确认是否加入 SVN",
      evaluation: createSelectionEvaluation("needsReview", {
        statusPolicyKey: "unversioned",
      }),
    },
    {
      absolutePath: path.join(root, "bin", "app.dll"),
      relativePath: "bin/app.dll",
      status: "modified",
      fileType: "dll",
      templateGroup: "other",
      generatedDecision: "exclude",
      selection: "excluded",
      reason: "命中生成物规则，默认排除",
      evaluation: createSelectionEvaluation("excluded", {
        reasonKey: "pathRule",
        matchedRuleId: "bin-debug",
        ruleSource: "builtin",
      }),
    },
    {
      absolutePath: path.join(root, "src", "order.conflicted"),
      relativePath: "src/order.conflicted",
      status: "conflicted",
      fileType: "conflicted",
      templateGroup: "other",
      generatedDecision: "include",
      selection: "blocked",
      reason: "需要先处理冲突或异常状态",
      evaluation: createSelectionEvaluation("blocked", {
        reasonKey: "safetyBlocked",
        safetyLocked: true,
      }),
    },
  ];
}

function createCommitCandidateGroupingCandidates(): CommitCandidate[] {
  const root = path.join(os.tmpdir(), "svn-workbench-candidate-grouping");
  return [
    {
      absolutePath: path.join(root, "src", "pages", "order", "OrderList.vue"),
      relativePath: "src/pages/order/OrderList.vue",
      status: "modified",
      fileType: "vue",
      templateGroup: "frontend",
      generatedDecision: "include",
      selection: "selected",
      reason: "常规可提交变更",
      evaluation: createSelectionEvaluation("recommended", {
        statusPolicyKey: "modified",
      }),
    },
    {
      absolutePath: path.join(root, "src", "pages", "user", "UserList.vue"),
      relativePath: "src/pages/user/UserList.vue",
      status: "modified",
      fileType: "vue",
      templateGroup: "frontend",
      generatedDecision: "include",
      selection: "selected",
      reason: "常规可提交变更",
      evaluation: createSelectionEvaluation("recommended", {
        statusPolicyKey: "modified",
      }),
    },
    {
      absolutePath: path.join(root, "docs", "readme.md"),
      relativePath: "docs/readme.md",
      status: "missing",
      fileType: "md",
      templateGroup: "document",
      generatedDecision: "include",
      selection: "needsReview",
      reason: "本地缺失文件，需要确认是否作为删除提交",
      evaluation: createSelectionEvaluation("needsReview", {
        statusPolicyKey: "missing",
      }),
    },
  ];
}

function createTestOperationScope(repositoryRoot: string): OperationScope {
  return {
    id: "test-scope",
    repositoryRoot: path.resolve(repositoryRoot),
    source: "workspace",
    roots: [
      {
        absolutePath: path.resolve(repositoryRoot),
        relativePath: ".",
        kind: "folder",
      },
    ],
    allowExpandScope: false,
    includeExternals: false,
    includeNestedWorkingCopies: false,
    createdAt: 0,
  };
}

function getSvnWorkspaceOrSkip(): vscode.WorkspaceFolder {
  const workspace = vscode.workspace.workspaceFolders?.[0];
  if (!workspace) {
    throw new SkippedTest("No workspace folder is open.");
  }

  if (!fs.existsSync(vscode.Uri.joinPath(workspace.uri, ".svn").fsPath)) {
    throw new SkippedTest("The open workspace is not a SVN working copy.");
  }

  return workspace;
}

async function getSvnPathOrSkip(): Promise<string> {
  const executable = await resolveSvnExecutable();
  if (!executable) {
    throw new SkippedTest("SVN executable is not available.");
  }

  return executable.path;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
