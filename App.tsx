import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Position, GameState, GameStatus, Trap, TrapType, GameMode, LevelConfig, AppView, ProgressionData, LevelStats } from './types';
import { 
  GRID_SIZE, 
  INITIAL_HEALTH, 
  INITIAL_TIME, 
  KIT_SCORE, 
  TRAP_DAMAGE_ELECTRIC,
  TRAP_DAMAGE_LASER,
  TRAP_DAMAGE_ACID,
  TRAP_DAMAGE_FIRE
} from './constants';

interface FlyingKit {
  id: number;
  x: number;
  y: number;
}

type EditorBrush = 'wall' | 'kit' | 'trap-electric' | 'trap-laser' | 'trap-acid' | 'trap-fire' | 'trap-teleport' | 'exit' | 'player' | 'eraser';

interface MissionSettings {
  initialTime: number;
  trapQty: number;
  kitQty: number;
  wallPct: number;
}

const PRESETS: Record<string, MissionSettings> = {
  EASY: { initialTime: 45, trapQty: 5, kitQty: 3, wallPct: 6 },
  NORMAL: { initialTime: 30, trapQty: 10, kitQty: 4, wallPct: 10 },
  HARD: { initialTime: 20, trapQty: 18, kitQty: 6, wallPct: 15 },
  INSANE: { initialTime: 12, trapQty: 25, kitQty: 8, wallPct: 20 },
};

const ABILITIES = [
  { level: 2, name: "Radar Scan", desc: "Reveals nearby items and hazards." },
  { level: 4, name: "Battery Pack", desc: "Increases time limit for all levels." },
  { level: 6, name: "Armor Plating", desc: "Reduces damage taken from traps." },
  { level: 8, name: "Quantum Jump", desc: "Allows one safe teleport per level." },
  { level: 10, name: "Stealth Suit", desc: "Movement is silent and safer." }
];

const playSound = (type: 'collect' | 'damage' | 'win' | 'click' | 'transition') => {
  try {
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    const now = audioCtx.currentTime;

    switch (type) {
      case 'click':
        osc.frequency.setValueAtTime(400, now);
        gain.gain.setValueAtTime(0.05, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
        osc.start(); osc.stop(now + 0.1);
        break;
      case 'transition':
        osc.type = 'sine';
        osc.frequency.setValueAtTime(200, now);
        osc.frequency.exponentialRampToValueAtTime(800, now + 0.2);
        gain.gain.setValueAtTime(0.05, now);
        osc.start(); osc.stop(now + 0.2);
        break;
      case 'collect':
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.exponentialRampToValueAtTime(1200, now + 0.1);
        gain.gain.setValueAtTime(0.1, now);
        osc.start(); osc.stop(now + 0.1);
        break;
      case 'damage':
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(150, now);
        gain.gain.setValueAtTime(0.1, now);
        osc.start(); osc.stop(now + 0.2);
        break;
      case 'win':
        [500, 700, 900].forEach((f, i) => {
          const o = audioCtx.createOscillator();
          const g = audioCtx.createGain();
          o.connect(g); g.connect(audioCtx.destination);
          o.frequency.setValueAtTime(f, now + i * 0.1);
          g.gain.setValueAtTime(0.05, now + i * 0.1);
          o.start(now + i * 0.1); o.stop(now + i * 0.1 + 0.3);
        });
        break;
    }
  } catch(e) {}
};

const App: React.FC = () => {
  const [view, setView] = useState<AppView>('menu');
  const [isPaused, setIsPaused] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [mode, setMode] = useState<GameMode>('playing');
  const [level, setLevel] = useState(1);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [discovered, setDiscovered] = useState<Set<string>>(new Set());
  const [laserPhase, setLaserPhase] = useState<'off' | 'warning' | 'on'>('off');
  const [scanActive, setScanActive] = useState(false);
  const [empCooldown, setEmpCooldown] = useState(0);
  const [empActiveTimer, setEmpActiveTimer] = useState(0);
  const [scanCooldown, setScanCooldown] = useState(0);
  const [logs, setLogs] = useState<string[]>(["System ready. Select a level to begin.", "Waiting for player input..."]);
  
  const [missionSettings, setMissionSettings] = useState<MissionSettings>(PRESETS.NORMAL);
  const [trailPos, setTrailPos] = useState<Position | null>(null);
  const [moveKey, setMoveKey] = useState(0);
  const [brush, setBrush] = useState<EditorBrush>('wall');

  const [progression, setProgression] = useState<ProgressionData>(() => {
    const saved = localStorage.getItem('geo_rescue_progression_v2');
    return saved ? JSON.parse(saved) : { levels: {}, highestLevelReached: 1 };
  });

  const getPosKey = useCallback((p: Position) => `${p.x},${p.y}`, []);

  useEffect(() => {
    localStorage.setItem('geo_rescue_progression_v2', JSON.stringify(progression));
  }, [progression]);

  useEffect(() => {
    if (theme === 'light') {
      document.body.classList.add('light-theme');
    } else {
      document.body.classList.remove('light-theme');
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));
    playSound('click');
  }, []);

  const addLog = useCallback((msg: string) => {
    setLogs(prev => [msg, ...prev].slice(0, 10));
  }, []);

  const calculateStars = (health: number, time: number): number => {
    if (health >= 80 && time >= 10) return 3;
    if (health >= 50 || time >= 5) return 2;
    return 1;
  };

  const initGame = useCallback((lvl: number, customConfig?: LevelConfig) => {
    if (customConfig) {
      setGameState({
        ...customConfig,
        health: 100,
        timeLeft: missionSettings.initialTime + (lvl * 3),
        score: (lvl - 1) * 500,
        status: 'playing',
        combo: 0,
        stepsInCombo: 0,
      });
    } else {
      const wallCount = Math.floor(GRID_SIZE * GRID_SIZE * (missionSettings.wallPct / 100));
      const occupied = new Set<string>();
      const randPos = (): Position => {
        let p;
        do {
          p = { x: Math.floor(Math.random() * GRID_SIZE), y: Math.floor(Math.random() * GRID_SIZE) };
        } while (occupied.has(getPosKey(p)));
        return p;
      };

      const playerPos = { x: 0, y: 0 }; occupied.add('0,0');
      const walls: Position[] = [];
      for (let i = 0; i < wallCount; i++) {
        const p = randPos(); walls.push(p); occupied.add(getPosKey(p));
      }
      const kits: Position[] = [];
      for (let i = 0; i < missionSettings.kitQty; i++) {
        const p = randPos(); kits.push(p); occupied.add(getPosKey(p));
      }
      const traps: Trap[] = [];
      const types: TrapType[] = ['electric', 'laser', 'acid', 'fire', 'teleport'];
      for (let i = 0; i < missionSettings.trapQty + (lvl * 2); i++) {
        const p = randPos(); traps.push({ ...p, type: types[Math.floor(Math.random() * types.length)] }); occupied.add(getPosKey(p));
      }
      const exit = randPos();

      setGameState({
        playerPos, kits, traps, walls, exit,
        health: 100,
        timeLeft: missionSettings.initialTime + (lvl * 3),
        score: (lvl - 1) * 500,
        status: 'playing',
        combo: 0,
        stepsInCombo: 0,
      });
    }
    
    setDiscovered(new Set(['0,0', '1,0', '0,1', '1,1']));
    setEmpCooldown(0);
    setEmpActiveTimer(0);
    setScanCooldown(0);
    setIsPaused(false);
    addLog(`Level ${lvl} started.`);
  }, [getPosKey, addLog, missionSettings]);

  useEffect(() => {
    if (view === 'game' && mode === 'playing') {
      initGame(level);
    }
  }, [level, initGame, mode, view]);

  useEffect(() => {
    if (!gameState || gameState.status !== 'playing' || mode !== 'playing' || view !== 'game' || isPaused) return;

    const timer = setInterval(() => {
      setGameState(prev => {
        if (!prev || prev.status !== 'playing') return prev;
        const newTime = prev.timeLeft - 1;
        if (newTime <= 0) {
          playSound('damage');
          return { ...prev, timeLeft: 0, status: 'lost-time' };
        }
        return { ...prev, timeLeft: newTime };
      });

      setEmpCooldown(c => Math.max(0, c - 1));
      setEmpActiveTimer(a => Math.max(0, a - 1));
      setScanCooldown(c => Math.max(0, c - 1));
      
      setLaserPhase(prev => {
        if (prev === 'off') return 'warning';
        if (prev === 'warning') return 'on';
        return 'off';
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [gameState?.status, mode, view, isPaused]);

  const movePlayer = useCallback((dx: number, dy: number) => {
    if (mode !== 'playing' || view !== 'game' || isPaused) return;
    setGameState(prev => {
      if (!prev || prev.status !== 'playing') return prev;

      const newX = Math.max(0, Math.min(GRID_SIZE - 1, prev.playerPos.x + dx));
      const newY = Math.max(0, Math.min(GRID_SIZE - 1, prev.playerPos.y + dy));

      if (prev.walls.some(w => w.x === newX && w.y === newY)) return prev;
      if (prev.playerPos.x === newX && prev.playerPos.y === newY) return prev;

      setTrailPos({ x: prev.playerPos.x, y: prev.playerPos.y });
      setMoveKey(k => k + 1);
      setTimeout(() => setTrailPos(null), 200);

      const newPos = { x: newX, y: newY };
      const key = getPosKey(newPos);

      setDiscovered(dPrev => {
        const next = new Set(dPrev);
        for (let x = -1; x <= 1; x++) {
          for (let y = -1; y <= 1; y++) {
            next.add(`${newX + x},${newY + y}`);
          }
        }
        return next;
      });

      let newHealth = prev.health;
      let newScore = prev.score;
      let newStatus: GameStatus = prev.status;
      let newKits = [...prev.kits];

      const kitIdx = newKits.findIndex(k => k.x === newX && k.y === newY);
      if (kitIdx !== -1) {
        newKits.splice(kitIdx, 1);
        newHealth = Math.min(100, newHealth + 15);
        newScore += KIT_SCORE;
        addLog(`Item collected! ${newKits.length} left.`);
        playSound('collect');
      }

      const trap = prev.traps.find(t => t.x === newX && t.y === newY);
      if (trap) {
        if (empActiveTimer > 0) {
          addLog("Hazard bypassed due to Shield.");
        } else {
          let dmg = 0;
          if (trap.type === 'electric') dmg = TRAP_DAMAGE_ELECTRIC;
          if (trap.type === 'laser' && laserPhase === 'on') dmg = TRAP_DAMAGE_LASER;
          if (trap.type === 'acid') dmg = TRAP_DAMAGE_ACID;
          if (trap.type === 'fire') dmg = TRAP_DAMAGE_FIRE;
          
          if (dmg > 0) {
            newHealth -= dmg;
            playSound('damage');
            addLog(`Hazard hit! Health down by ${dmg}.`);
          }
          
          if (trap.type === 'teleport') {
            newPos.x = Math.floor(Math.random() * GRID_SIZE);
            newPos.y = Math.floor(Math.random() * GRID_SIZE);
            playSound('collect'); 
            addLog("Random teleportation triggered!");
          }
        }
      }

      if (newHealth <= 0) newStatus = 'lost-health';
      if (newX === prev.exit.x && newY === prev.exit.y) {
        if (newKits.length === 0) {
          newStatus = 'won';
          playSound('win');
          addLog("Level clear! Great job.");
          
          const stars = calculateStars(newHealth, prev.timeLeft);
          setProgression(p => {
            const nextLevel = level + 1;
            const existingStats = p.levels[level];
            const updatedStats: LevelStats = {
              score: Math.max(existingStats?.score || 0, newScore),
              healthRemaining: Math.max(existingStats?.healthRemaining || 0, newHealth),
              timeRemaining: Math.max(existingStats?.timeRemaining || 0, prev.timeLeft),
              stars: Math.max(existingStats?.stars || 0, stars)
            };
            return {
              ...p,
              levels: { ...p.levels, [level]: updatedStats },
              highestLevelReached: Math.max(p.highestLevelReached, nextLevel)
            };
          });
        } else {
          addLog("Collect all items before exiting.");
        }
      }

      return {
        ...prev,
        playerPos: newPos,
        health: newHealth,
        score: newScore,
        status: newStatus,
        kits: newKits,
      };
    });
  }, [getPosKey, addLog, laserPhase, empActiveTimer, mode, view, isPaused, level]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && view === 'game') {
        setIsPaused(p => !p);
        playSound('click');
        return;
      }
      if (mode !== 'playing' || view !== 'game' || isPaused) return;
      if (e.key === 'ArrowUp' || e.key === 'w') movePlayer(0, -1);
      if (e.key === 'ArrowDown' || e.key === 's') movePlayer(0, 1);
      if (e.key === 'ArrowLeft' || e.key === 'a') movePlayer(-1, 0);
      if (e.key === 'ArrowRight' || e.key === 'd') movePlayer(1, 0);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [movePlayer, mode, view, isPaused]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-start p-3 sm:p-6 lg:p-10 relative">
      
      {/* View: Main Menu */}
      {view === 'menu' && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="glass-panel p-6 sm:p-12 max-w-2xl w-full text-center flex flex-col items-center">
            <h1 className="text-3xl sm:text-5xl font-orbitron font-bold text-white mb-2">GEO-RESCUE RUNNER</h1>
            <p className="text-sm font-medium text-gray-400 mb-8 uppercase tracking-widest">Global Rescue Mission</p>

            <div className="flex flex-col sm:flex-row gap-4 mb-10 w-full justify-center">
              <button onClick={toggleTheme} className="btn-tactical px-6 py-3 rounded uppercase text-sm flex items-center justify-center gap-3">
                <i className={`fas ${theme === 'dark' ? 'fa-sun' : 'fa-moon'}`}></i>
                Switch to {theme === 'dark' ? 'Light' : 'Dark'} Mode
              </button>
              <button onClick={() => { playSound('click'); setView('progression'); }} className="btn-tactical px-6 py-3 rounded uppercase text-sm">
                <i className="fas fa-map-marked-alt mr-2"></i>
                Select Level
              </button>
            </div>

            <div className="mb-8 w-full">
              <span className="text-xs text-gray-500 uppercase block mb-3 font-bold">Difficulty</span>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {Object.entries(PRESETS).map(([key, config]) => (
                  <button
                    key={key}
                    onClick={() => { setMissionSettings(config); playSound('click'); }}
                    className={`p-3 border rounded transition-all text-xs font-bold uppercase ${JSON.stringify(missionSettings) === JSON.stringify(config) ? 'border-cyan-500 bg-cyan-500/20 text-cyan-400 shadow-[0_0_10px_rgba(0,243,255,0.2)]' : 'border-white/10 text-gray-500 hover:border-cyan-500/50'}`}
                  >
                    {key}
                  </button>
                ))}
              </div>
            </div>

            <button 
              onClick={() => { playSound('transition'); setView('game'); }}
              className="btn-tactical w-full py-4 rounded font-orbitron font-bold text-xl uppercase tracking-widest"
            >
              Start Mission
            </button>
          </div>
        </div>
      )}

      {/* View: Level Select Map */}
      {view === 'progression' && (
        <div className="fixed inset-0 z-[300] flex flex-col items-center bg-black/90 backdrop-blur-md p-4 overflow-y-auto">
          <div className="max-w-6xl w-full flex flex-col lg:flex-row gap-6 p-2 sm:p-6 mt-10">
            <div className="w-full lg:w-1/3 space-y-4">
              <div className="glass-panel p-6 border-l-4 border-cyan-500">
                <h3 className="text-xl font-orbitron font-bold text-white mb-6 uppercase">Unlocked Skills</h3>
                <div className="space-y-4">
                  {ABILITIES.map((a, i) => (
                    <div key={i} className={`p-3 border rounded ${progression.highestLevelReached >= a.level ? 'border-cyan-500/40 bg-cyan-500/5' : 'border-white/5 opacity-30'}`}>
                      <div className="flex justify-between items-center text-xs mb-1 font-bold uppercase">
                        <span className="text-cyan-500">{a.name}</span>
                        <span className="text-gray-500">Lv {a.level}</span>
                      </div>
                      <p className="text-[11px] text-gray-400">{a.desc}</p>
                    </div>
                  ))}
                </div>
              </div>
              <button onClick={() => { playSound('click'); setView('menu'); }} className="btn-tactical w-full py-3 rounded font-bold uppercase text-sm">Main Menu</button>
            </div>

            <div className="w-full lg:w-2/3">
              <div className="glass-panel p-6 sm:p-10 flex flex-col items-center rounded-xl">
                <h2 className="text-2xl font-orbitron font-bold text-cyan-400 mb-8 uppercase tracking-widest">Mission Map</h2>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-4 sm:gap-8 mb-10">
                  {Array.from({ length: 12 }).map((_, i) => {
                    const lNum = i + 1;
                    const isUnlocked = lNum <= progression.highestLevelReached;
                    const stats = progression.levels[lNum];
                    return (
                      <button 
                        key={i}
                        disabled={!isUnlocked}
                        onClick={() => { setLevel(lNum); playSound('transition'); setView('game'); }}
                        className={`group relative w-16 h-16 sm:w-24 sm:h-24 flex flex-col items-center justify-center border-2 rounded-lg transition-all ${isUnlocked ? 'border-cyan-500 bg-cyan-500/10 hover:bg-cyan-500 hover:text-white hover:scale-105' : 'border-white/10 text-gray-700 cursor-not-allowed'}`}
                      >
                        <span className="text-[10px] uppercase font-bold mb-1">Level</span>
                        <span className="text-xl sm:text-3xl font-orbitron font-bold">{lNum}</span>
                        {stats && (
                          <div className="absolute -bottom-5 flex gap-1">
                            {[1, 2, 3].map(s => (
                              <i key={s} className={`fas fa-star text-[8px] ${s <= stats.stars ? 'text-yellow-500' : 'text-gray-800'}`} />
                            ))}
                          </div>
                        )}
                        {!isUnlocked && <i className="fas fa-lock absolute text-xs top-2 right-2 opacity-50" />}
                      </button>
                    );
                  })}
                </div>
                <div className="w-full border-t border-white/10 pt-6 flex justify-between text-xs font-bold text-gray-500 uppercase">
                  <span>Levels Beaten: {progression.highestLevelReached - 1} / 12</span>
                  <span>Total Stars: {Object.values(progression.levels).reduce((a, b) => a + b.stars, 0)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* View: Active Game */}
      {view === 'game' && gameState && (
        <div className="w-full max-w-5xl flex flex-col gap-4">
          {/* Top Info Bar */}
          <div className="glass-panel p-3 sm:p-5 rounded-xl border-b-2 border-cyan-500/50 flex flex-col sm:flex-row justify-between items-center gap-4">
            <div className="flex items-center gap-4 w-full sm:w-auto">
              <div className="bg-cyan-500/20 px-3 py-1 rounded border border-cyan-500/30">
                <span className="text-[10px] text-cyan-500 block uppercase font-bold leading-none">Mission</span>
                <span className="text-lg font-orbitron font-bold text-white uppercase">Sector {level}</span>
              </div>
              <button onClick={() => setIsPaused(true)} className="px-3 py-2 border border-yellow-500/50 text-yellow-500 hover:bg-yellow-500 hover:text-black transition-all uppercase text-[11px] font-bold rounded">Pause</button>
            </div>
            
            <div className="grid grid-cols-4 gap-4 sm:gap-10 w-full sm:w-auto text-center font-bold">
              <div>
                <span className="block text-[10px] text-green-500 uppercase">Items</span>
                <span className="text-sm sm:text-xl font-orbitron">{missionSettings.kitQty - gameState.kits.length} / {missionSettings.kitQty}</span>
              </div>
              <div>
                <span className="block text-[10px] text-pink-500 uppercase">Health</span>
                <span className="text-sm sm:text-xl font-orbitron">{gameState.health}%</span>
              </div>
              <div>
                <span className="block text-[10px] text-cyan-400 uppercase">Score</span>
                <span className="text-sm sm:text-xl font-orbitron">{gameState.score}</span>
              </div>
              <div>
                <span className="block text-[10px] text-yellow-500 uppercase">Time</span>
                <span className={`text-sm sm:text-xl font-orbitron ${gameState.timeLeft < 10 ? 'text-red-500 animate-pulse' : ''}`}>{gameState.timeLeft}s</span>
              </div>
            </div>
          </div>

          <div className="flex flex-col lg:flex-row gap-6 items-center lg:items-start">
            {/* Gameplay Area */}
            <div className="flex-1 glass-panel p-1 relative rounded-lg shadow-2xl overflow-hidden">
              <div className="grid gap-px bg-white/5" style={{ gridTemplateColumns: `repeat(${GRID_SIZE}, 1fr)`, aspectRatio: '1/1' }}>
                {Array.from({ length: GRID_SIZE * GRID_SIZE }).map((_, i) => {
                  const x = i % GRID_SIZE;
                  const y = Math.floor(i / GRID_SIZE);
                  const key = getPosKey({x, y});
                  const isDiscovered = discovered.has(key) || scanActive;
                  const isPlayer = gameState.playerPos.x === x && gameState.playerPos.y === y;
                  const isTrail = trailPos?.x === x && trailPos?.y === y;
                  const isExit = gameState.exit.x === x && gameState.exit.y === y;
                  const wall = gameState.walls.find(w => w.x === x && w.y === y);
                  const kit = gameState.kits.find(k => k.x === x && k.y === y);
                  const trap = gameState.traps.find(t => t.x === x && t.y === y);

                  return (
                    <div 
                      key={key} 
                      className={`relative flex items-center justify-center border border-white/5 transition-all duration-300 ${!isDiscovered ? 'bg-black/95' : 'bg-black/10'}`}
                    >
                      {isDiscovered && (
                        <>
                          {wall && <div className="absolute inset-0 bg-slate-700 m-[15%] rounded-sm" />}
                          {kit && <i className="fas fa-box text-green-400 text-[10px] sm:text-lg animate-bounce" />}
                          {trap && (
                            <div className={`flex items-center justify-center ${empActiveTimer > 0 ? 'opacity-20 scale-75' : ''}`}>
                              {trap.type === 'electric' && <i className="fas fa-bolt text-yellow-400 text-[10px] sm:text-lg hazard-flicker" />}
                              {trap.type === 'laser' && <div className={`w-full h-0.5 ${laserPhase === 'on' ? 'bg-red-500 shadow-[0_0_8px_#f00]' : laserPhase === 'warning' ? 'bg-red-900 animate-pulse' : 'bg-transparent'}`} />}
                              {trap.type === 'acid' && <i className="fas fa-skull text-green-800 text-[10px] sm:text-lg" />}
                              {trap.type === 'fire' && <i className="fas fa-fire text-orange-600 text-[10px] sm:text-lg" />}
                              {trap.type === 'teleport' && <i className="fas fa-sync text-purple-600 animate-spin-slow text-[10px] sm:text-lg" />}
                            </div>
                          )}
                          {isExit && (
                            <div className="relative w-full h-full flex items-center justify-center">
                              {gameState.kits.length === 0 && <div className="active-portal absolute inset-0 rounded-full" />}
                              <i className={`fas fa-door-open ${gameState.kits.length === 0 ? 'text-cyan-400' : 'text-gray-800 opacity-20'} text-[12px] sm:text-2xl`} />
                            </div>
                          )}
                        </>
                      )}
                      {isPlayer && (
                        <div key={moveKey} className="absolute inset-0 flex items-center justify-center z-50 animate-dash-in">
                          <i className="fas fa-user text-cyan-400 text-[12px] sm:text-3xl drop-shadow-[0_0_10px_#00f3ff]" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Side Controls */}
            <div className="w-full lg:w-64 flex flex-col gap-4">
              {/* Virtual Pad */}
              <div className="flex flex-col items-center gap-2 glass-panel p-4 rounded-xl sm:hidden">
                <button onClick={() => movePlayer(0, -1)} className="w-14 h-14 border border-cyan-500/50 flex items-center justify-center active:bg-cyan-500 rounded-lg"><i className="fas fa-chevron-up"></i></button>
                <div className="flex gap-4">
                  <button onClick={() => movePlayer(-1, 0)} className="w-14 h-14 border border-cyan-500/50 flex items-center justify-center active:bg-cyan-500 rounded-lg"><i className="fas fa-chevron-left"></i></button>
                  <button onClick={() => movePlayer(0, 1)} className="w-14 h-14 border border-cyan-500/50 flex items-center justify-center active:bg-cyan-500 rounded-lg"><i className="fas fa-chevron-down"></i></button>
                  <button onClick={() => movePlayer(1, 0)} className="w-14 h-14 border border-cyan-500/50 flex items-center justify-center active:bg-cyan-500 rounded-lg"><i className="fas fa-chevron-right"></i></button>
                </div>
              </div>

              {/* Game Log */}
              <div className="glass-panel p-4 h-40 lg:h-80 overflow-hidden flex flex-col rounded-xl">
                <span className="text-[10px] font-bold text-cyan-400 border-b border-white/10 pb-2 mb-3 uppercase tracking-widest">Log</span>
                <div className="flex-1 overflow-y-auto space-y-2 text-[11px] font-medium text-gray-400">
                  {logs.map((log, idx) => (
                    <p key={idx} className={log.includes('hit') || log.includes('lost') ? 'text-red-400' : log.includes('collected') ? 'text-green-400' : ''}>
                      {log}
                    </p>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Overlays */}
          {gameState.status !== 'playing' && (
            <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
              <div className="glass-panel p-8 sm:p-12 max-w-sm w-full text-center flex flex-col items-center rounded-2xl border-t-4 border-cyan-500">
                {gameState.status === 'won' ? (
                  <>
                    <h2 className="text-4xl font-orbitron font-bold text-cyan-400 mb-4 uppercase">Success</h2>
                    <div className="flex gap-2 mb-8">
                      {[1, 2, 3].map(s => (
                        <i key={s} className={`fas fa-star text-2xl ${s <= calculateStars(gameState.health, gameState.timeLeft) ? 'text-yellow-500' : 'text-gray-800'}`} />
                      ))}
                    </div>
                    <button onClick={() => { setLevel(l => l + 1); playSound('transition'); }} className="btn-tactical w-full py-4 rounded-lg font-bold uppercase mb-3">Next Level</button>
                    <button onClick={() => setView('progression')} className="text-xs text-gray-500 uppercase font-bold hover:text-cyan-400">Map View</button>
                  </>
                ) : (
                  <>
                    <h2 className="text-4xl font-orbitron font-bold text-red-500 mb-4 uppercase">Failed</h2>
                    <p className="text-sm text-gray-400 mb-8 uppercase font-bold">Mission Interrupted</p>
                    <button onClick={() => { setLevel(level); initGame(level); }} className="btn-tactical w-full py-4 rounded-lg font-bold uppercase mb-3 border-red-500 text-red-500 hover:bg-red-500">Try Again</button>
                    <button onClick={() => setView('menu')} className="text-xs text-gray-500 uppercase font-bold hover:text-white">Main Menu</button>
                  </>
                )}
              </div>
            </div>
          )}

          {isPaused && (
            <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
              <div className="glass-panel p-10 max-w-sm w-full text-center rounded-2xl border-t-2 border-yellow-500">
                <h2 className="text-2xl font-orbitron font-bold text-yellow-500 mb-8 uppercase tracking-widest">Paused</h2>
                <div className="flex flex-col gap-4">
                  <button onClick={() => setIsPaused(false)} className="btn-tactical w-full py-3 rounded-lg font-bold uppercase border-yellow-500 text-yellow-500">Resume</button>
                  <button onClick={toggleTheme} className="btn-tactical w-full py-3 rounded-lg font-bold uppercase flex items-center justify-center gap-2">
                    <i className={`fas ${theme === 'dark' ? 'fa-sun' : 'fa-moon'}`}></i>
                    {theme === 'dark' ? 'Light' : 'Dark'} Mode
                  </button>
                  <button onClick={() => { setIsPaused(false); setView('menu'); }} className="btn-tactical w-full py-3 rounded-lg font-bold uppercase border-red-500 text-red-500 hover:bg-red-500">Quit</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default App;