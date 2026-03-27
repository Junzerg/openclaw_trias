import React, { createContext, useContext, useReducer, ReactNode } from 'react';
import type { WSEventPayload } from '../types/backend';

export interface TaskSummary {
  taskId: string;
  status: string;
  prompt: string;
}

export interface DebateRound {
  round_number: number;
  radical_statement?: string;
  conservative_statement?: string;
  speaker_intervention?: string;
  conflict_score: number;
}

export interface AppState {
  activeTaskId: string | null;
  connection: {
    isConnected: boolean;
    reconnectAttempts: number;
    lastEventId: number;
  };
  petition: {
    prompt: string;
    status: 'idle' | 'submitting' | 'submitted' | 'error';
    taskId: string | null;
    error?: string;
  };
  tasks: TaskSummary[];
  debate: {
    rounds: DebateRound[];
    conflictScores: number[];
    currentRound: number;
    thinkingAgent: { role: string; elapsed: number } | null;
  };
  execution: {
    steps: unknown[];
    currentStep: number;
  };
  verdict: {
    ruling: string;
    constitutional: boolean;
    evidence: string[];
  } | null;
  tokens: {
    legislative: number;
    executive: number;
    judicial: number;
    total: number;
  };
}

export type AppAction =
  | { type: 'SET_ACTIVE_TASK'; taskId: string }
  | { type: 'SET_CONNECTION'; isConnected: boolean }
  | { type: 'PETITION_SUBMIT'; prompt: string }
  | { type: 'PETITION_SUCCESS'; taskId: string }
  | { type: 'PETITION_ERROR'; error: string }
  | { type: 'SET_TASKS'; tasks: TaskSummary[] }
  | { type: 'DEBATE_EVENT'; event: WSEventPayload }
  | { type: 'THINKING_EVENT'; event: WSEventPayload }
  | { type: 'DEBATE_RESET' }
  | { type: 'DEBATE_LOAD_HISTORY'; rounds: DebateRound[]; conflictScores: number[] }
  | { type: 'TOKEN_USAGE'; event: unknown }
  | { type: 'RESET' };

const initialState: AppState = {
  activeTaskId: null,
  connection: { isConnected: false, reconnectAttempts: 0, lastEventId: 0 },
  petition: { prompt: '', status: 'idle', taskId: null },
  tasks: [],
  debate: { rounds: [], conflictScores: [], currentRound: 0, thinkingAgent: null },
  execution: { steps: [], currentStep: 0 },
  verdict: null,
  tokens: { legislative: 0, executive: 0, judicial: 0, total: 0 },
};

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_CONNECTION':
      return {
        ...state,
        connection: {
          ...state.connection,
          isConnected: action.isConnected,
        },
      };
    case 'RESET':
      return { ...initialState };
    case 'PETITION_SUBMIT':
      return {
        ...state,
        petition: {
          prompt: action.prompt,
          status: 'submitting',
          taskId: null,
          error: undefined,
        },
      };
    case 'PETITION_SUCCESS':
      return {
        ...state,
        activeTaskId: action.taskId,
        petition: {
          ...state.petition,
          status: 'submitted',
          taskId: action.taskId,
        },
        tasks: [
          { taskId: action.taskId, status: 'PENDING', prompt: state.petition.prompt },
          ...state.tasks
        ],
        debate: { rounds: [], conflictScores: [], currentRound: 0, thinkingAgent: null },
        execution: { steps: [], currentStep: 0 },
        verdict: null,
      };
    case 'PETITION_ERROR':
      return {
        ...state,
        petition: {
          ...state.petition,
          status: 'error',
          error: action.error,
        },
      };
    case 'SET_ACTIVE_TASK':
      return {
        ...state,
        activeTaskId: action.taskId,
        debate: { rounds: [], conflictScores: [], currentRound: 0, thinkingAgent: null },
        execution: { steps: [], currentStep: 0 },
        verdict: null,
      };
    case 'SET_TASKS':
      return {
        ...state,
        tasks: action.tasks,
      };
    case 'DEBATE_RESET':
      return {
        ...state,
        debate: { rounds: [], conflictScores: [], currentRound: 0, thinkingAgent: null },
      };
    case 'DEBATE_LOAD_HISTORY': {
      const mergedRounds = [...action.rounds];
      for (const r of state.debate.rounds) {
        const existing = mergedRounds.findIndex(mr => mr.round_number === r.round_number);
        if (existing === -1) {
          mergedRounds.push(r);
        } else {
          // WS event (r) takes precedence over history (mr) because it's newer
          mergedRounds[existing] = { ...mergedRounds[existing], ...r };
        }
      }
      mergedRounds.sort((a, b) => a.round_number - b.round_number);

      const latestRound = mergedRounds.length > 0 ? mergedRounds[mergedRounds.length - 1].round_number : 0;
      return {
        ...state,
        debate: {
          rounds: mergedRounds,
          conflictScores: action.conflictScores.length >= state.debate.conflictScores.length 
              ? action.conflictScores 
              : state.debate.conflictScores,
          currentRound: Math.max(state.debate.currentRound, latestRound),
          thinkingAgent: null,
        },
      };
    }
    case 'THINKING_EVENT': {
      const details = (action.event.payload as Record<string, unknown>) || {};
      const elapsed = Number(details.elapsed_seconds) || 0;
      return {
        ...state,
        debate: {
          ...state.debate,
          thinkingAgent: { role: String(action.event.source_agent || 'agent'), elapsed }
        }
      };
    }
    case 'DEBATE_EVENT': {
      const { action: evAction, source_agent, payload, intensity, ...rootEventProps } = action.event;
      if (!evAction || !['propose', 'debate', 'brawl', 'order'].includes(evAction)) {
        return state;
      }

      let details: Record<string, unknown> = {};
      if (typeof payload === 'string') {
        try {
          details = JSON.parse(payload);
        } catch {
          // ignore
        }
      } else if (payload && typeof payload === 'object') {
        details = payload as Record<string, unknown>;
      }

      const round_number = (details.round_number ?? rootEventProps.round_number) as number | undefined;
      const statement = (details.statement ?? rootEventProps.statement) as string | undefined;
      let conflict_score = (details.conflict_score ?? rootEventProps.conflict_score) as number | undefined;

      if (conflict_score === undefined && intensity !== undefined) {
          conflict_score = intensity * 100;
      }

      const rn = round_number || state.debate.currentRound || 1;
      
      const newRounds = [...state.debate.rounds];
      let roundIndex = newRounds.findIndex(r => r.round_number === rn);
      
      if (roundIndex === -1) {
        newRounds.push({
          round_number: rn,
          conflict_score: conflict_score || 0
        });
        roundIndex = newRounds.length - 1;
      }
      
      const round = { ...newRounds[roundIndex] };

      if (statement) {
        if (source_agent === 'radical_mp') {
          round.radical_statement = round.radical_statement 
            ? round.radical_statement + '\n\n---\n**Rebuttal:**\n' + statement 
            : statement;
        } else if (source_agent === 'conservative_mp') {
          round.conservative_statement = round.conservative_statement 
            ? round.conservative_statement + '\n\n---\n**Rebuttal:**\n' + statement 
            : statement;
        } else if (source_agent === 'speaker') {
          if (evAction === 'order') {
            // Use replace instead of append to prevent duplicates from concurrent WS + history load
            round.speaker_intervention = statement;
          }
        }
      } else if (evAction === 'brawl') {
        round.speaker_intervention = '[SYSTEM] Conflict detected. Speaker preparing to intervene...';
      }

      if (conflict_score !== undefined) {
        round.conflict_score = conflict_score;
      }

      newRounds[roundIndex] = round;

      const newScores = [...state.debate.conflictScores];
      if (conflict_score !== undefined && (newScores.length === 0 || newScores[newScores.length - 1] !== conflict_score)) {
        newScores.push(conflict_score);
      }

      return {
        ...state,
        debate: {
          ...state.debate,
          rounds: newRounds,
          conflictScores: newScores,
          currentRound: Math.max(state.debate.currentRound, rn),
          thinkingAgent: null
        }
      };
    }
    // Other actions will be implemented in subsequent tasks
    default:
      return state;
  }
}

const AppStateContext = createContext<AppState | undefined>(undefined);
const AppDispatchContext = createContext<React.Dispatch<AppAction> | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState);

  return (
    <AppStateContext.Provider value={state}>
      <AppDispatchContext.Provider value={dispatch}>
        {children}
      </AppDispatchContext.Provider>
    </AppStateContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAppState() {
  const context = useContext(AppStateContext);
  if (context === undefined) {
    throw new Error('useAppState must be used within an AppProvider');
  }
  return context;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAppDispatch() {
  const context = useContext(AppDispatchContext);
  if (context === undefined) {
    throw new Error('useAppDispatch must be used within an AppProvider');
  }
  return context;
}
