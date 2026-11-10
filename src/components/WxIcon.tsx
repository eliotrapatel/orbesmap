import { wxKind } from "../lib/weather";
import { ICloud, IFog, IPartly, IRain, ISnow, IStorm, ISun } from "./Icons";

export function WxIcon({ code }: { code: number }) {
  const k = wxKind(code);
  const C = { sun: ISun, partly: IPartly, cloud: ICloud, fog: IFog, rain: IRain, snow: ISnow, storm: IStorm }[k];
  return <C />;
}
