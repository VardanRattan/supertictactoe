"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Settings, Volume2, VolumeX, Palette, X } from "lucide-react";
import MainMenu, { BackToMenuButton } from "@/components/main-menu";
import PreGameScreen from "@/components/pre-game-screen";
import PassAndPlay from "@/components/pass-and-play";
import AIDuel from "@/components/ai-duel";
import FriendBattle from "@/components/friend-battle";

type AppState = "MENU" | "PRE_GAME" | "PLAYING";

const pageVariants = {
  initial: { opacity: 0, y: 15, filter: "blur(4px)" },
  animate: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.35, ease: "easeOut" } },
  exit: { opacity: 0, y: -15, filter: "blur(4px)", transition: { duration: 0.25, ease: "easeIn" } }
} as const;

export default function Home() {
  const [appState, setAppState] = useState<AppState>("MENU");
  const [gameMode, setGameMode] = useState<string | null>(null);
  const [activeTheme, setActiveTheme] = useState<string>(() => {
    if (typeof window !== "undefined") return localStorage.getItem("sttt_theme") || "space";
    return "space";
  });
  const [isMuted, setIsMuted] = useState<boolean>(() => {
    if (typeof window !== "undefined") return localStorage.getItem("sttt_mute") === "true";
    return false;
  });
  const [showSettings, setShowSettings] = useState<boolean>(false);

  const handleModeSelect = (mode: string) => {
    setGameMode(mode);
    setAppState("PRE_GAME");
  };

  const handleStartGame = () => {
    setAppState("PLAYING");
  };

  const handleBackToMenu = () => {
    setAppState("MENU");
    setGameMode(null);
  };

  const toggleMute = () => {
    const nextMute = !isMuted;
    setIsMuted(nextMute);
    localStorage.setItem("sttt_mute", nextMute ? "true" : "false");
  };

  const selectTheme = (themeName: string) => {
    setActiveTheme(themeName);
    localStorage.setItem("sttt_theme", themeName);
  };

  const getThemeClassName = () => {
    switch (activeTheme) {
      case "cyberpunk": return "theme-cyberpunk";
      case "wood": return "theme-wood";
      case "chalkboard": return "theme-chalkboard";
      default: return "theme-space";
    }
  };

  return (
    <main className={`min-h-screen md:h-screen md:overflow-hidden bg-space-grid text-gray-100 flex flex-col justify-between relative overflow-x-hidden ${getThemeClassName()}`}>
      
      {/* Floating Settings Button */}
      <button
        onClick={() => setShowSettings(true)}
        className="absolute top-4 right-4 p-2 text-gray-400 hover:text-yellow-400 transition-colors duration-200 z-50 cursor-pointer"
        aria-label="Settings"
      >
        <Settings size={28} className="drop-shadow-[0_0_8px_rgba(0,0,0,0.5)] animate-spin-slow" />
      </button>

      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md p-4"
          >
            <motion.div
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 15 }}
              className="w-full max-w-md glass-panel rounded-3xl p-6 md:p-8 border border-white/10 shadow-2xl relative"
            >
              <button
                onClick={() => setShowSettings(false)}
                className="absolute top-4 right-4 p-2 text-gray-400 hover:text-yellow-400 transition-colors duration-200 cursor-pointer"
              >
                <X size={24} />
              </button>

              <h2 className="text-2xl font-bold text-yellow-400 glow-accent mb-6 uppercase tracking-wider text-center">
                Battle Settings
              </h2>

              <div className="flex flex-col gap-6">
                
                {/* Audio Option */}
                <div className="flex items-center justify-between glass-card p-4 rounded-2xl border border-white/5">
                  <div className="flex items-center gap-3">
                    {isMuted ? <VolumeX className="text-red-400" /> : <Volume2 className="text-yellow-400" />}
                    <div>
                      <h3 className="font-semibold text-sm">Sound Effects</h3>
                      <p className="text-xs text-gray-400">Toggle board and win playbacks</p>
                    </div>
                  </div>
                  <button
                    onClick={toggleMute}
                    className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all duration-300 cursor-pointer ${
                      isMuted
                        ? "bg-red-500/20 text-red-400 border border-red-500/30"
                        : "bg-green-500/20 text-green-400 border border-green-500/30"
                    }`}
                  >
                    {isMuted ? "MUTED" : "ENABLED"}
                  </button>
                </div>

                {/* Theme Selector Option */}
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-2 text-sm text-gray-300 mb-1">
                    <Palette size={18} className="text-yellow-400" />
                    <span className="font-semibold">Arena Theme Customization</span>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { id: "space", label: "Space Grid", color: "bg-blue-950/40 border-cyan-500/40" },
                      { id: "cyberpunk", label: "Cyberpunk Neon", color: "bg-purple-950/40 border-pink-500/40" },
                      { id: "wood", label: "Retro Wood", color: "bg-amber-950/40 border-amber-600/40" },
                      { id: "chalkboard", label: "Chalkboard", color: "bg-emerald-950/40 border-gray-400/40" }
                    ].map((theme) => (
                      <button
                        key={theme.id}
                        onClick={() => selectTheme(theme.id)}
                        className={`p-3 rounded-xl border text-xs font-bold text-center transition-all duration-300 hover:scale-105 cursor-pointer ${
                          activeTheme === theme.id
                            ? `${theme.color} ring-2 ring-yellow-400 bg-white/5`
                            : "border-white/5 bg-white/5 hover:bg-white/10"
                        }`}
                      >
                        {theme.label}
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  onClick={() => setShowSettings(false)}
                  className="w-full mt-2 py-3 bg-white/10 border border-white/5 hover:bg-white/15 rounded-xl font-semibold transition-all duration-200 cursor-pointer"
                >
                  Save & Apply Settings
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {appState === "MENU" && (
          <motion.div
            key="menu"
            variants={pageVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="flex-1 w-full h-full flex flex-col"
          >
            <MainMenu onModeSelect={handleModeSelect} />
          </motion.div>
        )}

        {appState === "PRE_GAME" && gameMode && (
          <motion.div
            key="pre_game"
            variants={pageVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="relative flex-1 w-full h-full flex flex-col"
          >
            <BackToMenuButton onClick={handleBackToMenu} />
            <PreGameScreen 
              gameMode={gameMode} 
              onStartGame={handleStartGame} 
            />
          </motion.div>
        )}

        {appState === "PLAYING" && gameMode && (
          <motion.div
            key="playing"
            variants={pageVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="relative flex-1 w-full h-full flex flex-col"
          >
            <BackToMenuButton onClick={handleBackToMenu} />
            {gameMode === 'ai_duel' ? (
              <AIDuel 
                mode={gameMode}
                onNewGameRequest={handleBackToMenu}
              />
            ) : gameMode === 'friend_battle' ? (
              <FriendBattle 
                mode={gameMode}
                onNewGameRequest={handleBackToMenu}
              />
            ) : (
              <PassAndPlay 
                mode={gameMode}
                onNewGameRequest={handleBackToMenu}
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
