/**
 * Arranque y navegación. Cada pantalla es una función que arma su contenido en una caja y
 * devuelve cómo limpiarse (frenar relojes, soltar el mapa) cuando se va.
 */
import { grabador, ponerAlDia, titulo } from './control.ts';
import * as base from './base.ts';
import * as formato from './formato.ts';
import { nativo } from './grabador.ts';
import { escuchar } from './puente.ts';
import { pantallaAjustes } from './pantallas/ajustes.ts';
import { pantallaInicio } from './pantallas/inicio.ts';
import { pantallaLugar, pantallaLugares } from './pantallas/lugares.ts';
import { pantallaViaje, pantallaViajes } from './pantallas/viajes.ts';
import { aviso, h, icono } from './ui.ts';

/** La versión de la página: la pone scripts/armar-web.mjs al armar. */
export const VERSION = '__VERSION__';

export type Limpieza = (() => void) | void;
type Pantalla = (caja: HTMLElement, m: RegExpMatchArray) => Promise<Limpieza>;

const RUTAS: Array<[RegExp, Pantalla]> = [
  [/^#?\/?$/, (c) => pantallaInicio(c)],
  [/^#\/viajes$/, (c) => pantallaViajes(c)],
  [/^#\/viaje\/([\w-]+)$/, (c, m) => pantallaViaje(c, m[1])],
  [/^#\/lugares$/, (c) => pantallaLugares(c)],
  [/^#\/lugar\/([\w-]+)$/, (c, m) => pantallaLugar(c, m[1])],
  [/^#\/ajustes$/, (c) => pantallaAjustes(c)],
];

const PESTANAS: Array<{ hash: string; nombre: string; icono: Parameters<typeof icono>[0]; activa: RegExp }> = [
  { hash: '#/', nombre: 'Grabar', icono: 'grabar', activa: /^#?\/?$/ },
  { hash: '#/viajes', nombre: 'Viajes', icono: 'viajes', activa: /^#\/viaje/ },
  { hash: '#/lugares', nombre: 'Lugares', icono: 'lugares', activa: /^#\/lugar/ },
  { hash: '#/ajustes', nombre: 'Ajustes', icono: 'ajustes', activa: /^#\/ajustes/ },
];

let limpiar: Limpieza;
let turno = 0;

/** Vuelve a armar la pantalla de la dirección actual. */
export async function mostrar() {
  const mio = ++turno;
  if (typeof limpiar === 'function') limpiar();
  limpiar = undefined;
  const hash = location.hash || '#/';
  pintarPestanas(hash);
  const caja = h('div', { class: 'pantalla' });
  document.getElementById('pantalla')!.replaceChildren(caja);
  window.scrollTo(0, 0);
  for (const [re, fn] of RUTAS) {
    const m = hash.match(re);
    if (!m) continue;
    let l: Limpieza = undefined;
    try {
      l = await fn(caja, m);
    } catch (e) {
      caja.replaceChildren(h('p', { class: 'vacio' }, 'Algo falló al abrir esta pantalla: ' + (e as Error).message));
      console.error(e);
    }
    // Si mientras tanto se fue a otra pantalla, ésta se limpia sola.
    if (mio === turno) limpiar = l;
    else if (typeof l === 'function') l();
    return;
  }
  location.hash = '#/';
}

function pintarPestanas(hash: string) {
  const nav = document.getElementById('pestanas')!;
  nav.replaceChildren(...PESTANAS.map((p) =>
    h('a', { href: p.hash, class: p.activa.test(hash) ? 'pestana activa' : 'pestana', 'aria-current': p.activa.test(hash) ? 'page' : null },
      icono(p.icono), h('span', {}, p.nombre))));
}

/** El APK pregunta esto con «atrás»: si hay adónde volver adentro de la app, vuelve. */
(window as unknown as { __atras: () => boolean }).__atras = () => {
  if ((location.hash || '#/') === '#/') return false;
  if (history.length > 1) history.back();
  else location.hash = '#/';
  return true;
};

/** Avisa lo que se guardó mientras la app no miraba. */
async function alDia(irAlViaje: boolean) {
  try {
    const { hechos, vacios } = await ponerAlDia();
    if (hechos.length) {
      const ls = await base.lugares();
      const u = hechos[hechos.length - 1];
      aviso(`Viaje guardado: ${titulo(u, ls)}, ${formato.duracion(u.resumen!.duracion)}`);
      // En Inicio (o volviendo de la grabación) se va directo al viaje recién guardado.
      if (irAlViaje || (location.hash || '#/') === '#/') location.hash = '#/viaje/' + u.id;
      else if (location.hash === '#/viajes') mostrar();
    } else if (vacios) aviso('La grabación no tenía viaje (no te moviste): no quedó guardada.');
    return hechos;
  } catch (e) {
    aviso('No pude guardar el último viaje: ' + (e as Error).message);
    return [];
  }
}

function registrarServiceWorker() {
  if (nativo() || !('serviceWorker' in navigator) || location.protocol !== 'https:') return;
  navigator.serviceWorker.register('sw.js').then((r) => {
    const ofrecer = (w: ServiceWorker | null) => {
      if (!w) return;
      const barra = h('div', { class: 'barra-version' },
        h('span', {}, 'Hay una versión nueva de Dikra.'),
        h('button', {
          class: 'boton chico',
          onclick: () => {
            if (grabador.estado().grabando) {
              aviso('Terminá el viaje y después actualizá: recargar corta la grabación.');
              return;
            }
            w.postMessage('actualizar');
          },
        }, 'Actualizar'));
      document.body.append(barra);
    };
    if (r.waiting) ofrecer(r.waiting);
    r.addEventListener('updatefound', () => {
      const nuevo = r.installing;
      nuevo?.addEventListener('statechange', () => {
        if (nuevo.state === 'installed' && navigator.serviceWorker.controller) ofrecer(nuevo);
      });
    });
  }).catch(() => {});
  let recargando = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (recargando) return;
    recargando = true;
    location.reload();
  });
}

async function arrancar() {
  // Antes de cualquier espera: el APK avisa «abrir» apenas termina de cargar la página (se tocó
  // el aviso de llegada), y un aviso sin nadie escuchando se pierde.
  escuchar('abrir', async (id) => {
    if (typeof id !== 'string') return;
    await ponerAlDia();
    location.hash = '#/viaje/' + id;
  });
  document.documentElement.classList.toggle('nativo', !!nativo());
  registrarServiceWorker();
  await alDia(false);
  addEventListener('hashchange', mostrar);
  await mostrar();
  // Al volver a la app: lo que haya cortado el grabador mientras tanto.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !grabador.estado().grabando) alDia(false);
  });
}

arrancar();
