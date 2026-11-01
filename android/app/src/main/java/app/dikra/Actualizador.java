package app.dikra;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Dikra no está en Play: se actualiza sola desde el release `apk-latest` de GitHub, que CI rehace
 * en cada push a main con `Dikra.apk` y `version.json` (`{codigo, nombre, sha256}`).
 *
 * Al volver a la app, cada 6 horas como mucho, mira `version.json`. Si hay una más nueva, Ajustes
 * ofrece «Actualizar»: la baja, verifica que sea Dikra, más nueva, con el mismo sha256 que anunció
 * CI y firmada con la misma clave que la instalada, y se la pasa al instalador de Android.
 *
 * La primera vez Android pide dejar que Dikra instale apps; después puede instalar sin preguntar
 * (Dikra queda como quien la instaló). Con Slowtown activo, esa pantalla de Android está
 * bloqueada: hace falta «Habilitar todo» un rato, como con Waltra.
 */
final class Actualizador {

    static final String BASE = "https://github.com/mjlascar/Dikra/releases/download/apk-latest/";
    private static final long CADA = 6 * 3_600_000L;
    private static final String PREFS = "actualizacion";

    static volatile Runnable alCambiar;
    private static final ExecutorService hilo = Executors.newSingleThreadExecutor();
    private static volatile String estado = "nada";
    private static volatile String detalle;
    private static volatile int porcentaje;
    private static volatile JSONObject ultima;

    private Actualizador() {
    }

    private static void poner(String nuevo, String det) {
        estado = nuevo;
        detalle = det;
        Runnable r = alCambiar;
        if (r != null) r.run();
    }

    private static PackageInfo instalada(Context c) throws PackageManager.NameNotFoundException {
        return c.getPackageManager().getPackageInfo(c.getPackageName(), PackageManager.GET_SIGNING_CERTIFICATES);
    }

    static String estadoJson(Context c) {
        JSONObject o = new JSONObject();
        try {
            o.put("estado", estado);
            o.put("instalada", instalada(c).versionName);
            JSONObject u = ultima;
            if (u != null) o.put("version", u.optString("nombre"));
            if ("bajando".equals(estado)) o.put("porcentaje", porcentaje);
            if (detalle != null) o.put("detalle", detalle);
        } catch (JSONException | PackageManager.NameNotFoundException ignorada) {
            // no pasa
        }
        return o.toString();
    }

    /** Al volver a la app: busca si pasaron 6 horas desde la última vez. */
    static void alVolver(Context c) {
        SharedPreferences p = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        long desde = System.currentTimeMillis() - p.getLong("buscada", 0);
        if (desde >= 0 && desde < CADA) return;
        buscar(c, false);
    }

    /** `aMano`: desde Ajustes, que muestra cómo le fue; sola, un error no se muestra. */
    static void buscar(Context c, boolean aMano) {
        Context app = c.getApplicationContext();
        if ("bajando".equals(estado) || "instalando".equals(estado)) return;
        if (aMano) poner("buscando", null);
        hilo.execute(() -> {
            app.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                    .putLong("buscada", System.currentTimeMillis()).apply();
            try {
                JSONObject v = new JSONObject(new String(bajar(BASE + "version.json", 64 * 1024), "UTF-8"));
                ultima = v;
                poner(v.optLong("codigo") > instalada(app).getLongVersionCode() ? "hay" : "aldia", null);
            } catch (Exception e) {
                if (aMano) poner("error", "no se pudo preguntar a GitHub (" + e.getMessage() + ")");
            }
        });
    }

    static void actualizar(Activity a) {
        if (!"hay".equals(estado) && !"permiso".equals(estado) && !"error".equals(estado)) return;
        if (ultima == null) {
            buscar(a, true);
            return;
        }
        if (!a.getPackageManager().canRequestPackageInstalls()) {
            poner("permiso", null);
            a.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + a.getPackageName())));
            return;
        }
        Context app = a.getApplicationContext();
        porcentaje = 0;
        poner("bajando", null);
        hilo.execute(() -> {
            File dir = new File(app.getCacheDir(), "actualizacion");
            try {
                borrar(dir);
                dir.mkdirs();
                File apk = new File(dir, "Dikra.apk");
                bajarA(BASE + "Dikra.apk", apk);
                verificar(app, apk, ultima);
                poner("instalando", null);
                instalar(app, apk);
            } catch (Exception e) {
                poner("error", e.getMessage());
            } finally {
                borrar(dir);
            }
        });
    }

    // ---------------------------------------------------------------- bajar

    private static HttpURLConnection abrir(String url) throws IOException {
        HttpURLConnection h = (HttpURLConnection) new URL(url).openConnection();
        h.setConnectTimeout(20_000);
        h.setReadTimeout(60_000);
        h.setRequestProperty("User-Agent", "Dikra");
        h.setInstanceFollowRedirects(true);
        int codigo = h.getResponseCode();
        if (codigo != 200) throw new IOException("GitHub contestó " + codigo);
        return h;
    }

    private static byte[] bajar(String url, int maximo) throws IOException {
        HttpURLConnection h = abrir(url);
        try (InputStream in = h.getInputStream()) {
            byte[] b = new byte[maximo];
            int n = 0;
            for (int r; (r = in.read(b, n, b.length - n)) > 0; ) n += r;
            byte[] out = new byte[n];
            System.arraycopy(b, 0, out, 0, n);
            return out;
        } finally {
            h.disconnect();
        }
    }

    private static void bajarA(String url, File destino) throws IOException {
        HttpURLConnection h = abrir(url);
        long total = h.getContentLengthLong();
        try (InputStream in = h.getInputStream(); OutputStream out = new FileOutputStream(destino)) {
            byte[] b = new byte[64 * 1024];
            long n = 0;
            for (int r; (r = in.read(b)) > 0; ) {
                out.write(b, 0, r);
                n += r;
                if (total > 0) {
                    int p = (int) (n * 100 / total);
                    if (p != porcentaje) {
                        porcentaje = p;
                        poner("bajando", null);
                    }
                }
            }
        } finally {
            h.disconnect();
        }
    }

    // ---------------------------------------------------------------- verificar e instalar

    /** Que sea Dikra, más nueva, la que anunció CI y con la misma firma que la instalada. */
    private static void verificar(Context c, File apk, JSONObject v) throws Exception {
        String esperado = v.optString("sha256", "");
        if (!esperado.isEmpty() && !esperado.equalsIgnoreCase(sha256(apk))) {
            throw new IOException("el APK bajado no es el que publicó GitHub");
        }
        PackageManager pm = c.getPackageManager();
        PackageInfo nueva = pm.getPackageArchiveInfo(apk.getPath(), PackageManager.GET_SIGNING_CERTIFICATES);
        if (nueva == null) throw new IOException("Android no pudo leer el APK");
        if (!c.getPackageName().equals(nueva.packageName)) throw new IOException("el APK no es Dikra");
        PackageInfo vieja = instalada(c);
        if (nueva.getLongVersionCode() <= vieja.getLongVersionCode()) throw new IOException("no es más nueva que la instalada");
        Set<String> a = firmas(vieja), b = firmas(nueva);
        if (a.isEmpty() || !a.equals(b)) {
            throw new IOException("está firmada con otra clave (esta copia se instaló a mano: se actualiza a mano)");
        }
    }

    private static Set<String> firmas(PackageInfo p) throws NoSuchAlgorithmException {
        Set<String> out = new HashSet<>();
        if (p.signingInfo == null) return out;
        for (Signature s : p.signingInfo.getApkContentsSigners()) {
            out.add(hex(MessageDigest.getInstance("SHA-256").digest(s.toByteArray())));
        }
        return out;
    }

    private static String sha256(File f) throws IOException, NoSuchAlgorithmException {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new FileInputStream(f)) {
            byte[] b = new byte[64 * 1024];
            for (int r; (r = in.read(b)) > 0; ) md.update(b, 0, r);
        }
        return hex(md.digest());
    }

    private static String hex(byte[] b) {
        StringBuilder sb = new StringBuilder();
        for (byte x : b) sb.append(String.format("%02x", x));
        return sb.toString();
    }

    private static void instalar(Context c, File apk) throws IOException {
        PackageInstaller pi = c.getPackageManager().getPackageInstaller();
        // lo que haya quedado de un intento anterior
        for (PackageInstaller.SessionInfo s : pi.getMySessions()) {
            try {
                pi.abandonSession(s.getSessionId());
            } catch (RuntimeException ignorada) {
                // ya no estaba
            }
        }
        PackageInstaller.SessionParams p = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        p.setAppPackageName(c.getPackageName());
        p.setSize(apk.length());
        if (Build.VERSION.SDK_INT >= 31) p.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
        int id = pi.createSession(p);
        try (PackageInstaller.Session s = pi.openSession(id)) {
            try (InputStream in = new FileInputStream(apk); OutputStream out = s.openWrite("Dikra.apk", 0, apk.length())) {
                byte[] b = new byte[64 * 1024];
                for (int r; (r = in.read(b)) > 0; ) out.write(b, 0, r);
                s.fsync(out);
            }
            int mutable = Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0;
            PendingIntent alTerminar = PendingIntent.getBroadcast(c, id, new Intent(c, Resultado.class),
                    mutable | PendingIntent.FLAG_UPDATE_CURRENT);
            s.commit(alTerminar.getIntentSender());
        }
    }

    private static void borrar(File f) {
        File[] hijos = f.listFiles();
        if (hijos != null) for (File h : hijos) borrar(h);
        f.delete();
    }

    /** Lo que contesta el instalador de Android. */
    public static class Resultado extends BroadcastReceiver {
        @Override
        @SuppressWarnings("deprecation")
        public void onReceive(Context c, Intent intent) {
            int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
            if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
                Intent confirmar = Build.VERSION.SDK_INT >= 33
                        ? intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent.class)
                        : intent.getParcelableExtra(Intent.EXTRA_INTENT);
                if (confirmar != null) {
                    confirmar.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    try {
                        c.startActivity(confirmar);
                    } catch (RuntimeException e) {
                        poner("error", "Android no mostró la pantalla para confirmar (¿Slowtown activo?)");
                    }
                }
            } else if (status == PackageInstaller.STATUS_SUCCESS) {
                poner("aldia", null);
            } else {
                String m = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
                poner("error", m != null ? m : "Android no la instaló");
            }
        }
    }
}
