'use client';

import React from 'react';
import { X, Info, Shield } from 'lucide-react';

interface AnalyticsDataModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirmDisable: () => void;
}

export default function AnalyticsDataModal({ isOpen, onClose, onConfirmDisable }: AnalyticsDataModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-[#e7e7e9] dark:border-gray-700">
          <div className="flex items-center gap-3">
            <Shield className="w-6 h-6 text-[#3a4ac3] dark:text-blue-400" />
            <h2 className="text-xl font-semibold text-[#000000] dark:text-white">Qué Recopilamos</h2>
          </div>
          <button
            onClick={onClose}
            className="text-[#8a8a8d] dark:text-gray-500 hover:text-[#4a4a4c] dark:hover:text-gray-300 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Privacy Notice */}
          <div className="bg-[#e8fef5] border border-[#8ef9d4] rounded-lg p-4">
            <div className="flex items-start gap-3">
              <Info className="w-5 h-5 text-[#16bb7b] mt-0.5 flex-shrink-0" />
              <div className="text-sm text-[#0d6b4a]">
                <p className="font-semibold mb-1">Tu Privacidad está Protegida</p>
                <p>Recopilamos <strong>solo datos de uso anónimos</strong>. Nunca se recopila contenido de reuniones, nombres o información personal.</p>
              </div>
            </div>
          </div>

          {/* Data Categories */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-[#000000] dark:text-white">Datos que Recopilamos:</h3>

            {/* Model Preferences */}
            <div className="border border-[#e7e7e9] dark:border-gray-700 rounded-lg p-4">
              <h4 className="font-semibold text-[#000000] dark:text-white mb-2">1. Preferencias de Modelo</h4>
              <ul className="text-sm text-[#3a3a3c] dark:text-gray-200 space-y-1 ml-4">
                <li>• Modelo de transcripción (ej., "Whisper large-v3", "Parakeet")</li>
                <li>• Modelo de resumen (ej., "Llama 3.2", "Claude Sonnet")</li>
                <li>• Proveedor de modelo (ej., "Local", "Ollama", "OpenRouter")</li>
              </ul>
              <p className="text-xs text-[#6a6a6d] dark:text-gray-400 mt-2 italic">Nos ayuda a entender qué modelos prefieren los usuarios</p>
            </div>

            {/* Meeting Metrics */}
            <div className="border border-[#e7e7e9] dark:border-gray-700 rounded-lg p-4">
              <h4 className="font-semibold text-[#000000] dark:text-white mb-2">2. Métricas de Reunión Anónimas</h4>
              <ul className="text-sm text-[#3a3a3c] dark:text-gray-200 space-y-1 ml-4">
                <li>• Duración de grabación (ej., "125 segundos")</li>
                <li>• Duración de pausa (ej., "5 segundos")</li>
                <li>• Número de segmentos de transcripción</li>
                <li>• Número de fragmentos de audio procesados</li>
              </ul>
              <p className="text-xs text-[#6a6a6d] dark:text-gray-400 mt-2 italic">Nos ayuda a optimizar rendimiento y entender patrones de uso</p>
            </div>

            {/* Device Types */}
            <div className="border border-[#e7e7e9] dark:border-gray-700 rounded-lg p-4">
              <h4 className="font-semibold text-[#000000] dark:text-white mb-2">3. Tipos de Dispositivo (No Nombres)</h4>
              <ul className="text-sm text-[#3a3a3c] dark:text-gray-200 space-y-1 ml-4">
                <li>• Tipo de micrófono: "Bluetooth" o "Con cable" o "Desconocido"</li>
                <li>• Tipo de audio del sistema: "Bluetooth" o "Con cable" o "Desconocido"</li>
              </ul>
              <p className="text-xs text-[#6a6a6d] dark:text-gray-400 mt-2 italic">Nos ayuda a mejorar compatibilidad, NO los nombres reales de dispositivos</p>
            </div>

            {/* Usage Patterns */}
            <div className="border border-[#e7e7e9] dark:border-gray-700 rounded-lg p-4">
              <h4 className="font-semibold text-[#000000] dark:text-white mb-2">4. Patrones de Uso de la App</h4>
              <ul className="text-sm text-[#3a3a3c] dark:text-gray-200 space-y-1 ml-4">
                <li>• Eventos de inicio/cierre de app</li>
                <li>• Duración de sesión</li>
                <li>• Uso de funciones (ej., "configuración cambiada")</li>
                <li>• Ocurrencia de errores (nos ayuda a corregir bugs)</li>
              </ul>
              <p className="text-xs text-[#6a6a6d] dark:text-gray-400 mt-2 italic">Nos ayuda a mejorar la experiencia del usuario</p>
            </div>

            {/* Platform Info */}
            <div className="border border-[#e7e7e9] dark:border-gray-700 rounded-lg p-4">
              <h4 className="font-semibold text-[#000000] dark:text-white mb-2">5. Información de Plataforma</h4>
              <ul className="text-sm text-[#3a3a3c] dark:text-gray-200 space-y-1 ml-4">
                <li>• Sistema operativo (ej., "macOS", "Windows")</li>
                <li>• Versión de la app (incluida automáticamente en todos los eventos)</li>
                <li>• Arquitectura (ej., "x86_64", "aarch64")</li>
              </ul>
              <p className="text-xs text-[#6a6a6d] dark:text-gray-400 mt-2 italic">Nos ayuda a priorizar soporte de plataformas</p>
            </div>
          </div>

          {/* What We DON'T Collect */}
          <div className="bg-[#fff0f5] border border-[#ffc0d6] rounded-lg p-4">
            <h4 className="font-semibold text-red-900 mb-2">Lo que NO Recopilamos:</h4>
            <ul className="text-sm text-red-800 space-y-1 ml-4">
              <li>• ❌ Nombres o títulos de reuniones</li>
              <li>• ❌ Transcripciones o contenido de reuniones</li>
              <li>• ❌ Grabaciones de audio</li>
              <li>• ❌ Nombres de dispositivos (solo tipos: Bluetooth/Con cable)</li>
              <li>• ❌ Información personal</li>
              <li>• ❌ Cualquier dato identificable</li>
            </ul>
          </div>

          {/* Example Event */}
          <div className="bg-[#f5f5f6] dark:bg-gray-800 border border-[#e7e7e9] dark:border-gray-700 rounded-lg p-4">
            <h4 className="font-semibold text-[#000000] dark:text-white mb-2">Ejemplo de Evento:</h4>
            <pre className="text-xs text-[#3a3a3c] dark:text-gray-200 overflow-x-auto">
              {`{
  "event": "meeting_ended",
  "app_version": "0.2.0",
  "transcription_provider": "parakeet",
  "transcription_model": "parakeet-tdt-0.6b-v3-int8",
  "summary_provider": "ollama",
  "summary_model": "llama3.2:latest",
  "total_duration_seconds": "125.5",
  "microphone_device_type": "Wired",
  "system_audio_device_type": "Bluetooth",
  "chunks_processed": "150",
  "had_fatal_error": "false"
}`}
            </pre>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-4 p-6 border-t border-[#e7e7e9] dark:border-gray-700 bg-[#f5f5f6] dark:bg-gray-800">
          <button
            onClick={onClose}
            className="px-4 py-2 text-[#3a3a3c] dark:text-gray-200 bg-white dark:bg-gray-800 border border-[#d0d0d3] dark:border-gray-600 rounded-md hover:bg-[#f5f5f6] dark:hover:bg-gray-700 transition-colors"
          >
            Mantener Analíticas Habilitadas
          </button>
          <button
            onClick={onConfirmDisable}
            className="px-4 py-2 text-white bg-[#cc0040] rounded-md hover:bg-[#990030] transition-colors"
          >
            Confirmar: Deshabilitar Analíticas
          </button>
        </div>
      </div>
    </div>
  );
}
