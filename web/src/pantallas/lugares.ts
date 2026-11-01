/**
 * Los lugares: Casa, Trabajo, el terreno. Un círculo con nombre; los que son destino aparecen en
 * Inicio como botón. Se marcan con «Estoy acá» o moviendo el mapa hasta la mira.
 */
import type { Limpieza } from '../app.ts';
import * as base from '../base.ts';
import { nuevoId, recalcularTodo } from '../control.ts';
import type { Lugar } from '../geo.ts';
import { crearMapa } from '../mapa.ts';
import { agregar, aviso, h, icono, preguntar } from '../ui.ts';

const RADIOS = [50, 100, 150, 250];

export async function pantallaLugares(caja: HTMLElement): Promise<Limpieza> {
  const ls = await base.lugares();
  agregar(caja, 
    h('header', { class: 'cabeza' }, h('h1', {}, 'Lugares'),
      h('p', { class: 'bajada' }, 'Adonde vas y de donde salís. Al llegar a un destino, la grabación corta sola.')),
    ls.length
      ? h('ul', { class: 'lista' }, ls.map((l) => h('li', {},
        h('a', { href: '#/lugar/' + l.id, class: 'fila-viaje' },
          h('span', { class: 'fila-arriba' }, h('span', {}, l.nombre), l.destino ? h('span', { class: 'chapita' }, 'destino') : null),
          h('span', { class: 'fila-abajo' }, `Círculo de ${l.radio} m`)))))
      : h('p', { class: 'vacio' }, 'Todavía no hay lugares. Empezá por el terreno.'),
    h('a', { class: 'boton principal ancho', href: '#/lugar/nuevo' }, 'Agregar un lugar'),
  );
}

/** Una posición del GPS, una sola vez. */
function dondeEstoy(): Promise<GeolocationPosition> {
  return new Promise((ok, mal) => {
    if (!navigator.geolocation) return mal(new Error('Este navegador no da la ubicación.'));
    navigator.geolocation.getCurrentPosition(ok, (e) => mal(new Error(
      e.code === e.PERMISSION_DENIED ? 'No hay permiso de ubicación.' : 'No se pudo leer el GPS.')),
    { enableHighAccuracy: true, timeout: 30_000, maximumAge: 10_000 });
  });
}

export async function pantallaLugar(caja: HTMLElement, id: string): Promise<Limpieza> {
  const ls = await base.lugares();
  const previo = id === 'nuevo' ? null : ls.find((l) => l.id === id) ?? null;
  if (id !== 'nuevo' && !previo) {
    agregar(caja, h('p', { class: 'vacio' }, 'No encontré ese lugar.'));
    return;
  }
  const primero = !ls.some((l) => l.destino);
  const lugar: Lugar = previo
    ? { ...previo }
    : { id: nuevoId('l'), nombre: primero ? 'Terreno' : '', la: -37.98, lo: -57.6, radio: 100, destino: primero };

  const nombre = h('input', { type: 'text', value: lugar.nombre, maxlength: 40, placeholder: 'Casa, Trabajo, Terreno…', autocomplete: 'off' });
  const destino = h('input', { type: 'checkbox' }) as HTMLInputElement;
  destino.checked = lugar.destino;
  const radios = h('div', { class: 'opciones', role: 'radiogroup' });
  const pintarRadios = () => radios.replaceChildren(...RADIOS.map((r) => {
    const b = h('button', { type: 'button', class: r === lugar.radio ? 'opcion activa' : 'opcion', role: 'radio', 'aria-checked': String(r === lugar.radio) }, `${r} m`);
    b.addEventListener('click', () => { lugar.radio = r; pintarRadios(); mover(); });
    return b;
  }));
  pintarRadios();
  const cajaMapa = h('div', { class: 'mapa elegir' }, h('div', { class: 'mira' }, icono('mira', 'icono mira-icono')));
  const estoyAca = h('button', { type: 'button', class: 'boton secundario' }, icono('yo'), 'Estoy acá');
  const guardar = h('button', { type: 'button', class: 'boton principal' }, 'Guardar');
  const borrar = previo ? h('button', { type: 'button', class: 'boton peligro-suave ancho' }, icono('basura'), 'Borrar este lugar') : null;

  agregar(caja, 
    h('a', { href: '#/lugares', class: 'volver' }, icono('atras'), 'Lugares'),
    h('header', { class: 'cabeza' }, h('h1', {}, previo ? previo.nombre : 'Lugar nuevo'),
      h('p', { class: 'bajada' }, 'Mové el mapa hasta que la mira quede sobre el lugar, o tocá «Estoy acá» si estás ahí.')),
    cajaMapa,
    h('div', { class: 'fila-centro' }, estoyAca),
    h('label', { class: 'campo' }, h('span', {}, 'Nombre'), nombre),
    h('div', { class: 'campo' }, h('span', {}, 'Tamaño del círculo'), radios,
      h('small', {}, 'Cuando entrás al círculo, llegaste. Que tome la entrada del terreno con un poco de margen.')),
    h('label', { class: 'campo tilde' }, destino, h('span', {}, 'Es un destino: aparece en Grabar como botón')),
    h('div', { class: 'botones-viaje' }, h('a', { class: 'boton', href: '#/lugares' }, 'Cancelar'), guardar),
    borrar,
  );

  const mapa = crearMapa(cajaMapa);
  const otros = ls.filter((l) => l.id !== lugar.id);
  function mover() {
    const c = mapa.centro();
    lugar.la = c.la;
    lugar.lo = c.lo;
    mapa.lugares([...otros, { ...lugar, nombre: nombre.value.trim() || 'Acá' }]);
  }
  mapa.alMover(mover);
  nombre.addEventListener('input', mover);
  if (previo) mapa.encuadrar([previo], previo.radio * 6);
  else {
    // de entrada, donde terminó el último viaje (lo más probable para el terreno), o el centro
    const vs = await base.viajes();
    const u = vs.find((v) => v.resumen);
    const ps = u ? await base.puntos(u.id) : [];
    const fin = ps[u?.resumen?.iLlegada ?? -1] ?? ps[ps.length - 1];
    mapa.encuadrar(fin ? [fin] : [{ la: -37.99, lo: -57.58 }], fin ? 600 : 9000);
  }
  requestAnimationFrame(mover);

  estoyAca.addEventListener('click', async () => {
    estoyAca.disabled = true;
    estoyAca.lastChild!.textContent = 'Buscando…';
    try {
      const pos = await dondeEstoy();
      const p = { la: pos.coords.latitude, lo: pos.coords.longitude, ac: pos.coords.accuracy };
      mapa.yo(p);
      mapa.encuadrar([p], lugar.radio * 6);
      requestAnimationFrame(mover);
      if (p.ac > 50) aviso(`El GPS da ±${Math.round(p.ac)} m: si podés, esperá un poco al aire libre y tocá de nuevo.`);
    } catch (e) {
      aviso((e as Error).message);
    } finally {
      estoyAca.disabled = false;
      estoyAca.lastChild!.textContent = 'Estoy acá';
    }
  });

  guardar.addEventListener('click', async () => {
    const n = nombre.value.trim();
    if (!n) {
      aviso('Ponele un nombre.');
      nombre.focus();
      return;
    }
    mover();
    const nuevo: Lugar = { ...lugar, nombre: n, destino: destino.checked };
    await base.guardarLugar(nuevo);
    const cambio = !previo || previo.la !== nuevo.la || previo.lo !== nuevo.lo || previo.radio !== nuevo.radio;
    aviso(cambio && (await base.viajes()).length
      ? `${n} guardado. Los viajes se recalculan con este lugar.`
      : `${n} guardado.`);
    location.hash = '#/lugares';
    if (cambio) recalcularTodo();
  });

  borrar?.addEventListener('click', async () => {
    if (!(await preguntar(`¿Borrar ${previo!.nombre}?`, 'Los viajes no se borran.', 'Borrar', 'Cancelar', true))) return;
    await base.borrarLugar(previo!.id);
    aviso(`${previo!.nombre} borrado.`);
    location.hash = '#/lugares';
    recalcularTodo();
  });

  return () => mapa.destruir();
}
