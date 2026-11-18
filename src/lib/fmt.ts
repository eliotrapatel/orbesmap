import { getLang } from "./i18n";

/** French plural: 0 and 1 are singular (English: only 1) */
export const plural = (n: number, one: string, many: string) => `${n} ${(getLang() === "en" ? n === 1 : n <= 1) ? one : many}`;
