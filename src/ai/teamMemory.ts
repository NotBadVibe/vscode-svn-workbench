import { createHash } from "node:crypto";
import type { Memento } from "vscode";

export const TEAM_MEMORY_MAX_ENTRIES = 50;

export interface TeamMemoryEntry {
  revision?: string;
  summary: string;
  recordedAt: string;
  source: "successful-commit";
}

export interface TeamMemorySnapshot {
  source: "当前仓库成功提交";
  entries: TeamMemoryEntry[];
  maxEntries: number;
  externallyShared: false;
}

export function teamMemoryStorageKey(repositoryIdentity: string): string {
  return `svnWorkbench.teamMemory.${createHash("sha256").update(repositoryIdentity).digest("hex")}`;
}

export function readTeamMemory(
  storage: Memento,
  repositoryIdentity: string,
): TeamMemorySnapshot {
  const value = storage.get<unknown>(teamMemoryStorageKey(repositoryIdentity));
  const entries = Array.isArray(value)
    ? value
        .map(normalizeEntry)
        .filter((entry): entry is TeamMemoryEntry => Boolean(entry))
    : [];
  return {
    source: "当前仓库成功提交",
    entries: entries.slice(0, TEAM_MEMORY_MAX_ENTRIES),
    maxEntries: TEAM_MEMORY_MAX_ENTRIES,
    externallyShared: false,
  };
}

export async function appendTeamMemory(
  storage: Memento,
  repositoryIdentity: string,
  input: { revision?: string; message: string; recordedAt?: string },
): Promise<TeamMemorySnapshot> {
  const current = readTeamMemory(storage, repositoryIdentity);
  const summary = sanitizeSummary(input.message);
  if (!summary) return current;
  const next: TeamMemoryEntry[] = [
    {
      revision: normalizeRevision(input.revision),
      summary,
      recordedAt: input.recordedAt ?? new Date().toISOString(),
      source: "successful-commit" as const,
    },
    ...current.entries.filter(
      (entry) => entry.revision !== input.revision || entry.summary !== summary,
    ),
  ].slice(0, TEAM_MEMORY_MAX_ENTRIES);
  await storage.update(teamMemoryStorageKey(repositoryIdentity), next);
  return { ...current, entries: next };
}

export async function clearTeamMemory(
  storage: Memento,
  repositoryIdentity: string,
): Promise<void> {
  await storage.update(teamMemoryStorageKey(repositoryIdentity), undefined);
}

function sanitizeSummary(message: string): string {
  return (message.split(/\r?\n/).find((line) => line.trim()) ?? "")
    .replace(/(authorization:\s*bearer\s+)[^\s]+/gi, "$1[redacted]")
    .replace(
      /(api[-_ ]?key|access[-_ ]?token|client[-_ ]?secret|password)\s*[:=]\s*\S+/gi,
      "$1=[redacted]",
    )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

function normalizeEntry(value: unknown): TeamMemoryEntry | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Partial<TeamMemoryEntry>;
  const summary =
    typeof raw.summary === "string" ? sanitizeSummary(raw.summary) : "";
  const recordedAt =
    typeof raw.recordedAt === "string" &&
    !Number.isNaN(Date.parse(raw.recordedAt))
      ? raw.recordedAt
      : undefined;
  if (!summary || !recordedAt || raw.source !== "successful-commit")
    return undefined;
  return {
    revision: normalizeRevision(raw.revision),
    summary,
    recordedAt,
    source: "successful-commit",
  };
}

function normalizeRevision(value: unknown): string | undefined {
  return typeof value === "string" && /^\d+$/.test(value) ? value : undefined;
}
