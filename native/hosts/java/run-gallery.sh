#!/usr/bin/env bash
#
# Build and run the Java gallery.
#
# LWJGL is fetched rather than vendored, for the same reason the GLFW host
# fetches GLFW: nothing else in this repository needs anything installed, and a
# host that exists to demonstrate the ABI should not be the reason someone has
# to set up a package manager first. The jars land in build/java-deps and are
# reused after the first run.
#
#   hosts/java/run-gallery.sh                 open the window
#   hosts/java/run-gallery.sh --frames 60     render 60 frames and exit
#
# Needs a JDK 22+ (the foreign function API became final there) and libphoton
# built — cmake --preset debug && cmake --build build/debug.

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"

lwjgl_version="3.3.6"
deps="$root/build/java-deps"
classes="$root/build/java-gallery"

case "$(uname -s)" in
  Linux)  natives="natives-linux" ;;
  Darwin) natives="natives-macos" ;;
  *)      natives="natives-windows" ;;
esac
if [ "$(uname -m)" = "aarch64" ] || [ "$(uname -m)" = "arm64" ]; then
  natives="$natives-arm64"
fi

# The library the binding will dlopen. In preference order, and never the asan
# build: the JVM is not instrumented and dlopens the library, which puts ASan's
# runtime after the JVM's in the initial library list — ASan refuses to run at
# all in that arrangement.
library="${PHOTON_LIBRARY:-}"
if [ -z "$library" ]; then
  for build in release debug qt glfw hosts; do
    for candidate in "$root/build/$build/lib/libphoton.so" \
                     "$root/build/$build/lib/libphoton.dylib" \
                     "$root/build/$build/bin/photon.dll"; do
      if [ -f "$candidate" ]; then library="$candidate"; break 2; fi
    done
  done
fi
if [ -z "$library" ]; then
  echo "no libphoton found — build it first:" >&2
  echo "  cmake --preset debug && cmake --build build/debug" >&2
  echo "(or point PHOTON_LIBRARY at one; an asan build will not work)" >&2
  exit 1
fi
echo "using $library"

mkdir -p "$deps" "$classes"
fetch() {
  local artifact="$1" classifier="$2"
  local name="$artifact-$lwjgl_version${classifier:+-$classifier}.jar"
  if [ ! -f "$deps/$name" ]; then
    # To stderr: this function's stdout is captured as the jar's path.
    echo "fetching $name" >&2
    curl -sSLf -o "$deps/$name" \
      "https://repo1.maven.org/maven2/org/lwjgl/$artifact/$lwjgl_version/$name"
  fi
  echo "$deps/$name"
}

jars=""
for artifact in lwjgl lwjgl-glfw; do
  jars="$jars:$(fetch "$artifact" "")"
  jars="$jars:$(fetch "$artifact" "$natives")"
done
jars="${jars#:}"

javac -d "$classes" -cp "$jars" \
  "$root/bindings/java/photon/Photon.java" \
  "$here/PhotonGallery.java"

exec java \
  --enable-native-access=ALL-UNNAMED \
  -Dphoton.library="$library" \
  -cp "$classes:$jars" \
  PhotonGallery "$@"
