export type UsageEvent = {
  timestamp: string;
  source: string;
  provider: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

export type UsageReport = {
  events: UsageEvent[];
  filesScanned: number;
  truncated: boolean;
};

export type UsagePeriod = "today" | "week" | "month" | "year" | "all";
export type UsageGrain = "hour" | "day" | "week" | "month";

export function grainForPeriod(period: UsagePeriod): UsageGrain {
  if (period === "today") return "hour";
  if (period === "year") return "week";
  if (period === "all") return "month";
  return "day";
}

export function localDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function bucketKey(date: Date, grain: UsageGrain): string {
  if (grain === "hour")
    return `${localDay(date)}T${String(date.getHours()).padStart(2, "0")}`;
  if (grain === "month")
    return localDay(new Date(date.getFullYear(), date.getMonth(), 1));
  if (grain === "week") {
    const monday = new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
    );
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    return localDay(monday);
  }
  return localDay(date);
}

export function tokenCount(event: UsageEvent): number {
  return event.input + event.output + event.cacheRead + event.cacheWrite;
}

export function startOfPeriod(period: UsagePeriod, now: Date): Date {
  if (period === "all") return new Date(0);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === "week") start.setDate(start.getDate() - 6);
  if (period === "month") start.setDate(start.getDate() - 29);
  if (period === "year") start.setDate(start.getDate() - 364);
  return start;
}

export function aggregateUsage(
  events: UsageEvent[],
  period: UsagePeriod,
  grain: UsageGrain,
  provider: string,
  now: Date,
  source = "all",
) {
  const start = startOfPeriod(period, now).getTime();
  const end = now.getTime();
  const buckets = new Map<string, number>();
  const providers = new Map<string, number>();
  const days = new Map<string, number>();
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  for (const event of events) {
    const date = new Date(event.timestamp);
    const time = date.getTime();
    if (!Number.isFinite(time) || time < start || time > end) continue;
    if (source !== "all" && source !== event.source) continue;
    if (provider !== "all" && provider !== event.provider) continue;
    const count = tokenCount(event);
    input += event.input;
    output += event.output;
    cacheRead += event.cacheRead;
    cacheWrite += event.cacheWrite;
    const key = bucketKey(date, grain);
    buckets.set(key, (buckets.get(key) ?? 0) + count);
    const day = localDay(date);
    days.set(day, (days.get(day) ?? 0) + count);
    providers.set(event.provider, (providers.get(event.provider) ?? 0) + count);
  }
  const first =
    period === "all" && buckets.size
      ? new Date(`${[...buckets.keys()].sort()[0]}T00:00:00`)
      : period === "all"
        ? new Date(now)
        : new Date(start);
  const points: { key: string; count: number }[] = [];
  const cursor = new Date(
    first.getFullYear(),
    first.getMonth(),
    first.getDate(),
  );
  if (grain === "day" && now.getTime() - cursor.getTime() > 499 * 86_400_000) {
    cursor.setTime(now.getTime());
    cursor.setDate(cursor.getDate() - 499);
  }
  if (
    grain === "week" &&
    now.getTime() - cursor.getTime() > 499 * 7 * 86_400_000
  ) {
    cursor.setTime(now.getTime());
    cursor.setDate(cursor.getDate() - 499 * 7);
  }
  if (
    grain === "month" &&
    now.getFullYear() * 12 +
      now.getMonth() -
      (cursor.getFullYear() * 12 + cursor.getMonth()) >
      499
  ) {
    cursor.setFullYear(now.getFullYear(), now.getMonth() - 499, 1);
  }
  const last = bucketKey(now, grain);
  while (bucketKey(cursor, grain) <= last && points.length < 500) {
    const key = bucketKey(cursor, grain);
    if (points[points.length - 1]?.key !== key)
      points.push({ key, count: buckets.get(key) ?? 0 });
    if (grain === "month") cursor.setMonth(cursor.getMonth() + 1);
    else if (grain === "hour") cursor.setHours(cursor.getHours() + 1);
    else cursor.setDate(cursor.getDate() + (grain === "week" ? 7 : 1));
  }
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    total: input + output + cacheRead + cacheWrite,
    points,
    days,
    providers: [...providers].sort((a, b) => b[1] - a[1]),
  };
}
