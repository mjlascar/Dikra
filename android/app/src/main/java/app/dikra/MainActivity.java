package app.dikra;

import android.Manifest;
import android.app.Activity;
import android.app.NotificationManager;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Insets;
import android.location.LocationManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.MediaStore;
import android.provider.Settings;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import android.window.OnBackInvokedDispatcher;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * Una sola pantalla: la página (assets/web/, la misma que se publica para el iPhone) adentro de
 * un WebView, y el puente `window.DikraNativo` para que hable con el {@link Grabador} y con
 * Android (permisos, guardar archivos, actualizarse).
 *
 * La página se sirve desde https://appassets.androidplatform.net, el dominio que Android reserva
 * para esto y que nunca va a internet. Con un origen https fijo, la base de la página (IndexedDB)
 * persiste entre aperturas y entre versiones: cambiar ese origen dejaría los viajes inalcanzables.
 */
public class MainActivity extends Activity {

    private static final String HOST = "appassets.androidplatform.net";
    private static final String INICIO = "https://" + HOST + "/index.html";
    private static final int ELEGIR_ARCHIVO = 1;
    private static final int PERMISOS_GRABAR = 2;
    private static final int PERMISOS_MAPA = 3;

    private WebView web;
    private boolean cargada;
    private String viajePendiente;
    private ValueCallback<Uri[]> archivoPendiente;
    private String origenUbicacion;
    private GeolocationPermissions.Callback ubicacionPendiente;

    @Override
    protected void onCreate(Bundle estado) {
        super.onCreate(estado);
        FrameLayout raiz = new FrameLayout(this);
        web = new WebView(this);
        raiz.addView(web, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(raiz);
        acomodarBarras(raiz);

        boolean depurable = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        WebView.setWebContentsDebuggingEnabled(depurable);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setGeolocationEnabled(true);
        s.setTextZoom(100);           // la letra grande del sistema no desarma las pantallas
        s.setSupportZoom(false);      // el zoom lo maneja el mapa con dos dedos

        web.addJavascriptInterface(new Puente(), "DikraNativo");
        web.setWebViewClient(new Cliente());
        web.setWebChromeClient(new WebChromeClient() {
            // «Cargar un respaldo»: el input de archivo de la página abre el selector de Android
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
                if (archivoPendiente != null) archivoPendiente.onReceiveValue(null);
                archivoPendiente = cb;
                try {
                    startActivityForResult(p.createIntent(), ELEGIR_ARCHIVO);
                } catch (ActivityNotFoundException e) {
                    archivoPendiente = null;
                    return false;
                }
                return true;
            }

            // «Estoy acá» al guardar un lugar: la ubicación de la página
            @Override
            public void onGeolocationPermissionsShowPrompt(String origen, GeolocationPermissions.Callback cb) {
                if (tiene(Manifest.permission.ACCESS_FINE_LOCATION) || tiene(Manifest.permission.ACCESS_COARSE_LOCATION)) {
                    cb.invoke(origen, true, false);
                    return;
                }
                origenUbicacion = origen;
                ubicacionPendiente = cb;
                requestPermissions(new String[]{
                        Manifest.permission.ACCESS_FINE_LOCATION,
                        Manifest.permission.ACCESS_COARSE_LOCATION}, PERMISOS_MAPA);
            }
        });

        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::atras);
        }
        Grabador.crearCanales(this);
        viajePendiente = getIntent().getStringExtra("viaje");
        web.loadUrl(INICIO);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        String viaje = intent.getStringExtra("viaje");
        if (viaje != null) {
            viajePendiente = viaje;
            if (cargada) abrirPendiente();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        Grabador.alCambiar = () -> js("cambio", null);
        Actualizador.alCambiar = () -> js("actualizacion", null);
        if (!depurable()) Actualizador.alVolver(this);
    }

    @Override
    protected void onPause() {
        Grabador.alCambiar = null;
        Actualizador.alCambiar = null;
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }

    private boolean depurable() {
        return (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
    }

    /** Le avisa a la página: `window.__dikra(tipo, json)` (ver web/src/puente.ts). */
    private void js(String tipo, String json) {
        runOnUiThread(() -> web.evaluateJavascript("window.__dikra && window.__dikra("
                + JSONObject.quote(tipo) + "," + (json == null ? "null" : JSONObject.quote(json)) + ")", null));
    }

    private void abrirPendiente() {
        if (viajePendiente == null) return;
        js("abrir", JSONObject.quote(viajePendiente));
        viajePendiente = null;
    }

    /** Desde Android 15 la app dibuja detrás de las barras: la página se corre para no quedar tapada. */
    private void acomodarBarras(View raiz) {
        boolean oscuro = (getResources().getConfiguration().uiMode
                & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        if (Build.VERSION.SDK_INT >= 30) {
            raiz.setOnApplyWindowInsetsListener((v, insets) -> {
                Insets b = insets.getInsets(WindowInsets.Type.systemBars()
                        | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                v.setPadding(b.left, b.top, b.right, b.bottom);
                return WindowInsets.CONSUMED;
            });
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                int claros = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                        | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                c.setSystemBarsAppearance(oscuro ? 0 : claros, claros);
            }
        } else if (!oscuro) {
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
        }
    }

    /** «Atrás» vuelve adentro de la app; si ya está en Inicio, la manda al fondo. */
    private void atras() {
        web.evaluateJavascript("window.__atras ? window.__atras() : false", r -> {
            if (!"true".equals(r)) moveTaskToBack(true);
        });
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        atras();              // Android 12 y anteriores
    }

    @Override
    protected void onActivityResult(int pedido, int resultado, Intent datos) {
        if (pedido == ELEGIR_ARCHIVO && archivoPendiente != null) {
            Uri[] elegido = resultado == RESULT_OK && datos != null && datos.getData() != null
                    ? new Uri[]{datos.getData()} : null;
            archivoPendiente.onReceiveValue(elegido);
            archivoPendiente = null;
            return;
        }
        super.onActivityResult(pedido, resultado, datos);
    }

    // ---------------------------------------------------------------- permisos

    private boolean tiene(String permiso) {
        return checkSelfPermission(permiso) == PackageManager.PERMISSION_GRANTED;
    }

    private String permisosJson() {
        JSONObject o = new JSONObject();
        try {
            o.put("ubicacion", tiene(Manifest.permission.ACCESS_FINE_LOCATION) ? "precisa"
                    : tiene(Manifest.permission.ACCESS_COARSE_LOCATION) ? "aproximada" : "no");
            boolean avisos = getSystemService(NotificationManager.class).areNotificationsEnabled();
            if (Build.VERSION.SDK_INT >= 33) avisos &= tiene(Manifest.permission.POST_NOTIFICATIONS);
            o.put("notificaciones", avisos);
            LocationManager lm = (LocationManager) getSystemService(LOCATION_SERVICE);
            o.put("gps", lm.isProviderEnabled(LocationManager.GPS_PROVIDER));
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            o.put("bateria", pm.isIgnoringBatteryOptimizations(getPackageName()));
        } catch (JSONException ignorada) {
            // no pasa
        }
        return o.toString();
    }

    @Override
    public void onRequestPermissionsResult(int pedido, String[] permisos, int[] resultados) {
        if (pedido == PERMISOS_MAPA && ubicacionPendiente != null) {
            ubicacionPendiente.invoke(origenUbicacion,
                    tiene(Manifest.permission.ACCESS_FINE_LOCATION) || tiene(Manifest.permission.ACCESS_COARSE_LOCATION), false);
            ubicacionPendiente = null;
            return;
        }
        if (pedido == PERMISOS_GRABAR) {
            js("permisos", permisosJson());
            return;
        }
        super.onRequestPermissionsResult(pedido, permisos, resultados);
    }

    // ---------------------------------------------------------------- la página

    private class Cliente extends WebViewClient {
        /** La página propia se sirve desde los assets; lo demás lo abre otra app. */
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
            Uri u = r.getUrl();
            if (!HOST.equals(u.getHost())) return null;
            String ruta = u.getPath() == null || u.getPath().equals("/") ? "index.html" : u.getPath().substring(1);
            if (ruta.contains("..")) return new WebResourceResponse("text/plain", "utf-8", 404, "No encontrado", null, null);
            try {
                InputStream in = getAssets().open("web/" + ruta);
                return new WebResourceResponse(tipo(ruta), "utf-8", in);
            } catch (IOException e) {
                return new WebResourceResponse("text/plain", "utf-8", 404, "No encontrado", null, null);
            }
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
            Uri u = r.getUrl();
            if (HOST.equals(u.getHost())) return false;
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, u).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            } catch (ActivityNotFoundException e) {
                Toast.makeText(MainActivity.this, "No hay una app para abrir esto", Toast.LENGTH_SHORT).show();
            }
            return true;
        }

        @Override
        public void onPageFinished(WebView v, String url) {
            cargada = true;
            abrirPendiente();
        }
    }

    private static String tipo(String ruta) {
        if (ruta.endsWith(".html")) return "text/html";
        if (ruta.endsWith(".js")) return "text/javascript";
        if (ruta.endsWith(".css")) return "text/css";
        if (ruta.endsWith(".json")) return "application/json";
        if (ruta.endsWith(".webmanifest")) return "application/manifest+json";
        if (ruta.endsWith(".svg")) return "image/svg+xml";
        if (ruta.endsWith(".png")) return "image/png";
        return "application/octet-stream";
    }

    /** Lo que la página llama como `window.DikraNativo` (ver web/src/grabador.ts). */
    private class Puente {

        @JavascriptInterface
        public String version() {
            JSONObject o = new JSONObject();
            try {
                PackageInfo p = getPackageManager().getPackageInfo(getPackageName(), 0);
                o.put("nombre", p.versionName);
                o.put("codigo", p.getLongVersionCode());
            } catch (PackageManager.NameNotFoundException | JSONException ignorada) {
                // no pasa
            }
            return o.toString();
        }

        @JavascriptInterface
        public String estado() {
            return Grabador.estadoJson();
        }

        /** Empieza a grabar. Devuelve "" o el texto de por qué no se puede. */
        @JavascriptInterface
        public String empezar(String json) {
            try {
                JSONObject o = new JSONObject(json);
                String id = o.getString("id");
                if (!Viajes.idValido(id)) return "El viaje no tiene un nombre válido.";
                if (!tiene(Manifest.permission.ACCESS_FINE_LOCATION)) return "Falta el permiso de ubicación precisa.";
                LocationManager lm = (LocationManager) getSystemService(LOCATION_SERVICE);
                if (!lm.isProviderEnabled(LocationManager.GPS_PROVIDER)) return "La ubicación del teléfono está apagada.";
                Grabador.Estado e = Grabador.actual;
                if (e != null && !e.id.equals(id)) return "Ya está grabando otro viaje.";
                Intent i = new Intent(MainActivity.this, Grabador.class).setAction(Grabador.EMPEZAR)
                        .putExtra("id", id)
                        .putExtra("inicio", o.optLong("inicio", System.currentTimeMillis()))
                        .putExtra("destino", o.isNull("destino") ? "null" : o.getJSONObject("destino").toString());
                startForegroundService(i);
                return "";
            } catch (JSONException e) {
                return "No se entendió el pedido: " + e.getMessage();
            } catch (RuntimeException e) {
                return "Android no dejó empezar a grabar: " + e.getMessage();
            }
        }

        @JavascriptInterface
        public void terminar() {
            if (Grabador.actual != null) startService(new Intent(MainActivity.this, Grabador.class).setAction(Grabador.TERMINAR));
        }

        @JavascriptInterface
        public void descartar() {
            if (Grabador.actual != null) startService(new Intent(MainActivity.this, Grabador.class).setAction(Grabador.DESCARTAR));
        }

        @JavascriptInterface
        public String puntos(String id, int desde) {
            return Viajes.puntosJson(MainActivity.this, id, Math.max(0, desde));
        }

        @JavascriptInterface
        public String terminados() {
            return Viajes.terminadosJson(MainActivity.this);
        }

        @JavascriptInterface
        public void guardado(String id) {
            Viajes.marcarGuardado(MainActivity.this, id);
        }

        @JavascriptInterface
        public String permisos() {
            return permisosJson();
        }

        @JavascriptInterface
        public void pedirPermisos() {
            runOnUiThread(() -> {
                List<String> faltan = new ArrayList<>();
                if (!tiene(Manifest.permission.ACCESS_FINE_LOCATION)) {
                    faltan.add(Manifest.permission.ACCESS_FINE_LOCATION);
                    faltan.add(Manifest.permission.ACCESS_COARSE_LOCATION);
                }
                if (Build.VERSION.SDK_INT >= 33 && !tiene(Manifest.permission.POST_NOTIFICATIONS)) {
                    faltan.add(Manifest.permission.POST_NOTIFICATIONS);
                }
                if (faltan.isEmpty()) js("permisos", permisosJson());
                else requestPermissions(faltan.toArray(new String[0]), PERMISOS_GRABAR);
            });
        }

        @JavascriptInterface
        public void abrirAjustes(String que) {
            runOnUiThread(() -> {
                Uri paquete = Uri.parse("package:" + getPackageName());
                Intent i;
                switch (que) {
                    case "ubicacion":
                        i = new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS);
                        break;
                    case "bateria":
                        // El pedido directo; si el teléfono no lo tiene, la lista de apps.
                        i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, paquete);
                        if (i.resolveActivity(getPackageManager()) == null) {
                            i = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                        }
                        break;
                    case "instalar":
                        i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, paquete);
                        break;
                    default:
                        i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, paquete);
                }
                try {
                    startActivity(i);
                } catch (ActivityNotFoundException e) {
                    startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, paquete));
                }
            });
        }

        /** El respaldo: a la carpeta Descargas del teléfono. */
        @JavascriptInterface
        public void guardar(String nombre, String texto) {
            runOnUiThread(() -> guardarEnDescargas(nombre, texto));
        }

        @JavascriptInterface
        public String actualizacion() {
            return Actualizador.estadoJson(MainActivity.this);
        }

        @JavascriptInterface
        public void buscarActualizacion() {
            Actualizador.buscar(MainActivity.this, true);
        }

        @JavascriptInterface
        public void actualizar() {
            runOnUiThread(() -> Actualizador.actualizar(MainActivity.this));
        }
    }

    private void guardarEnDescargas(String nombre, String texto) {
        try {
            ContentValues cv = new ContentValues();
            cv.put(MediaStore.Downloads.DISPLAY_NAME, nombre);
            cv.put(MediaStore.Downloads.MIME_TYPE, "application/json");
            cv.put(MediaStore.Downloads.IS_PENDING, 1);
            Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
            if (uri == null) throw new IOException("Android no dio dónde guardar");
            try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                if (out == null) throw new IOException("Android no dio dónde guardar");
                out.write(texto.getBytes(StandardCharsets.UTF_8));
            }
            cv.clear();
            cv.put(MediaStore.Downloads.IS_PENDING, 0);
            getContentResolver().update(uri, cv, null, null);
            Toast.makeText(this, "Guardado en Descargas: " + nombre, Toast.LENGTH_LONG).show();
        } catch (Exception e) {
            Toast.makeText(this, "No se pudo guardar: " + e.getMessage(), Toast.LENGTH_LONG).show();
        }
    }
}
