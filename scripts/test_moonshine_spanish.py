#!/usr/bin/env python3
"""
Script de prueba para evaluar Moonshine base-es en español.

Este script NO modifica el proyecto principal, solo evalúa el modelo
para determinar si vale la pena integrarlo.

Uso:
    1. Crear entorno virtual: python -m venv moonshine_test
    2. Activar: moonshine_test\Scripts\activate (Windows) o source moonshine_test/bin/activate (Unix)
    3. Instalar: pip install -r requirements_moonshine.txt
    4. Ejecutar: python test_moonshine_spanish.py
"""

import os
import sys
import time
from pathlib import Path
from dataclasses import dataclass
from typing import Optional

# Verificar dependencias antes de importar
try:
    import moonshine
    import numpy as np
    import soundfile as sf
except ImportError as e:
    print(f"Error: Falta dependencia - {e}")
    print("Instala con: pip install -r requirements_moonshine.txt")
    sys.exit(1)


@dataclass
class TranscriptionResult:
    """Resultado de una transcripción."""
    filename: str
    expected_text: Optional[str]
    transcribed_text: str
    duration_seconds: float
    inference_time_seconds: float
    realtime_factor: float  # inferencia / duración (< 1 = más rápido que realtime)


def get_audio_duration(filepath: str) -> float:
    """Obtiene la duración de un archivo de audio en segundos."""
    try:
        info = sf.info(filepath)
        return info.duration
    except Exception as e:
        print(f"Error al leer duración de {filepath}: {e}")
        return 0.0


def transcribe_file(model, filepath: str, expected_text: Optional[str] = None) -> TranscriptionResult:
    """Transcribe un archivo de audio y mide el tiempo."""
    duration = get_audio_duration(filepath)

    start_time = time.time()
    try:
        text = moonshine.transcribe(model, filepath)
        # moonshine.transcribe puede retornar lista o string según versión
        if isinstance(text, list):
            text = " ".join(text)
    except Exception as e:
        text = f"[ERROR: {e}]"
    inference_time = time.time() - start_time

    realtime_factor = inference_time / duration if duration > 0 else float('inf')

    return TranscriptionResult(
        filename=os.path.basename(filepath),
        expected_text=expected_text,
        transcribed_text=text,
        duration_seconds=duration,
        inference_time_seconds=inference_time,
        realtime_factor=realtime_factor
    )


def calculate_wer(reference: str, hypothesis: str) -> float:
    """
    Calcula Word Error Rate (WER) simple.
    WER = (S + D + I) / N donde:
    - S = sustituciones
    - D = eliminaciones
    - I = inserciones
    - N = palabras en referencia
    """
    ref_words = reference.lower().split()
    hyp_words = hypothesis.lower().split()

    if len(ref_words) == 0:
        return 0.0 if len(hyp_words) == 0 else 1.0

    # Algoritmo de distancia de Levenshtein a nivel de palabras
    d = [[0] * (len(hyp_words) + 1) for _ in range(len(ref_words) + 1)]

    for i in range(len(ref_words) + 1):
        d[i][0] = i
    for j in range(len(hyp_words) + 1):
        d[0][j] = j

    for i in range(1, len(ref_words) + 1):
        for j in range(1, len(hyp_words) + 1):
            if ref_words[i-1] == hyp_words[j-1]:
                d[i][j] = d[i-1][j-1]
            else:
                d[i][j] = min(
                    d[i-1][j] + 1,      # eliminación
                    d[i][j-1] + 1,      # inserción
                    d[i-1][j-1] + 1     # sustitución
                )

    return d[len(ref_words)][len(hyp_words)] / len(ref_words)


def check_spanish_characters(text: str) -> dict:
    """Verifica si el texto contiene caracteres españoles correctamente."""
    spanish_chars = {
        'á': text.count('á'),
        'é': text.count('é'),
        'í': text.count('í'),
        'ó': text.count('ó'),
        'ú': text.count('ú'),
        'ñ': text.count('ñ'),
        'ü': text.count('ü'),
        '¿': text.count('¿'),
        '¡': text.count('¡'),
    }
    return spanish_chars


def print_result(result: TranscriptionResult):
    """Imprime el resultado de una transcripción de forma formateada."""
    print(f"\n{'='*60}")
    print(f"Archivo: {result.filename}")
    print(f"Duración: {result.duration_seconds:.2f}s")
    print(f"Tiempo inferencia: {result.inference_time_seconds:.2f}s")
    print(f"Factor realtime: {result.realtime_factor:.2f}x")
    print(f"  (< 1.0 = más rápido que realtime, ideal < 0.5)")
    print(f"\nTranscripción:")
    print(f"  {result.transcribed_text}")

    if result.expected_text:
        print(f"\nTexto esperado:")
        print(f"  {result.expected_text}")
        wer = calculate_wer(result.expected_text, result.transcribed_text)
        print(f"\nWER: {wer*100:.1f}%")

        # Verificar caracteres españoles
        expected_chars = check_spanish_characters(result.expected_text)
        transcribed_chars = check_spanish_characters(result.transcribed_text)

        print(f"\nCaracteres españoles detectados:")
        for char, expected_count in expected_chars.items():
            if expected_count > 0:
                actual_count = transcribed_chars.get(char, 0)
                status = "✓" if actual_count >= expected_count else "✗"
                print(f"  {char}: esperado {expected_count}, encontrado {actual_count} {status}")


def create_sample_test_files():
    """
    Crea archivos de audio de prueba sintéticos si no existen.

    NOTA: Estos son archivos de silencio/ruido para verificar que el pipeline funciona.
    Para una evaluación real, necesitas grabar audio con voz en español.
    """
    test_audio_dir = Path(__file__).parent / "test_audio"
    test_audio_dir.mkdir(exist_ok=True)

    sample_rate = 16000

    # Crear archivo de silencio (3 segundos) - solo para verificar pipeline
    silence_file = test_audio_dir / "silence_test.wav"
    if not silence_file.exists():
        silence = np.zeros(sample_rate * 3, dtype=np.float32)
        sf.write(str(silence_file), silence, sample_rate)
        print(f"Creado: {silence_file}")

    # Crear archivo con tono (para verificar que procesa audio)
    tone_file = test_audio_dir / "tone_test.wav"
    if not tone_file.exists():
        t = np.linspace(0, 3, sample_rate * 3, dtype=np.float32)
        tone = 0.3 * np.sin(2 * np.pi * 440 * t)  # Tono de 440Hz
        sf.write(str(tone_file), tone, sample_rate)
        print(f"Creado: {tone_file}")

    return test_audio_dir


def main():
    print("=" * 60)
    print("PRUEBA DE MOONSHINE BASE-ES PARA ESPAÑOL")
    print("=" * 60)

    # Verificar/crear directorio de pruebas
    test_audio_dir = create_sample_test_files()

    # Cargar modelo
    print("\nCargando modelo moonshine/base-es...")
    try:
        start_load = time.time()
        model = moonshine.load_model("moonshine/base-es")
        load_time = time.time() - start_load
        print(f"Modelo cargado en {load_time:.2f}s")
    except Exception as e:
        print(f"ERROR al cargar modelo: {e}")
        print("\nPosibles causas:")
        print("  1. El modelo 'base-es' aún no está disponible públicamente")
        print("  2. Problema de conexión para descargar el modelo")
        print("  3. Versión de moonshine incompatible")
        print("\nIntentando con modelo 'base' (inglés) como fallback...")
        try:
            model = moonshine.load_model("moonshine/base")
            print("Modelo 'base' cargado (inglés). Los resultados en español serán subóptimos.")
        except Exception as e2:
            print(f"ERROR también con modelo base: {e2}")
            sys.exit(1)

    # Definir archivos de prueba con texto esperado
    # NOTA: Reemplaza estos con tus propios archivos de audio grabados
    test_cases = [
        # Archivos reales que el usuario debe grabar:
        {
            "file": test_audio_dir / "frase_corta.wav",
            "expected": "Hola, ¿cómo estás?",
            "description": "Frase corta con signos de interrogación"
        },
        {
            "file": test_audio_dir / "frase_numeros.wav",
            "expected": "La reunión es a las tres de la tarde.",
            "description": "Frase con números"
        },
        {
            "file": test_audio_dir / "parrafo_largo.wav",
            "expected": "Buenos días a todos. Hoy vamos a discutir los avances del proyecto. "
                       "El equipo ha trabajado muy bien esta semana y los resultados son prometedores.",
            "description": "Párrafo largo con vocabulario variado"
        },
        {
            "file": test_audio_dir / "caracteres_especiales.wav",
            "expected": "El niño español estudia matemáticas con pasión.",
            "description": "Frase con ñ y acentos"
        },
        # Archivos sintéticos (para verificar pipeline):
        {
            "file": test_audio_dir / "silence_test.wav",
            "expected": "",
            "description": "Silencio (verificación de pipeline)"
        },
    ]

    results = []

    print("\n" + "=" * 60)
    print("EJECUTANDO TRANSCRIPCIONES")
    print("=" * 60)

    for case in test_cases:
        filepath = case["file"]
        if not filepath.exists():
            print(f"\n⚠ Archivo no encontrado: {filepath}")
            print(f"  Descripción: {case['description']}")
            print(f"  Texto esperado: {case['expected']}")
            print(f"  → Graba este audio y guárdalo como: {filepath.name}")
            continue

        print(f"\nProcesando: {case['description']}...")
        result = transcribe_file(model, str(filepath), case.get("expected"))
        results.append(result)
        print_result(result)

    # Resumen final
    print("\n" + "=" * 60)
    print("RESUMEN DE RESULTADOS")
    print("=" * 60)

    if not results:
        print("\n⚠ No se procesaron archivos.")
        print("\nPara una evaluación real, necesitas:")
        print("  1. Grabar archivos WAV en español (16kHz, mono)")
        print("  2. Guardarlos en: scripts/test_audio/")
        print("  3. Nombrarlos según los test_cases definidos")
        return

    # Calcular promedios
    avg_realtime = sum(r.realtime_factor for r in results) / len(results)
    wers = []
    for r in results:
        if r.expected_text:
            wers.append(calculate_wer(r.expected_text, r.transcribed_text))

    print(f"\nArchivos procesados: {len(results)}")
    print(f"Factor realtime promedio: {avg_realtime:.2f}x")

    if wers:
        avg_wer = sum(wers) / len(wers)
        print(f"WER promedio: {avg_wer*100:.1f}%")

        # Recomendación
        print("\n" + "-" * 60)
        print("RECOMENDACIÓN:")
        if avg_wer < 0.20 and avg_realtime < 0.5:
            print("✅ INTEGRAR - Buena calidad y velocidad")
        elif avg_wer < 0.30 and avg_realtime < 1.0:
            print("⚠️ EVALUAR - Resultados aceptables pero no óptimos")
        else:
            print("❌ NO INTEGRAR - Calidad o velocidad insuficiente")
        print("-" * 60)

    print("\n📝 Guarda estos resultados en: scripts/moonshine_evaluation_results.md")


if __name__ == "__main__":
    main()
