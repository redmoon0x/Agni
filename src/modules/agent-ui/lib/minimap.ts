export type MinimapEntry = {
  tone: "user" | "agent" | "tool";
  error?: boolean;
};

export type MinimapMarker = {
  /** 0..1 position along the thread. */
  position: number;
  tone: "user" | "agent" | "tool" | "error";
};

/**
 * Sample a thread down to a bounded number of markers. Positions are normalized
 * so the rail maps directly onto the scroll range.
 */
export function minimapMarkers(
  entries: readonly MinimapEntry[],
  limit = 200,
): MinimapMarker[] {
  const total = entries.length;
  if (total === 0) return [];
  const step = Math.max(1, Math.ceil(total / limit));
  const markers: MinimapMarker[] = [];
  for (let index = 0; index < total; index += step) {
    const entry = entries[index];
    markers.push({
      position: total === 1 ? 0 : index / (total - 1),
      tone: entry.error ? "error" : entry.tone,
    });
  }
  return markers;
}
