/**
 * @typedef {{
 *   endTime: string;
 *   forecastPrecipitationInches?: number | null;
 *   startTime: string;
 * }} ForecastPrecipitationPeriod
 */

/**
 * @typedef {{
 *   endTime: number;
 *   startTime: number;
 *   totalInches: number;
 * }} PrecipitationInterval
 */

/**
 * @typedef {{
 *   uom: string;
 *   values: Array<{ validTime: string; value: number | null }>;
 * }} NoaaQuantitativePrecipitation
 */

/**
 * @typedef {{
 *   amountInches: number | null;
 *   priority?: number;
 *   timestamp: string;
 * }} ObservedPrecipitationReading
 */

function durationMilliseconds(duration) {
  const match =
    /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(
      duration,
    );

  if (!match) return null;

  const days = Number(match[1] ?? 0);
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);
  const seconds = Number(match[4] ?? 0);
  const milliseconds =
    ((days * 24 + hours) * 60 * 60 + minutes * 60 + seconds) * 1000;

  return milliseconds > 0 ? milliseconds : null;
}

/**
 * Convert a precipitation measurement to inches.
 *
 * @param {number | null} value
 * @param {string} unitCode
 * @returns {number | null}
 */
export function precipitationInches(value, unitCode) {
  if (!Number.isFinite(value)) return null;

  const unit = unitCode.toLowerCase();

  if (unit.endsWith(":mm") || unit === "mm") return value / 25.4;
  if (unit.endsWith(":cm") || unit === "cm") return value / 2.54;
  if (unit.endsWith(":m") || unit === "m") return value * 39.3700787402;
  if (unit.endsWith(":in") || unit === "in") return value;

  return null;
}

/**
 * Convert NOAA quantitative precipitation values into timed inch totals.
 *
 * @param {NoaaQuantitativePrecipitation | null | undefined} precipitation
 * @returns {PrecipitationInterval[]}
 */
export function normalizeNoaaPrecipitation(precipitation) {
  if (!precipitation) return [];

  return precipitation.values.flatMap((entry) => {
    if (entry.value === null || entry.value < 0) return [];

    const [startValue, durationValue] = entry.validTime.split("/");
    const startTime = new Date(startValue).getTime();
    const duration = durationMilliseconds(durationValue ?? "");
    const totalInches = precipitationInches(entry.value, precipitation.uom);

    if (
      !Number.isFinite(startTime) ||
      duration === null ||
      totalInches === null
    ) {
      return [];
    }

    return [
      {
        endTime: startTime + duration,
        startTime,
        totalInches,
      },
    ];
  });
}

/**
 * Allocate interval totals proportionally to a forecast period.
 *
 * @param {PrecipitationInterval[]} intervals
 * @param {string | number} startValue
 * @param {string | number} endValue
 * @returns {number | null}
 */
export function forecastPrecipitationForPeriod(
  intervals,
  startValue,
  endValue,
) {
  const startTime = new Date(startValue).getTime();
  const endTime = new Date(endValue).getTime();

  if (
    !Number.isFinite(startTime) ||
    !Number.isFinite(endTime) ||
    endTime <= startTime
  ) {
    return null;
  }

  let foundInterval = false;
  let total = 0;

  intervals.forEach((interval) => {
    const overlapStart = Math.max(startTime, interval.startTime);
    const overlapEnd = Math.min(endTime, interval.endTime);
    const overlap = overlapEnd - overlapStart;

    if (overlap <= 0) return;

    foundInterval = true;
    total +=
      interval.totalInches *
      (overlap / (interval.endTime - interval.startTime));
  });

  return foundInterval ? total : null;
}

/** Normalize already allocated hourly forecasts, including older cache entries.
 * @param {ForecastPrecipitationPeriod[]} periods
 * @returns {PrecipitationInterval[]}
 */
export function hourlyPrecipitationIntervals(periods) {
  return periods.flatMap((period) => {
    const startTime = Date.parse(period.startTime);
    const endTime = Date.parse(period.endTime);
    const totalInches = period.forecastPrecipitationInches;
    return Number.isFinite(startTime) && endTime > startTime &&
      typeof totalInches === "number" && Number.isFinite(totalInches) && totalInches >= 0
      ? [{ startTime, endTime, totalInches }]
      : [];
  });
}

/** Sum a local day's forecast, preserving both unrounded amounts and coverage.
 * @param {PrecipitationInterval[]} intervals
 * @param {number} startTime
 * @param {number} endTime
 */
export function forecastRainfallSummary(intervals, startTime, endTime) {
  const spans = intervals.map((interval) => ({
    start: Math.max(startTime, interval.startTime),
    end: Math.min(endTime, interval.endTime),
  })).filter((span) => span.end > span.start).sort((a, b) => a.start - b.start);
  let covered = 0;
  let coveredUntil = startTime;
  spans.forEach((span) => {
    covered += Math.max(0, span.end - Math.max(span.start, coveredUntil));
    coveredUntil = Math.max(coveredUntil, span.end);
  });

  return {
    amountInches: forecastPrecipitationForPeriod(intervals, startTime, endTime),
    coveredHours: covered / 3_600_000,
    totalHours: (endTime - startTime) / 3_600_000,
  };
}

/** Compact numeric cells; units are stated below the table.
 * @param {number | null | undefined} amount
 * @param {boolean} [metric]
 * @param {boolean} [hourly]
 */
export function formatRainfallColumn(amount, metric = false, hourly = false) {
  if (amount == null || !Number.isFinite(amount) || amount < 0) return "—";
  const value = metric ? amount * 25.4 : amount;
  const precision = metric ? 1 : hourly ? 3 : 2;
  const minimum = 10 ** -precision;
  return value > 0 && value < minimum
    ? `<${minimum.toFixed(precision)}`
    : value.toFixed(precision);
}

function localDateKey(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map(({ type, value }) => [type, value]),
  );

  return `${values.year}-${values.month}-${values.day}`;
}

/**
 * Sum forecast periods after the current hour through local midnight.
 *
 * @param {ForecastPrecipitationPeriod[]} periods
 * @param {string} timeZone
 * @param {Date} [now]
 * @returns {number | null}
 */
export function remainingRainfallTotal(
  periods,
  timeZone,
  now = new Date(),
) {
  const today = localDateKey(now, timeZone);
  const nowTime = now.getTime();
  let foundValue = false;
  let total = 0;

  periods.forEach((period) => {
    const start = new Date(period.startTime);
    const amount = period.forecastPrecipitationInches;

    if (
      start.getTime() <= nowTime ||
      localDateKey(start, timeZone) !== today ||
      amount === null ||
      amount === undefined ||
      !Number.isFinite(amount)
    ) {
      return;
    }

    foundValue = true;
    total += Math.max(0, amount);
  });

  return foundValue ? total : null;
}

/**
 * Sum observed precipitation within a rolling number of hours.
 *
 * @param {ObservedPrecipitationReading[]} readings
 * @param {number} [hours]
 * @param {Date} [now]
 * @returns {number | null}
 */
export function recentRainfallTotal(
  readings,
  hours = 6,
  now = new Date(),
) {
  const endTime = now.getTime();
  const startTime = endTime - hours * 60 * 60 * 1000;
  let foundValue = false;
  let total = 0;

  readings.forEach((reading) => {
    const timestamp = new Date(reading.timestamp).getTime();
    const amount = reading.amountInches;

    if (
      !Number.isFinite(timestamp) ||
      timestamp <= startTime ||
      timestamp > endTime ||
      amount === null ||
      !Number.isFinite(amount)
    ) {
      return;
    }

    foundValue = true;
    total += Math.max(0, amount);
  });

  return foundValue ? total : null;
}

/** Combine one observed reading per hour with any remaining overnight forecast.
 * Past missing observations are never replaced with an old forecast.
 * @param {ObservedPrecipitationReading[]} readings
 * @param {PrecipitationInterval[]} forecast
 * @param {{ start: number; end: number }} window
 * @param {Date} [now]
 * @returns {number | null}
 */
export function overnightRainfallTotal(readings, forecast, window, now = new Date()) {
  const nowTime = now.getTime();
  const observedEnd = Math.min(nowTime, window.end);
  /** @type {Map<number, ObservedPrecipitationReading>} */
  const hourly = new Map();
  readings.forEach((reading) => {
    const timestamp = Date.parse(reading.timestamp);
    if (!Number.isFinite(timestamp) || timestamp <= window.start || timestamp > observedEnd ||
      reading.amountInches === null || !Number.isFinite(reading.amountInches) || reading.amountInches < 0) return;
    // UTC hour keys keep repeated daylight-saving hours distinct.
    const hour = Math.floor(timestamp / 3_600_000);
    const existing = hourly.get(hour);
    if (!existing || (reading.priority ?? 0) > (existing.priority ?? 0) ||
      ((reading.priority ?? 0) === (existing.priority ?? 0) && timestamp > Date.parse(existing.timestamp))) {
      hourly.set(hour, reading);
    }
  });
  const remaining = nowTime < window.end
    ? forecastPrecipitationForPeriod(forecast, Math.max(nowTime, window.start), window.end)
    : null;
  if (!hourly.size && remaining === null) return null;
  return [...hourly.values()].reduce((sum, reading) => sum + reading.amountInches, 0) + (remaining ?? 0);
}

/**
 * @param {number} value
 * @param {boolean} [metric]
 */
export function formatRainfallInches(value, metric = false) {
  if (metric) {
    const millimeters = value * 25.4;
    return millimeters > 0 && millimeters < 0.1
      ? "<0.1 mm"
      : `${millimeters.toFixed(1)} mm`;
  }

  return value > 0 && value < 0.01
    ? "<0.01 in."
    : `${value.toFixed(2)} in.`;
}

/**
 * @param {number | null} amount
 * @param {boolean} [metric]
 */
export function formatObservedRainfall(amount, metric = false) {
  return amount === null || !Number.isFinite(amount) || amount <= 0
    ? "—"
    : formatRainfallInches(amount, metric);
}

/**
 * @param {number | null} probability
 * @param {number | null} amount
 * @param {boolean} [metric]
 */
export function formatForecastRainfall(
  probability,
  amount,
  metric = false,
) {
  const probabilityText =
    probability === null || !Number.isFinite(probability)
      ? null
      : `${Math.round(probability)}%`;
  const amountText =
    amount !== null && Number.isFinite(amount) && amount > 0
      ? formatRainfallInches(amount, metric)
      : null;

  if (probabilityText && amountText) {
    return `${probabilityText} (${amountText})`;
  }

  return probabilityText ?? amountText ?? "—";
}
