import { z } from 'zod'
import { DomainError } from '../../domain/errors'
import { readWidgetPreferences, widgetWeatherSchema } from '../../domain/widget'
import type { WidgetCity, WidgetWeatherSnapshot } from '../../shared/widget'
import type { SettingsRepository } from '../database/repositories/settings'

const locations = z.object({ results: z.array(z.object({ id: z.number().int(), name: z.string(),
  latitude: z.number(), longitude: z.number(), admin1: z.string().optional(), country: z.string().optional()
})).optional() })
const currentWeather = z.object({ current: z.object({ temperature_2m: z.number(), weather_code: z.number().int(), is_day: z.number() }) })
export class WidgetWeatherService {
  private pending = new Map<number, Promise<WidgetWeatherSnapshot>>()
  constructor(private readonly settings: () => SettingsRepository, private readonly request: typeof fetch = fetch) {}
  private async json(url: URL) {
    const response = await this.request(url, { signal: AbortSignal.timeout(12000) })
    if (!response.ok) throw new Error(`Weather HTTP ${response.status}`)
    return response.json() as Promise<unknown>
  }
  async search(query: string): Promise<WidgetCity[]> {
    const name = z.string().trim().min(2, '请输入至少两个字符。').max(100).parse(query)
    const url = new URL('https://geocoding-api.open-meteo.com/v1/search')
    url.search = new URLSearchParams({ name, count: '8', language: 'zh', format: 'json' }).toString()
    try {
      return (locations.parse(await this.json(url)).results ?? []).map(item => ({ id: item.id, name: item.name,
        region: item.admin1 ?? '', country: item.country ?? '', latitude: item.latitude, longitude: item.longitude }))
    } catch { throw new DomainError('UNAVAILABLE', '城市搜索暂时不可用，请检查网络后重试。') }
  }
  async read(force = false): Promise<WidgetWeatherSnapshot> {
    const city = readWidgetPreferences(this.settings().getWidget()).city
    if (!city) return { weather: null, stale: false, error: null }
    const stored = widgetWeatherSchema.safeParse(this.settings().getWidgetWeather()).data
    const cached = stored?.cityId === city.id ? stored : null
    if (!force && cached && Date.now() - cached.fetchedAt < 15 * 60_000) return { weather: cached, stale: false, error: null }
    const pending = this.pending.get(city.id)
    if (pending) return pending
    const refresh = (async (): Promise<WidgetWeatherSnapshot> => {
      try {
        const url = new URL('https://api.open-meteo.com/v1/forecast')
        url.search = new URLSearchParams({ latitude: String(city.latitude), longitude: String(city.longitude),
          current: 'temperature_2m,weather_code,is_day', timezone: 'auto', forecast_days: '1' }).toString()
        const data = currentWeather.parse(await this.json(url)).current
        const weather = { cityId: city.id, temperature: data.temperature_2m, code: data.weather_code,
          isDay: data.is_day === 1, fetchedAt: Date.now() }
        if (readWidgetPreferences(this.settings().getWidget()).city?.id === city.id) this.settings().setWidgetWeather(weather)
        return { weather, stale: false, error: null }
      } catch { return { weather: cached, stale: true, error: '天气暂未更新，点击重试。' } }
      finally { this.pending.delete(city.id) }
    })()
    this.pending.set(city.id, refresh)
    return refresh
  }
}
