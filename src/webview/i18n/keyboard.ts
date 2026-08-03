export function isImeComposing(
  event: Pick<KeyboardEvent, "isComposing" | "keyCode">,
): boolean {
  return event.isComposing || event.keyCode === 229;
}

export function isExplicitSubmitShortcut(
  event: Pick<
    KeyboardEvent,
    "key" | "ctrlKey" | "metaKey" | "isComposing" | "keyCode"
  >,
): boolean {
  return (
    !isImeComposing(event) &&
    event.key === "Enter" &&
    (event.ctrlKey || event.metaKey)
  );
}
