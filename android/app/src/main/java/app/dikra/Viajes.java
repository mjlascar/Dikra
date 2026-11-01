package app.dikra;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * Los viajes como los guarda el grabador, en la memoria propia de la app (files/viajes/):
 *
 * - `<id>.csv`: un punto por línea, `t,la,lo,ac,ve` (ve = -1 si el GPS no dio la velocidad).
 *   Se escribe punto a punto, así un corte de golpe no se lleva lo grabado.
 * - `<id>.json`: cuándo empezó, cuándo cortó y por qué, el destino, y si la página ya lo guardó.
 *
 * La página los pasa a su base cuando el viaje termina. Los archivos quedan como respaldo.
 */
final class Viajes {

    private Viajes() {
    }

    static boolean idValido(String id) {
        return id != null && id.matches("[A-Za-z0-9_-]{1,64}");
    }

    static File carpeta(Context c) {
        File d = new File(c.getFilesDir(), "viajes");
        if (!d.isDirectory()) d.mkdirs();
        return d;
    }

    static File puntos(Context c, String id) {
        return new File(carpeta(c), id + ".csv");
    }

    static File meta(Context c, String id) {
        return new File(carpeta(c), id + ".json");
    }

    static JSONObject leerMeta(Context c, String id) {
        if (!idValido(id)) return null;
        File f = meta(c, id);
        if (!f.isFile()) return null;
        try {
            return new JSONObject(leer(f));
        } catch (IOException | JSONException e) {
            return null;
        }
    }

    /** Escribe a un archivo aparte y lo pone en su lugar: nunca queda un .json a medias. */
    static void escribirMeta(Context c, JSONObject m) throws IOException {
        String id = m.optString("id");
        if (!idValido(id)) throw new IOException("id inválido");
        File f = meta(c, id), tmp = new File(f.getPath() + ".tmp");
        try (OutputStream out = new FileOutputStream(tmp)) {
            out.write(m.toString().getBytes(StandardCharsets.UTF_8));
            out.flush();
            ((FileOutputStream) out).getFD().sync();
        }
        if (!tmp.renameTo(f)) throw new IOException("no se pudo guardar " + f.getName());
    }

    /** Los puntos desde la línea `desde`, como `[[t,la,lo,ac,ve],...]`. */
    static String puntosJson(Context c, String id, int desde) {
        if (!idValido(id)) return "[]";
        File f = puntos(c, id);
        if (!f.isFile()) return "[]";
        StringBuilder sb = new StringBuilder("[");
        int n = 0;
        boolean primero = true;
        try (BufferedReader r = new BufferedReader(new InputStreamReader(new FileInputStream(f), StandardCharsets.UTF_8))) {
            for (String linea; (linea = r.readLine()) != null; n++) {
                if (n < desde) continue;
                // una línea cortada al medio (la app se cerró escribiendo) se saltea
                if (linea.split(",", -1).length != 5) continue;
                if (!primero) sb.append(',');
                sb.append('[').append(linea).append(']');
                primero = false;
            }
        } catch (IOException e) {
            // lo leído hasta acá sirve igual
        }
        return sb.append(']').toString();
    }

    /** Los viajes cortados que la página todavía no guardó. */
    static String terminadosJson(Context c) {
        JSONArray out = new JSONArray();
        File[] fs = carpeta(c).listFiles((d, n) -> n.endsWith(".json"));
        if (fs == null) return "[]";
        for (File f : fs) {
            try {
                JSONObject m = new JSONObject(leer(f));
                if (m.isNull("fin") || m.optBoolean("guardado")) continue;
                JSONObject t = new JSONObject();
                t.put("id", m.getString("id"));
                t.put("inicio", m.getLong("inicio"));
                t.put("fin", m.getLong("fin"));
                t.put("motivo", m.optString("motivo", "manual"));
                t.put("destino", m.opt("destino") == null ? JSONObject.NULL : m.get("destino"));
                out.put(t);
            } catch (IOException | JSONException e) {
                // un archivo roto no traba a los demás
            }
        }
        return out.toString();
    }

    static void marcarGuardado(Context c, String id) {
        JSONObject m = leerMeta(c, id);
        if (m == null) return;
        try {
            m.put("guardado", true);
            escribirMeta(c, m);
        } catch (IOException | JSONException e) {
            // se vuelve a ofrecer la próxima vez: la página no lo duplica
        }
    }

    static void borrar(Context c, String id) {
        if (!idValido(id)) return;
        puntos(c, id).delete();
        meta(c, id).delete();
    }

    static String leer(File f) throws IOException {
        try (FileInputStream in = new FileInputStream(f)) {
            byte[] b = new byte[(int) f.length()];
            int leidos = 0;
            while (leidos < b.length) {
                int r = in.read(b, leidos, b.length - leidos);
                if (r < 0) break;
                leidos += r;
            }
            return new String(b, 0, leidos, StandardCharsets.UTF_8);
        }
    }
}
