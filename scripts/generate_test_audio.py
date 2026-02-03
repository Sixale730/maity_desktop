#!/usr/bin/env python3
"""
Script para grabar audios de prueba para Moonshine.

Uso:
    python generate_test_audio.py

Instrucciones:
    1. El script mostrará el texto que debes leer
    2. Presiona Enter para comenzar a grabar
    3. Lee el texto en voz alta
    4. Presiona Enter para detener la grabación
    5. Repite para cada archivo de prueba
"""

import os
import sys
from pathlib import Path

try:
    import sounddevice as sd
    import soundfile as sf
    import numpy as np
except ImportError:
    print("Instalando dependencias necesarias...")
    os.system("pip install sounddevice soundfile numpy")
    import sounddevice as sd
    import soundfile as sf
    import numpy as np


SAMPLE_RATE = 16000  # Moonshine requiere 16kHz
CHANNELS = 1  # Mono

# Textos de prueba
TEST_CASES = [
    {
        "filename": "frase_corta.wav",
        "text": "Hola, ¿cómo estás?",
        "description": "Frase corta con signos de interrogación"
    },
    {
        "filename": "frase_numeros.wav",
        "text": "La reunión es a las tres de la tarde.",
        "description": "Frase con números"
    },
    {
        "filename": "parrafo_largo.wav",
        "text": "Buenos días a todos. Hoy vamos a discutir los avances del proyecto. "
               "El equipo ha trabajado muy bien esta semana y los resultados son prometedores.",
        "description": "Párrafo largo con vocabulario variado"
    },
    {
        "filename": "caracteres_especiales.wav",
        "text": "El niño español estudia matemáticas con pasión.",
        "description": "Frase con ñ y acentos"
    },
]


def record_audio():
    """Graba audio hasta que el usuario presione Enter."""
    print("🎤 Grabando... (presiona Enter para detener)")

    recording = []
    stream = sd.InputStream(samplerate=SAMPLE_RATE, channels=CHANNELS, dtype='float32')
    stream.start()

    try:
        while True:
            # Leer en chunks de 0.1 segundos
            chunk, _ = stream.read(int(SAMPLE_RATE * 0.1))
            recording.append(chunk.copy())

            # Verificar si hay input disponible (non-blocking)
            import select
            if sys.platform == 'win32':
                import msvcrt
                if msvcrt.kbhit():
                    msvcrt.getch()
                    break
            else:
                if select.select([sys.stdin], [], [], 0)[0]:
                    sys.stdin.readline()
                    break
    except KeyboardInterrupt:
        pass
    finally:
        stream.stop()
        stream.close()

    return np.concatenate(recording, axis=0)


def simple_record(duration_hint: float = 10.0):
    """Grabación simple: espera Enter para empezar, Enter para terminar."""
    print(f"\n🎤 Presiona Enter para COMENZAR a grabar...")
    input()

    print("⏺️  GRABANDO... (presiona Enter cuando termines de leer)")

    # Grabar con timeout largo
    frames = []
    recording = True

    def callback(indata, frames_count, time_info, status):
        if recording:
            frames.append(indata.copy())

    with sd.InputStream(samplerate=SAMPLE_RATE, channels=CHANNELS,
                        dtype='float32', callback=callback):
        input()  # Esperar Enter para terminar

    if frames:
        audio = np.concatenate(frames, axis=0)
        duration = len(audio) / SAMPLE_RATE
        print(f"✅ Grabado: {duration:.1f} segundos")
        return audio
    return None


def main():
    print("=" * 60)
    print("GRABADOR DE AUDIOS DE PRUEBA PARA MOONSHINE")
    print("=" * 60)

    # Crear directorio de salida
    output_dir = Path(__file__).parent / "test_audio"
    output_dir.mkdir(exist_ok=True)

    print(f"\nLos archivos se guardarán en: {output_dir}")
    print(f"Formato: WAV, {SAMPLE_RATE}Hz, mono")

    # Listar dispositivos de audio
    print("\n📢 Dispositivos de audio disponibles:")
    print(sd.query_devices())
    print(f"\nUsando dispositivo de entrada por defecto: {sd.query_devices(kind='input')['name']}")

    input("\nPresiona Enter para comenzar las grabaciones...")

    for i, case in enumerate(TEST_CASES, 1):
        print(f"\n{'='*60}")
        print(f"GRABACIÓN {i}/{len(TEST_CASES)}: {case['filename']}")
        print(f"{'='*60}")
        print(f"\nDescripción: {case['description']}")
        print(f"\n📝 TEXTO A LEER:")
        print(f"\n    \"{case['text']}\"\n")

        output_path = output_dir / case['filename']

        if output_path.exists():
            response = input(f"⚠️  {case['filename']} ya existe. ¿Sobrescribir? (s/n): ")
            if response.lower() != 's':
                print("Saltando...")
                continue

        audio = simple_record()

        if audio is not None and len(audio) > 0:
            sf.write(str(output_path), audio, SAMPLE_RATE)
            print(f"💾 Guardado: {output_path}")
        else:
            print("❌ No se grabó audio")

    print("\n" + "=" * 60)
    print("GRABACIONES COMPLETADAS")
    print("=" * 60)
    print(f"\nArchivos guardados en: {output_dir}")
    print("\nAhora puedes ejecutar: python test_moonshine_spanish.py")


if __name__ == "__main__":
    main()
