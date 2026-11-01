/**
 * Lo que une al grabador con la base: empezar un viaje, guardarlo cuando corta y rehacer los
 * resúmenes cuando cambian los lugares.
 */
import * as base from './base.ts';
import type { Viaje } from './base.ts';
import type { Lugar } from './geo.ts';
import { type Grabador, type Terminado, elegirGrabador } from './grabador.ts';
import { type Resumen, resumir } from './viaje.ts';

export const grabador: Grabador = elegirGrabador();

let cola: Promise<unknown> = Promise.resolve();
/** De a uno: empezar, ponerse al día y recalcular nunca se pisan. */
const deAUno = <T>(fn: () => Promise<T>): Promise<T> => {
  const r = cola.then(fn, fn);
  cola = r.catch(() => {});
  return r;
};

export const nuevoId = (prefijo: string) => prefijo + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/**
 * Primero queda anotado en la base y después arranca el GPS: si el GPS no arranca, se borra.
 * Va en la misma fila que `ponerAlDia`: si no, ésta podía ver el viaje recién anotado antes de
 * que el grabador lo tomara y darlo por abandonado.
 */
export const empezarViaje = (destino: Lugar | null): Promise<Viaje> => deAUno(async () => {
  const v: Viaje = {
    id: nuevoId('v'), estado: 'grabando', inicio: Date.now(), fin: null, motivo: null,
    destino, resumen: null, donde: grabador.donde,
  };
  await base.guardarViaje(v);
  try {
    await grabador.empezar(v.id, destino, v.inicio);
  } catch (e) {
    await base.borrarViaje(v.id);
    throw e;
  }
  return v;
});

async function calcular(v: Viaje): Promise<Resumen | null> {
  const ps = await base.puntos(v.id);
  const ls = await base.lugares();
  // Si el destino de ese día ya no existe (se borró), vale como estaba guardado en el viaje.
  if (v.destino && !ls.some((l) => l.id === v.destino!.id)) ls.push(v.destino);
  return resumir(ps, ls, v.destino?.id ?? null);
}

/** Pasa a la base un viaje que el grabador cortó. `null` si no hubo viaje (no te moviste). */
async function guardarTerminado(t: Terminado): Promise<Viaje | null> {
  const previo = await base.viaje(t.id);
  if (previo?.estado === 'listo') {
    await grabador.guardado(t.id);
    return previo;
  }
  if (grabador.donde === 'android') await base.agregarPuntos(t.id, await grabador.puntos(t.id, 0));
  const v: Viaje = {
    id: t.id, inicio: t.inicio, destino: t.destino, donde: grabador.donde,
    ...(previo ?? {}),
    estado: 'listo', fin: t.fin, motivo: t.motivo, resumen: null,
  };
  v.resumen = await calcular(v);
  if (v.resumen) await base.guardarViaje(v);
  else await base.borrarViaje(t.id);
  await grabador.guardado(t.id);
  return v.resumen ? v : null;
}

/**
 * Guarda lo que el grabador cortó mientras la página no miraba (o estaba cerrada). Devuelve los
 * viajes que quedaron y cuántos se descartaron por no tener viaje.
 */
export const ponerAlDia = () => deAUno(async () => {
  const hechos: Viaje[] = [];
  let vacios = 0;
  for (const t of await grabador.terminados()) {
    const v = await guardarTerminado(t);
    if (v) hechos.push(v);
    else vacios++;
  }
  // Un viaje «grabando» en la base que el grabador no conoce se cortó en algún lado (la app se
  // cerró de golpe, el teléfono se apagó): se guarda con lo que haya.
  const e = grabador.estado();
  for (const v of await base.viajes()) {
    if (v.estado !== 'grabando' || v.id === e.id) continue;
    const ps = grabador.donde === 'android' ? await grabador.puntos(v.id, 0) : await base.puntos(v.id);
    const fin = ps.length ? ps[ps.length - 1].t : v.inicio;
    const r = await guardarTerminado({ id: v.id, inicio: v.inicio, fin, motivo: 'manual', destino: v.destino });
    if (r) hechos.push(r);
    else vacios++;
  }
  return { hechos, vacios };
});

/** Rehace los resúmenes con los lugares de ahora: al agregar, mover o borrar uno. */
export const recalcularTodo = () => deAUno(async () => {
  for (const v of await base.viajes()) {
    if (v.estado !== 'listo') continue;
    const r = await calcular(v);
    if (r) {
      v.resumen = r;
      await base.guardarViaje(v);
    }
  }
});

/** «Casa → Terreno», con los lugares de ahora. */
export function titulo(v: Viaje, lugares: Lugar[]): string {
  const nombre = (id: string | null | undefined) => (id ? lugares.find((l) => l.id === id)?.nombre : undefined);
  const destino = nombre(v.resumen?.destinoId) ?? v.destino?.nombre;
  const origen = nombre(v.resumen?.origenId);
  if (origen && destino) return `${origen} → ${destino}`;
  if (destino) return `→ ${destino}`;
  if (origen) return `${origen} → otro lugar`;
  return 'Viaje sin destino';
}
