package app.dikra;

/**
 * Decide, punto por punto mientras graba, si hay que cortar: llegaste, quedaste quieto 15
 * minutos, o lleva 4 horas.
 *
 * Son las mismas reglas que `REGLAS` y `crearVigia` de web/src/viaje.ts, que usa la página en el
 * iPhone y que calcula el resumen después. Si cambia una, cambia en los dos.
 */
final class Vigia {

    static final double PRECISION_MAXIMA = 60;      // metros
    static final double LLEGADA_MARGEN = 50;        // metros afuera del círculo para «haber salido»
    static final int LLEGADA_PUNTOS = 2;            // puntos seguidos adentro
    static final double QUIETO_RADIO = 80;          // metros
    static final long QUIETO_CORTA = 15 * 60_000L;
    static final long LARGO_MAXIMO = 4 * 3_600_000L;

    static final String SIGUE = "sigue";
    static final String LLEGADA = "llegada";
    static final String QUIETO = "quieto";
    static final String LARGO = "largo";

    /** El destino: un círculo. `null` si se graba sin destino. */
    static final class Destino {
        final double la, lo, radio;

        Destino(double la, double lo, double radio) {
            this.la = la;
            this.lo = lo;
            this.radio = radio;
        }
    }

    private final Destino destino;
    private final long inicio;
    private boolean afuera;
    private int adentro;
    private boolean hayAncla;
    private double anclaLa, anclaLo;
    private long anclaT;

    Vigia(Destino destino, long inicio) {
        this.destino = destino;
        this.inicio = inicio;
    }

    String agregar(long t, double la, double lo, double ac) {
        if (t - inicio >= LARGO_MAXIMO) return LARGO;
        if (!(ac <= PRECISION_MAXIMA)) return SIGUE;
        if (destino != null) {
            double d = distancia(la, lo, destino.la, destino.lo);
            if (d > destino.radio + LLEGADA_MARGEN) {
                afuera = true;
                adentro = 0;
            } else if (afuera && d <= destino.radio) {
                if (++adentro >= LLEGADA_PUNTOS) return LLEGADA;
            } else {
                adentro = 0;
            }
        }
        if (!hayAncla || distancia(la, lo, anclaLa, anclaLo) > QUIETO_RADIO) {
            hayAncla = true;
            anclaLa = la;
            anclaLo = lo;
            anclaT = t;
        } else if (t - anclaT >= QUIETO_CORTA) {
            return QUIETO;
        }
        return SIGUE;
    }

    /** Metros entre dos posiciones (haversine), igual que web/src/geo.ts. */
    static double distancia(double la1, double lo1, double la2, double lo2) {
        double r = Math.PI / 180;
        double dla = (la2 - la1) * r, dlo = (lo2 - lo1) * r;
        double a = Math.pow(Math.sin(dla / 2), 2)
                + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.pow(Math.sin(dlo / 2), 2);
        return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(a)));
    }
}
