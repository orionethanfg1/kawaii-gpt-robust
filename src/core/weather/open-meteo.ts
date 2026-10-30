/**
 * Weather via Open-Meteo (no API key). Best practice for desktop/local apps:
 * - Cache aggressively (30–60 min)
 * - Opt-in city; never invent weather
 * - Fail soft → null (C4 still works with time-of-day only)
 */

import type { WeatherHint } from '../image/visual-initiative'

export type GeoHit = { name: string; latitude: number; longitude: number; country?: string }

const WMO: Record<number, string> = {
  0: 'clear',
  1: 'clear',
  2: 'cloudy',
  3: 'cloudy',
  45: 'fog',
  48: 'fog',
  51: 'rain',
  53: 'rain',
  55: 'rain',
  61: 'rain',
  63: 'rain',
  65: 'rain',
  71: 'snow',
  73: 'snow',
  75: 'snow',
  80: 'rain',
  81: 'rain',
  82: 'rain',
  95: 'storm',
  96: 'storm',
  99: 'storm'
}

const CONDITION_ES: Record<string, string> = {
  clear: 'despejado',
  cloudy: 'nublado',
  fog: 'con niebla',
  rain: 'lluvioso',
  snow: 'con nieve',
  storm: 'tormenta',
  cold: 'frío',
  hot: 'calor'
}

export function conditionToSpanish(condition?: string): string {
  if (!condition) return ''
  return CONDITION_ES[condition] || condition
}

export async function geocodeCity(
  city: string,
  fetcher: typeof fetch = fetch
): Promise<GeoHit | null> {
  const q = city.trim()
  if (q.length < 2) return null
  try {
    const url =
      'https://geocoding-api.open-meteo.com/v1/search?count=1&language=es&name=' +
      encodeURIComponent(q)
    const res = await fetcher(url, { signal: AbortSignal.timeout(8_000) })
    if (!res.ok) return null
    const json = (await res.json()) as {
      results?: Array<{ name?: string; latitude?: number; longitude?: number; country?: string }>
    }
    const r = json.results?.[0]
    if (!r || r.latitude == null || r.longitude == null) return null
    return {
      name: String(r.name || q),
      latitude: r.latitude,
      longitude: r.longitude,
      country: r.country
    }
  } catch {
    return null
  }
}

export async function fetchOpenMeteoCurrent(
  latitude: number,
  longitude: number,
  fetcher: typeof fetch = fetch
): Promise<WeatherHint | null> {
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
      `&current=temperature_2m,weather_code&timezone=auto`
    const res = await fetcher(url, { signal: AbortSignal.timeout(8_000) })
    if (!res.ok) return null
    const json = (await res.json()) as {
      current?: { temperature_2m?: number; weather_code?: number }
    }
    const cur = json.current
    if (!cur) return null
    const code = Number(cur.weather_code ?? 0)
    let condition = WMO[code] || 'cloudy'
    const tempC = typeof cur.temperature_2m === 'number' ? cur.temperature_2m : undefined
    if (tempC != null) {
      if (tempC <= 12) condition = condition === 'clear' ? 'cold' : condition
      if (tempC >= 30) condition = condition === 'clear' ? 'hot' : condition
    }
    const es = conditionToSpanish(condition)
    const summary =
      tempC != null
        ? `${es || condition}, ${Math.round(tempC)}°C`
        : es || condition
    return { condition, tempC, summary }
  } catch {
    return null
  }
}

/** Resolve weather for a city string; null if offline or unknown city. */
export async function fetchWeatherForCity(
  city: string,
  fetcher: typeof fetch = fetch
): Promise<WeatherHint | null> {
  const geo = await geocodeCity(city, fetcher)
  if (!geo) return null
  const w = await fetchOpenMeteoCurrent(geo.latitude, geo.longitude, fetcher)
  if (!w) return null
  return {
    ...w,
    summary: w.summary
      ? `${w.summary} (${geo.name}${geo.country ? ', ' + geo.country : ''})`
      : w.summary
  }
}

export const WEATHER_CACHE_MS = 45 * 60 * 1000
