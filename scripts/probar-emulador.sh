#!/usr/bin/env bash
# La prueba de punta a punta en el emulador de Android 12 (el AVD de Slowtown, en solo lectura:
# no toca su estado). Instala la versión de depuración, guarda el terreno, sale hacia ahí, manda
# la app al fondo con la pantalla apagada y le da al GPS el final del viaje de prueba por la Ruta
# 226. Tiene que cortar sola al llegar, avisar, y la página tiene que guardar el viaje.
#
# Uso: scripts/probar-emulador.sh
# Levanta el emulador si no hay uno (unos 2 GB de RAM: mirar `free -m` antes). Deja capturas en
# dist/prueba-*.png.
set -euo pipefail
cd "$(dirname "$0")/.."

SDK=${ANDROID_HOME:-$HOME/Android/Sdk}
ADB="$SDK/platform-tools/adb"
fallas=0
bien() { echo "✓ $*"; }
mal() { echo "✗ $*"; fallas=$((fallas + 1)); }
pagina() { node scripts/cdp.mjs "$1"; }
conectar() {
  local pid
  pid=$("$ADB" shell pidof app.dikra | tr -d '\r')
  "$ADB" forward tcp:9333 "localabstract:webview_devtools_remote_$pid" >/dev/null
}
despertar() {
  "$ADB" shell input keyevent KEYCODE_WAKEUP
  "$ADB" shell wm dismiss-keyguard >/dev/null 2>&1 || true
}

# ---- el emulador
if ! "$ADB" devices | grep -q '^emulator'; then
  echo "Levantando el emulador (sin ventana, en solo lectura)…"
  "$SDK/emulator/emulator" -avd slowtown-api31 -read-only -no-snapshot -no-window -no-audio \
    -no-boot-anim -memory 1536 -gpu swiftshader_indirect >/dev/null 2>&1 &
fi
"$ADB" wait-for-device
until [ "$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ]; do sleep 2; done
despertar

# ---- la app, de cero
[ -f dist/Dikra-debug.apk ] || scripts/armar-apk.sh debug
"$ADB" uninstall app.dikra >/dev/null 2>&1 || true
"$ADB" install -t dist/Dikra-debug.apk >/dev/null
"$ADB" shell pm grant app.dikra android.permission.ACCESS_FINE_LOCATION
"$ADB" shell pm grant app.dikra android.permission.ACCESS_COARSE_LOCATION
"$ADB" shell cmd location set-location-enabled true

# El viaje: los últimos 200 puntos del de prueba (unos 3 km de Ruta 226 y la llegada), uno de cada
# dos, uno por segundo. geo fix pide la longitud primero, y la velocidad en nudos al final (como
# un GPS de verdad; sin ella el emulador manda 0).
mapfile -t RUTA < <(python3 -c "
import json, math
d = json.load(open('web/datos/demo.json'))
pts = d['puntos'][-200::2]
for a, b in zip(pts, pts[1:] + pts[-1:]):
    k = math.cos(math.radians(a[1]))
    m = math.hypot((b[1] - a[1]) * 110574, (b[2] - a[2]) * 111320 * k)
    print(a[2], a[1], 10, 8, round(m * 1.943844, 1))")
read -r LA_D LO_D < <(python3 -c "import json; print(*json.load(open('web/datos/demo.json'))['llegada'])")
# shellcheck disable=SC2086
"$ADB" emu geo fix ${RUTA[0]} >/dev/null

"$ADB" shell am start -W -n app.dikra/.MainActivity >/dev/null
sleep 4
conectar

# ---- guardar el terreno y salir hacia ahí
pagina "(async () => {
  const b = await import('./src/base.js');
  await b.guardarLugar({ id: 'terreno', nombre: 'Terreno', la: $LA_D, lo: $LO_D, radio: 100, destino: true });
  location.hash = '#/';
  location.reload();
  return 'ok';
})()" >/dev/null
sleep 4
"$ADB" exec-out screencap -p > dist/prueba-inicio.png
pagina "document.querySelector('.salir').click(), 'ok'" >/dev/null
sleep 4
id=$(pagina "JSON.parse(DikraNativo.estado()).id" | tr -d '"')
if [ -n "$id" ] && [ "$id" != null ]; then bien "empezó a grabar ($id)"; else mal "no empezó a grabar"; fi
if [ "$(pagina "!!document.querySelector('.reloj')")" = true ]; then bien "la página muestra la grabación"; else mal "la página no pasó a la pantalla de grabación"; fi
if "$ADB" shell dumpsys notification --noredact | grep -q 'Grabando → Terreno'; then
  bien "aviso fijo «Grabando → Terreno»"
else
  mal "falta el aviso de grabando"
fi
"$ADB" exec-out screencap -p > dist/prueba-grabando.png

# ---- al fondo, con la pantalla apagada, a manejar
"$ADB" shell input keyevent KEYCODE_HOME
"$ADB" shell input keyevent KEYCODE_SLEEP
for p in "${RUTA[@]:1}"; do
  # shellcheck disable=SC2086
  "$ADB" emu geo fix $p >/dev/null
  sleep 1
done
sleep 3

meta=$("$ADB" shell run-as app.dikra cat "files/viajes/$id.json" 2>/dev/null || true)
if grep -q '"motivo":"llegada"' <<<"$meta"; then bien "cortó sola al llegar, con la pantalla apagada"; else mal "no cortó al llegar: $meta"; fi
puntos=$("$ADB" shell run-as app.dikra cat "files/viajes/$id.csv" 2>/dev/null | wc -l)
if [ "$puntos" -gt 50 ]; then bien "grabó $puntos puntos en segundo plano"; else mal "grabó sólo $puntos puntos"; fi
if "$ADB" shell dumpsys notification --noredact | grep -q 'Llegaste a Terreno'; then bien "avisó «Llegaste a Terreno»"; else mal "no avisó la llegada"; fi
if "$ADB" shell dumpsys notification --noredact | grep -q 'Grabando → Terreno'; then mal "el aviso de grabando quedó puesto"; else bien "sacó el aviso de grabando"; fi

# ---- volver a la app: la página guarda el viaje
despertar
"$ADB" shell am start -W -n app.dikra/.MainActivity >/dev/null
sleep 4
conectar
viaje=$(pagina "(async () => {
  const b = await import('./src/base.js');
  const v = (await b.viajes())[0];
  return v ? [v.estado, v.motivo, v.resumen && v.resumen.corte, v.resumen && v.resumen.destinoId, v.resumen && Math.round(v.resumen.distancia)].join(' ') : 'nada';
})()" | tr -d '"')
read -r est mot cor des dis <<<"$viaje"
if [ "$est $mot $cor $des" = "listo llegada llegada terreno" ]; then
  bien "la página guardó el viaje: $dis m hasta la llegada"
else
  mal "la página no guardó bien el viaje: $viaje"
fi
"$ADB" exec-out screencap -p > dist/prueba-vuelta.png
pagina "location.hash = '#/viaje/$id', 'ok'" >/dev/null
sleep 3
"$ADB" exec-out screencap -p > dist/prueba-viaje.png

echo
if [ "$fallas" -eq 0 ]; then echo "Todo bien. Capturas en dist/prueba-*.png"; else echo "$fallas fallas"; exit 1; fi
