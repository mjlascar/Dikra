// Corre JavaScript en la página de Dikra adentro del emulador, por el protocolo de depuración de
// Chrome (el WebView de la versión de depuración lo deja). Imprime el resultado como JSON.
//
// Uso: node scripts/cdp.mjs '<expresión>'
// Antes: adb forward tcp:9333 localabstract:webview_devtools_remote_<pid> (lo hace probar-emulador.sh)
const puerto = process.env.CDP_PUERTO ?? '9333';
const expresion = process.argv[2];
if (!expresion) {
  console.error('Uso: node scripts/cdp.mjs <expresión>');
  process.exit(2);
}

const paginas = await (await fetch(`http://127.0.0.1:${puerto}/json`)).json();
const pagina = paginas.find((p) => p.type === 'page' && p.url.includes('appassets'));
if (!pagina) {
  console.error('No encontré la página de Dikra entre:', paginas.map((p) => p.url));
  process.exit(1);
}
const ws = new WebSocket(pagina.webSocketDebuggerUrl);
await new Promise((ok, mal) => {
  ws.onopen = ok;
  ws.onerror = () => mal(new Error('No se pudo conectar con la página'));
});
ws.send(JSON.stringify({
  id: 1,
  method: 'Runtime.evaluate',
  params: { expression: expresion, awaitPromise: true, returnByValue: true },
}));
const r = await new Promise((ok) => {
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id === 1) ok(d);
  };
});
ws.close();
if (r.result?.exceptionDetails) {
  console.error(r.result.exceptionDetails.exception?.description ?? JSON.stringify(r.result.exceptionDetails));
  process.exit(1);
}
console.log(JSON.stringify(r.result?.result?.value ?? null));
