"use client";

import { useEffect, useId, useState } from "react";
import { fahrenheitToCelsius, formatTemperature } from "./units.mjs";
import { formatRainfallColumn } from "./precipitation.mjs";
import { rainfallChartScale } from "./forecast-chart-data.mjs";
import { temperatureCurveSegments, temperatureSpreadSegments } from "./temperature-spread.mjs";
import type { CurveSegment, RecordRange } from "./temperature-spread.mjs";
import type { chartTimeWindow, forecastChartSeries } from "./forecast-chart-data.mjs";

type Series = ReturnType<typeof forecastChartSeries>;
type Sample = Series["temperature"][number];
type Window = ReturnType<typeof chartTimeWindow>;

const WIDTH = 540;
const HEIGHT = 170;
const LEFT = 42;
const RIGHT = WIDTH - 52;
const TOP = 18;
const BOTTOM = HEIGHT - 30;

function visibleSamples(samples: Sample[], window: Window) {
  return samples.filter((point) => point.endTime > window.start && point.time < window.end)
    .map((point) => ({ ...point, time: Math.max(point.time, window.start) }));
}

export default function ForecastChart({ label, series, window, timeZone, metric, recordSpreads = [] }: {
  label: string;
  series: Series;
  window: Window;
  timeZone: string;
  metric: boolean;
  recordSpreads?: RecordRange[];
}) {
  const id = useId();
  const [activeTime, setActiveTime] = useState<number | null>(null);
  const [currentTime, setCurrentTime] = useState(() => new Date().getTime());
  const daily = window.dayStarts.length > 2;

  useEffect(() => {
    if (daily) return;
    const interval = globalThis.setInterval(() => setCurrentTime(new Date().getTime()), 60_000);
    return () => globalThis.clearInterval(interval);
  }, [daily]);

  const temperature = visibleSamples(series.temperature, window);
  const spread = daily ? temperatureSpreadSegments(temperature, recordSpreads) : [];
  const rain = visibleSamples(series.rainfall, window);
  const convert = (value: number) => metric ? fahrenheitToCelsius(value) : value;
  const convertRain = (value: number) => metric ? value * 25.4 : value;
  const rainScale = rainfallChartScale(rain.map((point) => point.value), metric);
  const values = temperature.flatMap((point) => point.value === null ? [] : [convert(point.value)]);
  const spreadValues = spread.flatMap(({ upper, lower }) => [upper, lower]
    .flatMap((curve) => [curve.start, curve.control1, curve.control2, curve.end].map((point) => convert(point.value))));
  const extent = [...values, ...spreadValues];
  const rainAvailable = rain.some((point) => point.value !== null);
  const hasData = values.length > 0 || rainAvailable;
  const minimum = extent.length ? Math.min(...extent) : 0;
  const maximum = extent.length ? Math.max(...extent) : 20;
  const step = Math.max(1, Math.ceil((maximum - minimum + 4) / 4 / 5) * 5);
  const low = Math.floor((minimum - 2) / step) * step;
  const high = Math.max(low + step * 4, Math.ceil((maximum + 2) / step) * step);
  const x = (time: number) => LEFT + (time - window.start) / (window.end - window.start) * (RIGHT - LEFT);
  const yTemp = (value: number) => BOTTOM - (convert(value) - low) / (high - low) * (BOTTOM - TOP);
  const yRain = (value: number) => BOTTOM - Math.max(0, convertRain(value)) / rainScale.maximum * (BOTTOM - TOP);

  const paths = (samples: Sample[], y: (value: number) => number, connectGaps = false) => {
    const solid: string[] = [];
    const dashed: string[] = [];
    const points = connectGaps ? samples.filter((point) => point.value !== null) : samples;
    points.forEach((point, index) => {
      const previous = points[index - 1];
      if (point.value === null || !previous || previous.value === null ||
        (!connectGaps && previous.endTime < point.time)) return;
      const target = point.coarse || previous.coarse ? dashed : solid;
      target.push(`M${x(previous.time)},${y(previous.value)} L${x(point.time)},${y(point.value)}`);
    });
    return { solid: solid.join(" "), dashed: dashed.join(" ") };
  };
  const curveCommand = (curve: CurveSegment) =>
    `C${x(curve.control1.time)},${yTemp(curve.control1.value)} ${x(curve.control2.time)},${yTemp(curve.control2.value)} ${x(curve.end.time)},${yTemp(curve.end.value)}`;
  const tempCurves = daily ? temperatureCurveSegments(temperature) : [];
  const tempPaths = daily ? {
    solid: tempCurves.filter((curve) => !curve.coarse).map((curve) =>
      `M${x(curve.start.time)},${yTemp(curve.start.value)} ${curveCommand(curve)}`).join(" "),
    dashed: tempCurves.filter((curve) => curve.coarse).map((curve) =>
      `M${x(curve.start.time)},${yTemp(curve.start.value)} ${curveCommand(curve)}`).join(" "),
  } : paths(temperature, yTemp);
  const spreadGroups: typeof spread[] = [];
  spread.forEach((segment) => {
    const group = spreadGroups[spreadGroups.length - 1];
    if (group && group[group.length - 1].upper.end.time === segment.upper.start.time) group.push(segment);
    else spreadGroups.push([segment]);
  });
  const spreadPath = spreadGroups.map((group) => {
    const first = group[0].upper.start;
    const last = group[group.length - 1].lower.end;
    return `M${x(first.time)},${yTemp(first.value)} ${group.map(({ upper }) => curveCommand(upper)).join(" ")}
      L${x(last.time)},${yTemp(last.value)} ${[...group].reverse().map(({ lower }) => curveCommand({
        ...lower, start: lower.end, control1: lower.control2, control2: lower.control1, end: lower.start,
      })).join(" ")} Z`;
  }).join(" ");
  const rainPaths = paths(rain, yRain, !daily);
  const times = [...new Set([...temperature, ...rain].map((point) => point.time))].sort((a, b) => a - b);
  const nearestTime = (time: number) => times.reduce((nearest, candidate) =>
    Math.abs(candidate - time) < Math.abs(nearest - time) ? candidate : nearest, times[0]);
  const sampleAt = (samples: Sample[], time: number) => samples.find((point) =>
    point.time <= time && point.endTime > time);
  const activeTemp = activeTime === null ? null : sampleAt(temperature, activeTime);
  const activeRain = activeTime === null ? null : sampleAt(rain, activeTime);
  const timeLabel = (time: number, daily = false) => new Intl.DateTimeFormat("en-US", {
    timeZone,
    ...(daily ? { weekday: "short" as const } : { hour: "numeric" as const }),
  }).format(time);
  const ticks = daily
    ? window.dayStarts.slice(0, -1).map((time, index) => ({
        time: time + (window.dayStarts[index + 1] - time) / 2,
        label: timeLabel(time, true),
      }))
    : Array.from({ length: 5 }, (_, index) => {
        const time = window.start + (window.end - window.start) * index / 4;
        return { time, label: timeLabel(time) };
      });

  return (
    <figure className="forecast-chart" aria-label={label}>
      <figcaption className="chart-heading">
        <span className="chart-legend">
          <span className="chart-temperature">temp (°{metric ? "C" : "F"})</span>
          {spread.length > 0 && <span className="chart-spread-key">record spread</span>}
          <span className="chart-rain">fall ({metric ? "mm" : "in."})</span>
        </span>
      </figcaption>
      {hasData ? (
        <>
          <svg className="chart-plot" viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            role="img" aria-label={label} aria-describedby={`${id}-description`} tabIndex={0}
            onPointerMove={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              const position = (event.clientX - rect.left) / rect.width * WIDTH;
              const time = window.start + (position - LEFT) / (RIGHT - LEFT) * (window.end - window.start);
              setActiveTime(nearestTime(time));
            }}
            onPointerLeave={() => setActiveTime(null)}
            onBlur={() => setActiveTime(null)}
            onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const index = activeTime === null ? -1 : times.indexOf(activeTime);
              setActiveTime(times[event.key === "Home" ? 0 : event.key === "End" ? times.length - 1
                : Math.max(0, Math.min(times.length - 1, index + (event.key === "ArrowLeft" ? -1 : 1)))]);
            }}>
            <desc id={`${id}-description`}>
              Temperature on the left axis; hourly rainfall in {metric ? "millimeters" : "inches"} on the right.
              Earlier hours use historical rainfall readings; future hours use forecasts.
              Dashed temperature lines use broader forecast periods.
              {spread.length > 0 && "The shaded band is a variation proxy, centered on the forecast using half the historical record range on each side."}
              Move across the chart or use the arrow keys to inspect values. Gaps mean unavailable data.
              {!daily && "The rainfall line interpolates between available readings across missing hours."}
            </desc>
            {spreadPath && <path className="chart-temperature-spread" d={spreadPath} aria-hidden="true" />}
            {[0, 1, 2, 3, 4].map((index) => {
              const y = BOTTOM - index / 4 * (BOTTOM - TOP);
              return <g key={index}>
                <line className="chart-grid" x1={LEFT} x2={RIGHT} y1={y} y2={y} />
                <text className="chart-temperature" x={LEFT - 8} y={y + 3} textAnchor="end">
                  {Math.round(low + index / 4 * (high - low))}°
                </text>
                <text className="chart-rain" x={RIGHT + 8} y={y + 3}>
                  {(index / 4 * rainScale.maximum).toFixed(rainScale.precision)}
                </text>
              </g>;
            })}
            {daily && window.dayStarts.slice(1, -1).map((time) =>
              <line key={time} className="chart-grid chart-day-line" x1={x(time)} x2={x(time)} y1={TOP} y2={BOTTOM} />)}
            {!daily && currentTime >= window.start && currentTime < window.end && (
              <line className="chart-grid chart-now-line" aria-hidden="true"
                x1={x(currentTime)} x2={x(currentTime)} y1={TOP} y2={BOTTOM} />
            )}
            {ticks.map((tick) => <text key={tick.time} className="chart-time" x={x(tick.time)} y={HEIGHT - 7} textAnchor="middle">{tick.label}</text>)}
            <g className="chart-series chart-rain">
              <path d={rainPaths.solid} />
              <path d={rainPaths.dashed} strokeDasharray="4 4" />
              {rain.filter((point) => point.value !== null).map((point) =>
                <circle key={point.time} cx={x(point.time)} cy={yRain(point.value!)} r={point.coarse ? 2 : 1} />)}
            </g>
            <g className="chart-series chart-temperature">
              <path d={tempPaths.solid} />
              <path d={tempPaths.dashed} strokeDasharray="4 4" />
              {temperature.filter((point) => point.value !== null).map((point) =>
                <circle key={point.time} cx={x(point.time)} cy={yTemp(point.value!)} r={point.coarse ? 2 : 1} />)}
            </g>
            {activeTime !== null && <line className="chart-cursor" x1={x(activeTime)} x2={x(activeTime)} y1={TOP} y2={BOTTOM} />}
          </svg>
          <p className="chart-note" aria-live="polite">
            {activeTime !== null ? <>
              {new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "numeric", minute: "2-digit" }).format(activeTime)}
              {" · "}{formatTemperature(activeTemp?.value, metric)}
              {" · fall "}{activeRain?.value == null ? "—" :
                `${formatRainfallColumn(activeRain.value, metric, true)} ${metric ? "mm" : "in."}`}
              {activeRain?.value != null && activeRain.source ?
                ` · ${activeRain.source === "estimated" ? "model estimate" : activeRain.source}` : ""}
              {activeTemp?.coarse || activeRain?.coarse ? " · period forecast" : ""}
            </> : null}
          </p>
        </>
      ) : <p className="chart-note">Chart data unavailable.</p>}
    </figure>
  );
}
