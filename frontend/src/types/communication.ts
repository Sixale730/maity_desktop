/**
 * Communication feedback types for meeting analysis
 * Matches the Rust CommunicationFeedback struct
 */

export interface CommunicationObservations {
  /** Observation about clarity of communication */
  clarity?: string;
  /** Observation about structure of the discourse */
  structure?: string;
  /** How objections were handled */
  objections?: string;
  /** Analysis of calls to action */
  calls_to_action?: string;
}

export interface CommunicationFeedback {
  /** Overall communication score (0-10) */
  overall_score?: number;
  /** Clarity score (0-10) - how clear and understandable the message is */
  clarity?: number;
  /** Engagement score (0-10) - how participative and involved the speaker is */
  engagement?: number;
  /** Structure score (0-10) - how organized the discourse is */
  structure?: number;
  /** General feedback text */
  feedback?: string;
  /** Summary of the communication analysis (alternative to feedback) */
  summary?: string;
  /** List of communication strengths */
  strengths?: string[];
  /** List of areas that need improvement */
  areas_to_improve?: string[];
  /** Detailed observations by category */
  observations?: CommunicationObservations;
}
