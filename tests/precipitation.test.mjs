import assert from "node:assert/strict";
import test from "node:test";
import {
  forecastPrecipitationForPeriod,
  formatForecastRainfall,
  formatObservedRainfall,
  formatRainfallInches,
  normalizeNoaaPrecipitation,
  precipitationInches,
  recentRainfallTotal,
  remainingRainfallTotal,
} from "../app/precipitation.mjs";

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
