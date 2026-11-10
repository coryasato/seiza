declare module 'virtual:cold-numbers' {
  const numbers: import('./readouts.ts').ColdNumbers;
  export default numbers;
}

declare module 'virtual:data-rows' {
  /** Each data file's rows, by its name in `data/`. */
  const rows: Record<string, number>;
  export default rows;
  /** The admin table's fonts toggle's faces, counted (`contenders/fonts/faces.ts`). */
  export const scriptFaces: number;
}

declare module 'virtual:gallery' {
  /** The Overview's and the component's page's words (`cold.ts`). */
  const gallery: import('./readouts.ts').Gallery;
  export default gallery;
}
