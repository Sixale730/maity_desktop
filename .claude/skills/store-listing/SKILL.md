---
name: store-listing
description: Abrir en el Explorador los assets de la ficha de Microsoft Store (logos, tiles, screenshots) para arrastrarlos fácil a Partner Center, y abrir un HTML con los textos en español copiables con un botón por sección. Úsalo cuando el usuario esté llenando la Store listing de Maity y diga cosas como "ábreme los logos", "abre el poster/box art", "abre los screenshots", "dame los textos / la descripción en español", o "abre la carpeta de la Store".
---

# Store listing de Maity — assets + textos (ES)

Ayuda a llenar la ficha de la **Microsoft Store** (Partner Center, producto **Maity**, Store ID `9NTKJ5X6230F`, ficha en **Español**). Todo vive en `C:\maity_desktop\store_listing_assets\`:

```
store_listing_assets\
├── logos\
│   ├── poster-art-9x16-720x1080.png    → "9:16 Poster art" (720x1080, req. Xbox)
│   ├── box-art-1x1-2160x2160.png       → "1:1 Box art"      (2160x2160)
│   ├── app-tile-300x300.png            → "1:1 App tile icon"(300x300)
│   ├── tile-150x150.png                → "1:1"              (150x150)
│   └── tile-71x71.png                  → "1:1"              (71x71)
├── screenshots\        (capturas reales de la app; ver README ahí)
├── textos-es.md        (Description, What's new, Product features + mapeo)
└── copiar-textos.html  (UI para copiar cada texto con un botón)
```

**Assets = fuente de verdad:** son los originales azules (`#485DF4` + logo blanco; wordmark "maity" solo en el Poster; Box/tiles solo icono). Respaldo original: `G:\alfon\Descargas\descarga (1..5).png`.

## Cuando pidan TEXTOS → abrir el HTML copiable

Si el usuario pide la descripción / textos / features (en español), **abre `copiar-textos.html`** en el navegador — tiene cada sección (Product name, Description, What's new, Product features) con botón **Copiar** (y "Copiar todas" para features, una por línea):

```powershell
cmd.exe /c start "" "C:\maity_desktop\store_listing_assets\copiar-textos.html"
```
> El copy usa Clipboard API con fallback a `execCommand` (funciona desde `file://`). Los textos también están en `textos-es.md` por si se piden en el chat.

## Cuando pidan LOGOS/imágenes → abrir el Explorador con el archivo seleccionado

`explorer.exe` devuelve exit code 1 aunque abra bien → ignorar el código, no reintentar.

- **Un archivo seleccionado** (mejor para arrastrar):
  ```powershell
  explorer.exe /select,"C:\maity_desktop\store_listing_assets\logos\poster-art-9x16-720x1080.png"
  ```
- **Carpeta completa**:
  ```powershell
  explorer.exe "C:\maity_desktop\store_listing_assets\logos"
  explorer.exe "C:\maity_desktop\store_listing_assets\screenshots"
  ```

## Dispatch: qué pide el usuario → qué hacer

| El usuario dice… | Acción |
|---|---|
| "textos" / "descripción" / "features" / "novedades" | abrir `copiar-textos.html` |
| "poster" / "9:16" / "Xbox" | `/select` `logos\poster-art-9x16-720x1080.png` |
| "box art" / "cuadrado grande" | `/select` `logos\box-art-1x1-2160x2160.png` |
| "app tile" / "300" | `/select` `logos\app-tile-300x300.png` |
| "150" / "71" | `/select` el tile correspondiente |
| "logos" / "todos los logos" | abrir carpeta `logos\` |
| "screenshots" / "capturas" | abrir carpeta `screenshots\` |
| "todo" / "la carpeta" | abrir carpeta raíz `store_listing_assets\` |

## Regenerar assets (si hiciera falta)

Los originales son la referencia. Si hay que rehacerlos: azul de marca **`#485DF4`**, logo blanco (desde `frontend/src-tauri/icons/icon.png` con `lutrgb=r=255:g=255:b=255`). Promocionales con Chrome headless desde HTML, tiles con ffmpeg (solid color + overlay). Verificar dimensiones exactas con `ffprobe`.

## Screenshots (pendiente del usuario)

Partner Center exige **≥1 screenshot** (Desktop, mín. 1366×768, PNG). Requieren captura **real** de la app. El usuario las deja en `screenshots\`; luego se pueden reescalar/enmarcar con ffmpeg. Ver `screenshots\README.md`.

## Relación con `/store-msix`

`/store-listing` = **ficha** (textos + imágenes). `/store-msix` = **paquete** (.msix). Ambos alimentan el mismo producto en Partner Center.
