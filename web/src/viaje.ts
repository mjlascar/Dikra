/**
 * Qué fue un viaje: cuándo saliste, cuándo llegaste y qué se grabó de más.
 *
 * Todo sale del recorrido entero, que se guarda tal cual vino del GPS. Por eso estas cuentas se
 * pueden rehacer cuando cambian los lugares o las reglas, también sobre los viajes viejos.
 *
 * Las reglas de `REGLAS` y las de `crearVigia` son las mismas que aplica el grabador de Android
 * (android/.../Vigia.java) mientras graba. Si cambia una, cambia en los dos.
 */
import { type Lugar, type Punto, entre, fraccionDeEntrada, lugarEn } from './geo.ts';

export const REGLAS = {
  /** Metros: un punto con una precisión peor que esta no se usa. */
  precisionMaxima: 60,
  /** m/s (252 km/h): un salto más rápido que esto es un error del GPS. */
  velocidadMaxima: 70,
  /** Metros: para llegar hay que haber estado afuera del círculo y de este margen. */
  llegadaMargen: 50,
  /** Puntos seguidos adentro del círculo para dar la llegada mientras graba. */
  llegadaPuntos: 2,
  /** Metros: quedarse adentro de esta distancia es estar quieto. */
  quietoRadio: 80,
  /** Quieto este tiempo, la grabación corta sola. */
  quietoCorta: 15 * 60_000,
  /** Quieto al final al menos esto, el resumen lo recorta. */
  quietoRecorta: 5 * 60_000,
  /** Grabando más que esto, corta sola: alguien se la olvidó prendida. */
  largoMaximo: 4 * 3600_000,
  /** Metros: la salida se busca antes de alejarse esto del comienzo. */
  salidaRadio: 100,
  /** m/s (5,4 km/h): más lento que esto, el auto está parado. */
  parado: 1.5,
};

/** Ordena, saca los puntos imprecisos y los saltos imposibles. */
export function limpiar(puntos: Punto[]): Punto[] {
  const orden = [...puntos].sort((a, b) => a.t - b.t);
  const out: Punto[] = [];
  let descartados = 0;
  for (const p of orden) {
    if (!(p.ac <= REGLAS.precisionMaxima)) continue;
    const u = out[out.length - 1];
    if (u) {
      if (p.t <= u.t) continue;
      const v = entre(u, p) / ((p.t - u.t) / 1000);
      // Si el que quedó adentro era el salto, los buenos que siguen parecerían saltos para
      // siempre: después de unos cuantos, o de un rato sin puntos, se acepta el nuevo.
      if (v > REGLAS.velocidadMaxima && descartados < 5 && p.t - u.t < 30_000) {
        descartados++;
        continue;
      }
    }
    descartados = 0;
    out.push(p);
  }
  return out;
}

/**
 * Velocidad en cada punto, en m/s: la del GPS si la dio, si no la de los vecinos. La del GPS es
 * mejor (el ruido de la posición no la mueve), salvo que diga 0 con el auto andando: hay equipos
 * (y el emulador) que la dan siempre en 0, y entonces todo el viaje parecería parado.
 */
export function velocidades(p: Punto[]): number[] {
  const n = p.length;
  const v = new Array<number>(n).fill(0);
  const tramo = (j: number) => {
    const dt = (p[j].t - p[j - 1].t) / 1000;
    return dt > 0 ? entre(p[j - 1], p[j]) / dt : 0;
  };
  for (let i = 0; i < n; i++) {
    const a = p[Math.max(0, i - 2)], b = p[Math.min(n - 1, i + 2)];
    const dt = (b.t - a.t) / 1000;
    const deducida = dt > 0 ? entre(a, b) / dt : 0;
    // Andando en los dos tramos pegados al punto: el 0 del GPS es falso. Con uno solo no alcanza,
    // porque en el borde de una parada el auto llega andando y se queda.
    const anda = Math.min(i > 0 ? tramo(i) : Infinity, i < n - 1 ? tramo(i + 1) : Infinity);
    const g = p[i].ve;
    v[i] = g != null && g >= 0 && !(g < 0.5 && anda > 4) ? g : deducida;
  }
  return v;
}

/**
 * Dónde salió el viaje: el último momento en que estabas parado antes de alejarte 100 m de
 * donde empezaste a grabar. Lo que esperaste en el auto antes de arrancar no cuenta.
 */
export function salida(p: Punto[], v: number[]): number {
  if (p.length === 0) return 0;
  const lejos = p.findIndex((q) => entre(q, p[0]) > REGLAS.salidaRadio);
  if (lejos < 0) return 0;
  for (let i = lejos - 1; i >= 0; i--) if (v[i] < REGLAS.parado) return i;
  return 0;
}

/** Si el recorrido se alejó del comienzo: si no, no hubo viaje. */
export const seMovio = (p: Punto[]): boolean =>
  p.length > 1 && p.some((q) => entre(q, p[0]) > REGLAS.salidaRadio);

export type Entrada = { i: number; t: number };

/**
 * Cada vez que el recorrido entra al círculo, habiendo estado afuera (más el margen). Un punto
 * suelto adentro, con el siguiente otra vez afuera, es el GPS que saltó: no cuenta. La hora es
 * la del cruce del borde, entre los dos puntos.
 */
export function entradas(p: Punto[], l: Lugar, desde = 0, hasta = p.length - 1): Entrada[] {
  const out: Entrada[] = [];
  let afuera = false;
  for (let i = desde; i <= hasta && i < p.length; i++) {
    const d = entre(p[i], l);
    if (d > l.radio + REGLAS.llegadaMargen) {
      afuera = true;
      continue;
    }
    if (!afuera || d > l.radio) continue;
    const sig = p[i + 1];
    if (sig && entre(sig, l) > l.radio + 15) continue;
    const ant = p[i - 1];
    const t = ant ? ant.t + fraccionDeEntrada(ant, p[i], l) * (p[i].t - ant.t) : p[i].t;
    out.push({ i, t });
    afuera = false;
  }
  return out;
}

/** Desde qué punto quedaste quieto hasta el final, a menos de `quietoRadio` del último. */
export function quietoFinal(p: Punto[]): number {
  const n = p.length;
  if (n === 0) return -1;
  const ult = p[n - 1];
  let k = n - 1;
  while (k > 0 && entre(p[k - 1], ult) <= REGLAS.quietoRadio) k--;
  return k;
}

/** Cómo se decidió dónde termina el viaje. */
export type Corte = 'llegada' | 'quieto' | 'fin';

export type Resumen = {
  /** Milisegundos. */
  salida: number;
  llegada: number;
  duracion: number;
  /** Metros. */
  distancia: number;
  /** Milisegundos con el auto parado: semáforos, esperas. */
  parado: number;
  origenId: string | null;
  destinoId: string | null;
  corte: Corte;
  /** Milisegundos grabados después de la llegada: lo que se recortó. */
  sobra: number;
  /** Índices en los puntos limpios. */
  iSalida: number;
  iLlegada: number;
};

/**
 * El resumen de un viaje. Con destino elegido, termina en la primera entrada a ese lugar.
 * Sin destino, si terminó adentro de un lugar guardado, en la última entrada a ese lugar; si
 * no, donde quedaste quieto al final. `null` si no hubo viaje (no te alejaste del comienzo).
 */
export function resumir(crudos: Punto[], lugares: Lugar[], destinoId: string | null): Resumen | null {
  const p = limpiar(crudos);
  if (!seMovio(p)) return null;
  const v = velocidades(p);
  const iS = salida(p, v);
  const n = p.length;

  let iL = n - 1, tL = p[iL].t, corte: Corte = 'fin';
  const k = quietoFinal(p);
  if (k > iS && p[n - 1].t - p[k].t >= REGLAS.quietoRecorta) {
    // `k` es cuando entraste a los últimos 80 m; la llegada es cuando el auto paró.
    let j = k;
    while (j < n - 1 && v[j] >= REGLAS.parado) j++;
    iL = j;
    tL = p[j].t;
    corte = 'quieto';
  }

  let destino = destinoId ? lugares.find((l) => l.id === destinoId) ?? null : null;
  if (destino) {
    const e = entradas(p, destino, iS)[0];
    if (e) {
      iL = e.i;
      tL = e.t;
      corte = 'llegada';
    }
  } else {
    destino = lugarEn(p[iL], lugares);
    const e = destino ? entradas(p, destino, iS, iL).at(-1) : undefined;
    if (e) {
      iL = e.i;
      tL = e.t;
      corte = 'llegada';
    }
  }

  let dist = 0, parado = 0;
  for (let i = iS + 1; i <= iL; i++) {
    const quieto = v[i] < REGLAS.parado && v[i - 1] < REGLAS.parado;
    if (!quieto) dist += entre(p[i - 1], p[i]);
    else parado += p[i].t - p[i - 1].t;
  }
  const tS = p[iS].t;
  const origen = lugarEn(p[iS], lugares);
  return {
    salida: tS,
    llegada: tL,
    duracion: tL - tS,
    distancia: dist,
    parado,
    origenId: origen && origen !== destino ? origen.id : null,
    destinoId: destino ? destino.id : null,
    corte,
    sobra: Math.max(0, p[n - 1].t - tL),
    iSalida: iS,
    iLlegada: iL,
  };
}

export type Veredicto = 'sigue' | 'llego' | 'quieto' | 'largo';

/**
 * Lo que decide, punto por punto mientras graba, si hay que cortar: llegaste, quedaste quieto
 * 15 minutos, o lleva 4 horas. Es lo que hace el grabador de Android; en la web lo usa la
 * página, que sólo graba con la pantalla prendida.
 */
export function crearVigia(destino: Lugar | null, inicio: number) {
  let afuera = false, adentro = 0;
  let ancla: Punto | null = null;
  return {
    agregar(p: Punto): Veredicto {
      if (p.t - inicio >= REGLAS.largoMaximo) return 'largo';
      if (!(p.ac <= REGLAS.precisionMaxima)) return 'sigue';
      if (destino) {
        const d = entre(p, destino);
        if (d > destino.radio + REGLAS.llegadaMargen) {
          afuera = true;
          adentro = 0;
        } else if (afuera && d <= destino.radio) {
          if (++adentro >= REGLAS.llegadaPuntos) return 'llego';
        } else adentro = 0;
      }
      if (!ancla || entre(p, ancla) > REGLAS.quietoRadio) ancla = p;
      else if (p.t - ancla.t >= REGLAS.quietoCorta) return 'quieto';
      return 'sigue';
    },
  };
}
