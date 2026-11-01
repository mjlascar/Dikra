"""Sirve dist/web en http://127.0.0.1:5190 para probar en el navegador, sin caché.

Sin caché porque el servidor de Python deja que el navegador guarde los archivos y, después de
volver a armar, la página seguía con el JavaScript viejo. Uso: python3 scripts/servir.py
"""
import functools
import http.server
import os
import sys

RAIZ = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'dist', 'web')
PUERTO = int(sys.argv[1]) if len(sys.argv) > 1 else 5190


class SinCache(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      '.js': 'text/javascript', '.webmanifest': 'application/manifest+json'}

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


http.server.ThreadingHTTPServer(('127.0.0.1', PUERTO), functools.partial(SinCache, directory=RAIZ)).serve_forever()
