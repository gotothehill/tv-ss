export interface Source {
  id: string;
  url: string;
  status: 'idle' | 'checking' | 'online' | 'offline' | 'error';
  latency: number | null; // in ms
  resolution?: string;
}

export interface Channel {
  id: string;
  name: string;
  group: string; // e.g., "CCTV", "卫视", "Movie"
  category: 'China' | 'International' | 'Other';
  sources: Source[];
  bestSource?: Source; // The currently selected "best" source based on latency/status
}

export interface PlaylistPreset {
  name: string;
  url: string;
  category: 'China' | 'International';
}

export interface StreamStats {
  totalChannels: number;
  totalSources: number;
  onlineSources: number;
  avgLatency: number;
}
