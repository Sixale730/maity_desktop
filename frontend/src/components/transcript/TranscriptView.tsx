'use client';

import { Transcript } from '@/types';
import { useEffect, useRef, useState, memo } from 'react';
import { ConfidenceIndicator } from '@/components/transcript/ConfidenceIndicator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { RecordingStatusBar } from '@/components/recording/RecordingStatusBar';
import { motion, AnimatePresence } from 'framer-motion';

// Speaker indicator component to show who is speaking
const SpeakerIndicator = memo(function SpeakerIndicator({
  sourceType,
}: {
  sourceType?: 'user' | 'interlocutor';
}) {
  if (!sourceType) return null;
  if (sourceType === 'user') {
    return <span className="text-xs flex-shrink-0" title="Tú (micrófono)">🎤</span>;
  }
  return <span className="text-xs flex-shrink-0" title="Otro (speaker)">🔊</span>;
});

// Helper function to get background class based on source type (MAITY palette)
function getBackgroundClass(sourceType?: 'user' | 'interlocutor'): string {
  if (sourceType === 'user') {
    return 'bg-[#f0f2fe] dark:bg-blue-900/30 border-[#c0cbfb] dark:border-blue-700';  // Azul MAITY for microphone (user)
  } else if (sourceType === 'interlocutor') {
    return 'bg-[#e8fef5] dark:bg-green-900/30 border-[#8ef9d4] dark:border-green-700';  // Verde MAITY for system audio (other)
  }
  return 'bg-[#e7e7e9] dark:bg-gray-700 border-[#d0d0d3] dark:border-gray-600';  // Gris MAITY for unknown
}

interface TranscriptViewProps {
  transcripts: Transcript[];
  isRecording?: boolean;
  isPaused?: boolean; // Is recording paused (affects UI indicators)
  isProcessing?: boolean; // Is processing/finalizing transcription (hides "Listening..." indicator)
  isStopping?: boolean; // Is recording being stopped (provides immediate UI feedback)
  enableStreaming?: boolean; // Enable streaming effect for live transcription UX
}

interface SpeechDetectedEvent {
  message: string;
}

// Helper function to format seconds as recording-relative time [MM:SS]
function formatRecordingTime(seconds: number | undefined): string {
  if (seconds === undefined) return '[--:--]';

  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;

  return `[${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}]`;
}

// Helper function to remove consecutive word repetitions (especially short words ≤2 letters)
function cleanRepetitions(text: string): string {
  if (!text || text.trim().length === 0) return text;

  const words = text.split(/\s+/);
  const cleanedWords: string[] = [];

  let i = 0;
  while (i < words.length) {
    const currentWord = words[i];
    const currentWordLower = currentWord.toLowerCase();

    // Count consecutive repetitions of the same word
    let repeatCount = 1;
    while (
      i + repeatCount < words.length &&
      words[i + repeatCount].toLowerCase() === currentWordLower
    ) {
      repeatCount++;
    }

    // For short words (≤2 letters), be aggressive: if repeated 2+ times, keep only 1
    // For longer words, keep 1 if repeated 3+ times (less aggressive)
    if (currentWord.length <= 2) {
      // Short words: "I I I I" → "I", "Tu Tu Tu" → "Tu"
      if (repeatCount >= 2) {
        cleanedWords.push(currentWord);
        i += repeatCount;
      } else {
        cleanedWords.push(currentWord);
        i += 1;
      }
    } else {
      // Longer words: keep original unless heavily repeated
      if (repeatCount >= 3) {
        cleanedWords.push(currentWord);
        i += repeatCount;
      } else {
        cleanedWords.push(currentWord);
        i += 1;
      }
    }
  }

  return cleanedWords.join(' ');
}

// Helper function to remove filler words and stop words from transcripts
function cleanStopWords(text: string): string {
  // FIRST: Clean repetitions (especially short words)
  let cleanedText = cleanRepetitions(text);

  // THEN: Remove filler words
  const stopWords = [
    'uh', 'um', 'er', 'ah', 'hmm', 'hm', 'eh', 'oh',
    // 'like', 'you know', 'i mean', 'sort of', 'kind of',
    // 'basically', 'actually', 'literally', 'right',
    // 'thank you', 'thanks'
  ];

  // Remove each stop word (case-insensitive, with word boundaries)
  stopWords.forEach(word => {
    // Match the stop word at word boundaries, with optional punctuation
    const pattern = new RegExp(`\\b${word}\\b[,\\s]*`, 'gi');
    cleanedText = cleanedText.replace(pattern, ' ');
  });

  // Clean up extra whitespace and trim
  cleanedText = cleanedText.replace(/\s+/g, ' ').trim();

  return cleanedText;
}

export const TranscriptView: React.FC<TranscriptViewProps> = ({ transcripts, isRecording = false, isPaused = false, isProcessing = false, isStopping = false, enableStreaming = false }) => {
  const [speechDetected, setSpeechDetected] = useState(false);

  // Debug: Log the props to understand what's happening
  console.log('TranscriptView render:', {
    isRecording,
    isPaused,
    isProcessing,
    isStopping,
    transcriptCount: transcripts.length,
    shouldShowListening: !isStopping && isRecording && !isPaused && !isProcessing && transcripts.length > 0
  });

  // Streaming effect state
  const [streamingTranscript, setStreamingTranscript] = useState<{
    id: string;
    visibleText: string;
    fullText: string;
  } | null>(null);
  const streamingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastStreamedIdRef = useRef<string | null>(null); // Track which transcript we've streamed

  // Load preference for showing confidence indicator
  const [showConfidence, setShowConfidence] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('showConfidenceIndicator');
      return saved !== null ? saved === 'true' : true; // Default to true
    }
    return true;
  });

  // Listen for preference changes from settings
  useEffect(() => {
    const handleConfidenceChange = (e: Event) => {
      const customEvent = e as CustomEvent<boolean>;
      setShowConfidence(customEvent.detail);
    };

    window.addEventListener('confidenceIndicatorChanged', handleConfidenceChange);
    return () => window.removeEventListener('confidenceIndicatorChanged', handleConfidenceChange);
  }, []);

  // Listen for speech-detected event
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    const setupListener = async () => {
      const { listen } = await import('@tauri-apps/api/event');
      unsubscribe = await listen<SpeechDetectedEvent>('speech-detected', () => {
        setSpeechDetected(true);
      });
    };

    if (isRecording) {
      setupListener();
    } else {
      // Reset when not recording
      setSpeechDetected(false);
    }

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [isRecording]);

  // Streaming effect: animate new transcripts character-by-character
  useEffect(() => {
    if (!enableStreaming || !isRecording) {
      // Clean up if streaming is disabled
      if (streamingIntervalRef.current) {
        clearInterval(streamingIntervalRef.current);
        streamingIntervalRef.current = null;
      }
      setStreamingTranscript(null);
      lastStreamedIdRef.current = null;
      return;
    }

    // Find the latest non-partial transcript
    const latestTranscript = transcripts
      .slice(-1)[0];

    if (!latestTranscript) return;

    // Check if this is a new transcript we haven't streamed yet (using ref to avoid dependency issues)
    if (lastStreamedIdRef.current !== latestTranscript.id) {
      // Clear any existing streaming interval
      if (streamingIntervalRef.current) {
        clearInterval(streamingIntervalRef.current);
        streamingIntervalRef.current = null;
      }

      // Mark this transcript as being streamed
      lastStreamedIdRef.current = latestTranscript.id;

      const fullText = latestTranscript.text;

      // Fast typewriter effect - complete in 0.8 seconds for snappy feel
      const TOTAL_DURATION_MS = 800; // 0.8 seconds total - fast and snappy!
      const INTERVAL_MS = 15; // Update every 15ms for smooth animation
      const totalTicks = TOTAL_DURATION_MS / INTERVAL_MS; // ~53 ticks
      const charsPerTick = Math.max(2, Math.ceil(fullText.length / totalTicks)); // At least 2 chars per tick for speed
      const INITIAL_CHARS = Math.min(5, fullText.length); // Start with first 5 chars visible
      let charIndex = INITIAL_CHARS;

      setStreamingTranscript({
        id: latestTranscript.id,
        visibleText: fullText.substring(0, INITIAL_CHARS),
        fullText: fullText
      });

      streamingIntervalRef.current = setInterval(() => {
        charIndex += charsPerTick;

        if (charIndex >= fullText.length) {
          // Streaming complete
          clearInterval(streamingIntervalRef.current!);
          streamingIntervalRef.current = null;
          setStreamingTranscript(null);
        } else {
          setStreamingTranscript(prev => {
            if (!prev) return null;
            return {
              ...prev,
              visibleText: fullText.substring(0, charIndex)
            };
          });
        }
      }, INTERVAL_MS);
    }
  }, [transcripts, enableStreaming, isRecording]);

  // Cleanup streaming interval on unmount
  useEffect(() => {
    return () => {
      if (streamingIntervalRef.current) {
        clearInterval(streamingIntervalRef.current);
        streamingIntervalRef.current = null;
      }
      lastStreamedIdRef.current = null;
    };
  }, []);

  return (
    <div className="px-4 py-2">
      {/* Recording Status Bar - Sticky at top, always visible when recording */}
      <AnimatePresence>
        {isRecording && (
          <div className="sticky top-4 z-10 bg-white dark:bg-gray-900 pb-2">
            <RecordingStatusBar isPaused={isPaused} />
          </div>
        )}
      </AnimatePresence>

      {transcripts?.map((transcript, index) => {
        const isStreaming = streamingTranscript?.id === transcript.id;
        const textToShow = isStreaming ? streamingTranscript.visibleText : transcript.text;
        // Clean up text for display - remove repetitions and filler words
        const filteredText = cleanStopWords(textToShow);
        // Show [Silence] ONLY if the ORIGINAL transcript was empty (not just after filtering)
        const originalWasEmpty = transcript.text.trim() === '';
        const displayText = originalWasEmpty && !isStreaming ? '[Silence]' : filteredText;

        // Sizer text: use cleaned version for proper sizing, fallback to [Silence] only if original was empty
        const sizerText = cleanStopWords(isStreaming ? streamingTranscript.fullText : transcript.text)
          || (originalWasEmpty && !isStreaming ? '[Silence]' : '');

        return (
          <motion.div
            key={transcript.id ? `${transcript.id}-${index}` : `transcript-${index}`}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.15 }}
            className="mb-3"
          >
            <div className="flex items-start gap-2">
              <Tooltip>
                <TooltipTrigger>
                  <span className="text-xs text-[#8a8a8d] dark:text-gray-500 mt-1 flex-shrink-0 min-w-[50px]">
                    {transcript.audio_start_time !== undefined
                      ? formatRecordingTime(transcript.audio_start_time)
                      : transcript.timestamp}
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {transcript.duration !== undefined && (
                    <span className="text-xs text-[#8a8a8d] dark:text-gray-500">
                      {transcript.duration.toFixed(1)}s
                      {transcript.confidence !== undefined && (
                        <ConfidenceIndicator
                          confidence={transcript.confidence}
                          showIndicator={showConfidence}
                        />
                      )}
                    </span>
                  )}
                </TooltipContent>
              </Tooltip>
              <SpeakerIndicator sourceType={transcript.source_type} />
              <div className="flex-1">
                {isStreaming ? (
                  // Streaming transcript - show in bubble with dynamic background
                  <div className={`border rounded-lg px-3 py-2 ${getBackgroundClass(transcript.source_type)}`}>
                    <div className="relative">
                      <p className="text-base text-[#1a1a1a] dark:text-gray-100 leading-relaxed" style={{ visibility: 'hidden' }}>
                        {sizerText}
                      </p>
                      <p className="text-base text-[#1a1a1a] dark:text-gray-100 leading-relaxed absolute top-0 left-0">
                        {displayText}
                      </p>
                    </div>
                  </div>
                ) : (
                  // Regular transcript - with dynamic background based on speaker
                  <div className={`border rounded-lg px-3 py-2 ${getBackgroundClass(transcript.source_type)}`}>
                    <div className="relative">
                      <p className="text-base text-[#1a1a1a] dark:text-gray-100 leading-relaxed" style={{ visibility: 'hidden' }}>
                        {sizerText}
                      </p>
                      <p className="text-base text-[#1a1a1a] dark:text-gray-100 leading-relaxed absolute top-0 left-0">
                        {displayText}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        );
      })}

      {/* Show listening indicator when recording and has transcripts */}
      {!isStopping && isRecording && !isPaused && !isProcessing && transcripts.length > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="flex items-center gap-2 mt-4 text-[#6a6a6d] dark:text-gray-400"
        >
          <div className="w-2 h-2 bg-[#485df4] rounded-full animate-pulse"></div>
          <span className="text-sm">Escuchando...</span>
        </motion.div>
      )}

      {/* Empty state when no transcripts */}
      {transcripts.length === 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center text-[#6a6a6d] dark:text-gray-400 mt-8"
        >
          {isRecording ? (
            <>
              <div className="flex items-center justify-center mb-3">
                <div className={`w-3 h-3 rounded-full ${isPaused ? 'bg-[#ff4080]' : 'bg-[#485df4] animate-pulse'}`}></div>
              </div>
              <p className="text-sm text-[#4a4a4c] dark:text-gray-300">
                {isPaused ? 'Grabación pausada' : 'Escuchando...'}
              </p>
              <p className="text-xs mt-1 text-[#8a8a8d] dark:text-gray-500">
                {isPaused
                  ? 'Haz clic en reanudar para continuar'
                  : 'Habla para ver la transcripción en vivo'}
              </p>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="mb-6 relative">
                <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-[#ff0050]/10 to-[#485df4]/10 dark:from-[#ff0050]/20 dark:to-[#485df4]/20 flex items-center justify-center">
                  <img src="icon_128x128.png" alt="Maity" className="w-14 h-14" />
                </div>
                <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-[#485df4] rounded-full flex items-center justify-center">
                  <div className="w-2 h-2 bg-white rounded-full" />
                </div>
              </div>
              <h2 className="text-3xl font-bold text-[#1a1a1a] dark:text-white mb-2">¡Bienvenido a Maity!</h2>
              <p className="text-base text-[#6a6a6d] dark:text-gray-400 mb-1">Tu coach de comunicación</p>
              <p className="text-sm text-[#8a8a8d] dark:text-gray-500 mt-3 max-w-[280px] text-center leading-relaxed">
                Inicia una grabación para ver la transcripción en vivo
              </p>
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
};
