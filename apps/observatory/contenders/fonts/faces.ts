/**
 * The admin table's script fonts: the 13 Noto faces the GPUI contender
 * adds after its rows are in when the page asks for fonts (`?fonts`;
 * `docs/DECISIONS.md`, "Scenarios"), one for each script in the countries
 * file that IBM Plex Sans lacks and the browser doesn't draw (Han and
 * Hangul, by `EmojiAndCjk`). Each is notofonts' unhinted Regular TTF, whole
 * (never subset to the file's characters), pinned to one commit of their
 * release site and by its SHA-256 (`fetch.ts` checks both). Served at
 * `paths.ts`'s `SCRIPT_FONTS` beside `OFL.txt`, their copyright lines and the SIL
 * Open Font License 1.1. Pure: the contender's host imports it.
 */

/** The faces' license, served beside them. */
export const FONTS_LICENSE = 'OFL.txt';

/** notofonts.github.io's commit the faces are fetched at (2026-11-09). */
export const NOTO_COMMIT = '4cf78353cd1668040ba8efa13029cd910fcdf9e2';

export interface ScriptFace {
  /** The script, as the panel's verdicts name it. */
  script: string;
  /** The face's family, and its file `<family>-Regular.ttf`. */
  family: string;
  /** The face's version (its name table's). */
  version: string;
  bytes: number;
  sha256: string;
}

export const SCRIPT_FACES: readonly ScriptFace[] = [
  { script: 'Arabic', family: 'NotoSansArabic', version: '2.013', bytes: 142140, sha256: 'bd86ca02f087d7f3c3788ba458fb6b73744c7639ed276b8d870dba6def6c40d0' },
  { script: 'Armenian', family: 'NotoSansArmenian', version: '2.008', bytes: 18772, sha256: '73bde9f3c63aa5ed39236e8a2837224605210a98b54d65724676c0119fcaa24c' },
  { script: 'Bengali', family: 'NotoSansBengali', version: '3.011', bytes: 103704, sha256: '5dceda02816fece18ea6796f474f5d3170f1d862f21b1e809cdc94b1caa4b6ec' },
  { script: 'Devanagari', family: 'NotoSansDevanagari', version: '2.007', bytes: 184228, sha256: '9c7d935139ea6a1e6ad9dbac4f6d27ece1e04bca8123c8888d00a0f9df4724cd' },
  { script: 'Ethiopic', family: 'NotoSansEthiopic', version: '2.102', bytes: 289244, sha256: '86b9c07c049e68438388d00a34033fa28cabeef91b26e1bbed67512d360166d4' },
  { script: 'Georgian', family: 'NotoSansGeorgian', version: '2.005', bytes: 35300, sha256: 'f4b229b126859725b75031dd8c051335d20c85e4eb6d525af28f3e83e471baa4' },
  { script: 'Hebrew', family: 'NotoSansHebrew', version: '3.001', bytes: 16836, sha256: '04272f5600d0ec816d31d0df73b23aa8d3501ea359ebe820da31c11ffcf00853' },
  { script: 'Khmer', family: 'NotoSansKhmer', version: '2.004', bytes: 67784, sha256: '60c10dbfae33a44f1897cd939789bd173aedb7c7dc0a9af389a737e33cb7e548' },
  { script: 'Lao', family: 'NotoSansLao', version: '2.003', bytes: 21720, sha256: 'd3976b0ac08702c54999ff42eae295d1597fd73b44e0c57d7f4917524e18afbe' },
  { script: 'Myanmar', family: 'NotoSansMyanmar', version: '2.107', bytes: 148628, sha256: 'f4be6ef43871516d8347c5217a2033991b8ecda2dd1200007c2fb431a66d64db' },
  { script: 'Sinhala', family: 'NotoSansSinhala', version: '3.000', bytes: 90296, sha256: '46d5b54952a624e6e3981e0968aecc5464f3b1081131dd7a1fcd42fbf7966471' },
  { script: 'Thai', family: 'NotoSansThai', version: '2.002', bytes: 20960, sha256: 'd4303fe9c63ebb72759ca8b6d2040c8ae81689f7d08d7b91c656154382b49313' },
  { script: 'Tibetan', family: 'NotoSerifTibetan', version: '2.103', bytes: 609640, sha256: '7292b2c76cf5c9b81e5362d88e0cb0a16b9d92827f86f945203014b049fd2fc5' },
];

/** A face's name where it's kept and served: its version and its hash's
 *  start in it, so a new pin is a new URL (the faces are cached immutable). */
export const faceFile = (face: ScriptFace): string => `${face.family}-Regular-${face.version}-${face.sha256.slice(0, 8)}.ttf`;
/** Where a face is fetched from when `faces/` lacks it. */
export const faceSource = (face: ScriptFace): string =>
  `https://raw.githubusercontent.com/notofonts/notofonts.github.io/${NOTO_COMMIT}/fonts/${face.family}/unhinted/ttf/${face.family}-Regular.ttf`;
