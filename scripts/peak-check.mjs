// Checks the signature card's series (src/lib/peakData.ts), no browser needed:  node scripts/peak-check.mjs
// Node 22.6+ strips the TypeScript types on import. Exit 1 on any failure.
import { currencyAffix, lastDays, lineShown, seriesByDay, shortDay } from "../src/lib/peakData.ts";

let ok = 0;
let ko = 0;
const eq = (name, got, want) => {
  const a = JSON.stringify(got);
  const b = JSON.stringify(want);
  if (a === b) {
    ok++;
    console.log(`  ✓ ${name}`);
  } else {
    ko++;
    console.log(`  ✗ ${name}\n      got  ${a}\n      want ${b}`);
  }
};
const NB = " ";

console.log("seriesByDay");
{
  const s = seriesByDay([{ date: "2026-09-08", value: 10 }, { date: "2026-09-08", value: 5 }, { date: "2026-09-10", value: 40 }], "2026-09-07", "2026-09-11");
  eq("trip range, one value per day", s.days, ["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11"]);
  eq("values summed per day", s.values, [0, 15, 0, 40, 0]);
  eq("active days", s.activeDays, 2);
  eq("peak index", s.peakIndex, 3);
  eq("line shown at 2 days", lineShown(s), true);
}
{
  const s = seriesByDay([{ date: "2026-09-05", value: 3 }, { date: "2026-09-12", value: 4 }], "2026-09-07", "2026-09-11");
  eq("widened to the items while ≤ 45 days", [s.days[0], s.days[s.days.length - 1], s.days.length], ["2026-09-05", "2026-09-12", 8]);
}
{
  const s = seriesByDay([{ date: "2026-01-01", value: 99 }, { date: "2026-09-08", value: 7 }], "2026-09-07", "2026-09-11");
  eq("not widened past 45 days: out-of-range item not drawn", [s.days.length, s.values], [5, [0, 7, 0, 0, 0]]);
  eq("the biggest day counts the item left out", s.allPeak, { day: "2026-01-01", value: 99 });
}
{
  const s = seriesByDay([{ date: "2026-01-01", value: 3 }, { date: "2026-01-01", value: 2 }, { date: "2026-09-08", value: 7 }], "2026-09-07", "2026-09-11");
  eq("a smaller day left out keeps the drawn peak", s.allPeak, { day: "2026-09-08", value: 7 });
}
{
  const s = seriesByDay([{ date: "2026-09-08", value: 10 }, { date: "2026-09-10", value: 40 }], "2026-09-07", "2026-09-11");
  eq("all items drawn: the biggest day is the drawn peak", s.allPeak, { day: s.days[s.peakIndex], value: s.values[s.peakIndex] });
}
{
  const s = seriesByDay([{ date: "2026-09-08", value: 20 }, { date: "2026-09-09", value: 20 }, { date: "2026-09-10", value: 5 }], "2026-09-08", "2026-09-10");
  eq("first maximum is the peak", s.peakIndex, 0);
}
{
  const s = seriesByDay([{ date: "", value: 50 }, { date: "nope", value: 50 }, { date: "2026-09-08", value: 7 }], "2026-09-07", "2026-09-09");
  eq("empty or invalid dates skipped", s.values, [0, 7, 0]);
  eq("line hidden at 1 day", lineShown(s), false);
  eq("active days at 1", s.activeDays, 1);
}
{
  const s = seriesByDay([{ date: "2026-09-08", value: 1 }, { date: "2026-09-10", value: 2 }], "", "bad");
  eq("invalid trip dates: the items' own range", s.days, ["2026-09-08", "2026-09-09", "2026-09-10"]);
}
{
  const s = seriesByDay([], "2026-09-07", "2026-09-08");
  eq("no items: zeros on the trip's days, no line", [s.values, s.activeDays, lineShown(s)], [[0, 0], 0, false]);
  eq("no items, no dates: empty", seriesByDay([], "", "").days, []);
  eq("lineShown(null)", lineShown(null), false);
}

console.log("lastDays");
{
  const rows = [{ day: "2026-11-18", value: 1.5 }, { day: "2026-11-15", value: 0.25 }, { day: "2026-10-01", value: 9 }];
  const s7 = lastDays(rows, 7, "2026-11-18");
  eq("7 days ending today", [s7.days[0], s7.days[6], s7.days.length], ["2026-11-12", "2026-11-18", 7]);
  eq("7 days: zeros in the gaps, today included", s7.values, [0, 0, 0, 0.25, 0, 0, 1.5]);
  eq("7 days: peak is today", s7.peakIndex, 6);
  const s30 = lastDays(rows, 30, "2026-11-18");
  eq("30 days: the oldest row falls out", [s30.days.length, s30.days[0], s30.values.reduce((a, b) => a + b, 0)], [30, "2026-10-20", 1.75]);
  eq("30 days: active days", s30.activeDays, 2);
  eq("empty rows: zeros", lastDays([], 7, "2026-11-18").activeDays, 0);
}

console.log("currencyAffix");
eq("fr-FR EUR: suffix with a no-break space", currencyAffix("fr-FR", "EUR"), { prefix: "", suffix: `${NB}€` });
eq("en-GB EUR: prefix", currencyAffix("en-GB", "EUR"), { prefix: "€", suffix: "" });
eq("fr-FR USD: suffix $", currencyAffix("fr-FR", "USD"), { prefix: "", suffix: `${NB}$` });

console.log("shortDay");
eq("fr-FR", shortDay("2026-09-12", "fr-FR"), "sam. 12 sept.");
eq("en-GB", shortDay("2026-09-12", "en-GB"), "Sat 12 Sept");
eq("invalid iso returned as is", shortDay("demain", "fr-FR"), "demain");

console.log(`\n${ok} passed, ${ko} failed`);
process.exit(ko ? 1 : 0);
