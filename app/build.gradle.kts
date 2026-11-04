plugins { id("com.android.application") }
android { namespace = "il.atmos.weather"; compileSdk = 35
 defaultConfig { applicationId = "il.atmos.weather.gptbeta"; minSdk = 26; targetSdk = 35; versionCode = 1; versionName = "2.0-beta" }
 compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
}
dependencies { implementation("androidx.webkit:webkit:1.12.1") }