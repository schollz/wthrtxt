"use client";

import { useId, useState } from "react";
import { fahrenheitToCelsius, formatTemperature } from "./units.mjs";
import type { chartTimeWindow, forecastChartSeries } from "./forecast-chart-data.mjs";

type Series = ReturnType<typeof forecastChartSeries>;
type Sample = Series["temperature"][number];
type Window = ReturnType<typeof chartTimeWindow>;

const WIDTH = 540;
const HEIGHT = 170;
const LEFT = 42;
const RIGHT = WIDTH - 40;
const TOP = 18;
const BOTTOM = HEIGHT - 30;

function visibleSamples(samples: Sample[], window: Window) {
  return samples.filter((point) => point.endTime > window.start && point.time < window.end)
    .map((point) => ({ ...point, time: Math.max(point.time, window.start) }));
}

export default function ForecastChart({ label, series, window, timeZone, metric }: {
  label: string;
  series: Series;
  window: Window;
  timeZone: string;
  metric: boolean;
}) {
  const id = useId();
  const [activeTime, setActiveTime] = useState<number | null>(null);
  const temperature = visibleSamples(series.temperature, window);
  const rain = visibleSamples(series.rain, window);
  const convert = (value: number) => metric ? fahrenheitToCelsius(value) : value;
  const values = temperature.flatMap((point) => point.value === null ? [] : [convert(point.value)]);
  const rainAvailable = rain.some((point) => point.value !== null);
  const hasData = values.length > 0 || rainAvailable;
  const minimum = values.length ? Math.min(...values) : 0;
  const maximum = values.length ? Math.max(...values) : 20;
  const step = Math.max(1, Math.ceil((maximum - minimum + 4) / 4 / 5) * 5);
  const low = Math.floor((minimum - 2) / step) * step;
  const high = Math.max(low + step * 4, Math.ceil((maximum + 2) / step) * step);
  const x = (time: number) => LEFT + (time - window.start) / (window.end - window.start) * (RIGHT - LEFT);
  const yTemp = (value: number) => BOTTOM - (convert(value) - low) / (high - low) * (BOTTOM - TOP);
  const yRain = (value: number) => BOTTOM - Math.min(100, Math.max(0, value)) / 100 * (BOTTOM - TOP);

  const paths = (samples: Sample[], y: (value: number) => number) => {
    const solid: string[] = [];
    const dashed: string[] = [];
    samples.forEach((point, index) => {
      const previous = samples[index - 1];
      if (point.value === null || !previous || previous.value === null || previous.endTime < point.time) return;
      const target = point.coarse || previous.coarse ? dashed : solid;
      target.push(`M${x(previous.time)},${y(previous.value)} L${x(point.time)},${y(point.value)}`);
    });
    return { solid: solid.join(" "), dashed: dashed.join(" ") };
  };
  const tempPaths = paths(temperature, yTemp);
  const rainPaths = paths(rain, yRain);
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
  const daily = window.dayStarts.length > 2;
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
          <span className="chart-rain">rain %</span>
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
              Temperature on the left axis; rain probability from 0 to 100 percent on the right.
              Solid lines use hourly data. Dashed lines use broader forecast periods.
              Move across the chart or use the arrow keys to inspect values. Gaps mean unavailable data.
            </desc>
            {[0, 1, 2, 3, 4].map((index) => {
              const y = BOTTOM - index / 4 * (BOTTOM - TOP);
              return <g key={index}>
                <line className="chart-grid" x1={LEFT} x2={RIGHT} y1={y} y2={y} />
                <text className="chart-temperature" x={LEFT - 8} y={y + 3} textAnchor="end">
                  {Math.round(low + index / 4 * (high - low))}°
                </text>
                <text className="chart-rain" x={RIGHT + 8} y={y + 3}>{index * 25}%</text>
              </g>;
            })}
            {daily && window.dayStarts.slice(1, -1).map((time) =>
              <line key={time} className="chart-grid chart-day-line" x1={x(time)} x2={x(time)} y1={TOP} y2={BOTTOM} />)}
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
              {" · rain "}{activeRain?.value == null ? "—" : `${Math.round(activeRain.value)}%`}
              {activeTemp?.coarse || activeRain?.coarse ? " · period forecast" : ""}
            </> : null}
          </p>
        </>
      ) : <p className="chart-note">Chart data unavailable.</p>}
    </figure>
  );
}
