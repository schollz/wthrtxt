import assert from "node:assert/strict";
import test from "node:test";
import { chartTimeWindow, forecastChartSeries, rainfallChartScale, withObservedRainfall } from "../app/forecast-chart-data.mjs";

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

test("uses measured hourly rainfall for past hours, leaves missing readings blank, and retains future forecasts", () => {
  const now = new Date("2026-11-02T03:30:00-08:00");
  const window = chartTimeWindow("America/Los_Angeles", 1, now);
  const forecast = Array.from({ length: 6 }, (_, hour) => ({
    time: window.start + hour * 3_600_000, endTime: window.start + (hour + 1) * 3_600_000,
    value: 0.02, coarse: false,
  }));
  const history = [
    { time: forecast[0].time, timestamp: forecast[0].time + 53 * 60_000, value: 0.04 },
    { time: forecast[1].time, timestamp: forecast[1].time + 53 * 60_000, value: 0 },
    { time: forecast[2].time, timestamp: forecast[2].time + 53 * 60_000, value: null },
    { time: forecast[3].time, timestamp: forecast[3].time + 20 * 60_000, value: 0.01 },
    { time: forecast[4].time, timestamp: forecast[4].time + 53 * 60_000, value: 1 },
  ];
  const rainfall = withObservedRainfall(forecast, history, window, now);
  assert.deepEqual(rainfall.map((point) => point.value), [0.04, 0, null, 0.01, 0.02, 0.02]);
  assert.equal(rainfall[0].source, "observed");
  assert.equal(rainfall[3].source, "observed");
  assert.equal(rainfall[4].source, "forecast");
});

test("does not present old forecasts as actual rain when station history is unavailable", () => {
  const now = new Date("2026-11-02T03:30:00-08:00");
  const window = chartTimeWindow("America/Los_Angeles", 1, now);
  const forecast = [{
    time: window.start, endTime: window.start + 3_600_000, value: 0.1, coarse: false,
  }];
  const rainfall = withObservedRainfall(forecast, [], window, now);
  assert.equal(rainfall.length, 3);
  assert.ok(rainfall.every((point) => point.value === null));
});

test("keeps the two observed rainfall hours separate when daylight saving time ends", () => {
  const now = new Date("2026-11-01T03:00:00-08:00");
  const window = chartTimeWindow("America/Los_Angeles", 1, now);
  const first = Date.parse("2026-11-01T01:00:00-07:00");
  const repeated = Date.parse("2026-11-01T01:00:00-08:00");
  const rainfall = withObservedRainfall([], [
    { time: first, timestamp: first + 53 * 60_000, value: 0.01 },
    { time: repeated, timestamp: repeated + 53 * 60_000, value: 0.02 },
  ], window, now);
  assert.equal(rainfall.find((point) => point.time === first).value, 0.01);
  assert.equal(rainfall.find((point) => point.time === repeated).value, 0.02);
});

test("labels modeled history as estimated rather than measured rainfall", () => {
  const now = new Date("2026-11-02T03:30:00+05:45");
  const window = chartTimeWindow("Asia/Kathmandu", 1, now);
  const rainfall = withObservedRainfall([], [{
    time: window.start, timestamp: window.start, value: 0.01, source: "estimated",
  }], window, now);
  assert.equal(rainfall[0].source, "estimated");
  assert.equal(rainfall[0].time, Date.parse("2026-11-01T18:15:00Z"));
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
