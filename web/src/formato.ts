/** Cómo se muestran los números: tiempos, distancias, horas y días, en castellano. */

const MIN = 60_000;

/** «24 min», «1 h 05 min», «40 s». */
export function duracion(ms: number): string {
  if (!isFinite(ms) || ms < 0) return '—';
  if (ms < MIN) return `${Math.round(ms / 1000)} s`;
  const m = Math.round(ms / MIN);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

/** El reloj de la grabación: «12:34» o «1:02:03». */
export function reloj(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const dd = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${dd(m)}:${dd(r)}` : `${dd(m)}:${dd(r)}`;
}

const numero = (n: number, dec: number) =>
  n.toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec });

/** «21,3 km», «850 m». */
export const distancia = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${numero(m / 1000, 1)} km`);

/** De m/s a «53 km/h». */
export const velocidad = (ms: number) => `${Math.round(ms * 3.6)} km/h`;

/** «08:36». */
export const hora = (t: number) =>
  new Date(t).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });

const DIA = 86_400_000;
const inicioDelDia = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** «Hoy», «Ayer», «lun 2 nov». */
export function dia(t: number): string {
  const hoy = inicioDelDia(Date.now()), d = inicioDelDia(t);
  if (d === hoy) return 'Hoy';
  if (d === hoy - DIA) return 'Ayer';
  return new Date(t).toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/\./g, '');
}

/** «lunes 2 de noviembre». */
export const diaLargo = (t: number) =>
  new Date(t).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
