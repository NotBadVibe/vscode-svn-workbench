import { describe, expect, it } from "vitest";
import {
  conflictDraftSyncedLabel,
  draftPersistenceLabels,
  draftStorageLabels,
} from "../../src/webview/i18n/terminology";
import {
  appendActivityRecord,
  createActivityStore,
} from "../../src/activity/activityStore";
import {
  clearAllListPreferences,
  clearListPreferences,
  loadListPreferences,
  preferenceStorageKey,
  saveListPreferences,
} from "../../src/webview/app/listPreferences";
import {
  projectDraftKey,
  readProjectDraft,
  writeProjectDraft,
  type ProjectDraftMap,
} from "../../src/extension/workbench/projectDraftStore";

const posix = { platform: "linux" as const, cwd: "/" };

/*
 * V024-R51 存续范围回归（真实行为断言，非源码扫描）：
 * - 会话检查点绝不标为已写文件；
 * - 重启后无正文恢复必须明示；
 * - 偏好按项目隔离、可清理、不含正文；
 * - 凭据类字段永不进入偏好存储。
 */
describe("V024-R51 会话检查点语义", () => {
  it("冲突草稿同步文案明示未写入工作副本与重启后不恢复", () => {
    for (const dirty of [true, false]) {
      const label = conflictDraftSyncedLabel(3, dirty);
      expect(label).toContain("会话检查点已保留");
      expect(label).toContain("未写入工作副本");
      expect(label).toContain("仅本次会话保留");
      expect(label).toContain("重启后不恢复");
      expect(label).toMatch(/复制|导出/);
      // 绝不使用已写文件口径
      expect(label).not.toContain("已写文件");
      expect(label).not.toContain("已保存工作副本");
      expect(label).not.toContain("已提交");
    }
  });

  it("存续三态文案区分未同步/仅会话保留/已写入工作副本", () => {
    expect(draftPersistenceLabels.unsynced).toContain("未同步");
    expect(draftPersistenceLabels.sessionOnly).toContain("仅会话保留");
    expect(draftPersistenceLabels.sessionOnly).toContain("未写入工作副本");
    expect(draftPersistenceLabels.written).toContain("已写入工作副本");
    expect(draftPersistenceLabels.restartNotice).toContain(
      "重启后草稿正文不恢复",
    );
    expect(draftPersistenceLabels.restartNotice).toContain("不是已写文件");
  });

  it("提交草稿说明不承诺仅会话保留（工作区状态可跨重启）", () => {
    expect(draftStorageLabels.sharedCommitDraft).toContain("工作区状态");
    expect(draftStorageLabels.sharedCommitDraft).toContain("尚未写入文件");
    expect(draftStorageLabels.sharedCommitDraft).not.toMatch(/仅本次会话保留/);
  });

  it("操作时间线只保留内存：追加不写盘、不记录凭据", () => {
    let store = createActivityStore(2);
    store = appendActivityRecord(store, {
      id: "a",
      capturedAt: new Date().toISOString(),
      kind: "draft-checkpoint",
      moduleId: "conflicts",
      taskId: "conflicts/resolve",
      scopeHash: "h",
      repositoryUuid: "u",
      scopeLabel: "冲突草稿 a.ts",
      impactedCount: 1,
      previewSummary:
        "会话检查点已保留（未写入工作副本，仅本次会话；重启后不恢复，请复制或导出）",
      nextActions: [],
    });
    expect(store.records).toHaveLength(1);
    expect(store.records[0].previewSummary).toContain("未写入工作副本");
    // 容量淘汰最旧（内存上限行为）
    store = appendActivityRecord(store, {
      id: "b",
      capturedAt: new Date().toISOString(),
      kind: "operation-execution",
      moduleId: "commit",
      taskId: "commit/compose",
      scopeHash: "h",
      repositoryUuid: "u",
      scopeLabel: "提交",
      impactedCount: 1,
      nextActions: [],
    });
    store = appendActivityRecord(store, {
      id: "c",
      capturedAt: new Date().toISOString(),
      kind: "operation-execution",
      moduleId: "commit",
      taskId: "commit/compose",
      scopeHash: "h",
      repositoryUuid: "u",
      scopeLabel: "提交2",
      impactedCount: 1,
      nextActions: [],
    });
    expect(store.records.map((r) => r.id)).toEqual(["c", "b"]);
  });
});

describe("V024-R51 视图偏好隔离与清理", () => {
  it("同一模块不同项目键互不串用", () => {
    saveListPreferences("r51-isolation", { sortDirection: "asc" }, "proj-a");
    saveListPreferences("r51-isolation", { sortDirection: "desc" }, "proj-b");
    expect(loadListPreferences("r51-isolation", "proj-a").sortDirection).toBe(
      "asc",
    );
    expect(loadListPreferences("r51-isolation", "proj-b").sortDirection).toBe(
      "desc",
    );
    expect(preferenceStorageKey("r51-isolation", "proj-a")).not.toBe(
      preferenceStorageKey("r51-isolation", "proj-b"),
    );
    clearListPreferences("r51-isolation", "proj-a");
    clearListPreferences("r51-isolation", "proj-b");
  });

  it("项目键缺省回退历史模块键（旧数据可读）", () => {
    saveListPreferences("r51-legacy", { density: "compact" });
    expect(loadListPreferences("r51-legacy", "proj-new").density).toBe(
      "compact",
    );
    clearListPreferences("r51-legacy");
  });

  it("只保留视图偏好键：正文与凭据类字段被丢弃", () => {
    saveListPreferences("r51-allowlist", {
      sortDirection: "asc",
      density: "comfortable",
      // @ts-expect-error 故意传入非法字段，验证运行时丢弃
      message: "草稿正文",
      // @ts-expect-error 故意传入非法字段，验证运行时丢弃
      apiKey: "secret",
    });
    const loaded = loadListPreferences("r51-allowlist");
    expect(loaded.sortDirection).toBe("asc");
    expect(loaded.density).toBe("comfortable");
    expect(loaded).not.toHaveProperty("message");
    expect(loaded).not.toHaveProperty("apiKey");
    clearListPreferences("r51-allowlist");
  });

  it("清理入口可清除指定模块与全部偏好", () => {
    saveListPreferences("r51-clear-a", { sortDirection: "asc" });
    saveListPreferences("r51-clear-b", { sortDirection: "desc" });
    clearListPreferences("r51-clear-a");
    expect(loadListPreferences("r51-clear-a").sortDirection).toBeUndefined();
    expect(loadListPreferences("r51-clear-b").sortDirection).toBe("desc");
    clearAllListPreferences();
    expect(loadListPreferences("r51-clear-b").sortDirection).toBeUndefined();
  });

  it("项目草稿键按项目根隔离（偏好层互补证据）", () => {
    let store: ProjectDraftMap = {};
    const draft = {
      message: "草稿",
      selectedPaths: [],
      scopeHash: "s1",
      savedAt: 1,
    };
    store = writeProjectDraft(
      store,
      projectDraftKey("/repo/a", "commit", "s1", posix),
      { ...draft },
    );
    expect(
      readProjectDraft(
        store,
        projectDraftKey("/repo/b", "commit", "s1", posix),
      ),
    ).toBeUndefined();
    expect(
      readProjectDraft(store, projectDraftKey("/repo/a", "commit", "s1", posix))
        ?.message,
    ).toBe("草稿");
  });
});
