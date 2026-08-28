/**
 * @fileoverview Stamps the five platform packages into
 * `@eslint/jskit-native`'s `optionalDependencies`, each pinned to its exact
 * version, the way esbuild's publish step does.
 *
 * The checked-in package.json deliberately omits them: a pin can only point
 * at a published version, and the release pull request bumps every version
 * before anything is published, so a checked-in pin would break `npm ci` on
 * that very pull request. The release workflow runs this immediately before
 * `npm publish`, when the versions in `npm/`'s manifests are the ones about
 * to exist. The linked-versions plugin holds every version in the group
 * equal, and this script fails loudly if it finds otherwise.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL("..", import.meta.url));
const manifestPath = join(here, "package.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

const pins = {};

for (const target of readdirSync(join(here, "npm")).sort()) {
	const platformManifestPath = join(here, "npm", target, "package.json");

	// `build.mjs` creates a bare directory for a locally built binary on a
	// platform no package is checked in for; that is not a package to pin.
	if (!existsSync(platformManifestPath)) {
		continue;
	}

	const platformManifest = JSON.parse(
		readFileSync(platformManifestPath, "utf8"),
	);

	if (platformManifest.version !== manifest.version) {
		throw new Error(
			`${platformManifest.name} is at ${platformManifest.version} but ${manifest.name} is at ${manifest.version}; the versions are linked and must be equal.`,
		);
	}

	pins[platformManifest.name] = platformManifest.version;
}

manifest.optionalDependencies = pins;
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
	`[jskit-native] pinned ${Object.keys(pins).length} platform packages at ${manifest.version}`,
);
