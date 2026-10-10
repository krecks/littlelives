/**
 * Generates sample houses with the shipped config and content (web/public/content/housegen.json)
 * and writes them as small town files, one house each, for the simulation to check
 * (`cargo test -p sim-core --test generated_houses -- --ignored`, reading HOUSES).
 *
 * Run: node --experimental-strip-types tools/housegen/sample.ts out.json [houses per lot size]
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { generateHouse, type HouseGenConfig } from '../../web/src/game/housegen.ts';

const root = new URL('../../web/public/content/', import.meta.url);
const cfg = JSON.parse(readFileSync(new URL('housegen.json', root), 'utf8')) as HouseGenConfig;
const base = JSON.parse(readFileSync(new URL('base.json', root), 'utf8')) as { objects: { id: string; footprint?: [number, number] }[] };
const houses = JSON.parse(readFileSync(new URL('houses.json', root), 'utf8')) as { plot: { width: number; depth: number }; lotSizes: Record<string, { width: number; depth: number }> };
const footprint = (def: string) => base.objects.find((o) => o.id === def)?.footprint ?? (base.objects.some((o) => o.id === def) ? ([1, 1] as [number, number]) : undefined);

const out = process.argv[2] ?? 'houses.json';
const perSize = Number(process.argv[3] ?? 60);
const towns: unknown[] = [];
const stats = { tried: 0, made: 0, two: 0, rooms: new Map<number, number>() };
for (const [size, lot] of Object.entries(houses.lotSizes)) {
  for (let seed = 1; seed <= perSize; seed++) {
    stats.tried++;
    const h = generateHouse(cfg, footprint, lot, houses.plot, size, seed * 7919);
    if (!h) continue;
    stats.made++;
    if (h.upper) stats.two++;
    // Back on the lot (the layouts' frame is a medium lot's).
    const dx = Math.floor((lot.width - houses.plot.width) / 2);
    const depth = lot.depth;
    const moveDoor = (lift: number) => (d: { x: number; z: number; axis: string }) => ({ x: d.x + dx, z: d.z + lift, axis: d.axis });
    const walls = [
      ...h.walls.map(([a, b, c, d]) => [a + dx, b, c + dx, d]),
      ...(h.upper?.walls ?? []).map(([a, b, c, d]) => [a + dx, b + depth, c + dx, d + depth]),
    ];
    towns.push({
      size,
      seed: seed * 7919,
      name: h.name,
      description: h.description,
      town: {
        width: lot.width,
        depth,
        storeys: h.upper ? 2 : 1,
        walls,
        doors: [...h.doors.map(moveDoor(0)), ...(h.upper?.doors ?? []).map(moveDoor(depth))],
        windows: [...(h.windows ?? []).map(moveDoor(0)), ...(h.upper?.windows ?? []).map(moveDoor(depth))],
        objects: [...h.objects.map((o) => ({ ...o, x: o.x + dx })), ...(h.upper?.objects ?? []).map((o) => ({ ...o, x: o.x + dx, z: o.z + depth }))],
        plots: [{ name: 'Home', x: 0, z: 0, w: lot.width, d: depth, entry: h.spawns[0] && [h.spawns[0][0] + dx, h.spawns[0][1]] }],
        households: [{ name: 'Test', plot: 0, player: true }],
        sims: [],
      },
    });
  }
}
writeFileSync(out, JSON.stringify(towns));
console.log(`${stats.made} of ${stats.tried} houses made (${stats.two} with two storeys) → ${out}`);
for (const t of towns.slice(0, 8) as { size: string; name: string; description: string }[]) console.log(`  ${t.size}: ${t.name} — ${t.description}`);
