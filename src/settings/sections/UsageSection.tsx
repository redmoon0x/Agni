import { invoke } from "@tauri-apps/api/core";
import { Refresh01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatCount } from "@/modules/agent-panel/lib/usage";
import {
  aggregateUsage,
  grainForPeriod,
  localDay,
  startOfPeriod,
  type UsageGrain,
  type UsagePeriod,
  type UsageReport,
} from "@/settings/sections/usageData";

const PERIODS: { id: UsagePeriod; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "week", label: "7 days" },
  { id: "month", label: "30 days" },
  { id: "year", label: "Past year" },
  { id: "all", label: "All time" },
];
const COLORS = [
  "bg-primary",
  "bg-sky-400",
  "bg-amber-400",
  "bg-emerald-400",
  "bg-violet-400",
];
const number = new Intl.NumberFormat();

function labelDate(key: string, grain: UsageGrain) {
  const date = new Date(grain === "hour" ? `${key}:00:00` : `${key}T00:00:00`);
  if (grain === "hour")
    return date.toLocaleTimeString(undefined, { hour: "numeric" });
  return date.toLocaleDateString(
    undefined,
    grain === "month"
      ? { month: "short", year: "numeric" }
      : { month: "short", day: "numeric", year: "numeric" },
  );
}

function Stat({
  title,
  value,
  detail,
}: {
  title: string;
  value: number;
  detail: string;
}) {
  return (
    <div className="rounded-xl border border-border/70 bg-card/60 p-4">
      <p className="text-[11px] font-medium text-muted-foreground">{title}</p>
      <p
        className="mt-2 font-mono text-2xl font-semibold tracking-tight tabular-nums text-foreground"
        title={number.format(value)}
      >
        {formatCount(value)}
      </p>
      <p className="mt-1 text-[10px] text-muted-foreground/80">{detail}</p>
    </div>
  );
}

function Trend({
  points,
  grain,
  allTime,
}: {
  points: { key: string; count: number }[];
  grain: UsageGrain;
  allTime: boolean;
}) {
  const max = Math.max(1, ...points.map((point) => point.count));
  const tick = Math.max(1, Math.ceil(points.length / 7));
  return (
    <section className="rounded-xl border border-border/70 bg-card/60 p-5">
      <div className="mb-5 flex items-baseline justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Token activity</h3>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {grain === "hour" ? "Hourly" : grain === "day" ? "Daily" : grain === "week" ? "Weekly" : "Monthly"} bars. Hover a bar for exact usage
            {allTime
              ? ". The chart shows up to 500 recent intervals; totals cover all history."
              : "."}
          </p>
        </div>
        <span className="font-mono text-[10px] text-muted-foreground">
          {formatCount(max)} peak
        </span>
      </div>
      <div className="overflow-x-auto pb-2">
        <div style={{ minWidth: Math.max(500, points.length * 10) }}>
          <div className="relative h-44 border-b border-border/70">
            <div
              className="pointer-events-none absolute inset-0 flex flex-col justify-between"
              aria-hidden="true"
            >
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="border-t border-dashed border-border/40"
                />
              ))}
            </div>
            <div
              className="relative flex h-full items-end gap-[3px]"
              role="img"
              aria-label={`${grain} token usage chart`}
            >
              {points.map((point) => (
                <div
                  key={point.key}
                  className="group relative flex h-full min-w-0 flex-1 items-end"
                  title={`${labelDate(point.key, grain)}: ${number.format(point.count)} tokens`}
                >
                  <div
                    className={`w-full rounded-t-[3px] transition-colors ${point.count ? "bg-primary/75 group-hover:bg-primary" : "bg-border/50"}`}
                    style={{
                      height: point.count
                        ? `${Math.max(3, (point.count / max) * 100)}%`
                        : "2px",
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
          <div className="mt-2 flex gap-[3px]">
            {points.map((point, i) => (
              <span
                key={point.key}
                className="min-w-0 flex-1 truncate text-[9px] text-muted-foreground"
                title={labelDate(point.key, grain)}
              >
                {i % tick === 0
                  ? labelDate(point.key, grain).replace(/,? \d{4}$/, "")
                  : ""}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function monthMarker(week: { key: string }[]): string {
  const first = week.find((day) => day.key.endsWith("-01"));
  return first
    ? new Date(`${first.key}T00:00:00`).toLocaleDateString(undefined, {
        month: "short",
      })
    : "";
}

function Heatmap({ days, now }: { days: Map<string, number>; now: Date }) {
  const start = startOfPeriod("year", now);
  const startDay = new Date(
    start.getFullYear(),
    start.getMonth(),
    start.getDate(),
  );
  startDay.setDate(startDay.getDate() - ((startDay.getDay() + 6) % 7));
  const max = Math.max(1, ...days.values());
  const cells: { key: string; count: number; inRange: boolean }[] = [];
  const cursor = new Date(startDay);
  while (cursor <= now && cells.length < 378) {
    const key = localDay(cursor);
    cells.push({ key, count: days.get(key) ?? 0, inRange: cursor >= start });
    cursor.setDate(cursor.getDate() + 1);
  }
  const weeks: (typeof cells)[] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return (
    <section className="rounded-xl border border-border/70 bg-card/60 p-5">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold">A year in tokens</h3>
        <span className="text-[11px] text-muted-foreground">Past year (independent of range)</span>
      </div>
      <div className="overflow-x-auto pb-2">
        <div className="min-w-[510px]">
          <div
            className="mb-2 flex gap-[3px] text-[9px] text-muted-foreground"
            aria-hidden="true"
          >
            {weeks.map((week) => (
              <span
                key={week[0].key}
                className="flex-1 overflow-visible whitespace-nowrap"
              >
                {monthMarker(week)}
              </span>
            ))}
          </div>
          <div
            className="flex gap-[3px]"
            role="img"
            aria-label="Daily token usage over the last year"
          >
            {weeks.map((week) => (
              <div key={week[0].key} className="flex flex-1 flex-col gap-[3px]">
                {week.map((day) => (
                  <div
                    key={day.key}
                    title={`${labelDate(day.key, "day")}: ${number.format(day.count)} tokens`}
                    className={`aspect-square rounded-[2px] ${!day.inRange ? "bg-transparent" : day.count === 0 ? "bg-foreground/[0.06]" : day.count / max > 0.65 ? "bg-primary" : day.count / max > 0.3 ? "bg-primary/65" : "bg-primary/30"}`}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
      <p className="mt-2 text-[10px] text-muted-foreground">
        Each square represents one day. Darker squares mean more tokens.
      </p>
    </section>
  );
}

export function UsageSection() {
  const [report, setReport] = useState<UsageReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<UsagePeriod>("month");
  const grain = grainForPeriod(period);
  const [provider, setProvider] = useState("all");
  const [source, setSource] = useState("all");
  const [now, setNow] = useState(() => new Date());
  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    setReport(null);
    void invoke<UsageReport>("usage_local_report")
      .then((data) => {
        setReport(data);
        setNow(new Date());
      })
      .catch((reason: unknown) => setError(String(reason)))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);
  const sources = useMemo(
    () => [...new Set(report?.events.map((event) => event.source) ?? [])].sort(),
    [report],
  );
  const providers = useMemo(
    () =>
      [...new Set(report?.events
        .filter((event) => source === "all" || event.source === source)
        .map((event) => event.provider) ?? [])].sort(),
    [report, source],
  );
  const stats = useMemo(
    () => aggregateUsage(report?.events ?? [], period, grain, provider, now, source),
    [report, period, grain, provider, now, source],
  );
  const year = useMemo(
    () =>
      period === "year" || period === "all"
        ? aggregateUsage(report?.events ?? [], "year", "day", provider, now, source)
        : null,
    [report, period, provider, now, source],
  );
  const maxProvider = stats.providers[0]?.[1] ?? 1;

  return (
    <div className="space-y-5 pb-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">
            Insights / Local history
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            Token usage
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Filter by agent for its session history, or by provider for its model billing route.
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-xs text-foreground transition-colors hover:bg-accent disabled:opacity-50"
        >
          <HugeiconsIcon icon={Refresh01Icon} size={13} />
          Refresh
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/70 bg-card/50 p-2">
        <span className="px-1 text-[11px] font-medium text-muted-foreground">Range</span>
        <fieldset className="flex rounded-md bg-muted/60 p-0.5">
          <legend className="sr-only">Date range</legend>
          {PERIODS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={period === item.id}
              onClick={() => setPeriod(item.id)}
              className={`rounded px-2.5 py-1.5 text-[11px] transition-colors ${period === item.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              {item.label}
            </button>
          ))}
        </fieldset>
        <label className="ml-auto flex items-center gap-2 px-1 text-[11px] text-muted-foreground">
          Agent{" "}
          <select
            aria-label="Filter by agent"
            className="max-w-40 rounded border border-border bg-background px-2 py-1.5 text-foreground outline-none focus:border-primary"
            value={source}
            onChange={(e) => {
              setSource(e.target.value);
              setProvider("all");
            }}
          >
            <option value="all">All agents</option>
            {sources.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 px-1 text-[11px] text-muted-foreground">
          Model provider{" "}
          <select
            aria-label="Filter by provider"
            className="max-w-40 rounded border border-border bg-background px-2 py-1.5 text-foreground outline-none focus:border-primary"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
          >
            <option value="all">All providers</option>
            {providers.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-destructive/40 bg-destructive/5 p-5 text-sm text-destructive"
        >
          Could not read local usage: {error}
        </div>
      ) : null}
      {loading && !report ? (
        <div
          role="status"
          className="rounded-xl border border-border p-12 text-center text-sm text-muted-foreground"
        >
          Reading local session history...
        </div>
      ) : null}
      {report && !loading && !report.events.length ? (
        <div className="rounded-xl border border-border bg-card/50 p-10 text-center">
          <h2 className="text-sm font-medium">No token history found</h2>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            No supported local usage history was found. Agni reads Claude Code,
            Pi, CommandCode, OpenCode and Hermes histories on this device.
            Nothing is uploaded or saved by Agni.
          </p>
        </div>
      ) : null}
      {report?.events.length ? (
        <>
          <p className="text-xs text-muted-foreground">
            Usage for <span className="font-medium text-foreground">{PERIODS.find((item) => item.id === period)?.label}</span>
            {source !== "all" ? ` · ${source}` : " · All agents"}
            {provider !== "all" ? ` · ${provider}` : ""}
          </p>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat
              title="Total tokens"
              value={stats.total}
              detail="Input + output + cache"
            />
            <Stat
              title="Input"
              value={stats.input}
              detail="New prompt tokens"
            />
            <Stat
              title="Output"
              value={stats.output}
              detail="Generated tokens"
            />
            <Stat
              title="Cache"
              value={stats.cacheRead + stats.cacheWrite}
              detail="Read + written tokens"
            />
          </div>
          {stats.total === 0 ? (
            <div className="rounded-xl border border-border bg-card/50 p-6 text-center text-xs text-muted-foreground">
              No usage in this range. Try a wider range, another agent or another provider.
            </div>
          ) : null}
          <Trend
            points={stats.points}
            grain={grain}
            allTime={period === "all"}
          />
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-xl border border-border/70 bg-card/60 p-5">
              <h3 className="text-sm font-semibold">By provider</h3>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Share of selected period
              </p>
              <div className="mt-5 space-y-4">
                {stats.providers.length ? (
                  stats.providers.map(([name, count], i) => (
                    <div key={name}>
                      <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
                        <span className="truncate text-foreground">{name}</span>
                        <span
                          className="font-mono tabular-nums text-muted-foreground"
                          title={number.format(count)}
                        >
                          {formatCount(count)}
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted">
                        <div
                          className={`h-full rounded-full ${COLORS[i % COLORS.length]}`}
                          style={{ width: `${(count / maxProvider) * 100}%` }}
                        />
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No data in this range
                  </p>
                )}
              </div>
            </section>
            <section className="rounded-xl border border-border/70 bg-card/60 p-5">
              <h3 className="text-sm font-semibold">Token mix</h3>
              <p className="mt-1 text-[11px] text-muted-foreground">
                What went into your total
              </p>
              <div className="mt-6 flex h-3 overflow-hidden rounded-full bg-muted">
                {(
                  [
                    ["input", stats.input],
                    ["output", stats.output],
                    ["cacheRead", stats.cacheRead],
                    ["cacheWrite", stats.cacheWrite],
                  ] as const
                ).map(([key, value], i) => (
                  <div
                    key={key}
                    className={COLORS[i]}
                    style={{
                      width: `${stats.total ? (value / stats.total) * 100 : 0}%`,
                    }}
                  />
                ))}
              </div>
              <div className="mt-5 grid grid-cols-2 gap-3">
                {[
                  ["Input", stats.input],
                  ["Output", stats.output],
                  ["Cache read", stats.cacheRead],
                  ["Cache write", stats.cacheWrite],
                ].map(([label, value], i) => (
                  <div
                    key={label}
                    className="flex items-center gap-2 text-[11px]"
                  >
                    <span
                      className={`h-2 w-2 shrink-0 rounded-sm ${COLORS[i]}`}
                    />
                    <span className="text-muted-foreground">{label}</span>
                    <span className="ml-auto font-mono tabular-nums">
                      {formatCount(value as number)}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </div>
          {year ? <Heatmap days={year.days} now={now} /> : null}
        </>
      ) : null}
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Read-only from local Claude Code, Pi, CommandCode, OpenCode and Hermes
        histories. Hermes stores session totals rather than per-turn usage, so
        its chart activity is placed on each session's last activity date.
        Other ACP agents without supported usage logs cannot be counted.
        No background tracking, network requests or Agni usage database.{" "}
        {report
          ? `${number.format(report.filesScanned)} history files scanned.${report.truncated ? " Scan incomplete or a source was unavailable; totals may be incomplete." : ""}`
          : ""}
      </p>
    </div>
  );
}
