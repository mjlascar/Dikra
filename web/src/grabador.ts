/**
 * Quién graba el GPS. Hay tres, con la misma cara:
 *
 * - **Android**: un servicio nativo de la app (android/.../Grabador.java) que graba con la
 *   pantalla apagada y corta solo al llegar. La página le pregunta cómo va y, al final, le pide
 *   los puntos para guardarlos en la base.
 * - **Web** (el iPhone): la página misma, con la pantalla prendida y Dikra adelante. Guarda cada
 *   punto en la base apenas llega y decide sola cuándo cortar, con la misma vigía.
 * - **Simulado**: el de la web, pero con un GPS de mentira que recorre `datos/demo.json`. Sirve
 *   para probar en la computadora (`?simular=20` va 20 veces más rápido).
 */
import * as base from './base.ts';
import type { Motivo } from './base.ts';
import type { Lugar, Punto } from './geo.ts';
import { escuchar } from './puente.ts';
import { crearVigia } from './viaje.ts';

export type EstadoGrabacion = {
  grabando: boolean;
  id: string | null;
  inicio: number;
  destino: Lugar | null;
  ultimo: Punto | null;
  /** Cuántos puntos lleva. */
  n: number;
};

/** Un viaje que el grabador cortó y la base todavía no tiene completo. */
export type Terminado = { id: string; inicio: number; fin: number; motivo: Motivo; destino: Lugar | null };

export interface Grabador {
  readonly donde: 'android' | 'web';
  /** Empieza a grabar. Si no puede, el error trae el texto para mostrar. */
  empezar(id: string, destino: Lugar | null, inicio: number): Promise<void>;
  terminar(): Promise<void>;
  descartar(): Promise<void>;
  estado(): EstadoGrabacion;
  /** Los puntos desde el número `desde` (0: todos). */
  puntos(id: string, desde: number): Promise<Punto[]>;
  /** Los viajes que cortó y todavía no se guardaron enteros en la base. */
  terminados(): Promise<Terminado[]>;
  /** Ya quedó en la base: no hace falta volver a ofrecerlo. */
  guardado(id: string): Promise<void>;
  /** Para avisar que llegó un punto o que cortó. Devuelve cómo dejar de escuchar. */
  alCambiar(fn: () => void): () => void;
}

function oyentes() {
  let lista: Array<() => void> = [];
  return {
    avisar: () => lista.forEach((f) => f()),
    sumar(fn: () => void) {
      lista.push(fn);
      return () => { lista = lista.filter((f) => f !== fn); };
    },
  };
}

export class NoSePuede extends Error {}

// ---------------------------------------------------------------- Android

/** Lo que expone MainActivity.java como `window.DikraNativo`. Todo entra y sale como texto. */
export type Nativo = {
  version(): string;
  estado(): string;
  empezar(json: string): string;
  terminar(): void;
  descartar(): void;
  puntos(id: string, desde: number): string;
  terminados(): string;
  guardado(id: string): void;
  permisos(): string;
  pedirPermisos(): void;
  abrirAjustes(que: string): void;
  guardar(nombre: string, texto: string): void;
  actualizacion(): string;
  buscarActualizacion(): void;
  actualizar(): void;
};

export const nativo = (): Nativo | null => (window as unknown as { DikraNativo?: Nativo }).DikraNativo ?? null;

type FilaNativa = [number, number, number, number, number];
const dePunto = ([t, la, lo, ac, ve]: FilaNativa): Punto => ({ t, la, lo, ac, ve: ve < 0 ? null : ve });

function grabadorAndroid(n: Nativo): Grabador {
  const avisos = oyentes();
  escuchar('cambio', avisos.avisar);
  return {
    donde: 'android',
    async empezar(id, destino, inicio) {
      const error = n.empezar(JSON.stringify({ id, destino, inicio }));
      if (error) throw new NoSePuede(error);
      // El servicio arranca un instante después del pedido: hasta que diga que graba, la
      // pantalla de grabación no tiene nada que mostrar.
      for (let i = 0; i < 50; i++) {
        const e = JSON.parse(n.estado()) as { grabando: boolean; id: string | null };
        if (e.grabando && e.id === id) return;
        await new Promise((ok) => setTimeout(ok, 100));
      }
      throw new NoSePuede('Android no arrancó la grabación. Probá de nuevo.');
    },
    async terminar() { n.terminar(); },
    async descartar() { n.descartar(); },
    estado() {
      const e = JSON.parse(n.estado()) as Omit<EstadoGrabacion, 'ultimo'> & { ultimo: FilaNativa | null };
      return { ...e, ultimo: e.ultimo ? dePunto(e.ultimo) : null };
    },
    async puntos(id, desde) {
      return (JSON.parse(n.puntos(id, desde)) as FilaNativa[]).map(dePunto);
    },
    async terminados() { return JSON.parse(n.terminados()) as Terminado[]; },
    async guardado(id) { n.guardado(id); },
    alCambiar: avisos.sumar,
  };
}

// ---------------------------------------------------------------- Web

/** De dónde salen los puntos: el GPS del navegador o uno de mentira. */
type Fuente = {
  mirar(alPunto: (p: Punto) => void, alError: (e: GeolocationPositionError) => void): () => void;
};

const fuenteReal: Fuente = {
  mirar(alPunto, alError) {
    const id = navigator.geolocation.watchPosition(
      (pos) => alPunto({
        t: pos.timestamp || Date.now(),
        la: pos.coords.latitude,
        lo: pos.coords.longitude,
        ac: pos.coords.accuracy,
        ve: pos.coords.speed,
      }),
      alError,
      { enableHighAccuracy: true, maximumAge: 0, timeout: 60_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  },
};

/** Recorre la ruta de prueba un punto por segundo, `rapidez` veces más rápido que el reloj. */
function fuenteSimulada(rapidez: number): Fuente {
  return {
    mirar(alPunto) {
      let parar = false;
      (async () => {
        const r = await fetch('datos/demo.json');
        const ruta = (await r.json()) as { puntos: Array<[number, number, number]> };
        const t0 = Date.now();
        for (const [s, la, lo] of ruta.puntos) {
          if (parar) return;
          const espera = t0 + (s * 1000) / rapidez - Date.now();
          if (espera > 0) await new Promise((ok) => setTimeout(ok, espera));
          if (parar) return;
          alPunto({ t: t0 + s * 1000, la, lo, ac: 6, ve: null });
        }
      })();
      return () => { parar = true; };
    },
  };
}

type EnCurso = { id: string; inicio: number; destino: Lugar | null };

function grabadorWeb(fuente: Fuente): Grabador {
  const avisos = oyentes();
  const avisar = avisos.avisar;
  let curso: EnCurso | null = null;
  let corte: (() => void) | null = null;
  let vigia: ReturnType<typeof crearVigia> | null = null;
  let recientes: Punto[] = [];
  let pendientes: Punto[] = [];
  let ultimo: Punto | null = null;
  let n = 0;
  let pantalla: { release(): Promise<void> } | null = null;
  let terminado: Terminado | null = null;

  /** La pantalla prendida mientras graba: si se apaga, el iPhone deja de mandar puntos. */
  async function mantenerPrendida() {
    try {
      const wl = (navigator as unknown as { wakeLock?: { request(t: string): Promise<{ release(): Promise<void> }> } }).wakeLock;
      if (wl && curso && document.visibilityState === 'visible') pantalla = await wl.request('screen');
    } catch {
      pantalla = null;
    }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && curso) mantenerPrendida();
  });

  async function volcar() {
    if (!curso || pendientes.length === 0) return;
    const lote = pendientes;
    pendientes = [];
    await base.agregarPuntos(curso.id, lote);
  }

  async function cortar(motivo: Motivo) {
    if (!curso) return;
    corte?.();
    corte = null;
    await volcar();
    terminado = { id: curso.id, inicio: curso.inicio, fin: Date.now(), motivo, destino: curso.destino };
    await base.guardarAjuste('grabacionWeb', null);
    curso = null;
    vigia = null;
    pantalla?.release().catch(() => {});
    pantalla = null;
    avisar();
  }

  function alPunto(p: Punto) {
    if (!curso || !vigia) return;
    if (ultimo && p.t <= ultimo.t) return;
    ultimo = p;
    n++;
    recientes.push(p);
    pendientes.push(p);
    if (pendientes.length >= 5) volcar();
    const v = vigia.agregar(p);
    avisar();
    if (v !== 'sigue') cortar(v === 'llego' ? 'llegada' : v);
  }

  function arrancar(c: EnCurso) {
    curso = c;
    vigia = crearVigia(c.destino, c.inicio);
    corte = fuente.mirar(alPunto, (e) => {
      // Sin permiso no hay nada que hacer; las otras fallas (sin señal un rato) se reintentan solas.
      if (e.code === e.PERMISSION_DENIED) cortar('manual');
    });
    mantenerPrendida();
  }

  return {
    donde: 'web',
    async empezar(id, destino, inicio) {
      if (!navigator.geolocation) throw new NoSePuede('Este navegador no da la ubicación.');
      if (curso) throw new NoSePuede('Ya está grabando un viaje.');
      // Pedir el permiso antes de dar el viaje por empezado: si lo niega, no queda nada a medias.
      await new Promise<void>((ok, mal) => {
        if (fuente !== fuenteReal) return ok();
        navigator.geolocation.getCurrentPosition(() => ok(), (e) => {
          mal(new NoSePuede(e.code === e.PERMISSION_DENIED
            ? 'Hace falta el permiso de ubicación para grabar. En el iPhone: Ajustes → Privacidad → Localización.'
            : 'No se pudo leer el GPS. Probá de nuevo al aire libre.'));
        }, { enableHighAccuracy: true, timeout: 30_000, maximumAge: 60_000 });
      });
      recientes = [];
      pendientes = [];
      ultimo = null;
      n = 0;
      terminado = null;
      const c = { id, inicio, destino };
      await base.guardarAjuste('grabacionWeb', c);
      arrancar(c);
    },
    terminar: () => cortar('manual'),
    async descartar() {
      if (!curso) return;
      const id = curso.id;
      await cortar('manual');
      terminado = null;
      await base.borrarViaje(id);
    },
    estado() {
      return { grabando: !!curso, id: curso?.id ?? null, inicio: curso?.inicio ?? 0, destino: curso?.destino ?? null, ultimo, n };
    },
    async puntos(id, desde) {
      if (curso && curso.id === id && desde >= n - recientes.length) {
        return recientes.slice(desde - (n - recientes.length));
      }
      await volcar();
      return (await base.puntos(id)).slice(desde);
    },
    async terminados() {
      if (terminado) return [terminado];
      // La página se cerró grabando (el iPhone la descarta en segundo plano): si fue hace poco,
      // se sigue grabando el mismo viaje; si no, se da por terminado donde quedó.
      const c = await base.ajuste<EnCurso | null>('grabacionWeb');
      if (!c || curso) return [];
      const ps = await base.puntos(c.id);
      const u = ps[ps.length - 1];
      if (u && Date.now() - u.t < 20 * 60_000) {
        recientes = ps;
        n = ps.length;
        ultimo = u;
        arrancar(c);
        for (const p of ps) vigia?.agregar(p);
        return [];
      }
      await base.guardarAjuste('grabacionWeb', null);
      return [{ id: c.id, inicio: c.inicio, fin: u?.t ?? c.inicio, motivo: 'manual', destino: c.destino }];
    },
    async guardado(id) {
      if (terminado?.id === id) terminado = null;
    },
    alCambiar: avisos.sumar,
  };
}

/** El grabador que corresponde: el nativo en el APK, el de la página en el navegador. */
export function elegirGrabador(): Grabador {
  const n = nativo();
  if (n) return grabadorAndroid(n);
  const sim = new URLSearchParams(location.search).get('simular');
  return grabadorWeb(sim ? fuenteSimulada(Math.max(1, Number(sim) || 10)) : fuenteReal);
}
