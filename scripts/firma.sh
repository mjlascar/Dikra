#!/usr/bin/env bash
# Crea la clave estable con la que CI firma los APK de Dikra y deja listo lo que hay que cargar
# como secretos en GitHub. Uso: scripts/firma.sh
#
# Android reconoce una app por su paquete y su firma: un APK firmado con otra clave no se instala
# encima, hay que desinstalar, y eso borra los viajes. Por eso la clave es una sola, para siempre:
# perderla es tener que empezar de cero. Copiá la carpeta al pendrive.
#
# La clave queda en ~/dikra-firma/ (nunca adentro del repo, que es público). Si ya hay una, no la
# pisa. En el repo sólo queda la huella (scripts/firma.sha256), que es pública: CI la usa para
# verificar que cada APK salió firmado con esta clave.
set -euo pipefail
cd "$(dirname "$0")/.."

dir=${DIKRA_FIRMA_DIR:-$HOME/dikra-firma}
ks=$dir/dikra.keystore
case "$(realpath -m "$dir")" in
  "$(realpath .)"*) echo "La clave no puede ir adentro del repo: es público." >&2; exit 1 ;;
esac
if [ -e "$ks" ]; then
  echo "Ya hay una clave en $ks: no la piso (perderla obliga a desinstalar)." >&2
  exit 1
fi

mkdir -p "$dir"
chmod 700 "$dir"
clave=$(head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 32)
keytool -genkeypair -noprompt -storetype PKCS12 -keystore "$ks" -alias dikra \
  -keyalg RSA -keysize 3072 -validity 20000 -dname "CN=Dikra" \
  -storepass "$clave" -keypass "$clave" >/dev/null 2>&1
chmod 600 "$ks"

printf '%s\n' "$clave" > "$dir/DIKRA_KEYSTORE_PASSWORD.txt"
base64 -w0 "$ks" > "$dir/DIKRA_KEYSTORE_B64.txt"
chmod 600 "$dir"/*.txt
keytool -list -v -keystore "$ks" -storepass "$clave" -alias dikra \
  | sed -n 's/^.*SHA256: //p' | tr -d ':' | tr 'A-F' 'a-f' > scripts/firma.sha256
cat > "$dir/LEEME.txt" <<EOF
La clave con la que se firma Dikra (github.com/mjlascar/Dikra). Sin ella, el teléfono no puede
actualizarse: habría que desinstalar, y eso borra los viajes. Guardá esta carpeta en un lugar seguro.

- dikra.keystore: la clave (PKCS12, alias «dikra»).
- DIKRA_KEYSTORE_PASSWORD.txt y DIKRA_KEYSTORE_B64.txt: los dos secretos que van en GitHub
  (Settings → Secrets and variables → Actions), con esos mismos nombres.
- Huella SHA-256 del certificado: $(cat scripts/firma.sha256)
EOF

echo "Clave creada en $dir"
echo "Huella: $(cat scripts/firma.sha256) (quedó en scripts/firma.sha256)"
echo "Falta cargar en GitHub los dos secretos: el contenido de $dir/DIKRA_KEYSTORE_B64.txt y de $dir/DIKRA_KEYSTORE_PASSWORD.txt."
