import assert from "node:assert/strict";
import test from "node:test";
import { recordSpreadAtTime, temperatureCurveSegments, temperatureSpreadSegments } from "../app/temperature-spread.mjs";

const HOUR = 3_600_000;
const sample = (hour, value) => ({ time: hour * HOUR, endTime: (hour + 1) * HOUR, value, coarse: false });
const curveValue = (curve, fraction) => {
  const remaining = 1 - fraction;
  return remaining ** 3 * curve.start.value + 3 * remaining ** 2 * fraction * curve.control1.value +
    3 * remaining * fraction ** 2 * curve.control2.value + fraction ** 3 * curve.end.value;
};

test("interpolates daily half-record ranges smoothly using actual elapsed time", () => {
  const records = [{ time: 0, high: 70, low: 30 }, { time: 25 * HOUR, high: 80, low: 20 }];
  assert.equal(recordSpreadAtTime(records, 0), 20);
  assert.equal(recordSpreadAtTime(records, 25 * HOUR), 30);
  assert.equal(recordSpreadAtTime(records, 12.5 * HOUR), 25);
  const nearStart = recordSpreadAtTime(records, 0.001 * 25 * HOUR);
  assert.ok(nearStart > 20 && nearStart < 20.001);
  assert.equal(recordSpreadAtTime(records, -HOUR), 20);
  assert.equal(recordSpreadAtTime(records, 26 * HOUR), 30);
});

test("smooth temperature curves pass through every hourly reading without overshooting peaks", () => {
  const samples = [sample(0, 40), sample(1, 44), sample(2, 60), sample(3, 45)];
  const curves = temperatureCurveSegments(samples);
  assert.equal(curves.length, 3);
  curves.forEach((curve, index) => {
    assert.equal(curve.start.value, samples[index].value);
    assert.equal(curve.end.value, samples[index + 1].value);
    const low = Math.min(curve.start.value, curve.end.value);
    const high = Math.max(curve.start.value, curve.end.value);
    for (let step = 0; step <= 20; step += 1) {
      const value = curveValue(curve, step / 20);
      assert.ok(value >= low - 1e-12 && value <= high + 1e-12);
    }
  });
  for (let index = 1; index < curves.length; index += 1) {
    const before = curves[index - 1];
    const after = curves[index];
    const leftSlope = (before.end.value - before.control2.value) / (before.end.time - before.control2.time);
    const rightSlope = (after.control1.value - after.start.value) / (after.control1.time - after.start.time);
    assert.ok(Math.abs(leftSlope - rightSlope) < 1e-12);
  }
});

test("the shaded record spread stays centered on the forecast curve between every hourly point", () => {
  const samples = Array.from({ length: 25 }, (_, hour) => sample(hour, 50 + 8 * Math.sin(hour / 4)));
  const records = [{ time: 0, high: 70, low: 30 }, { time: 24 * HOUR, high: 80, low: 20 }];
  const centers = temperatureCurveSegments(samples);
  const band = temperatureSpreadSegments(samples, records);
  assert.equal(band.length, centers.length);
  band.forEach(({ upper, lower }, index) => {
    for (let step = 0; step <= 20; step += 1) {
      const fraction = step / 20;
      const high = curveValue(upper, fraction);
      const low = curveValue(lower, fraction);
      assert.ok(Math.abs((high + low) / 2 - curveValue(centers[index], fraction)) < 1e-10);
      assert.ok(high >= low);
    }
  });
  assert.equal(band[0].upper.start.value - band[0].lower.start.value, 40);
  const last = band[band.length - 1];
  assert.equal(last.upper.end.value - last.lower.end.value, 60);
});

test("missing or invalid records do not fabricate a spread, and missing temperatures break the band", () => {
  const samples = [sample(0, 50), sample(1, 52), sample(2, null), sample(3, 55), sample(4, 53)];
  const valid = [{ time: 0, high: 70, low: 30 }];
  const band = temperatureSpreadSegments(samples, valid);
  assert.deepEqual(band.map((segment) => segment.upper.start.time), [0, 3 * HOUR]);
  assert.deepEqual(temperatureSpreadSegments(samples, []), []);
  assert.deepEqual(temperatureSpreadSegments(samples, [{ time: 0, high: 70, low: null }]), []);
  assert.equal(recordSpreadAtTime([{ time: 0, high: 20, low: 50 }], 0), null);
  assert.equal(recordSpreadAtTime([
    { time: 0, high: 70, low: 30 }, { time: 24 * HOUR, high: null, low: 30 },
  ], 12 * HOUR), null);
});
