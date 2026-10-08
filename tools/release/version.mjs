#!/usr/bin/env node
// One version for the whole game: web/package.json (shown in the menu and Credits) and the Rust
// workspace (Cargo.toml) must always match.
//   node tools/release/version.mjs          prints the version, fails if the two differ (CI runs this)
//   node tools/release/version.mjs 0.3.0    sets both to 0.3.0 (then: cargo build, commit, git tag v0.3.0)
import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const pkgPath = new URL('web/package.json', root);
const cargoPath = new URL('Cargo.toml', root);
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const cargo = readFileSync(cargoPath, 'utf8');
const section = /(\[workspace\.package\][^[]*?\nversion = ")([^"]+)(")/;
const cargoVersion = cargo.match(section)?.[2];
if (!cargoVersion) throw new Error('No [workspace.package] version in Cargo.toml');

const next = process.argv[2];
if (!next) {
  if (pkg.version !== cargoVersion) {
    console.error(`Version mismatch: web/package.json ${pkg.version}, Cargo.toml ${cargoVersion}`);
    process.exit(1);
  }
  console.log(pkg.version);
  process.exit(0);
}
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(next)) throw new Error(`Not a version: ${next}`);
pkg.version = next;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
writeFileSync(cargoPath, cargo.replace(section, `$1${next}$3`));
console.log(`Version set to ${next} (web/package.json, Cargo.toml). Run cargo build to update Cargo.lock.`);
