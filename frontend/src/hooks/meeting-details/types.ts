import { Transcript, Summary, SummaryDataResponse } from '@/types';

/**
 * Represents a meeting record as returned from the backend API.
 * Used across meeting-details page and hooks.
 */
export interface MeetingRecord {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  transcripts: Transcript[];
  folder_path?: string;
}

/**
 * Response from api_get_summary polling endpoint.
 */
export interface SummaryPollingResult {
  status: 'idle' | 'processing' | 'completed' | 'error' | 'failed' | 'cancelled';
  data?: SummaryDataResponse;
  error?: string;
  meetingName?: string;
}

/**
 * Response from api_process_transcript.
 */
export interface ProcessTranscriptResult {
  process_id: string;
}

/**
 * A block in a legacy summary section.
 */
export interface LegacySummaryBlock {
  id?: string;
  type?: string;
  content: string;
  color?: string;
}

/**
 * A section in a legacy summary format.
 */
export interface LegacySummarySection {
  title?: string;
  blocks?: LegacySummaryBlock[];
}

/**
 * Ollama model info returned from get_ollama_models command.
 */
export interface OllamaModelEntry {
  name: string;
  model?: string;
  size?: number;
  modified_at?: string;
}
