import Phaser from 'phaser';
import { GameScene } from './scenes/GameScene.js';
import { runtimeConfig } from './config.js';

export { runtimeConfig };

const gameConfig: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'app',
  backgroundColor: '#0f172a',
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    min: { width: 360, height: 640 },
  },
  scene: [GameScene],
};

new Phaser.Game(gameConfig);
