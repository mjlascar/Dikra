/** Lo mínimo para armar pantallas sin una librería: crear elementos, avisos y preguntas. */

type Hijo = Node | string | number | null | undefined | false | Hijo[];
type Atributos = Record<string, string | number | boolean | null | undefined | EventListener>;

/** `h('button', { class: 'boton', onclick: f }, 'Guardar')`. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, atributos: Atributos = {}, ...hijos: Hijo[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(atributos)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  poner(el, hijos);
  return el;
}

/** Como `append`, pero salteando lo que es `null` o `false` (lo que se muestra sólo a veces). */
export const agregar = (el: Element, ...hijos: Hijo[]) => poner(el, hijos);

function poner(el: Element, hijos: Hijo[]) {
  for (const c of hijos) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) poner(el, c);
    else el.append(c instanceof Node ? c : String(c));
  }
}

/** Un dibujito de línea, del set chico de la app. */
export function icono(nombre: keyof typeof ICONOS, clase = 'icono'): SVGSVGElement {
  const tmp = document.createElement('div');
  tmp.innerHTML = `<svg class="${clase}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONOS[nombre]}</svg>`;
  return tmp.firstElementChild as SVGSVGElement;
}

const ICONOS = {
  grabar: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.2" fill="currentColor"/>',
  viajes: '<path d="M5 19c0-4 4-4 4-8s-4-4-4-6"/><path d="M15 19c0-4 4-4 4-8s-4-4-4-6"/>',
  lugares: '<path d="M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/>',
  ajustes: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  flecha: '<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>',
  atras: '<path d="M15 18l-6-6 6-6"/>',
  mira: '<circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
  yo: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  basura: '<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/>',
  bandera: '<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>',
};

let tAviso = 0;
/** Un aviso corto abajo de todo, que se va solo. */
export function aviso(texto: string, ms = 4500) {
  const el = document.getElementById('aviso')!;
  el.textContent = texto;
  el.hidden = false;
  clearTimeout(tAviso);
  tAviso = window.setTimeout(() => { el.hidden = true; }, ms);
}

/**
 * Una pregunta con dos botones. Propia y no `confirm()`: en el WebView de Android `confirm`
 * depende de cómo esté armada la app, y acá se ve igual en los dos teléfonos.
 */
export function preguntar(titulo: string, texto: string, si: string, no = 'Cancelar', peligro = false): Promise<boolean> {
  return new Promise((ok) => {
    const cerrar = (r: boolean) => {
      fondo.remove();
      ok(r);
    };
    const fondo = h('div', { class: 'velo', onclick: (e: Event) => { if (e.target === fondo) cerrar(false); } },
      h('div', { class: 'dialogo', role: 'dialog', 'aria-modal': 'true' },
        h('h2', {}, titulo),
        texto ? h('p', {}, texto) : null,
        h('div', { class: 'dialogo-botones' },
          h('button', { class: 'boton', onclick: () => cerrar(false) }, no),
          h('button', { class: peligro ? 'boton peligro' : 'boton principal', onclick: () => cerrar(true) }, si))));
    document.body.append(fondo);
    (fondo.querySelector('.dialogo-botones .boton:last-child') as HTMLButtonElement).focus();
  });
}
