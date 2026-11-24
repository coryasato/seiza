declare module 'virtual:tycho-sample' {
  /** The first screen's sample row: its title, rows, and download size (`vite.config.ts`, from `data/MANIFEST.json`). */
  const sample: { title: string; rows: number; bytes: number };
  export default sample;
}
