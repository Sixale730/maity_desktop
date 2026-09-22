// Tema claro/oscuro de las ventanas AUXILIARES (coach-float, recording-widget, device-picker).
// Lo carga <script src="/aux-theme-boot.js"> bloqueante en el <head> de app/(aux)/layout.tsx
// (CSP script-src 'self': inline no). Mismo origen que la main → mismo localStorage: sigue la
// elección del toggle de la barra lateral (maity-portal-theme; default claro).
// A diferencia de theme-boot.js (main) SOLO alterna `.dark`: sin data-portal-theme, que pinta el
// lienzo de fondo del <html> y taparía la transparencia de estas ventanas.
// La sincronía en vivo (alternar con una ventana aux abierta) la hace lib/auxTheme.ts.
(function () {
  var dark = false;
  try {
    dark = localStorage.getItem('maity-portal-theme') === 'dark';
  } catch (e) {
    /* sin storage disponible: claro */
  }
  document.documentElement.classList.toggle('dark', dark);
})();
