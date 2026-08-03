import { SvnRepositoryInfo } from "../svnTypes";

export function parseInfoXml(
  xml: string,
  fallbackRoot: string,
): SvnRepositoryInfo {
  return {
    workingCopyRoot: readTag(xml, "wcroot-abspath") ?? fallbackRoot,
    url: readTag(xml, "url"),
    repositoryRoot: readNestedTag(xml, "repository", "root"),
    revision: readAttribute(xml, "entry", "revision"),
  };
}

function readTag(xml: string, tag: string): string | undefined {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`).exec(xml);
  return match ? decodeXml(match[1]) : undefined;
}

function readNestedTag(
  xml: string,
  parent: string,
  tag: string,
): string | undefined {
  const parentMatch = new RegExp(`<${parent}>[\\s\\S]*?<\\/${parent}>`).exec(
    xml,
  );
  return parentMatch ? readTag(parentMatch[0], tag) : undefined;
}

function readAttribute(
  xml: string,
  tag: string,
  attribute: string,
): string | undefined {
  const match = new RegExp(`<${tag}\\s+[^>]*${attribute}="([^"]+)"`).exec(xml);
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
