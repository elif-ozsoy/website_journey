export interface ElementCoordinates {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AgentStep {
  step_number: number;
  url: string;
  title: string;
  action_type: string;
  action_details: Record<string, unknown>;
  reasoning: string;
  thought: string;
  next_goal: string;
  screenshot_base64: string;
  screenshot_url?: string;
  element_coordinates: ElementCoordinates | null;
  attention_coordinates?: { x: number; y: number } | null;
  timestamp: number;
}

export interface SolutionEval {
  result: 'correct' | 'partially_correct' | 'false_or_misleading';
  reason: string;
  expected_solution?: string;
  agent_answer?: string;
}

export interface AgentResult {
  steps: AgentStep[];
  total_steps: number;
  success: boolean;
  solution_eval?: SolutionEval;
}

export type WsMessage =
  | { type: "step"; data: AgentStep }
  | { type: "status"; message: string }
  | { type: "complete"; data: AgentResult }
  | { type: "error"; message: string; traceback?: string }
  | { type: "warning"; message: string };

export interface RunConfig {
  url: string;
  task: string;
  llm_provider: "nvidia" | "google" | "local";
  api_key: string;
  model?: string;
}