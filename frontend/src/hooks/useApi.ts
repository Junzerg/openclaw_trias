import { useCallback } from 'react';

export interface TaskListResponse {
  tasks: Array<{
    task_id: string;
    petition: string;
    status: string;
    bill_state: string;
    created_at: string;
  }>;
  total: number;
}

export interface TaskStatusResponse {
  task_id: string;
  status: string;
  bill_state: string;
}

import type { DebateRound } from '../contexts/AppContext';

export interface DebateResponse {
  rounds: DebateRound[];
  conflict_score_curve?: number[];
}

export interface ActResponse {
  content: string;
}

export interface VerdictResponse {
  ruling: string;
}

export function useApi() {
  const baseUrl = '/api'; // Vite proxy takes care of routing /api to the backend

  const request = useCallback(async <T>(endpoint: string, options?: RequestInit): Promise<T> => {
    try {
      const response = await fetch(`${baseUrl}${endpoint}`, {
        ...options,
        cache: 'no-store', // Bypass 304 Not Modified caching completely
        headers: {
          'Content-Type': 'application/json',
          ...options?.headers,
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      return await response.json() as T;
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('An unknown error occurred during the API request.');
    }
  }, [baseUrl]);

  const postPetition = useCallback(async (prompt: string): Promise<{ task_id: string }> => {
    return request<{ task_id: string }>('/petition', {
      method: 'POST',
      body: JSON.stringify({ prompt }),
    });
  }, [request]);

  const fetchTasks = useCallback(async (offset: number = 0, limit: number = 10): Promise<TaskListResponse> => {
    return request<TaskListResponse>(`/tasks?offset=${offset}&limit=${limit}`);
  }, [request]);

  const fetchTaskStatus = useCallback(async (taskId: string): Promise<TaskStatusResponse> => {
    return request<TaskStatusResponse>(`/task/${taskId}/status`);
  }, [request]);

  const fetchDebate = useCallback(async (taskId: string): Promise<DebateResponse> => {
    return request<DebateResponse>(`/task/${taskId}/debate`);
  }, [request]);

  const fetchAct = useCallback(async (taskId: string): Promise<ActResponse> => {
    return request<ActResponse>(`/task/${taskId}/act`);
  }, [request]);

  const fetchVerdict = useCallback(async (taskId: string): Promise<VerdictResponse> => {
    return request<VerdictResponse>(`/task/${taskId}/verdict`);
  }, [request]);

  return { postPetition, fetchTasks, fetchTaskStatus, fetchDebate, fetchAct, fetchVerdict };
}
