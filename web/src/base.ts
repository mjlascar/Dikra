/**
 * Lo que guarda el teléfono, en IndexedDB: los viajes, sus puntos, los lugares y algunos ajustes.
 *
 * No hay servidor: cada teléfono tiene lo suyo. El respaldo es un archivo que se exporta y se
 * vuelve a cargar; al cargarlo sólo se agrega lo que falta, nunca se pisa lo que ya está.
 */
import type { Lugar, Punto } from './geo.ts';
import type { Resumen } from './viaje.ts';

/** Por qué se cortó la grabación. */
export type Motivo = 'llegada' | 'quieto' | 'largo' | 'manual';

export type Viaje = {
  id: string;
  estado: 'grabando' | 'listo';
  /** Cuándo se tocó «grabar» y cuándo se cortó (milisegundos). */
  inicio: number;
  fin: number | null;
  motivo: Motivo | null;
  /** El destino elegido al empezar, tal cual era en ese momento. */
  destino: Lugar | null;
  /** Lo calculado sobre el recorrido; `null` mientras graba. */
  resumen: Resumen | null;
  /** Dónde se grabó: el APK o la página. */
  donde: 'android' | 'web';
};

const NOMBRE = 'dikra';
const VERSION = 1;
let base: Promise<IDBDatabase> | null = null;

function abrir(): Promise<IDBDatabase> {
  if (base) return base;
  base = new Promise((ok, mal) => {
    const r = indexedDB.open(NOMBRE, VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('viajes')) db.createObjectStore('viajes', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('puntos')) db.createObjectStore('puntos', { keyPath: ['v', 't'] });
      if (!db.objectStoreNames.contains('lugares')) db.createObjectStore('lugares', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('ajustes')) db.createObjectStore('ajustes', { keyPath: 'k' });
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => mal(r.error);
    r.onblocked = () => mal(new Error('La base está abierta en otra pestaña'));
  });
  // Que el navegador no la borre para hacer lugar (en el iPhone importa).
  navigator.storage?.persist?.().catch(() => {});
  return base;
}

function hecho(tx: IDBTransaction): Promise<void> {
  return new Promise((ok, mal) => {
    tx.oncomplete = () => ok();
    tx.onerror = () => mal(tx.error);
    tx.onabort = () => mal(tx.error ?? new Error('Se canceló la escritura'));
  });
}

function pedido<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((ok, mal) => {
    r.onsuccess = () => ok(r.result);
    r.onerror = () => mal(r.error);
  });
}

async function leer<T>(tienda: string, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await abrir();
  return pedido(fn(db.transaction(tienda).objectStore(tienda)));
}

async function escribir(tiendas: string[], fn: (tx: IDBTransaction) => void): Promise<void> {
  const db = await abrir();
  const tx = db.transaction(tiendas, 'readwrite');
  fn(tx);
  return hecho(tx);
}

/** Todos los puntos de un viaje, como los guarda la base. */
type FilaPunto = Punto & { v: string };
const rango = (id: string) => IDBKeyRange.bound([id, -Infinity], [id, Infinity]);

// ---- viajes

export const viaje = (id: string) => leer<Viaje | undefined>('viajes', (s) => s.get(id));

/** Los viajes, del más nuevo al más viejo. */
export async function viajes(): Promise<Viaje[]> {
  const todos = await leer<Viaje[]>('viajes', (s) => s.getAll());
  return todos.sort((a, b) => b.inicio - a.inicio);
}

export const guardarViaje = (v: Viaje) => escribir(['viajes'], (tx) => tx.objectStore('viajes').put(v));

export const borrarViaje = (id: string) =>
  escribir(['viajes', 'puntos'], (tx) => {
    tx.objectStore('viajes').delete(id);
    tx.objectStore('puntos').delete(rango(id));
  });

export const agregarPuntos = (id: string, puntos: Punto[]) =>
  escribir(['puntos'], (tx) => {
    const s = tx.objectStore('puntos');
    for (const p of puntos) s.put({ v: id, t: p.t, la: p.la, lo: p.lo, ac: p.ac, ve: p.ve ?? null });
  });

export async function puntos(id: string): Promise<Punto[]> {
  const filas = await leer<FilaPunto[]>('puntos', (s) => s.getAll(rango(id)));
  return filas.map(({ t, la, lo, ac, ve }) => ({ t, la, lo, ac, ve }));
}

// ---- lugares

export async function lugares(): Promise<Lugar[]> {
  const todos = await leer<Lugar[]>('lugares', (s) => s.getAll());
  return todos.sort((a, b) => Number(b.destino) - Number(a.destino) || a.nombre.localeCompare(b.nombre));
}

export const guardarLugar = (l: Lugar) => escribir(['lugares'], (tx) => tx.objectStore('lugares').put(l));
export const borrarLugar = (id: string) => escribir(['lugares'], (tx) => tx.objectStore('lugares').delete(id));

// ---- ajustes sueltos

export async function ajuste<T>(k: string): Promise<T | undefined> {
  const fila = await leer<{ k: string; v: T } | undefined>('ajustes', (s) => s.get(k));
  return fila?.v;
}

export const guardarAjuste = (k: string, v: unknown) =>
  escribir(['ajustes'], (tx) => tx.objectStore('ajustes').put({ k, v }));

// ---- respaldo

export type Respaldo = {
  formato: 'dikra';
  version: 1;
  creado: number;
  lugares: Lugar[];
  viajes: Array<Viaje & { puntos: Array<[number, number, number, number, number | null]> }>;
};

export async function exportar(): Promise<Respaldo> {
  const vs = await viajes();
  const conPuntos = [];
  for (const v of vs) {
    if (v.estado !== 'listo') continue;
    const ps = await puntos(v.id);
    conPuntos.push({ ...v, puntos: ps.map((p) => [p.t, p.la, p.lo, p.ac, p.ve ?? null] as [number, number, number, number, number | null]) });
  }
  return { formato: 'dikra', version: 1, creado: Date.now(), lugares: await lugares(), viajes: conPuntos };
}

/** Agrega del respaldo lo que no está; lo que ya está (mismo id) queda como está. */
export async function importar(r: Respaldo): Promise<{ viajes: number; lugares: number }> {
  if (r?.formato !== 'dikra' || !Array.isArray(r.viajes) || !Array.isArray(r.lugares)) {
    throw new Error('No es un respaldo de Dikra');
  }
  const tengoV = new Set((await viajes()).map((v) => v.id));
  const tengoL = new Set((await lugares()).map((l) => l.id));
  let nv = 0, nl = 0;
  for (const l of r.lugares) {
    if (tengoL.has(l.id)) continue;
    await guardarLugar(l);
    nl++;
  }
  for (const { puntos: ps, ...v } of r.viajes) {
    if (tengoV.has(v.id)) continue;
    await agregarPuntos(v.id, ps.map(([t, la, lo, ac, ve]) => ({ t, la, lo, ac, ve })));
    await guardarViaje(v);
    nv++;
  }
  return { viajes: nv, lugares: nl };
}
