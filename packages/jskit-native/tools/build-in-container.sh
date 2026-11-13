#!/usr/bin/env bash
#
# Builds and verifies the Linux binary inside a glibc 2.28 container, which
# is how the release workflow builds every Linux target.
#
# A shared library demands the newest glibc symbol version it was linked
# against, so a binary built on a current distribution fails to load on an
# older one, and @eslint/jskit silently falls back to TypeScript there.
# Node.js 22 supports Linux down to glibc 2.28, so the binary is linked
# against exactly that: Debian buster's. The script then checks the result
# and fails if any symbol needs more.
#
# Run it from the repository root, inside a `buildpack-deps:buster` container
# with the checkout mounted. It expects:
#
#   NODE_VERSION  the Node.js release to install, e.g. 22.23.5
#   NODE_ARCH     its tarball architecture: x64, arm64, or armv7l
#   NODE_SHA256   the tarball's SHA-256, from that release's SHASUMS256.txt
#   RUST_HOST     the Rust host triple matching the container
#   TARGET        the npm target, e.g. linux-x64-gnu

set -euo pipefail

readonly GLIBC_FLOOR="2.28"
readonly tarball="node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz"

curl --proto "=https" --tlsv1.2 -fsSLO \
	"https://nodejs.org/dist/v${NODE_VERSION}/${tarball}"
echo "${NODE_SHA256}  ${tarball}" | sha256sum --check --strict -
tar --extract --xz --file "${tarball}" --directory /usr/local \
	--strip-components=1 --no-same-owner
rm "${tarball}"

curl --proto "=https" --tlsv1.2 -fsSL https://sh.rustup.rs |
	sh -s -- -y --profile minimal --default-toolchain stable \
		--default-host "${RUST_HOST}"
# shellcheck source=/dev/null
. "${HOME}/.cargo/env"

node --version
rustc --version

# `npm ci` also runs the root `prepare`, which builds the toolkit's dist/ —
# the parity tests load the package through it.
npm ci
npm run build --workspace=@eslint/jskit-native

readonly binary="packages/jskit-native/npm/${TARGET}/jskit.${TARGET}.node"
readonly needed="$(objdump -T "${binary}" | grep -o 'GLIBC_[0-9.]*' |
	sed 's/GLIBC_//' | sort -uV | tail -n 1)"

if [ "$(printf '%s\n%s\n' "${needed}" "${GLIBC_FLOOR}" | sort -V | tail -n 1)" != "${GLIBC_FLOOR}" ]; then
	echo "${binary} needs glibc ${needed}, above the ${GLIBC_FLOOR} floor" >&2
	exit 1
fi

echo "${binary} needs glibc ${needed} (floor ${GLIBC_FLOOR})"

npm test --workspace=@eslint/jskit-native
