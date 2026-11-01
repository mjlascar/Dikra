# Dikra

Cuánto tardás en cada camino. Grabás el viaje desde donde estés, la app corta sola al llegar,
y con las semanas se ve qué camino conviene, por tramos: ¿hasta Luro conviene Bronzini, o
Constitución y Champagnat?

## Instalar

- **Android:** bajá [`Dikra.apk`](https://github.com/mjlascar/Dikra/releases/download/apk-latest/Dikra.apk)
  desde el teléfono y abrilo. Las versiones siguientes se instalan desde Dikra → Ajustes.
- **iPhone:** abrí [mjlascar.github.io/Dikra](https://mjlascar.github.io/Dikra/) en Safari y
  agregala a la pantalla de inicio (Compartir → «Agregar a inicio»).

## Cómo se usa

1. **Guardá el terreno** (y Casa, Trabajo…): estando ahí, «Estoy acá», o marcándolo en el mapa.
   Cada lugar es un círculo; los que son destino aparecen como botón.
2. **Tocá «→ Terreno» al salir.** En Android graba con la pantalla apagada y el teléfono en el
   bolsillo. En el iPhone, con Dikra abierta y la pantalla prendida: Apple no le da el GPS a una
   página que está atrás.
3. **Corta sola** al entrar al círculo del destino, si quedás quieto 15 minutos, o a las 4 horas.
   Si te olvidaste y siguió grabando, el viaje se recorta en la llegada; lo que esperaste en el
   auto antes de arrancar tampoco cuenta.
4. **Cada viaje** queda en el mapa, pintado según la velocidad (dónde se pierde tiempo), con lo
   que tardaste, la distancia y el tiempo parado.

Se guarda el recorrido entero de cada viaje, no sólo el tiempo: los tramos y las comparaciones
se calculan encima, así que lo que se agregue después vale también para los viajes viejos.

## Lo que viene

- **Paso 2, cortes:** marcar puntos de corte tocando el recorrido («Constitución y Champagnat»,
  con el nombre de la esquina sacado de las calles de OpenStreetMap); la app los reconoce sola en
  todos los viajes y sugiere cortes donde los caminos se separan.
- **Paso 3, comparar:** entre dos puntos, cada camino que hiciste, con el tiempo típico, cuántas
  veces y en qué franja horaria.

## Privacidad

Todo queda en el teléfono: no hay servidor ni cuentas. Ajustes → «Guardar respaldo» exporta un
archivo con los viajes y los lugares, y «Cargar un respaldo» los vuelve a poner (sólo agrega lo
que falta). El APK sólo usa internet para buscar actualizaciones en GitHub.

## Para desarrollar

```bash
npm install --ignore-scripts   # sólo TypeScript y los tipos de Node, para chequear
npm run check                  # tipos + pruebas + armar la web
python3 scripts/servir.py      # la web en http://127.0.0.1:5190 (?simular=20 maneja solo)
scripts/armar-apk.sh debug     # el APK de prueba, en dist/
scripts/probar-emulador.sh     # la prueba de punta a punta en el emulador de Android 12
```

Las calles y el mar salen de OpenStreetMap (© colaboradores de OpenStreetMap, ODbL):
`datos/osm_mdp.py` los baja y `datos/calles_mdp.py` arma `web/datos/calles.json`.
