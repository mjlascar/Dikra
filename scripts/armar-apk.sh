#!/usr/bin/env bash
# Arma la web, la mete en el APK y compila. Uso: scripts/armar-apk.sh [release|debug]
#
# Acá compila sin internet (--offline): el plugin de Android 9.4.1 y Gradle 9.8.1 ya están en la
# caché de esta compu (los bajó Slowtown). El JDK 21 de esta compu es sólo el runtime: se compila
# con el 26. En CI (CI=true) baja lo que necesite y usa el JDK que puso setup-java.
#
# Sin DIKRA_KEYSTORE sale firmado con la clave de depuración de la compu: sirve para el emulador.
# Nunca instalar ese APK en un teléfono que tiene la versión de GitHub: la firma es otra, y para
# cambiarla hay que desinstalar, que borra los viajes.
set -euo pipefail
cd "$(dirname "$0")/.."

tipo=${1:-release}
node --disable-warning=ExperimentalWarning scripts/armar-web.mjs

assets=android/app/src/main/assets
rm -rf "$assets/web"
mkdir -p "$assets"
cp -r dist/web "$assets/web"
# En el APK no hay modo simulado ni service worker: la app viene adentro.
rm -f "$assets/web/datos/demo.json" "$assets/web/sw.js"

if [ "${CI:-}" = "true" ]; then
  (cd android && ./gradlew --no-daemon --console=plain "assemble${tipo^}")
else
  (cd android && JAVA_HOME=${JAVA_HOME:-/usr/lib/jvm/java-26-openjdk} \
    ./gradlew --no-daemon --offline --console=plain "assemble${tipo^}")
fi

apk=android/app/build/outputs/apk/$tipo/app-$tipo.apk
mkdir -p dist
cp "$apk" "dist/Dikra-$tipo.apk"
echo "Listo: dist/Dikra-$tipo.apk ($(du -h "dist/Dikra-$tipo.apk" | cut -f1))"
