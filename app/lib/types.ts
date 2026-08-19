export type Segment = { start: number; end: number; speaker: string; text: string };
export type Transcript = { segments: Segment[]; speakers: string[]; duration?: number };
export type SessionStatus = {
  status: 'queued' | 'running' | 'done' | 'error';
  pct: number; message: string; transcript?: Transcript; error?: string;
  // Background notes generation (POST /analyze {background:true}). Reported here so a client that
  // was killed mid-generation can collect the finished notes instead of re-running the LLM.
  notes?: string;
  notes_status?: 'running' | 'done' | 'error';
  notes_error?: string;
};
