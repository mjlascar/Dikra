/**
 * El mapa: calles de OpenStreetMap guardadas en la app (anda sin señal), dibujadas en un canvas,
 * con el recorrido pintado según la velocidad. Sin librerías, como el mapa de Tandil.
 */
import type { Lugar, Punto } from './geo.ts';

type DatosCalles = {
  bb: [number, number, number, number];
  o: [number, number];
  q: number;
  fuente: string;
  nombres: string[];
  calles: number[][];
  mar: number[];
  agua: number[][];
};

type Calle = { c: number; n: number; xy: Float64Array; bb: [number, number, number, number] };
type Calles = { calles: Calle[]; mar: Float64Array | null; agua: Float64Array[]; nombres: string[]; fuente: string };

/** Proyección plana: x hacia el este, y hacia el sur, en «grados de latitud». */
const LA0 = -38.0, LO0 = -57.7;
const K = Math.cos((LA0 * Math.PI) / 180);
const px = (lo: number) => (lo - LO0) * K;
const py = (la: number) => LA0 - la;
const M_POR_UNIDAD = 110574;

let cargadas: Promise<Calles | null> | null = null;

/** Las calles, una sola vez por apertura de la app. Si no cargan, el mapa igual anda sin ellas. */
function cargarCalles(): Promise<Calles | null> {
  cargadas ??= fetch('datos/calles.json')
    .then((r) => (r.ok ? r.json() : null))
    .then((d: DatosCalles | null) => (d ? decodificar(d) : null))
    .catch(() => null);
  return cargadas;
}

function anillo(c: number[], desde: number, d: DatosCalles): Float64Array {
  const out = new Float64Array(c.length - desde);
  let x = 0, y = 0;
  for (let i = desde, j = 0; i < c.length; i += 2, j += 2) {
    x += c[i];
    y += c[i + 1];
    out[j] = px(d.o[1] + x * d.q);
    out[j + 1] = py(d.o[0] + y * d.q);
  }
  return out;
}

function decodificar(d: DatosCalles): Calles {
  const calles: Calle[] = d.calles.map((c) => {
    const xy = anillo(c, 2, d);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < xy.length; i += 2) {
      x0 = Math.min(x0, xy[i]); x1 = Math.max(x1, xy[i]);
      y0 = Math.min(y0, xy[i + 1]); y1 = Math.max(y1, xy[i + 1]);
    }
    return { c: c[0], n: c[1], xy, bb: [x0, y0, x1, y1] };
  });
  // Primero las chicas: las avenidas quedan dibujadas encima.
  calles.sort((a, b) => a.c - b.c);
  return {
    calles,
    mar: d.mar.length ? anillo(d.mar, 0, d) : null,
    agua: d.agua.map((a) => anillo(a, 0, d)),
    nombres: d.nombres,
    fuente: d.fuente,
  };
}

/** Colores del recorrido por velocidad, de parado a ruta. Los usa también la leyenda. */
export const TRAMOS_VELOCIDAD: Array<{ hasta: number; color: string; nombre: string }> = [
  { hasta: 5, color: '#d9453b', nombre: 'parado' },
  { hasta: 20, color: '#ec8a2c', nombre: 'lento' },
  { hasta: 40, color: '#9cbd3c', nombre: '20 a 40' },
  { hasta: 60, color: '#2c9a5b', nombre: '40 a 60' },
  { hasta: Infinity, color: '#1f7ea8', nombre: 'más de 60' },
];
const colorDe = (kmh: number) => TRAMOS_VELOCIDAD.find((t) => kmh < t.hasta)!.color;

/** Cómo se llama en el mapa: sin «Avenida», para que entre. */
export const nombreCorto = (n: string) =>
  n.replace(/^Avenida\s+/i, '').replace(/^Ruta (Nacional|Provincial)\s+/i, 'Ruta ');

export type Mapa = {
  dibujar(): void;
  encuadrar(pts: Array<{ la: number; lo: number }>, metrosMinimos?: number): void;
  traza(p: Punto[] | null, velocidades?: number[]): void;
  lugares(l: Lugar[]): void;
  yo(p: { la: number; lo: number; ac: number } | null): void;
  /** Si se mueve solo para seguir la última posición (hasta que lo mueva la persona). */
  seguir(si: boolean): void;
  centro(): { la: number; lo: number };
  alMover(fn: () => void): void;
  destruir(): void;
};

export function crearMapa(caja: HTMLElement): Mapa {
  const cv = document.createElement('canvas');
  cv.className = 'mapa-lienzo';
  caja.appendChild(cv);
  const fuente = document.createElement('div');
  fuente.className = 'mapa-fuente';
  caja.appendChild(fuente);
  const ctx = cv.getContext('2d')!;
  let datos: Calles | null = null;
  let W = 0, H = 0, dpr = 1;
  const vista = { cx: px(-57.6), cy: py(-37.98), k: 2600 };
  let traza: Punto[] | null = null, vel: number[] = [];
  let lugares: Lugar[] = [];
  let yo: { la: number; lo: number; ac: number } | null = null;
  let siguiendo = false, tocado = false;
  let pendiente = false;
  const alMover: Array<() => void> = [];

  const css = (v: string) => getComputedStyle(cv).getPropertyValue(v).trim();
  const sx = (x: number) => (x - vista.cx) * vista.k + W / 2;
  const sy = (y: number) => (y - vista.cy) * vista.k + H / 2;
  const metrosPorPixel = () => M_POR_UNIDAD / vista.k;

  cargarCalles().then((d) => {
    datos = d;
    fuente.textContent = d ? d.fuente : '';
    pedir();
  });

  function medir() {
    const r = caja.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    W = r.width;
    H = r.height;
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    cv.style.width = W + 'px';
    cv.style.height = H + 'px';
    dibujar();
  }
  const ro = new ResizeObserver(medir);
  ro.observe(caja);
  // Los colores salen del CSS al dibujar: si el teléfono pasa a modo oscuro, hay que redibujar.
  const tema = matchMedia('(prefers-color-scheme: dark)');
  const alCambiarTema = () => pedir();
  tema.addEventListener('change', alCambiarTema);

  /** Un dibujo por cuadro, aunque se pida veinte veces. */
  function pedir() {
    if (pendiente) return;
    pendiente = true;
    requestAnimationFrame(() => {
      pendiente = false;
      dibujar();
    });
  }

  function camino(xy: Float64Array, cerrar: boolean) {
    for (let i = 0; i < xy.length; i += 2) {
      const X = sx(xy[i]), Y = sy(xy[i + 1]);
      if (i === 0) ctx.moveTo(X, Y);
      else ctx.lineTo(X, Y);
    }
    if (cerrar) ctx.closePath();
  }

  function dibujar() {
    if (!W || !H) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = css('--mapa-tierra');
    ctx.fillRect(0, 0, W, H);
    const mpp = metrosPorPixel();
    // lo que se ve, en unidades del mapa, con un margen
    const m = 40 / vista.k;
    const v0x = vista.cx - W / 2 / vista.k - m, v1x = vista.cx + W / 2 / vista.k + m;
    const v0y = vista.cy - H / 2 / vista.k - m, v1y = vista.cy + H / 2 / vista.k + m;

    if (datos) {
      ctx.fillStyle = css('--mapa-agua');
      if (datos.mar) { ctx.beginPath(); camino(datos.mar, true); ctx.fill(); }
      for (const a of datos.agua) { ctx.beginPath(); camino(a, true); ctx.fill(); }

      // Las chicas aparecen al acercarse; las avenidas y rutas, siempre.
      const minima = mpp < 7 ? 0 : mpp < 22 ? 1 : 2;
      const anchoM = [7, 10, 13, 15], anchoMin = [0.7, 1, 1.5, 2];
      const color = [css('--mapa-calle'), css('--mapa-calle'), css('--mapa-avenida'), css('--mapa-ruta')];
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const borde = css('--mapa-borde-calle');
      for (let c = minima; c <= 3; c++) {
        ctx.beginPath();
        for (const s of datos.calles) {
          if (s.c !== c || s.bb[2] < v0x || s.bb[0] > v1x || s.bb[3] < v0y || s.bb[1] > v1y) continue;
          camino(s.xy, false);
        }
        const ancho = Math.max(anchoMin[c], anchoM[c] / mpp);
        // Las avenidas y rutas llevan un borde: blancas sobre la tierra clara casi no se ven.
        if (c >= 2 && borde) {
          ctx.strokeStyle = borde;
          ctx.lineWidth = ancho + 1.6;
          ctx.stroke();
        }
        ctx.strokeStyle = color[c];
        ctx.lineWidth = ancho;
        ctx.stroke();
      }
      if (mpp < 14) nombres(Math.max(1, minima), v0x, v1x, v0y, v1y);
    }

    for (const l of lugares) {
      const X = sx(px(l.lo)), Y = sy(py(l.la)), r = Math.max(5, l.radio / mpp);
      ctx.beginPath();
      ctx.arc(X, Y, r, 0, Math.PI * 2);
      ctx.fillStyle = css('--mapa-lugar-fondo');
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = css('--mapa-lugar');
      ctx.stroke();
      rotulo(l.nombre, X, Y - r - 8, 0, '600 12px');
    }

    if (traza && traza.length > 1) dibujarTraza();

    if (yo) {
      const X = sx(px(yo.lo)), Y = sy(py(yo.la)), ra = yo.ac / mpp;
      if (ra > 8) {
        ctx.beginPath();
        ctx.arc(X, Y, ra, 0, Math.PI * 2);
        ctx.fillStyle = css('--mapa-yo-margen');
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(X, Y, 7, 0, Math.PI * 2);
      ctx.fillStyle = css('--mapa-yo');
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
    }
  }

  function dibujarTraza() {
    const p = traza!;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // un borde del color del fondo, para que se lea encima de las calles
    ctx.beginPath();
    for (let i = 0; i < p.length; i++) {
      const X = sx(px(p[i].lo)), Y = sy(py(p[i].la));
      if (i === 0) ctx.moveTo(X, Y);
      else ctx.lineTo(X, Y);
    }
    ctx.strokeStyle = css('--mapa-traza-borde');
    ctx.lineWidth = 7;
    ctx.stroke();
    // y el recorrido, en tiras del mismo color
    let i = 1;
    while (i < p.length) {
      const col = colorDe((vel[i] ?? 0) * 3.6);
      ctx.beginPath();
      ctx.moveTo(sx(px(p[i - 1].lo)), sy(py(p[i - 1].la)));
      while (i < p.length && colorDe((vel[i] ?? 0) * 3.6) === col) {
        ctx.lineTo(sx(px(p[i].lo)), sy(py(p[i].la)));
        i++;
      }
      ctx.strokeStyle = col;
      ctx.lineWidth = 4;
      ctx.stroke();
    }
    marca(p[0], css('--mapa-salida'));
    marca(p[p.length - 1], css('--mapa-llegada'));
  }

  function marca(q: Punto, color: string) {
    const X = sx(px(q.lo)), Y = sy(py(q.la));
    ctx.beginPath();
    ctx.arc(X, Y, 6.5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = css('--mapa-traza-borde');
    ctx.stroke();
  }

  function rotulo(texto: string, X: number, Y: number, ang: number, peso: string) {
    ctx.save();
    ctx.translate(X, Y);
    ctx.rotate(ang);
    ctx.font = `${peso} system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = css('--mapa-tierra');
    ctx.strokeText(texto, 0, 0);
    ctx.fillStyle = css('--mapa-texto');
    ctx.fillText(texto, 0, 0);
    ctx.restore();
  }

  /** Los nombres de las calles grandes, sobre su tramo más largo en pantalla, sin pisarse. */
  function nombres(minima: number, v0x: number, v1x: number, v0y: number, v1y: number) {
    if (!datos) return;
    const puestos: Array<[number, number, number]> = [];
    const vistos = new Map<number, Array<[number, number]>>();
    ctx.font = "600 11px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
    for (let j = datos.calles.length - 1; j >= 0; j--) {
      const s = datos.calles[j];
      if (s.c < minima || s.n < 0 || s.bb[2] < v0x || s.bb[0] > v1x || s.bb[3] < v0y || s.bb[1] > v1y) continue;
      let mejor = 0, bx = 0, by = 0, ang = 0;
      for (let i = 2; i < s.xy.length; i += 2) {
        const x1 = sx(s.xy[i - 2]), y1 = sy(s.xy[i - 1]), x2 = sx(s.xy[i]), y2 = sy(s.xy[i + 1]);
        const l = Math.hypot(x2 - x1, y2 - y1);
        if (l > mejor) { mejor = l; bx = (x1 + x2) / 2; by = (y1 + y2) / 2; ang = Math.atan2(y2 - y1, x2 - x1); }
      }
      if (bx < 0 || bx > W || by < 0 || by > H) continue;
      const texto = nombreCorto(datos.nombres[s.n]);
      const ancho = ctx.measureText(texto).width;
      if (mejor < ancho + 24) continue;
      const r = ancho / 2 + 6;
      if (puestos.some(([x, y, rr]) => Math.hypot(x - bx, y - by) < r + rr)) continue;
      const mismos = vistos.get(s.n) ?? [];
      if (mismos.some(([x, y]) => Math.hypot(x - bx, y - by) < 220)) continue;
      if (ang > Math.PI / 2) ang -= Math.PI;
      else if (ang < -Math.PI / 2) ang += Math.PI;
      rotulo(texto, bx, by, ang, s.c >= 2 ? '600 11px' : '500 10.5px');
      puestos.push([bx, by, r]);
      mismos.push([bx, by]);
      vistos.set(s.n, mismos);
    }
  }

  // ---- gestos: arrastrar, pellizcar, la ruedita y doble toque
  const dedos = new Map<number, [number, number]>();
  let arrastre: { x: number; y: number; cx: number; cy: number } | null = null;
  let pellizco: { d: number; k: number; wx: number; wy: number } | null = null;
  let ultimoToque = 0;
  const local = (e: PointerEvent | WheelEvent): [number, number] => {
    const r = cv.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const aMundo = (X: number, Y: number): [number, number] => [(X - W / 2) / vista.k + vista.cx, (Y - H / 2) / vista.k + vista.cy];
  function movido() {
    tocado = true;
    siguiendo = false;
    alMover.forEach((f) => f());
  }
  function zoom(k: number, wx: number, wy: number, X: number, Y: number) {
    vista.k = Math.max(900, Math.min(400_000, k));
    vista.cx = wx - (X - W / 2) / vista.k;
    vista.cy = wy - (Y - H / 2) / vista.k;
    pedir();
  }
  cv.addEventListener('pointerdown', (e) => {
    cv.setPointerCapture(e.pointerId);
    dedos.set(e.pointerId, local(e));
    if (dedos.size === 1) {
      const [x, y] = local(e);
      arrastre = { x, y, cx: vista.cx, cy: vista.cy };
      const ahora = Date.now();
      if (ahora - ultimoToque < 300) {
        const [wx, wy] = aMundo(x, y);
        zoom(vista.k * 2, wx, wy, x, y);
        movido();
      }
      ultimoToque = ahora;
    } else if (dedos.size === 2) {
      arrastre = null;
      const [a, b] = [...dedos.values()];
      const [wx, wy] = aMundo((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      pellizco = { d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, k: vista.k, wx, wy };
    }
  });
  cv.addEventListener('pointermove', (e) => {
    if (!dedos.has(e.pointerId)) return;
    dedos.set(e.pointerId, local(e));
    if (dedos.size === 2 && pellizco) {
      const [a, b] = [...dedos.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
      zoom(pellizco.k * (d / pellizco.d), pellizco.wx, pellizco.wy, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      movido();
    } else if (arrastre && dedos.size === 1) {
      const [x, y] = local(e);
      if (Math.abs(x - arrastre.x) + Math.abs(y - arrastre.y) < 4) return;
      vista.cx = arrastre.cx - (x - arrastre.x) / vista.k;
      vista.cy = arrastre.cy - (y - arrastre.y) / vista.k;
      pedir();
      movido();
    }
  });
  const soltar = (e: PointerEvent) => {
    dedos.delete(e.pointerId);
    if (dedos.size < 2) pellizco = null;
    if (dedos.size === 1) {
      const [x, y] = [...dedos.values()][0];
      arrastre = { x, y, cx: vista.cx, cy: vista.cy };
    }
    if (dedos.size === 0) arrastre = null;
  };
  cv.addEventListener('pointerup', soltar);
  cv.addEventListener('pointercancel', soltar);
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [x, y] = local(e);
    const [wx, wy] = aMundo(x, y);
    zoom(vista.k * Math.exp(-e.deltaY * 0.0016), wx, wy, x, y);
    movido();
  }, { passive: false });

  function encuadrar(pts: Array<{ la: number; lo: number }>, metrosMinimos = 600) {
    if (!pts.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) {
      x0 = Math.min(x0, px(p.lo)); x1 = Math.max(x1, px(p.lo));
      y0 = Math.min(y0, py(p.la)); y1 = Math.max(y1, py(p.la));
    }
    const minimo = metrosMinimos / M_POR_UNIDAD;
    const ancho = Math.max(x1 - x0, minimo), alto = Math.max(y1 - y0, minimo);
    vista.cx = (x0 + x1) / 2;
    vista.cy = (y0 + y1) / 2;
    const w = W || caja.clientWidth || 360, h = H || caja.clientHeight || 300;
    // con margen: el círculo del destino y su nombre quedan afuera del recorrido
    vista.k = Math.min((w - 110) / ancho, (h - 110) / alto);
    pedir();
  }

  return {
    dibujar: pedir,
    encuadrar(pts, metrosMinimos) {
      tocado = false;
      encuadrar(pts, metrosMinimos);
    },
    traza(p, v) {
      traza = p;
      vel = v ?? [];
      if (siguiendo && p && p.length) {
        const u = p[p.length - 1];
        vista.cx = px(u.lo);
        vista.cy = py(u.la);
      }
      pedir();
    },
    lugares(l) { lugares = l; pedir(); },
    yo(p) {
      yo = p;
      if (siguiendo && p && !tocado) {
        vista.cx = px(p.lo);
        vista.cy = py(p.la);
      }
      pedir();
    },
    seguir(si) {
      siguiendo = si;
      tocado = false;
    },
    centro() {
      return { la: LA0 - vista.cy, lo: vista.cx / K + LO0 };
    },
    alMover(fn) { alMover.push(fn); },
    destruir() {
      ro.disconnect();
      tema.removeEventListener('change', alCambiarTema);
      caja.replaceChildren();
    },
  };
}
