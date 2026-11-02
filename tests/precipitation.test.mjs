import assert from "node:assert/strict";
import test from "node:test";
import {
  forecastPrecipitationForPeriod,
  forecastRainfallSummary,
  formatForecastRainfall,
  formatObservedRainfall,
  formatRainfallColumn,
  formatRainfallInches,
  hourlyPrecipitationIntervals,
  normalizeNoaaPrecipitation,
  overnightRainfallTotal,
  precipitationInches,
  recentRainfallTotal,
  remainingRainfallTotal,
} from "../app/precipitation.mjs";
import { chartTimeWindow, overnightRainfallWindow } from "../app/forecast-chart-data.mjs";

test("the 5 AM total includes previous-day 10 PM through 5 AM and excludes outside readings", () => {
  const now = new Date("2026-11-02T10:00:00-08:00");
  const window = overnightRainfallWindow("America/Los_Angeles", now);
  const readings = [
    { timestamp: "2026-11-01T22:00:00-08:00", amountInches: 5 },
    ...Array.from({ length: 7 }, (_, index) => ({
      timestamp: new Date(window.start + (index + 1) * 3_600_000).toISOString(),
      amountInches: 0.01 * (index + 1),
    })),
    { timestamp: "2026-11-02T05:01:00-08:00", amountInches: 5 },
  ];
  assert.equal(formatRainfallColumn(overnightRainfallTotal(readings, [], window, now), false, true), "0.280");
});

test("overnight totals prefer complete hourly reports instead of summing overlapping updates", () => {
  const now = new Date("2026-11-02T06:00:00-08:00");
  const window = overnightRainfallWindow("America/Los_Angeles", now);
  const readings = [
    { timestamp: "2026-11-01T23:20:00-08:00", amountInches: 0.01, priority: 3 },
    { timestamp: "2026-11-01T23:53:00-08:00", amountInches: 0.03, priority: 7 },
    { timestamp: "2026-11-01T23:58:00-08:00", amountInches: null, priority: 7 },
    { timestamp: "2026-11-02T00:53:00-08:00", amountInches: 0.02, priority: 7 },
  ];
  assert.equal(overnightRainfallTotal(readings, [], window, now), 0.05);
});

test("before 5 AM the overnight total combines observed hours with the remaining forecast", () => {
  const now = new Date("2026-11-02T02:00:00-08:00");
  const window = overnightRainfallWindow("America/Los_Angeles", now);
  const readings = [
    { timestamp: "2026-11-01T22:53:00-08:00", amountInches: 0.01 },
    { timestamp: "2026-11-01T23:53:00-08:00", amountInches: 0.02 },
    { timestamp: "2026-11-02T00:53:00-08:00", amountInches: 0.03 },
    { timestamp: "2026-11-02T01:53:00-08:00", amountInches: 0.04 },
    { timestamp: "2026-11-02T04:53:00-08:00", amountInches: 10 },
  ];
  const forecast = [{ startTime: window.start, endTime: window.end, totalInches: 0.14 }];
  assert.equal(formatRainfallColumn(overnightRainfallTotal(readings, forecast, window, now), false, true), "0.160");
});

test("overnight missing observations stay unavailable while measured dry nights display zero", () => {
  const now = new Date("2026-11-02T08:00:00-08:00");
  const window = overnightRainfallWindow("America/Los_Angeles", now);
  const oldForecast = [{ startTime: window.start, endTime: window.end, totalInches: 0.5 }];
  assert.equal(overnightRainfallTotal([], oldForecast, window, now), null);
  assert.equal(overnightRainfallTotal([
    { timestamp: "2026-11-02T04:53:00-08:00", amountInches: 0 },
  ], oldForecast, window, now), 0);
});

test("overnight windows follow the local clock across midnight, daylight saving, and fractional offsets", () => {
  const fall = overnightRainfallWindow("America/Los_Angeles", new Date("2026-11-01T12:00:00-08:00"));
  assert.equal(fall.start, Date.parse("2026-10-31T22:00:00-07:00"));
  assert.equal(fall.end, Date.parse("2026-11-01T05:00:00-08:00"));
  assert.equal(fall.end - fall.start, 8 * 3_600_000);
  const spring = overnightRainfallWindow("America/Los_Angeles", new Date("2026-03-08T12:00:00-07:00"));
  assert.equal(spring.end - spring.start, 6 * 3_600_000);
  const nepal = overnightRainfallWindow("Asia/Kathmandu", new Date("2026-11-02T12:00:00+05:45"));
  assert.equal(nepal.start, Date.parse("2026-11-01T22:00:00+05:45"));
  assert.equal(nepal.end, Date.parse("2026-11-02T05:00:00+05:45"));
});

test("overnight observed totals include both occurrences of the repeated daylight-saving hour", () => {
  const now = new Date("2026-11-01T06:00:00-08:00");
  const window = overnightRainfallWindow("America/Los_Angeles", now);
  const readings = [
    { timestamp: "2026-11-01T01:53:00-07:00", amountInches: 0.01 },
    { timestamp: "2026-11-01T01:53:00-08:00", amountInches: 0.02 },
  ];
  assert.equal(overnightRainfallTotal(readings, [], window, now), 0.03);
});

test("allocates the six-hour NOAA rainfall example without rounding the daily sum", () => {
  const intervals = normalizeNoaaPrecipitation({
    uom: "wmoUnit:mm",
    values: [{ validTime: "2026-11-04T16:00:00-08:00/PT6H", value: 1.27 }],
  });
  const amounts = Array.from({ length: 6 }, (_, index) =>
    forecastPrecipitationForPeriod(intervals,
      `2026-11-04T${16 + index}:00:00-08:00`,
      `2026-11-04T${17 + index}:00:00-08:00`));
  assert.ok(amounts.every((amount) => Math.abs(amount - 0.05 / 6) < 1e-12));
  assert.ok(amounts.every((amount) => formatRainfallColumn(amount, false, true) === "0.008"));
  const window = chartTimeWindow("America/Los_Angeles", 1, new Date("2026-11-04T12:00:00-08:00"));
  const summary = forecastRainfallSummary(intervals, window.start, window.end);
  assert.ok(Math.abs(summary.amountInches - 0.05) < 1e-12);
  assert.equal(formatRainfallColumn(summary.amountInches), "0.05");
  assert.equal(summary.coveredHours, 6);
});

test("splits intervals at local midnight rather than counting them on their start date", () => {
  const intervals = normalizeNoaaPrecipitation({
    uom: "wmoUnit:in",
    values: [{ validTime: "2026-11-04T22:00:00-08:00/PT6H", value: 0.06 }],
  });
  const start = Date.parse("2026-11-04T00:00:00-08:00");
  const midnight = Date.parse("2026-11-05T00:00:00-08:00");
  assert.equal(formatRainfallColumn(forecastRainfallSummary(intervals, start, midnight).amountInches), "0.02");
  assert.equal(formatRainfallColumn(forecastRainfallSummary(intervals, midnight, midnight + 86_400_000).amountInches), "0.04");
});

test("sums hourly provider data and distinguishes missing coverage from zero rain", () => {
  const intervals = hourlyPrecipitationIntervals([
    { startTime: "2026-11-04T00:00:00Z", endTime: "2026-11-04T01:00:00Z", forecastPrecipitationInches: 0 },
    { startTime: "2026-11-04T01:00:00Z", endTime: "2026-11-04T02:00:00Z", forecastPrecipitationInches: 0.008 },
    { startTime: "2026-11-04T02:00:00Z", endTime: "2026-11-04T03:00:00Z", forecastPrecipitationInches: null },
  ]);
  const start = Date.parse("2026-11-04T00:00:00Z");
  const summary = forecastRainfallSummary(intervals, start, start + 86_400_000);
  assert.equal(summary.amountInches, 0.008);
  assert.equal(summary.coveredHours, 2);
  assert.equal(summary.totalHours, 24);
  assert.equal(forecastRainfallSummary(intervals, start, start + 3_600_000).amountInches, 0);
  assert.equal(forecastRainfallSummary(intervals, start + 7_200_000, start + 10_800_000).amountInches, null);
});

test("keeps all 25 forecast hours on the fall daylight-saving day", () => {
  const window = chartTimeWindow("America/Los_Angeles", 1, new Date("2026-11-01T12:00:00-08:00"));
  const intervals = [{ startTime: window.start, endTime: window.end, totalInches: 0.25 }];
  assert.deepEqual(forecastRainfallSummary(intervals, window.start, window.end), {
    amountInches: 0.25, coveredHours: 25, totalHours: 25,
  });
});

test("formats separate Fall cells with hourly precision and local units", () => {
  assert.equal(formatRainfallColumn(null), "—");
  assert.equal(formatRainfallColumn(undefined), "—");
  assert.equal(formatRainfallColumn(0), "0.00");
  assert.equal(formatRainfallColumn(0, false, true), "0.000");
  assert.equal(formatRainfallColumn(0.0001, false, true), "<0.001");
  assert.equal(formatRainfallColumn(0.006), "<0.01");
  assert.equal(formatRainfallColumn(0.05, true), "1.3");
  assert.equal(formatRainfallColumn(-1), "—");
});

test("converts observed NOAA precipitation units to inches", () => {
  assert.equal(precipitationInches(18.5, "wmoUnit:mm").toFixed(5), "0.72835");
  assert.equal(precipitationInches(0.002, "wmoUnit:m").toFixed(5), "0.07874");
  assert.equal(precipitationInches(0.25, "wmoUnit:in"), 0.25);
  assert.equal(precipitationInches(1, "wmoUnit:unknown"), null);
});

test("distributes a multi-hour NOAA total evenly across its hours", () => {
  const intervals = normalizeNoaaPrecipitation({
    uom: "wmoUnit:in",
    values: [
      {
        validTime: "2026-07-26T14:00:00-04:00/PT6H",
        value: 6,
      },
    ],
  });

  for (let hour = 14; hour < 20; hour += 1) {
    const start = `2026-07-26T${hour}:00:00-04:00`;
    const end = `2026-07-26T${hour + 1}:00:00-04:00`;
    assert.equal(
      forecastPrecipitationForPeriod(intervals, start, end),
      1,
    );
  }
});

test("converts NOAA millimeters and allocates periods crossing intervals", () => {
  const intervals = normalizeNoaaPrecipitation({
    uom: "wmoUnit:mm",
    values: [
      {
        validTime: "2026-07-26T00:00:00Z/PT2H",
        value: 25.4,
      },
      {
        validTime: "2026-07-26T02:00:00Z/PT2H",
        value: 25.4,
      },
    ],
  });

  assert.equal(
    forecastPrecipitationForPeriod(
      intervals,
      "2026-07-26T01:30:00Z",
      "2026-07-26T02:30:00Z",
    ),
    0.5,
  );
});

test("totals only future forecast hours remaining in the local day", () => {
  const periods = [
    {
      endTime: "2026-07-26T15:00:00-04:00",
      forecastPrecipitationInches: 0.1,
      startTime: "2026-07-26T14:00:00-04:00",
    },
    {
      endTime: "2026-07-26T16:00:00-04:00",
      forecastPrecipitationInches: 0.2,
      startTime: "2026-07-26T15:00:00-04:00",
    },
    {
      endTime: "2026-07-27T00:00:00-04:00",
      forecastPrecipitationInches: 0.3,
      startTime: "2026-07-26T23:00:00-04:00",
    },
    {
      endTime: "2026-07-27T01:00:00-04:00",
      forecastPrecipitationInches: 0.4,
      startTime: "2026-07-27T00:00:00-04:00",
    },
  ];

  assert.equal(
    remainingRainfallTotal(
      periods,
      "America/New_York",
      new Date("2026-07-26T14:30:00-04:00"),
    ),
    0.5,
  );
});

test("totals observed rainfall only within the last six hours", () => {
  const readings = [
    { amountInches: 0.5, timestamp: "2026-07-26T06:29:59Z" },
    { amountInches: 0.01, timestamp: "2026-07-26T06:30:01Z" },
    { amountInches: 0, timestamp: "2026-07-26T08:00:00Z" },
    { amountInches: 0.04, timestamp: "2026-07-26T12:00:00Z" },
    { amountInches: 1, timestamp: "2026-07-26T12:30:01Z" },
  ];

  assert.equal(
    recentRainfallTotal(
      readings,
      6,
      new Date("2026-07-26T12:30:00Z"),
    ),
    0.05,
  );
  assert.equal(
    recentRainfallTotal(
      [{ amountInches: null, timestamp: "2026-07-26T12:00:00Z" }],
      6,
      new Date("2026-07-26T12:30:00Z"),
    ),
    null,
  );
});

test("formats positive hourly amounts without adding zero amounts", () => {
  assert.equal(formatForecastRainfall(57, 0.34), "57% (0.34 in.)");
  assert.equal(formatForecastRainfall(57, 0), "57%");
  assert.equal(formatForecastRainfall(null, 0.006), "<0.01 in.");
  assert.equal(formatForecastRainfall(null, null), "—");
  assert.equal(formatObservedRainfall(0), "—");
  assert.equal(formatObservedRainfall(null), "—");
  assert.equal(formatObservedRainfall(0.006), "<0.01 in.");
  assert.equal(formatObservedRainfall(0.34), "0.34 in.");
  assert.equal(formatRainfallInches(0.004), "<0.01 in.");
  assert.equal(formatForecastRainfall(57, 0.34, true), "57% (8.6 mm)");
  assert.equal(formatObservedRainfall(0.006, true), "0.2 mm");
  assert.equal(formatRainfallInches(0.004, true), "0.1 mm");
});
