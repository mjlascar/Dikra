import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type Lugar, entre } from '../web/src/geo.ts';
import { REGLAS, crearVigia, entradas, limpiar, resumir } from '../web/src/viaje.ts';
import { LINEA, T0, enLinea, largo, manejar } from './ruta.ts';

const MIN = 60_000;
const total = largo(LINEA);
const [laF, loF] = LINEA[LINEA.length - 1];
const [laI, loI] = LINEA[0];
const terreno: Lugar = { id: 'terreno', nombre: 'Terreno', la: laF, lo: loF, radio: 100, destino: true };
const casa: Lugar = { id: 'casa', nombre: 'Casa', la: laI, lo: loI, radio: 80, destino: true };

/** A 12 m/s, cuándo pasa el auto a `m` metros del comienzo, con `espera` segundos antes. */
const cuando = (m: number, espera = 0) => T0 + (espera + m / 12) * 1000;

test('la llegada es el cruce del borde del círculo, no el punto siguiente', () => {
  const p = manejar(LINEA);
  const r = resumir(p, [terreno], 'terreno');
  assert.ok(r);
  assert.equal(r.corte, 'llegada');
  assert.ok(Math.abs(r.llegada - cuando(total - 100)) < 1000, `llegó ${(r.llegada - T0) / 1000} s`);
  assert.equal(r.destinoId, 'terreno');
});

test('si te olvidás de apagarla, se recorta en la llegada', () => {
  const p = manejar(LINEA, { esperaFinal: 20 * 60 });
  const r = resumir(p, [terreno], 'terreno');
  assert.ok(r);
  assert.equal(r.corte, 'llegada');
  assert.ok(r.sobra > 19 * MIN, `sobra ${r.sobra / MIN} min`);
  assert.ok(Math.abs(r.duracion - (total - 100) / 12 * 1000) < 2000);
});

test('lo que esperaste en el auto antes de arrancar no cuenta', () => {
  const p = manejar(LINEA, { esperaInicial: 180 });
  const r = resumir(p, [terreno], 'terreno');
  assert.ok(r);
  assert.ok(Math.abs(r.salida - cuando(0, 180)) <= 1000, `salió a los ${(r.salida - T0) / 1000} s`);
});

test('la salida se encuentra también sin la velocidad del GPS', () => {
  const p = manejar(LINEA, { esperaInicial: 120, conVelocidad: false, ruido: 3, semilla: 11 });
  const r = resumir(p, [terreno], 'terreno');
  assert.ok(r);
  assert.ok(Math.abs(r.salida - cuando(0, 120)) <= 4000, `salió a los ${(r.salida - T0) / 1000} s`);
});

test('sin destino, termina donde quedaste quieto al final', () => {
  const p = manejar(LINEA, { esperaFinal: 10 * 60 });
  const r = resumir(p, [], null);
  assert.ok(r);
  assert.equal(r.corte, 'quieto');
  assert.ok(Math.abs(r.llegada - cuando(total)) <= 2000);
  assert.equal(r.destinoId, null);
});

test('sin destino, si terminaste en un lugar guardado, el destino es ese', () => {
  const p = manejar(LINEA, { esperaFinal: 10 * 60 });
  const r = resumir(p, [casa, terreno], null);
  assert.ok(r);
  assert.equal(r.destinoId, 'terreno');
  assert.equal(r.origenId, 'casa');
  assert.equal(r.corte, 'llegada');
  assert.ok(Math.abs(r.llegada - cuando(total - 100)) < 1000);
});

test('un punto suelto adentro del destino es un salto del GPS, no una llegada', () => {
  const p = manejar(LINEA);
  const i = Math.floor(p.length / 2);
  p[i] = { ...p[i], la: laF, lo: loF };
  assert.equal(limpiar(p).length, p.length - 1, 'el salto imposible se descarta');
  // un salto creíble (el GPS rebota lento) tampoco alcanza: hacen falta dos puntos
  const lejos = enLinea(LINEA, total - 600);
  const q = manejar([lejos, [laF, loF], lejos], { velocidad: 3 });
  const medio = q.findIndex((x) => entre(x, terreno) <= terreno.radio);
  assert.ok(medio > 0);
  const salto = [...q.slice(0, medio - 30), { ...q[medio], t: q[medio - 30].t + 1000 }, ...q.slice(medio - 28, medio - 20)];
  assert.equal(entradas(limpiar(salto), terreno).length, 0);
});

test('si empezás a grabar adentro del destino, no llegaste hasta salir y volver', () => {
  const ida = manejar([[laF, loF], enLinea(LINEA, total - 1000)]);
  const vuelta = manejar([enLinea(LINEA, total - 1000), [laF, loF]], { inicio: ida[ida.length - 1].t + 1000 });
  const r = resumir([...ida, ...vuelta], [terreno], 'terreno');
  assert.ok(r);
  assert.equal(r.corte, 'llegada');
  assert.ok(r.llegada > vuelta[0].t);
});

test('las paradas en el camino se cuentan como tiempo parado', () => {
  const p = manejar(LINEA, { paradas: [{ en: 1000, dura: 45 }, { en: 3000, dura: 30 }] });
  const r = resumir(p, [terreno], 'terreno');
  assert.ok(r);
  assert.ok(Math.abs(r.parado - 75_000) <= 3000, `parado ${r.parado / 1000} s`);
  assert.ok(Math.abs(r.distancia - (total - 100)) < 30, `distancia ${r.distancia}`);
});

test('si el GPS da la velocidad siempre en 0, vale la de los puntos', () => {
  const p = manejar(LINEA, { paradas: [{ en: 2000, dura: 40 }] }).map((x) => ({ ...x, ve: 0 }));
  const r = resumir(p, [terreno], 'terreno');
  assert.ok(r);
  assert.ok(Math.abs(r.distancia - (total - 100)) < 30, `distancia ${r.distancia}`);
  assert.ok(Math.abs(r.parado - 40_000) <= 4000, `parado ${r.parado / 1000} s`);
});

test('si no te moviste, no hubo viaje', () => {
  const p = manejar([[laI, loI], [laI, loI]], { esperaFinal: 600, ruido: 8 });
  assert.equal(resumir(p, [casa], null), null);
});

test('limpiar saca lo impreciso, lo repetido y lo desordenado', () => {
  const p = manejar(LINEA).slice(0, 20);
  const sucio = [p[3], p[0], p[1], p[1], { ...p[2], ac: 200 }, p[4]];
  assert.deepEqual(limpiar(sucio).map((x) => x.t), [p[0].t, p[1].t, p[3].t, p[4].t]);
});

test('la vigía corta al llegar, con dos puntos seguidos adentro', () => {
  const p = manejar(LINEA, { esperaFinal: 60 });
  const v = crearVigia(terreno, p[0].t);
  const corte = p.findIndex((x) => v.agregar(x) !== 'sigue');
  assert.ok(corte > 0);
  const primero = p.findIndex((x) => entre(x, terreno) <= terreno.radio);
  assert.equal(corte, primero + REGLAS.llegadaPuntos - 1);
});

test('la vigía no corta si arrancás adentro del destino', () => {
  const p = manejar([[laF, loF], enLinea(LINEA, total - 1500)]);
  const v = crearVigia(terreno, p[0].t);
  assert.ok(p.every((x) => v.agregar(x) === 'sigue'));
});

test('la vigía corta si quedás quieto 15 minutos', () => {
  const p = manejar(LINEA, { esperaFinal: 16 * 60, ruido: 10, semilla: 3 });
  const v = crearVigia(null, p[0].t);
  let veredicto = 'sigue', en = -1;
  for (let i = 0; i < p.length && veredicto === 'sigue'; i++) {
    veredicto = v.agregar(p[i]);
    en = i;
  }
  assert.equal(veredicto, 'quieto');
  const llego = p.findIndex((x) => x.ve === 0 && x.t > T0 + 60_000);
  assert.ok(Math.abs(p[en].t - p[llego].t - REGLAS.quietoCorta) <= 60_000);
});

test('la vigía corta a las 4 horas', () => {
  const v = crearVigia(null, T0);
  assert.equal(v.agregar({ t: T0 + REGLAS.largoMaximo, la: laI, lo: loI, ac: 5, ve: 10 }), 'largo');
});
