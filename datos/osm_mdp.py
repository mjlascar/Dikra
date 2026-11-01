"""Baja de OpenStreetMap las calles de Mar del Plata hasta Colinas Verdes, el mar y el agua.

Lo bajado va a datos/crudos/ (no va a git). Después, calles_mdp.py arma lo que usa la app.
Overpass suele contestar 502/504: se rotan tres servidores públicos.
"""
import json
import os
import sys
import time
import urllib.parse
import urllib.request

AQUI = os.path.dirname(os.path.abspath(__file__))
CRUDOS = os.path.join(AQUI, 'crudos')
# sur, oeste, norte, este: la ciudad entera y la Ruta 226 hasta pasar Colinas Verdes
BBOX = '-38.12,-57.87,-37.86,-57.52'
SERVIDORES = ['https://overpass-api.de/api/interpreter',
              'https://overpass.kumi.systems/api/interpreter',
              'https://overpass.private.coffee/api/interpreter']
CALLES = ('motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|road'
          '|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link')
PEDIDOS = {
    'osm_calles.json': f'[out:json][timeout:300];way["highway"~"^({CALLES})$"]({BBOX});out tags geom;',
    'osm_costa.json': f'[out:json][timeout:300];way["natural"="coastline"]({BBOX});out geom;',
    'osm_agua.json': f'''[out:json][timeout:300];(
        way["natural"="water"]({BBOX}); relation["natural"="water"]({BBOX});
        way["landuse"="reservoir"]({BBOX});
      );out geom tags;''',
}

os.makedirs(CRUDOS, exist_ok=True)
for archivo, consulta in PEDIDOS.items():
    destino = os.path.join(CRUDOS, archivo)
    if os.path.exists(destino) and '--de-nuevo' not in sys.argv:
        print('ya estaba', archivo)
        continue
    datos = None
    for intento in range(9):
        servidor = SERVIDORES[intento % len(SERVIDORES)]
        try:
            pedido = urllib.request.Request(
                servidor, data=urllib.parse.urlencode({'data': consulta}).encode(),
                headers={'User-Agent': 'dikra-mapa/1.0'})
            t = time.time()
            with urllib.request.urlopen(pedido, timeout=320) as r:
                datos = json.load(r)
            print(archivo, 'bien por', servidor.split('/')[2], len(datos['elements']),
                  'elementos en %.0f s' % (time.time() - t), flush=True)
            break
        except Exception as e:  # noqa: BLE001 - cualquier falla del servidor es un reintento
            print('  ', archivo, 'intento', intento, servidor.split('/')[2], type(e).__name__,
                  str(e)[:120], flush=True)
            time.sleep(10)
    if datos is None:
        raise SystemExit('Overpass no respondió para ' + archivo)
    with open(destino, 'w') as f:
        json.dump(datos, f)
