# Documentacion de la API de Maity

## Requisitos Previos

### Requisitos del Sistema
- Python 3.8 o superior
- pip (instalador de paquetes de Python)
- SQLite 3
- Espacio en disco suficiente para la base de datos y almacenamiento de transcripciones

### Variables de Entorno Requeridas
Crear un archivo `.env` en el directorio backend con las siguientes variables:
```env
# Claves de API
ANTHROPIC_API_KEY=tu_clave_api_anthropic    # Requerida para modelo Claude
GROQ_API_KEY=tu_clave_api_groq              # Opcional, para modelo Groq

# Configuracion de Base de Datos
DB_PATH=./meetings.db                        # Ruta de la base de datos SQLite

# Configuracion del Servidor
HOST=0.0.0.0                                # Host del servidor
PORT=5167                                   # Puerto del servidor

# Configuracion de Procesamiento
CHUNK_SIZE=5000                             # Tamano de fragmento por defecto para procesamiento
CHUNK_OVERLAP=1000                          # Superposicion por defecto entre fragmentos
```

> **Nota**: Los proveedores LLM disponibles son: Ollama (local), Claude (Anthropic), Groq, OpenRouter. No se requiere clave de API para Ollama ya que se ejecuta localmente.

### Instalacion

1. Crear y activar un entorno virtual:
```bash
python -m venv venv
source venv/bin/activate  # En Windows: venv\Scripts\activate
```

2. Instalar paquetes requeridos:
```bash
pip install -r requirements.txt
```

Paquetes requeridos:
- pydantic
- pydantic-ai==0.0.19
- pandas
- devtools
- chromadb
- python-dotenv
- fastapi
- uvicorn
- python-multipart
- aiosqlite

3. Inicializar la base de datos:
```bash
python -c "from app.db import init_db; import asyncio; asyncio.run(init_db())"
```

### Ejecutar el Servidor

Iniciar el servidor usando uvicorn:
```bash
uvicorn app.main:app --host 0.0.0.0 --port 5167 --reload
```

La API estara disponible en `http://localhost:5167`

## Estructura del Proyecto
```
backend/
├── app/
│   ├── __init__.py
│   ├── main.py              # Aplicacion principal FastAPI
│   ├── db.py               # Operaciones de base de datos
│   └── transcript_processor.py # Logica de procesamiento de transcripciones
├── requirements.txt         # Dependencias de Python
└── meeting_minutes.db       # Base de datos SQLite
```

## Descripcion General
Esta API proporciona endpoints para procesar transcripciones de reuniones y generar resumenes estructurados. Utiliza modelos de IA para analizar transcripciones y extraer informacion clave como elementos de accion, decisiones y plazos.

Los proveedores LLM soportados para generacion de resumenes son:
- **Ollama** - Ejecucion local, sin clave de API requerida
- **Claude** (Anthropic) - Requiere `ANTHROPIC_API_KEY`
- **Groq** - Requiere `GROQ_API_KEY`
- **OpenRouter** - Requiere clave de API de OpenRouter

## URL Base
```
http://localhost:5167
```

## Autenticacion
Actualmente no se requiere autenticacion para los endpoints de la API.

## Endpoints

### 1. Procesar Transcripcion
Procesar un texto de transcripcion directamente.

**Endpoint:** `/process-transcript`
**Metodo:** POST
**Content-Type:** `application/json`

#### Cuerpo de la Solicitud
```json
{
    "text": "string",           // Requerido: El texto de la transcripcion
    "model": "string",          // Requerido: Proveedor de IA a usar (ej., "ollama", "claude", "groq")
    "model_name": "string",     // Requerido: Version del modelo (ej., "qwen2.5:14b", "claude-3-5-sonnet-latest")
    "chunk_size": 40000,         // Opcional: Tamano de fragmentos de texto (por defecto: 80000)
    "overlap": 1000             // Opcional: Superposicion entre fragmentos (por defecto: 1000)
}
```

#### Respuesta
```json
{
    "process_id": "string",
    "message": "Processing started"
}
```

### 2. Subir Transcripcion
Subir y procesar un archivo de transcripcion. Este endpoint proporciona la misma funcionalidad que `/process-transcript` pero acepta la subida de un archivo en lugar de texto sin formato.

**Endpoint:** `/upload-transcript`
**Metodo:** POST
**Content-Type:** `multipart/form-data`

#### Parametros de la Solicitud
| Parametro | Tipo | Requerido | Descripcion |
|-----------|------|-----------|-------------|
| file | Archivo | Si | El archivo de transcripcion a subir |
| model | String | No | Proveedor de IA a usar (por defecto: "claude"). Opciones: "ollama", "claude", "groq" |
| model_name | String | No | Version especifica del modelo (por defecto: "claude-3-5-sonnet-latest") |
| chunk_size | Integer | No | Tamano de fragmentos de texto (por defecto: 5000) |
| overlap | Integer | No | Superposicion entre fragmentos (por defecto: 1000) |

#### Respuesta
```json
{
    "process_id": "string",
    "message": "Processing started"
}
```

### 3. Obtener Resumen
Obtener el resumen generado para un proceso especifico.

**Endpoint:** `/get-summary/{process_id}`
**Metodo:** GET

#### Parametros de Ruta
| Parametro | Tipo | Requerido | Descripcion |
|-----------|------|-----------|-------------|
| process_id | String | Si | ID del proceso a consultar |

#### Codigos de Respuesta
| Codigo | Descripcion |
|--------|-------------|
| 200 | Exito - Resumen completado |
| 202 | Aceptado - Procesamiento en progreso |
| 400 | Solicitud Invalida - Estado fallido o desconocido |
| 404 | No Encontrado - ID de proceso no encontrado |
| 500 | Error Interno del Servidor - Error del lado del servidor |

#### Cuerpo de la Respuesta
```json
{
    "status": "string",       // "completed", "processing", "error"
    "meetingName": "string",  // Nombre de la reunion (null si no esta disponible)
    "process_id": "string",   // ID del proceso
    "data": {                 // Datos del resumen (null si no esta completado)
        "MeetingName": "string",
        "SectionSummary": {
            "title": "string",
            "blocks": [
                {
                    "id": "string",
                    "type": "string",
                    "content": "string",
                    "color": "string"
                }
            ]
        },
        "CriticalDeadlines": {
            "title": "string",
            "blocks": []
        },
        "KeyItemsDecisions": {
            "title": "string",
            "blocks": []
        },
        "ImmediateActionItems": {
            "title": "string",
            "blocks": []
        },
        "NextSteps": {
            "title": "string",
            "blocks": []
        },
        "OtherImportantPoints": {
            "title": "string",
            "blocks": []
        },
        "ClosingRemarks": {
            "title": "string",
            "blocks": []
        }
    },
    "start": "string",      // Hora de inicio en formato ISO (null si no ha iniciado)
    "end": "string",        // Hora de fin en formato ISO (null si no ha completado)
    "error": "string"       // Mensaje de error si el estado es "error"
}
```

## Modelos de Datos

### Bloque (Block)
Representa un bloque individual de contenido en una seccion.

```json
{
    "id": "string",      // Identificador unico
    "type": "string",    // Tipo de bloque (texto, accion, decision, etc.)
    "content": "string", // Texto del contenido
    "color": "string"    // Color para visualizacion en la interfaz
}
```

### Seccion (Section)
Representa una seccion en el resumen de la reunion.

```json
{
    "title": "string",   // Titulo de la seccion
    "blocks": [          // Array de objetos Block
        {
            "id": "string",
            "type": "string",
            "content": "string",
            "color": "string"
        }
    ]
}
```

## Codigos de Estado

| Codigo | Descripcion |
|--------|-------------|
| 200 | Exito - Solicitud completada correctamente |
| 202 | Aceptado - Procesamiento en progreso |
| 400 | Solicitud Invalida - Solicitud o parametros invalidos |
| 404 | No Encontrado - ID de proceso no encontrado |
| 500 | Error Interno del Servidor - Error del lado del servidor |

## Manejo de Errores
Todas las respuestas de error siguen este formato:
```json
{
    "status": "error",
    "meetingName": null,
    "process_id": "string",
    "data": null,
    "start": null,
    "end": null,
    "error": "Mensaje de error describiendo lo que salio mal"
}
```

## Ejemplo de Uso

### 1. Subir y Procesar una Transcripcion
```bash
curl -X POST -F "file=@transcript.txt" http://localhost:5167/upload-transcript
```

### 2. Procesar con un Proveedor LLM Especifico
```bash
curl -X POST http://localhost:5167/process-transcript \
  -H "Content-Type: application/json" \
  -d '{"text": "Contenido de la transcripcion...", "model": "ollama", "model_name": "qwen2.5:14b"}'
```

### 3. Verificar Estado del Procesamiento
```bash
curl http://localhost:5167/get-summary/1a2e5c9c-a35f-452f-9f92-be66620fcb3f
```

## Notas
1. Las transcripciones grandes se dividen automaticamente en fragmentos para su procesamiento
2. Los tiempos de procesamiento pueden variar segun la longitud de la transcripcion y el proveedor LLM seleccionado
3. Todas las marcas de tiempo estan en formato ISO
4. Los colores en los bloques pueden usarse para estilizar la interfaz de usuario
5. La API soporta procesamiento concurrente de multiples transcripciones
6. Los proveedores LLM disponibles son: Ollama (local), Claude (Anthropic), Groq, OpenRouter
7. Para usar Ollama, asegurate de que el servicio Ollama este ejecutandose localmente con el modelo deseado descargado
