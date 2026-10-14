#!/bin/sh
# Éditeur de liens des builds de développement macOS : celui de Rust (`cc`),
# suivi d'une signature du binaire de l'application par une identité stable.
#
# Pourquoi : le trousseau autorise une application à relire une entrée
# (jeton d'accès) d'après son **identité de signature**. Un binaire de dev est
# signé « ad hoc », et cette identité-là est l'empreinte du binaire — elle
# change à chaque compilation, donc macOS redemande le mot de passe du
# trousseau à chaque mise à jour du code. Signé par un certificat qui ne change
# pas, le binaire garde la même identité d'un build à l'autre : un « Toujours
# autoriser » suffit, une fois pour toutes.
#
# `tauri dev` lance le binaire lui-même (pas de `cargo run`), si bien qu'un
# « runner » Cargo ne servirait à rien : l'édition de liens est la seule étape
# qui passe à chaque recompilation.
#
# L'identité est `OpenGitClient Dev` (ou `OGC_SIGN_IDENTITY`), un certificat de
# signature de code auto-signé à créer une fois dans Trousseaux d'accès. Absente,
# rien n'est signé et le build se déroule comme avant — la demande de mot de
# passe en plus.

cc "$@" || exit $?

# Le fichier produit : l'argument qui suit `-o`.
out=""
prev=""
for arg in "$@"; do
  [ "$prev" = "-o" ] && out="$arg"
  prev="$arg"
done

# Seulement l'exécutable de l'application, et seulement en debug : les scripts
# de build, les macros procédurales et les builds de release n'ont rien à y
# gagner (une release se signe à l'empaquetage).
case "$out" in
  */target/debug/deps/opengitclient-*) ;;
  *) exit 0 ;;
esac
case "$out" in
  *.d | *.rlib | *.dylib | *.rmeta) exit 0 ;;
esac

identity="${OGC_SIGN_IDENTITY:-OpenGitClient Dev}"
if ! security find-certificate -c "$identity" >/dev/null 2>&1; then
  exit 0
fi

# `--identifier` fixe : par défaut, codesign le déduirait du nom de fichier,
# qui porte l'empreinte de Cargo et change donc elle aussi.
codesign --force --sign "$identity" --identifier com.opengitclient.app.dev "$out" >/dev/null 2>&1 ||
  echo "warning: dev signing with \"$identity\" failed; the keychain will keep asking" >&2
exit 0
