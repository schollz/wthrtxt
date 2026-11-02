const HOUR_MS = 60 * 60 * 1000;

/**
 * @typedef {{ startTime: string; endTime: string; temperature: number | null;
 * probabilityOfPrecipitation?: { value: number | null } }} ForecastPeriod
 * @typedef {{ time: number; endTime: number; value: number | null;
 * coarse: boolean }} ChartSample
 */

/**
 * Keep each variable's hourly detail until its own coverage ends, then use
 * the remaining day/night periods. Missing values stay missing, including 0%.
 * @param {ForecastPeriod[]} hourly
 * @param {ForecastPeriod[]} daily
 */
export function forecastChartSeries(hourly, daily) {
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

  return {
    temperature: series((period) => period.temperature),
    rain: series((period) => period.probabilityOfPrecipitation?.value),
  };
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
