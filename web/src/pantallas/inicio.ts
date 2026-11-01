/**
 * Inicio: los botones para salir hacia cada destino y, mientras graba, el reloj, el mapa y
 * cómo va el GPS.
 */
import type { Limpieza } from '../app.ts';
import { mostrar } from '../app.ts';
import * as base from '../base.ts';
import { empezarViaje, grabador, ponerAlDia, titulo } from '../control.ts';
import * as formato from '../formato.ts';
import { type Lugar, type Punto, entre } from '../geo.ts';
import { NoSePuede, nativo } from '../grabador.ts';
import { crearMapa } from '../mapa.ts';
import { esperar } from '../puente.ts';
import { agregar, aviso, h, icono, preguntar } from '../ui.ts';
import { REGLAS, limpiar, velocidades } from '../viaje.ts';

export async function pantallaInicio(caja: HTMLElement): Promise<Limpieza> {
  return grabador.estado().grabando ? grabando(caja) : quieto(caja);
}

type Permisos = { ubicacion: 'precisa' | 'aproximada' | 'no'; notificaciones: boolean; gps: boolean; bateria: boolean };

/** En el APK: ubicación precisa y el GPS prendido, o un error que dice qué falta. */
async function asegurarPermisos() {
  const n = nativo();
  if (!n) return;
  let p = JSON.parse(n.permisos()) as Permisos;
  if (p.ubicacion !== 'precisa' || !p.notificaciones) {
    const respuesta = esperar<Permisos>('permisos');
    n.pedirPermisos();
    p = await respuesta;
  }
  if (p.ubicacion !== 'precisa') {
    const ir = await preguntar(
      p.ubicacion === 'no' ? 'Falta el permiso de ubicación' : 'Hace falta la ubicación precisa',
      'Para medir los tramos, Dikra necesita la ubicación precisa mientras graba. Se da en los ajustes de la app, en Permisos → Ubicación.',
      'Abrir ajustes');
    if (ir) n.abrirAjustes('app');
    throw new NoSePuede('');
  }
  if (!p.gps) {
    const ir = await preguntar('La ubicación del teléfono está apagada', 'Prendela para grabar el viaje.', 'Prender');
    if (ir) n.abrirAjustes('ubicacion');
    throw new NoSePuede('');
  }
}

async function salir(destino: Lugar | null, boton: HTMLButtonElement) {
  boton.disabled = true;
  try {
    await asegurarPermisos();
    await empezarViaje(destino);
    mostrar();
  } catch (e) {
    boton.disabled = false;
    const texto = (e as Error).message;
    if (texto) aviso(texto, 7000);
    if (!(e instanceof NoSePuede)) console.error(e);
  }
}

async function quieto(caja: HTMLElement): Promise<Limpieza> {
  const [ls, vs] = await Promise.all([base.lugares(), base.viajes()]);
  const destinos = ls.filter((l) => l.destino);
  const ultimos = vs.filter((v) => v.estado === 'listo' && v.resumen).slice(0, 5);

  const botonDestino = (l: Lugar) => {
    const b = h('button', { class: 'salir' },
      h('span', { class: 'salir-flecha' }, icono('flecha')),
      h('span', { class: 'salir-texto' },
        h('strong', {}, l.nombre),
        h('small', {}, 'Grabar desde acá. Corta sola al llegar.')));
    b.addEventListener('click', () => salir(l, b));
    return b;
  };
  const sinDestino = h('button', { class: 'boton secundario ancho' }, 'Grabar sin destino');
  sinDestino.addEventListener('click', () => salir(null, sinDestino));

  agregar(caja, 
    h('header', { class: 'cabeza' },
      h('h1', {}, 'Dikra'),
      h('p', { class: 'bajada' }, 'Cuánto tardás en cada camino.')),
    destinos.length
      ? h('section', { class: 'destinos' }, destinos.map(botonDestino))
      : h('section', { class: 'tarjeta primera' },
        h('h2', {}, 'Primero, el terreno'),
        h('p', {}, 'Guardá el lugar adonde vas. Cuando estés ahí tocá «Estoy acá», o marcalo en el mapa. Después aparece acá como botón para salir.'),
        h('a', { class: 'boton principal', href: '#/lugar/nuevo' }, 'Guardar el terreno')),
    h('div', { class: 'fila-centro' }, sinDestino),
    h('p', { class: 'nota' }, destinos.length
      ? 'Sin destino corta sola si quedás quieto 15 minutos.'
      : 'Sin destino también graba: corta sola si quedás quieto 15 minutos.'),
    !nativo() ? h('p', { class: 'nota iphone' }, 'En el iPhone graba con Dikra abierta y la pantalla prendida.') : null,
    ultimos.length
      ? h('section', {},
        h('div', { class: 'titulo-seccion' }, h('h2', {}, 'Últimos viajes'), h('a', { href: '#/viajes' }, 'Ver todos')),
        h('ul', { class: 'lista' }, ultimos.map((v) => {
          const r = v.resumen!;
          return h('li', {}, h('a', { href: '#/viaje/' + v.id, class: 'fila-viaje' },
            h('span', { class: 'fila-arriba' }, h('span', {}, titulo(v, ls)), h('strong', {}, formato.duracion(r.duracion))),
            h('span', { class: 'fila-abajo' }, `${formato.dia(r.salida)} · ${formato.hora(r.salida)} · ${formato.distancia(r.distancia)}`)));
        })))
      : null,
  );
}

async function grabando(caja: HTMLElement): Promise<Limpieza> {
  const e0 = grabador.estado();
  const id = e0.id!;
  const crudos: Punto[] = [];
  let terminando = false, ocultoDesde = 0, perdido = 0;

  const reloj = h('div', { class: 'reloj', 'aria-live': 'off' }, formato.reloj(Date.now() - e0.inicio));
  const datoDist = h('strong', {}, '—'), datoVel = h('strong', {}, '—'), datoGps = h('strong', {}, '—');
  const estadoGps = h('p', { class: 'nota' }, 'Buscando señal de GPS…');
  const cajaMapa = h('div', { class: 'mapa vivo' });
  const terminar = h('button', { class: 'boton principal' }, icono('bandera'), 'Terminar');
  const descartar = h('button', { class: 'boton peligro-suave' }, 'Descartar');

  agregar(caja, 
    h('header', { class: 'cabeza grabando' },
      h('p', { class: 'etiqueta' }, h('span', { class: 'punto-rojo' }), 'Grabando'),
      h('h1', {}, e0.destino ? `→ ${e0.destino.nombre}` : 'Sin destino'),
      reloj),
    h('div', { class: 'datos' },
      h('div', {}, h('span', {}, 'Recorrido'), datoDist),
      h('div', {}, h('span', {}, 'Velocidad'), datoVel),
      h('div', {}, h('span', {}, 'GPS'), datoGps)),
    estadoGps,
    !nativo() ? h('p', { class: 'nota iphone' }, 'Dejá Dikra abierta y la pantalla prendida: si se va atrás, deja de grabar hasta que vuelvas.') : null,
    cajaMapa,
    h('div', { class: 'botones-viaje' }, descartar, terminar),
    h('p', { class: 'nota' }, e0.destino
      ? `Corta sola al llegar a ${e0.destino.nombre}. Si te olvidás, el viaje se recorta en la llegada.`
      : 'Corta sola si quedás quieto 15 minutos.'),
  );

  const mapa = crearMapa(cajaMapa);
  mapa.seguir(true);
  if (e0.destino) mapa.lugares([e0.destino]);
  mapa.encuadrar(e0.destino ? [e0.destino] : [], 1500);

  async function tick() {
    if (terminando) return;
    const e = grabador.estado();
    if (!e.grabando || e.id !== id) {
      terminando = true;
      await ponerAlDia();
      // Lo puede haber guardado otro (al volver a la app): se mira en la base, no en lo que
      // devolvió esta vuelta.
      const v = await base.viaje(id);
      if (v?.estado === 'listo' && v.resumen) {
        const ls = await base.lugares();
        aviso(`${v.motivo === 'llegada' ? 'Llegaste' : 'Viaje guardado'}: ${titulo(v, ls)}, ${formato.duracion(v.resumen!.duracion)}`);
        location.hash = '#/viaje/' + id;
      } else {
        aviso('La grabación no tenía viaje (no te moviste): no quedó guardada.');
        mostrar();
      }
      return;
    }
    reloj.textContent = formato.reloj(Date.now() - e.inicio);
    const nuevos = await grabador.puntos(id, crudos.length);
    if (nuevos.length) {
      crudos.push(...nuevos);
      const p = limpiar(crudos), v = velocidades(p);
      let d = 0;
      for (let i = 1; i < p.length; i++) if (v[i] >= REGLAS.parado || v[i - 1] >= REGLAS.parado) d += entre(p[i - 1], p[i]);
      datoDist.textContent = formato.distancia(d);
      datoVel.textContent = p.length ? formato.velocidad(v[v.length - 1]) : '—';
      mapa.traza(p, v);
    }
    const u = e.ultimo;
    if (u) {
      datoGps.textContent = `±${Math.round(u.ac)} m`;
      mapa.yo(u);
      const hace = Date.now() - u.t;
      estadoGps.textContent = hace > 20_000 ? `Sin señal de GPS hace ${formato.duracion(hace)}.` : '';
    }
    if (perdido) {
      estadoGps.textContent = `Dikra estuvo atrás ${formato.duracion(perdido)}: ese pedazo no se grabó.`;
      perdido = 0;
    }
  }

  terminar.addEventListener('click', async () => {
    if (!(await preguntar('¿Terminar el viaje acá?', 'Se guarda lo grabado hasta ahora.', 'Terminar'))) return;
    terminar.disabled = true;
    await grabador.terminar();
    tick();
  });
  descartar.addEventListener('click', async () => {
    if (!(await preguntar('¿Descartar este viaje?', 'No queda nada guardado de esta grabación.', 'Descartar', 'Seguir grabando', true))) return;
    terminando = true;
    await grabador.descartar();
    await base.borrarViaje(id);
    aviso('Grabación descartada.');
    mostrar();
  });

  // En la web, lo que estuvo atrás no se grabó: se avisa al volver.
  const alVerse = () => {
    if (nativo()) return;
    if (document.visibilityState === 'hidden') ocultoDesde = Date.now();
    else if (ocultoDesde) {
      const lapso = Date.now() - ocultoDesde;
      ocultoDesde = 0;
      if (lapso > 5000) perdido = lapso;
      tick();
    }
  };
  document.addEventListener('visibilitychange', alVerse);
  const dejar = grabador.alCambiar(() => tick());
  const intervalo = window.setInterval(tick, 1000);
  tick();
  return () => {
    clearInterval(intervalo);
    dejar();
    terminando = true;
    document.removeEventListener('visibilitychange', alVerse);
    mapa.destruir();
  };
}
