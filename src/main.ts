import { mount } from "svelte";
import "./app.css";
import App from "./App.svelte";
import { theme } from "./lib/theme.svelte";

// Avant le montage : la palette doit être posée sur `<html>` dès le premier
// rendu, sinon l'application apparaîtrait en sombre le temps de la corriger.
theme.init();

const app = mount(App, {
  target: document.getElementById("app")!,
});

export default app;
