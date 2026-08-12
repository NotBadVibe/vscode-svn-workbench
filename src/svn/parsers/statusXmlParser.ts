import * as path from "node:path";
import { SvnStatus, SvnStatusItem } from "../svnTypes";

/**
 * 目标自身 `svn status --xml <target>` 的 file-external 标记（v0.0.6 页内
 * 编辑边界：同仓库 file external 的 wc-root/UUID 与主工作副本相同，只能
 * 靠该标记识别）。仅解析首个 entry 的 wc-status 属性，不做字符串猜测。
 */
export function parseFileExternalFlag(xml: string): boolean {
  const wcStatus = /<wc-status\s+([^>]+)>?/.exec(xml);
  if (!wcStatus) return false;
  return getAttribute(wcStatus[1], "file-external") === "true";
}

export function parseStatusXml(
  xml: string,
  scopeRoot: string,
): SvnStatusItem[] {
  const items: SvnStatusItem[] = [];
  const entryPattern = /<entry\s+path="([^"]+)"\s*>([\s\S]*?)<\/entry>/g;
  let entryMatch: RegExpExecArray | null;

  while ((entryMatch = entryPattern.exec(xml)) !== null) {
    const entryPath = decodeXml(entryMatch[1]);
    const body = entryMatch[2];
    const wcStatus = /<wc-status\s+([^>]+)>?/.exec(body);
    if (!wcStatus) {
      continue;
    }

    const item = getAttribute(wcStatus[1], "item");
    const props = getAttribute(wcStatus[1], "props");
    const absolutePath = path.resolve(scopeRoot, entryPath);
    items.push({
      absolutePath,
      relativePath:
        path.relative(scopeRoot, absolutePath) || path.basename(absolutePath),
      status: mapSvnStatus(item),
      propStatus: props ? mapSvnStatus(props) : undefined,
    });
  }

  return items;
}

function getAttribute(source: string, name: string): string | undefined {
  const match = new RegExp(`${name}="([^"]+)"`).exec(source);
  return match ? decodeXml(match[1]) : undefined;
}

function decodeXml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function mapSvnStatus(value: string | undefined): SvnStatus {
  switch (value) {
    case "normal":
      return "normal";
    case "modified":
      return "modified";
    case "added":
      return "added";
    case "deleted":
      return "deleted";
    case "missing":
      return "missing";
    case "unversioned":
      return "unversioned";
    case "conflicted":
      return "conflicted";
    case "ignored":
      return "ignored";
    case "external":
      return "external";
    case "obstructed":
      return "obstructed";
    case "replaced":
      return "replaced";
    case "incomplete":
      return "incomplete";
    default:
      return "unknown";
  }
}
