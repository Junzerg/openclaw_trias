import { BaseScene } from './BaseScene';
import Phaser from 'phaser';
import { soundManager } from '../SoundManager';

export class ExecutiveScene extends BaseScene {
  private bill!: Phaser.GameObjects.Sprite;

  constructor() {
    super('ExecutiveScene');
  }

  create() {
    super.create();
    this.cameras.main.fadeIn(600, 0, 0, 0);
    const { width, height } = this.scale;
    
    // Background
    const bg = this.add.image(width / 2, height / 2, 'bg_executive');
    bg.setDisplaySize(width, height);
    
    this.add.text(width / 2, height * 0.08, '[ 行政签署厅 ]', {
      fontSize: '24px',
      color: '#00ccff',
      backgroundColor: '#000000',
      padding: { x: 10, y: 5 }
    }).setOrigin(0.5);

    // Bill prop (hidden initially)
    this.bill = this.add.sprite(width * 0.5, height * 0.61, 'prop_bill').setOrigin(0.5).setDisplaySize(Math.max(96 * (width/800), 48), Math.max(96 * (width/800), 48));
    this.bill.setVisible(false);

    // Generate smoke particle texture
    const g = this.add.graphics();
    g.fillStyle(0xffffff, 1);
    g.fillRect(0, 0, 8, 8);
    g.generateTexture('smoke_particle', 8, 8);
    g.destroy();

    // Test shortcuts
    this.input.keyboard?.on('keydown-T', () => {
      this.triggerToolCall('Checking system status...\nFound 3 anomalies.\nResolving node config.\nWait...\nProcess finished with exit code 0.');
    });
    this.input.keyboard?.on('keydown-S', () => {
      this.triggerSign('Test Act');
    });
    this.input.keyboard?.on('keydown-V', () => {
      this.triggerVeto();
    });
    this.input.keyboard?.on('keydown-E', () => {
      this.triggerError();
    });
  }

  public triggerSign(actName: string): Promise<void> {
    const { width, height } = this.scale;
    return new Promise(resolve => {
      this.showNotification(`总统签署: ${actName}`);
      
      // Show 批准 stamp
      const tempScale = Math.max(width/800, 0.5);
      const finalStampScale = tempScale * 0.5;
      const stamp = this.add.sprite(width * 0.5, height * 0.61, 'ui_stamps', 1)
        .setOrigin(0.5).setAlpha(0).setScale(finalStampScale * 4);
      
      soundManager.play('gavel');

      this.tweens.add({
        targets: stamp,
        alpha: 1,
        scale: finalStampScale,
        duration: 300,
        ease: 'Bounce.easeOut',
        onComplete: () => {
          this.time.delayedCall(1000, () => stamp.destroy());
          this.rollBillToSecretary();
        }
      });

      this.time.delayedCall(1000, () => {
        resolve();
      });
    });
  }

  private rollBillToSecretary() {
    const { width, height } = this.scale;
    this.bill.setPosition(width * 0.5, height * 0.61);
    this.bill.setVisible(true);
    this.tweens.add({
      targets: this.bill,
      x: width * 0.8,
      y: height * 0.8,
      alpha: 0,
      duration: 800,
      ease: 'Power1',
      onComplete: () => {
        this.bill.setVisible(false);
        this.bill.setAlpha(1);
        // Output a rapid burst of typewriter sound
        this.time.addEvent({ delay: 60, callback: () => soundManager.play('typewriter', { volume: 1.0 }), repeat: 10 });
      }
    });
  }

  public triggerVeto(): Promise<void> {
    const { width, height } = this.scale;
    return new Promise(resolve => {
      this.showNotification(`总统否决！`);

      soundManager.play('alert');

      // Red Stamp
      const tempScale = Math.max(width/800, 0.5);
      const finalStampScale = tempScale * 0.5;
      const stamp = this.add.sprite(width * 0.5, height * 0.61, 'ui_stamps', 0)
        .setOrigin(0.5).setAlpha(0).setScale(finalStampScale * 5);
      
      this.tweens.add({
        targets: stamp,
        alpha: 1,
        scale: finalStampScale,
        duration: 200,
        onComplete: () => {
          this.cameras.main.shake(300, 0.015);
          
          const redOverlay = this.add.rectangle(0, 0, width, height, 0xff0000, 0.3).setOrigin(0);
          this.tweens.add({
              targets: redOverlay,
              alpha: 0,
              duration: 500,
              onComplete: () => redOverlay.destroy()
          });

          this.time.delayedCall(1000, () => stamp.destroy());
          
          // Roll bill backward
          this.bill.setPosition(width * 0.5, height * 0.61);
          this.bill.setVisible(true);
          this.tweens.add({
            targets: this.bill,
            x: -100,
            duration: 1000,
            onComplete: () => this.bill.setVisible(false)
          });
        }
      });

      this.time.delayedCall(1500, () => {
        resolve();
      });
    });
  }

  public triggerToolCall(logs: string): Promise<void> {
    const { width, height } = this.scale;
    return new Promise(resolve => {
      this.showNotification(`正在执行指令…`);

      // Continuous typing sound for the duration of the waterfall
      const typeTimer = this.time.addEvent({
          delay: 80,
          callback: () => soundManager.play('typewriter', { volume: 1.0 }),
          loop: true
      });

      // Code waterfall CLI log
      const logLines = logs.split('\n').filter(l => l.trim().length > 0).slice(0, 8);
      let completed = 0;
      let delay = 0;

      if (logLines.length === 0) {
        typeTimer.remove();
        return resolve();
      }

      logLines.forEach((line, index) => {
        this.time.delayedCall(delay, () => {
          const logText = this.add.text(width * 0.5, height * 0.45 + index * 20, line, {
            fontSize: '12px', color: '#00ff00', fontFamily: 'monospace', align: 'left', padding: { x: 4, y: 2 }, wordWrap: { width: Math.min(width * 0.4, 300) }, backgroundColor: 'rgba(0,0,0,0.8)'
          }).setOrigin(0.5).setAlpha(0);

          this.tweens.add({
            targets: logText,
            y: logText.y - height * 0.1,
            alpha: 1,
            duration: 300,
            ease: 'Power2',
            onComplete: () => {
              this.time.delayedCall(1200, () => {
                this.tweens.add({
                  targets: logText,
                  alpha: 0,
                  y: logText.y - height * 0.05,
                  duration: 500,
                  onComplete: () => {
                    logText.destroy();
                    completed++;
                    if (completed === logLines.length) {
                      typeTimer.remove();
                      resolve();
                    }
                  }
                });
              });
            }
          });
        });
        delay += 200;
      });
    });
  }

  public triggerError(): Promise<void> {
    const { width, height } = this.scale;
    return new Promise(resolve => {
      this.showNotification(`执行异常！`);
      
      this.cameras.main.shake(500, 0.015);
      const redOverlay = this.add.rectangle(0, 0, width, height, 0xff0000, 0.3).setOrigin(0).setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({
          targets: redOverlay,
          alpha: 0,
          yoyo: true,
          repeat: 3,
          duration: 300,
          onComplete: () => redOverlay.destroy()
      });

      soundManager.play('alert');

      this.time.delayedCall(2500, () => {
        resolve();
      });
    });
  }
}
