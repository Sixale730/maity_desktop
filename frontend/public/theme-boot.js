// Origen: web Sixale730/maity@3ef2914 public/theme-boot.js (copia tal cual; solo cambia este encabezado).
// Desktop: lo carga <script src="/theme-boot.js"> bloqueante en el <head> de app/(main)/layout.tsx
// (CSP script-src 'self': inline no). Las ventanas aux NO lo cargan: siguen oscuras y transparentes.
// Aplica el tema guardado antes del primer pintado para evitar el destello al cargar.
// Va como archivo externo: el CSP de vercel.json no permite scripts inline.
// El default es claro; solo quien eligió oscuro en el portal (maity-portal-theme) arranca en oscuro.
(function () {
  var theme = 'light';
  try {
    if (localStorage.getItem('maity-portal-theme') === 'dark') theme = 'dark';
  } catch (e) {
    /* sin storage disponible: claro */
  }
  var html = document.documentElement;
  html.setAttribute('data-portal-theme', theme);
  html.classList.toggle('dark', theme === 'dark');
})();
