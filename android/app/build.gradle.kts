plugins {
    id("com.android.application")
}

// La versión la pone CI: el nombre (0.1.<corrida>) y el número, que es la corrida y crece siempre.
// Compilado acá, sale 0.1.0-local con número 1: sirve para el emulador, no para el teléfono.
val codigo = System.getenv("DIKRA_VERSION_CODE")?.toIntOrNull() ?: 1
val nombre = System.getenv("DIKRA_VERSION_NAME") ?: "0.1.0-local"
// La clave estable (scripts/firma.sh). Sin ella se firma con la de depuración de la compu.
val clave = System.getenv("DIKRA_KEYSTORE")

android {
    namespace = "app.dikra"
    compileSdk = 37

    defaultConfig {
        applicationId = "app.dikra"
        minSdk = 29
        targetSdk = 37
        versionCode = codigo
        versionName = nombre
    }

    signingConfigs {
        if (clave != null) {
            create("estable") {
                storeFile = file(clave)
                storePassword = System.getenv("DIKRA_KEYSTORE_PASSWORD")
                keyAlias = "dikra"
                keyPassword = System.getenv("DIKRA_KEYSTORE_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName(if (clave != null) "estable" else "debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    lint {
        // El chequeo de lint de las release baja herramientas aparte.
        checkReleaseBuilds = false
    }
}
