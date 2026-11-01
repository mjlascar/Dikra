// La misma versión del plugin de Android que Slowtown y el mapa de Tandil: ya está en la caché de
// Gradle de esta compu, así se compila sin bajar nada. El plugin 9.4.1 trae Kotlin adentro y pide
// el de Kotlin 2.2.10, que no está en la caché; se sube a 2.4.21, que sí está.
buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:2.4.21")
    }
}

plugins {
    id("com.android.application") version "9.4.1" apply false
}
