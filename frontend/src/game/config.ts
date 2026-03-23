import Phaser from 'phaser';
import { PreloaderScene } from './scenes/PreloaderScene';
import { ParliamentScene } from './scenes/ParliamentScene';
import { ExecutiveScene } from './scenes/ExecutiveScene';
import { JudicialScene } from './scenes/JudicialScene';

export const GameConfig: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    width: 800,
    height: 600,
    parent: 'game-container',
    backgroundColor: '#000000',
    pixelArt: true, // Crucial for pixel-perfect SNES retro aesthetics
    antialias: false,
    roundPixels: true,
    physics: {
        default: 'arcade',
        arcade: {
            gravity: { y: 300, x: 0 },
            debug: false
        }
    },
    scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH
    },
    scene: [PreloaderScene, ParliamentScene, ExecutiveScene, JudicialScene]
};
