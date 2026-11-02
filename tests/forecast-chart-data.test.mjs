import assert from "node:assert/strict";
import test from "node:test";
import { chartTimeWindow, forecastChartSeries } from "../app/forecast-chart-data.mjs";

function period(start, end, temperature = 60, rain = 25) {
  return {
    startTime: `2026-11-02T${start}:00:00Z`,
    endTime: `2026-11-02T${end}:00:00Z`,
    temperature,
    probabilityOfPrecipitation: { value: rain },
  };
}

test("preserves hourly rain spikes and uses broader periods only after hourly coverage", () => {
  const hourly = [period("06", "07", 50, 0), period("07", "08", 51, 90), period("08", "09", 52, 5)];
  const daily = [period("06", "18", 65, 40), period("18", "23", 48, 20)];
  const { rain } = forecastChartSeries(hourly, daily);
  assert.deepEqual(rain.map(({ value, coarse }) => [value, coarse]), [
    [0, false], [90, false], [5, false], [40, true], [20, true],
  ]);
  assert.equal(rain[3].time, Date.parse(hourly[2].endTime));
});

test("falls back independently when hourly rain ends before hourly temperature", () => {
  const hourly = [period("06", "07", 50, 10), period("07", "08", 51, null), period("08", "09", 52, null)];
  const daily = [period("06", "18", 65, 40)];
  const { temperature, rain } = forecastChartSeries(hourly, daily);
  assert.equal(temperature.find((point) => point.coarse).time, Date.parse(hourly[2].endTime));
  assert.equal(rain.find((point) => point.coarse).time, Date.parse(hourly[0].endTime));
  assert.deepEqual(rain.map((point) => point.value), [10, 40]);
});

test("keeps internal gaps and zeroes without substituting daily probabilities", () => {
  const hourly = [period("08", "09", 52, 0), period("06", "07", 50, 10), period("07", "08", null, null)];
  const { temperature, rain } = forecastChartSeries(hourly, [period("06", "09", 65, 40)]);
  assert.deepEqual(rain.map((point) => point.value), [10, null, 0]);
  assert.deepEqual(temperature.map((point) => point.value), [50, null, 52]);
  assert.ok(rain.every((point) => !point.coarse));
});

test("supports missing hourly data, missing probabilities, and an empty forecast", () => {
  const daily = [period("06", "18", 65, 40), period("18", "23", 48, null)];
  const fallback = forecastChartSeries([], daily);
  assert.deepEqual(fallback.rain.map((point) => point.value), [40, null]);
  assert.ok(fallback.temperature.every((point) => point.coarse));
  assert.deepEqual(forecastChartSeries([], []), { temperature: [], rain: [] });
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
