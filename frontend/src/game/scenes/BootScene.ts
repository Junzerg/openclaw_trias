import Phaser from 'phaser';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  preload() {
    // In Phase 3-B, you will load sprites here
    // this.load.image('parliament_bg', 'assets/backgrounds/parliament.png');
    this.add.text(400, 300, 'Loading OpenClaw Cyber Trias...', {
      fontSize: '24px',
      color: '#fff'
    }).setOrigin(0.5);
  }

  create() {
    // Start with ParliamentScene as default
    this.scene.start('ParliamentScene');
  }
}
