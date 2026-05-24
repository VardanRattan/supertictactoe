"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Copy, Check, Users, ShieldAlert, WifiOff, RefreshCw, ArrowLeft, Loader2 } from 'lucide-react';
import SuperTicTacToeBoard, { SuperTicTacToeHandle, GameState } from './super-tic-tac-toe-board';

// Safe alphabet for room codes (excluding 0, O, 1, I)
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const OFFENSIVE_WORDS = ['FUCK', 'SHIT', 'CUNT', 'Bitch', 'SLUT', 'ASS', 'COCK', 'DICK'];

type BattleState = 
  | 'IDLE' 
  | 'CHOOSING_ROLE'
  | 'CREATING_PEER'
  | 'WAITING_FOR_OPPONENT'
  | 'JOINING_PEER'
  | 'COUNTDOWN'
  | 'PLAYING'
  | 'RECONNECTING'
  | 'DISCONNECTED';

interface FriendBattleProps {
  mode: string;
  onNewGameRequest: () => void;
}

const FriendBattle = ({ mode, onNewGameRequest }: FriendBattleProps) => {
  const [battleState, setBattleState] = useState<BattleState>('IDLE');
  const [roomCode, setRoomCode] = useState('');
  const [inputCode, setInputCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [hostRole, setHostRole] = useState<'X' | 'O' | null>(null);
  const [myRole, setMyRole] = useState<'X' | 'O' | null>(null);
  const [opponentUsername, setOpponentUsername] = useState('Opponent');
  const [countdown, setCountdown] = useState(3);
  const [reconnectCountdown, setReconnectCountdown] = useState(30);
  const [errorMessage, setErrorMessage] = useState('');
  
  // Local turn tracking synchronized from game updates to force wrapper re-renders
  const [currentPlayer, setCurrentPlayer] = useState<string | null>(null);
  const [superWinner, setSuperWinner] = useState<string | null>(null);

  // Rematch state
  const [rematchRequestedByMe, setRematchRequestedByMe] = useState(false);
  const [rematchRequestedByOpponent, setRematchRequestedByOpponent] = useState(false);
  
  // Custom Emotes & Chat State
  const [opponentEmote, setOpponentEmote] = useState<string | null>(null);
  const [opponentChat, setOpponentChat] = useState<string | null>(null);
  const [myEmote, setMyEmote] = useState<string | null>(null);
  const [myChat, setMyChat] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [showEmoteMenu, setShowEmoteMenu] = useState(false);

  // Network and Game refs
  const peerRef = useRef<any>(null);
  const connRef = useRef<any>(null);
  const gameRef = useRef<SuperTicTacToeHandle>(null);
  const isHost = useRef(false);
  const latestGameState = useRef<GameState | null>(null);
  const ignoreNextMoveFromStateChange = useRef(false);

  // Heartbeat tracking refs
  const lastPongTime = useRef(Date.now());
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Refs to tracking dynamic state variables inside async loops to prevent stale closures
  const battleStateRef = useRef<BattleState>('IDLE');
  const myRoleRef = useRef<'X' | 'O' | null>(null);
  const roomCodeRef = useRef('');

  // Unified state setter helpers that sync refs
  const updateBattleState = (state: BattleState) => {
    setBattleState(state);
    battleStateRef.current = state;
  };

  const updateMyRole = (role: 'X' | 'O' | null) => {
    setMyRole(role);
    myRoleRef.current = role;
  };

  const updateRoomCode = (code: string) => {
    setRoomCode(code);
    roomCodeRef.current = code;
  };

  // Generate unique room code
  const generateRoomCode = (): string => {
    let code = '';
    do {
      code = '';
      for (let i = 0; i < 5; i++) {
        code += ALPHABET.charAt(Math.floor(Math.random() * ALPHABET.length));
      }
    } while (OFFENSIVE_WORDS.some(word => code.includes(word)));
    return code;
  };

  // Safe peer initialization (client-side only dynamic PeerJS load)
  const initPeer = async (customId: string | null) => {
    try {
      const { default: Peer } = await import('peerjs');
      
      const peerId = customId ? `stt-${customId}` : undefined;
      const peer = new Peer(peerId as any, {
        host: '0.peerjs.com',
        port: 443,
        secure: true,
        debug: 1 // Only log errors to keep console clean
      });

      peerRef.current = peer;

      peer.on('error', (err: any) => {
        console.error('PeerJS error:', err);
        if (err.type === 'unavailable-id') {
          setErrorMessage('Room code already in use or unavailable.');
          updateBattleState('IDLE');
        } else if (err.type === 'network') {
          setErrorMessage('Network connection lost.');
          updateBattleState('IDLE');
        } else {
          setErrorMessage('Connection failed. Please try again.');
          updateBattleState('IDLE');
        }
      });

      return peer;
    } catch (error) {
      console.error('Failed to load PeerJS:', error);
      setErrorMessage('Failed to initialize connection service.');
      updateBattleState('IDLE');
      return null;
    }
  };

  // Clean up P2P networks and timers
  const cleanup = useCallback(() => {
    if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
    if (reconnectIntervalRef.current) clearInterval(reconnectIntervalRef.current);

    const activeCode = roomCodeRef.current;
    if (activeCode) {
      try {
        localStorage.removeItem(`sttt_battle_state_${activeCode}`);
      } catch (e) {}
    }

    if (connRef.current) {
      try { connRef.current.close(); } catch (e) {}
      connRef.current = null;
    }
    if (peerRef.current) {
      try { peerRef.current.destroy(); } catch (e) {}
      peerRef.current = null;
    }
    latestGameState.current = null;
    ignoreNextMoveFromStateChange.current = false;
    setRematchRequestedByMe(false);
    setRematchRequestedByOpponent(false);
    setOpponentEmote(null);
    setOpponentChat(null);
    setMyEmote(null);
    setMyChat(null);
  }, []);

  useEffect(() => {
    return () => cleanup();
  }, [cleanup]);

  // Setup connection event listeners
  const setupConnection = useCallback((connection: any) => {
    connRef.current = connection;
    lastPongTime.current = Date.now();

    connection.on('open', () => {
      // Connect successfully, handle host handshake
      if (isHost.current) {
        // Host randomly decides starting player
        const roles = hostRole || (Math.random() > 0.5 ? 'X' : 'O');
        const opponentRole = roles === 'X' ? 'O' : 'X';
        updateMyRole(roles);
        
        connection.send({
          type: 'HANDSHAKE',
          roles: {
            host: roles,
            guest: opponentRole
          },
          username: 'Host'
        });

        // Handshake State Sync: If we have a cached state for this room, send it to the reconnecting peer
        const activeCode = roomCodeRef.current;
        if (activeCode) {
          try {
            const cachedSync = localStorage.getItem(`sttt_battle_state_${activeCode}`);
            if (cachedSync) {
              connection.send({
                type: 'STATE_SYNC',
                gameState: JSON.parse(cachedSync)
              });
            }
          } catch (e) {}
        }

        updateBattleState('COUNTDOWN');
        startCountdown();
      }
    });

    connection.on('data', (data: any) => {
      if (typeof data !== 'object' || !data.type) return;

      switch (data.type) {
        case 'HANDSHAKE':
          if (!isHost.current) {
            updateMyRole(data.roles.guest);
            setOpponentUsername(data.username || 'Host');
            updateBattleState('COUNTDOWN');
            startCountdown();
          }
          break;

        case 'STATE_SYNC':
          if (data.gameState && gameRef.current) {
            try {
              (gameRef.current as any).loadGameState(data.gameState);
              setCurrentPlayer(data.gameState.currentPlayer);
              setSuperWinner(data.gameState.superWinner);
            } catch (e) {
              console.error("Failed to restore synchronized game state:", e);
            }
          }
          break;

        case 'EMOTE':
          setOpponentEmote(data.emote);
          playSound('moveO');
          setTimeout(() => setOpponentEmote(null), 2500);
          break;

        case 'CHAT':
          setOpponentChat(data.text);
          playSound('win');
          setTimeout(() => setOpponentChat(null), 4000);
          break;

        case 'MOVE':
          if (gameRef.current) {
            ignoreNextMoveFromStateChange.current = true;
            gameRef.current.makeMove(data.game, data.cell);
          }
          break;

        case 'REMATCH_REQUEST':
          setRematchRequestedByOpponent(true);
          playSound('moveO');
          break;

        case 'REMATCH_ACCEPT':
          setRematchRequestedByMe(false);
          setRematchRequestedByOpponent(false);
          if (gameRef.current) {
            gameRef.current.resetGame();
          }
          setCountdown(3);
          updateBattleState('COUNTDOWN');
          startCountdown();
          break;

        case 'PING':
          try { connection.send({ type: 'PONG' }); } catch (e) {}
          break;

        case 'PONG':
          lastPongTime.current = Date.now();
          break;
      }
    });

    connection.on('close', () => {
      handleDisconnect();
    });

    connection.on('error', () => {
      handleDisconnect();
    });

    // Start 5s heartbeat interval
    startHeartbeat();
  }, [hostRole]);

  // Start 3-second starting countdown
  const startCountdown = () => {
    setCountdown(3);
    const interval = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          updateBattleState('PLAYING');
          return 3;
        }
        return prev - 1;
      });
    }, 1000);
  };

  // Heartbeat ping mechanism using ref tracker to prevent stale closures
  const startHeartbeat = () => {
    if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
    
    heartbeatIntervalRef.current = setInterval(() => {
      if (connRef.current && connRef.current.open) {
        try {
          connRef.current.send({ type: 'PING' });
        } catch (e) {}

        // If no pong response for over 10 seconds, trigger reconnection
        if (Date.now() - lastPongTime.current > 10000 && battleStateRef.current === 'PLAYING') {
          handleDisconnect();
        }
      }
    }, 5000);
  };

  // Handle sudden network disconnections with a 30s buffer
  const handleDisconnect = () => {
    if (battleStateRef.current === 'RECONNECTING' || battleStateRef.current === 'DISCONNECTED') return;
    
    updateBattleState('RECONNECTING');
    setReconnectCountdown(30);

    if (reconnectIntervalRef.current) clearInterval(reconnectIntervalRef.current);
    
    reconnectIntervalRef.current = setInterval(() => {
      setReconnectCountdown(prev => {
        // If opponent reconnected, clear interval
        if (connRef.current && connRef.current.open && Date.now() - lastPongTime.current < 8000) {
          clearInterval(reconnectIntervalRef.current!);
          updateBattleState('PLAYING');

          if (latestGameState.current && connRef.current && connRef.current.open) {
            try {
              connRef.current.send({
                type: 'STATE_SYNC',
                gameState: latestGameState.current
              });
            } catch (e) {}
          }
          return 30;
        }

        if (prev <= 1) {
          clearInterval(reconnectIntervalRef.current!);
          updateBattleState('DISCONNECTED');
          cleanup();
          return 30;
        }
        return prev - 1;
      });
    }, 1000);
  };

  // Host Action: Choose role and initialize
  const handleSelectRole = (choice: 'X' | 'O') => {
    setHostRole(choice);
    updateBattleState('CREATING_PEER');
    setErrorMessage('');
    
    const code = generateRoomCode();
    updateRoomCode(code);
    isHost.current = true;

    initPeer(code).then(peer => {
      if (!peer) return;

      peer.on('open', () => {
        updateBattleState('WAITING_FOR_OPPONENT');
      });

      peer.on('connection', (connection) => {
        setupConnection(connection);
      });
    });
  };

  // Guest Action: Enter code and connect
  const handleJoinRoom = () => {
    if (!inputCode || inputCode.length !== 5) {
      setErrorMessage('Room code must be exactly 5 characters.');
      return;
    }

    updateBattleState('JOINING_PEER');
    setErrorMessage('');
    isHost.current = false;
    updateRoomCode(inputCode.toUpperCase());

    initPeer(null).then(peer => {
      if (!peer) return;

      peer.on('open', () => {
        const connection = peer.connect(`stt-${inputCode.toUpperCase()}`);
        setupConnection(connection);
        
        // Timeout if connection doesn't open within 8 seconds
        setTimeout(() => {
          if (connRef.current === null || !connRef.current.open) {
            setErrorMessage('Could not connect to room. Code may be invalid or host disconnected.');
            updateBattleState('IDLE');
            cleanup();
          }
        }, 8000);
      });
    });
  };

  // Copy code utility
  const handleCopyCode = () => {
    navigator.clipboard.writeText(roomCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Quick Match Matchmaking lookup

  // Custom P2P Emote sender
  const sendEmote = (emote: string) => {
    if (!connRef.current || !connRef.current.open) return;
    try {
      connRef.current.send({ type: 'EMOTE', emote });
      setMyEmote(emote);
      setTimeout(() => setMyEmote(null), 2500);
    } catch (e) {}
  };

  // Custom P2P Chat sender
  const sendChat = (text: string) => {
    if (!text.trim() || !connRef.current || !connRef.current.open) return;
    try {
      const sanitizedText = text.trim().slice(0, 35);
      connRef.current.send({ type: 'CHAT', text: sanitizedText });
      setMyChat(sanitizedText);
      setChatInput('');
      setTimeout(() => setMyChat(null), 4000);
    } catch (e) {}
  };

  // Trigger Rematch Event
  const handleRequestRematch = () => {
    if (rematchRequestedByMe || !connRef.current) return;
    
    setRematchRequestedByMe(true);
    try {
      connRef.current.send({ type: 'REMATCH_REQUEST' });
    } catch (e) {}

    // Consensus triggered if both requested/accepted
    if (rematchRequestedByOpponent) {
      acceptRematch();
    }
  };

  const acceptRematch = () => {
    setRematchRequestedByMe(false);
    setRematchRequestedByOpponent(false);
    try {
      connRef.current.send({ type: 'REMATCH_ACCEPT' });
    } catch (e) {}

    if (gameRef.current) {
      gameRef.current.resetGame();
    }
    setCountdown(3);
    updateBattleState('COUNTDOWN');
    startCountdown();
  };

  // Trigger sound indicator safely
  const playSound = (soundName: 'moveO' | 'moveX' | 'win' | 'superWin' | 'error') => {
    if (typeof window !== 'undefined') {
      const isMuted = localStorage.getItem("sttt_mute") === "true";
      if (isMuted) return;
    }
    try {
      const prefix = process.env.NODE_ENV === 'production' ? '/supertictactoe' : '';
      const audio = new Audio(`${prefix}/sounds/${soundName}.mp3`);
      audio.volume = 0.6;
      audio.play().catch(() => {});
    } catch (e) {}
  };

  // Dynamic game updates hook
  const handleGameStateChange = (state: GameState) => {
    latestGameState.current = state;
    setCurrentPlayer(state.currentPlayer);
    setSuperWinner(state.superWinner);

    // Save game state locally for reconnection sync
    const activeCode = roomCodeRef.current;
    if (activeCode) {
      if (state.gameStarted && !state.superWinner) {
        localStorage.setItem(`sttt_battle_state_${activeCode}`, JSON.stringify(state));
      } else {
        localStorage.removeItem(`sttt_battle_state_${activeCode}`);
      }
    }

    // Send local moves to the peer
    if (state.lastMove && state.currentPlayer !== myRoleRef.current) {
      if (ignoreNextMoveFromStateChange.current) {
        ignoreNextMoveFromStateChange.current = false;
        return;
      }

      if (connRef.current && connRef.current.open) {
        try {
          connRef.current.send({
            type: 'MOVE',
            game: state.lastMove.game,
            cell: state.lastMove.cell
          });
        } catch (e) {
          console.error('Failed to send move:', e);
        }
      }
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 relative overflow-hidden">
      
      {/* WAITING ROOM SCREENS */}
      <AnimatePresence mode="wait">
        
        {/* State 1: Choose Option / Type Code */}
        {battleState === 'IDLE' && (
          <motion.div
            key="idle"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            className="w-full max-w-md glass-panel rounded-3xl p-6 md:p-8 border border-white/5 shadow-2xl flex flex-col gap-6"
          >
            <div className="flex items-center gap-3 justify-center mb-2">
              <Users className="text-yellow-400 size-8 drop-shadow-[0_0_8px_rgba(234,179,8,0.4)]" />
              <h2 className="text-2xl md:text-3xl font-extrabold text-yellow-400 glow-accent uppercase tracking-wider">
                Friend Battle
              </h2>
            </div>

            {errorMessage && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3.5 rounded-xl text-sm text-center flex items-center justify-center gap-2">
                <ShieldAlert className="size-4 shrink-0" />
                {errorMessage}
              </div>
            )}

            <div className="flex flex-col gap-4">
              <button
                onClick={() => setBattleState('CHOOSING_ROLE')}
                className="w-full py-4 rounded-xl bg-yellow-500 hover:bg-yellow-600 text-gray-900 font-extrabold text-lg shadow-lg hover:scale-[1.02] active:scale-[0.98] transition-all duration-200 cursor-pointer"
              >
                Create Room (Host)
              </button>

              <div className="relative my-4 flex items-center justify-center">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-white/10"></div>
                </div>
                <span className="relative px-3 bg-gray-900 text-xs font-semibold uppercase tracking-wider text-gray-500">
                  Or Join Existing
                </span>
              </div>

              <div className="flex flex-col gap-2">
                <input
                  type="text"
                  maxLength={5}
                  value={inputCode}
                  onChange={(e) => setInputCode(e.target.value.toUpperCase().replace(/[^A-Z2-9]/g, ''))}
                  placeholder="ENTER 5-DIGIT CODE"
                  className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 text-center text-xl font-bold tracking-widest text-yellow-400 placeholder:text-gray-600 focus:outline-none focus:border-yellow-500 focus:ring-1 focus:ring-yellow-500/30 uppercase"
                />
                <button
                  onClick={handleJoinRoom}
                  disabled={inputCode.length !== 5}
                  className="w-full py-3.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/5 font-bold text-lg text-yellow-400 disabled:opacity-30 disabled:cursor-not-allowed hover:scale-[1.01] active:scale-[0.99] transition-all duration-200 cursor-pointer"
                >
                  Join Room
                </button>
              </div>
            </div>

            <button
              onClick={onNewGameRequest}
              className="mt-4 flex items-center gap-2 justify-center text-sm text-gray-400 hover:text-yellow-400 transition-colors duration-200"
            >
              <ArrowLeft className="size-4" />
              Back to Main Menu
            </button>
          </motion.div>
        )}

        {/* State 2: Host Side Choice */}
        {battleState === 'CHOOSING_ROLE' && (
          <motion.div
            key="choosing_role"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="w-full max-w-sm glass-panel rounded-3xl p-6 md:p-8 border border-white/5 shadow-2xl flex flex-col gap-6 text-center"
          >
            <h3 className="text-xl font-bold text-yellow-400 tracking-wide uppercase">
              Choose Your Side
            </h3>
            <p className="text-sm text-gray-400 -mt-3">
              Select which symbol you will play as Host
            </p>
            <div className="flex gap-4 mt-2">
              <button
                onClick={() => handleSelectRole('O')}
                className="flex-1 py-4 rounded-2xl bg-white/5 border border-white/5 hover:bg-white/10 text-cyan-400 text-3xl font-extrabold shadow-md hover:scale-105 transition-all cursor-pointer"
              >
                O (Cyan)
              </button>
              <button
                onClick={() => handleSelectRole('X')}
                className="flex-1 py-4 rounded-2xl bg-white/5 border border-white/5 hover:bg-white/10 text-red-500 text-3xl font-extrabold shadow-md hover:scale-105 transition-all cursor-pointer"
              >
                X (Red)
              </button>
            </div>
            <button
              onClick={() => updateBattleState('IDLE')}
              className="text-sm text-gray-500 hover:text-gray-300 transition-colors mt-2"
            >
              Back
            </button>
          </motion.div>
        )}

        {/* State 3: Peer Initialization Loading */}
        {(battleState === 'CREATING_PEER' || battleState === 'JOINING_PEER') && (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center gap-4 text-center glass-panel rounded-3xl p-8 border border-white/5 shadow-2xl"
          >
            <Loader2 className="animate-spin text-yellow-400 size-10" />
            <h3 className="text-lg font-bold text-gray-200">
              {battleState === 'CREATING_PEER' ? 'Generating Room...' : 'Connecting to Peer...'}
            </h3>
          </motion.div>
        )}

        {/* State 4: Waiting for Opponent connection */}
        {battleState === 'WAITING_FOR_OPPONENT' && (
          <motion.div
            key="waiting"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="w-full max-w-md glass-panel rounded-3xl p-6 md:p-8 border border-white/5 shadow-2xl flex flex-col gap-6 items-center text-center"
          >
            <Loader2 className="animate-spin text-yellow-400 size-8 mb-2" />
            <h3 className="text-lg font-bold text-gray-300">
              Waiting for Opponent...
            </h3>
            <p className="text-sm text-gray-400 -mt-3">
              Share this code with your friend to connect:
            </p>

            <div className="flex gap-2 w-full max-w-[280px] mt-2">
              <div className="flex-1 bg-white/5 border border-white/10 rounded-xl py-3 px-4 text-center text-3xl font-extrabold tracking-widest text-yellow-400 select-all">
                {roomCode}
              </div>
              <button
                onClick={handleCopyCode}
                className="bg-white/10 hover:bg-white/15 border border-white/5 px-4 rounded-xl transition-all cursor-pointer"
                title="Copy Room Code"
              >
                {copied ? <Check className="text-green-400 size-6" /> : <Copy className="text-yellow-400 size-6" />}
              </button>
            </div>

            <button
              onClick={() => {
                cleanup();
                updateBattleState('IDLE');
              }}
              className="text-sm text-red-400 hover:text-red-300 transition-colors mt-4 border-b border-red-400/20"
            >
              Cancel Hosting
            </button>
          </motion.div>
        )}

        {/* State 5: Starting Countdown */}
        {battleState === 'COUNTDOWN' && (
          <motion.div
            key="countdown"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center gap-4 text-center"
          >
            <h2 className="text-2xl font-bold uppercase tracking-wider text-cyan-400">
              Connecting Direct P2P Channel
            </h2>
            <div className="text-gray-400">
              Your role: <span className={myRole === 'O' ? 'text-cyan-400 font-bold' : 'text-red-500 font-bold'}>{myRole === 'O' ? 'Player O' : 'Player X'}</span>
            </div>
            <motion.div
              key={countdown}
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 400 }}
              className="size-32 bg-yellow-500/10 border border-yellow-500/30 rounded-full flex items-center justify-center text-6xl font-extrabold text-yellow-400 glow-accent shadow-xl"
            >
              {countdown}
            </motion.div>
          </motion.div>
        )}

        {/* State 6: Playing real-time match */}
        {battleState === 'PLAYING' && (
          <motion.div
            key="playing"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="w-full h-full relative"
          >
            <div className="absolute top-4 right-4 z-50 glass-panel border border-white/5 py-1.5 px-3 rounded-full text-xs text-green-400 flex items-center gap-1.5 shadow-md">
              <div className="size-2 bg-green-500 rounded-full animate-pulse"></div>
              P2P Active
            </div>

            {/* Turn visual banner utilizing wrapper-level states (Matching user AI wrapper suggestion) */}
            {currentPlayer && !superWinner && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 glass-panel border border-white/5 py-1.5 px-4 rounded-full text-sm font-bold shadow-lg backdrop-blur-md">
                {currentPlayer === myRole ? (
                  <span className="text-yellow-400 animate-pulse">Your Turn</span>
                ) : (
                  <span className="text-gray-400">Opponent's Turn ({opponentUsername})</span>
                )}
              </div>
            )}

            {/* My Chat/Emote Bubble */}
            <AnimatePresence>
              {(myEmote || myChat) && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.8, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  className="absolute bottom-24 right-4 z-40 glass-panel border border-yellow-500/20 px-4 py-2 rounded-2xl shadow-xl flex items-center gap-2 max-w-[200px]"
                >
                  <div className="size-2 bg-yellow-400 rounded-full"></div>
                  <span className="text-sm font-semibold text-yellow-300">
                    {myEmote ? <span className="text-2xl">{myEmote}</span> : myChat}
                  </span>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Opponent Chat/Emote Bubble */}
            <AnimatePresence>
              {(opponentEmote || opponentChat) && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.8, y: -10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  className="absolute top-16 left-4 z-40 glass-panel border border-cyan-500/20 px-4 py-2 rounded-2xl shadow-xl flex items-center gap-2 max-w-[200px]"
                >
                  <div className="size-2 bg-cyan-400 rounded-full"></div>
                  <span className="text-sm font-semibold text-cyan-300">
                    {opponentEmote ? <span className="text-2xl">{opponentEmote}</span> : opponentChat}
                  </span>
                </motion.div>
              )}
            </AnimatePresence>

            <SuperTicTacToeBoard
              ref={gameRef}
              mode={mode}
              isAIGame={false}
              onGameStateChange={handleGameStateChange}
              onNewGameRequest={onNewGameRequest}
              isProcessing={currentPlayer !== myRole} // Blocks clicking out of turn! (AI wrapper design)
            />

            {/* Emote & Chat Controller */}
            <div className="absolute bottom-4 left-4 z-50 flex items-center gap-2">
              <button
                onClick={() => setShowEmoteMenu(!showEmoteMenu)}
                className="p-2.5 rounded-full glass-panel border border-white/5 hover:border-yellow-500/30 text-yellow-400 shadow-lg transition-all duration-200 cursor-pointer text-lg"
                title="Send Emote"
              >
                😀
              </button>

              <div className="flex items-center glass-panel border border-white/5 rounded-full px-3 py-1 shadow-lg max-w-[180px] sm:max-w-[220px]">
                <input
                  type="text"
                  maxLength={30}
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Say something..."
                  className="w-full bg-transparent border-none outline-none text-xs font-medium text-gray-200 placeholder:text-gray-500"
                  onKeyDown={(e) => e.key === 'Enter' && sendChat(chatInput)}
                />
                <button
                  onClick={() => sendChat(chatInput)}
                  className="text-xs font-bold text-yellow-400 hover:text-yellow-300 transition-colors ml-1 cursor-pointer"
                >
                  Send
                </button>
              </div>

              <AnimatePresence>
                {showEmoteMenu && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9, y: 10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9, y: 10 }}
                    className="absolute bottom-16 left-0 glass-panel border border-white/10 p-2.5 rounded-2xl grid grid-cols-4 gap-2 shadow-2xl z-50 min-w-[140px]"
                  >
                    {['😀', '🔥', '👑', '😮', '🤡', '👏', '🧠', '💥'].map((emo) => (
                      <button
                        key={emo}
                        onClick={() => {
                          sendEmote(emo);
                          setShowEmoteMenu(false);
                        }}
                        className="text-2xl hover:scale-125 transition-transform duration-200 cursor-pointer"
                      >
                        {emo}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* In-Game Rematch overlay if Super Winner is declared */}
            {superWinner && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-950/85 backdrop-blur-md z-50 rounded-3xl border border-white/10 p-6">
                <span className={`text-5xl md:text-7xl font-extrabold text-center mb-8 px-4 ${
                  superWinner === 'Draw' 
                    ? 'text-yellow-400 glow-accent' 
                    : superWinner === 'O' 
                      ? 'text-cyan-400 glow-o' 
                      : 'text-red-500 glow-x'
                }`}>
                  {superWinner === 'Draw' ? 'Match Draw!' : `Player ${superWinner} Wins!`}
                </span>

                <div className="flex flex-col items-center gap-4 w-full max-w-[280px]">
                  <motion.button
                    onClick={handleRequestRematch}
                    disabled={rematchRequestedByMe}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    className={`w-full py-4 rounded-xl text-xl font-bold bg-white/10 text-yellow-400 border border-yellow-500/20 shadow-2xl flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer`}
                  >
                    {rematchRequestedByMe ? (
                      <>
                        <Loader2 className="animate-spin size-5 text-yellow-400" />
                        Sent. Waiting...
                      </>
                    ) : rematchRequestedByOpponent ? (
                      <>
                        <RefreshCw className="size-5 animate-spin" />
                        Accept Rematch
                      </>
                    ) : (
                      <>
                        <RefreshCw className="size-5" />
                        Request Rematch
                      </>
                    )}
                  </motion.button>

                  <button
                    onClick={onNewGameRequest}
                    className="text-sm text-gray-400 hover:text-yellow-400 border-b border-gray-400/20 pb-0.5 mt-2"
                  >
                    Leave Room
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        )}

        {/* State 7: Opponent Reconnecting */}
        {battleState === 'RECONNECTING' && (
          <motion.div
            key="reconnecting"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="w-full max-w-sm glass-panel rounded-3xl p-6 md:p-8 border border-white/5 shadow-2xl flex flex-col gap-6 items-center text-center"
          >
            <WifiOff className="text-yellow-500 size-12 animate-bounce" />
            <h3 className="text-xl font-extrabold text-yellow-500">
              Connection Interrupted
            </h3>
            <p className="text-sm text-gray-400 -mt-2 leading-relaxed">
              Waiting for opponent to reconnect. Room closes in:
            </p>
            <div className="text-5xl font-black text-yellow-500 glow-accent">
              {reconnectCountdown}s
            </div>

            <button
              onClick={() => {
                cleanup();
                onNewGameRequest();
              }}
              className="w-full py-3 bg-red-500/10 hover:bg-red-500/15 border border-red-500/20 text-red-400 font-semibold rounded-xl text-sm transition-all duration-200 mt-2 cursor-pointer"
            >
              Quit Game
            </button>
          </motion.div>
        )}

        {/* State 8: Disconnected / Peer Closed */}
        {battleState === 'DISCONNECTED' && (
          <motion.div
            key="disconnected"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-sm glass-panel rounded-3xl p-6 md:p-8 border border-white/5 shadow-2xl flex flex-col gap-6 items-center text-center"
          >
            <WifiOff className="text-red-500 size-12" />
            <h3 className="text-xl font-extrabold text-red-400">
              Opponent Disconnected
            </h3>
            <p className="text-sm text-gray-400 -mt-2">
              The P2P game connection was lost or closed by the peer.
            </p>

            <button
              onClick={onNewGameRequest}
              className="w-full py-3.5 bg-yellow-500 hover:bg-yellow-600 text-gray-900 font-extrabold text-lg rounded-xl shadow-lg transition-all duration-200 mt-2 cursor-pointer"
            >
              Return to Menu
            </button>
          </motion.div>
        )}

      </AnimatePresence>
    </div>
  );
};

export default FriendBattle;
