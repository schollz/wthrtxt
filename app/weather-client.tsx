"use client";

import {
  Cloud,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSun,
  CircleHelp,
  Droplets,
  FileText,
  LocateFixed,
  MapPin,
  Moon,
  RefreshCw,
  Search,
  Snowflake,
  Sun,
  Wind,
  X,
} from "lucide-react";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  locationSlugForPlace,
  searchTermsForLocationSlug,
  slugifyPlaceName,
} from "./location-slugs.mjs";
import { nominatimPlaceResults } from "./nominatim-places.mjs";
import { photonPlaceResults } from "./photon-places.mjs";
import {
  forecastPrecipitationForPeriod,
  forecastRainfallSummary,
  formatRainfallColumn,
  formatRainfallInches,
  hourlyPrecipitationIntervals,
  normalizeNoaaPrecipitation,
  overnightRainfallTotal,
  precipitationInches,
  recentRainfallTotal,
  remainingRainfallTotal,
} from "./precipitation.mjs";
import { SITE_NAME, SITE_URL } from "./site";
import ThemeToggle from "./theme-toggle";
import {
  WEATHER_CACHE_KEY,
  WEATHER_CACHE_TTL_MS,
} from "./weather-cache-bootstrap.mjs";
import {
  formatTemperature,
  formatWind,
  highestTemperature,
  usesMetricUnits,
} from "./units.mjs";
import ProjectFooter from "./project-footer";
import ForecastChart from "./forecast-chart";
import {
  chartTimeWindow,
  forecastChartSeries,
  overnightRainfallWindow,
  withObservedRainfall,
} from "./forecast-chart-data.mjs";

const DISPLAY_HOURS = Array.from({ length: 18 }, (_, index) => index + 5);
const SEATTLE = { latitude: 47.6062, longitude: -122.3321 };
const ACIS_STATION_DATA_URL = "https://data.rcc-acis.org/StnData";
const NOMINATIM_SEARCH_URL =
  "https://nominatim.openstreetmap.org/search";
const NOMINATIM_REVERSE_URL =
  "https://nominatim.openstreetmap.org/reverse";
const PHOTON_SEARCH_URL = "https://photon.komoot.io/api";
const OPEN_METEO_ARCHIVE_URL =
  "https://archive-api.open-meteo.com/v1/archive";
const OPEN_METEO_FORECAST_URL =
  "https://api.open-meteo.com/v1/forecast";
const OPEN_METEO_RECORD_START_YEAR = 1950;
const OPEN_METEO_RECORD_CONCURRENCY = 4;
const OPEN_METEO_RECORD_CACHE_KEY = "wx-open-meteo-records-v2";
const FORWARD_GEOCODE_CACHE_KEY = "wx-forward-geocode-v1";
const PLACE_SEARCH_CACHE_KEY = "wx-place-search-v2";
const PLACE_SEARCH_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const SEARCH_DEBOUNCE_MS = 350;
const REVERSE_GEOCODE_CACHE_KEY = "wx-reverse-geocode-v1";
const REVERSE_GEOCODE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const AUTO_REFRESH_INTERVAL_MS = 30 * 60 * 1000;
const LEGACY_LOCATION_QUERY_KEY = "location";
const NOAA_COUNTRY_CODES = new Set(["AS", "GU", "MP", "PR", "US", "VI"]);

type LoadPhase = "locating" | "loading" | "ready" | "error";
type WeatherProvider = "noaa" | "open-meteo";
type LocationSource = "open-meteo-geocoding" | "osm";

type TooltipState = {
  horizontalOffset: number;
  horizontalSide: "left" | "right";
  placement: "above" | "below";
  text: string;
  verticalOffset: number;
};

type PlaceResult = {
  admin1?: string;
  admin2?: string;
  country?: string;
  country_code: string;
  feature_code?: string;
  id: number;
  latitude: number;
  longitude: number;
  name: string;
  source?: LocationSource;
  timezone?: string;
};

type GeocodingResponse = {
  results?: PlaceResult[];
};

type LocationHint = {
  city: string;
  country: string;
  countryCode: string;
  region: string;
  source: LocationSource;
};

function useTooltip() {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  useEffect(() => {
    const tooltipTarget = (event: Event) =>
      event.target instanceof Element
        ? event.target.closest<HTMLElement>(".hover-tip[data-tooltip]")
        : null;

    const showTooltip = (target: HTMLElement) => {
      const text = target.dataset.tooltip;
      if (!text) return;

      const rect = target.getBoundingClientRect();
      const horizontalSide =
        rect.left + rect.width / 2 > window.innerWidth / 2 ? "right" : "left";
      const placement =
        target.classList.contains("header-tip") ||
        rect.top < window.innerHeight / 2
          ? "below"
          : "above";

      setTooltip({
        horizontalOffset:
          horizontalSide === "right"
            ? Math.max(16, window.innerWidth - rect.right)
            : Math.max(16, rect.left),
        horizontalSide,
        placement,
        text,
        verticalOffset:
          placement === "below"
            ? rect.bottom + 7
            : window.innerHeight - rect.top + 7,
      });
    };

    const handleMouseOver = (event: MouseEvent) => {
      const target = tooltipTarget(event);
      if (!target) return;

      if (
        event.relatedTarget instanceof Node &&
        target.contains(event.relatedTarget)
      ) {
        return;
      }

      showTooltip(target);
    };

    const handleMouseOut = (event: MouseEvent) => {
      const target = tooltipTarget(event);
      if (!target) return;

      if (
        event.relatedTarget instanceof Node &&
        target.contains(event.relatedTarget)
      ) {
        return;
      }

      setTooltip(null);
    };

    const handleFocusIn = (event: FocusEvent) => {
      const target = tooltipTarget(event);
      if (target) showTooltip(target);
    };

    const handleFocusOut = (event: FocusEvent) => {
      if (tooltipTarget(event)) setTooltip(null);
    };

    const hideTooltip = () => setTooltip(null);

    document.addEventListener("mouseover", handleMouseOver);
    document.addEventListener("mouseout", handleMouseOut);
    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("focusout", handleFocusOut);
    document.addEventListener("scroll", hideTooltip, true);
    window.addEventListener("resize", hideTooltip);

    return () => {
      document.removeEventListener("mouseover", handleMouseOver);
      document.removeEventListener("mouseout", handleMouseOut);
      document.removeEventListener("focusin", handleFocusIn);
      document.removeEventListener("focusout", handleFocusOut);
      document.removeEventListener("scroll", hideTooltip, true);
      window.removeEventListener("resize", hideTooltip);
    };
  }, []);

  return tooltip;
}

function readLegacySharedCoordinates() {
  if (typeof window === "undefined") return null;

  const value = new URLSearchParams(window.location.search).get(
    LEGACY_LOCATION_QUERY_KEY,
  );

  if (!value) return null;

  const parts = value.split(",");
  if (parts.length !== 2) return null;

  const latitude = Number(parts[0]);
  const longitude = Number(parts[1]);
  const isValid =
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180;

  return isValid ? { latitude, longitude } : null;
}

function readSharedLocationSlug() {
  if (typeof window === "undefined") return null;

  const segments = window.location.pathname.split("/").filter(Boolean);
  if (segments.length !== 1 || segments[0] === "404.html") return null;

  try {
    const slug = slugifyPlaceName(decodeURIComponent(segments[0]));
    return slug || null;
  } catch {
    return null;
  }
}

type NoaaValue = {
  unitCode: string;
  value: number | null;
};

type HourlyPeriod = {
  endTime: string;
  forecastPrecipitationInches?: number | null;
  icon: string;
  isDaytime: boolean;
  name: string;
  number: number;
  probabilityOfPrecipitation?: NoaaValue;
  relativeHumidity?: NoaaValue;
  shortForecast: string;
  startTime: string;
  temperature: number | null;
  temperatureUnit: string;
  windDirection: string;
  windSpeed: string;
};

type CurrentReading = {
  description: string;
  humidity: number | null;
  sourceLabel: "model time" | "observed";
  temperatureF: number | null;
  timestamp: string | null;
  windSpeed: string;
};

type WeatherData = {
  city: string;
  coordinates: { latitude: number; longitude: number };
  current: CurrentReading;
  daily: HourlyPeriod[];
  dataLabel: string;
  dataUrl: string;
  hourly: HourlyPeriod[];
  locationHint: LocationHint | null;
  observations: StationObservation[];
  precipitationIntervals?: ReturnType<typeof normalizeNoaaPrecipitation>;
  provider: WeatherProvider;
  recordKey: string | null;
  state: string;
  stationId: string | null;
  timeZone: string;
};

type WeatherCacheEntry = {
  key: string;
  paths: string[];
  updatedAt: number;
  weather: WeatherData;
};

type ClimateRecordValue = {
  coverage?: string;
  date: string;
  estimated?: boolean;
  temperatureF: number;
};

type ClimateAverageValue = {
  coverage?: string;
  estimated?: boolean;
  sampleCount?: number;
  temperatureF: number;
};

type ClimateRecord = {
  average: ClimateAverageValue | null;
  high: ClimateRecordValue | null;
  low: ClimateRecordValue | null;
};

type ClimateRecords = Record<string, ClimateRecord>;

type AcisResponse = {
  error?: string;
  meta?: {
    name?: string;
  };
  smry?: unknown[];
};

type PointResponse = {
  properties: {
    forecast: string;
    forecastGridData: string;
    forecastHourly: string;
    observationStations: string;
    relativeLocation?: {
      properties?: {
        city?: string;
        state?: string;
      };
    };
    timeZone: string;
  };
};

type ObservationStationsResponse = {
  features: Array<{ id: string }>;
};

type StationObservation = {
  icon: string | null;
  precipitationLastHour: NoaaValue | null;
  rawMessage: string | null;
  relativeHumidity: NoaaValue;
  source?: "estimated" | "observed";
  temperature: NoaaValue;
  textDescription: string;
  timestamp: string;
};

type StationObservationsResponse = {
  features: Array<{
    properties: StationObservation;
  }>;
};

type ForecastResponse = {
  properties: {
    periods: HourlyPeriod[];
  };
};

type NoaaGridForecastResponse = {
  properties: {
    quantitativePrecipitation?: {
      uom: string;
      values: Array<{
        validTime: string;
        value: number | null;
      }>;
    };
  };
};

type OpenMeteoCurrent = {
  is_day: number;
  relative_humidity_2m: number | null;
  temperature_2m: number | null;
  time: number;
  weather_code: number;
  wind_direction_10m: number | null;
  wind_speed_10m: number | null;
};

type OpenMeteoHourly = {
  is_day: Array<number | null>;
  precipitation: Array<number | null>;
  precipitation_probability: Array<number | null>;
  relative_humidity_2m: Array<number | null>;
  temperature_2m: Array<number | null>;
  time: number[];
  weather_code: Array<number | null>;
  wind_direction_10m: Array<number | null>;
  wind_speed_10m: Array<number | null>;
};

type OpenMeteoDaily = {
  precipitation_probability_max: Array<number | null>;
  temperature_2m_max: Array<number | null>;
  temperature_2m_min: Array<number | null>;
  time: number[];
  weather_code: Array<number | null>;
};

type OpenMeteoForecastResponse = {
  current?: OpenMeteoCurrent;
  daily?: OpenMeteoDaily;
  hourly?: OpenMeteoHourly;
  timezone?: string;
};

type OpenMeteoArchiveResponse = {
  daily?: {
    temperature_2m_max: Array<number | null>;
    temperature_2m_min: Array<number | null>;
    time: string[];
  };
  error?: boolean;
  reason?: string;
};

type NominatimResponse = {
  features?: Array<{
    geometry?: {
      coordinates?: [number, number];
    };
    properties?: {
      geocoding?: {
        city?: string;
        country?: string;
        country_code?: string;
        county?: string;
        district?: string;
        locality?: string;
        municipality?: string;
        name?: string;
        place_id?: number;
        state?: string;
        town?: string;
        type?: string;
        village?: string;
      };
    };
  }>;
};

type ForwardGeocodeCacheEntry = {
  key: string;
  place: PlaceResult;
  updatedAt: number;
};

type PlaceSearchCacheEntry = {
  key: string;
  places: PlaceResult[];
  updatedAt: number;
};

type ReverseGeocodeCacheEntry = {
  hint: LocationHint;
  key: string;
  updatedAt: number;
};

type OpenMeteoRecordCacheEntry = {
  coverage: Record<string, number>;
  key: string;
  records: ClimateRecords;
  updatedAt: number;
};

class WeatherRequestError extends Error {
  provider: WeatherProvider;
  status: number;

  constructor(provider: WeatherProvider, status: number) {
    super(`${provider === "noaa" ? "NOAA" : "Open-Meteo"} request failed (${status})`);
    this.name = "WeatherRequestError";
    this.provider = provider;
    this.status = status;
  }
}

const noaaHeaders = {
  Accept: "application/geo+json",
};

async function fetchNoaaJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: noaaHeaders });

  if (!response.ok) {
    throw new WeatherRequestError("noaa", response.status);
  }

  return response.json() as Promise<T>;
}

function celsiusToFahrenheit(value: number | null) {
  return value === null ? null : (value * 9) / 5 + 32;
}

function observationPrecipitationInches(observation: StationObservation) {
  const structuredValue = observation.precipitationLastHour?.value ?? null;
  const structuredUnit =
    observation.precipitationLastHour?.unitCode.toLowerCase() ?? "";
  const rawMessage = observation.rawMessage ?? "";
  const structuredAmount = precipitationInches(
    structuredValue,
    structuredUnit,
  );

  if (structuredAmount !== null) {
    return structuredAmount;
  }

  const metarAmount = rawMessage.match(/\bP(\d{4})\b/);

  if (metarAmount) {
    return Number(metarAmount[1]) / 100;
  }

  // Routine hourly METARs omit the P-group when no measurable rain fell.
  return rawMessage ? 0 : null;
}

function observationTemperatureFahrenheit(observation: StationObservation) {
  const value = observation.temperature.value;
  if (value === null) return null;

  return observation.temperature.unitCode.toLowerCase().includes("degf")
    ? value
    : celsiusToFahrenheit(value);
}

function observationPriority(observation: StationObservation) {
  const minute = new Date(observation.timestamp).getUTCMinutes();
  const isRoutineHourlyReport = minute >= 51 && minute <= 59;
  const rawMessage = observation.rawMessage ?? "";
  const hasMetar = Boolean(rawMessage);
  const hasRainValue =
    observation.precipitationLastHour?.value != null ||
    /\bP\d{4}\b/.test(rawMessage);

  return (
    (isRoutineHourlyReport ? 4 : 0) +
    (hasMetar ? 2 : 0) +
    (hasRainValue ? 1 : 0)
  );
}

function isPreferredObservation(
  candidate: StationObservation,
  existing: StationObservation | undefined,
) {
  if (!existing) return true;

  const candidatePriority = observationPriority(candidate);
  const existingPriority = observationPriority(existing);

  return (
    candidatePriority > existingPriority ||
    (candidatePriority === existingPriority &&
      new Date(candidate.timestamp).getTime() >
        new Date(existing.timestamp).getTime())
  );
}

function recentObservedRainfall(
  observations: StationObservation[],
  now = new Date(),
) {
  const endTime = now.getTime();
  const startTime = endTime - 6 * 60 * 60 * 1000;
  const observationsByHour = new Map<string, StationObservation>();

  observations.forEach((observation) => {
    const timestamp = new Date(observation.timestamp);
    const timestampValue = timestamp.getTime();
    if (
      !Number.isFinite(timestampValue) ||
      timestampValue <= startTime ||
      timestampValue > endTime
    ) {
      return;
    }

    // UTC hour keys preserve both occurrences of a repeated DST hour while
    // still collapsing multiple station reports within the same hour.
    const hourKey = timestamp.toISOString().slice(0, 13);
    const existing = observationsByHour.get(hourKey);

    if (isPreferredObservation(observation, existing)) {
      observationsByHour.set(hourKey, observation);
    }
  });

  return recentRainfallTotal(
    Array.from(observationsByHour.values(), (observation) => ({
      amountInches: observationPrecipitationInches(observation),
      timestamp: observation.timestamp,
    })),
    6,
    now,
  );
}

async function getStationObservations(
  stationsUrl: string,
): Promise<{
  observations: StationObservation[];
  stationId: string | null;
}> {
  try {
    const stations =
      await fetchNoaaJson<ObservationStationsResponse>(stationsUrl);
    const stationUrl = stations.features[0]?.id;

    if (!stationUrl) return { observations: [], stationId: null };

    const end = new Date();
    const start = new Date(end.getTime() - 30 * 60 * 60 * 1000);
    const url = new URL(`${stationUrl}/observations`);
    url.searchParams.set("start", start.toISOString());
    url.searchParams.set("end", end.toISOString());
    url.searchParams.set("limit", "500");

    const response = await fetchNoaaJson<StationObservationsResponse>(
      url.toString(),
    );
    return {
      observations: response.features.map(({ properties }) => properties),
      stationId: stationUrl.split("/").pop() ?? null,
    };
  } catch {
    return { observations: [], stationId: null };
  }
}

async function getNoaaWeather(
  latitude: number,
  longitude: number,
  locationHint: LocationHint | null = null,
): Promise<WeatherData> {
  const point = await fetchNoaaJson<PointResponse>(
    `https://api.weather.gov/points/${latitude.toFixed(4)},${longitude.toFixed(4)}`,
  );

  const [hourlyForecast, dailyForecast, stationData, gridForecast] =
    await Promise.all([
      fetchNoaaJson<ForecastResponse>(point.properties.forecastHourly),
      fetchNoaaJson<ForecastResponse>(point.properties.forecast),
      getStationObservations(point.properties.observationStations),
      point.properties.forecastGridData
        ? fetchNoaaJson<NoaaGridForecastResponse>(
            point.properties.forecastGridData,
          ).catch(() => null)
        : Promise.resolve(null),
    ]);

  const precipitationIntervals = normalizeNoaaPrecipitation(
    gridForecast?.properties.quantitativePrecipitation,
  );
  const hourly = hourlyForecast.properties.periods.map((period) => ({
    ...period,
    forecastPrecipitationInches: forecastPrecipitationForPeriod(
      precipitationIntervals,
      period.startTime,
      period.endTime,
    ),
  }));
  const observation = stationData.observations[0];
  const fallback = hourly[0];
  const temperatureF = observation?.temperature
    ? observationTemperatureFahrenheit(observation)
    : (fallback?.temperature ?? null);
  const humidity =
    observation?.relativeHumidity.value ??
    fallback?.relativeHumidity?.value ??
    null;

  return {
    city: point.properties.relativeLocation?.properties?.city ?? "Your location",
    coordinates: { latitude, longitude },
    current: {
      description:
        observation?.textDescription ||
        fallback?.shortForecast ||
        "Conditions unavailable",
      humidity,
      sourceLabel: "observed",
      temperatureF,
      timestamp: observation?.timestamp ?? fallback?.startTime ?? null,
      windSpeed: fallback?.windSpeed ?? "—",
    },
    daily: dailyForecast.properties.periods,
    dataLabel: "weather.gov",
    dataUrl: "https://www.weather.gov/documentation/services-web-api",
    hourly,
    locationHint,
    observations: stationData.observations,
    precipitationIntervals,
    provider: "noaa",
    recordKey: stationData.stationId,
    state: point.properties.relativeLocation?.properties?.state ?? "",
    stationId: stationData.stationId,
    timeZone: point.properties.timeZone,
  };
}

function weatherCodeDescription(code: number | null | undefined) {
  switch (code) {
    case 0:
      return "Clear sky";
    case 1:
      return "Mainly clear";
    case 2:
      return "Partly cloudy";
    case 3:
      return "Overcast";
    case 45:
      return "Fog";
    case 48:
      return "Rime fog";
    case 51:
      return "Light drizzle";
    case 53:
      return "Moderate drizzle";
    case 55:
      return "Dense drizzle";
    case 56:
      return "Light freezing drizzle";
    case 57:
      return "Dense freezing drizzle";
    case 61:
      return "Light rain";
    case 63:
      return "Moderate rain";
    case 65:
      return "Heavy rain";
    case 66:
      return "Light freezing rain";
    case 67:
      return "Heavy freezing rain";
    case 71:
      return "Light snow";
    case 73:
      return "Moderate snow";
    case 75:
      return "Heavy snow";
    case 77:
      return "Snow grains";
    case 80:
      return "Light rain showers";
    case 81:
      return "Moderate rain showers";
    case 82:
      return "Violent rain showers";
    case 85:
      return "Light snow showers";
    case 86:
      return "Heavy snow showers";
    case 95:
      return "Thunderstorms";
    case 96:
      return "Thunderstorms with light hail";
    case 99:
      return "Thunderstorms with heavy hail";
    default:
      return "Conditions unavailable";
  }
}

function degreesToCompass(degrees: number | null | undefined) {
  if (degrees === null || degrees === undefined) return "";

  const directions = [
    "N",
    "NNE",
    "NE",
    "ENE",
    "E",
    "ESE",
    "SE",
    "SSE",
    "S",
    "SSW",
    "SW",
    "WSW",
    "W",
    "WNW",
    "NW",
    "NNW",
  ];

  return directions[Math.round(degrees / 22.5) % directions.length];
}

function formatWindSpeed(value: number | null | undefined) {
  return value === null || value === undefined
    ? "—"
    : `${Math.round(value)} mph`;
}

function openMeteoTime(timestamp: number) {
  return new Date(timestamp * 1000).toISOString();
}

async function fetchOpenMeteoJson<T>(url: string): Promise<T> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new WeatherRequestError("open-meteo", response.status);
  }

  return response.json() as Promise<T>;
}

async function getOpenMeteoWeather(
  latitude: number,
  longitude: number,
  locationHint: LocationHint | null,
): Promise<WeatherData> {
  const url = new URL(OPEN_METEO_FORECAST_URL);
  url.searchParams.set("latitude", latitude.toFixed(4));
  url.searchParams.set("longitude", longitude.toFixed(4));
  url.searchParams.set(
    "current",
    [
      "temperature_2m",
      "relative_humidity_2m",
      "is_day",
      "weather_code",
      "wind_speed_10m",
      "wind_direction_10m",
    ].join(","),
  );
  url.searchParams.set(
    "hourly",
    [
      "temperature_2m",
      "relative_humidity_2m",
      "precipitation_probability",
      "precipitation",
      "weather_code",
      "wind_speed_10m",
      "wind_direction_10m",
      "is_day",
    ].join(","),
  );
  url.searchParams.set(
    "daily",
    [
      "weather_code",
      "temperature_2m_max",
      "temperature_2m_min",
      "precipitation_probability_max",
    ].join(","),
  );
  url.searchParams.set("temperature_unit", "fahrenheit");
  url.searchParams.set("wind_speed_unit", "mph");
  url.searchParams.set("precipitation_unit", "inch");
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("timeformat", "unixtime");
  url.searchParams.set("forecast_days", "7");
  url.searchParams.set("past_hours", "30");
  url.searchParams.set("forecast_hours", "168");

  const data = await fetchOpenMeteoJson<OpenMeteoForecastResponse>(
    url.toString(),
  );
  const current = data.current;
  const hourlyData = data.hourly;
  const dailyData = data.daily;
  const timeZone = data.timezone;

  if (!current || !hourlyData || !dailyData || !timeZone) {
    throw new Error("Open-Meteo returned an incomplete forecast.");
  }

  const hourly = hourlyData.time.map<HourlyPeriod>((timestamp, index) => ({
    endTime: openMeteoTime(timestamp + 60 * 60),
    forecastPrecipitationInches:
      hourlyData.precipitation[index] ?? null,
    icon: "",
    isDaytime: hourlyData.is_day[index] === 1,
    name: "",
    number: index + 1,
    probabilityOfPrecipitation: {
      unitCode: "wmoUnit:percent",
      value: hourlyData.precipitation_probability[index] ?? null,
    },
    relativeHumidity: {
      unitCode: "wmoUnit:percent",
      value: hourlyData.relative_humidity_2m[index] ?? null,
    },
    shortForecast: weatherCodeDescription(hourlyData.weather_code[index]),
    startTime: openMeteoTime(timestamp),
    temperature: hourlyData.temperature_2m[index] ?? null,
    temperatureUnit: "F",
    windDirection: degreesToCompass(hourlyData.wind_direction_10m[index]),
    windSpeed: formatWindSpeed(hourlyData.wind_speed_10m[index]),
  }));

  const observations = hourlyData.time
    .map<StationObservation | null>((timestamp, index) => {
      if (timestamp > current.time) return null;

      return {
        icon: null,
        precipitationLastHour: {
          unitCode: "wmoUnit:in",
          value: hourlyData.precipitation[index] ?? null,
        },
        rawMessage: null,
        relativeHumidity: {
          unitCode: "wmoUnit:percent",
          value: hourlyData.relative_humidity_2m[index] ?? null,
        },
        source: "estimated",
        temperature: {
          unitCode: "wmoUnit:degF",
          value: hourlyData.temperature_2m[index] ?? null,
        },
        textDescription: weatherCodeDescription(
          hourlyData.weather_code[index],
        ),
        timestamp: openMeteoTime(timestamp),
      };
    })
    .filter((observation): observation is StationObservation =>
      Boolean(observation),
    );

  const daily = dailyData.time.flatMap<HourlyPeriod>((timestamp, index) => {
    const description = weatherCodeDescription(dailyData.weather_code[index]);
    const precipitationProbability =
      dailyData.precipitation_probability_max[index] ?? null;
    const base = timestamp * 1000;
    const common = {
      icon: "",
      name: "",
      probabilityOfPrecipitation: {
        unitCode: "wmoUnit:percent",
        value: precipitationProbability,
      },
      relativeHumidity: undefined,
      shortForecast: description,
      temperatureUnit: "F",
      windDirection: "",
      windSpeed: "",
    };

    return [
      {
        ...common,
        endTime: new Date(base + 18 * 60 * 60 * 1000).toISOString(),
        isDaytime: true,
        number: index * 2 + 1,
        startTime: new Date(base + 12 * 60 * 60 * 1000).toISOString(),
        temperature: dailyData.temperature_2m_max[index] ?? null,
      },
      {
        ...common,
        endTime: new Date(base + 24 * 60 * 60 * 1000).toISOString(),
        isDaytime: false,
        number: index * 2 + 2,
        startTime: new Date(base + 18 * 60 * 60 * 1000).toISOString(),
        temperature: dailyData.temperature_2m_min[index] ?? null,
      },
    ];
  });

  const state = [locationHint?.region, locationHint?.country]
    .filter((value, index, values) => value && values.indexOf(value) === index)
    .join(", ");

  return {
    city: locationHint?.city || "Your location",
    coordinates: { latitude, longitude },
    current: {
      description: weatherCodeDescription(current.weather_code),
      humidity: current.relative_humidity_2m,
      sourceLabel: "model time",
      temperatureF: current.temperature_2m,
      timestamp: openMeteoTime(current.time),
      windSpeed: formatWindSpeed(current.wind_speed_10m),
    },
    daily,
    dataLabel: "Open-Meteo",
    dataUrl: "https://open-meteo.com/en/docs",
    hourly,
    locationHint,
    observations,
    provider: "open-meteo",
    recordKey: `open-meteo:${latitude.toFixed(3)},${longitude.toFixed(3)}:${timeZone}`,
    state,
    stationId: null,
    timeZone,
  };
}

function locationHintFromPlace(place: PlaceResult): LocationHint {
  return {
    city: place.name,
    country: place.country ?? place.country_code,
    countryCode: place.country_code.toUpperCase(),
    region: place.admin1 ?? place.admin2 ?? "",
    source: place.source ?? "open-meteo-geocoding",
  };
}

async function fetchPlaceResults(
  query: string,
  count: number,
  signal?: AbortSignal,
) {
  const url = new URL(
    "https://geocoding-api.open-meteo.com/v1/search",
  );
  url.searchParams.set("name", query);
  url.searchParams.set("count", String(count));
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");

  const response = await fetch(url, { signal });

  if (!response.ok) {
    throw new Error(`Place search failed (${response.status})`);
  }

  const data = (await response.json()) as GeocodingResponse;
  return data.results ?? [];
}

async function resolveLocationSlug(slug: string) {
  const resultSets: PlaceResult[][] = [];

  for (const query of searchTermsForLocationSlug(slug)) {
    let results: PlaceResult[];
    try {
      results = await fetchPlaceResults(query, 10);
    } catch {
      break;
    }
    resultSets.push(results);

    const place = results.find(
      (candidate) => locationSlugForPlace(candidate, results) === slug,
    );

    if (place) return { canonicalSlug: slug, place };
  }

  const place = await forwardGeocodeSlug(slug);
  if (!place) return null;

  for (const results of resultSets) {
    const matchingPlace = results.find((candidate) => {
      if (
        candidate.country_code.toUpperCase() !==
          place.country_code.toUpperCase() ||
        slugifyPlaceName(candidate.name) !== slugifyPlaceName(place.name)
      ) {
        return false;
      }

      const candidateRegion = slugifyPlaceName(
        candidate.admin1 ?? candidate.admin2 ?? "",
      );
      const placeRegion = slugifyPlaceName(
        place.admin1 ?? place.admin2 ?? "",
      );
      return !candidateRegion || !placeRegion || candidateRegion === placeRegion;
    });

    if (matchingPlace) {
      return {
        canonicalSlug: locationSlugForPlace(matchingPlace, results),
        place,
      };
    }
  }

  return { canonicalSlug: slug, place };
}

function coordinateDistance(
  place: PlaceResult,
  latitude: number,
  longitude: number,
) {
  return (
    (place.latitude - latitude) ** 2 +
    (place.longitude - longitude) ** 2
  );
}

async function canonicalLocationSlug(weather: WeatherData) {
  if (weather.city === "Your location") return null;

  const citySlug = slugifyPlaceName(weather.city);
  if (!citySlug) return null;

  try {
    const results = await fetchPlaceResults(weather.city, 10);
    const exactMatches = results.filter(
      (place) => slugifyPlaceName(place.name) === citySlug,
    );
    const closest = exactMatches.sort(
      (left, right) =>
        coordinateDistance(
          left,
          weather.coordinates.latitude,
          weather.coordinates.longitude,
        ) -
        coordinateDistance(
          right,
          weather.coordinates.latitude,
          weather.coordinates.longitude,
        ),
    )[0];

    return closest
      ? locationSlugForPlace(closest, results)
      : citySlug;
  } catch {
    return citySlug;
  }
}

function updateMetadataElement(selector: string, content: string) {
  const element = document.querySelector<HTMLMetaElement>(selector);
  if (element) element.content = content;
}

function updateLocationJsonLd(
  weather: WeatherData,
  placeName: string,
  title: string,
  description: string,
  canonicalUrl: string,
) {
  let script = document.querySelector<HTMLScriptElement>(
    "#location-json-ld",
  );
  if (!script) {
    script = document.createElement("script");
    script.id = "location-json-ld";
    script.type = "application/ld+json";
    document.head.append(script);
  }

  script.text = JSON.stringify({
    "@context": "https://schema.org",
    "@id": `${canonicalUrl}#weather`,
    "@type": "WebPage",
    about: {
      "@type": "Place",
      address: {
        "@type": "PostalAddress",
        addressCountry: weather.locationHint?.countryCode ?? "",
        addressRegion: weather.locationHint?.region || weather.state,
      },
      geo: {
        "@type": "GeoCoordinates",
        latitude: weather.coordinates.latitude,
        longitude: weather.coordinates.longitude,
      },
      name: placeName,
    },
    description,
    inLanguage: "en-US",
    isPartOf: {
      "@id": `${SITE_URL}/#website`,
    },
    mainEntity: {
      "@id": `${SITE_URL}/#weather-app`,
    },
    name: title,
    potentialAction: {
      "@type": "ViewAction",
      name: "View plaintext weather forecast",
      target: `${canonicalUrl}?format=text`,
    },
    primaryImageOfPage: {
      "@type": "ImageObject",
      contentUrl: `${SITE_URL}/og.png`,
      height: 909,
      width: 1731,
    },
    url: canonicalUrl,
  }).replace(/</g, "\\u003c");
}

function updateSharedLocation(weather: WeatherData, slug: string) {
  const url = new URL(window.location.href);
  url.pathname = `/${slug}/`;
  url.searchParams.delete(LEGACY_LOCATION_QUERY_KEY);

  window.history.replaceState(
    {
      ...(window.history.state && typeof window.history.state === "object"
        ? window.history.state
        : {}),
      weatherLocation: {
        coordinates: weather.coordinates,
        locationHint: weather.locationHint,
      },
    },
    "",
    url,
  );

  const placeName = [weather.city, weather.state].filter(Boolean).join(", ");
  const title = `${placeName} Weather Forecast: Hourly & 7-Day | ${SITE_NAME}`;
  const socialTitle = `${placeName} Weather Forecast — Current, Hourly & 7-Day`;
  const description = `Get current weather in ${placeName}, including temperature, humidity, wind and rain, plus an hour-by-hour forecast, 7-day outlook and daily records.`;
  const canonicalUrl = new URL(`/${slug}/`, window.location.origin).href;
  const canonical = document.querySelector<HTMLLinkElement>(
    'link[rel="canonical"]',
  );

  document.title = title;
  if (canonical) canonical.href = canonicalUrl;
  updateMetadataElement('meta[name="description"]', description);
  updateMetadataElement(
    'meta[name="keywords"]',
    `${placeName} weather, ${placeName} weather forecast, hourly weather, 7-day forecast, current conditions`,
  );
  updateMetadataElement('meta[property="og:title"]', socialTitle);
  updateMetadataElement('meta[property="og:description"]', description);
  updateMetadataElement('meta[property="og:url"]', canonicalUrl);
  updateMetadataElement(
    'meta[property="og:image:alt"]',
    `${placeName} local weather forecast on ${SITE_NAME}`,
  );
  updateMetadataElement('meta[name="twitter:title"]', socialTitle);
  updateMetadataElement('meta[name="twitter:description"]', description);
  updateMetadataElement(
    'meta[name="twitter:image:alt"]',
    `${placeName} local weather forecast on ${SITE_NAME}`,
  );
  updateLocationJsonLd(
    weather,
    placeName,
    title,
    description,
    canonicalUrl,
  );
}

function resetSharedLocation() {
  const url = new URL(window.location.href);
  url.pathname = "/";
  url.searchParams.delete(LEGACY_LOCATION_QUERY_KEY);
  window.history.replaceState(window.history.state, "", url);
}

function coordinateCacheKey(latitude: number, longitude: number) {
  return `${latitude.toFixed(3)},${longitude.toFixed(3)}`;
}

function normalizedWeatherPath(pathname: string) {
  const trimmed = pathname.replace(/^\/+|\/+$/g, "");
  return trimmed ? `/${trimmed}/` : "/";
}

function isWeatherData(value: unknown): value is WeatherData {
  if (!value || typeof value !== "object") return false;

  const weather = value as WeatherData;
  return (
    typeof weather.city === "string" &&
    typeof weather.coordinates?.latitude === "number" &&
    Number.isFinite(weather.coordinates.latitude) &&
    typeof weather.coordinates?.longitude === "number" &&
    Number.isFinite(weather.coordinates.longitude) &&
    typeof weather.current === "object" &&
    Array.isArray(weather.daily) &&
    Array.isArray(weather.hourly) &&
    Array.isArray(weather.observations) &&
    (weather.provider === "noaa" || weather.provider === "open-meteo") &&
    typeof weather.timeZone === "string"
  );
}

function readWeatherCache() {
  if (typeof window === "undefined") return [] as WeatherCacheEntry[];

  try {
    const value = JSON.parse(
      window.localStorage.getItem(WEATHER_CACHE_KEY) ?? "[]",
    );
    if (!Array.isArray(value)) return [];

    const now = Date.now();
    return value.filter((entry): entry is WeatherCacheEntry => {
      if (!entry || typeof entry !== "object") return false;

      const candidate = entry as WeatherCacheEntry;
      const age = now - candidate.updatedAt;
      return (
        typeof candidate.key === "string" &&
        Array.isArray(candidate.paths) &&
        candidate.paths.every((path) => typeof path === "string") &&
        Number.isFinite(candidate.updatedAt) &&
        age >= 0 &&
        age < WEATHER_CACHE_TTL_MS &&
        isWeatherData(candidate.weather)
      );
    });
  } catch {
    return [];
  }
}

function cachedWeatherForCoordinates(latitude: number, longitude: number) {
  const key = coordinateCacheKey(latitude, longitude);
  return readWeatherCache().find((entry) => entry.key === key) ?? null;
}

function cachedWeatherForPath(pathname: string) {
  const path = normalizedWeatherPath(pathname);
  return readWeatherCache().find((entry) => entry.paths.includes(path)) ?? null;
}

function writeWeatherCache(
  weather: WeatherData,
  updatedAt: number,
  pathname: string,
) {
  const key = coordinateCacheKey(
    weather.coordinates.latitude,
    weather.coordinates.longitude,
  );
  const path = normalizedWeatherPath(pathname);
  const entries = readWeatherCache();
  const existing = entries.find((entry) => entry.key === key);
  const paths = [path, ...(existing?.paths ?? []).filter((value) => value !== path)];
  const nextEntries = [
    { key, paths, updatedAt, weather },
    ...entries.filter((entry) => entry.key !== key),
  ].slice(0, 8);

  try {
    window.localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify(nextEntries));
  } catch {
    // Forecasts still work when browser storage is unavailable or full.
  }
}

function serverDailyForecasts(weather: WeatherData) {
  const byDate = new Map<
    string,
    {
      date: string;
      high_f: number | null;
      low_f: number | null;
      precip_chance: number | null;
      sky: string;
    }
  >();

  weather.daily.forEach((period) => {
    const date = new Date(period.startTime);
    const key = localDateKey(date, weather.timeZone);
    const daily = byDate.get(key) ?? {
      date: date.toISOString(),
      high_f: null,
      low_f: null,
      precip_chance: null,
      sky: period.shortForecast,
    };

    if (period.isDaytime) {
      daily.high_f = period.temperature;
      daily.sky = period.shortForecast || daily.sky;
    } else {
      daily.low_f = period.temperature;
    }

    const precipitation = period.probabilityOfPrecipitation?.value ?? null;
    if (
      precipitation !== null &&
      (daily.precip_chance === null ||
        precipitation > daily.precip_chance)
    ) {
      daily.precip_chance = precipitation;
    }
    byDate.set(key, daily);
  });

  return Array.from(byDate.values()).slice(0, 7);
}

function serverWeatherReport(weather: WeatherData) {
  const observationsByHour = new Map<string, StationObservation>();
  weather.observations.forEach((observation) => {
    const timestamp = new Date(observation.timestamp);
    if (Number.isNaN(timestamp.getTime())) return;

    const key = timestamp.toISOString().slice(0, 13);
    const existing = observationsByHour.get(key);
    if (isPreferredObservation(observation, existing)) {
      observationsByHour.set(key, observation);
    }
  });

  const hint = weather.locationHint;
  const countryCode = hint?.countryCode ?? (weather.provider === "noaa" ? "US" : "");

  return {
    current: {
      humidity: weather.current.humidity,
      observed_at: weather.current.timestamp,
      sky: weather.current.description,
      source: weather.current.sourceLabel,
      temperature_f: weather.current.temperatureF,
      wind: weather.current.windSpeed,
    },
    daily: serverDailyForecasts(weather),
    hourly: weather.hourly.map((period) => {
      const start = new Date(period.startTime);
      const observation = Number.isNaN(start.getTime())
        ? undefined
        : observationsByHour.get(start.toISOString().slice(0, 13));

      return {
        end_time: period.endTime,
        humidity:
          observation?.relativeHumidity.value ??
          period.relativeHumidity?.value ??
          null,
        observation_kind: observation
          ? observation.source === "estimated"
            ? "estimated"
            : "station"
          : "",
        observed: Boolean(observation),
        precip_chance: period.probabilityOfPrecipitation?.value ?? null,
        precip_inches: observation
          ? observationPrecipitationInches(observation)
          : (period.forecastPrecipitationInches ?? null),
        sky: observation?.textDescription || period.shortForecast,
        start_time: period.startTime,
        temperature_f: observation
          ? observationTemperatureFahrenheit(observation)
          : period.temperature,
      };
    }),
    location: {
      country: hint?.country ?? countryCode,
      country_code: countryCode,
      latitude: weather.coordinates.latitude,
      longitude: weather.coordinates.longitude,
      name: weather.city,
      region: hint?.region || weather.state,
      source:
        hint?.source === "osm"
          ? "OpenStreetMap Nominatim"
          : hint
            ? "Open-Meteo geocoding"
            : "coordinates",
      time_zone: weather.timeZone,
    },
    provider: weather.provider === "noaa" ? "NOAA" : "Open-Meteo",
    station_id: weather.stationId ?? undefined,
  };
}

async function shareWeatherWithServer(
  weather: WeatherData,
  updatedAt: number,
  pathname: string,
) {
  const maxAgeSeconds = Math.floor(
    (updatedAt + WEATHER_CACHE_TTL_MS - Date.now()) / 1000,
  );
  if (maxAgeSeconds <= 0) return;

  try {
    await fetch("/api/weather-cache", {
      body: JSON.stringify({
        max_age_seconds: maxAgeSeconds,
        path: normalizedWeatherPath(pathname),
        report: serverWeatherReport(weather),
      }),
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      method: "POST",
    });
  } catch {
    // The browser forecast remains usable if server cache warming fails.
  }
}

let serverWeatherShareQueue: Promise<void> = Promise.resolve();

function cacheWeatherForCurrentPage(weather: WeatherData, updatedAt: number) {
  const pathname = window.location.pathname;
  writeWeatherCache(weather, updatedAt, pathname);
  serverWeatherShareQueue = serverWeatherShareQueue.then(() =>
    shareWeatherWithServer(weather, updatedAt, pathname),
  );
}

function readForwardGeocodeCache() {
  if (typeof window === "undefined") return [] as ForwardGeocodeCacheEntry[];

  try {
    const value = JSON.parse(
      window.localStorage.getItem(FORWARD_GEOCODE_CACHE_KEY) ?? "[]",
    );
    return Array.isArray(value) ? (value as ForwardGeocodeCacheEntry[]) : [];
  } catch {
    return [];
  }
}

function writeForwardGeocodeCache(entries: ForwardGeocodeCacheEntry[]) {
  try {
    window.localStorage.setItem(
      FORWARD_GEOCODE_CACHE_KEY,
      JSON.stringify(entries.slice(0, 25)),
    );
  } catch {
    // Weather should continue even if storage is unavailable or full.
  }
}

function readPlaceSearchCache() {
  if (typeof window === "undefined") return [] as PlaceSearchCacheEntry[];

  try {
    const value = JSON.parse(
      window.localStorage.getItem(PLACE_SEARCH_CACHE_KEY) ?? "[]",
    );
    return Array.isArray(value) ? (value as PlaceSearchCacheEntry[]) : [];
  } catch {
    return [];
  }
}

function writePlaceSearchCache(entries: PlaceSearchCacheEntry[]) {
  try {
    window.localStorage.setItem(
      PLACE_SEARCH_CACHE_KEY,
      JSON.stringify(entries.slice(0, 25)),
    );
  } catch {
    // Place search should continue if storage is unavailable or full.
  }
}

function readReverseGeocodeCache() {
  if (typeof window === "undefined") return [] as ReverseGeocodeCacheEntry[];

  try {
    const value = JSON.parse(
      window.localStorage.getItem(REVERSE_GEOCODE_CACHE_KEY) ?? "[]",
    );
    return Array.isArray(value) ? (value as ReverseGeocodeCacheEntry[]) : [];
  } catch {
    return [];
  }
}

function writeReverseGeocodeCache(entries: ReverseGeocodeCacheEntry[]) {
  try {
    window.localStorage.setItem(
      REVERSE_GEOCODE_CACHE_KEY,
      JSON.stringify(entries.slice(0, 25)),
    );
  } catch {
    // Weather should continue even if storage is unavailable or full.
  }
}

let nominatimQueue: Promise<void> = Promise.resolve();
let lastNominatimRequest = 0;

function queueNominatimRequest<T>(request: () => Promise<T>) {
  const run = nominatimQueue.then(async () => {
    const waitFor = Math.max(
      0,
      1000 - (Date.now() - lastNominatimRequest),
    );

    if (waitFor > 0) {
      await new Promise((resolve) => window.setTimeout(resolve, waitFor));
    }

    lastNominatimRequest = Date.now();
    return request();
  });

  nominatimQueue = run.then(
    () => undefined,
    () => undefined,
  );

  return run;
}

async function searchPhotonPlaces(
  query: string,
  count: number,
  signal: AbortSignal,
): Promise<PlaceResult[]> {
  const key = query.trim().toLocaleLowerCase("en");
  const cache = readPlaceSearchCache();
  const cached = cache.find(
    (entry) =>
      entry.key === key &&
      Date.now() - entry.updatedAt < PLACE_SEARCH_CACHE_TTL_MS,
  );

  if (cached) return cached.places.slice(0, count);

  const url = new URL(PHOTON_SEARCH_URL);
  url.searchParams.set("q", query.trim());
  url.searchParams.set("limit", String(count));
  url.searchParams.set("lang", "en");
  url.searchParams.set("osm_tag", "place");

  const response = await fetch(url, {
    referrerPolicy: "strict-origin-when-cross-origin",
    signal,
  });
  if (!response.ok) {
    throw new Error(`Place search failed (${response.status})`);
  }

  const places = photonPlaceResults(await response.json()) as PlaceResult[];
  const nextCache = [
    { key, places, updatedAt: Date.now() },
    ...cache.filter((entry) => entry.key !== key),
  ];
  writePlaceSearchCache(nextCache);
  return places.slice(0, count);
}

async function forwardGeocodeSlug(slug: string): Promise<PlaceResult | null> {
  const cache = readForwardGeocodeCache();
  const cached = cache.find(
    (entry) =>
      entry.key === slug &&
      Date.now() - entry.updatedAt < REVERSE_GEOCODE_CACHE_TTL_MS,
  );

  if (cached) return cached.place;

  return queueNominatimRequest(async () => {
    const url = new URL(NOMINATIM_SEARCH_URL);
    url.searchParams.set("q", slug.replaceAll("-", " "));
    url.searchParams.set("format", "geocodejson");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("featureType", "settlement");
    url.searchParams.set("limit", "5");
    url.searchParams.set("accept-language", "en");

    const response = await fetch(url, {
      referrerPolicy: "strict-origin-when-cross-origin",
    });
    if (!response.ok) return null;

    const data = (await response.json()) as NominatimResponse;
    for (const place of nominatimPlaceResults(data) as PlaceResult[]) {
      const nextCache = [
        { key: slug, place, updatedAt: Date.now() },
        ...cache.filter((entry) => entry.key !== slug),
      ];
      writeForwardGeocodeCache(nextCache);
      return place;
    }

    return null;
  });
}

async function reverseGeocodeCoordinates(
  latitude: number,
  longitude: number,
): Promise<LocationHint | null> {
  const key = coordinateCacheKey(latitude, longitude);
  const cache = readReverseGeocodeCache();
  const cached = cache.find(
    (entry) =>
      entry.key === key &&
      Date.now() - entry.updatedAt < REVERSE_GEOCODE_CACHE_TTL_MS,
  );

  if (cached) return cached.hint;

  return queueNominatimRequest(async () => {
    const url = new URL(NOMINATIM_REVERSE_URL);
    url.searchParams.set("lat", latitude.toFixed(4));
    url.searchParams.set("lon", longitude.toFixed(4));
    url.searchParams.set("format", "geocodejson");
    url.searchParams.set("zoom", "10");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("accept-language", "en");

    const response = await fetch(url, {
      referrerPolicy: "strict-origin-when-cross-origin",
    });
    if (!response.ok) return null;

    const data = (await response.json()) as NominatimResponse;
    const place = data.features?.[0]?.properties?.geocoding;
    const countryCode = place?.country_code?.toUpperCase();

    if (!place || !countryCode) return null;

    const hint: LocationHint = {
      city:
        place.city ??
        place.town ??
        place.village ??
        place.municipality ??
        place.locality ??
        place.district ??
        place.name ??
        "Your location",
      country: place.country ?? countryCode,
      countryCode,
      region: place.state ?? place.district ?? "",
      source: "osm",
    };
    const nextCache = [
      { hint, key, updatedAt: Date.now() },
      ...cache.filter((entry) => entry.key !== key),
    ];
    writeReverseGeocodeCache(nextCache);
    return hint;
  });
}

async function getWeatherForCoordinates(
  latitude: number,
  longitude: number,
  locationHint: LocationHint | null = null,
) {
  let resolvedHint = locationHint;

  if (!resolvedHint) {
    try {
      resolvedHint = await reverseGeocodeCoordinates(latitude, longitude);
    } catch {
      resolvedHint = null;
    }
  }

  if (resolvedHint) {
    return NOAA_COUNTRY_CODES.has(resolvedHint.countryCode)
      ? getNoaaWeather(latitude, longitude, resolvedHint)
      : getOpenMeteoWeather(latitude, longitude, resolvedHint);
  }

  try {
    return await getNoaaWeather(latitude, longitude);
  } catch (error) {
    if (
      error instanceof WeatherRequestError &&
      error.provider === "noaa" &&
      error.status === 404
    ) {
      return getOpenMeteoWeather(latitude, longitude, null);
    }
    throw error;
  }
}

function addAcisSummaries(
  records: ClimateRecords,
  summaries: unknown,
  kind: "high" | "low",
) {
  if (!Array.isArray(summaries)) return;

  summaries.forEach((summary) => {
    if (!Array.isArray(summary) || summary.length < 2) return;

    const temperatureF = Number(summary[0]);
    const date = summary[1];
    const dateMatch =
      typeof date === "string"
        ? /^\d{4}-(\d{2})-(\d{2})$/.exec(date)
        : null;

    if (!Number.isFinite(temperatureF) || !dateMatch) return;

    const monthDay = `${dateMatch[1]}-${dateMatch[2]}`;
    const record = records[monthDay] ?? {
      average: null,
      high: null,
      low: null,
    };
    record[kind] = { date, temperatureF };
    records[monthDay] = record;
  });
}

function addAcisAverages(records: ClimateRecords, summaries: unknown) {
  if (!Array.isArray(summaries)) return;

  summaries.slice(0, 366).forEach((summary, index) => {
    const temperatureF = Number(summary);
    if (!Number.isFinite(temperatureF)) return;

    const date = new Date(Date.UTC(2000, 0, index + 1));
    const monthDay = `${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(
      date.getUTCDate(),
    ).padStart(2, "0")}`;
    const record = records[monthDay] ?? {
      average: null,
      high: null,
      low: null,
    };
    record.average = { temperatureF };
    records[monthDay] = record;
  });
}

async function getAcisDailyRecords(
  stationId: string,
  signal: AbortSignal,
): Promise<{ records: ClimateRecords; stationName: string | null }> {
  const params = {
    sid: stationId,
    sdate: "por",
    edate: "por",
    meta: ["name", "state"],
    elems: [
      {
        name: "maxt",
        interval: "dly",
        duration: "dly",
        smry: { reduce: "max", add: "date" },
        smry_only: 1,
        groupby: "year",
      },
      {
        name: "mint",
        interval: "dly",
        duration: "dly",
        smry: { reduce: "min", add: "date" },
        smry_only: 1,
        groupby: "year",
      },
      {
        name: "avgt",
        interval: "dly",
        duration: "dly",
        smry: "mean",
        smry_only: 1,
        groupby: "year",
      },
    ],
  };
  const response = await fetch(ACIS_STATION_DATA_URL, {
    body: new URLSearchParams({ params: JSON.stringify(params) }),
    method: "POST",
    signal,
  });

  if (!response.ok) {
    throw new Error(`ACIS request failed (${response.status})`);
  }

  const data = (await response.json()) as AcisResponse;

  if (data.error) throw new Error(data.error);

  const records: ClimateRecords = {};
  addAcisSummaries(records, data.smry?.[0], "high");
  addAcisSummaries(records, data.smry?.[1], "low");
  addAcisAverages(records, data.smry?.[2]);

  return {
    records,
    stationName: data.meta?.name ?? null,
  };
}

function readOpenMeteoRecordCache() {
  if (typeof window === "undefined") return [] as OpenMeteoRecordCacheEntry[];

  try {
    const value = JSON.parse(
      window.localStorage.getItem(OPEN_METEO_RECORD_CACHE_KEY) ?? "[]",
    );
    return Array.isArray(value)
      ? (value as OpenMeteoRecordCacheEntry[])
      : [];
  } catch {
    return [];
  }
}

function writeOpenMeteoRecordCache(entries: OpenMeteoRecordCacheEntry[]) {
  try {
    window.localStorage.setItem(
      OPEN_METEO_RECORD_CACHE_KEY,
      JSON.stringify(entries.slice(0, 12)),
    );
  } catch {
    // Record estimates are optional if browser storage is unavailable.
  }
}

function isValidUtcDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function historicalWindowForYear(
  targetDateKeys: string[],
  baseYear: number,
  lastCompletedYear: number,
) {
  let yearOffset = 0;
  let previousMonth = Number(targetDateKeys[0]?.slice(5, 7));
  const dates: string[] = [];

  targetDateKeys.forEach((dateKey, index) => {
    const month = Number(dateKey.slice(5, 7));
    const day = Number(dateKey.slice(8, 10));

    if (index > 0 && month < previousMonth) yearOffset += 1;
    previousMonth = month;

    const year = baseYear + yearOffset;
    if (
      year < OPEN_METEO_RECORD_START_YEAR ||
      year > lastCompletedYear ||
      !isValidUtcDate(year, month, day)
    ) {
      return;
    }

    dates.push(
      `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    );
  });

  return dates.length
    ? { endDate: dates[dates.length - 1], startDate: dates[0] }
    : null;
}

async function fetchOpenMeteoRecordWindow(
  latitude: number,
  longitude: number,
  timeZone: string,
  startDate: string,
  endDate: string,
  signal: AbortSignal,
) {
  const url = new URL(OPEN_METEO_ARCHIVE_URL);
  url.searchParams.set("latitude", latitude.toFixed(4));
  url.searchParams.set("longitude", longitude.toFixed(4));
  url.searchParams.set("start_date", startDate);
  url.searchParams.set("end_date", endDate);
  url.searchParams.set(
    "daily",
    "temperature_2m_max,temperature_2m_min",
  );
  url.searchParams.set("temperature_unit", "fahrenheit");
  url.searchParams.set("timezone", timeZone);
  url.searchParams.set("models", "era5_land");

  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new WeatherRequestError("open-meteo", response.status);
  }

  const data = (await response.json()) as OpenMeteoArchiveResponse;
  if (data.error || !data.daily) {
    throw new Error(data.reason ?? "Open-Meteo archive data is unavailable.");
  }

  return data.daily;
}

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
) {
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        await worker(items[index]);
      }
    },
  );

  await Promise.all(workers);
}

function cloneClimateRecords(records: ClimateRecords) {
  return Object.fromEntries(
    Object.entries(records).map(([monthDay, record]) => [
      monthDay,
      {
        average: record.average ? { ...record.average } : null,
        high: record.high ? { ...record.high } : null,
        low: record.low ? { ...record.low } : null,
      },
    ]),
  ) as ClimateRecords;
}

function estimatedRecordsWithCoverage(
  records: ClimateRecords,
  monthDays: string[],
  throughYear: number,
) {
  const coverage = `${OPEN_METEO_RECORD_START_YEAR}–${throughYear}`;
  const result: ClimateRecords = {};

  monthDays.forEach((monthDay) => {
    const record = records[monthDay];
    if (!record) return;

    result[monthDay] = {
      average: record.average
        ? { ...record.average, coverage, estimated: true }
        : null,
      high: record.high
        ? { ...record.high, coverage, estimated: true }
        : null,
      low: record.low
        ? { ...record.low, coverage, estimated: true }
        : null,
    };
  });

  return result;
}

async function getOpenMeteoDailyRecords(
  latitude: number,
  longitude: number,
  timeZone: string,
  targetDateKeys: string[],
  signal: AbortSignal,
): Promise<{ records: ClimateRecords; throughYear: number }> {
  const lastCompletedYear =
    Number(zonedParts(new Date(), timeZone).year) - 1;
  const targetMonthDays = [
    ...new Set(targetDateKeys.map((dateKey) => dateKey.slice(5))),
  ];
  const cacheKey = `${coordinateCacheKey(latitude, longitude)}:${timeZone}`;
  const cache = readOpenMeteoRecordCache();
  const cached = cache.find((entry) => entry.key === cacheKey);
  const cachedCoverage = cached?.coverage ?? {};
  const existingRecords = cloneClimateRecords(cached?.records ?? {});
  const minimumStartYear = Math.min(
    ...targetMonthDays.map(
      (monthDay) =>
        Math.max(
          cachedCoverage[monthDay] ?? OPEN_METEO_RECORD_START_YEAR - 1,
          OPEN_METEO_RECORD_START_YEAR - 1,
        ) + 1,
    ),
  );
  const hasFreshCache = targetMonthDays.every(
    (monthDay) => cachedCoverage[monthDay] >= lastCompletedYear,
  );

  if (hasFreshCache) {
    return {
      records: estimatedRecordsWithCoverage(
        existingRecords,
        targetMonthDays,
        lastCompletedYear,
      ),
      throughYear: lastCompletedYear,
    };
  }

  const crossesYear = targetDateKeys.some(
    (dateKey, index) =>
      index > 0 &&
      Number(dateKey.slice(5, 7)) <
        Number(targetDateKeys[index - 1].slice(5, 7)),
  );
  const firstBaseYear = Math.max(
    OPEN_METEO_RECORD_START_YEAR - (crossesYear ? 1 : 0),
    minimumStartYear - (crossesYear ? 1 : 0),
  );
  const windows = Array.from(
    { length: Math.max(0, lastCompletedYear - firstBaseYear + 1) },
    (_, index) =>
      historicalWindowForYear(
        targetDateKeys,
        firstBaseYear + index,
        lastCompletedYear,
      ),
  ).filter(
    (
      window,
    ): window is {
      endDate: string;
      startDate: string;
    } => Boolean(window),
  );
  const records = cloneClimateRecords(existingRecords);

  try {
    await mapWithConcurrency(
      windows,
      OPEN_METEO_RECORD_CONCURRENCY,
      async ({ startDate, endDate }) => {
        const daily = await fetchOpenMeteoRecordWindow(
          latitude,
          longitude,
          timeZone,
          startDate,
          endDate,
          signal,
        );

        daily.time.forEach((date, index) => {
          const monthDay = date.slice(5);
          if (!targetMonthDays.includes(monthDay)) return;
          if (
            Number(date.slice(0, 4)) <=
            (cachedCoverage[monthDay] ?? OPEN_METEO_RECORD_START_YEAR - 1)
          ) {
            return;
          }

          const high = daily.temperature_2m_max[index];
          const low = daily.temperature_2m_min[index];
          const record = records[monthDay] ?? {
            average: null,
            high: null,
            low: null,
          };

          if (
            high !== null &&
            (!record.high || high > record.high.temperatureF)
          ) {
            record.high = { date, temperatureF: high };
          }
          if (
            low !== null &&
            (!record.low || low < record.low.temperatureF)
          ) {
            record.low = { date, temperatureF: low };
          }
          if (high !== null && low !== null) {
            const dailyAverage = (high + low) / 2;
            const sampleCount = record.average?.sampleCount ?? 0;
            const previousTotal =
              (record.average?.temperatureF ?? 0) * sampleCount;
            record.average = {
              sampleCount: sampleCount + 1,
              temperatureF:
                (previousTotal + dailyAverage) / (sampleCount + 1),
            };
          }

          records[monthDay] = record;
        });
      },
    );
  } catch (error) {
    const cachedYears = targetMonthDays.map(
      (monthDay) => cachedCoverage[monthDay] ?? 0,
    );
    const cachedThroughYear = Math.min(...cachedYears);

    if (cached && cachedThroughYear >= OPEN_METEO_RECORD_START_YEAR) {
      return {
        records: estimatedRecordsWithCoverage(
          existingRecords,
          targetMonthDays,
          cachedThroughYear,
        ),
        throughYear: cachedThroughYear,
      };
    }
    throw error;
  }

  const nextCoverage = { ...cachedCoverage };
  targetMonthDays.forEach((monthDay) => {
    nextCoverage[monthDay] = lastCompletedYear;
  });
  const nextEntry: OpenMeteoRecordCacheEntry = {
    coverage: nextCoverage,
    key: cacheKey,
    records,
    updatedAt: Date.now(),
  };
  writeOpenMeteoRecordCache([
    nextEntry,
    ...cache.filter((entry) => entry.key !== cacheKey),
  ]);

  return {
    records: estimatedRecordsWithCoverage(
      records,
      targetMonthDays,
      lastCompletedYear,
    ),
    throughYear: lastCompletedYear,
  };
}

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(date);

  return Object.fromEntries(parts.map(({ type, value }) => [type, value]));
}

function localDateKey(date: Date, timeZone: string) {
  const parts = zonedParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function closestDisplayHour(now: Date, timeZone: string) {
  const parts = zonedParts(now, timeZone);
  const fractionalHour = Number(parts.hour) + Number(parts.minute) / 60;
  return Math.min(22, Math.max(5, Math.round(fractionalHour)));
}

function formatHour(hour: number) {
  const period = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour} ${period}`;
}

function formatDate(timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone,
    weekday: "long",
  }).format(new Date());
}

function formatForecastDay(date: Date, timeZone: string) {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
  }).format(date);
  const monthDay = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "numeric",
    timeZone,
  }).format(date);

  return `${weekday} ${monthDay}`;
}

function formatRecordTitle(
  kind: "high" | "low",
  record: ClimateRecordValue | null,
  metric: boolean,
) {
  if (!record) return undefined;

  const date = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(`${record.date}T00:00:00Z`));

  return record.estimated
    ? `Estimated record ${kind}: ${formatTemperature(record.temperatureF, metric)} on ${date} (ERA5-Land, ${record.coverage})`
    : `Record ${kind}: ${formatTemperature(record.temperatureF, metric)} on ${date}`;
}

function formatAverageTitle(
  average: ClimateAverageValue | null,
  metric: boolean,
) {
  if (!average) return undefined;

  const temperature = formatTemperature(average.temperatureF, metric);
  return average.estimated
    ? `Estimated historical average: ${temperature} (daily mean, ERA5-Land, ${average.coverage})`
    : `Historical average: ${temperature} (daily mean, ACIS station period of record)`;
}

type PrecipitationPeak = {
  startTime: string;
  value: number;
};

function maximumPrecipitationChance(
  periods: HourlyPeriod[],
): PrecipitationPeak | null {
  return [...periods]
    .sort(
      (left, right) =>
        new Date(left.startTime).getTime() -
        new Date(right.startTime).getTime(),
    )
    .reduce<PrecipitationPeak | null>((highest, period) => {
      const value = period.probabilityOfPrecipitation?.value ?? null;

      // Keep the existing period on ties so the first chronological hour wins.
      if (value === null || (highest && value <= highest.value)) return highest;

      return { startTime: period.startTime, value };
    }, null);
}

function formatRainTitle(
  rain: PrecipitationPeak | null,
  timeZone: string,
) {
  if (!rain) return undefined;

  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    timeZone,
    timeZoneName: "short",
  }).format(new Date(rain.startTime));

  return `Highest rain chance: ${Math.round(rain.value)}% at ${time}`;
}

function formatUpdated(
  timestamp: string | null,
  timeZone: string,
  sourceLabel: CurrentReading["sourceLabel"],
) {
  if (!timestamp) return "update time unavailable";
  return `${sourceLabel} ${new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(timestamp))}`;
}

function WeatherIcon({
  description,
  isDaytime = true,
  size,
  strokeWidth,
}: {
  description: string;
  isDaytime?: boolean;
  size: number;
  strokeWidth?: number;
}) {
  const value = description.toLowerCase();
  const props = { "aria-hidden": true, size, strokeWidth };

  if (value.includes("thunder")) return <CloudLightning {...props} />;
  if (value.includes("snow") || value.includes("sleet")) {
    return <Snowflake {...props} />;
  }
  if (
    value.includes("rain") ||
    value.includes("shower") ||
    value.includes("drizzle")
  ) {
    return <CloudRain {...props} />;
  }
  if (value.includes("fog") || value.includes("haze") || value.includes("smoke")) {
    return <CloudFog {...props} />;
  }
  if (
    value.includes("partly") ||
    value.includes("mostly sunny") ||
    value.includes("mostly clear")
  ) {
    return <CloudSun {...props} />;
  }
  if (value.includes("cloud") || value.includes("overcast")) {
    return <Cloud {...props} />;
  }
  return isDaytime ? <Sun {...props} /> : <Moon {...props} />;
}

function readableError(error: GeolocationPositionError | Error) {
  if ("code" in error) {
    if (error.code === error.PERMISSION_DENIED) {
      return "Location access was declined. Allow location access and try again.";
    }
    if (error.code === error.POSITION_UNAVAILABLE) {
      return "Your location is currently unavailable.";
    }
    return "Finding your location took too long.";
  }

  if (error instanceof WeatherRequestError) {
    return `${error.provider === "noaa" ? "NOAA" : "Open-Meteo"} weather data could not be reached. Please try again.`;
  }

  return "Weather data could not be reached. Please try again.";
}

export default function WeatherClient() {
  const [phase, setPhase] = useState<LoadPhase>("locating");
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [error, setError] = useState("");
  const [requestKey, setRequestKey] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [placeResults, setPlaceResults] = useState<PlaceResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [climateRecords, setClimateRecords] = useState<ClimateRecords>({});
  const [climateRecordKey, setClimateRecordKey] = useState<string | null>(null);
  const [climateRecordSource, setClimateRecordSource] = useState<
    "acis" | "open-meteo" | null
  >(null);
  const [climateRecordThroughYear, setClimateRecordThroughYear] = useState<
    number | null
  >(null);
  const [climateStationName, setClimateStationName] = useState<string | null>(
    null,
  );
  const tooltip = useTooltip();
  const metricUnits = weather
    ? usesMetricUnits(weather.locationHint?.countryCode, weather.provider)
    : false;

  const searchPlaces = useCallback(
    async (query: string, signal: AbortSignal) => {
      setSearching(true);
      setSearchError("");

      try {
        const results = await searchPhotonPlaces(query, 6, signal);
        if (signal.aborted) return;

        setPlaceResults(results);
        setSearchError(results.length ? "" : "No places found.");
      } catch {
        if (signal.aborted) return;
        setPlaceResults([]);
        setSearchError("Place search is unavailable. Try again.");
      } finally {
        if (!signal.aborted) setSearching(false);
      }
    },
    [],
  );

  useEffect(() => {
    const query = searchQuery.trim();
    if (!searchOpen || query.length < 2) return;

    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      void searchPlaces(query, controller.signal);
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [searchOpen, searchPlaces, searchQuery]);

  const loadCoordinates = useCallback(
    async (
      latitude: number,
      longitude: number,
      locationHint: LocationHint | null = null,
      preferredSlug: string | null = null,
      forceRefresh = false,
    ) => {
      setPhase("loading");
      setError("");
      setClimateRecords({});
      setClimateRecordKey(null);
      setClimateRecordSource(null);
      setClimateRecordThroughYear(null);
      setClimateStationName(null);

      try {
        const cached = forceRefresh
          ? null
          : cachedWeatherForCoordinates(latitude, longitude);
        const result =
          cached?.weather ??
          (await getWeatherForCoordinates(
            latitude,
            longitude,
            locationHint,
          ));
        const updatedAt = cached?.updatedAt ?? Date.now();

        setWeather(result);
        setPhase("ready");

        if (preferredSlug) {
          updateSharedLocation(result, preferredSlug);
          cacheWeatherForCurrentPage(result, updatedAt);
        } else {
          cacheWeatherForCurrentPage(result, updatedAt);
          void canonicalLocationSlug(result).then((slug) => {
            if (slug) {
              updateSharedLocation(result, slug);
              cacheWeatherForCurrentPage(result, updatedAt);
            }
          });
        }
      } catch (weatherError) {
        setError(readableError(weatherError as Error));
        setPhase("error");
      }
    },
    [],
  );

  const refreshCurrentWeather = useCallback(() => {
    if (!weather) return;

    void loadCoordinates(
      weather.coordinates.latitude,
      weather.coordinates.longitude,
      weather.locationHint,
      readSharedLocationSlug(),
      true,
    );
  }, [loadCoordinates, weather]);

  useEffect(() => {
    if (!weather) return;

    const interval = window.setInterval(
      refreshCurrentWeather,
      AUTO_REFRESH_INTERVAL_MS,
    );

    return () => window.clearInterval(interval);
  }, [refreshCurrentWeather, weather]);

  useEffect(() => {
    if (phase === "ready" || phase === "error") {
      document.documentElement.removeAttribute("data-weather-cache");
    }
  }, [phase]);

  useEffect(() => {
    const controller = new AbortController();

    if (!weather?.recordKey) return () => controller.abort();

    if (weather.provider === "noaa" && weather.stationId) {
      void getAcisDailyRecords(weather.stationId, controller.signal)
        .then(({ records, stationName }) => {
          if (controller.signal.aborted) return;
          setClimateRecords(records);
          setClimateRecordKey(weather.recordKey);
          setClimateRecordSource("acis");
          setClimateStationName(stationName);
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setClimateRecords({});
        });
    } else if (weather.provider === "open-meteo") {
      const targetDateKeys = [
        ...new Set(
          weather.daily.map((period) =>
            localDateKey(new Date(period.startTime), weather.timeZone),
          ),
        ),
      ].slice(0, 7);

      void getOpenMeteoDailyRecords(
        weather.coordinates.latitude,
        weather.coordinates.longitude,
        weather.timeZone,
        targetDateKeys,
        controller.signal,
      )
        .then(({ records, throughYear }) => {
          if (controller.signal.aborted) return;
          setClimateRecords(records);
          setClimateRecordKey(weather.recordKey);
          setClimateRecordSource("open-meteo");
          setClimateRecordThroughYear(throughYear);
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setClimateRecords({});
        });
    }

    return () => controller.abort();
  }, [weather]);

  useEffect(() => {
    const sharedCoordinates =
      requestKey === 0 ? readLegacySharedCoordinates() : null;
    const sharedSlug =
      requestKey === 0 ? readSharedLocationSlug() : null;

    if (sharedCoordinates) {
      queueMicrotask(() => {
        void loadCoordinates(
          sharedCoordinates.latitude,
          sharedCoordinates.longitude,
        );
      });
      return;
    }

    const cachedPage =
      requestKey === 0
        ? cachedWeatherForPath(window.location.pathname)
        : null;
    if (cachedPage) {
      queueMicrotask(() => {
        void loadCoordinates(
          cachedPage.weather.coordinates.latitude,
          cachedPage.weather.coordinates.longitude,
          cachedPage.weather.locationHint,
          sharedSlug,
        );
      });
      return;
    }

    document.documentElement.removeAttribute("data-weather-cache");

    if (sharedSlug) {
      queueMicrotask(() => {
        setPhase("loading");
        void resolveLocationSlug(sharedSlug)
          .then((resolved) => {
            if (!resolved) {
              setError(
                `The place link “${sharedSlug}” could not be found. Search for another place or use your current location.`,
              );
              setPhase("error");
              return;
            }

            return loadCoordinates(
              resolved.place.latitude,
              resolved.place.longitude,
              locationHintFromPlace(resolved.place),
              resolved.canonicalSlug,
            );
          })
          .catch(() => {
            setError("This place link could not be resolved. Please try again.");
            setPhase("error");
          });
      });
      return;
    }

    if (!navigator.geolocation) {
      queueMicrotask(() => {
        setError("This browser does not support location access.");
        setPhase("error");
      });
      return;
    }

    navigator.geolocation.getCurrentPosition(
      ({ coords }) =>
        loadCoordinates(
          coords.latitude,
          coords.longitude,
          null,
          null,
          requestKey > 0,
        ),
      (locationError) => {
        setError(readableError(locationError));
        setPhase("error");
      },
      {
        enableHighAccuracy: false,
        maximumAge: requestKey === 0 ? 5 * 60 * 1000 : 0,
        timeout: 15_000,
      },
    );
  }, [loadCoordinates, requestKey]);

  const day = useMemo(() => {
    if (!weather) return [];

    const now = new Date();
    const today = localDateKey(now, weather.timeZone);
    const closestHour = closestDisplayHour(now, weather.timeZone);
    const currentHour = Number(zonedParts(now, weather.timeZone).hour);
    const hourlyByHour = new Map<number, HourlyPeriod>();
    const observationsByHour = new Map<number, StationObservation>();
    const overnightFall = formatRainfallColumn(overnightRainfallTotal(
      weather.observations.map((observation) => ({
        amountInches: observationPrecipitationInches(observation),
        priority: observationPriority(observation),
        timestamp: observation.timestamp,
      })),
      weather.precipitationIntervals ?? hourlyPrecipitationIntervals(weather.hourly),
      overnightRainfallWindow(weather.timeZone, now),
      now,
    ), metricUnits, true);

    weather.hourly.forEach((period) => {
      const start = new Date(period.startTime);
      const parts = zonedParts(start, weather.timeZone);
      const hour = Number(parts.hour);

      if (
        localDateKey(start, weather.timeZone) === today &&
        hour >= 5 &&
        hour <= 22
      ) {
        hourlyByHour.set(hour, period);
      }
    });

    weather.observations.forEach((observation) => {
      const timestamp = new Date(observation.timestamp);
      const parts = zonedParts(timestamp, weather.timeZone);
      const hour = Number(parts.hour);
      const existing = observationsByHour.get(hour);

      if (
        localDateKey(timestamp, weather.timeZone) === today &&
        hour >= 5 &&
        hour <= 22 &&
        isPreferredObservation(observation, existing)
      ) {
        observationsByHour.set(hour, observation);
      }
    });

    return DISPLAY_HOURS.map((hour) => ({
      hour,
      isClosest: hour === closestHour,
      overnightFall: hour === 5 ? overnightFall : undefined,
      reading:
        hour <= currentHour && observationsByHour.has(hour)
          ? (() => {
              const observation = observationsByHour.get(hour)!;
              const precipitation =
                observationPrecipitationInches(observation);
              return {
                description:
                  observation.textDescription || "Observed conditions",
                humidity: observation.relativeHumidity.value,
                isDaytime: hour >= 6 && hour < 20,
                fall: formatRainfallColumn(precipitation, metricUnits, true),
                rain: hourlyByHour.get(hour)?.probabilityOfPrecipitation?.value ?? null,
                source: observation.source ?? ("observed" as const),
                temperatureF:
                  observationTemperatureFahrenheit(observation),
              };
            })()
          : hourlyByHour.has(hour)
            ? (() => {
                const period = hourlyByHour.get(hour)!;
                const precipitationProbability =
                  period.probabilityOfPrecipitation?.value ?? null;
                return {
                  description: period.shortForecast,
                  humidity: period.relativeHumidity?.value ?? null,
                  isDaytime: period.isDaytime,
                  fall: formatRainfallColumn(
                    period.forecastPrecipitationInches ?? null,
                    metricUnits,
                    true,
                  ),
                  rain: precipitationProbability,
                  source: "forecast" as const,
                  temperatureF: period.temperature,
                };
              })()
            : null,
    }));
  }, [metricUnits, weather]);

  const recentRainfall = useMemo(
    () =>
      weather
        ? recentObservedRainfall(weather.observations)
        : null,
    [weather],
  );

  const chartData = useMemo(() => {
    if (!weather) return null;

    const now = new Date();
    const series = forecastChartSeries(
      weather.hourly, weather.daily, weather.precipitationIntervals,
    );
    const today = chartTimeWindow(weather.timeZone, 1, now);
    // Match the table's observed temperatures and rainfall for past hours.
    const observations = new Map<number, StationObservation>();
    const rainObservations = new Map<number, StationObservation>();
    weather.observations.forEach((observation) => {
      const timestamp = Date.parse(observation.timestamp);
      const minute = Number(zonedParts(new Date(timestamp), weather.timeZone).minute);
      const time = Math.floor(timestamp / 60_000) * 60_000 - minute * 60_000;
      if (time < today.start || time >= today.end || timestamp > now.getTime()) return;
      if (isPreferredObservation(observation, observations.get(time))) observations.set(time, observation);
      // A temperature report may omit precipitation; select a usable rain
      // reading independently, without summing overlapping station reports.
      if (observationPrecipitationInches(observation) !== null &&
        isPreferredObservation(observation, rainObservations.get(time))) rainObservations.set(time, observation);
    });
    const temperatures = new Map(series.temperature.map((point) => [point.time, point]));
    observations.forEach((observation, time) => {
      const value = observationTemperatureFahrenheit(observation);
      if (value !== null) temperatures.set(time, { time, endTime: time + 3_600_000, value, coarse: false });
    });
    const history = Array.from(rainObservations, ([time, observation]) => ({
      time,
      timestamp: Date.parse(observation.timestamp),
      value: observationPrecipitationInches(observation),
      source: observation.source ?? "observed" as const,
    }));

    return {
      series: {
        temperature: [...temperatures.values()].sort((a, b) => a.time - b.time),
        rainfall: withObservedRainfall(series.rainfall, history, today, now),
      },
      today,
      week: chartTimeWindow(weather.timeZone, 7, now),
    };
  }, [weather]);

  const rainfallForecast = useMemo(
    () =>
      weather
        ? remainingRainfallTotal(weather.hourly, weather.timeZone)
        : null,
    [weather],
  );

  const sevenDay = useMemo(() => {
    if (!weather) return [];

    const today = localDateKey(new Date(), weather.timeZone);
    const periodsByDate = new Map<string, HourlyPeriod[]>();
    const hourlyByDate = new Map<string, HourlyPeriod[]>();
    const precipitationIntervals = weather.precipitationIntervals ??
      hourlyPrecipitationIntervals(weather.hourly);
    const observedTodayTemperatures = weather.observations.flatMap(
      (observation) => {
        const timestamp = new Date(observation.timestamp);
        const temperature = observationTemperatureFahrenheit(observation);

        return localDateKey(timestamp, weather.timeZone) === today &&
          temperature !== null
          ? [temperature]
          : [];
      },
    );

    const observedTodayHigh = highestTemperature(
      observedTodayTemperatures,
    );

    weather.daily.forEach((period) => {
      const start = new Date(period.startTime);
      const dateKey = localDateKey(start, weather.timeZone);
      const periods = periodsByDate.get(dateKey) ?? [];
      periods.push(period);
      periodsByDate.set(dateKey, periods);
    });

    weather.hourly.forEach((period) => {
      const dateKey = localDateKey(
        new Date(period.startTime),
        weather.timeZone,
      );
      const periods = hourlyByDate.get(dateKey) ?? [];
      periods.push(period);
      hourlyByDate.set(dateKey, periods);
    });

    return Array.from(periodsByDate.entries())
      .slice(0, 7)
      .map(([dateKey, periods]) => {
        const daytime = periods.find((period) => period.isDaytime);
        const nighttime = periods.find((period) => !period.isDaytime);
        const representative = daytime ?? nighttime ?? periods[0];
        const hourlyPeriods = hourlyByDate.get(dateKey) ?? [];
        const dayWindow = chartTimeWindow(
          weather.timeZone, 1, new Date(representative.startTime),
        );
        const record =
          climateRecordKey === weather.recordKey
            ? climateRecords[dateKey.slice(5)]
            : undefined;

        return {
          date: formatForecastDay(
            new Date(representative.startTime),
            weather.timeZone,
          ),
          description: representative.shortForecast,
          high:
            dateKey === today
              ? highestTemperature([
                  daytime?.temperature,
                  observedTodayHigh,
                ])
              : (daytime?.temperature ?? null),
          isDaytime: representative.isDaytime,
          isToday: dateKey === today,
          low: nighttime?.temperature ?? null,
          fall: forecastRainfallSummary(
            precipitationIntervals, dayWindow.start, dayWindow.end,
          ),
          rain: maximumPrecipitationChance(
            hourlyPeriods.length ? hourlyPeriods : periods,
          ),
          recordAverage: record?.average ?? null,
          recordHigh: record?.high ?? null,
          recordLow: record?.low ?? null,
        };
      });
  }, [climateRecordKey, climateRecords, weather]);

  const todayForecast =
    sevenDay.find((forecast) => forecast.isToday) ?? null;

  const retryLocation = () => {
    resetSharedLocation();
    setSearchOpen(false);
    setSearching(false);
    setPhase("locating");
    setError("");
    setRequestKey((value) => value + 1);
  };

  const closePlaceSearch = () => {
    setSearchOpen(false);
    setSearching(false);
  };

  const selectPlace = (place: PlaceResult) => {
    const slug = locationSlugForPlace(place, placeResults);
    closePlaceSearch();
    setSearchQuery("");
    setPlaceResults([]);
    setSearchError("");
    void loadCoordinates(
      place.latitude,
      place.longitude,
      locationHintFromPlace(place),
      slug,
    );
  };

  return (
    <main className="weather-shell">
      <header className="site-header">
        <div className="header-line">
          <Link
            className="site-title"
            href="/"
            onClick={(event) => {
              event.preventDefault();
              retryLocation();
            }}
          >
            wthrtxt.com
          </Link>
          <div className="header-actions">
            <button
              aria-controls="place-search"
              aria-expanded={searchOpen}
              aria-label={
                searchOpen ? "Close place search" : "Search worldwide places"
              }
              className="icon-button hover-tip header-tip"
              data-tooltip={
                searchOpen ? "Close place search" : "Search worldwide places"
              }
              onClick={() => {
                if (searchOpen) closePlaceSearch();
                else setSearchOpen(true);
              }}
              type="button"
            >
              <Search aria-hidden="true" size={14} />
            </button>
            <button
              aria-label="Use current location"
              className="icon-button hover-tip header-tip"
              data-tooltip="Use current location"
              onClick={retryLocation}
              type="button"
            >
              <LocateFixed aria-hidden="true" size={14} />
            </button>
            <a
              aria-label="View text forecast"
              className="icon-button hover-tip header-tip"
              data-tooltip="View text forecast"
              href="?format=text"
            >
              <FileText aria-hidden="true" size={14} />
            </a>
            <Link
              aria-label="About wthrtxt.com"
              className="icon-button hover-tip header-tip"
              data-tooltip="About wthrtxt.com"
              href="/about/"
            >
              <CircleHelp aria-hidden="true" size={14} />
            </Link>
            <ThemeToggle showTooltip />
          </div>
        </div>

        {searchOpen ? (
          <div
            aria-label="Search worldwide places"
            className="place-search"
            id="place-search"
            onKeyDown={(event) => {
              if (event.key === "Escape") closePlaceSearch();
            }}
            role="dialog"
          >
            <div className="search-heading">
              <span>search</span>
              <button
                aria-label="Close place search"
                className="search-close"
                onClick={closePlaceSearch}
                type="button"
              >
                <X aria-hidden="true" size={14} />
              </button>
            </div>

            <div>
              <label className="sr-only" htmlFor="place-query">
                City, region, or country
              </label>
              <div className="search-input-row">
                <input
                  autoComplete="off"
                  autoFocus
                  id="place-query"
                  onChange={(event) => {
                    setSearchQuery(event.target.value);
                    setPlaceResults([]);
                    setSearchError("");
                    setSearching(false);
                  }}
                  placeholder="Portland, Oregon"
                  type="search"
                  value={searchQuery}
                />
              </div>
            </div>

            <p aria-live="polite" className="search-hint">
              {searchError ||
                (searching
                  ? "Searching..."
                  : searchQuery.trim().length === 1
                    ? "Type at least two characters."
                    : placeResults.length
                      ? "Select a location."
                      : "Type a city or place.")}
            </p>

            <p className="search-attribution">
              Search ©{" "}
              <a
                href="https://www.openstreetmap.org/copyright"
                rel="noreferrer"
              >
                OpenStreetMap contributors
              </a>
            </p>

            {placeResults.length ? (
              <ul className="search-results">
                {placeResults.map((place) => (
                  <li key={place.id}>
                    <button
                      className="search-result"
                      onClick={() => selectPlace(place)}
                      type="button"
                    >
                      <strong>{place.name}</strong>
                      <span>
                        {[place.admin2, place.admin1, place.country]
                          .filter(Boolean)
                          .join(", ")}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </header>

      {phase === "ready" && weather ? (
        <>
          <section className="current-panel" aria-labelledby="current-heading">
            <p className="section-label">Weather for</p>
            <h1 id="current-heading">
              <MapPin aria-hidden="true" size={15} />
              {weather.city}
              {weather.state ? `, ${weather.state}` : ""}
            </h1>
            <p className="meta-line">
              {formatDate(weather.timeZone)} /{" "}
              {formatUpdated(
                weather.current.timestamp,
                weather.timeZone,
                weather.current.sourceLabel,
              )}
            </p>

            <div className="text-rule" aria-hidden="true" />

            <p className="section-label">Current conditions</p>
            <div className="current-reading">
              <WeatherIcon
                description={weather.current.description}
                size={27}
                strokeWidth={1.5}
              />
              <div>
                <strong className="current-temperature">
                  {weather.current.temperatureF === null
                    ? "—"
                    : formatTemperature(
                        weather.current.temperatureF,
                        metricUnits,
                      )}
                </strong>
                <span className="condition-text">
                  {weather.current.description}
                </span>
              </div>
            </div>

            <div
              aria-label="Today's high and low temperatures"
              className="today-temperature-range"
            >
              <span className="current-fact">
                <Sun aria-hidden="true" size={14} />
                high:{" "}
                <strong>
                  {todayForecast?.high === null ||
                  todayForecast?.high === undefined
                    ? "—"
                    : formatTemperature(todayForecast.high, metricUnits)}
                </strong>
              </span>
              <span className="current-fact">
                <Moon aria-hidden="true" size={14} />
                low:{" "}
                <strong>
                  {todayForecast?.low === null ||
                  todayForecast?.low === undefined
                    ? "—"
                    : formatTemperature(todayForecast.low, metricUnits)}
                </strong>
              </span>
            </div>

            <div className="current-facts">
              <div className="current-fact-stack">
                <span className="current-fact">
                  <Droplets aria-hidden="true" size={14} />
                  humidity:{" "}
                  <strong>
                    {weather.current.humidity === null
                      ? "—"
                      : `${Math.round(weather.current.humidity)}%`}
                  </strong>
                </span>
                {recentRainfall !== null && recentRainfall > 0 ? (
                  <span className="current-fact">
                    <CloudRain aria-hidden="true" size={14} />
                    rainfall (6h):{" "}
                    <strong>
                      {formatRainfallInches(recentRainfall, metricUnits)}
                    </strong>
                  </span>
                ) : null}
              </div>
              <span className="current-fact">
                <Wind aria-hidden="true" size={14} />
                wind:{" "}
                <strong>
                  {formatWind(weather.current.windSpeed, metricUnits)}
                </strong>
              </span>
              {rainfallForecast !== null && rainfallForecast > 0 ? (
                <span className="current-fact rainfall-forecast">
                  <CloudRain aria-hidden="true" size={14} />
                  rainfall forecast:{" "}
                  <strong>
                    {formatRainfallInches(rainfallForecast, metricUnits)}
                  </strong>
                </span>
              ) : null}
            </div>
          </section>

          <div className="ascii-rule" aria-hidden="true">
            ============================================================
          </div>

          <section className="hourly-panel" aria-label="Hourly weather">
            <div className="hourly-heading">
              <div>
                <p>{formatDate(weather.timeZone)}</p>
              </div>
            </div>

            {chartData && (
              <ForecastChart
                label="Today's temperature and hourly rainfall"
                series={chartData.series}
                window={chartData.today}
                timeZone={weather.timeZone}
                metric={metricUnits}
              />
            )}

            <div className="forecast-labels" aria-hidden="true">
              <span />
              <span>time</span>
              <span>sky</span>
              <span>temp</span>
              <span>humid</span>
              <span>rain</span>
              <span>Fall</span>
            </div>

            <ol className="hourly-list">
              {day.map(({ hour, isClosest, reading, overnightFall }) => (
                <li className={isClosest ? "closest" : ""} key={hour}>
                  <span className="now-marker" aria-hidden="true">
                    {isClosest ? ">" : ""}
                  </span>
                  <time>{formatHour(hour)}</time>
                  <span
                    className="weather-cell-icon hover-tip"
                    aria-label={reading?.description ?? "Unavailable"}
                    data-tooltip={
                      reading
                        ? `${reading.description} — ${reading.source}`
                        : "Unavailable"
                    }
                    tabIndex={0}
                  >
                    {reading ? (
                      <WeatherIcon
                        description={reading.description}
                        isDaytime={reading.isDaytime}
                        size={15}
                      />
                    ) : (
                      "—"
                    )}
                  </span>
                  <span>
                    {reading?.temperatureF === null ||
                    reading?.temperatureF === undefined
                      ? "—"
                      : formatTemperature(
                          reading.temperatureF,
                          metricUnits,
                        )}
                  </span>
                  <span>
                    {reading?.humidity === null ||
                    reading?.humidity === undefined
                      ? "—"
                      : `${Math.round(reading.humidity)}%`}
                  </span>
                  <span>{reading?.rain == null ? "—" : `${Math.round(reading.rain)}%`}</span>
                  <span
                    className={hour === 5 ? "hover-tip" : undefined}
                    data-tooltip={hour === 5 ? "Overnight rainfall total: previous day 10 PM to 5 AM" : undefined}
                    tabIndex={hour === 5 ? 0 : undefined}
                  >
                    {overnightFall ?? reading?.fall ?? "—"}
                  </span>
                </li>
              ))}
            </ol>

            <p className="table-note">
              {weather.provider === "noaa" ? (
                <>
                  Fall ({metricUnits ? "mm" : "in."}): past = observed 1h rainfall;
                  future = forecast 1h rainfall.
                  Earlier hours use station{" "}
                  {weather.stationId ?? "data"}.
                </>
              ) : (
                <>
                  Fall ({metricUnits ? "mm" : "in."}): past = estimated 1h precipitation;
                  future = forecast 1h precipitation.
                  Earlier hours use Open-Meteo model data.
                </>
              )}
              {" "}5 AM Fall = overnight total, 10 PM–5 AM.
            </p>
          </section>

          <div className="ascii-rule" aria-hidden="true">
            ============================================================
          </div>

          <section
            aria-labelledby="daily-heading"
            className="daily-panel"
          >
            <h2 id="daily-heading">7-day forecast</h2>

            {chartData && (
              <ForecastChart
                label="Seven-day temperature and hourly rainfall"
                series={chartData.series}
                window={chartData.week}
                timeZone={weather.timeZone}
                metric={metricUnits}
              />
            )}

            <div className="daily-labels" aria-hidden="true">
              <span>day</span>
              <span>sky</span>
              <span>high</span>
              <span>low</span>
              <span>rec hi</span>
              <span>rec lo</span>
              <span>rec avg</span>
              <span>rain</span>
              <span>Fall</span>
            </div>

            <ol className="daily-list">
              {sevenDay.map((forecast) => (
                <li
                  className={forecast.isToday ? "today" : undefined}
                  key={forecast.date}
                >
                  <time>{forecast.date}</time>
                  <span
                    aria-label={forecast.description}
                    className="weather-cell-icon hover-tip"
                    data-tooltip={forecast.description}
                    tabIndex={0}
                  >
                    <WeatherIcon
                      description={forecast.description}
                      isDaytime={forecast.isDaytime}
                      size={15}
                    />
                  </span>
                  <span>
                    {forecast.high === null
                      ? "—"
                      : formatTemperature(forecast.high, metricUnits)}
                  </span>
                  <span>
                    {forecast.low === null
                      ? "—"
                      : formatTemperature(forecast.low, metricUnits)}
                  </span>
                  <span
                    aria-label={formatRecordTitle(
                      "high",
                      forecast.recordHigh,
                      metricUnits,
                    )}
                    className={forecast.recordHigh ? "hover-tip" : undefined}
                    data-tooltip={formatRecordTitle(
                      "high",
                      forecast.recordHigh,
                      metricUnits,
                    )}
                    tabIndex={forecast.recordHigh ? 0 : undefined}
                  >
                    {forecast.recordHigh === null
                      ? "—"
                      : formatTemperature(
                          forecast.recordHigh.temperatureF,
                          metricUnits,
                        )}
                  </span>
                  <span
                    aria-label={formatRecordTitle(
                      "low",
                      forecast.recordLow,
                      metricUnits,
                    )}
                    className={forecast.recordLow ? "hover-tip" : undefined}
                    data-tooltip={formatRecordTitle(
                      "low",
                      forecast.recordLow,
                      metricUnits,
                    )}
                    tabIndex={forecast.recordLow ? 0 : undefined}
                  >
                    {forecast.recordLow === null
                      ? "—"
                      : formatTemperature(
                          forecast.recordLow.temperatureF,
                          metricUnits,
                        )}
                  </span>
                  <span
                    aria-label={formatAverageTitle(
                      forecast.recordAverage,
                      metricUnits,
                    )}
                    className={
                      forecast.recordAverage ? "hover-tip" : undefined
                    }
                    data-tooltip={formatAverageTitle(
                      forecast.recordAverage,
                      metricUnits,
                    )}
                    tabIndex={forecast.recordAverage ? 0 : undefined}
                  >
                    {forecast.recordAverage === null
                      ? "—"
                      : formatTemperature(
                          forecast.recordAverage.temperatureF,
                          metricUnits,
                        )}
                  </span>
                  <span
                    aria-label={formatRainTitle(
                      forecast.rain,
                      weather.timeZone,
                    )}
                    className={forecast.rain ? "hover-tip" : undefined}
                    data-tooltip={formatRainTitle(
                      forecast.rain,
                      weather.timeZone,
                    )}
                    tabIndex={forecast.rain ? 0 : undefined}
                  >
                    {forecast.rain === null
                      ? "—"
                      : `${Math.round(forecast.rain.value)}%`}
                  </span>
                  <span
                    className={forecast.fall.amountInches === null ? undefined : "hover-tip"}
                    data-tooltip={forecast.fall.amountInches === null ? undefined :
                      `Forecast rainfall: ${formatRainfallInches(forecast.fall.amountInches, metricUnits)}${
                        forecast.fall.coveredHours < forecast.fall.totalHours
                          ? ` (${Math.round(forecast.fall.coveredHours)} of ${forecast.fall.totalHours} hours available)`
                          : " (daily total)"}`}
                    tabIndex={forecast.fall.amountInches === null ? undefined : 0}
                  >
                    {formatRainfallColumn(forecast.fall.amountInches, metricUnits)}
                  </span>
                </li>
              ))}
            </ol>
            <p className="table-note">
              Fall ({metricUnits ? "mm" : "in."}): totals cover available forecast hours.
            </p>
          </section>

          <div className="ascii-rule" aria-hidden="true">
            ============================================================
          </div>

          <footer className="site-footer">
            <p>
              location: {weather.coordinates.latitude.toFixed(3)},{" "}
              {weather.coordinates.longitude.toFixed(3)}
              {weather.locationHint?.source === "osm" ? (
                <>
                  {" "}
                  /{" "}
                  <a
                    href="https://www.openstreetmap.org/copyright"
                    target="_blank"
                    rel="noreferrer"
                  >
                    © OpenStreetMap contributors
                  </a>
                </>
              ) : null}
            </p>
            <p>
              data:{" "}
              <a
                href={weather.dataUrl}
                target="_blank"
                rel="noreferrer"
              >
                {weather.dataLabel}
              </a>
            </p>
            {weather.stationId ? (
              <p>
                history:{" "}
                <a
                  href={`https://www.weather.gov/wrh/timeseries?site=${weather.stationId}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  station {weather.stationId}
                </a>
              </p>
            ) : null}
            {climateRecordKey === weather.recordKey &&
            Object.keys(climateRecords).length ? (
              <p>
                records:{" "}
                <a
                  href={
                    climateRecordSource === "open-meteo"
                      ? "https://open-meteo.com/en/docs/historical-weather-api"
                      : "https://builder.rcc-acis.org/"
                  }
                  target="_blank"
                  rel="noreferrer"
                >
                  {climateRecordSource === "open-meteo"
                    ? `Open-Meteo ERA5-Land (estimated, ${OPEN_METEO_RECORD_START_YEAR}–${climateRecordThroughYear})`
                    : `ACIS / ${climateStationName ?? weather.stationId}`}
                </a>
              </p>
            ) : null}
            <button
              className="text-button"
              onClick={refreshCurrentWeather}
              type="button"
            >
              <RefreshCw aria-hidden="true" size={13} />
              refresh forecast
            </button>
          </footer>
        </>
      ) : (
        <section className="status-panel" aria-live="polite">
          <LocateFixed
            className="status-glyph"
            aria-hidden="true"
            size={24}
            strokeWidth={1.5}
          />
          {phase === "error" ? (
            <>
              <p className="status-code">&gt; location / data error</p>
              <h1>{error}</h1>
              <p>
                Browser weather and place requests go directly to the listed
                providers. Terminal forecasts are rendered by the wthrtxt.com
                server; repeat lookups may be cached.
              </p>
              <div className="status-actions">
                <button
                  className="primary-button"
                  onClick={retryLocation}
                  type="button"
                >
                  &gt; try location again
                </button>
                <button
                  className="secondary-button"
                  onClick={() =>
                    loadCoordinates(SEATTLE.latitude, SEATTLE.longitude)
                  }
                  type="button"
                >
                  &gt; preview seattle
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="status-code">
                &gt;{" "}
                {phase === "locating"
                  ? "locating"
                  : "contacting weather services"}
                <span className="loading-dots" aria-hidden="true">
                  ...
                </span>
              </p>
              <h1>
                {phase === "locating"
                  ? "Finding your local weather."
                  : "Reading the latest forecast."}
              </h1>
              <p>
                Allow location access when prompted. NOAA serves supported U.S.
                areas; Open-Meteo supplies worldwide coverage.
              </p>
            </>
          )}
        </section>
      )}
      <ProjectFooter />
      {tooltip ? (
        <div
          className="tooltip-layer"
          role="tooltip"
          style={{
            ...(tooltip.horizontalSide === "right"
              ? { right: tooltip.horizontalOffset }
              : { left: tooltip.horizontalOffset }),
            ...(tooltip.placement === "below"
              ? { top: tooltip.verticalOffset }
              : { bottom: tooltip.verticalOffset }),
          }}
        >
          {tooltip.text}
        </div>
      ) : null}
    </main>
  );
}
