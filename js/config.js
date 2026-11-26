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
// prof: side-profile key points (z positive = front). Heights above ground. cabH: roof of the cab when the vehicle is
// taller than its cab (box truck). cabZ: z of a vertical cab back wall (pickups, trucks); bed: open load bed behind it.
// lamp: every model has its own headlight (hs), taillight (ts) and grille (gs) design, plus where they sit:
//   f = front cluster {hw width, hh height, hy top below the nose line, turn: out|in|under|none, drl: under|top|bar|none}
//   r = rear {k: horiz|vert|bar|bumper, tw, th, ty}   g = grille {w half-width / W, h, y top below the nose line}
// age: how likely a parked/traffic example is to show rust and fading (new: never, mid: rarely, old: sometimes)
export const CAR_TYPES = {
  sedan: {
    name: 'Meridian', cls: 'Sedan', mass: 1450, L: 4.7, W: 1.86, H: 1.46, clear: 0.2, wheelR: 0.34, wheelW: 0.24, wb: 2.8, track: 1.58,
    power: 150e3, fmax: 7600, vmax: 55, drive: 'rwd', grip: 1.18, steer: 0.62, sus: 1.0, age: 'mid', price: 4000,
    prof: { noseH: 0.68, hoodH: 0.95, beltH: 0.97, deckH: 1.0, tailH: 0.8, ws: 0.78, rf: -0.08, rr: -1.05, rg: -1.62 },
    lamp: { hs: 'twinProj', ts: 'threeBar', gs: 'honey' },
  },
  sports: {
    name: 'Vortex GT', cls: 'Sports', mass: 1350, L: 4.45, W: 1.96, H: 1.2, clear: 0.13, wheelR: 0.34, wheelW: 0.3, wb: 2.62, track: 1.66, doors: 2,
    power: 330e3, fmax: 11000, vmax: 78, drive: 'rwd', grip: 1.32, steer: 0.58, sus: 1.35, spoiler: true, age: 'new', price: 28000,
    prof: { noseH: 0.52, hoodH: 0.78, beltH: 0.82, deckH: 0.86, tailH: 0.76, ws: 0.58, rf: -0.38, rr: -1.0, rg: -1.9 },
    lamp: { hs: 'ledSlim', ts: 'twinRing', gs: 'mesh', f: { hw: 0.56, hh: 0.1, hy: 0.1, turn: 'in', drl: 'top' }, r: { k: 'horiz', tw: 0.46, th: 0.13 }, g: { w: 0.24, h: 0.12, y: 0.13 } },
  },
  muscle: {
    name: 'Brute SS', cls: 'Muscle', mass: 1650, L: 4.9, W: 1.95, H: 1.36, clear: 0.18, wheelR: 0.36, wheelW: 0.3, wb: 2.86, track: 1.62, doors: 2,
    power: 280e3, fmax: 10200, vmax: 69, drive: 'rwd', grip: 1.08, steer: 0.58, sus: 0.95, scoop: true, age: 'old', price: 16000,
    prof: { noseH: 0.84, hoodH: 0.98, beltH: 1.0, deckH: 0.99, tailH: 0.86, ws: 0.32, rf: -0.32, rr: -1.22, rg: -1.62 },
    lamp: { hs: 'quadRound', ts: 'ribbedWide', gs: 'hbars', f: { hw: 0.6, hh: 0.2, hy: 0.06, turn: 'under', drl: 'none' }, r: { k: 'bar', tw: 0.5, th: 0.16, ty: 0.06 }, g: { w: 0.22, h: 0.22, y: 0.06 } },
  },
  suv: {
    name: 'Bison', cls: 'SUV', mass: 2100, L: 4.8, W: 1.98, H: 1.82, clear: 0.28, wheelR: 0.42, wheelW: 0.28, wb: 2.9, track: 1.66,
    power: 200e3, fmax: 9800, vmax: 52, drive: 'awd', grip: 1.05, steer: 0.6, sus: 0.85, rack: true, age: 'mid', price: 9500,
    prof: { noseH: 1.0, hoodH: 1.16, beltH: 1.2, deckH: 1.24, tailH: 1.08, ws: 0.95, rf: 0.28, rr: -1.92, rg: -2.05 },
    lamp: { hs: 'squareProj', ts: 'vertStack', gs: 'vbars', f: { hw: 0.52, hh: 0.2, hy: 0.1 }, r: { k: 'vert', tw: 0.2, th: 0.5, ty: 0.02 }, g: { w: 0.24, h: 0.24, y: 0.09 } },
  },
  hatch: {
    name: 'Pip', cls: 'Compact', mass: 1100, L: 3.9, W: 1.74, H: 1.48, clear: 0.18, wheelR: 0.31, wheelW: 0.21, wb: 2.45, track: 1.5,
    power: 95e3, fmax: 6000, vmax: 47, drive: 'fwd', grip: 1.15, steer: 0.66, sus: 1.0, age: 'old', price: 2500,
    prof: { noseH: 0.7, hoodH: 0.92, beltH: 0.98, deckH: 1.0, tailH: 0.92, ws: 0.72, rf: 0.0, rr: -1.5, rg: -1.6 },
    lamp: { hs: 'roundCompact', ts: 'boomerang', gs: 'smile', f: { hw: 0.44, hh: 0.18, hy: 0.09, turn: 'out', drl: 'none' }, r: { k: 'vert', tw: 0.22, th: 0.32, ty: 0.0 }, g: { w: 0.17, h: 0.1, y: 0.16 } },
  },
  taxi: {
    name: 'Cab', cls: 'Taxi', base: 'sedan', livery: 'taxi', fixedColor: 0xf2b705, power: 140e3, vmax: 52, sign: 'taxi', age: 'old', price: 3500,
    lamp: { hs: 'halogenRect', ts: 'oldRect', gs: 'chromeBars', f: { hw: 0.5, hh: 0.15, hy: 0.1, turn: 'under', drl: 'none' }, r: { k: 'horiz', tw: 0.48, th: 0.15 } }, chromeBumper: true,
  },
  police: {
    name: 'Interceptor', cls: 'Police', base: 'sedan', livery: 'police', fixedColor: 0x14161a, mass: 1600, age: 'new',
    power: 230e3, fmax: 9600, vmax: 64, grip: 1.3, sus: 1.15, lightbar: true, pushbar: true,
    lamp: { hs: 'policeStrobe', ts: 'policeTail', gs: 'police', f: { hw: 0.5, hh: 0.16, hy: 0.11, turn: 'out', drl: 'under' }, r: { k: 'horiz', tw: 0.5, th: 0.15 } },
  },
  policeSUV: {
    name: 'Interceptor Utility', cls: 'Police', base: 'suv', livery: 'police', fixedColor: 0x14161a, mass: 2250, age: 'new',
    power: 270e3, fmax: 11500, vmax: 60, grip: 1.2, sus: 1.05, lightbar: true, pushbar: true, rack: false,
    lamp: { hs: 'ledMatrixBlue', ts: 'vertBlue', gs: 'police', f: { hw: 0.52, hh: 0.18, hy: 0.11, turn: 'in', drl: 'top' }, r: { k: 'vert', tw: 0.18, th: 0.52, ty: 0.02 }, g: { w: 0.24, h: 0.22, y: 0.1 } },
  },
  van: {
    name: 'Haulmark', cls: 'Van', mass: 2600, L: 5.3, W: 2.06, H: 2.35, clear: 0.24, wheelR: 0.38, wheelW: 0.26, wb: 3.3, track: 1.72, doors: 2,
    power: 150e3, fmax: 9000, vmax: 42, drive: 'rwd', grip: 1.0, steer: 0.62, sus: 0.8, cargo: true, age: 'old', price: 6500,
    prof: { noseH: 0.95, hoodH: 1.12, beltH: 1.18, deckH: 1.2, tailH: 1.0, ws: 2.02, rf: 1.5, rr: 0.92, rg: 0.8 },
    lamp: { hs: 'vanBig', ts: 'vanVert', gs: 'van', f: { hw: 0.5, hh: 0.22, hy: 0.1 }, r: { k: 'vert', tw: 0.17, th: 0.5, ty: -0.12 }, g: { w: 0.25, h: 0.24, y: 0.08 } },
  },
  super: {
    name: 'Zentra R', cls: 'Super', mass: 1420, L: 4.55, W: 2.02, H: 1.12, clear: 0.11, wheelR: 0.35, wheelW: 0.32, wb: 2.7, track: 1.72, doors: 2,
    power: 470e3, fmax: 13000, vmax: 92, drive: 'awd', grip: 1.42, steer: 0.55, sus: 1.5, spoiler: true, age: 'new', price: 45000,
    prof: { noseH: 0.42, hoodH: 0.7, beltH: 0.74, deckH: 0.82, tailH: 0.72, ws: 0.98, rf: 0.02, rr: -0.75, rg: -1.92 },
    lamp: { hs: 'superSlit', ts: 'superX', gs: 'carbon', f: { hw: 0.56, hh: 0.13, hy: -0.04, turn: 'none', drl: 'under', slope: true }, r: { k: 'bar', tw: 0.46, th: 0.09, ty: 0.05 }, g: { w: 0.32, h: 0.11, y: 0.2 } },
  },
  coupe: {
    name: 'Lumen', cls: 'Coupe', mass: 1480, L: 4.6, W: 1.9, H: 1.3, clear: 0.14, wheelR: 0.34, wheelW: 0.27, wb: 2.68, track: 1.62, doors: 2,
    power: 245e3, fmax: 9400, vmax: 70, drive: 'rwd', grip: 1.24, steer: 0.6, sus: 1.2, age: 'new', price: 12000,
    prof: { noseH: 0.6, hoodH: 0.84, beltH: 0.88, deckH: 0.93, tailH: 0.82, ws: 0.6, rf: -0.28, rr: -1.2, rg: -1.78 },
    lamp: { hs: 'lProj', ts: 'thinLine', gs: 'diamond', f: { hw: 0.54, hh: 0.13, hy: 0.1, turn: 'none', drl: 'under' }, r: { k: 'bar', tw: 0.42, th: 0.08, ty: 0.06 }, g: { w: 0.2, h: 0.14, y: 0.12 } },
  },
  luxury: {
    name: 'Regent', cls: 'Luxury', mass: 2050, L: 5.25, W: 1.96, H: 1.5, clear: 0.18, wheelR: 0.37, wheelW: 0.26, wb: 3.2, track: 1.66,
    power: 300e3, fmax: 11000, vmax: 68, drive: 'awd', grip: 1.2, steer: 0.6, sus: 1.05, age: 'new', price: 18000, chromeBumper: true,
    prof: { noseH: 0.74, hoodH: 0.98, beltH: 1.0, deckH: 1.04, tailH: 0.88, ws: 0.85, rf: -0.05, rr: -1.38, rg: -1.95 },
    lamp: { hs: 'crystal', ts: 'chromeGrid', gs: 'chromeBig', f: { hw: 0.54, hh: 0.14, hy: 0.09 }, r: { k: 'bar', tw: 0.5, th: 0.12, ty: 0.05 }, g: { w: 0.19, h: 0.3, y: 0.02 } },
  },
  wagon: {
    name: 'Estate', cls: 'Wagon', mass: 1560, L: 4.85, W: 1.84, H: 1.5, clear: 0.17, wheelR: 0.33, wheelW: 0.23, wb: 2.82, track: 1.56,
    power: 140e3, fmax: 7400, vmax: 52, drive: 'fwd', grip: 1.12, steer: 0.62, sus: 0.95, rack: true, age: 'mid', price: 4500,
    prof: { noseH: 0.7, hoodH: 0.94, beltH: 0.98, deckH: 1.04, tailH: 0.94, ws: 0.8, rf: 0.02, rr: -1.95, rg: -2.02 },
    lamp: { hs: 'twinBowl', ts: 'lShape', gs: 'egg', f: { hw: 0.5, hh: 0.17, hy: 0.1, turn: 'out', drl: 'none' }, r: { k: 'vert', tw: 0.26, th: 0.4, ty: 0.0 } },
  },
  ev: {
    name: 'Ion', cls: 'Electric', mass: 1950, L: 4.72, W: 1.92, H: 1.42, clear: 0.15, wheelR: 0.35, wheelW: 0.26, wb: 2.92, track: 1.64,
    power: 330e3, fmax: 13500, vmax: 69, drive: 'awd', grip: 1.25, steer: 0.62, sus: 1.15, age: 'new', price: 14000, electric: true,
    prof: { noseH: 0.64, hoodH: 0.84, beltH: 0.92, deckH: 0.98, tailH: 0.9, ws: 1.0, rf: 0.22, rr: -1.35, rg: -1.92 },
    lamp: { hs: 'evPixel', ts: 'evBar', gs: 'blank', f: { hw: 0.4, hh: 0.08, hy: 0.12, turn: 'none', drl: 'bar' }, r: { k: 'bar', tw: 0.38, th: 0.07, ty: 0.06 }, g: { w: 0.3, h: 0.1, y: 0.3 } },
  },
  classic: {
    name: 'Cruisemaster', cls: 'Classic', mass: 1800, L: 5.4, W: 2.0, H: 1.42, clear: 0.2, wheelR: 0.36, wheelW: 0.22, wb: 3.05, track: 1.6,
    power: 210e3, fmax: 9000, vmax: 56, drive: 'rwd', grip: 0.98, steer: 0.58, sus: 0.78, fins: true, chromeBumper: true, age: 'old', price: 20000,
    prof: { noseH: 0.82, hoodH: 0.9, beltH: 0.94, deckH: 0.95, tailH: 0.9, ws: 0.5, rf: 0.12, rr: -1.05, rg: -1.5 },
    lamp: { hs: 'bigRound', ts: 'roundFin', gs: 'chromeTeeth', f: { hw: 0.3, hh: 0.26, hy: 0.04, turn: 'under', drl: 'none' }, r: { k: 'horiz', tw: 0.3, th: 0.2, ty: 0.02 }, g: { w: 0.3, h: 0.2, y: 0.08 } },
  },
  minivan: {
    name: 'Nestor', cls: 'Minivan', mass: 2000, L: 5.05, W: 1.96, H: 1.78, clear: 0.17, wheelR: 0.35, wheelW: 0.24, wb: 3.03, track: 1.66, doors: 'slide',
    power: 185e3, fmax: 8800, vmax: 52, drive: 'fwd', grip: 1.04, steer: 0.62, sus: 0.9, age: 'mid', price: 5500,
    prof: { noseH: 0.82, hoodH: 1.0, beltH: 1.08, deckH: 1.14, tailH: 1.05, ws: 1.15, rf: 0.6, rr: -2.1, rg: -2.18 },
    lamp: { hs: 'swept', ts: 'mvCurve', gs: 'mvGrille', f: { hw: 0.58, hh: 0.19, hy: 0.08 }, r: { k: 'vert', tw: 0.2, th: 0.56, ty: -0.1 }, g: { w: 0.22, h: 0.14, y: 0.1 } },
  },
  pickup: {
    name: 'Workhorse', cls: 'Pickup', mass: 2400, L: 5.8, W: 2.05, H: 1.92, clear: 0.3, wheelR: 0.42, wheelW: 0.3, wb: 3.6, track: 1.72,
    power: 280e3, fmax: 12500, vmax: 56, drive: 'awd', grip: 1.04, steer: 0.58, sus: 0.85, age: 'mid', price: 8000, cabZ: -1.02, com: 0.6,
    bed: { rail: 1.34, wall: 0.17 },
    prof: { noseH: 1.1, hoodH: 1.24, beltH: 1.32, deckH: 0.98, tailH: 1.34, ws: 0.95, rf: 0.35, rr: -0.92, rg: -0.98 },
    lamp: { hs: 'cShape', ts: 'pickupC', gs: 'truckBig', f: { hw: 0.52, hh: 0.26, hy: 0.06, turn: 'in', drl: 'none' }, r: { k: 'vert', tw: 0.15, th: 0.5, ty: 0.05 }, g: { w: 0.29, h: 0.36, y: 0.05 } },
  },
  pickupS: {
    name: 'Mutt', cls: 'Pickup', mass: 1650, L: 4.85, W: 1.82, H: 1.72, clear: 0.24, wheelR: 0.35, wheelW: 0.24, wb: 2.9, track: 1.54, doors: 2,
    power: 125e3, fmax: 7600, vmax: 46, drive: 'rwd', grip: 1.0, steer: 0.62, sus: 0.85, age: 'old', price: 3000, cabZ: -0.52, chromeBumper: true, com: 0.54,
    bed: { rail: 1.12, wall: 0.16 },
    prof: { noseH: 0.95, hoodH: 1.04, beltH: 1.1, deckH: 0.84, tailH: 1.12, ws: 0.75, rf: 0.3, rr: -0.42, rg: -0.48 },
    lamp: { hs: 'sealedSquare', ts: 'squareOld', gs: 'oldBars', f: { hw: 0.36, hh: 0.2, hy: 0.06, turn: 'under', drl: 'none' }, r: { k: 'vert', tw: 0.14, th: 0.28, ty: 0.06 }, g: { w: 0.26, h: 0.22, y: 0.07 } },
  },
  boxtruck: {
    name: 'Packrat', cls: 'Truck', mass: 7500, L: 7.4, W: 2.4, H: 3.4, clear: 0.32, wheelR: 0.5, wheelW: 0.32, wb: 4.3, track: 2.0, doors: 2,
    power: 250e3, fmax: 22000, vmax: 34, drive: 'rwd', grip: 0.92, steer: 0.5, sus: 0.75, age: 'old', price: 11000, cabZ: 1.72, box: { z0: 1.58, y0: 1.18 },
    prof: { noseH: 1.48, hoodH: 1.52, beltH: 1.56, deckH: 1.12, tailH: 1.12, ws: 3.1, rf: 2.9, rr: 1.8, rg: 1.76, cabH: 2.85, seatY: 1.02 },
    lamp: { hs: 'truckStack', ts: 'roundTriple', gs: 'truckSlots', f: { hw: 0.44, hh: 0.3, hy: 0.4, turn: 'out', drl: 'none' }, r: { k: 'bumper' }, g: { w: 0.26, h: 0.5, y: 0.2 } },
  },
  dump: {
    name: 'Rockhauler', cls: 'Truck', mass: 9000, L: 7.0, W: 2.45, H: 3.0, clear: 0.38, wheelR: 0.56, wheelW: 0.36, wb: 3.9, track: 2.02, doors: 2,
    power: 290e3, fmax: 27000, vmax: 32, drive: 'awd', grip: 0.95, steer: 0.5, sus: 0.7, age: 'old', price: 15000, cabZ: 1.62, bed: { rail: 2.6, wall: 0.22, z0: 1.48, head: true },
    prof: { noseH: 1.56, hoodH: 1.6, beltH: 1.64, deckH: 1.5, tailH: 2.6, ws: 2.92, rf: 2.72, rr: 1.74, rg: 1.68, cabH: 2.92, seatY: 1.1 },
    lamp: { hs: 'twinRoundBlack', ts: 'roundPair', gs: 'truckMesh', f: { hw: 0.46, hh: 0.24, hy: 0.48, turn: 'out', drl: 'none' }, r: { k: 'bumper' }, g: { w: 0.27, h: 0.56, y: 0.12 } },
  },
};
// resolve variants
for (const k in CAR_TYPES) {
  const t = CAR_TYPES[k]; t.key = k;
  if (t.base) { const b = CAR_TYPES[t.base]; for (const p in b) if (t[p] === undefined && p !== 'key' && p !== 'price') t[p] = b[p]; }
}
// traffic mix (weights)
export const TRAFFIC_MIX = [['sedan', 22], ['hatch', 16], ['suv', 13], ['taxi', 10], ['van', 6], ['muscle', 4], ['sports', 3], ['coupe', 5], ['luxury', 4], ['wagon', 6], ['ev', 6], ['classic', 2], ['minivan', 7], ['pickup', 8], ['pickupS', 5], ['boxtruck', 4], ['dump', 2]];
export const PARKED_MIX = [['sedan', 18], ['hatch', 15], ['suv', 13], ['muscle', 8], ['sports', 8], ['van', 4], ['super', 3], ['taxi', 3], ['coupe', 6], ['luxury', 5], ['wagon', 6], ['ev', 6], ['classic', 4], ['minivan', 6], ['pickup', 6], ['pickupS', 5]];
// what the dealership sells, cheapest first
export const DEALER_LIST = ['hatch', 'pickupS', 'taxi', 'sedan', 'wagon', 'minivan', 'van', 'pickup', 'suv', 'boxtruck', 'coupe', 'ev', 'dump', 'muscle', 'luxury', 'classic', 'sports', 'super'];

export const WANTED = {
  thresholds: [0, 12, 55, 130, 240, 400], // heat needed for 1..5 stars
  copsPerStar: [0, 1, 2, 3, 4, 6],
  loseTime: [0, 9, 13, 17, 22, 28],        // seconds unseen to drop a star
};

// police career: ranks by arrests, pay multiplier, and which cruiser the rank gets
export const POLICE_RANKS = [
  { name: 'Officer', at: 0, pay: 1, car: 'police' },
  { name: 'Senior Officer', at: 5, pay: 1.25, car: 'police' },
  { name: 'Sergeant', at: 12, pay: 1.5, car: 'policeSUV' },
  { name: 'Lieutenant', at: 25, pay: 1.8, car: 'policeSUV' },
  { name: 'Captain', at: 45, pay: 2.2, car: 'policeSUV' },
];

export const DEFAULT_SETTINGS = {
  quality: 'high', time: 'dynamic', dayMinutes: 24, volume: 0.8, music: 0.45, sfx: 1,
  sens: 1, invertY: false, units: 'mph', fov: 62, showFps: false, radio: true, touch: 'auto',
};

// Weapons (teen rating: hits knock people out, nobody gets hurt for real). dmg is per bullet/pellet against 100 health.
export const WEAPONS = {
  fists: { name: 'Fists', key: 'fists', slot: 1, melee: true, dmg: 24, range: 1.5, rate: 0.42, price: 0 },
  bat: { name: 'Baseball Bat', key: 'bat', slot: 2, melee: true, dmg: 48, range: 2.0, rate: 0.62, price: 150, desc: 'Home-run swing. Knocks props flying.' },
  pistol: { name: 'Pistol', key: 'pistol', slot: 3, dmg: 28, rate: 0.26, spread: 0.012, range: 130, mag: 12, start: 48, ammo: [24, 60], price: 350, auto: false, desc: 'Reliable sidearm. 12-round magazine.' },
  smg: { name: 'SMG', key: 'smg', slot: 4, dmg: 15, rate: 0.075, spread: 0.032, range: 90, mag: 30, start: 120, ammo: [60, 90], price: 900, auto: true, desc: 'Sprays fast. Great up close.' },
  shotgun: { name: 'Pump Shotgun', key: 'shotgun', slot: 5, dmg: 14, pellets: 8, rate: 0.85, spread: 0.075, range: 45, mag: 6, start: 24, ammo: [12, 80], price: 1250, auto: false, desc: 'Eight pellets per shell. Short range.' },
  rifle: { name: 'Assault Rifle', key: 'rifle', slot: 6, dmg: 25, rate: 0.11, spread: 0.014, range: 170, mag: 30, start: 120, ammo: [60, 140], price: 2200, auto: true, desc: 'Accurate and full-auto. The big one.' },
};
export const WEAPON_ORDER = ['fists', 'bat', 'pistol', 'smg', 'shotgun', 'rifle'];
export const ARMOR_PRICE = 250;
