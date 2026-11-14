export type Segment = { start: number; end: number; speaker: string; text: string };
export type Transcript = { segments: Segment[]; speakers: string[]; duration?: number };
export type SessionStatus = {
  status: 'queued' | 'running' | 'done' | 'error';
  pct: number; message: string; transcript?: Transcript; error?: string;
  // Background notes generation (POST /analyze {background:true}). Reported here so a client that
  // was killed mid-generation can collect the finished notes instead of re-running the LLM.
  notes?: string;
  notes_status?: 'queued' | 'running' | 'done' | 'error';
  notes_error?: string;
  // Real generation progress: 0..1 derived from characters produced, plus a human-readable line.
  notes_pct?: number;
  notes_message?: string;
  // 1-based place in the notes queue while waiting for a worker (absent once it starts running).
  notes_queue_position?: number;
};
