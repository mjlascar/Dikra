/**
 * Ajustes: el respaldo (un archivo con todo), y lo propio de cada teléfono: en el APK la
 * actualización, los permisos y la batería; en el iPhone, cómo instalarla.
 */
import type { Limpieza } from '../app.ts';
import { VERSION } from '../app.ts';
import * as base from '../base.ts';
import { recalcularTodo } from '../control.ts';
import { nativo } from '../grabador.ts';
import { escuchar } from '../puente.ts';
import { agregar, aviso, h } from '../ui.ts';

type Permisos = { ubicacion: 'precisa' | 'aproximada' | 'no'; notificaciones: boolean; gps: boolean; bateria: boolean };
type Actualizacion = {
  estado: 'nada' | 'buscando' | 'aldia' | 'hay' | 'permiso' | 'bajando' | 'instalando' | 'error';
  version?: string;
  instalada: string;
  porcentaje?: number;
  detalle?: string;
};

async function guardarRespaldo() {
  const r = await base.exportar();
  const texto = JSON.stringify(r);
  const fecha = new Date().toISOString().slice(0, 10);
  const nombre = `dikra-respaldo-${fecha}.json`;
  const n = nativo();
  if (n) {
    n.guardar(nombre, texto);
    return;
  }
  const archivo = new File([texto], nombre, { type: 'application/json' });
  // En el iPhone, compartir deja elegir «Guardar en Archivos».
  if (navigator.canShare?.({ files: [archivo] })) {
    try {
      await navigator.share({ files: [archivo], title: 'Respaldo de Dikra' });
      return;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
    }
  }
  const a = h('a', { href: URL.createObjectURL(archivo), download: nombre });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

async function cargarRespaldo(archivo: File) {
  try {
    const r = JSON.parse(await archivo.text()) as base.Respaldo;
    const { viajes, lugares } = await base.importar(r);
    aviso(viajes || lugares
      ? `Se agregaron ${viajes} ${viajes === 1 ? 'viaje' : 'viajes'} y ${lugares} ${lugares === 1 ? 'lugar' : 'lugares'}. Lo que ya estaba no se tocó.`
      : 'Ya estaba todo: no se agregó nada.', 7000);
    if (viajes || lugares) recalcularTodo();
  } catch (e) {
    aviso('No se pudo cargar: ' + (e as Error).message, 7000);
  }
}

export async function pantallaAjustes(caja: HTMLElement): Promise<Limpieza> {
  const archivo = h('input', { type: 'file', accept: 'application/json,.json', hidden: true }) as HTMLInputElement;
  archivo.addEventListener('change', () => {
    const f = archivo.files?.[0];
    if (f) cargarRespaldo(f);
    archivo.value = '';
  });
  const guardar = h('button', { class: 'boton secundario' }, 'Guardar respaldo');
  guardar.addEventListener('click', () => guardarRespaldo().catch((e) => aviso('No se pudo guardar: ' + (e as Error).message)));
  const cargar = h('button', { class: 'boton' }, 'Cargar un respaldo');
  cargar.addEventListener('click', () => archivo.click());

  agregar(caja, 
    h('header', { class: 'cabeza' }, h('h1', {}, 'Ajustes')),
    h('section', { class: 'tarjeta' },
      h('h2', {}, 'Respaldo'),
      h('p', {}, 'Todo queda en este teléfono. El respaldo es un archivo con los viajes y los lugares: guardalo de vez en cuando. Al cargarlo se agrega lo que falta, sin pisar nada.'),
      h('div', { class: 'botones-viaje' }, cargar, guardar),
      archivo),
  );

  const n = nativo();
  let limpiar: (() => void) | undefined;
  if (n) {
    const cajaVersion = h('section', { class: 'tarjeta' });
    const cajaPermisos = h('section', { class: 'tarjeta' });
    const pintarVersion = () => {
      const a = JSON.parse(n.actualizacion()) as Actualizacion;
      const texto: Record<Actualizacion['estado'], string> = {
        nada: '',
        buscando: 'Buscando una versión nueva…',
        aldia: 'Es la última versión.',
        hay: `Hay una versión nueva: ${a.version}.`,
        permiso: 'Para actualizarse sola, Android tiene que dejar que Dikra instale apps. Tocá Actualizar y habilitalo.',
        bajando: `Bajando la ${a.version}… ${a.porcentaje ?? 0} %`,
        instalando: 'Instalando: si Android pregunta, aceptá.',
        error: `No se pudo: ${a.detalle ?? 'sin detalle'}.`,
      };
      const boton = h('button', { class: a.estado === 'hay' || a.estado === 'permiso' || a.estado === 'error' ? 'boton principal' : 'boton' },
        a.estado === 'hay' || a.estado === 'permiso' || a.estado === 'error' ? 'Actualizar' : 'Buscar actualización');
      boton.addEventListener('click', () => (a.estado === 'hay' || a.estado === 'permiso' || a.estado === 'error' ? n.actualizar() : n.buscarActualizacion()));
      if (a.estado === 'buscando' || a.estado === 'bajando' || a.estado === 'instalando') boton.setAttribute('disabled', '');
      cajaVersion.replaceChildren();
      agregar(cajaVersion,
        h('h2', {}, 'Versión'),
        h('p', {}, `Dikra ${a.instalada}.`),
        texto[a.estado] ? h('p', {}, texto[a.estado]) : null,
        boton,
        h('p', { class: 'nota' }, 'Con Slowtown activo, para instalar hace falta «Habilitar todo» un rato, como con Waltra.'));
    };
    const pintarPermisos = () => {
      const p = JSON.parse(n.permisos()) as Permisos;
      const fila = (ok: boolean, texto: string, accion: string, fn: () => void) => {
        const b = ok ? null : h('button', { class: 'boton chico' }, accion);
        b?.addEventListener('click', fn);
        return h('li', { class: ok ? 'bien' : 'falta' }, h('span', {}, (ok ? '✓ ' : '✗ ') + texto), b);
      };
      cajaPermisos.replaceChildren(
        h('h2', {}, 'Para que grabe bien'),
        h('ul', { class: 'chequeo' },
          fila(p.ubicacion === 'precisa', 'Ubicación precisa', 'Dar permiso', () => n.pedirPermisos()),
          fila(p.gps, 'GPS prendido', 'Prender', () => n.abrirAjustes('ubicacion')),
          fila(p.notificaciones, 'Avisos (el de «Grabando» y el de llegada)', 'Permitir', () => n.pedirPermisos()),
          fila(p.bateria, 'Android no la frena para ahorrar batería', 'Cambiar', () => n.abrirAjustes('bateria'))),
        h('p', { class: 'nota' }, 'Si usás Slowtown: Dikra no tiene que estar entre las bloqueadas, su aviso de «Grabando» no va entre las fijas que se esconden, y si manejás de noche sumala a lo que se abre en Bedtime.'));
    };
    pintarVersion();
    pintarPermisos();
    agregar(caja, cajaVersion, cajaPermisos);
    const sacar = [escuchar('actualizacion', pintarVersion), escuchar('permisos', pintarPermisos)];
    const alVolver = () => { if (document.visibilityState === 'visible') pintarPermisos(); };
    document.addEventListener('visibilitychange', alVolver);
    limpiar = () => {
      sacar.forEach((f) => f());
      document.removeEventListener('visibilitychange', alVolver);
    };
  } else {
    agregar(caja, h('section', { class: 'tarjeta' },
      h('h2', {}, 'En el iPhone'),
      h('p', {}, 'Agregala a la pantalla de inicio: en Safari, Compartir → «Agregar a inicio». Así se abre como una app y guarda los viajes aparte del navegador.'),
      h('p', {}, 'Mientras graba, dejá Dikra abierta y la pantalla prendida (en el soporte del auto, cargando). Si pasás a otra app o se bloquea la pantalla, el iPhone no le da el GPS y ese pedazo no se graba.')));
  }

  agregar(caja, h('p', { class: 'pie' }, `Dikra ${VERSION} · Calles © colaboradores de OpenStreetMap (ODbL)`));
  return limpiar;
}
