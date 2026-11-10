import { useState } from "react";
import { DAYS, FLIGHTS, PLACES, TRIP } from "../data/trip";
import monogram from "../assets/monogram.png";

export default function Intro({ onDone }: { onDone: () => void }) {
  const [out, setOut] = useState(false);
  const suppliers = PLACES.filter((p) => p.type === "fabricant").length;
  const days = DAYS.filter((d) => d.scheduled).reduce((n, d) => n + (d.dates?.length || 0), 0);
  const close = () => {
    setOut(true);
    setTimeout(onDone, 450);
  };
  const t = (iso: string) => new Date(iso).toLocaleString("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: TRIP.timezone });
  return (
    <div className={"intro" + (out ? " out" : "")} role="dialog" aria-label="Bienvenue">
      <img className="intro-mono" src={monogram} alt="ORBES" />
      <div className="intro-main">
        <h1>{TRIP.title}</h1>
        <p>Voyage de sourcing ORBES, du 7 au 13 juin 2026.</p>
        <div className="intro-facts">
          <div>
            <b>{PLACES.length}</b>
            <span>lieux</span>
          </div>
          <div>
            <b>{days}</b>
            <span>jours sur place</span>
          </div>
          <div>
            <b>{suppliers}</b>
            <span>fabricants</span>
          </div>
        </div>
        <div className="intro-flights">
          {FLIGHTS.map((f) => (
            <div key={f.code}>
              <b>{f.code}</b> {f.from} → {f.to}, {t(f.at)}
            </div>
          ))}
        </div>
      </div>
      <div className="intro-foot">
        <button className="btn primary" onClick={close} autoFocus>
          Ouvrir la carte
        </button>
        <small>Base : {TRIP.hotel.name}</small>
      </div>
    </div>
  );
}
