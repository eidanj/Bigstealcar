// Big Steal Car — world constants, vehicle catalogue and default settings.
export const VERSION = '1.0.0';

// City grid. Roads run along x = k*P - HALF and z = k*P - HALF for k = 0..NB.
export const CITY = {
  NB: 9,            // blocks per side
  P: 88,            // grid pitch (m)
  RW: 20,           // road width: 2 lanes each way + parking strip
  SW: 5,            // sidewalk width
  CURB: 0.15,       // sidewalk/curb height
  LANES: [2.0, 5.6], // lane centre offsets from the road centre line (right-hand traffic)
  PARK: 8.7,        // parking strip offset
  EDGE: 30,         // waterfront promenade beyond the outer roads
};
CITY.HALF = (CITY.NB * CITY.P) / 2;          // 396
CITY.SLAB = (CITY.P - CITY.RW) / 2;          // half size of a raised block (34)
CITY.LOT = CITY.SLAB - CITY.SW;              // half size of the buildable lot (29)
CITY.LIMIT = CITY.HALF + CITY.RW / 2 + CITY.EDGE; // sea wall

export const DISTRICTS = {
  downtown: { name: 'Central Spire', color: '#ffd166' },
  midtown: { name: 'Midtown', color: '#8ecae6' },
  heights: { name: 'Sunset Heights', color: '#f4a261' },
  industrial: { name: 'Rustwater', color: '#b5838d' },
  harbor: { name: 'Port Bellmont', color: '#90be6d' },
  park: { name: 'Greenway Park', color: '#76c893' },
  stunt: { name: 'Stunt Yard', color: '#f94144' },
};

// Special blocks [i, j] -> kind
export const SPECIAL_BLOCKS = {
  '2,2': 'park', '6,4': 'park', '1,6': 'park', '4,1': 'park',
  '7,1': 'stunt', '2,3': 'parking', '5,6': 'plaza',
};

export const PAINT = [
  0xf2f2f0, 0x111214, 0xb8bcc2, 0x5d6168, 0x1d3a6e, 0xb3121b, 0x5e1320, 0x1f4d36,
  0xc9b48f, 0xe0661b, 0x2a7f8f, 0x2b2f3a, 0x8a1538, 0x3c6e9e, 0xd8c33a, 0x6b4e9b,
];

// Vehicle catalogue. Lengths in metres, power in watts, speeds in m/s.
// prof: side-profile key points (z positive = front). Heights above ground.
export const CAR_TYPES = {
  sedan: {
    name: 'Meridian', cls: 'Sedan', mass: 1450, L: 4.7, W: 1.86, H: 1.46, clear: 0.2, wheelR: 0.34, wheelW: 0.24, wb: 2.8, track: 1.58,
    power: 150e3, fmax: 7600, vmax: 55, drive: 'rwd', grip: 1.18, steer: 0.62, sus: 1.0,
    prof: { noseH: 0.68, hoodH: 0.95, beltH: 0.97, deckH: 1.0, tailH: 0.8, ws: 0.78, rf: -0.08, rr: -1.05, rg: -1.62 },
  },
  sports: {
    name: 'Vortex GT', cls: 'Sports', mass: 1350, L: 4.45, W: 1.96, H: 1.2, clear: 0.13, wheelR: 0.34, wheelW: 0.3, wb: 2.62, track: 1.66,
    power: 330e3, fmax: 11000, vmax: 78, drive: 'rwd', grip: 1.32, steer: 0.58, sus: 1.35, spoiler: true,
    prof: { noseH: 0.52, hoodH: 0.78, beltH: 0.82, deckH: 0.86, tailH: 0.76, ws: 0.58, rf: -0.38, rr: -1.0, rg: -1.9 },
  },
  muscle: {
    name: 'Brute SS', cls: 'Muscle', mass: 1650, L: 4.9, W: 1.95, H: 1.36, clear: 0.18, wheelR: 0.36, wheelW: 0.3, wb: 2.86, track: 1.62,
    power: 280e3, fmax: 10200, vmax: 69, drive: 'rwd', grip: 1.08, steer: 0.58, sus: 0.95, scoop: true,
    prof: { noseH: 0.84, hoodH: 0.98, beltH: 1.0, deckH: 0.99, tailH: 0.86, ws: 0.32, rf: -0.32, rr: -1.22, rg: -1.62 },
  },
  suv: {
    name: 'Bison', cls: 'SUV', mass: 2100, L: 4.8, W: 1.98, H: 1.82, clear: 0.28, wheelR: 0.42, wheelW: 0.28, wb: 2.9, track: 1.66,
    power: 200e3, fmax: 9800, vmax: 52, drive: 'awd', grip: 1.05, steer: 0.6, sus: 0.85, rack: true,
    prof: { noseH: 1.0, hoodH: 1.16, beltH: 1.2, deckH: 1.24, tailH: 1.08, ws: 0.95, rf: 0.28, rr: -1.92, rg: -2.05 },
  },
  hatch: {
    name: 'Pip', cls: 'Compact', mass: 1100, L: 3.9, W: 1.74, H: 1.48, clear: 0.18, wheelR: 0.31, wheelW: 0.21, wb: 2.45, track: 1.5,
    power: 95e3, fmax: 6000, vmax: 47, drive: 'fwd', grip: 1.15, steer: 0.66, sus: 1.0,
    prof: { noseH: 0.7, hoodH: 0.92, beltH: 0.98, deckH: 1.0, tailH: 0.92, ws: 0.72, rf: 0.0, rr: -1.5, rg: -1.6 },
  },
  taxi: {
    name: 'Cab', cls: 'Taxi', base: 'sedan', livery: 'taxi', fixedColor: 0xf2b705, power: 140e3, vmax: 52, sign: 'taxi',
  },
  police: {
    name: 'Interceptor', cls: 'Police', base: 'sedan', livery: 'police', fixedColor: 0x14161a, mass: 1600,
    power: 230e3, fmax: 9600, vmax: 64, grip: 1.3, sus: 1.15, lightbar: true, pushbar: true,
  },
  van: {
    name: 'Haulmark', cls: 'Van', mass: 2600, L: 5.3, W: 2.06, H: 2.35, clear: 0.24, wheelR: 0.38, wheelW: 0.26, wb: 3.3, track: 1.72,
    power: 150e3, fmax: 9000, vmax: 42, drive: 'rwd', grip: 1.0, steer: 0.62, sus: 0.8, cargo: true,
    prof: { noseH: 0.95, hoodH: 1.12, beltH: 1.18, deckH: 1.2, tailH: 1.0, ws: 2.02, rf: 1.5, rr: 0.92, rg: 0.8 },
  },
  super: {
    name: 'Zentra R', cls: 'Super', mass: 1420, L: 4.55, W: 2.02, H: 1.12, clear: 0.11, wheelR: 0.35, wheelW: 0.32, wb: 2.7, track: 1.72,
    power: 470e3, fmax: 13000, vmax: 92, drive: 'awd', grip: 1.42, steer: 0.55, sus: 1.5, spoiler: true,
    prof: { noseH: 0.42, hoodH: 0.7, beltH: 0.74, deckH: 0.82, tailH: 0.72, ws: 0.98, rf: 0.02, rr: -0.75, rg: -1.92 },
  },
};
// resolve variants
for (const k in CAR_TYPES) {
  const t = CAR_TYPES[k]; t.key = k;
  if (t.base) { const b = CAR_TYPES[t.base]; for (const p in b) if (t[p] === undefined && p !== 'key') t[p] = b[p]; }
}
// traffic mix (weights)
export const TRAFFIC_MIX = [['sedan', 30], ['hatch', 22], ['suv', 18], ['taxi', 12], ['van', 8], ['muscle', 6], ['sports', 4]];
export const PARKED_MIX = [['sedan', 26], ['hatch', 20], ['suv', 18], ['muscle', 10], ['sports', 10], ['van', 6], ['super', 3], ['taxi', 4]];

export const WANTED = {
  thresholds: [0, 12, 55, 130, 240, 400], // heat needed for 1..5 stars
  copsPerStar: [0, 1, 2, 3, 4, 6],
  loseTime: [0, 9, 13, 17, 22, 28],        // seconds unseen to drop a star
};

export const DEFAULT_SETTINGS = {
  quality: 'high', time: 'dynamic', dayMinutes: 24, volume: 0.8, music: 0.45, sfx: 1,
  sens: 1, invertY: false, units: 'mph', fov: 62, showFps: false, radio: true,
};
