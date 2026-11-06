/**
 * Refresh Open-Meteo cache when stale (initiative / context).
 * Side effect: updates settings store. Safe offline (no-op on failure).
 */
import { useSettingsStore } from '@shared/lib/stores/settingsStore'

/** Default 45 min — outfits should track afternoon temperature changes. */
export const WEATHER_UI_CACHE_MS = 45 * 60 * 1000

export async function ensureWeatherFresh(maxAgeMs = WEATHER_UI_CACHE_MS): Promise<boolean> {
  try {
    const st = useSettingsStore.getState().settings as {
      weatherEnabled?: boolean
      weatherCity?: string
      weatherFetchedAt?: number
    }
    if (!st.weatherEnabled) return false
    const city = String(st.weatherCity || '').trim()
    if (!city) return false
    const age = Date.now() - (st.weatherFetchedAt || 0)
    if (st.weatherFetchedAt && age < maxAgeMs) return false
    const { fetchWeatherForCity } = await import('@core/weather/open-meteo')
    const w = await fetchWeatherForCity(city)
    if (!w) return false
    useSettingsStore.getState().update({
      weatherSummary: w.summary || '',
      weatherTempC: w.tempC,
      weatherCondition: w.condition || '',
      weatherFetchedAt: Date.now()
    } as never)
    return true
  } catch {
    return false
  }
}
