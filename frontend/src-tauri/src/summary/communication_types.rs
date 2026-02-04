use serde::{Deserialize, Serialize};

/// Detailed observations for each communication category
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CommunicationObservations {
    /// Observation about clarity of communication
    pub clarity: Option<String>,
    /// Observation about structure of the discourse
    pub structure: Option<String>,
    /// How objections were handled
    pub objections: Option<String>,
    /// Analysis of calls to action
    pub calls_to_action: Option<String>,
}

/// Communication feedback with scores and detailed analysis
/// Matches the frontend CommunicationFeedback interface
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CommunicationFeedback {
    /// Overall communication score (0-10)
    pub overall_score: Option<f32>,
    /// Clarity score (0-10) - how clear and understandable the message is
    pub clarity: Option<f32>,
    /// Engagement score (0-10) - how participative and involved the speaker is
    pub engagement: Option<f32>,
    /// Structure score (0-10) - how organized the discourse is
    pub structure: Option<f32>,
    /// General feedback text
    pub feedback: Option<String>,
    /// Summary of the communication analysis (alternative to feedback)
    pub summary: Option<String>,
    /// List of communication strengths
    pub strengths: Option<Vec<String>>,
    /// List of areas that need improvement
    pub areas_to_improve: Option<Vec<String>>,
    /// Detailed observations by category
    pub observations: Option<CommunicationObservations>,
}
