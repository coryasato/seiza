// The words GCAT's codes become in Tycho's sample. Each table links to the
// GCAT page it's read from. A code in the data that a table doesn't cover
// fails the build (gcat.ts), which prints it: add its word here from the page.

/** `Type`'s first letter, the coarse type (https://planet4589.org/space/gcat/web/intro/type.html, byte 1).
 *  Z (spurious) is dropped before decoding; S (suborbital) and X (deleted)
 *  don't belong in the orbital catalogs, so they fail. */
export const OBJECT_TYPE: Record<string, string> = {
  P: 'Payload',
  R: 'Rocket stage',
  C: 'Component',
  D: 'Debris',
};

/** `Type`'s fourth letter, the subtype (the same page, byte 4). Blank and `-` are null. */
export const OBJECT_DETAIL: Record<string, string> = {
  A: 'Payload adapter or support structure',
  B: 'Battery explosion debris',
  C: 'Calibration object or test object',
  D: 'Dummy satellite',
  E: 'Spacesuit on a tethered spacewalk',
  F: 'Fairing or cover',
  G: 'General debris',
  H: 'Human spaceflight hardware',
  I: 'Collision debris',
  J: 'Insulation or soft material',
  K: 'Solid motor slag',
  L: 'Separated after landing',
  M: 'Jettisoned motor or tank',
  N: 'Nuclear reactor or RTG',
  O: 'Released at orbit insertion',
  P: 'Propulsion breakup debris',
  Q: 'Aerodynamic breakup debris',
  R: 'Reentry vehicle',
  S: 'Subsatellite',
  T: 'Ejected payload section',
  U: 'Untethered spacewalk',
  V: 'Ejection mechanism',
  W: 'Weapons test debris',
  X: 'Unknown debris',
  Y: 'Despin weight',
  Z: 'Destruct device debris',
};

/** `Type`'s second letter H: humans aboard at launch (the same page, byte 2). */
export const CREWED_LETTER = 'H';
/** `Type`'s eleventh letter M: a megaconstellation satellite (the same page,
 *  byte 11). Its `m`, "may or may not be considered a megacon", isn't one. */
export const MEGACONSTELLATION_LETTER = 'M';

/** `Status`, how the row's phase ended (https://planet4589.org/space/gcat/web/intro/phases.html).
 *  A trailing `?` is stripped first. The codes used only in the deep-space
 *  catalogs (OI, OE, EN, EO, EAO, LO, LOA, TO, TOA, TX) aren't listed. */
export const STATUS: Record<string, string> = {
  O: 'In orbit',
  OX: 'In orbit, untracked',
  AO: 'Attached in orbit',
  'AO IN': 'Attached inside',
  UDK: 'Undocked',
  REL: 'Released',
  DEP: 'Deployed',
  E: 'Exploded',
  N: 'Renamed',
  NA: 'Renamed while attached',
  LEASE: 'Leased',
  S: 'Suborbital reentry',
  R: 'Reentered',
  D: 'Deorbited',
  L: 'Landed',
  LF: 'Failed landing',
  AS: 'Reentered attached, suborbital',
  AR: 'Reentered attached',
  'AR IN': 'Reentered inside',
  AL: 'Landed attached',
  'AL IN': 'Landed inside',
  F: 'Failed at launch',
  AF: 'Failed at launch, attached',
  DSO: 'Left for deep space',
  DSA: 'Left for deep space',
  'DSA IN': 'Left for deep space',
  DK: 'Docked',
  GRP: 'Grappled',
  ATT: 'Attached',
  TFR: 'Transferred',
  'TFR E': 'Transferred outside',
  'TFR IN': 'Transferred inside',
  C: 'Collided',
  'EVA DP': 'Spacewalk',
  'EVA RP': 'Spacewalk',
  REFLT: 'Reflown',
};

/** The statuses whose end is the object coming back to Earth, the only rows
 *  `days_in_orbit` is filled for. */
export const RETURNED = ['R', 'D', 'L', 'LF', 'AS', 'AR', 'AR IN', 'AL', 'AL IN'];

/** `OpOrbit` (https://planet4589.org/space/gcat/web/intro/orbits.html): [coarse, in full]. `-` is null. */
export const ORBIT: Record<string, [string, string]> = {
  ATM: ['Suborbital', 'Atmospheric'],
  SO: ['Suborbital', 'Suborbital'],
  TA: ['Suborbital', 'Trans-atmospheric'],
  'LLEO/E': ['Low Earth', 'Lower LEO, equatorial'],
  'LLEO/I': ['Low Earth', 'Lower LEO, intermediate'],
  'LLEO/P': ['Low Earth', 'Lower LEO, polar'],
  'LLEO/S': ['Low Earth', 'Lower LEO, Sun-synchronous'],
  'LLEO/R': ['Low Earth', 'Lower LEO, retrograde'],
  'LEO/E': ['Low Earth', 'Upper LEO, equatorial'],
  'LEO/I': ['Low Earth', 'Upper LEO, intermediate'],
  'LEO/P': ['Low Earth', 'Upper LEO, polar'],
  'LEO/S': ['Low Earth', 'Upper LEO, Sun-synchronous'],
  'LEO/R': ['Low Earth', 'Upper LEO, retrograde'],
  MEO: ['Medium Earth', 'Medium Earth'],
  HEO: ['Highly elliptical', 'Highly elliptical'],
  'HEO/M': ['Highly elliptical', 'Molniya'],
  GTO: ['Geotransfer', 'Geotransfer'],
  'GEO/S': ['Geosynchronous', 'Geostationary'],
  'GEO/I': ['Geosynchronous', 'Inclined GEO'],
  'GEO/T': ['Geosynchronous', 'Synchronous'],
  'GEO/D': ['Geosynchronous', 'Drift GEO'],
  'GEO/SI': ['Geosynchronous', 'Inclined GEO'],
  'GEO/ID': ['Geosynchronous', 'Inclined drift GEO'],
  'GEO/NS': ['Geosynchronous', 'Near-synchronous'],
  VHEO: ['High Earth', 'Very high Earth'],
  DSO: ['High Earth', 'Deep space orbit'],
  CLO: ['Cislunar', 'Cislunar or translunar'],
  EEO: ['Earth escape', 'Earth escape'],
  HCO: ['Heliocentric', 'Heliocentric'],
  PCO: ['Planetocentric', 'Planetocentric'],
  SSE: ['Solar System escape', 'Solar System escape'],
};

/** The payload files' `Category`, its first value with `?` and `*` stripped
 *  (https://planet4589.org/space/gcat/web/cat/pcols.html, "Category"). */
export const PURPOSE: Record<string, string> = {
  AST: 'Astronomy',
  BIO: 'Life sciences',
  CAL: 'Calibration',
  COM: 'Communications',
  EDU: 'Education',
  EOSCI: 'Earth science',
  EW: 'Missile early warning',
  GEOD: 'Geodesy',
  IMG: 'Imaging',
  'IMG-R': 'Radar imaging',
  INF: 'Infrastructure',
  MET: 'Weather',
  'MET-RO': 'Weather, radio occultation',
  MGRAV: 'Microgravity',
  MISC: 'Miscellaneous',
  NAV: 'Navigation',
  PLAN: 'Deep space mission',
  RB: 'Rocket body',
  RV: 'Reentry vehicle',
  SCI: 'Science',
  SIG: 'Signals intelligence',
  SS: 'Human spaceflight',
  TARG: 'Target',
  TECH: 'Technology',
  WEAPON: 'Weapon',
};

/** The payload files' `Class`, one letter each; two letters are written with
 *  a slash (the same page, "Class"). `-` is null. */
export const SECTOR: Record<string, string> = {
  A: 'Amateur or academic',
  B: 'Business',
  C: 'Civil',
  D: 'Defense',
};

/** The names a visitor expects where GCAT's differ, by org or site code.
 *  Every other name is GCAT's own: a country's English short name, an
 *  organization's English short name or else its short name, a site's short
 *  name. Kept short on purpose. */
export const OUR_NAMES = {
  country: { US: 'United States', SU: 'Soviet Union', UK: 'United Kingdom' } as Record<string, string>,
  site: { KSC: 'Kennedy Space Center', CC: 'Cape Canaveral' } as Record<string, string>,
};
