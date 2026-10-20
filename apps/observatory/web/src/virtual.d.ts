declare module 'virtual:cold-numbers' {
  const numbers: import('./readouts.ts').ColdNumbers;
  export default numbers;
}

declare module 'virtual:data-rows' {
  const rows: number;
  export default rows;
}
