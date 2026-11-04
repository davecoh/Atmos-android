# Atmos Android

Experimental Hebrew-language weather app. The Android app shows ECMWF / ICON / GFS forecasts via Open-Meteo, queries Israeli Meteorological Service (IMS) historical observations directly from the Android device, and offers a ChatGPT-powered conversational weather interface.

## Privacy and authentication
- IMS API token is entered locally and encrypted with Android Keystore. It is **never** committed to GitHub.
- ChatGPT login uses browser OAuth + PKCE; authorized tokens are stored encrypted using Android Keystore, not committed.
- A ChatGPT subscription is not a general-purpose OpenAI API credential. The experimental OAuth flow requires explicit account authorization and may have model / permission limits.

## Weather-station matching
When a requested place is not a station itself, the chat agent can try mapping the place to nearby stations using geographic coordinates from station metadata. It must report which actual station supplied observations; nearby station data are **not** direct measurements in the requested town, and terrain / elevation can make proximity a poor proxy. Missing chunks and HTTP 204 responses must not be interpreted as zero rainfall.

## Install
The GitHub Actions workflow builds a debug APK and publishes it as an experimental GitHub Release. For the newest successful build, open the repository's **Releases** page and download `app-debug.apk` directly. This beta has not passed production acceptance testing on real IMS measurements.

## Build
Android SDK 35, Java 17, Gradle 8.10.2. Run `gradle :app:assembleDebug`.
