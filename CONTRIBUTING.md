# Contribuir a Maity Desktop

Gracias por tu interes en contribuir a Maity Desktop. Este documento explica como puedes ayudar.

## Como Contribuir

### Reportar Bugs

1. Ve a [Issues](https://github.com/ponchovillalobos/maity-desktop/issues)
2. Clic en "New Issue"
3. Incluye:
   - Version de Maity Desktop
   - Sistema operativo
   - Pasos para reproducir el problema
   - Que esperabas que pasara
   - Que paso realmente
   - Capturas de pantalla (si aplica)

### Sugerir Mejoras

1. Abre un Issue describiendo tu idea
2. Explica por que seria util
3. Si es posible, incluye mockups o ejemplos

### Enviar Codigo

1. Haz fork del repositorio
2. Crea una rama para tu cambio:
   ```bash
   git checkout -b mi-mejora
   ```
3. Haz tus cambios
4. Asegurate de que compile:
   ```bash
   cd frontend && pnpm run tauri:build
   ```
5. Haz commit:
   ```bash
   git commit -m "Descripcion del cambio"
   ```
6. Push a tu fork:
   ```bash
   git push origin mi-mejora
   ```
7. Abre un Pull Request

## Estructura del Proyecto

```
maity-desktop/
├── frontend/           # Aplicacion de escritorio Tauri
│   ├── src/            # Codigo React/Next.js/TypeScript
│   └── src-tauri/      # Backend Rust (audio, transcripcion, DB)
├── backend/            # Servidor FastAPI (resumenes LLM, opcional)
└── docs/               # Documentacion e imagenes
```

## Requisitos de Desarrollo

- Node.js 18+
- Rust 1.75+
- pnpm 8+
- Visual Studio Build Tools (Windows)

## Comandos Utiles

```bash
# Instalar dependencias
cd frontend
pnpm install

# Modo desarrollo
pnpm tauri dev

# Compilar release
pnpm run tauri:build

# Solo frontend
pnpm dev
```

## Guia de Estilo

- Usa TypeScript para el frontend
- Usa Rust para el backend
- Comenta codigo complejo
- Nombres de variables y funciones en ingles
- Mensajes de UI en espanol

## Formato de Commits

```
<tipo>: <descripcion>

<cuerpo opcional>
```

Tipos:
- `feat`: Nueva funcionalidad
- `fix`: Correccion de bug
- `docs`: Cambios en documentacion
- `style`: Cambios de formato
- `refactor`: Refactorizacion
- `test`: Agregar/actualizar tests
- `chore`: Tareas de mantenimiento

## Proceso de Revision

1. Los PRs requieren al menos una revision
2. Responde a todos los comentarios
3. Manten el PR actualizado con `main`

## Preguntas

Si tienes preguntas, abre un Issue con la etiqueta "question".

## Licencia

Al contribuir, aceptas que tus contribuciones seran licenciadas bajo la Licencia MIT del proyecto.

---

Gracias por contribuir!
