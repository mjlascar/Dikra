"""Arma web/datos/calles.json (lo que dibuja el mapa) con lo que bajó osm_mdp.py.

Formato, pensado para que pese poco:
- Las coordenadas son enteros en cienmilésimas de grado (~1,1 m), contadas desde la esquina
  sudoeste del recuadro (`o`), y cada punto va como diferencia con el anterior.
- `calles`: [clase, nombre, x0, y0, dx1, dy1, ...]. Clase 3 rutas, 2 avenidas, 1 calles
  importantes, 0 el resto. Nombre: índice en `nombres`, o -1.
- `mar` y `agua`: anillos con el mismo formato, sin clase ni nombre.

Los datos son de OpenStreetMap (© colaboradores de OpenStreetMap, licencia ODbL): la app lo dice.
"""
import json
import math
import os

AQUI = os.path.dirname(os.path.abspath(__file__))
CRUDOS = os.path.join(AQUI, 'crudos')
SALIDA = os.path.join(AQUI, '..', 'web', 'datos', 'calles.json')
S, O, N, E = -38.12, -57.87, -37.86, -57.52      # el mismo recuadro que osm_mdp.py
Q = 1e-5
CLASE = {
    'motorway': 3, 'motorway_link': 3, 'trunk': 3, 'trunk_link': 3,
    'primary': 2, 'primary_link': 2, 'secondary': 2, 'secondary_link': 2,
    'tertiary': 1, 'tertiary_link': 1,
}
KX = math.cos(math.radians((S + N) / 2)) * 111320
KY = 110574


def leer(nombre):
    with open(os.path.join(CRUDOS, nombre)) as f:
        return json.load(f)['elements']


def simplificar(pts, tol):
    """Douglas-Peucker en metros: saca los puntos que no cambian la forma más que `tol`."""
    if len(pts) < 3:
        return pts
    xy = [((lo - O) * KX, (la - S) * KY) for la, lo in pts]
    marca = [False] * len(pts)
    marca[0] = marca[-1] = True
    pila = [(0, len(pts) - 1)]
    while pila:
        a, b = pila.pop()
        (ax, ay), (bx, by) = xy[a], xy[b]
        dx, dy = bx - ax, by - ay
        largo2 = dx * dx + dy * dy
        peor, ip = -1.0, -1
        for i in range(a + 1, b):
            px, py = xy[i]
            if largo2 == 0:
                d = math.hypot(px - ax, py - ay)
            else:
                f = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / largo2))
                d = math.hypot(px - ax - f * dx, py - ay - f * dy)
            if d > peor:
                peor, ip = d, i
        if peor > tol:
            marca[ip] = True
            pila += [(a, ip), (ip, b)]
    return [p for p, m in zip(pts, marca) if m]


def codificar(pts):
    out, px, py = [], 0, 0
    for la, lo in pts:
        x, y = round((lo - O) / Q), round((la - S) / Q)
        if out and x == px and y == py:
            continue
        out += [x - px, y - py] if out else [x, y]
        px, py = x, y
    return out


def unir(tiras):
    """Une pedazos de línea que comparten una punta (la costa y las lagunas vienen cortadas)."""
    tiras = [list(t) for t in tiras if len(t) > 1]
    hechas = []
    while tiras:
        actual = tiras.pop()
        cambio = True
        while cambio:
            cambio = False
            for i, t in enumerate(tiras):
                if t[0] == actual[-1]:
                    actual += t[1:]
                elif t[-1] == actual[0]:
                    actual = t[:-1] + actual
                elif t[-1] == actual[-1]:
                    actual += t[::-1][1:]
                elif t[0] == actual[0]:
                    actual = t[::-1][:-1] + actual
                else:
                    continue
                tiras.pop(i)
                cambio = True
                break
        hechas.append(actual)
    return hechas


def area(anillo):
    a = 0.0
    for (la1, lo1), (la2, lo2) in zip(anillo, anillo[1:] + anillo[:1]):
        a += (lo1 * KX) * (la2 * KY) - (lo2 * KX) * (la1 * KY)
    return abs(a) / 2


def adentro(la, lo, margen=0.0):
    return S - margen <= la <= N + margen and O - margen <= lo <= E + margen


# ---------- calles
nombres, indice, calles = [], {}, []
for e in leer('osm_calles.json'):
    t, geo = e.get('tags', {}), e.get('geometry')
    if not geo:
        continue
    pts = [(g['lat'], g['lon']) for g in geo]
    # Lo que se va del recuadro se corta: un pedazo por cada tramo seguido adentro.
    tramos, actual = [], []
    for la, lo in pts:
        if adentro(la, lo, 0.002):
            actual.append((la, lo))
        else:
            if len(actual) > 1:
                tramos.append(actual)
            actual = []
    if len(actual) > 1:
        tramos.append(actual)
    nombre = t.get('name') or t.get('ref')
    if nombre and nombre not in indice:
        indice[nombre] = len(nombres)
        nombres.append(nombre)
    for tr in tramos:
        c = codificar(simplificar(tr, 2.5))
        if len(c) >= 4:
            calles.append([CLASE.get(t.get('highway'), 0), indice[nombre] if nombre else -1] + c)

# ---------- el mar: la costa (tierra a la izquierda) cerrada por el borde del recuadro
costa = unir([[(g['lat'], g['lon']) for g in e['geometry']] for e in leer('osm_costa.json') if e.get('geometry')])
costa = max(costa, key=len)
costa = [(min(N, max(S, la)), min(E, max(O, lo))) for la, lo in costa]
esquinas = [(N, E), (S, E), (S, O), (N, O)]          # en el sentido de las agujas del reloj


def cerrar(linea, sentido):
    """Del final de la línea al comienzo, por el borde, pasando por las esquinas en `sentido`."""
    def pos(p):                                       # posición a lo largo del borde, 0..4
        la, lo = p
        if abs(la - N) < 1e-9: return (lo - O) / (E - O)
        if abs(lo - E) < 1e-9: return 1 + (N - la) / (N - S)
        if abs(la - S) < 1e-9: return 2 + (E - lo) / (E - O)
        return 3 + (la - S) / (N - S)
    a, b = pos(linea[-1]), pos(linea[0])
    out = list(linea)
    paso = 0
    x = a
    for _ in range(5):
        siguiente = (math.floor(x) + 1) if sentido > 0 else (math.ceil(x) - 1)
        llega = (b if b > x else b + 4) if sentido > 0 else (b if b < x else b - 4)
        if (sentido > 0 and siguiente >= llega) or (sentido < 0 and siguiente <= llega):
            break
        out.append(esquinas[(int(siguiente) - 1) % 4] if sentido > 0 else esquinas[(int(siguiente) - 1) % 4])
        x = siguiente
        paso += 1
    return out


opciones = [cerrar(costa, 1), cerrar(costa, -1)]
mar = min(opciones, key=area)                         # en este recuadro, el mar es lo chico

# ---------- lagunas y espejos de agua grandes
pedazos = []
for e in leer('osm_agua.json'):
    if e['type'] == 'way' and e.get('geometry'):
        pedazos.append([(g['lat'], g['lon']) for g in e['geometry']])
    elif e['type'] == 'relation':
        for m in e.get('members', []):
            if m.get('role') == 'outer' and m.get('geometry'):
                pedazos.append([(g['lat'], g['lon']) for g in m['geometry']])
agua = []
for anillo in unir(pedazos):
    if anillo[0] == anillo[-1] and len(anillo) > 3 and area(anillo) > 20_000 \
            and any(adentro(la, lo) for la, lo in anillo):
        agua.append(codificar(simplificar(anillo, 4)))

datos = {
    'v': 1,
    'bb': [S, N, O, E],
    'o': [S, O],
    'q': Q,
    'fuente': '© colaboradores de OpenStreetMap (ODbL)',
    'nombres': nombres,
    'calles': calles,
    'mar': codificar(simplificar(mar, 8)),
    'agua': agua,
}
os.makedirs(os.path.dirname(SALIDA), exist_ok=True)
with open(SALIDA, 'w', encoding='utf-8') as f:
    json.dump(datos, f, ensure_ascii=False, separators=(',', ':'))
print('calles', len(calles), 'nombres', len(nombres), 'agua', len(agua),
      'puntos', sum((len(c) - 2) // 2 for c in calles),
      '%.2f MB' % (os.path.getsize(SALIDA) / 1e6))
