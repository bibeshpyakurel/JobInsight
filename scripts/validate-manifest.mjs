/**
 * Validates manifest.json for a Chrome MV3 extension.
 *
 * Checks the manifest parses, declares MV3, and that every file it references
 * (service worker, content scripts, popup, icons, web-accessible resources)
 * actually exists in the repository. A manifest naming a file that was renamed
 * or deleted loads as a broken extension, and nothing else catches it.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];

let manifest;
try {
  manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8'));
} catch (err) {
  console.error(`manifest.json does not parse: ${err.message}`);
  process.exit(1);
}

if (manifest.manifest_version !== 3) {
  problems.push(`manifest_version is ${manifest.manifest_version}, expected 3`);
}
for (const field of ['name', 'version']) {
  if (!manifest[field]) problems.push(`missing required field: ${field}`);
}

/** Record a problem if a referenced path is not in the repo. */
const mustExist = (rel, why) => {
  if (rel && !existsSync(resolve(root, rel))) {
    problems.push(`${why} references "${rel}", which does not exist`);
  }
};

mustExist(manifest.background?.service_worker, 'background.service_worker');
mustExist(manifest.action?.default_popup, 'action.default_popup');

for (const [size, path] of Object.entries(manifest.icons ?? {})) {
  mustExist(path, `icons.${size}`);
}
for (const [size, path] of Object.entries(manifest.action?.default_icon ?? {})) {
  mustExist(path, `action.default_icon.${size}`);
}
for (const [i, cs] of (manifest.content_scripts ?? []).entries()) {
  for (const f of cs.js ?? []) mustExist(f, `content_scripts[${i}].js`);
  for (const f of cs.css ?? []) mustExist(f, `content_scripts[${i}].css`);
  if (!cs.matches?.length) problems.push(`content_scripts[${i}] has no matches`);
}
for (const [i, war] of (manifest.web_accessible_resources ?? []).entries()) {
  for (const f of war.resources ?? []) {
    if (!f.includes('*')) mustExist(f, `web_accessible_resources[${i}].resources`);
  }
}

if (problems.length) {
  console.error(`manifest.json: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  x ${p}`);
  process.exit(1);
}

console.log(
  `manifest.json OK — MV3, ${manifest.name} v${manifest.version}, all referenced files present`,
);
