import { BaseScene } from './BaseScene';
import Phaser from 'phaser';
import { soundManager } from '../SoundManager';

export class ExecutiveScene extends BaseScene {
  private president!: Phaser.GameObjects.Sprite;
  private secretary!: Phaser.GameObjects.Sprite;
  private bill!: Phaser.GameObjects.Sprite;
  private particleEmitter?: Phaser.GameObjects.Particles.ParticleEmitter;

  constructor() {
    super('ExecutiveScene');
  }

  create() {
    super.create();
    this.cameras.main.fadeIn(300, 0, 0, 0);
    
    // Background
    this.add.image(400, 300, 'bg_executive');
    
    this.add.text(400, 50, '[ 行政签署厅 ]', {
      fontSize: '24px',
      color: '#00ccff',
      backgroundColor: '#000000',
      padding: { x: 10, y: 5 }
    }).setOrigin(0.5);
    
    // Characters
    // President sprite sheet is 205x380
    this.president = this.add.sprite(180, 400, 'mp_president').setOrigin(0.5);
    this.president.play('president_idle');

    // Secretary sprite sheet is 147x192
    this.secretary = this.add.sprite(650, 450, 'mp_secretary').setOrigin(0.5);
    this.secretary.play('secretary_idle');

    // Bill prop (hidden initially)
    this.bill = this.add.sprite(180, 480, 'prop_bill').setOrigin(0.5).setDisplaySize(64, 64);
    this.bill.setVisible(false);

    // Generate smoke particle texture
    const g = this.add.graphics();
    g.fillStyle(0xffffff, 1);
    g.fillRect(0, 0, 8, 8);
    g.generateTexture('smoke_particle', 8, 8);
    g.destroy();
  }

  public triggerSign(actName: string): Promise<void> {
    return new Promise(resolve => {
      this.showNotification(`总统签署: ${actName}`);
      this.president.play('president_sign');
      
      // Show 批准 stamp
      const stamp = this.add.text(180, 440, '批准', {
        fontSize: '32px', color: '#00ff00', fontStyle: 'bold', backgroundColor: '#003300'
      }).setOrigin(0.5).setAlpha(0).setScale(2);
      
      soundManager.play('gavel');

      this.tweens.add({
        targets: stamp,
        alpha: 1,
        scale: 1,
        duration: 300,
        ease: 'Bounce.easeOut',
        onComplete: () => {
          this.time.delayedCall(1000, () => stamp.destroy());
          this.rollBillToSecretary();
        }
      });

      this.time.delayedCall(1000, () => {
        this.president.play('president_idle');
        resolve();
      });
    });
  }

  private rollBillToSecretary() {
    this.bill.setPosition(180, 480);
    this.bill.setVisible(true);
    this.tweens.add({
      targets: this.bill,
      x: 600,
      duration: 800,
      ease: 'Power1',
      onComplete: () => {
        this.secretary.play('secretary_type');
        // Output a rapid burst of typewriter sound
        this.time.addEvent({ delay: 60, callback: () => soundManager.play('typewriter', { volume: 1.0 }), repeat: 10 });
      }
    });
  }

  public triggerVeto(): Promise<void> {
    return new Promise(resolve => {
      this.showNotification(`总统否决！`);
      this.president.play('president_sign');

      soundManager.play('alert');

      // Red Stamp
      const stamp = this.add.text(180, 440, '否决', {
        fontSize: '48px', color: '#ff0000', fontStyle: 'bold', backgroundColor: '#550000'
      }).setOrigin(0.5).setAlpha(0).setScale(3);
      
      this.tweens.add({
        targets: stamp,
        alpha: 1,
        scale: 1,
        duration: 200,
        onComplete: () => {
          this.cameras.main.shake(300, 0.015);
          this.time.delayedCall(1000, () => stamp.destroy());
          
          // Roll bill backward
          this.bill.setPosition(180, 480);
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
        this.president.play('president_idle');
        resolve();
      });
    });
  }

  public triggerToolCall(logs: string): Promise<void> {
    return new Promise(resolve => {
      this.showNotification(`正在执行指令…`);
      this.secretary.play('secretary_type');

      // Continuous typing sound for the duration of the waterfall
      const typeTimer = this.time.addEvent({
          delay: 80,
          callback: () => soundManager.play('typewriter', { volume: 1.0 }),
          loop: true
      });

      // Code waterfall CLI log
      const logText = this.add.text(650, 400, logs, {
        fontSize: '14px', color: '#00ff00', fontFamily: 'monospace', align: 'left', wordWrap: { width: 250 }, backgroundColor: '#000000'
      }).setOrigin(0.5).setAlpha(0.8);

      this.tweens.add({
        targets: logText,
        y: logText.y - 150,
        alpha: 0,
        duration: 2500,
        ease: 'Linear',
        onComplete: () => {
          logText.destroy();
          typeTimer.remove(); // Clear timer
          resolve();
        }
      });
    });
  }

  public triggerError(): Promise<void> {
    return new Promise(resolve => {
      this.showNotification(`执行异常！`);
      this.secretary.setTint(0xff5555);
      this.secretary.play('secretary_burn');
      
      soundManager.play('alert');

      if (!this.particleEmitter) {
        this.particleEmitter = this.add.particles(this.secretary.x, this.secretary.y - 50, 'smoke_particle', {
          tint: [0x222222, 0x444444, 0x777777],
          speed: { min: 20, max: 60 },
          angle: { min: 250, max: 290 },
          scale: { start: 1, end: 0.1 },
          alpha: { start: 0.8, end: 0 },
          lifespan: 2000,
          frequency: 80,
          blendMode: 'NORMAL'
        });
      } else {
        this.particleEmitter.start();
      }

      this.time.delayedCall(2500, () => {
        if (this.particleEmitter) this.particleEmitter.stop();
        this.secretary.clearTint();
        this.secretary.play('secretary_idle');
        resolve();
      });
    });
  }
}
