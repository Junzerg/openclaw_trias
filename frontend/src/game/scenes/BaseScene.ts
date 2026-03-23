import Phaser from 'phaser';

export class BaseScene extends Phaser.Scene {
  protected loadingText!: Phaser.GameObjects.Text;

  constructor(key: string) {
    super(key);
  }

  create() {
    this.createBackground();
    this.setupCamera();
  }

  protected createBackground() {
    // Override this in child classes to load specific backgrounds.
    // Placeholder background:
    this.add.rectangle(400, 300, 800, 600, 0x222233);
  }

  protected setupCamera() {
    this.cameras.main.fadeIn(500, 0, 0, 0);
  }

  // Common UI overlay across scenes
  public showNotification(message: string) {
    const text = this.add.text(400, 50, message, {
      fontFamily: '"Press Start 2P", fallback',
      fontSize: '16px',
      color: '#ffffff',
      backgroundColor: '#000000'
    }).setOrigin(0.5).setAlpha(0);

    this.tweens.add({
      targets: text,
      alpha: 1,
      y: 80,
      duration: 300,
      yoyo: true,
      hold: 2000,
      onComplete: () => text.destroy()
    });
  }
}
