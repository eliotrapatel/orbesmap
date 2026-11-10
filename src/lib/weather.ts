// Live forecast from Open-Meteo (free, no key). Cached 3 h per location.
import { useEffect, useState } from "react";

export interface WxDay { date: string; max: number; min: number; code: number; rain: number }
export interface Wx { now?: { temp: number; code: number }; days: WxDay[] }

const KEY = (lat: number, lng: number) => `orbes.wx.${lat.toFixed(2)},${lng.toFixed(2)}`;

export function useWeather(lat: number, lng: number, timezone: string): Wx | null {
  const [wx, setWx] = useState<Wx | null>(() => {
    try {
      const c = JSON.parse(localStorage.getItem(KEY(lat, lng)) || "null");
      return c?.data ?? null;
    } catch {
      return null;
    }
  });
  useEffect(() => {
    let cancelled = false;
    try {
      const c = JSON.parse(localStorage.getItem(KEY(lat, lng)) || "null");
      if (c && Date.now() - c.at < 3 * 3600e3) {
        setWx(c.data);
        return;
      }
    } catch {
      /* ignore */
    }
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max&timezone=${encodeURIComponent(timezone)}&forecast_days=16`;
    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((j) => {
        if (cancelled) return;
        const data: Wx = {
          now: j.current ? { temp: Math.round(j.current.temperature_2m), code: j.current.weather_code } : undefined,
          days: (j.daily?.time || []).map((date: string, i: number) => ({
            date,
            max: Math.round(j.daily.temperature_2m_max[i]),
            min: Math.round(j.daily.temperature_2m_min[i]),
            code: j.daily.weather_code[i],
            rain: j.daily.precipitation_probability_max?.[i] ?? 0,
          })),
        };
        setWx(data);
        try {
          localStorage.setItem(KEY(lat, lng), JSON.stringify({ at: Date.now(), data }));
        } catch {
          /* ignore */
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [lat, lng, timezone]);
  return wx;
}

export type WxKind = "sun" | "partly" | "cloud" | "fog" | "rain" | "snow" | "storm";
export function wxKind(code: number): WxKind {
  if (code === 0) return "sun";
  if (code <= 2) return "partly";
  if (code === 3) return "cloud";
  if (code <= 48) return "fog";
  if (code <= 67 || (code >= 80 && code <= 82)) return "rain";
  if (code <= 77 || code === 85 || code === 86) return "snow";
  return "storm";
}
export const WX_LABEL: Record<WxKind, string> = { sun: "Ensoleillé", partly: "Éclaircies", cloud: "Couvert", fog: "Brouillard", rain: "Pluie", snow: "Neige", storm: "Orage" };
