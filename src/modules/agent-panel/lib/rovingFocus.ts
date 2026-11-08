import type { KeyboardEvent } from "react";

/**
 * Arrow/Home/End navigation across the rows inside the nearest
 * `[data-agent-list]` container. Attach to each focusable row.
 */
export function handleAgentRowNavigation(
  event: KeyboardEvent<HTMLElement>,
): void {
  if (
    event.key !== "ArrowDown" &&
    event.key !== "ArrowUp" &&
    event.key !== "Home" &&
    event.key !== "End"
  ) {
    return;
  }
  const list = event.currentTarget.closest("[data-agent-list]");
  if (!list) return;
  const rows = Array.from(
    list.querySelectorAll<HTMLElement>("[data-agent-row]"),
  );
  if (rows.length === 0) return;
  event.preventDefault();
  const current = rows.indexOf(document.activeElement as HTMLElement);
  let next = 0;
  if (event.key === "End") next = rows.length - 1;
  else if (event.key === "ArrowDown")
    next = current < 0 ? 0 : Math.min(rows.length - 1, current + 1);
  else if (event.key === "ArrowUp")
    next = current < 0 ? rows.length - 1 : Math.max(0, current - 1);
  rows[next]?.focus();
}
