# Brickstorm for Android

`dist/Brickstorm.apk` is a signed release build (about 60 KB) that you can sideload on Android 7.0+ (API 24 to 35).

## Install

1. Copy `dist/Brickstorm.apk` to the phone, or download it from GitHub on the phone.
2. Open it, and allow "Install unknown apps" for your browser or file manager when Android asks.

Or, with USB debugging on: `adb install -r dist/Brickstorm.apk`

## What the app does

- **Fully offline, no permissions to worry about.** The only permission is `VIBRATE` for haptics. There is no `INTERNET` permission: the game is served from inside the APK on a virtual `https://appassets.androidplatform.net` origin, and every other request is blocked.
- **Tiny and fast.** A plain `Activity` and `WebView`, with no AndroidX or other libraries. The game is minified (about 70 KB down to 54 KB), the dex is built with `d8 --release`, and the APK is zip-aligned and signed with v1, v2 and v3 signatures.
- **Full screen.** Immersive mode hides the status and navigation bars, and the HUD stays clear of camera notches. Portrait is locked and the screen stays on while the game is open. There's no white flash on launch: the theme and Android 12+ splash screen use the game's background colour.
- **Stable layout.** The system font size and zoom are ignored, so the layout can't break, and there is no overscroll glow, long-press menu or text selection.
- **Battery friendly.** When the app goes to the background, the game pauses, audio is suspended and WebView timers stop.
- **Back button.** It closes dialogs and pauses or resumes the game. On the main menu, press it twice to exit.
- **Saves.** Progress, coins and in-progress runs persist in WebView storage. If Android kills the renderer, the app recovers on its own.

## Rebuild

```sh
sdkmanager "platforms;android-35" "build-tools;35.0.0"
ANDROID_HOME=/path/to/sdk ./build.sh                  # -> dist/Brickstorm.apk
VERSION_CODE=2 VERSION_NAME=1.0.1 ./build.sh          # for an update
```

You need JDK 17+ and the Android SDK, plus Node.js (`npx`) for minification. Without Node it packages the game unminified. No Gradle is needed.

The first build creates `keystore/release.jks` and `keystore/keystore.properties`. Both are git-ignored. **Back them up:** Android only installs an update over an existing install when it is signed with the same key. To keep signing future builds with the key that signed the committed APK, put that keystore in `keystore/`.
