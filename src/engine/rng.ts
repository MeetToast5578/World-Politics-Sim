// Deterministic PRNG: xoshiro128** (32-bit ops only, so results are identical on every JS engine).
// Each subsystem draws from its own stream derived from (worldSeed, streamName), so adding draws in one
// system never shifts the random sequence seen by another.

export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

function splitmix32(a: number): () => number {
  return () => {
    a = (a + 0x9e3779b9) | 0;
    let z = a;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) >>> 0;
  };
}

export class Rng {
  s: Uint32Array;
  constructor(seed: number | Uint32Array) {
    if (seed instanceof Uint32Array) { this.s = seed.slice(); return; }
    const sm = splitmix32(seed >>> 0);
    this.s = new Uint32Array([sm(), sm(), sm(), sm()]);
    if (!(this.s[0] | this.s[1] | this.s[2] | this.s[3])) this.s[0] = 1; // all-zero state is a fixed point
  }
  static stream(worldSeed: number, name: string): Rng {
    return new Rng((Math.imul(worldSeed >>> 0, 0x9e3779b1) ^ hashString(name)) >>> 0);
  }
  nextU32(): number {
    const s = this.s;
    const result = Math.imul(rotl(Math.imul(s[1], 5), 7), 9) >>> 0;
    const t = s[1] << 9;
    s[2] ^= s[0]; s[3] ^= s[1]; s[1] ^= s[2]; s[0] ^= s[3];
    s[2] ^= t; s[3] = rotl(s[3], 11);
    return result;
  }
  /** Uniform in [0, 1) with 32 bits of resolution. */
  next(): number { return this.nextU32() / 4294967296; }
  int(n: number): number { return Math.floor(this.next() * n); }
  /** Standard normal via Box–Muller (one value per call; the pair is not cached to keep state = 4 words). */
  normal(): number {
    const u = 1 - this.next(); // (0, 1]
    const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
}

function rotl(x: number, k: number): number { return (x << k) | (x >>> (32 - k)); }
