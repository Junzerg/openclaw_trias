import React, { createContext, useContext, useReducer, ReactNode } from 'react';
import type { WSEventPayload } from '../types/backend';
import type { WsConnectionState } from '../hooks/useWebSocket';

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
    wsState: WsConnectionState;
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
  act: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
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
    timeline: { index: number; legislative: number; executive: number; judicial: number; total: number }[];
  };
}

export type AppAction =
  | { type: 'SET_ACTIVE_TASK'; taskId: string }
  | { type: 'SET_CONNECTION'; isConnected: boolean }
  | { type: 'SET_WS_STATE'; wsState: WsConnectionState }
  | { type: 'PETITION_SUBMIT'; prompt: string }
  | { type: 'PETITION_SUCCESS'; taskId: string }
  | { type: 'PETITION_ERROR'; error: string }
  | { type: 'SET_TASKS'; tasks: TaskSummary[] }
  | { type: 'DEBATE_EVENT'; event: WSEventPayload }
  | { type: 'THINKING_EVENT'; event: WSEventPayload }
  | { type: 'DEBATE_RESET' }
  | { type: 'DEBATE_LOAD_HISTORY'; rounds: DebateRound[]; conflictScores: number[] }
  | { type: 'TOKEN_USAGE'; event: { payload?: { branch?: string; tokens_used?: number; cumulative?: number }; [key: string]: unknown } }
  | { type: 'ACT_LOADED'; act: Record<string, unknown> }
  | { type: 'RESULT_LOADED'; result: Record<string, unknown> }
  | { type: 'VERDICT_LOADED'; verdict: { ruling: string; constitutional: boolean; evidence: string[] } }
  | { type: 'DELETE_TASK'; taskId: string }
  | { type: 'STREAM_CHUNK'; agent: string; chunk: string; completed: boolean }
  | { type: 'RESET' };

const initialState: AppState = {
  activeTaskId: null,
  connection: { isConnected: false, wsState: 'offline' as WsConnectionState, reconnectAttempts: 0, lastEventId: 0 },
  petition: { prompt: '', status: 'idle', taskId: null },
  tasks: [],
  debate: { rounds: [], conflictScores: [], currentRound: 0, thinkingAgent: null },
  execution: { steps: [], currentStep: 0 },
  act: null,
  result: null,
  verdict: null,
  tokens: { legislative: 0, executive: 0, judicial: 0, total: 0, timeline: [] },
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
    case 'SET_WS_STATE':
      return {
        ...state,
        connection: {
          ...state.connection,
          wsState: action.wsState,
          isConnected: action.wsState === 'connected',
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
        act: null,
        result: null,
        verdict: null,
        tokens: { legislative: 0, executive: 0, judicial: 0, total: 0, timeline: [] },
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
        act: null,
        result: null,
        verdict: null,
        tokens: { legislative: 0, executive: 0, judicial: 0, total: 0, timeline: [] },
      };
    case 'SET_TASKS':
      return {
        ...state,
        tasks: action.tasks,
      };
    case 'DELETE_TASK': {
      const isDeletedActive = state.activeTaskId === action.taskId;
      return {
        ...state,
        tasks: state.tasks.filter((t) => t.taskId !== action.taskId),
        ...(isDeletedActive ? {
          activeTaskId: null,
          debate: { rounds: [], conflictScores: [], currentRound: 0, thinkingAgent: null },
          execution: { steps: [], currentStep: 0 },
          act: null,
          result: null,
          verdict: null,
          tokens: { ...initialState.tokens, timeline: [] },
        } : {})
      };
    }
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
      const role = String(action.event.source_agent || 'agent');
      
      // Feature 4.14 / Polish: Only show legislative roles in the debate UI
      const isLegislative = role.includes('speaker') || role.includes('mp') || role.includes('radical') || role.includes('conservative');
      if (!isLegislative) {
        return state;
      }

      return {
        ...state,
        debate: {
          ...state.debate,
          thinkingAgent: { role, elapsed }
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
          round.radical_statement = statement;
        } else if (source_agent === 'conservative_mp') {
          round.conservative_statement = statement;
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

    case 'ACT_LOADED':
      return {
        ...state,
        act: action.act,
      };
    case 'RESULT_LOADED':
      return {
        ...state,
        result: action.result,
      };
    case 'VERDICT_LOADED':
      return {
        ...state,
        verdict: action.verdict,
      };
    case 'TOKEN_USAGE': {
      // Extract token usage data from the WS event payload
      const payload = action.event?.payload as Record<string, unknown> | undefined;
      const branch = (payload?.branch ?? (action.event as Record<string, unknown>)?.branch) as string | undefined;
      const cumulative = Number(payload?.cumulative ?? (action.event as Record<string, unknown>)?.cumulative) || 0;

      if (!branch || !['legislative', 'executive', 'judicial'].includes(branch)) {
        return state;
      }

      const newTokens = { ...state.tokens };
      newTokens[branch as 'legislative' | 'executive' | 'judicial'] = cumulative;
      newTokens.total = newTokens.legislative + newTokens.executive + newTokens.judicial;

      const timelineEntry = {
        index: newTokens.timeline.length + 1,
        legislative: newTokens.legislative,
        executive: newTokens.executive,
        judicial: newTokens.judicial,
        total: newTokens.total,
      };
      newTokens.timeline = [...state.tokens.timeline, timelineEntry];

      return { ...state, tokens: newTokens };
    }
    case 'STREAM_CHUNK': {
      if (!action.agent || action.completed) return state; // Only append chunks
      
      const rn = state.debate.currentRound || 1;
      const newRounds = [...state.debate.rounds];
      let roundIndex = newRounds.findIndex(r => r.round_number === rn);
      
      if (roundIndex === -1) {
        newRounds.push({
          round_number: rn,
          conflict_score: state.debate.conflictScores.length > 0 
            ? state.debate.conflictScores[state.debate.conflictScores.length - 1] 
            : 0
        });
        roundIndex = newRounds.length - 1;
      }
      
      const round = { ...newRounds[roundIndex] };
      const role = action.agent.toLowerCase();
      
      if (role.includes('radical')) {
        round.radical_statement = (round.radical_statement || '') + action.chunk;
      } else if (role.includes('conservative')) {
        round.conservative_statement = (round.conservative_statement || '') + action.chunk;
      } else if (role.includes('speaker')) {
        round.speaker_intervention = (round.speaker_intervention || '') + action.chunk;
      }
      
      newRounds[roundIndex] = round;
      
      return {
        ...state,
        debate: {
          ...state.debate,
          rounds: newRounds
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
