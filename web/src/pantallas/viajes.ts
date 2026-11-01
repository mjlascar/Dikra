/** La lista de viajes y cada viaje en el mapa, con su resumen y cómo terminó. */
import type { Limpieza } from '../app.ts';
import * as base from '../base.ts';
import type { Viaje } from '../base.ts';
import { titulo } from '../control.ts';
import * as formato from '../formato.ts';
import { crearMapa, TRAMOS_VELOCIDAD } from '../mapa.ts';
import { agregar, aviso, h, icono, preguntar } from '../ui.ts';
import { limpiar, velocidades } from '../viaje.ts';

export async function pantallaViajes(caja: HTMLElement): Promise<Limpieza> {
  const [vs, ls] = await Promise.all([base.viajes(), base.lugares()]);
  const listos = vs.filter((v) => v.estado === 'listo' && v.resumen);
  agregar(caja, h('header', { class: 'cabeza' }, h('h1', {}, 'Viajes'),
    h('p', { class: 'bajada' }, listos.length ? `${listos.length} ${listos.length === 1 ? 'viaje' : 'viajes'} guardados en este teléfono.` : '')));
  if (!listos.length) {
    agregar(caja, h('p', { class: 'vacio' }, 'Todavía no hay viajes. Grabá el primero desde Grabar.'));
    return;
  }
  // agrupados por día
  const grupos = new Map<string, Viaje[]>();
  for (const v of listos) {
    const d = formato.dia(v.resumen!.salida);
    grupos.set(d, [...(grupos.get(d) ?? []), v]);
  }
  for (const [dia, lista] of grupos) {
    agregar(caja, h('section', {},
      h('h2', { class: 'dia' }, dia),
      h('ul', { class: 'lista' }, lista.map((v) => {
        const r = v.resumen!;
        return h('li', {}, h('a', { href: '#/viaje/' + v.id, class: 'fila-viaje' },
          h('span', { class: 'fila-arriba' }, h('span', {}, titulo(v, ls)), h('strong', {}, formato.duracion(r.duracion))),
          h('span', { class: 'fila-abajo' }, `${formato.hora(r.salida)} a ${formato.hora(r.llegada)} · ${formato.distancia(r.distancia)}`)));
      }))));
  }
}

/** Cómo terminó, dicho para la persona. */
function comoTermino(v: Viaje, destino: string | undefined): string[] {
  const r = v.resumen!;
  const out: string[] = [];
  if (r.corte === 'llegada' && v.motivo === 'llegada') out.push(`Cortó sola al llegar${destino ? ' a ' + destino : ''}.`);
  else if (r.corte === 'llegada') {
    out.push(`Llegaste${destino ? ' a ' + destino : ''} a las ${formato.hora(r.llegada)}.`);
    if (r.sobra > 60_000) out.push(`Siguió grabando ${formato.duracion(r.sobra)} más: eso se recortó.`);
  } else if (r.corte === 'quieto') {
    out.push(`Terminó donde paraste, a las ${formato.hora(r.llegada)}.`);
    if (r.sobra > 60_000) out.push(`Lo que siguió grabando (${formato.duracion(r.sobra)}) se recortó.`);
  } else if (v.motivo === 'largo') out.push('Cortó sola a las 4 horas de grabar.');
  else out.push(`Lo terminaste vos a las ${formato.hora(r.llegada)}.`);
  if (r.salida - v.inicio > 60_000) {
    out.push(`Tocaste grabar a las ${formato.hora(v.inicio)} y arrancaste a las ${formato.hora(r.salida)}: la espera no cuenta.`);
  }
  return out;
}

export async function pantallaViaje(caja: HTMLElement, id: string): Promise<Limpieza> {
  const [v, ls] = await Promise.all([base.viaje(id), base.lugares()]);
  const volver = h('a', { href: '#/viajes', class: 'volver' }, icono('atras'), 'Viajes');
  if (!v || !v.resumen) {
    agregar(caja, volver, h('p', { class: 'vacio' }, 'No encontré ese viaje.'));
    return;
  }
  const r = v.resumen;
  const p = limpiar(await base.puntos(id));
  const tramo = p.slice(r.iSalida, r.iLlegada + 1);
  const destino = ls.find((l) => l.id === r.destinoId)?.nombre ?? v.destino?.nombre;
  const cajaMapa = h('div', { class: 'mapa' });
  const promedio = r.duracion > 0 ? r.distancia / (r.duracion / 1000) : 0;
  const borrar = h('button', { class: 'boton peligro-suave ancho' }, icono('basura'), 'Borrar este viaje');

  agregar(caja, 
    volver,
    h('header', { class: 'cabeza' },
      h('h1', {}, titulo(v, ls)),
      h('p', { class: 'bajada' }, `${formato.diaLargo(r.salida)} · ${formato.hora(r.salida)} a ${formato.hora(r.llegada)}`)),
    cajaMapa,
    h('div', { class: 'leyenda' }, TRAMOS_VELOCIDAD.map((t) =>
      h('span', {}, h('i', { style: `background:${t.color}` }), t.nombre))),
    h('div', { class: 'datos cuatro' },
      h('div', {}, h('span', {}, 'Tardaste'), h('strong', {}, formato.duracion(r.duracion))),
      h('div', {}, h('span', {}, 'Recorrido'), h('strong', {}, formato.distancia(r.distancia))),
      h('div', {}, h('span', {}, 'Promedio'), h('strong', {}, formato.velocidad(promedio))),
      h('div', {}, h('span', {}, 'Parado'), h('strong', {}, formato.duracion(r.parado)))),
    h('section', { class: 'tarjeta' }, comoTermino(v, destino).map((t) => h('p', {}, t))),
    borrar,
  );

  const mapa = crearMapa(cajaMapa);
  mapa.lugares(ls);
  mapa.traza(tramo, velocidades(tramo));
  mapa.encuadrar(tramo);

  borrar.addEventListener('click', async () => {
    if (!(await preguntar('¿Borrar este viaje?', 'Se borra del teléfono. Si tenés un respaldo, queda ahí.', 'Borrar', 'Cancelar', true))) return;
    await base.borrarViaje(id);
    aviso('Viaje borrado.');
    location.hash = '#/viajes';
  });
  return () => mapa.destruir();
}
