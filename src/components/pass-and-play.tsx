"use client";

import React from 'react';
import SuperTicTacToeBoard from './super-tic-tac-toe-board';

interface PassAndPlayProps {
  mode: string;
  onNewGameRequest: () => void;
}

const PassAndPlay = ({ mode, onNewGameRequest }: PassAndPlayProps) => {
  return (
    <SuperTicTacToeBoard 
      mode={mode}
      isAIGame={false}
      onNewGameRequest={onNewGameRequest}
    />
  );
};

export default PassAndPlay;
