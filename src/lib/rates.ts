// Live EUR → CNY reference rate (European Central Bank via frankfurter.dev), cached 6 h.
import { useEffect, useState } from "react";

const KEY = "orbes.rate.eurcny";
export interface LiveRate { rate: number; date: string }

export function useLiveRate(): LiveRate | null {
  const [r, setR] = useState<LiveRate | null>(() => {
    try {
      return JSON.parse(localStorage.getItem(KEY) || "null")?.data ?? null;
    } catch {
      return null;
    }
  });
  useEffect(() => {
    try {
      const c = JSON.parse(localStorage.getItem(KEY) || "null");
      if (c && Date.now() - c.at < 6 * 3600e3) return;
    } catch {
      /* ignore */
    }
    fetch("https://api.frankfurter.dev/v2/rates?base=EUR&quotes=CNY")
      .then((x) => (x.ok ? x.json() : Promise.reject(x.status)))
      .then((j) => {
        const row = Array.isArray(j) ? j[0] : j?.rates?.CNY ? { rate: j.rates.CNY, date: j.date } : null;
        if (!row?.rate) return;
        const data = { rate: Number(row.rate), date: String(row.date) };
        setR(data);
        try {
          localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), data }));
        } catch {
          /* ignore */
        }
      })
      .catch(() => undefined);
  }, []);
  return r;
}
