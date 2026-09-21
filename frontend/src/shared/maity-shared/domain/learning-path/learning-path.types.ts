// Origen: web Sixale730/maity@3ef2914 packages/shared/src/domain/learning-path/learning-path.types.ts
// Copia tal cual (solo tipos). El servicio/hook reales NO se portan: ver ./useLearningPath.ts.
/**
 * Learning Path Types
 * Duolingo-style roadmap with resources + scenarios
 */

// Node types enum
export type NodeType = 'resource' | 'scenario' | 'quiz' | 'video' | 'checkpoint';

// Node status enum
export type NodeStatus = 'locked' | 'available' | 'in_progress' | 'completed' | 'skipped';

// Visual position for serpentine layout
export type VisualPosition = 'left' | 'center' | 'right';

/**
 * Individual node in the learning path
 */
export interface LearningPathNode {
  nodeId: string;
  orderIndex: number;
  visualPosition: VisualPosition;
  nodeType: NodeType;
  title: string;
  description: string | null;
  icon: string;
  color: string;
  estimatedDuration: number | null;
  status: NodeStatus;
  score: number | null;
  attempts: number;
  completedAt: string | null;
  // Resource-specific
  resourceId: string | null;
  resourceUrl: string | null;
  resourceTitle: string | null;
  // Scenario-specific
  scenarioId: string | null;
  scenarioCode: string | null;
  scenarioName: string | null;
}

/**
 * User's complete learning path
 */
export interface UserLearningPath {
  nodes: LearningPathNode[];
  totalNodes: number;
  completedNodes: number;
  inProgressNodes: number;
  progressPercentage: number;
}

/**
 * Learning path summary (lightweight)
 */
export interface LearningPathSummary {
  hasPath: boolean;
  totalNodes: number;
  completedNodes: number;
  inProgressNodes: number;
  progressPercentage: number;
}

/**
 * Node completion request
 */
export interface CompleteNodeRequest {
  nodeId: string;
  score?: number;
  sessionId?: string;
}

/**
 * Node completion response
 */
export interface CompleteNodeResponse {
  success: boolean;
  completedNodeId: string;
  unlockedNodeId: string | null;
  pathCompleted: boolean;
}

/**
 * Team member progress (for managers)
 */
export interface TeamMemberProgress {
  userId: string;
  userName: string;
  userEmail: string;
  totalNodes: number;
  completedNodes: number;
  progressPercentage: number;
  currentNodeTitle: string | null;
  lastActivity: string | null;
}

/**
 * Raw database row from get_user_learning_path RPC
 */
export interface LearningPathNodeRow {
  node_id: string;
  order_index: number;
  visual_position: string;
  node_type: string;
  title: string;
  description: string | null;
  icon: string;
  color: string;
  estimated_duration: number | null;
  status: string;
  score: number | null;
  attempts: number;
  completed_at: string | null;
  resource_id: string | null;
  resource_url: string | null;
  resource_title: string | null;
  scenario_id: string | null;
  scenario_code: string | null;
  scenario_name: string | null;
}

/**
 * Raw database row from get_team_learning_progress RPC
 */
export interface TeamProgressRow {
  user_id: string;
  user_name: string;
  user_email: string;
  total_nodes: number;
  completed_nodes: number;
  progress_percentage: number;
  current_node_title: string | null;
  last_activity: string | null;
}

/**
 * Raw summary from get_learning_path_summary RPC
 */
export interface LearningPathSummaryRow {
  has_path: boolean;
  total_nodes: number;
  completed_nodes: number;
  in_progress_nodes: number;
  progress_percentage: number;
}
