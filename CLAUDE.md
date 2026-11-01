# Dikra — notas para trabajar en este repo

App para medir cuánto tarda cada camino de Mar del Plata al terreno de Colinas Verdes, por tramos.
La usa Marcos en su Galaxy S10e (APK) y Gero, su hermano, en un iPhone (la web). Cada teléfono
tiene sus datos: no hay servidor. Todo en castellano: textos, comentarios, commits e
identificadores.

## Cómo verificar un cambio

```bash
npm run check                  # tipos + pruebas de la lógica + armar la web
scripts/armar-apk.sh debug     # compila acá, sin internet, con el JDK 26 y la caché de Gradle
scripts/probar-emulador.sh     # punta a punta en Android 12: graba en segundo plano y corta al llegar
```

La web se prueba con `python3 scripts/servir.py` y `http://127.0.0.1:5190/?simular=40`: un GPS
de mentira recorre `web/datos/demo.json` 40 veces más rápido (está en `.claude/launch.json`).

El emulador es el AVD `slowtown-api31`, en solo lectura (no toca el estado de Slowtown). Ocupa
unos 2 GB: con 6,8 GB en la compu, nunca compilar con el emulador prendido (`adb emu kill`).

## Cómo está armado

| Dónde | Qué |
| --- | --- |
| `web/src/viaje.ts` | La lógica: limpiar el GPS, salida, llegada, recorte, la vigía que corta. Probada en `pruebas/`. |
| `web/src/grabador.ts` | Quién graba: el servicio de Android (por `window.DikraNativo`), la página (iPhone) o el GPS de mentira. |
| `web/src/control.ts` | Empezar un viaje, guardarlo cuando el grabador corta, recalcular. Todo en una fila (`deAUno`). |
| `web/src/base.ts` | IndexedDB: viajes, puntos, lugares; el respaldo. |
| `web/src/mapa.ts` | El mapa en canvas, con las calles de `web/datos/calles.json`. |
| `web/src/pantallas/` | Grabar, Viajes, Lugares, Ajustes. |
| `android/.../Grabador.java` | El servicio en primer plano que graba el GPS y corta solo. |
| `android/.../Vigia.java` | Las mismas reglas de corte que `crearVigia` en `viaje.ts`. |
| `android/.../MainActivity.java` | El WebView con la web y el puente `DikraNativo`. |
| `android/.../Actualizador.java` | Se actualiza sola desde el release `apk-latest`. |
| `datos/` | Calles de OSM (`osm_mdp.py`, `calles_mdp.py`) y los viajes de prueba (`demo_ruta.py`). |

## Decisiones que no conviene deshacer sin pensarlo

**Se guarda el recorrido entero.** El resumen (salida, llegada, distancia) se calcula encima y
se rehace (`recalcularTodo`) cuando cambian los lugares. Los pasos 2 y 3 (cortes y
comparaciones) también van encima de los puntos: nada se calcula una sola vez y se tira.

**Las reglas de corte están dos veces:** `REGLAS`/`crearVigia` en `viaje.ts` y `Vigia.java`. El
APK corta con la de Java mientras graba; el resumen sale de la de TypeScript. Si cambia una,
cambia la otra.

**La llegada es el cruce del borde del círculo**, interpolado entre dos puntos, y hace falta haber
estado afuera (círculo + 50 m) antes: arrancar a grabar adentro del destino no es llegar. Un punto
suelto adentro es un salto del GPS. **La salida** es el último momento parado antes de alejarse
100 m: la espera en el auto no cuenta.

**La velocidad del GPS manda**, salvo que diga 0 con el auto andando en los dos tramos pegados al
punto: el emulador (y algún teléfono) la da siempre en 0, y todo el viaje parecía parado.

**El servicio arranca sólo con la app adelante**, al tocar un destino. Así alcanza el permiso de
ubicación «mientras se usa la app» (nada de ubicación todo el tiempo). La contracara: si Android
mata el proceso, no puede retomar; cierra el viaje con lo grabado y avisa.

**El servicio arranca un instante después del pedido.** `grabador.empezar` espera a que el nativo
diga que graba; si no, la pantalla de grabación preguntaba antes de tiempo y volvía a Inicio.

**El origen de la página en el APK es `https://appassets.androidplatform.net`.** Ahí vive la base
(IndexedDB): cambiarlo dejaría los viajes inalcanzables sin un solo error.

**La firma.** Paquete `app.dikra`, clave estable en `~/dikra-firma/` (fuera del repo; copia en el
pendrive de Marcos), huella pública en `scripts/firma.sha256`. CI firma con los secretos
`DIKRA_KEYSTORE_B64` y `DIKRA_KEYSTORE_PASSWORD` y sin ellos no publica. Nunca instalar en el
teléfono un APK compilado acá (va firmado con la clave de depuración): para volver a la de GitHub
habría que desinstalar, y eso borra los viajes.

**`version.json` del release `apk-latest` es `{codigo, nombre, sha256}`**, y lo leen las apps ya
instaladas (`Actualizador.java`). Si cambia el formato, dejan de enterarse de las versiones nuevas.
`codigo` es el número de corrida de CI y crece siempre.

**El repo es público.** Nunca commitear coordenadas de la casa, el trabajo o el terreno de nadie:
viven en la configuración de cada teléfono. Las pruebas usan avenidas y el barrio Colinas Verdes
de OSM.

**TypeScript sin compilador.** `scripts/armar-web.mjs` le saca los tipos con Node
(`stripTypeScriptTypes`) y cambia `.ts` por `.js` en los imports. Sólo vale lo que se puede borrar:
nada de `enum`, `namespace` ni parámetros de constructor con modificadores (`tsconfig` lo frena).
Las importaciones de tipos van con `type`.

**Sin dependencias en la app.** Ni en la web ni en Android (sin AndroidX ni Play Services: el GPS
es el `LocationManager` de Android). Las únicas de npm son para chequear: `typescript` y
`@types/node`. Antes de sumar cualquier paquete, auditarlo y contarle a Marcos.

**En OSM, las calles no siempre se llaman como las dice la gente:** la punta norte de Champagnat es
Monseñor Zabala, y la Rotonda del Monolito parte a Champagnat en dos. Al nombrar cortes por la
esquina (paso 2), dejar que se pueda cambiar el nombre.

## iPhone

La web graba sólo con la pantalla prendida y Dikra adelante (pide `wakeLock`). Si se va atrás, al
volver avisa cuánto no grabó. Si iOS descarta la página grabando, al abrirla sigue con el mismo
viaje si el último punto es de hace menos de 20 minutos. El service worker guarda la app entera
(anda sin señal) y una versión nueva espera a que se toque «Actualizar», nunca en medio de un viaje.

## Slowtown, en el S10e de Marcos

Dikra no tiene que estar entre las apps bloqueadas; su aviso de «Grabando» no va entre las fijas
que se esconden; si maneja de noche, va en lo que se abre en Bedtime. Con Slowtown activo, instalar
o actualizar necesita «Habilitar todo» un rato (los instaladores están bloqueados).
