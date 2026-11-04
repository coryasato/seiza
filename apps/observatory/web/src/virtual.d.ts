declare module 'virtual:cold-numbers' {
  const numbers: import('./readouts.ts').ColdNumbers;
  export default numbers;
}

declare module 'virtual:data-rows' {
  /** Each data file's rows, by its name in `data/`. */
  const rows: Record<string, number>;
  export default rows;
}
