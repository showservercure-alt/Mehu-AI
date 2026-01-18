
export enum Theme {
  LIGHT = 'light',
  DARK = 'dark',
}

export interface Message {
  id: string;
  role: 'user' | 'mehu';
  text: string;
  timestamp: Date;
}

export interface ScienceMetric {
  name: string;
  value: number;
}
