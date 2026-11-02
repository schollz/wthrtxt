import assert from "node:assert/strict";
import test from "node:test";
import { chartTimeWindow, forecastChartSeries, rainfallChartScale } from "../app/forecast-chart-data.mjs";

function period(start, end, temperature = 60, rainfall = 0.01) {
  return {
    startTime: `2026-11-02T${start}:00:00Z`,
    endTime: `2026-11-02T${end}:00:00Z`,
    temperature,
    forecastPrecipitationInches: rainfall,
    probabilityOfPrecipitation: { value: 90 },
  };
}

test("plots hourly rainfall amounts instead of probabilities and retains temperature fallback", () => {
  const hourly = [period("06", "07", 50, 0), period("07", "08", 51, 0.05), period("08", "09", 52, 0.005)];
  const daily = [period("06", "18", 65), period("18", "23", 48)];
  const { rainfall, temperature } = forecastChartSeries(hourly, daily);
  assert.deepEqual(rainfall.map(({ value, coarse }) => [value, coarse]), [
    [0, false], [0.05, false], [0.005, false],
  ]);
  assert.equal(temperature.find((point) => point.coarse).time, Date.parse(hourly[2].endTime));
});

test("allocates six-hour NOAA totals hourly beyond the temperature forecast horizon", () => {
  const hourly = [period("06", "07", 50), period("07", "08", 51)];
  const startTime = Date.parse(hourly[0].startTime);
  const { rainfall } = forecastChartSeries(hourly, [], [
    { startTime, endTime: startTime + 6 * 3_600_000, totalInches: 0.05 },
  ]);
  assert.equal(rainfall.length, 6);
  assert.ok(rainfall.every((point) => Math.abs(point.value - 0.05 / 6) < 1e-12));
  assert.ok(Math.abs(rainfall.reduce((sum, point) => sum + point.value, 0) - 0.05) < 1e-12);
  assert.equal(rainfall[5].time, startTime + 5 * 3_600_000);
});

test("keeps internal rainfall gaps and zeroes without substituting daily probabilities", () => {
  const hourly = [period("08", "09", 52, 0), period("06", "07", 50, 0.01), period("07", "08", null, null)];
  const { temperature, rainfall } = forecastChartSeries(hourly, [period("06", "09", 65)]);
  assert.deepEqual(rainfall.map((point) => point.value), [0.01, null, 0]);
  assert.deepEqual(temperature.map((point) => point.value), [50, null, 52]);
  assert.ok(rainfall.every((point) => !point.coarse));
});

test("leaves rainfall unavailable when only daily probabilities exist", () => {
  const daily = [period("06", "18", 65, null), period("18", "23", 48, null)];
  const fallback = forecastChartSeries([], daily);
  assert.deepEqual(fallback.rainfall, []);
  assert.ok(fallback.temperature.every((point) => point.coarse));
  assert.deepEqual(forecastChartSeries([], []), { temperature: [], rainfall: [] });
});

test("scales rainfall in inches or millimeters and keeps a usable axis on dry days", () => {
  const imperial = rainfallChartScale([0, 0.05 / 6, null], false);
  assert.ok(imperial.maximum >= 0.05 / 6);
  assert.ok(imperial.maximum < 0.1);
  assert.equal(imperial.precision, 3);
  const metric = rainfallChartScale([0.05 / 6], true);
  assert.ok(metric.maximum >= (0.05 / 6) * 25.4);
  assert.ok(metric.maximum < 1);
  assert.equal(metric.precision, 1);
  assert.ok(rainfallChartScale([0, 0], false).maximum > 0);
  assert.ok(rainfallChartScale([], true).maximum > 0);
});

test("uses local calendar days across spring and fall daylight-saving changes", () => {
  const spring = chartTimeWindow("America/Los_Angeles", 1, new Date("2026-03-08T20:00:00Z"));
  assert.equal(spring.start, Date.parse("2026-03-08T08:00:00Z"));
  assert.equal(spring.end - spring.start, 23 * 3_600_000);
  const fall = chartTimeWindow("America/Los_Angeles", 7, new Date("2026-11-01T20:00:00Z"));
  assert.equal(fall.start, Date.parse("2026-11-01T07:00:00Z"));
  assert.equal(fall.end, Date.parse("2026-11-08T08:00:00Z"));
  assert.equal(fall.dayStarts.length, 8);
});

test("uses the forecast location's date and supports fractional UTC offsets", () => {
  const window = chartTimeWindow("Asia/Kathmandu", 1, new Date("2026-11-02T23:00:00Z"));
  assert.equal(window.start, Date.parse("2026-11-02T18:15:00Z"));
  assert.equal(window.end, Date.parse("2026-11-03T18:15:00Z"));
});
