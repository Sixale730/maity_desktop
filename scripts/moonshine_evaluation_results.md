# Evaluación de Moonshine base-es para Español

## Fecha de evaluación
[PENDIENTE]

## Configuración de prueba

| Parámetro | Valor |
|-----------|-------|
| Modelo | moonshine/base-es |
| Sistema operativo | Windows 11 |
| CPU | [COMPLETAR] |
| GPU | [COMPLETAR] |
| RAM | [COMPLETAR] |
| Versión Python | 3.x |
| Versión Moonshine | [COMPLETAR] |

## Archivos de prueba

| Archivo | Duración | Descripción |
|---------|----------|-------------|
| frase_corta.wav | ~3s | "Hola, ¿cómo estás?" |
| frase_numeros.wav | ~5s | "La reunión es a las tres de la tarde." |
| parrafo_largo.wav | ~15s | Párrafo con vocabulario variado |
| caracteres_especiales.wav | ~5s | "El niño español estudia matemáticas con pasión." |

## Resultados

### 1. frase_corta.wav

**Texto esperado:**
> Hola, ¿cómo estás?

**Transcripción obtenida:**
> [COMPLETAR]

**Métricas:**
- Duración audio: [X]s
- Tiempo inferencia: [X]s
- Factor realtime: [X]x
- WER: [X]%

**Observaciones:**
- [ ] Signos ¿? correctos
- [ ] Acentos correctos (ó)
- [NOTAS]

---

### 2. frase_numeros.wav

**Texto esperado:**
> La reunión es a las tres de la tarde.

**Transcripción obtenida:**
> [COMPLETAR]

**Métricas:**
- Duración audio: [X]s
- Tiempo inferencia: [X]s
- Factor realtime: [X]x
- WER: [X]%

**Observaciones:**
- [ ] Número "tres" reconocido
- [ ] Puntuación correcta
- [NOTAS]

---

### 3. parrafo_largo.wav

**Texto esperado:**
> Buenos días a todos. Hoy vamos a discutir los avances del proyecto. El equipo ha trabajado muy bien esta semana y los resultados son prometedores.

**Transcripción obtenida:**
> [COMPLETAR]

**Métricas:**
- Duración audio: [X]s
- Tiempo inferencia: [X]s
- Factor realtime: [X]x
- WER: [X]%

**Observaciones:**
- [NOTAS]

---

### 4. caracteres_especiales.wav

**Texto esperado:**
> El niño español estudia matemáticas con pasión.

**Transcripción obtenida:**
> [COMPLETAR]

**Métricas:**
- Duración audio: [X]s
- Tiempo inferencia: [X]s
- Factor realtime: [X]x
- WER: [X]%

**Observaciones:**
- [ ] ñ reconocida correctamente
- [ ] Acentos: á, ó reconocidos
- [NOTAS]

---

## Resumen de métricas

| Métrica | Valor | Criterio | Estado |
|---------|-------|----------|--------|
| WER promedio | [X]% | < 20% | [✅/❌] |
| Factor realtime promedio | [X]x | < 0.5x | [✅/❌] |
| Acentos correctos | [X]/[Y] | 100% | [✅/❌] |
| Caracteres ñ correctos | [X]/[Y] | 100% | [✅/❌] |
| Puntuación | [X]% | > 80% | [✅/❌] |

## Errores comunes encontrados

1. [COMPLETAR]
2. [COMPLETAR]
3. [COMPLETAR]

## Comparación con Whisper (si aplica)

| Modelo | WER | Velocidad | Tamaño |
|--------|-----|-----------|--------|
| Moonshine base-es | [X]% | [X]x | ~400MB |
| Whisper small | [X]% | [X]x | ~500MB |
| Whisper base | [X]% | [X]x | ~150MB |

## Conclusión

### Recomendación: [✅ INTEGRAR / ❌ NO INTEGRAR / ⚠️ ESPERAR]

**Justificación:**
[COMPLETAR]

**Próximos pasos:**
- [ ] [COMPLETAR]
- [ ] [COMPLETAR]

---

*Evaluación realizada por: [NOMBRE]*
*Fecha: [FECHA]*
