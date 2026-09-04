const US_COUNTRY_CODES = new Set(["AS", "GU", "MP", "PR", "US", "VI"]);

/**
 * Use U.S. customary units for U.S. locations and metric units everywhere
 * else. The provider is a fallback for raw coordinates when reverse
 * geocoding is unavailable.
 *
 * @param {string | null | undefined} countryCode
 * @param {"noaa" | "open-meteo"} provider
 */
export function usesMetricUnits(countryCode, provider) {
  const normalizedCountryCode = countryCode?.trim().toUpperCase();

  return normalizedCountryCode
    ? !US_COUNTRY_CODES.has(normalizedCountryCode)
    : provider === "open-meteo";
}

/**
 * @param {number} value
 */
export function fahrenheitToCelsius(value) {
  return ((value - 32) * 5) / 9;
}

/**
 * @param {Array<number | null | undefined>} values
 * @returns {number | null}
 */
export function highestTemperature(values) {
  const temperatures = values.filter((value) => Number.isFinite(value));
  return temperatures.length ? Math.max(...temperatures) : null;
}

/**
 * @param {number | null | undefined} value
 * @param {boolean} metric
 */
export function formatTemperature(value, metric) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }

  const displayValue = metric ? fahrenheitToCelsius(value) : value;
  return `${Math.round(displayValue)}°${metric ? "C" : "F"}`;
}

/**
 * Convert the normalized mph strings used by the weather providers into
 * metric display values without changing cached forecast data.
 *
 * @param {string} value
 * @param {boolean} metric
 */
export function formatWind(value, metric) {
  if (!metric || !/\bmph\b/i.test(value)) return value;

  return value
    .replace(/\d+(?:\.\d+)?/g, (speed) =>
      String(Math.round(Number(speed) * 1.609344)),
    )
    .replace(/\bmph\b/i, "km/h");
}
