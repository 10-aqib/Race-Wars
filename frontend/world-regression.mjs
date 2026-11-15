// Exercise the actual Environment module without starting another WebGL renderer.
import ts from 'typescript';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as THREE from 'three';

globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ({ fillRect() {} }) }) };
const source = fs.readFileSync(new URL('./src/game/Environment.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText;
const moduleSource = compiled.replace(/from ['"]three['"]/, `from '${import.meta.resolve('three')}'`);
const { Environment } = await import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`);
const world = new Environment(new THREE.Scene());
for (const z of [0, -1, -199, -201, -500, -1000, -3000, 500, 0]) {
  world.update(z);
  const bounds = world.getRoadBounds();
  assert.ok(bounds.minZ < z - 1000 && bounds.maxZ >= z, `Missing road at ${z}`);
}
world.update(-199);
const before = world.cityBlocks.map(block => block.position.z);
world.update(-201);
const after = world.cityBlocks.map(block => block.position.z);
assert.equal(before.filter((z, i) => z !== after[i]).length, 1, 'Only the section behind the camera should recycle');
assert.equal(before.filter((z, i) => z < -199 && z !== after[i]).length, 0, 'Buildings ahead must stay fixed');
console.log('PASS world continuity, coverage, reverse and restart');
fs.writeFileSync('world-regression-results.json', JSON.stringify({ date: new Date().toISOString(), status: 'PASS', checks: ['coverage', 'reverse', 'restart', 'visible building continuity'] }, null, 2));
