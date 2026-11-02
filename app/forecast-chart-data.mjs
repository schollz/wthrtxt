import {
  forecastPrecipitationForPeriod,
  hourlyPrecipitationIntervals,
} from "./precipitation.mjs";

const HOUR_MS = 60 * 60 * 1000;

/**
 * @typedef {{ startTime: string; endTime: string; temperature: number | null;
 * forecastPrecipitationInches?: number | null }} ForecastPeriod
 * @typedef {{ time: number; endTime: number; value: number | null;
 * coarse: boolean }} ChartSample
 */

/**
 * Keep hourly temperatures, then use remaining day/night periods. Rainfall
 * is an hourly amount in inches, allocated from the original interval totals.
 * @param {ForecastPeriod[]} hourly
 * @param {ForecastPeriod[]} daily
 * @param {import("./precipitation.mjs").PrecipitationInterval[]} [precipitationIntervals]
 */
export function forecastChartSeries(
  hourly,
  daily,
  precipitationIntervals = hourlyPrecipitationIntervals(hourly),
) {
  /** @param {(period: ForecastPeriod) => number | null | undefined} readValue */
  const series = (readValue) => {
    /** @param {ForecastPeriod} period @param {boolean} coarse @returns {ChartSample} */
    const sample = (period, coarse) => {
      const value = readValue(period);
      return {
        time: Date.parse(period.startTime),
        endTime: Date.parse(period.endTime),
        value: typeof value === "number" && Number.isFinite(value) ? value : null,
        coarse,
      };
    };

    const fine = hourly.map((period) => sample(period, false))
      .filter((point) => Number.isFinite(point.time) && point.endTime > point.time)
      .sort((a, b) => a.time - b.time);
    const coverageEnd = Math.max(-Infinity,
      ...fine.filter((point) => point.value !== null).map((point) => point.endTime));
    const coarse = daily.map((period) => sample(period, true))
      .filter((point) => Number.isFinite(point.time) && point.endTime > Math.max(point.time, coverageEnd))
      .map((point) => ({ ...point, time: Math.max(point.time, coverageEnd) }));

    return [...fine.filter((point) => point.time < coverageEnd), ...coarse]
      .sort((a, b) => a.time - b.time);
  };

  /** @type {ChartSample[]} */
  const rainfall = [];
  const start = Math.min(...precipitationIntervals.map((interval) => interval.startTime));
  const end = Math.max(...precipitationIntervals.map((interval) => interval.endTime));
  for (let time = start; time < end; time += HOUR_MS) {
    const endTime = Math.min(time + HOUR_MS, end);
    rainfall.push({
      time,
      endTime,
      value: forecastPrecipitationForPeriod(precipitationIntervals, time, endTime),
      coarse: false,
    });
  }

  return {
    temperature: series((period) => period.temperature),
    rainfall,
  };
}

/** A nonnegative rainfall axis in the displayed units, including dry days.
 * @param {Array<number | null>} amountsInches
 * @param {boolean} metric
 */
export function rainfallChartScale(amountsInches, metric) {
  const values = amountsInches.flatMap((value) =>
    value !== null && Number.isFinite(value) && value >= 0
      ? [metric ? value * 25.4 : value]
      : []);
  const rawStep = Math.max(Math.max(0, ...values) / 4, metric ? 0.1 : 0.001);
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const multiple = [1, 2, 5, 10].find((value) => value >= rawStep / magnitude) ?? 10;
  const step = multiple * magnitude;
  return { maximum: step * 4, precision: Math.max(0, -Math.floor(Math.log10(step))) };
}

/** Use calendar days in the forecast location, including daylight-saving days.
 * @param {string} timeZone @param {number} days @param {Date} [now]
 */
export function chartTimeWindow(timeZone, days, now = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  /** @param {number} timestamp */
  const partsAt = (timestamp) => Object.fromEntries(
    formatter.formatToParts(timestamp).map(({ type, value }) => [type, Number(value)]),
  );
  const today = partsAt(now.getTime());
  const midnight = Date.UTC(today.year, today.month - 1, today.day);
  const dayStarts = Array.from({ length: days + 1 }, (_, index) => {
    const target = midnight + index * 24 * HOUR_MS;
    let timestamp = target;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const parts = partsAt(timestamp);
      const local = Date.UTC(parts.year, parts.month - 1, parts.day,
        parts.hour, parts.minute, parts.second);
      timestamp += target - local;
    }
    return timestamp;
  });

  return { start: dayStarts[0], end: dayStarts[days], dayStarts };
}
