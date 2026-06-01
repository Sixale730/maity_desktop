<div align="center" style="border-bottom: none">
    <h1>
        <img src="docs/Maity-6.png" style="border-radius: 10px;" />
        <br>
        Maity Desktop - Asistente de Reuniones con IA
    </h1>
    <br>
    <a href="https://github.com/ponchovillalobos/maity-desktop/releases/"><img src="https://img.shields.io/badge/Descargar-v0.2.0-brightgreen" alt="Descargar"></a>
    <a href="https://github.com/ponchovillalobos/maity-desktop/releases"><img src="https://img.shields.io/badge/Licencia-MIT-blue" alt="Licencia"></a>
    <a href="https://github.com/ponchovillalobos/maity-desktop/releases"><img src="https://img.shields.io/badge/SO_Soportado-Windows-white" alt="SO Soportado"></a>
    <br>
    <h3>
    <br>
    Transcripcion con Deepgram - Resumenes con ChatGPT - Facil de Usar
    </h3>
</div>

---

## Que es Maity Desktop?

Maity Desktop es un asistente de reuniones con inteligencia artificial. Graba tus reuniones, las transcribe en tiempo real con **Deepgram** y genera resumenes automaticos con **ChatGPT**.

Perfecto para profesionales que necesitan documentar sus reuniones de forma rapida y precisa.

---

## Caracteristicas Principales

- **Transcripcion Deepgram:** Transcripcion rapida y precisa en tiempo real con la API de Deepgram.
- **Resumenes con ChatGPT:** Genera resumenes automaticos, puntos clave y acciones usando OpenAI GPT.
- **Transcripcion en Tiempo Real:** Obtén la transcripcion de tu reunion mientras ocurre.
- **Deteccion de Reuniones:** Detecta automaticamente cuando inicias Zoom, Teams, Meet, etc.
- **Modo Oscuro:** Interfaz completamente adaptada para trabajar de noche.
- **Grabacion Dual:** Captura audio del microfono y del sistema simultaneamente.

---

## Instalacion

### Windows

1. Descarga el instalador desde [Releases](https://github.com/ponchovillalobos/maity-desktop/releases/latest)
   - `Maity_0.2.0_x64-setup.exe` (Recomendado)
   - `Maity_0.2.0_x64_en-US.msi` (Para empresas/IT)

2. Ejecuta el instalador
   - Si Windows muestra advertencia de seguridad: Clic en **Mas informacion** → **Ejecutar de todas formas**

3. Abre **Maity** desde el menu de inicio

### Requisitos del Sistema

- Windows 10/11 (64-bit)
- 4 GB de RAM minimo (8 GB recomendado)
- Microfono
- **Conexion a internet** (requerida para Deepgram y ChatGPT)
- API Key de Deepgram (transcripcion)
- API Key de OpenAI (resumenes con ChatGPT)

---

## Como Funciona

### 1. Grabacion de Audio

Captura audio del microfono y del sistema simultaneamente. Perfecto para grabar llamadas de Zoom, Teams, Meet, etc.

<p align="center">
    <img src="docs/audio.png" width="650" style="border-radius: 10px;" alt="Seleccion de dispositivos" />
</p>

### 2. Transcripcion en Tiempo Real

Transcribe reuniones usando **Deepgram**, uno de los servicios de transcripcion mas rapidos y precisos. La transcripcion aparece mientras hablas con identificacion de hablantes.

<p align="center">
    <img src="docs/home.png" width="650" style="border-radius: 10px;" alt="Transcripcion" />
</p>

### 3. Resumenes con ChatGPT

Genera resumenes automaticos con **ChatGPT (OpenAI)**. Obtén puntos clave, decisiones tomadas y acciones pendientes de forma automatica.

<p align="center">
    <img src="docs/summary.png" width="650" style="border-radius: 10px;" alt="Generacion de resumenes" />
</p>

### 4. Configuracion Flexible

Personaliza la aplicacion segun tus necesidades: modelos de transcripcion, proveedores de IA, idioma, etc.

<p align="center">
    <img src="docs/settings.png" width="650" style="border-radius: 10px;" alt="Configuracion" />
</p>

---

## Servicios Utilizados

### Transcripcion: Deepgram
| Caracteristica | Detalle |
|----------------|---------|
| **Servicio** | [Deepgram](https://deepgram.com) |
| **Precision** | Alta precision con modelos Nova-2 |
| **Velocidad** | Transcripcion en tiempo real |
| **Idiomas** | Español, Ingles y mas de 30 idiomas |
| **Costo** | Plan gratuito disponible (limites aplicados) |

### Resumenes: ChatGPT (OpenAI)
| Caracteristica | Detalle |
|----------------|---------|
| **Servicio** | [OpenAI API](https://openai.com) |
| **Modelos** | GPT-4, GPT-4o, GPT-3.5-turbo |
| **Funciones** | Resumenes, puntos clave, acciones, decisiones |
| **Costo** | Pago por uso (API de OpenAI) |

---

## Preguntas Frecuentes

### Que necesito para empezar?
Necesitas una API Key de **Deepgram** para transcripcion y una API Key de **OpenAI** para los resumenes con ChatGPT. Ambas se configuran en la aplicacion.

### Necesito internet?
**Si.** Maity requiere conexion a internet para enviar el audio a Deepgram y generar resumenes con ChatGPT.

### Donde se procesan mis datos?
El audio se envia a Deepgram para transcripcion y el texto a OpenAI para resumenes. Consulta las politicas de privacidad de cada servicio.

### Que reuniones puedo grabar?
Cualquier reunion donde puedas escuchar el audio: Zoom, Google Meet, Microsoft Teams, Webex, Discord, Slack, llamadas telefonicas, etc.

### Es legal grabar reuniones?
Depende de tu jurisdiccion. En muchos lugares debes informar a los participantes que estas grabando. **Maity te recuerda esto antes de cada grabacion**.

### Cuanto cuesta?
La aplicacion es gratuita. El costo depende de tu uso de las APIs:
- **Deepgram:** Plan gratuito con limites, luego ~$0.0043/min
- **OpenAI:** Pago por tokens (~$0.01-0.03 por resumen)

---

## Soporte

Si encuentras algun problema o tienes sugerencias:

1. Abre un [Issue en GitHub](https://github.com/ponchovillalobos/maity-desktop/issues)
2. Incluye la version de Maity y tu sistema operativo
3. Describe el problema con el mayor detalle posible

---

## Licencia

MIT License - Puedes usar este proyecto libremente.

---

## Creditos

Este proyecto utiliza:
- [Deepgram](https://deepgram.com) - Servicio de transcripcion de audio
- [OpenAI](https://openai.com) - API de ChatGPT para resumenes
- [Tauri](https://tauri.app/) - Framework de aplicaciones de escritorio

---

<div align="center">
    <p>
        <b>Maity Desktop v0.2.0</b><br>
        Hecho con ❤️ para profesionales que valoran su privacidad
    </p>
</div>
