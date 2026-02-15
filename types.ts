
export type Position = { x: number; y: number };

export type CellType = 'empty' | 'wall' | 'kit' | 'trap' | 'exit' | 'player';

export type TrapType = 'electric' | 'laser' | 'acid' | 'fire' | 'teleport';

export type Trap = { x: number; y: number; type: TrapType };

export type GameStatus = 'playing' | 'won' | 'lost-health' | 'lost-time';

export type GameMode = 'playing' | 'editing';

export type AppView = 'menu' | 'game' | 'progression';

export interface LevelStats {
  score: number;
  healthRemaining: number;
  timeRemaining: number;
  stars: number;
}

export interface ProgressionData {
  levels: Record<number, LevelStats>;
  highestLevelReached: number;
}

export interface LevelConfig {
  playerPos: Position;
  kits: Position[];
  traps: Trap[];
  walls: Position[];
  exit: Position;
}

export interface GameState extends LevelConfig {
  health: number;
  timeLeft: number;
  score: number;
  status: GameStatus;
  combo: number;
  stepsInCombo: number;
}
