/** Cuentas de geografía chicas: distancias en metros y cruces de un círculo. */

/** Un punto del GPS: milisegundos, grados, precisión en metros y velocidad en m/s si la dio. */
export type Punto = { t: number; la: number; lo: number; ac: number; ve?: number | null };

/** Un lugar guardado (Casa, Trabajo, el terreno): un círculo con nombre. */
export type Lugar = {
  id: string;
  nombre: string;
  la: number;
  lo: number;
  radio: number;
  /** Si aparece como botón en Inicio («→ Colinas Verdes»). */
  destino: boolean;
};

const M_POR_GRADO = 111320;

/** Distancia en metros entre dos posiciones (haversine). */
export function distancia(la1: number, lo1: number, la2: number, lo2: number): number {
  const r = Math.PI / 180;
  const dla = (la2 - la1) * r, dlo = (lo2 - lo1) * r;
  const a = Math.sin(dla / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(dlo / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(a)));
}

export const entre = (a: { la: number; lo: number }, b: { la: number; lo: number }): number =>
  distancia(a.la, a.lo, b.la, b.lo);

/**
 * En qué fracción del tramo a→b se entra al círculo (0 = en a, 1 = en b). Sirve para dar la
 * hora de llegada entre dos puntos del GPS en vez de redondearla al segundo punto. Si el tramo
 * no corta el borde, da 1.
 */
export function fraccionDeEntrada(a: Punto, b: Punto, c: { la: number; lo: number; radio: number }): number {
  const k = Math.cos((c.la * Math.PI) / 180) * M_POR_GRADO;
  const ax = (a.lo - c.lo) * k, ay = (a.la - c.la) * M_POR_GRADO;
  const bx = (b.lo - c.lo) * k, by = (b.la - c.la) * M_POR_GRADO;
  const dx = bx - ax, dy = by - ay;
  const qa = dx * dx + dy * dy;
  if (qa === 0) return 1;
  const qb = 2 * (ax * dx + ay * dy);
  const qc = ax * ax + ay * ay - c.radio * c.radio;
  const disc = qb * qb - 4 * qa * qc;
  if (disc < 0) return 1;
  const f = (-qb - Math.sqrt(disc)) / (2 * qa);
  return f >= 0 && f <= 1 ? f : 1;
}

/** El lugar que contiene la posición, el más cercano si hay varios. */
export function lugarEn(p: { la: number; lo: number }, lugares: Lugar[]): Lugar | null {
  let mejor: Lugar | null = null, md = Infinity;
  for (const l of lugares) {
    const d = entre(p, l);
    if (d <= l.radio && d < md) { mejor = l; md = d; }
  }
  return mejor;
}
