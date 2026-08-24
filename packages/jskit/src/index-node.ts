/**
 * @fileoverview The Node.js entry point: the whole toolkit, accelerated by
 * the native implementation when it is available.
 *
 * This entry re-exports exactly the surface `src/index.ts` exports. The one
 * difference is the registration below: when `@eslint/jskit-native` is
 * installed and carries a binary for this platform, the buffer producers run
 * in Rust and everything downstream reads the same buffers it always did.
 * When the package is missing, failed to build, or `JSKIT_NATIVE=0` is set,
 * everything runs the TypeScript implementation instead — same buffers,
 * byte for byte, just slower.
 *
 * The browser bundle is built from `src/index.ts` and never loads this file,
 * which is what keeps `node:module` out of it.
 */

import { createRequire } from "node:module";
import { setNative, type NativeBinding } from "./parse/native.js";

try {
	if (process.env.JSKIT_NATIVE !== "0") {
		const require = createRequire(import.meta.url);
		const binding = require("@eslint/jskit-native") as NativeBinding | null;

		if (binding !== null) {
			setNative(binding);
		}
	}
} catch {
	// The native package is optional; the TypeScript implementation stands in.
}

export * from "./index.js";
