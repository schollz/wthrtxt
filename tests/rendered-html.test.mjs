import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render(path = "/") {
  const serverUrl = new URL("../dist/server/index.js", import.meta.url);
  serverUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: handleRequest } = await import(serverUrl.href);

  return handleRequest(
    new Request(`http://localhost${path}`, {
      headers: { accept: "text/html" },
    }),
  );
}

test("server-renders the local worldwide weather app", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<style[^>]*data-wthrtxt-styles/i);
  assert.doesNotMatch(html, /<link[^>]+rel="stylesheet"/i);
  assert.doesNotMatch(html, /jetbrains-mono-[a-z0-9-]+\.woff2/i);
  assert.match(
    html,
    /<title>Local Weather Forecast: Current, Hourly &amp; 7-Day \| wthrtxt\.com<\/title>/i,
  );
  assert.match(
    html,
    /<link rel="canonical" href="https:\/\/wthrtxt\.com\/?"/i,
  );
  assert.match(
    html,
    /<link rel="icon" href="https:\/\/wthrtxt\.com\/favicon\.svg" type="image\/svg\+xml"/i,
  );
  assert.match(
    html,
    /property="og:title" content="Local Weather Forecast — Current, Hourly &amp; 7-Day"/i,
  );
  assert.match(html, /property="og:image" content="https:\/\/wthrtxt\.com\/og\.png"/i);
  assert.match(html, /name="twitter:card" content="summary_large_image"/i);
  assert.match(
    html,
    /rel="manifest" href="https:\/\/wthrtxt\.com\/manifest\.webmanifest"/i,
  );
  assert.match(html, /type="application\/ld\+json"/i);
  assert.match(html, /"@type":"WebSite"/i);
  assert.match(html, /"@type":"WebApplication"/i);
  assert.match(html, /id="weather-cache-bootstrap"/i);
  assert.match(html, /dataset\.weatherCache="hit"/i);
  assert.match(
    html,
    /<a[^>]*href="\/"[^>]*>wthrtxt\.com<\/a>/i,
  );
  assert.match(html, /locating/);
  assert.match(html, /Finding your local weather/);
  assert.match(html, /made by/i);
  assert.match(html, /href="https:\/\/github\.com\/sponsors\/schollz"/i);
  assert.match(html, /href="https:\/\/github\.com\/schollz\/wthrtxt"/i);
  assert.match(html, /<summary>other tools<\/summary>/i);
  assert.match(html, /href="https:\/\/getcroc\.com"/i);
  assert.match(html, /fast, simple, secure file transfer/i);
  assert.match(html, /href="https:\/\/cowyo\.com"/i);
  assert.match(html, /write together, without the setup/i);
  assert.match(html, /href="https:\/\/yesnotice\.com"/i);
  assert.match(html, /yes\/no alerts when websites change/i);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("server-renders the concise about page and its SEO metadata", async () => {
  const response = await render("/about/");
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /<title>About \| wthrtxt\.com<\/title>/i);
  assert.match(
    html,
    /<link rel="canonical" href="https:\/\/wthrtxt\.com\/about\/"/i,
  );
  assert.match(html, /property="og:title" content="About wthrtxt\.com"/i);
  assert.match(html, /"@type":"AboutPage"/i);
  assert.match(html, /Local weather, minus the weather-site clutter\./i);
  assert.match(html, /NOAA \/ National Weather Service/i);
  assert.match(html, /OpenStreetMap Photon/i);
  assert.match(html, /OpenStreetMap Nominatim/i);
  assert.match(html, /curl https:\/\/wthrtxt\.com\/seattle/i);
  assert.match(html, /href="https:\/\/github\.com\/sponsors\/schollz"/i);
  assert.match(html, /href="https:\/\/github\.com\/schollz\/wthrtxt"/i);
  assert.match(html, /<summary>other tools<\/summary>/i);
});

test("keeps worldwide weather requests and geolocation in the client app", async () => {
  const [page, themeToggle, styles, cacheBootstrap, units] =
    await Promise.all([
    readFile(new URL("../app/weather-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/theme-toggle.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(
      new URL("../app/weather-cache-bootstrap.mjs", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../app/units.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(page, /navigator\.geolocation\.getCurrentPosition/);
  assert.match(
    page,
    /maximumAge: requestKey === 0 \? 5 \* 60 \* 1000 : 0/,
  );
  assert.match(page, /readSharedLocationSlug/);
  assert.match(page, /LEGACY_LOCATION_QUERY_KEY = "location"/);
  assert.match(page, /resolveLocationSlug/);
  assert.match(page, /canonicalLocationSlug/);
  assert.match(page, /locationSlugForPlace/);
  assert.match(page, /url\.pathname = `\/\$\{slug\}\/`/);
  assert.match(page, /window\.history\.replaceState/);
  assert.match(
    page,
    /requestKey === 0 \? readLegacySharedCoordinates\(\) : null/,
  );
  assert.match(
    page,
    /https:\/\/geocoding-api\.open-meteo\.com\/v1\/search/,
  );
  assert.doesNotMatch(page, /url\.searchParams\.set\("countryCode", "US"\)/);
  assert.doesNotMatch(
    page,
    /\.filter\(\s*\(place\) => place\.country_code === "US"/,
  );
  assert.match(page, /Search worldwide places/);
  assert.match(page, /https:\/\/photon\.komoot\.io\/api/);
  assert.match(page, /searchPhotonPlaces\(query, 6, signal\)/);
  assert.match(page, /url\.searchParams\.set\("osm_tag", "place"\)/);
  assert.match(page, /url\.searchParams\.set\("featureType", "settlement"\)/);
  assert.match(page, /PLACE_SEARCH_CACHE_TTL_MS/);
  assert.match(page, /SEARCH_DEBOUNCE_MS = 350/);
  assert.match(page, /controller\.abort\(\)/);
  assert.match(page, /OpenStreetMap contributors/);
  assert.match(page, /placeholder="Portland, Oregon"/);
  assert.match(page, /<span>search<\/span>/);
  assert.doesNotMatch(page, /Enter a place, then press Enter/);
  assert.match(page, /\[place\.admin2, place\.admin1, place\.country\]/);
  assert.match(page, /aria-label="Use current location"/);
  assert.match(page, /aria-label="Today's high and low temperatures"/);
  assert.match(page, /todayForecast\?\.high/);
  assert.match(page, /todayForecast\?\.low/);
  assert.match(page, /event\.preventDefault\(\);\s+retryLocation\(\);/);
  assert.match(page, /window\.setTimeout/);
  assert.match(
    page,
    /document\.documentElement\.removeAttribute\("data-weather-cache"\)/,
  );
  assert.match(
    styles,
    /:root\[data-weather-cache="hit"\] \.status-panel\s*\{\s*visibility: hidden;/,
  );
  assert.match(
    themeToggle,
    /localStorage\.setItem\(THEME_STORAGE_KEY, theme\)/,
  );
  assert.match(themeToggle, /useSyncExternalStore/);
  assert.match(page, /https:\/\/api\.weather\.gov\/points\//);
  assert.match(page, /https:\/\/api\.open-meteo\.com\/v1\/forecast/);
  assert.match(page, /https:\/\/archive-api\.open-meteo\.com\/v1\/archive/);
  assert.match(page, /https:\/\/nominatim\.openstreetmap\.org\/reverse/);
  assert.match(page, /https:\/\/nominatim\.openstreetmap\.org\/search/);
  assert.match(page, /NOAA_COUNTRY_CODES/);
  assert.match(page, /"AS", "GU", "MP", "PR", "US", "VI"/);
  assert.match(page, /getWeatherForCoordinates/);
  assert.match(page, /error\.status === 404/);
  assert.match(page, /getOpenMeteoWeather/);
  assert.match(
    page,
    /fetchNoaaJson<ForecastResponse>\(point\.properties\.forecast\)/,
  );
  assert.match(page, /forecastHourly/);
  assert.match(page, /forecastGridData/);
  assert.match(page, /quantitativePrecipitation/);
  assert.match(page, /temperature_2m/);
  assert.match(page, /relative_humidity_2m/);
  assert.match(page, /precipitation_probability/);
  assert.match(page, /precipitation_unit", "inch"/);
  assert.match(page, /temperature_unit", "fahrenheit"/);
  assert.match(page, /wind_speed_unit", "mph"/);
  assert.match(page, /timeformat", "unixtime"/);
  assert.match(page, /forecast_days", "7"/);
  assert.match(page, /weatherCodeDescription/);
  assert.match(page, /case 99:/);
  assert.match(page, /7-day forecast/);
  assert.match(page, /https:\/\/data\.rcc-acis\.org\/StnData/);
  assert.match(page, /groupby: "year"/);
  assert.match(page, /smry: \{ reduce: "max", add: "date" \}/);
  assert.match(page, /smry: \{ reduce: "min", add: "date" \}/);
  assert.match(page, /name: "avgt"/);
  assert.match(page, /smry: "mean"/);
  assert.match(page, /Record \$\{kind\}:/);
  assert.match(page, /Estimated record \$\{kind\}:/);
  assert.match(page, /Historical average:/);
  assert.match(page, /Estimated historical average:/);
  assert.match(page, /models", "era5_land"/);
  assert.match(page, /OPEN_METEO_RECORD_START_YEAR = 1950/);
  assert.match(page, /OPEN_METEO_RECORD_CONCURRENCY = 4/);
  assert.match(page, /historicalWindowForYear/);
  assert.match(page, /isValidUtcDate/);
  assert.match(page, /wx-open-meteo-records-v2/);
  assert.match(
    page,
    /Number\(date\.slice\(0, 4\)\) <=\s+\(cachedCoverage\[monthDay\]/,
  );
  assert.match(page, /wx-reverse-geocode-v1/);
  assert.match(page, /wx-forward-geocode-v1/);
  assert.match(page, /AUTO_REFRESH_INTERVAL_MS = 30 \* 60 \* 1000/);
  assert.match(
    page,
    /window\.setInterval\(\s*refreshCurrentWeather,\s*AUTO_REFRESH_INTERVAL_MS/,
  );
  assert.match(
    page,
    /weather\.locationHint,\s+readSharedLocationSlug\(\),\s+true,/,
  );
  assert.match(cacheBootstrap, /WEATHER_CACHE_TTL_MS = 60 \* 60 \* 1000/);
  assert.match(page, /cachedWeatherForCoordinates/);
  assert.match(page, /cachedWeatherForPath\(window\.location\.pathname\)/);
  assert.match(page, /fetch\("\/api\/weather-cache"/);
  assert.match(page, /max_age_seconds: maxAgeSeconds/);
  assert.match(page, /href="\?format=text"/);
  assert.match(page, /href="\/about\/"/);
  assert.ok(
    page.indexOf('href="/about/"') <
      page.indexOf("<ThemeToggle showTooltip />"),
  );
  assert.match(page, /updateLocationJsonLd/);
  assert.match(page, /Weather Forecast: Hourly & 7-Day/);
  assert.match(page, /REVERSE_GEOCODE_CACHE_TTL_MS/);
  assert.match(page, /format", "geocodejson"/);
  assert.match(page, /zoom", "10"/);
  assert.match(page, /addressdetails", "1"/);
  assert.match(page, /© OpenStreetMap contributors/);
  assert.match(page, /rec hi/);
  assert.match(page, /rec lo/);
  assert.match(page, /rec avg/);
  assert.match(page, /isToday: dateKey === today/);
  assert.match(page, /className=\{forecast\.isToday \? "today" : undefined\}/);
  assert.match(page, /maximumPrecipitationChance/);
  assert.match(page, /\[\.\.\.periods\]\s*\.sort/);
  assert.match(
    page,
    /hourlyPeriods\.length \? hourlyPeriods : periods/,
  );
  assert.match(page, /recentObservedRainfall/);
  assert.match(page, /recentRainfall !== null && recentRainfall > 0/);
  assert.match(page, /rainfall \(6h\):\{" "\}\s*<strong>/);
  assert.match(page, /Highest rain chance:/);
  assert.match(
    page,
    /data-tooltip=\{formatRainTitle\(\s*forecast\.rain,\s*weather\.timeZone,/,
  );
  assert.doesNotMatch(page, /\btitle=/);
  assert.match(page, /period\.relativeHumidity\?\.value/);
  assert.match(page, /stationUrl}\/observations/);
  assert.match(page, /probabilityOfPrecipitation/);
  assert.match(page, /precipitationLastHour/);
  assert.match(
    page,
    /forecastPrecipitationInches:\s+hourlyData\.precipitation\[index\]/,
  );
  assert.match(page, /rainfall forecast:/);
  assert.match(page, /formatRainfallColumn/);
  assert.match(page, /forecastRainfallSummary/);
  assert.match(page, /remainingRainfallTotal/);
  assert.match(page, /rawMessage\.match\(\/\\bP\(\\d\{4\}\)\\b\//);
  assert.match(page, /relativeHumidity/);
  assert.match(page, /DISPLAY_HOURS/);
  assert.match(page, /estimated 1h precipitation/);
  assert.match(page, /weather\.current\.windSpeed/);
  assert.match(page, /usesMetricUnits/);
  assert.match(page, /formatTemperature/);
  assert.match(page, /formatRainfallInches\(rainfallForecast, metricUnits\)/);
  assert.match(page, /metricUnits \? "mm" : "in\."/);
  assert.match(units, /US_COUNTRY_CODES/);
  assert.match(page, /Open-Meteo ERA5-Land/);
  assert.match(page, /contacting weather services/);
});

test("uses wthrtxt.com as the public product identity", async () => {
  const files = await Promise.all(
    [
      "../README.md",
      "../app/layout.tsx",
      "../app/site.ts",
      "../app/about/page.tsx",
      "../app/weather-client.tsx",
      "../package.json",
      "../public/favicon.svg",
    ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
  );
  const combined = files.join("\n");

  assert.match(combined, /wthrtxt\.com/);
  assert.doesNotMatch(combined, /weather\.schollz\.com/);
});
