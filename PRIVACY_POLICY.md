# Politica de Privacidad de Maity

*Ultima actualizacion: Febrero 2026 - v0.2.1*

## 1. Nuestro Compromiso con la Privacidad

Maity esta construido sobre el principio de que los datos de tus reuniones deben permanecer privados y bajo tu control. Esta politica de privacidad explica como manejamos los datos en nuestro asistente de reuniones open source.

**Maity es local primero**: toda la transcripcion de audio se procesa completamente en tu dispositivo. Ningun audio de reunion sale de tu computadora.

## 2. Filosofia de Procesamiento de Datos - Local Primero

### Transcripcion 100% Local
- **Parakeet (predeterminado)**: Motor de transcripcion local basado en ONNX que se ejecuta completamente en tu dispositivo
- **Canary (opcional)**: Motor de transcripcion local alternativo, tambien basado en ONNX, sin conexion a internet
- **Sin transcripcion en la nube**: No se envia audio a ningun servidor externo para transcripcion
- **Grabaciones de audio**: Nunca se transmiten a servidores externos
- **Contenido de reuniones**: Permanece en tu infraestructura local

### Resumenes con IA (Opcional)
- **Ollama (local)**: Procesamiento completamente en tu dispositivo, sin datos enviados a internet
- **Claude (Anthropic)**: Si eliges usar Claude, el texto de la transcripcion se envia a los servidores de Anthropic
- **Groq**: Si eliges usar Groq, el texto de la transcripcion se envia a los servidores de Groq
- **OpenRouter**: Si eliges usar OpenRouter, el texto de la transcripcion se envia a los servidores de OpenRouter

**Nota**: Los resumenes con LLM son completamente opcionales. Puedes usar Maity solo para transcripcion local sin conectarte a ningun servicio externo.

## 3. Propiedad de tus Datos

- Tu eres dueno de todos los datos de reuniones, transcripciones y grabaciones
- Los datos se almacenan localmente en tu dispositivo
- Sin dependencia de proveedor - exporta tus datos en cualquier momento
- Control completo sobre retencion y eliminacion de datos
- La base de datos SQLite local es accesible y portable

## 4. Analiticas de Uso

### Lo que Recopilamos
Para mejorar Maity y asegurar un rendimiento optimo, recopilamos datos de uso minimos y anonimizados:

**Uso de la Aplicacion:**
- Patrones de uso de funcionalidades (que herramientas usas mas)
- Duracion y frecuencia de sesiones
- Metricas de rendimiento (tasas de exito de transcripcion, frecuencia de errores)
- Patrones de interaccion de UI (clics en botones, flujos de navegacion)

**Metricas Tecnicas:**
- Version de la aplicacion e informacion de plataforma
- Logs de errores y reportes de crashes (anonimizados)
- Benchmarks de rendimiento (tiempos de procesamiento, uso de recursos)

### Lo que NO Recopilamos
Nunca recopilamos:
- Contenido de reuniones, transcripciones o grabaciones
- Informacion personal o datos identificables
- Nombres de archivos, titulos de reuniones o metadatos
- Datos de audio o patrones de voz
- Nombres de participantes o informacion de contacto
- Conversaciones con LLM o contenido generado por IA
- Claves de API o credenciales de servicios

### Por que Recopilamos estos Datos
Esta recopilacion de analiticas es necesaria para:
- **Calidad del Producto**: Identificar y corregir bugs que impactan la experiencia del usuario
- **Optimizacion de Rendimiento**: Entender el uso de recursos y cuellos de botella del sistema
- **Seguridad**: Detectar posibles problemas de seguridad y vulnerabilidades
- **Desarrollo de Funcionalidades**: Tomar decisiones basadas en datos sobre nuevas funcionalidades
- **Sostenibilidad Open Source**: Asegurar que el proyecto satisfaga las necesidades de los usuarios

### Implementacion de Analiticas
- **Proveedor**: PostHog (plataforma de analiticas enfocada en privacidad)
- **Anonimizacion**: Todos los datos vinculados solo a IDs de usuario generados - sin identificacion personal
- **Retencion de datos**: Maximo 12 meses, luego se eliminan automaticamente
- **Cifrado**: Todos los datos cifrados en transito usando protocolos estandar de la industria
- **Control de acceso**: Estrictamente limitado a miembros del equipo core de desarrollo
- **Opcional**: Las analiticas son completamente opcionales y controladas por el usuario

## 5. Servicios de Terceros

### Proveedores de LLM (Opcionales)
Si eliges usar proveedores externos de LLM para resumenes:
- **Ollama (local)**: Procesado completamente en tu dispositivo. Sin datos enviados externamente.
- **Claude (Anthropic)**: Sujeto a la [politica de privacidad de Anthropic](https://www.anthropic.com/privacy)
- **Groq**: Sujeto a la [politica de privacidad de Groq](https://groq.com/privacy-policy/)
- **OpenRouter**: Sujeto a la [politica de privacidad de OpenRouter](https://openrouter.ai/privacy)

**Importante**: Solo el texto de la transcripcion se envia a estos proveedores cuando generas un resumen. El audio original nunca se comparte.

### Servicio de Analiticas (Opcional)
- **PostHog**: Usado para analiticas de uso cuando esta habilitado
- **Datos**: Solo patrones de uso anonimizados, sin contenido de reuniones
- **Control**: Completamente opcional y controlado por el usuario

## 6. Tus Derechos de Privacidad

### Control de Datos
- **Acceso**: Ve todos los datos almacenados localmente en tu dispositivo
- **Exportacion**: Exporta tus datos en formatos estandar
- **Eliminacion**: Elimina todos los datos de tu dispositivo
- **Desactivacion de analiticas**: Desactiva la recopilacion de analiticas en cualquier momento

### Transparencia de Analiticas
- **Open source**: La implementacion completa de analiticas esta disponible para revision en nuestro codigo fuente
- **Preguntas**: Contactanos para cualquier inquietud relacionada con analiticas

## 7. Seguridad de Datos

### Seguridad Local
- Los datos se almacenan usando las funcionalidades de seguridad de tu dispositivo
- Sin transmision de datos sensibles de reuniones (a menos que elijas usar un LLM externo)
- Permisos estandar del sistema de archivos protegen tus datos
- La base de datos SQLite local no requiere credenciales de red

### Transparencia Open Source
- Codigo fuente completo disponible para revision de seguridad
- Implementaciones de privacidad auditadas por la comunidad
- Sin recopilacion oculta de datos o rastreo

## 8. Cambios a esta Politica

Notificaremos a los usuarios sobre cualquier cambio material a esta politica de privacidad a traves de:
- Actualizaciones a este documento en nuestro repositorio de GitHub
- Notas de release para actualizaciones de la aplicacion
- Notificaciones in-app para cambios significativos de privacidad

## 9. Contacto

Para preguntas o inquietudes relacionadas con privacidad:
- **GitHub Issues**: [Crear un issue](https://github.com/ponchovillalobos/maity-desktop/issues)

## 10. Compromiso Open Source

Como proyecto open source bajo licencia MIT, puedes:
- Revisar nuestra implementacion completa de privacidad
- Modificar el manejo de datos para cumplir con tus requisitos
- Desplegar completamente en tu propia infraestructura
- Contribuir a mejoras de privacidad

---

*Esta politica de privacidad aplica a Maity v0.2.1 y versiones posteriores.*
