/**
 * Commerce Service: Weather (Open-Meteo API)
 *
 * Auth: None (completely free, no API key required)
 * Base: https://api.open-meteo.com/v1
 * Rate limit: 10,000 requests/day (fair use)
 */

const METEO_BASE = "https://api.open-meteo.com/v1";
const GEOCODE_BASE = "https://geocoding-api.open-meteo.com/v1";

// ─── Interfaces ──────────────────────────────────────

export interface WeatherParams {
  city?: string;
  latitude?: number;
  longitude?: number;
  days?: number; // 1-16, default 3
}

export interface CurrentWeather {
  temperature: number;
  feelsLike: number;
  humidity: number;
  windSpeed: number;
  windDirection: number;
  weatherCode: number;
  weatherDescription: string;
  isDay: boolean;
}

export interface DailyForecast {
  date: string;
  tempMax: number;
  tempMin: number;
  weatherCode: number;
  weatherDescription: string;
  precipitationProbability: number;
  precipitationSum: number;
  windSpeedMax: number;
  sunrise: string;
  sunset: string;
}

export interface WeatherResult {
  location: string;
  latitude: number;
  longitude: number;
  timezone: string;
  current: CurrentWeather;
  forecast: DailyForecast[];
}

// ─── Weather Code Map ────────────────────────────────

const WEATHER_CODES: Record<number, string> = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Dense drizzle",
  61: "Slight rain",
  63: "Moderate rain",
  65: "Heavy rain",
  71: "Slight snow",
  73: "Moderate snow",
  75: "Heavy snow",
  77: "Snow grains",
  80: "Slight rain showers",
  81: "Moderate rain showers",
  82: "Violent rain showers",
  85: "Slight snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with slight hail",
  99: "Thunderstorm with heavy hail",
};

function weatherDescription(code: number): string {
  return WEATHER_CODES[code] ?? `Unknown (${code})`;
}

// ─── Geocode city to lat/lon ─────────────────────────

async function geocodeCity(city: string): Promise<{ lat: number; lon: number; name: string } | null> {
  try {
    const res = await fetch(`${GEOCODE_BASE}/search?name=${encodeURIComponent(city)}&count=1&language=en`);
    const data = await res.json() as any;
    if (!data.results || data.results.length === 0) return null;
    const r = data.results[0];
    return { lat: r.latitude, lon: r.longitude, name: `${r.name}, ${r.admin1 || ""} ${r.country || ""}`.trim() };
  } catch {
    return null;
  }
}

// ─── Get Weather ─────────────────────────────────────

export async function getWeather(params: WeatherParams): Promise<{
  source: string;
  mock: boolean;
  data?: WeatherResult;
  error?: string;
}> {
  let lat = params.latitude;
  let lon = params.longitude;
  let locationName = params.city || "Unknown";

  // Geocode if city provided but no coordinates
  if ((!lat || !lon) && params.city) {
    const geo = await geocodeCity(params.city);
    if (!geo) {
      return { source: "open-meteo", mock: false, error: `Could not find location: ${params.city}` };
    }
    lat = geo.lat;
    lon = geo.lon;
    locationName = geo.name;
  }

  if (!lat || !lon) {
    return { source: "open-meteo", mock: false, error: "City or coordinates required" };
  }

  const days = Math.min(Math.max(params.days ?? 3, 1), 16);

  try {
    const query = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lon),
      current: "temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,is_day",
      daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,sunrise,sunset",
      temperature_unit: "fahrenheit",
      wind_speed_unit: "mph",
      precipitation_unit: "inch",
      timezone: "auto",
      forecast_days: String(days),
    });

    const res = await fetch(`${METEO_BASE}/forecast?${query}`);
    if (!res.ok) {
      return { source: "open-meteo", mock: false, error: `API error: ${res.status}` };
    }

    const raw = await res.json() as any;

    const current: CurrentWeather = {
      temperature: raw.current.temperature_2m,
      feelsLike: raw.current.apparent_temperature,
      humidity: raw.current.relative_humidity_2m,
      windSpeed: raw.current.wind_speed_10m,
      windDirection: raw.current.wind_direction_10m,
      weatherCode: raw.current.weather_code,
      weatherDescription: weatherDescription(raw.current.weather_code),
      isDay: raw.current.is_day === 1,
    };

    const forecast: DailyForecast[] = raw.daily.time.map((date: string, i: number) => ({
      date,
      tempMax: raw.daily.temperature_2m_max[i],
      tempMin: raw.daily.temperature_2m_min[i],
      weatherCode: raw.daily.weather_code[i],
      weatherDescription: weatherDescription(raw.daily.weather_code[i]),
      precipitationProbability: raw.daily.precipitation_probability_max[i],
      precipitationSum: raw.daily.precipitation_sum[i],
      windSpeedMax: raw.daily.wind_speed_10m_max[i],
      sunrise: raw.daily.sunrise[i],
      sunset: raw.daily.sunset[i],
    }));

    return {
      source: "open-meteo",
      mock: false,
      data: {
        location: locationName,
        latitude: lat,
        longitude: lon,
        timezone: raw.timezone,
        current,
        forecast,
      },
    };
  } catch (err: any) {
    return { source: "open-meteo", mock: false, error: `Weather fetch failed: ${err.message}` };
  }
}

// ─── Format for Telegram ─────────────────────────────

export function formatWeatherResult(data: WeatherResult): string {
  const lines: string[] = [];
  const c = data.current;

  lines.push(`Weather in ${data.location}`);
  lines.push(`Now: ${c.weatherDescription} ${c.temperature}°F (feels like ${c.feelsLike}°F)`);
  lines.push(`Humidity: ${c.humidity}% | Wind: ${c.windSpeed} mph`);
  lines.push("");
  lines.push("Forecast:");

  for (const d of data.forecast.slice(0, 5)) {
    const rain = d.precipitationProbability > 0 ? ` | Rain: ${d.precipitationProbability}%` : "";
    lines.push(`${d.date}: ${d.weatherDescription} ${d.tempMin}°F - ${d.tempMax}°F${rain}`);
  }

  return lines.join("\n");
}
