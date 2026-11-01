"""Arma los viajes de prueba por calles de verdad: web/datos/demo.json.

Los usa el GPS de mentira (`?simular=20` en el navegador) y la prueba del emulador. Son los dos
caminos del ejemplo de Marcos, desde la punta norte de Bronzini (una esquina pública, no la casa
de nadie) hasta el barrio Colinas Verdes:

- `champagnat`: por las calles más cortas hasta Constitución, y Constitución → Champagnat → Luro
  → Ruta 226. En OSM, la punta norte de Champagnat se llama Monseñor Zabala.
- `bronzini`: Bronzini → Luro → Ruta 226.

Cada uno a 1 punto por segundo, con semáforos en algunas esquinas grandes (al azar, repetible).
"""
import heapq
import json
import math
import os
import random

AQUI = os.path.dirname(os.path.abspath(__file__))
CRUDOS = os.path.join(AQUI, 'crudos')
SALIDA = os.path.join(AQUI, '..', 'web', 'datos', 'demo.json')
COLINAS = (-37.8899847, -57.8250743)            # el barrio en OSM (Nominatim), no un terreno

with open(os.path.join(CRUDOS, 'osm_calles.json')) as f:
    VIAS = [e for e in json.load(f)['elements'] if e.get('geometry')]


def dist(a, b):
    k = math.cos(math.radians(a[0]))
    return math.hypot((a[0] - b[0]) * 110574, (a[1] - b[1]) * 111320 * k)


def armar_grafo():
    """Todas las calles como grafo. Los nodos son coordenadas: en las esquinas, OSM comparte el
    nodo entre las dos calles. Cada arista sabe de qué calle es."""
    g = {}
    for e in VIAS:
        nombre = e['tags'].get('name')
        pts = [(p['lat'], p['lon']) for p in e['geometry']]
        for a, b in zip(pts, pts[1:]):
            d = dist(a, b)
            g.setdefault(a, []).append((b, d, nombre))
            g.setdefault(b, []).append((a, d, nombre))
    return g


G = armar_grafo()


def nodos(nombre):
    return {n for n, aristas in G.items() if any(c == nombre for _, _, c in aristas)}


def caminos(desde, preferida):
    """Lo más corto desde `desde`, prefiriendo una calle: andar por ella (o por una rotonda o un
    empalme sin nombre) cuesta lo que mide; por cualquier otra, diez veces más. Así las rotondas
    que parten una avenida en OSM no traban el camino. Con `None`, todas cuestan lo mismo."""
    costo, previo, cola = {desde: 0.0}, {}, [(0.0, desde)]
    while cola:
        d, u = heapq.heappop(cola)
        if d > costo[u]:
            continue
        for v, w, calle in G[u]:
            libre = preferida is None or calle == preferida or calle is None or calle.startswith('Rotonda')
            nd = d + (w if libre else 10 * w)
            if nd < costo.get(v, math.inf):
                costo[v], previo[v] = nd, u
                heapq.heappush(cola, (nd, v))
    return costo, previo


def rastro(previo, hasta):
    out = [hasta]
    while out[-1] in previo:
        out.append(previo[out[-1]])
    return out[::-1]


def ruta(calles, desde, hasta):
    """Por las calles en orden, cada una hasta donde empieza la siguiente; la última, hasta lo más
    cerca de `hasta`. `None` es «por cualquier calle»."""
    actual = min(nodos(calles[0]) if calles[0] else G, key=lambda n: dist(n, desde))
    camino = [actual]
    for i, calle in enumerate(calles):
        costo, previo = caminos(actual, calle)
        if i + 1 < len(calles):
            siguiente = [n for n in nodos(calles[i + 1]) if n in costo and n != actual]
            if not siguiente:
                raise SystemExit(f'No se llega de {calle} a {calles[i + 1]}')
            fin = min(siguiente, key=lambda n: costo[n])
        else:
            fin = min(costo, key=lambda n: dist(n, hasta))
        camino += rastro(previo, fin)[1:]
        actual = fin
    return camino


# nodos donde se cruzan calles grandes: ahí puede haber semáforo
GRANDES = {'primary', 'secondary', 'tertiary', 'trunk'}
cuenta = {}
for e in VIAS:
    if e['tags'].get('highway') in GRANDES:
        for p in e['geometry']:
            n = (p['lat'], p['lon'])
            cuenta[n] = cuenta.get(n, 0) + 1


def manejar(camino, semilla):
    """Un punto por segundo: 40 km/h en la ciudad, 75 en la ruta, y algún semáforo."""
    azar = random.Random(semilla)
    pts, s, ultimo_semaforo = [], 0, -1e9
    recorrido = 0.0
    for a, b in zip(camino, camino[1:]):
        if cuenta.get(a, 0) >= 2 and recorrido - ultimo_semaforo > 400 and azar.random() < 0.35:
            for _ in range(azar.randint(15, 45)):
                pts.append([s, round(a[0], 6), round(a[1], 6)])
                s += 1
            ultimo_semaforo = recorrido
        ruta_abierta = a[1] < -57.64
        v = 21 if ruta_abierta else 11
        d = dist(a, b)
        pasos = max(1, round(d / v))
        for k in range(pasos):
            f = k / pasos
            pts.append([s, round(a[0] + (b[0] - a[0]) * f, 6), round(a[1] + (b[1] - a[1]) * f, 6)])
            s += 1
        recorrido += d
    final = camino[-1]
    for _ in range(30):                          # ya llegó: un rato quieto
        pts.append([s, round(final[0], 6), round(final[1], 6)])
        s += 1
    return pts, recorrido


inicio = max(nodos('Teodoro Bronzini'), key=lambda n: n[0])     # la punta norte
viajes = {}
for clave, calles in {
    'champagnat': [None, 'Avenida Constitución', 'Avenida Monseñor Zabala', 'Avenida Champagnat', 'Avenida Pedro Luro', 'Ruta Nacional 226'],
    'bronzini': ['Teodoro Bronzini', 'Avenida Pedro Luro', 'Ruta Nacional 226'],
}.items():
    camino = ruta(calles, inicio, COLINAS)
    pts, metros = manejar(camino, semilla=len(clave))
    viajes[clave] = {'calles': calles, 'puntos': pts}
    print(clave, len(camino), 'nodos', '%.1f km' % (metros / 1000), '%.0f min' % (pts[-1][0] / 60))

fin = viajes['champagnat']['puntos'][-1]
datos = {
    'nota': 'Viajes de prueba por calles de OpenStreetMap (© colaboradores de OSM, ODbL).',
    'salida': [round(inicio[0], 6), round(inicio[1], 6)],
    'llegada': [fin[1], fin[2]],
    # El GPS de mentira recorre el primero.
    'puntos': viajes['champagnat']['puntos'],
    'viajes': viajes,
}
with open(SALIDA, 'w') as f:
    json.dump(datos, f, separators=(',', ':'))
print('listo', os.path.relpath(SALIDA), '%.0f KB' % (os.path.getsize(SALIDA) / 1e3))
