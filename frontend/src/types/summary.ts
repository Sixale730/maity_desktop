export interface ProcessedSummary {
    key_points: string[];
    action_items: string[];
    decisions: string[];
    main_topics: string[];
    participants?: string[];
}

export interface ProcessSummaryResponse {
    summary: ProcessedSummary;
    raw_summary?: string;
}

export interface ProcessRequest {
    transcript: string;
    custom_prompt?: string;
    metadata?: {
        meeting_title?: string;
        date?: string;
        duration?: number;
    };
}
