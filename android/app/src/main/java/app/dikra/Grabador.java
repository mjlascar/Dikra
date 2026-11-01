package app.dikra;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.graphics.drawable.Icon;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedWriter;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStreamWriter;
import java.io.RandomAccessFile;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

/**
 * El que graba: un servicio en primer plano, con el aviso «Grabando → Terreno», que pide el GPS
 * una vez por segundo y anota cada punto en el archivo del viaje (ver {@link Viajes}). Sigue con
 * la pantalla apagada y Dikra cerrada.
 *
 * Corta solo cuando la {@link Vigia} lo dice (llegaste, quieto 15 minutos, 4 horas) o cuando se
 * toca «Terminar», en la página o en el aviso. Al cortar deja el viaje cerrado en su .json y avisa:
 * la página lo pasa a su base la próxima vez que mira.
 *
 * Arranca sólo con la app adelante (al tocar un destino): así le alcanza el permiso de ubicación
 * «mientras se usa la app». Por eso, si Android lo mata, no se puede retomar sin la app abierta:
 * se cierra el viaje con lo grabado y se avisa.
 */
public class Grabador extends Service implements LocationListener {

    static final String EMPEZAR = "app.dikra.EMPEZAR";
    static final String TERMINAR = "app.dikra.TERMINAR";
    static final String DESCARTAR = "app.dikra.DESCARTAR";
    static final String MANUAL = "manual";

    private static final int AVISO_GRABANDO = 1;
    private static final int AVISO_FIN = 2;
    private static final String CANAL_GRABANDO = "grabando";
    private static final String CANAL_AVISOS = "avisos";
    private static final String PREFS = "grabador";
    private static final String EN_CURSO = "en_curso";

    /** Lo que mira la página mientras graba. Un solo viaje a la vez. */
    static final class Estado {
        final String id;
        final long inicio;
        final JSONObject destino;
        volatile int n;
        volatile double[] ultimo;

        Estado(String id, long inicio, JSONObject destino, int n) {
            this.id = id;
            this.inicio = inicio;
            this.destino = destino;
            this.n = n;
        }
    }

    static volatile Estado actual;
    /** Si la página está abierta, a quién avisarle que cortó (lo pone MainActivity). */
    static volatile Runnable alCambiar;

    private final Handler hilo = new Handler(Looper.getMainLooper());
    private final Runnable porLargo = () -> cortar(Vigia.LARGO);
    private LocationManager gps;
    private Vigia vigia;
    private Writer salida;
    private PowerManager.WakeLock despierto;

    @Override
    public IBinder onBind(Intent i) {
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        gps = (LocationManager) getSystemService(LOCATION_SERVICE);
        crearCanales(this);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String accion = intent == null ? null : intent.getAction();
        if (EMPEZAR.equals(accion)) empezar(intent);
        else if (TERMINAR.equals(accion)) cortar(MANUAL);
        else if (DESCARTAR.equals(accion)) descartar();
        else retomar();
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        // Si Android lo para sin pasar por cortar(), que el viaje igual quede cerrado.
        if (actual != null) cortar(MANUAL);
        super.onDestroy();
    }

    // ---------------------------------------------------------------- empezar y cortar

    private void empezar(Intent intent) {
        String id = intent.getStringExtra("id");
        long inicio = intent.getLongExtra("inicio", System.currentTimeMillis());
        JSONObject destino = null;
        try {
            String d = intent.getStringExtra("destino");
            if (d != null && !d.equals("null")) destino = new JSONObject(d);
        } catch (JSONException e) {
            destino = null;
        }
        if (!Viajes.idValido(id)) {
            stopSelf();
            return;
        }
        if (actual != null) {
            if (actual.id.equals(id)) return;
            cortar(MANUAL);
        }

        // Primero el aviso: Android da 5 segundos para ponerse en primer plano.
        try {
            Notification n = avisoGrabando(destino, inicio);
            if (Build.VERSION.SDK_INT >= 29) {
                startForeground(AVISO_GRABANDO, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
            } else {
                startForeground(AVISO_GRABANDO, n);
            }
        } catch (RuntimeException e) {
            // Sin permiso, o Android no lo deja ahora: el viaje queda cerrado sin puntos.
            cerrarMeta(id, inicio, destino, inicio, MANUAL);
            stopSelf();
            return;
        }

        try {
            JSONObject m = new JSONObject();
            m.put("id", id);
            m.put("inicio", inicio);
            m.put("fin", JSONObject.NULL);
            m.put("motivo", JSONObject.NULL);
            m.put("destino", destino == null ? JSONObject.NULL : destino);
            m.put("guardado", false);
            Viajes.escribirMeta(this, m);
            salida = new BufferedWriter(new OutputStreamWriter(
                    new FileOutputStream(Viajes.puntos(this, id), true), StandardCharsets.UTF_8));
        } catch (IOException | JSONException e) {
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf();
            return;
        }

        vigia = new Vigia(destino == null ? null : new Vigia.Destino(
                destino.optDouble("la"), destino.optDouble("lo"), destino.optDouble("radio", 100)), inicio);
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        despierto = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "dikra:grabando");
        despierto.acquire(Vigia.LARGO_MAXIMO + 10 * 60_000L);
        actual = new Estado(id, inicio, destino, 0);
        prefs().edit().putString(EN_CURSO, id).commit();
        try {
            gps.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000L, 0f, this, Looper.getMainLooper());
        } catch (SecurityException | IllegalArgumentException e) {
            cortar(MANUAL);
            return;
        }
        hilo.postDelayed(porLargo, Math.max(0, Vigia.LARGO_MAXIMO - (System.currentTimeMillis() - inicio)));
    }

    @Override
    public void onLocationChanged(Location l) {
        Estado e = actual;
        if (e == null || salida == null) return;
        long ahora = System.currentTimeMillis();
        long t = l.getTime();
        // Hay GPS con la hora corrida (el salto de semanas de algunos chips): vale la del teléfono.
        if (Math.abs(t - ahora) > 60_000L) t = ahora;
        double la = l.getLatitude(), lo = l.getLongitude();
        double ac = l.hasAccuracy() ? l.getAccuracy() : 999;
        double ve = l.hasSpeed() ? l.getSpeed() : -1;
        try {
            salida.write(String.format(Locale.ROOT, "%d,%.6f,%.6f,%.1f,%.2f\n", t, la, lo, ac, ve));
            salida.flush();
        } catch (IOException ex) {
            // sin lugar para escribir no tiene sentido seguir
            cortar(MANUAL);
            return;
        }
        e.n++;
        e.ultimo = new double[]{t, la, lo, ac, ve};
        String veredicto = vigia.agregar(t, la, lo, ac);
        if (!Vigia.SIGUE.equals(veredicto)) cortar(veredicto);
    }

    @Override
    public void onProviderDisabled(String proveedor) {
        // Se apagó la ubicación: el aviso lo dice, y si se vuelve a prender sigue solo.
        Estado e = actual;
        if (e != null) avisar(AVISO_GRABANDO, avisoGrabando(e.destino, e.inicio, "La ubicación está apagada: prendela para seguir grabando."));
    }

    @Override
    public void onProviderEnabled(String proveedor) {
        Estado e = actual;
        if (e != null) avisar(AVISO_GRABANDO, avisoGrabando(e.destino, e.inicio));
    }

    /** En Android 10 todavía es obligatorio (después tiene cuerpo vacío): sin esto, se cae. */
    @Override
    @SuppressWarnings("deprecation")
    public void onStatusChanged(String proveedor, int estado, android.os.Bundle extras) {
    }

    /** Corta la grabación: cierra el archivo, anota cómo terminó, avisa y se va. */
    private void cortar(String motivo) {
        Estado e = actual;
        actual = null;
        terminarGps();
        if (e != null) {
            double[] u = e.ultimo;
            long fin = Vigia.LLEGADA.equals(motivo) && u != null ? (long) u[0] : System.currentTimeMillis();
            cerrarMeta(e.id, e.inicio, e.destino, fin, motivo);
            if (!MANUAL.equals(motivo)) avisarFin(e, motivo);
        }
        prefs().edit().remove(EN_CURSO).commit();
        stopForeground(STOP_FOREGROUND_REMOVE);
        Runnable r = alCambiar;
        if (r != null) hilo.post(r);
        stopSelf();
    }

    private void descartar() {
        Estado e = actual;
        actual = null;
        terminarGps();
        if (e != null) Viajes.borrar(this, e.id);
        prefs().edit().remove(EN_CURSO).commit();
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    private void terminarGps() {
        hilo.removeCallbacks(porLargo);
        try {
            gps.removeUpdates(this);
        } catch (RuntimeException ignorada) {
            // ya estaba
        }
        if (salida != null) {
            try {
                salida.close();
            } catch (IOException ignorada) {
                // lo escrito ya está en el archivo
            }
            salida = null;
        }
        if (despierto != null && despierto.isHeld()) despierto.release();
        despierto = null;
    }

    /**
     * Android mató el proceso grabando y lo volvió a levantar: sin la app adelante no hay permiso
     * de ubicación, así que se cierra el viaje donde quedó y se avisa.
     */
    private void retomar() {
        String id = prefs().getString(EN_CURSO, null);
        prefs().edit().remove(EN_CURSO).commit();
        JSONObject m = id == null ? null : Viajes.leerMeta(this, id);
        if (m != null && m.isNull("fin")) {
            long inicio = m.optLong("inicio");
            long fin = ultimoTiempo(Viajes.puntos(this, id), inicio);
            cerrarMeta(id, inicio, m.optJSONObject("destino"), fin, MANUAL);
            Notification n = new Notification.Builder(this, CANAL_AVISOS)
                    .setSmallIcon(R.drawable.ic_notificacion)
                    .setContentTitle("Se cortó la grabación")
                    .setContentText("Android cerró Dikra en el camino. Quedó guardado hasta donde llegó.")
                    .setContentIntent(abrirApp(id))
                    .setAutoCancel(true)
                    .build();
            avisar(AVISO_FIN, n);
        }
        stopSelf();
    }

    private void cerrarMeta(String id, long inicio, JSONObject destino, long fin, String motivo) {
        try {
            JSONObject m = Viajes.leerMeta(this, id);
            if (m == null) {
                m = new JSONObject();
                m.put("id", id);
                m.put("inicio", inicio);
                m.put("destino", destino == null ? JSONObject.NULL : destino);
                m.put("guardado", false);
            }
            m.put("fin", fin);
            m.put("motivo", motivo);
            Viajes.escribirMeta(this, m);
        } catch (IOException | JSONException ignorada) {
            // la página igual encuentra el viaje «grabando» y lo cierra con los puntos que haya
        }
    }

    /** La hora del último punto del archivo, leyendo sólo el final. */
    private static long ultimoTiempo(File f, long siNo) {
        if (!f.isFile() || f.length() == 0) return siNo;
        try (RandomAccessFile r = new RandomAccessFile(f, "r")) {
            long largo = r.length();
            int leer = (int) Math.min(largo, 512);
            byte[] b = new byte[leer];
            r.seek(largo - leer);
            r.readFully(b);
            String[] lineas = new String(b, StandardCharsets.UTF_8).trim().split("\n");
            for (int i = lineas.length - 1; i >= 0; i--) {
                String[] c = lineas[i].split(",");
                if (c.length == 5) return Long.parseLong(c[0]);
            }
        } catch (IOException | NumberFormatException ignorada) {
            // queda el comienzo
        }
        return siNo;
    }

    // ---------------------------------------------------------------- avisos

    static void crearCanales(Context c) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        NotificationChannel grabando = new NotificationChannel(CANAL_GRABANDO, "Grabando", NotificationManager.IMPORTANCE_LOW);
        grabando.setDescription("El aviso fijo mientras graba un viaje.");
        grabando.setShowBadge(false);
        NotificationChannel avisos = new NotificationChannel(CANAL_AVISOS, "Llegadas", NotificationManager.IMPORTANCE_DEFAULT);
        avisos.setDescription("Cuando la grabación corta sola: llegaste, quedaste quieto o pasaron 4 horas.");
        nm.createNotificationChannel(grabando);
        nm.createNotificationChannel(avisos);
    }

    private Notification avisoGrabando(JSONObject destino, long inicio) {
        return avisoGrabando(destino, inicio, destino != null
                ? "Corta sola al llegar." : "Corta sola si quedás quieto 15 minutos.");
    }

    private Notification avisoGrabando(JSONObject destino, long inicio, String texto) {
        PendingIntent terminar = PendingIntent.getService(this, 1,
                new Intent(this, Grabador.class).setAction(TERMINAR),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification.Builder b = new Notification.Builder(this, CANAL_GRABANDO)
                .setSmallIcon(R.drawable.ic_notificacion)
                .setContentTitle(destino != null ? "Grabando → " + destino.optString("nombre", "destino") : "Grabando el viaje")
                .setContentText(texto)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setShowWhen(true)
                .setWhen(inicio)
                .setUsesChronometer(true)
                .setCategory(Notification.CATEGORY_SERVICE)
                .setContentIntent(abrirApp(null))
                .addAction(new Notification.Action.Builder((Icon) null, "Terminar", terminar).build());
        if (Build.VERSION.SDK_INT >= 31) b.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE);
        return b.build();
    }

    private void avisarFin(Estado e, String motivo) {
        String destino = e.destino == null ? null : e.destino.optString("nombre", null);
        String titulo;
        if (Vigia.LLEGADA.equals(motivo)) titulo = destino != null ? "Llegaste a " + destino : "Llegaste";
        else if (Vigia.QUIETO.equals(motivo)) titulo = "Quedaste quieto 15 minutos";
        else titulo = "Llevabas 4 horas grabando";
        Notification n = new Notification.Builder(this, CANAL_AVISOS)
                .setSmallIcon(R.drawable.ic_notificacion)
                .setContentTitle(titulo)
                .setContentText("Viaje guardado. Tocá para verlo.")
                .setContentIntent(abrirApp(e.id))
                .setAutoCancel(true)
                .build();
        avisar(AVISO_FIN, n);
    }

    private void avisar(int id, Notification n) {
        try {
            getSystemService(NotificationManager.class).notify(id, n);
        } catch (SecurityException ignorada) {
            // sin permiso de avisos (Android 13 o más): el viaje igual se guardó
        }
    }

    private PendingIntent abrirApp(String viaje) {
        Intent i = new Intent(this, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (viaje != null) i.putExtra("viaje", viaje);
        return PendingIntent.getActivity(this, viaje == null ? 0 : viaje.hashCode(), i,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private SharedPreferences prefs() {
        return getSharedPreferences(PREFS, MODE_PRIVATE);
    }

    // ---------------------------------------------------------------- lo que pregunta la página

    static String estadoJson() {
        Estado e = actual;
        JSONObject o = new JSONObject();
        try {
            o.put("grabando", e != null);
            o.put("id", e == null ? JSONObject.NULL : e.id);
            o.put("inicio", e == null ? 0 : e.inicio);
            o.put("destino", e == null || e.destino == null ? JSONObject.NULL : e.destino);
            o.put("n", e == null ? 0 : e.n);
            double[] u = e == null ? null : e.ultimo;
            if (u == null) {
                o.put("ultimo", JSONObject.NULL);
            } else {
                JSONArray a = new JSONArray();
                a.put((long) u[0]);
                for (int i = 1; i < u.length; i++) a.put(u[i]);
                o.put("ultimo", a);
            }
        } catch (JSONException ignorada) {
            // no pasa con estos valores
        }
        return o.toString();
    }
}
