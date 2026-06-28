export type Segment = { start: number; end: number; speaker: string; text: string };
export type Transcript = { segments: Segment[]; speakers: string[]; duration?: number };
export type SessionStatus = {
  status: 'queued' | 'running' | 'done' | 'error';
  pct: number; message: string; transcript?: Transcript; error?: string;
};
