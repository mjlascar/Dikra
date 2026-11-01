/**
 * Lo que el APK le avisa a la página. MainActivity.java llama `window.__dikra(tipo, json)`:
 *
 * - `permisos`: terminó de preguntar los permisos (trae lo mismo que `DikraNativo.permisos()`).
 * - `cambio`: el grabador cortó o cambió algo que conviene mirar ya.
 * - `abrir`: se tocó la notificación de un viaje (trae el id).
 * - `actualizacion`: cambió el estado de la actualización.
 */
type Oyente = (dato: unknown) => void;
const oyentes = new Map<string, Oyente[]>();

(window as unknown as { __dikra: (tipo: string, json?: string) => boolean }).__dikra = (tipo, json) => {
  let dato: unknown = null;
  try {
    dato = json ? JSON.parse(json) : null;
  } catch {
    dato = json;
  }
  for (const f of oyentes.get(tipo) ?? []) f(dato);
  return true;
};

export function escuchar(tipo: string, fn: Oyente): () => void {
  const lista = oyentes.get(tipo) ?? [];
  lista.push(fn);
  oyentes.set(tipo, lista);
  return () => oyentes.set(tipo, (oyentes.get(tipo) ?? []).filter((f) => f !== fn));
}

/** La próxima vez que avise `tipo`. */
export const esperar = <T>(tipo: string): Promise<T> =>
  new Promise((ok) => {
    const sacar = escuchar(tipo, (d) => {
      sacar();
      ok(d as T);
    });
  });
