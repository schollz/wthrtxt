/**
 * @typedef {import("./forecast-chart-data.mjs").ChartSample} ChartSample
 * @typedef {{time: number; value: number}} CurvePoint
 * @typedef {{start: CurvePoint; control1: CurvePoint; control2: CurvePoint;
 * end: CurvePoint; coarse: boolean}} CurveSegment
 * @typedef {{time: number; high: number | null; low: number | null}} RecordRange
 */

/** Smooth curves through every sample without overshooting hourly extrema.
 * Missing values and gaps start separate curves.
 * @param {ChartSample[]} samples
 * @returns {CurveSegment[]}
 */
export function temperatureCurveSegments(samples) {
  /** @type {ChartSample[][]} */
  const groups = [];
  /** @type {ChartSample[]} */
  let group = [];
  samples.forEach((sample) => {
    if (sample.value === null || !Number.isFinite(sample.value)) {
      group = [];
      return;
    }
    const previous = group[group.length - 1];
    if (!previous || previous.endTime < sample.time || previous.time >= sample.time) {
      group = [];
      groups.push(group);
    }
    group.push(sample);
  });

  return groups.flatMap((points) => {
    const slopes = points.slice(1).map((point, index) =>
      (point.value - points[index].value) / (point.time - points[index].time));
    /** @param {number} index */
    const tangent = (index) => {
      if (index === 0) return slopes[0];
      if (index === points.length - 1) return slopes[index - 1];
      const before = slopes[index - 1];
      const after = slopes[index];
      return before * after <= 0 ? 0 : Math.sign(before) * Math.min(Math.abs(before), Math.abs(after));
    };
    return points.slice(1).map((point, index) => {
      const previous = points[index];
      const third = (point.time - previous.time) / 3;
      return {
        start: { time: previous.time, value: previous.value },
        control1: { time: previous.time + third, value: previous.value + tangent(index) * third },
        control2: { time: point.time - third, value: point.value - tangent(index + 1) * third },
        end: { time: point.time, value: point.value },
        coarse: previous.coarse || point.coarse,
      };
    });
  });
}

/** Interpolate half the daily record-high-to-record-low range in Fahrenheit.
 * @param {RecordRange[]} records
 * @param {number} time
 * @returns {number | null}
 */
export function recordSpreadAtTime(records, time) {
  const points = [...records].sort((a, b) => a.time - b.time);
  /** @param {RecordRange} point */
  const halfRange = (point) => point.high !== null && point.low !== null &&
    Number.isFinite(point.high) && Number.isFinite(point.low) && point.high >= point.low
    ? (point.high - point.low) / 2 : null;
  if (!points.length) return null;
  if (time <= points[0].time) return halfRange(points[0]);
  if (time >= points[points.length - 1].time) return halfRange(points[points.length - 1]);
  const index = points.findIndex((point) => point.time >= time);
  if (points[index].time === time) return halfRange(points[index]);
  const before = halfRange(points[index - 1]);
  const after = halfRange(points[index]);
  if (before === null || after === null) return null;
  const fraction = (time - points[index - 1].time) / (points[index].time - points[index - 1].time);
  const eased = fraction * fraction * (3 - 2 * fraction);
  return before + (after - before) * eased;
}

/** A smooth ribbon centered exactly on the smoothed forecast temperature.
 * @param {ChartSample[]} samples
 * @param {RecordRange[]} records
 */
export function temperatureSpreadSegments(samples, records) {
  const widths = temperatureCurveSegments(samples.map((point) => ({
    ...point, value: point.value === null ? null : recordSpreadAtTime(records, point.time),
  })));
  const widthsByTime = new Map(widths.map((segment) => [segment.start.time, segment]));
  return temperatureCurveSegments(samples).flatMap((center) => {
    const width = widthsByTime.get(center.start.time);
    if (!width || width.end.time !== center.end.time) return [];
    /** @param {number} sign @returns {CurveSegment} */
    const edge = (sign) => ({
      start: { time: center.start.time, value: center.start.value + sign * width.start.value },
      control1: { time: center.control1.time, value: center.control1.value + sign * width.control1.value },
      control2: { time: center.control2.time, value: center.control2.value + sign * width.control2.value },
      end: { time: center.end.time, value: center.end.value + sign * width.end.value },
      coarse: center.coarse,
    });
    return [{ upper: edge(1), lower: edge(-1) }];
  });
}
