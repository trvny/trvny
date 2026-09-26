// Replace ^/~ ranges in package.json with the exact versions already locked,
// so the pin changes spelling, not resolution.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
const pkgPath = join(dir, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const lock = JSON.parse(readFileSync(join(dir, 'package-lock.json'), 'utf8'));
for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
  for (const [name, spec] of Object.entries(pkg[field] ?? {})) {
    if (!/^[\^~]/.test(spec)) continue;
    const locked = lock.packages?.[`node_modules/${name}`]?.version;
    if (!locked) throw new Error(`${dir}: ${name} is not in package-lock.json`);
    pkg[field][name] = locked;
    console.log(`${dir}: ${name} ${spec} -> ${locked}`);
  }
}
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
