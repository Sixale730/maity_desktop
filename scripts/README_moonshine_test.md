# Prueba de Moonshine base-es para Español

Este directorio contiene scripts para evaluar el modelo Moonshine `base-es` antes de decidir si integrarlo al proyecto Maity.

## Estructura de archivos

```
scripts/
├── test_moonshine_spanish.py      # Script principal de prueba
├── generate_test_audio.py         # Grabador de audios de prueba
├── requirements_moonshine.txt     # Dependencias Python
├── moonshine_evaluation_results.md # Plantilla para documentar resultados
├── README_moonshine_test.md       # Este archivo
└── test_audio/                    # Carpeta para audios de prueba
    ├── frase_corta.wav           # "Hola, ¿cómo estás?"
    ├── frase_numeros.wav         # "La reunión es a las tres..."
    ├── parrafo_largo.wav         # Párrafo largo
    └── caracteres_especiales.wav # "El niño español..."
```

## Instrucciones de uso

### 1. Crear entorno virtual

```bash
cd scripts
python -m venv moonshine_test

# Windows
moonshine_test\Scripts\activate

# Linux/Mac
source moonshine_test/bin/activate
```

### 2. Instalar dependencias

```bash
pip install -r requirements_moonshine.txt

# Para grabar audios, también necesitas:
pip install sounddevice
```

### 3. Grabar audios de prueba

```bash
python generate_test_audio.py
```

Sigue las instrucciones en pantalla para grabar cada frase.

### 4. Ejecutar prueba de transcripción

```bash
python test_moonshine_spanish.py
```

### 5. Documentar resultados

Completa el archivo `moonshine_evaluation_results.md` con los resultados obtenidos.

## Criterios de éxito

| Métrica | Criterio | Descripción |
|---------|----------|-------------|
| **WER** | < 20% | Word Error Rate aceptable para español |
| **Latencia** | < 0.5x realtime | Más rápido que tiempo real |
| **Acentos** | 100% | Debe reconocer á, é, í, ó, ú correctamente |
| **Ñ** | 100% | Debe reconocer la ñ correctamente |

## Notas importantes

1. **El modelo `base-es` puede no estar disponible aún**: Si falla al cargar, el script intentará con el modelo `base` (inglés) como fallback, pero los resultados en español serán subóptimos.

2. **Formato de audio requerido**: WAV, 16kHz, mono. Los scripts manejan esto automáticamente.

3. **Esta prueba NO modifica el proyecto principal**: Es solo para evaluación antes de decidir la integración.

## Próximos pasos después de la evaluación

- **Si los resultados son buenos (✅)**: Crear plan de integración completa en el motor de transcripción de Maity.

- **Si los resultados son malos (❌)**: Evaluar alternativas como Faster-Whisper o Vosk para español.

- **Si los resultados son mixtos (⚠️)**: Esperar a que Moonshine publique benchmarks oficiales para español.
