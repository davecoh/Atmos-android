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

## Automatic IMS token for a personal build

Never commit the IMS API token to the public repository. To provision a personal APK without typing it into the Android app:
1. In GitHub, go to **Settings → Secrets and variables → Actions → New repository secret**.
2. Set **Name** to `IMS_TOKEN` and paste your IMS token as **Secret**.
3. Go to **Actions → Build Android APK → Run workflow** (or push a commit).
4. In the successful run, download the **Atmos-Android-APK** artifact; install `app-debug.apk`.

The workflow creates `assets/ims-bootstrap.txt` in the GitHub Actions runner **only**, and the app imports that token into its Android Keystore on first startup. This build contains the token and **anyone who obtains this APK can extract the token**. For that reason, the workflow does **not publish a public GitHub Release** when the secret is configured. The regular no-secret APK is still built and released publicly for developers.

This is suitable only for a personal experimental build. For a shareable production app, keep the token on an authenticated backend proxy and provide the app with a tokenless API.
