// Shapes of backend/tests/fixtures/contracts/*.json — the backend, console and app agree on these.

export type Check = { id: string; ok: boolean; label: string; hint: string; message?: string };

export type StatusDetail = {
  version: string;
  ok: boolean;
  checks: Check[];
  queue: { active: number; queued: number };
  llm: { model: string; reachable: boolean; provider?: string; base_url?: string };
  asr?: { base_url: string };
  gpu?: { available: boolean; name?: string; vram_used_mb?: number; vram_total_mb?: number; util_pct?: number };
  server?: { port: number; data_dir: string; retention_hours: number; push_enabled: boolean; admin_token_source: string };
  pairing_required: boolean;
};

export type ModelRow = {
  id: string;
  kind: 'asr' | 'diarization' | 'llm';
  name: string;
  state: 'ready' | 'loaded' | 'missing' | 'downloading' | 'unknown';
  size_bytes: number | null;
  managed_by: string;
  selected: boolean;
};

export type Models = { models: ModelRow[] };

export type Setting<T = string> = { value: T; locked: boolean; default: T };
export type Settings = {
  ollama_base_url: Setting;
  llm_model: Setting;
  llm_provider: Setting;
  openai_base_url: Setting;
  openai_api_key: { configured: boolean; locked: boolean };
};

export type Job = {
  id: string;
  kind: 'transcribe' | 'analyze';
  status: 'queued' | 'running' | 'done' | 'error';
  pct: number;
  message: string;
  started_at: number | null;
  finished_at: number | null;
  duration_s: number | null;
  error: string | null;
};
export type Jobs = { active: Job[]; recent: Job[] };

export type Pairing = { token: string; urls: string[]; qr_payload: string };

export type LlmTest =
  | { ok: true; version: string; models: string[] }
  | { ok: false; error: { code: string; message: string; hint: string } };

export type PullEvent = {
  name: string;
  status: string;
  completed: number;
  total: number;
  pct: number;
  /** Not in pull_events.json; tolerated if the backend adds detail on status "error". */
  error?: string;
  message?: string;
};
