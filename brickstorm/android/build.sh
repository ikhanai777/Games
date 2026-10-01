#!/usr/bin/env bash
# Builds a signed, release-optimized Brickstorm APK straight from the Android SDK tools.
# No Gradle, no AndroidX, no third-party libraries.
#
#   ANDROID_HOME=/path/to/sdk ./build.sh        -> dist/Brickstorm.apk
#
# Needs: JDK 17+, Android SDK "platforms;android-35" + "build-tools;35.0.0", node/npx (for minification).
# Signing: uses keystore/release.jks + keystore/keystore.properties, created on first run.
# Keep that keystore safe: future updates must be signed with the same key to install over this one.
set -euo pipefail
cd "$(dirname "$0")"

VERSION_CODE=${VERSION_CODE:-1}
VERSION_NAME=${VERSION_NAME:-1.0.0}
MIN_SDK=24
TARGET_SDK=35
SDK=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-/opt/android-sdk}}
BT="$SDK/build-tools/35.0.0"
PLATFORM="$SDK/platforms/android-$TARGET_SDK/android.jar"
[ -f "$PLATFORM" ] || { echo "Missing $PLATFORM (sdkmanager \"platforms;android-$TARGET_SDK\")"; exit 1; }
[ -x "$BT/aapt2" ] || { echo "Missing $BT (sdkmanager \"build-tools;35.0.0\")"; exit 1; }

B=build
rm -rf "$B"; mkdir -p "$B/assets/www" "$B/classes" "$B/dex" dist

echo "1/6 minify game"
if npx -y html-minifier-terser@7.2.0 --collapse-whitespace --remove-comments --minify-css true \
     --minify-js '{"compress":{"passes":2,"drop_console":false},"mangle":true,"format":{"comments":false}}' \
     -o "$B/assets/www/index.html" ../index.html 2>/dev/null; then
  echo "    $(wc -c < ../index.html) -> $(wc -c < "$B/assets/www/index.html") bytes"
else
  echo "    minifier unavailable, packaging unminified"; cp ../index.html "$B/assets/www/index.html"
fi

echo "2/6 compile resources"
"$BT/aapt2" compile --dir res -o "$B/res.zip"
"$BT/aapt2" link -o "$B/base.apk" -I "$PLATFORM" --manifest AndroidManifest.xml \
  --min-sdk-version $MIN_SDK --target-sdk-version $TARGET_SDK \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" \
  -A "$B/assets" "$B/res.zip"

echo "3/6 compile java"
javac -Xlint:-options -source 1.8 -target 1.8 -bootclasspath "$PLATFORM" -classpath "$BT/core-lambda-stubs.jar" -d "$B/classes" \
  $(find src -name '*.java')

echo "4/6 dex (release, min-api $MIN_SDK)"
"$BT/d8" --release --min-api $MIN_SDK --lib "$PLATFORM" --output "$B/dex" $(find "$B/classes" -name '*.class')

echo "5/6 package + zipalign"
cp "$B/base.apk" "$B/unsigned.apk"
(cd "$B/dex" && zip -q -9 ../unsigned.apk classes.dex)
"$BT/zipalign" -f -p 4 "$B/unsigned.apk" "$B/aligned.apk"

echo "6/6 sign (v1+v2+v3)"
mkdir -p keystore
if [ ! -f keystore/release.jks ]; then
  PASS=$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)
  keytool -genkeypair -keystore keystore/release.jks -alias brickstorm -keyalg RSA -keysize 4096 \
    -validity 10000 -storepass "$PASS" -keypass "$PASS" -dname "CN=Brickstorm" >/dev/null 2>&1
  printf 'storePassword=%s\nkeyAlias=brickstorm\n' "$PASS" > keystore/keystore.properties
  echo "    created keystore/release.jks (back it up!)"
fi
PASS=$(grep '^storePassword=' keystore/keystore.properties | cut -d= -f2-)
"$BT/apksigner" sign --ks keystore/release.jks --ks-key-alias brickstorm --ks-pass "pass:$PASS" \
  --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true \
  --out dist/Brickstorm.apk "$B/aligned.apk"
"$BT/apksigner" verify dist/Brickstorm.apk
rm -f dist/Brickstorm.apk.idsig
echo "done: dist/Brickstorm.apk ($(wc -c < dist/Brickstorm.apk) bytes)"
