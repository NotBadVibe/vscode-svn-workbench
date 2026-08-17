const zhCnTimeZone = "Asia/Shanghai";

const dateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: zhCnTimeZone,
});

const timeFormatter = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: zhCnTimeZone,
});

const datePartsFormatter = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: zhCnTimeZone,
});

const numberFormatter = new Intl.NumberFormat("zh-CN");

export function formatZhNumber(value: number): string {
  return numberFormatter.format(value);
}

export function formatZhDateTime(
  value: string | number | Date,
  now: string | number | Date = new Date(),
): string {
  const date = new Date(value);
  const reference = new Date(now);
  if (!Number.isFinite(date.getTime()) || !Number.isFinite(reference.getTime()))
    return "未知时间";

  const day = startOfZhCnDay(date);
  const today = startOfZhCnDay(reference);
  const difference = Math.round((today - day) / 86_400_000);
  const time = timeFormatter.format(date);
  if (difference === 0) return `今天 ${time}`;
  if (difference === 1) return `昨天 ${time}`;
  return dateTimeFormatter.format(date).replaceAll("/", "-");
}

export function formatZhTime(value: string | number | Date): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? timeFormatter.format(date)
    : "未知时间";
}

export function formatCount(
  value: number,
  unit: "文件" | "修订" | "路径" | "冲突" | "项目" | "步骤" | "字符",
): string {
  const classifiers = {
    文件: "个文件",
    修订: "条修订",
    路径: "条路径",
    冲突: "处冲突",
    项目: "个项目",
    步骤: "个步骤",
    字符: "个字符",
  } as const;
  return `${formatZhNumber(value)} ${classifiers[unit]}`;
}

/** 文件大小（设计基线 §2.4：`12.4 MB` 形式；未知大小返回 “—”）。 */
export function formatZhFileSize(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value) || value < 0) return "—";
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = value;
  let unitIndex = -1;
  do {
    size /= 1024;
    unitIndex += 1;
  } while (size >= 1024 && unitIndex < units.length - 1);
  return `${size >= 100 ? size.toFixed(0) : size.toFixed(1)} ${units[unitIndex]}`;
}

function startOfZhCnDay(value: Date): number {
  const parts = datePartsFormatter.formatToParts(value);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);
  return Date.UTC(year, month - 1, day);
}
