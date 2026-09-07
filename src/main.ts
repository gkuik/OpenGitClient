import { mount } from "svelte";
import "./app.css";
import App from "./App.svelte";
import { font } from "./lib/font.svelte";
import { i18n } from "./lib/i18n.svelte";
import { layout } from "./lib/layout.svelte";
import { theme } from "./lib/theme.svelte";

// Avant le montage : la palette doit être posée sur `<html>` dès le premier
// rendu, sinon l'application apparaîtrait en sombre le temps de la corriger.
theme.init();
// La langue, avant le montage elle aussi : elle est lue dans les préférences du
// système, donc sans aller-retour vers Rust, et aucun texte n'a à clignoter.
i18n.init();
// La taille du texte, elle, a son défaut dans `app.css` : la lecture de la
// préférence peut donc attendre le montage sans que rien ne clignote.
font.init();
// Idem pour les largeurs des colonnes latérales : leur défaut est dans
// `app.css`, la préférence arrive après.
layout.init();

const app = mount(App, {
  target: document.getElementById("app")!,
});

export default app;
