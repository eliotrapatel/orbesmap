// Live EUR → CNY reference rate (European Central Bank via frankfurter.app), cached 6 h.
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
    fetch("https://api.frankfurter.app/latest?from=EUR&to=CNY")
      .then((x) => (x.ok ? x.json() : Promise.reject(x.status)))
      .then((j) => {
        if (!j?.rates?.CNY) return;
        const data = { rate: j.rates.CNY as number, date: j.date as string };
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
