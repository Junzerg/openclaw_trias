export interface TaskStatusPayload {
  task_id: string;
  status: 'Pending' | 'Debating' | 'Voting' | 'Executing' | 'Reviewing' | 'Completed' | 'Failed';
  current_step?: number;
  total_steps?: number;
  message?: string;
  [key: string]: any;
}

export interface WSEventPayload {
  action: string;
  data?: any;
  intensity?: number;
  timestamp?: number;
  [key: string]: unknown;
}
