/**
 * Viajes inventados para las pruebas: un auto que recorre una línea quebrada a velocidad pareja,
 * con esperas al empezar, paradas en el camino y un rato quieto al final. Un punto por segundo,
 * como el GPS del teléfono.
 *
 * Las coordenadas son de avenidas, nunca de la casa de nadie: el repo es público.
 */
import { type Punto, distancia } from '../web/src/geo.ts';

export type Opciones = {
  /** m/s mientras se mueve. */
  velocidad?: number;
  /** Milisegundos del primer punto. */
  inicio?: number;
  /** Segundos quieto antes de arrancar. */
  esperaInicial?: number;
  /** Paradas en el camino: a cuántos metros del comienzo y cuántos segundos. */
  paradas?: Array<{ en: number; dura: number }>;
  /** Segundos quieto en el último punto. */
  esperaFinal?: number;
  /** Metros de ruido del GPS (0: exacto). */
  ruido?: number;
  semilla?: number;
  /** Si el GPS da la velocidad (true) o hay que deducirla (false). */
  conVelocidad?: boolean;
};

export const T0 = Date.UTC(2026, 10, 2, 11, 0, 0);

/** Un generador chico y repetible: la misma semilla da el mismo ruido. */
function azar(semilla: number) {
  let s = semilla >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** El punto a `m` metros del comienzo de la línea. */
export function enLinea(linea: Array<[number, number]>, m: number): [number, number] {
  let resto = m;
  for (let i = 1; i < linea.length; i++) {
    const [la1, lo1] = linea[i - 1], [la2, lo2] = linea[i];
    const d = distancia(la1, lo1, la2, lo2);
    if (resto <= d) {
      const f = d === 0 ? 0 : resto / d;
      return [la1 + (la2 - la1) * f, lo1 + (lo2 - lo1) * f];
    }
    resto -= d;
  }
  return linea[linea.length - 1];
}

export function largo(linea: Array<[number, number]>): number {
  let d = 0;
  for (let i = 1; i < linea.length; i++) d += distancia(...linea[i - 1], ...linea[i]);
  return d;
}

export function manejar(linea: Array<[number, number]>, o: Opciones = {}): Punto[] {
  const vel = o.velocidad ?? 12;
  const r = azar(o.semilla ?? 7);
  const ruido = o.ruido ?? 0;
  const conVel = o.conVelocidad ?? true;
  const total = largo(linea);
  const paradas = [...(o.paradas ?? [])].sort((a, b) => a.en - b.en);
  const out: Punto[] = [];
  let t = o.inicio ?? T0;
  const poner = (m: number, ve: number) => {
    const [la, lo] = enLinea(linea, m);
    const dx = ruido ? (r() - 0.5) * 2 * ruido : 0, dy = ruido ? (r() - 0.5) * 2 * ruido : 0;
    out.push({
      t,
      la: la + dy / 111320,
      lo: lo + dx / (111320 * Math.cos((la * Math.PI) / 180)),
      ac: ruido ? Math.max(4, ruido) : 5,
      ve: conVel ? ve : null,
    });
    t += 1000;
  };
  for (let s = 0; s < (o.esperaInicial ?? 0); s++) poner(0, 0);
  let m = 0, sig = 0;
  while (m < total) {
    if (sig < paradas.length && m >= paradas[sig].en) {
      for (let s = 0; s < paradas[sig].dura; s++) poner(m, 0);
      sig++;
    }
    poner(m, vel);
    m += vel;
  }
  for (let s = 0; s <= (o.esperaFinal ?? 0); s++) poner(total, 0);
  return out;
}

/** Dos avenidas cualquiera del centro, de sudeste a noroeste: unos 4,6 km. */
export const LINEA: Array<[number, number]> = [
  [-38.0050, -57.5500],
  [-37.9900, -57.5700],
  [-37.9800, -57.5950],
];
