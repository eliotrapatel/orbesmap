/** French plural: 0 and 1 are singular */
export const plural = (n: number, one: string, many: string) => `${n} ${n <= 1 ? one : many}`;
