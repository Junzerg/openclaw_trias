import { BaseScene } from './BaseScene';
import Phaser from 'phaser';
import { soundManager } from '../SoundManager';
import { wsEventBus } from '../../hooks/useWebSocket';
import type { Subscription } from 'rxjs';

export class ExecutiveScene extends BaseScene {
  private bill!: Phaser.GameObjects.Sprite;

  // Task 4.14: Cyber terminal for real-time LLM streaming
  private terminalBg!: Phaser.GameObjects.Rectangle;
  private terminalText!: Phaser.GameObjects.Text;
  private terminalLabel!: Phaser.GameObjects.Text;
  private terminalContent: string = '';
  private streamSub?: Subscription;
  private terminalVisible: boolean = false;
  private readonly TERMINAL_MAX_LINES = 18;
  private readonly TERMINAL_MAX_CHARS = 2000;

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

    // ── Task 4.14: Create cyber terminal overlay ──────────────────
    this.createCyberTerminal();
    this.subscribeToThinkingEvents();

    // Clean up subscription when scene shuts down
    this.events.on('shutdown', () => {
      this.streamSub?.unsubscribe();
      this.streamSub = undefined;
      this.terminalVisible = false;
      this.terminalContent = '';
    });

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

  /**
   * Task 4.14: Create the cyber terminal UI elements (hidden by default).
   */
  private createCyberTerminal(): void {
    const { width, height } = this.scale;
    const termW = Math.min(width * 0.85, 620);
    const termH = Math.min(height * 0.55, 320);
    const termX = width / 2;
    const termY = height * 0.52;

    // Semi-transparent dark background
    this.terminalBg = this.add.rectangle(termX, termY, termW, termH, 0x000000, 0.85)
      .setStrokeStyle(1, 0x00ff88, 0.6)
      .setOrigin(0.5)
      .setVisible(false)
      .setDepth(50);

    // Header label
    this.terminalLabel = this.add.text(termX - termW / 2 + 10, termY - termH / 2 + 4, '▶ LLM GENERATING...', {
      fontSize: '10px',
      color: '#00ff88',
      fontFamily: 'monospace',
      backgroundColor: 'rgba(0,0,0,0)',
    }).setOrigin(0, 0).setVisible(false).setDepth(51);

    // Scrolling content
    this.terminalText = this.add.text(termX - termW / 2 + 10, termY - termH / 2 + 18, '', {
      fontSize: '11px',
      color: '#00ff44',
      fontFamily: 'monospace',
      wordWrap: { width: termW - 20, useAdvancedWrap: true },
      lineSpacing: 2,
    }).setOrigin(0, 0).setVisible(false).setDepth(51);
  }

  /**
   * Listen to LLM_THINKING events to show the terminal during the 2-minute backend block.
   */
  private subscribeToThinkingEvents(): void {
    this.streamSub = wsEventBus.subscribe((event) => {
      if (event.action !== 'llm_thinking') return;
      
      // Ignore events not from executive branch
      const lowerAgent = String(event.source_agent || '').toLowerCase();
      if (!lowerAgent.includes('sec') && !lowerAgent.includes('executive') && !lowerAgent.includes('president') && !lowerAgent.includes('engineering') && !lowerAgent.includes('state')) {
        return;
      }

      if (!this.terminalVisible) {
        this.showCyberTerminal();
      }

      const reqPayload = (event.payload as Record<string, unknown>) || {};
      const elapsed = reqPayload.elapsed_seconds || 0;
      
      this.terminalContent = `[SYSTEM] Generative process allocated...\n[WARNING] Bypassing local safety lockouts...\n[STATUS] Neural synthesis in progress...\n\n> Calculating tensors: ${elapsed}s...\n`;
      this._updateTerminalView();
    });
  }

  private _updateTerminalView(): void {
      // Truncate to prevent memory issues
      if (this.terminalContent.length > this.TERMINAL_MAX_CHARS) {
        this.terminalContent = this.terminalContent.slice(-this.TERMINAL_MAX_CHARS);
      }

      // Keep only the last N lines
      const lines = this.terminalContent.split('\n');
      if (lines.length > this.TERMINAL_MAX_LINES) {
        this.terminalContent = lines.slice(-this.TERMINAL_MAX_LINES).join('\n');
      }

      // Update the Phaser Text object directly
      if (this.terminalText?.active) {
        this.terminalText.setText(this.terminalContent);
      }
  }

  private showCyberTerminal(): void {
    const targets = [this.terminalBg, this.terminalLabel, this.terminalText].filter(Boolean);
    if (targets.length > 0) {
      this.tweens.killTweensOf(targets);
    }

    this.terminalVisible = true;
    this.terminalContent = '';
    this.terminalBg?.setVisible(true);
    this.terminalLabel?.setVisible(true);
    this.terminalText?.setVisible(true).setText('');

    // Fade in
    if (this.terminalBg) {
      this.terminalBg.setAlpha(0);
      this.tweens.add({ targets: this.terminalBg, alpha: 1, duration: 300 });
    }
    if (this.terminalLabel) {
      this.terminalLabel.setAlpha(0);
      this.tweens.add({ targets: this.terminalLabel, alpha: 1, duration: 300 });
    }
    if (this.terminalText) {
      this.terminalText.setAlpha(0);
      this.tweens.add({ targets: this.terminalText, alpha: 1, duration: 300 });
    }

    // Typing sound loop
    this.time.addEvent({
      delay: 120,
      callback: () => {
        if (this.terminalVisible) {
          soundManager.play('typewriter', { volume: 0.3 });
        }
      },
      loop: true,
      callbackScope: this,
    });
  }

  private hideCyberTerminal(): void {
    const targets = [this.terminalBg, this.terminalLabel, this.terminalText].filter(Boolean);
    if (targets.length > 0) {
      this.tweens.killTweensOf(targets);
    }

    this.terminalVisible = false;

    if (targets.length > 0) {
      this.tweens.add({
        targets,
        alpha: 0,
        duration: 500,
        onComplete: () => {
          if (!this.terminalVisible) {
            this.terminalBg?.setVisible(false);
            this.terminalLabel?.setVisible(false);
            this.terminalText?.setVisible(false);
            this.terminalContent = '';
          }
        },
      });
    }
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
      // Hide terminal as thinking is finished
      if (this.terminalVisible) {
        this.hideCyberTerminal();
      }

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
          }).setOrigin(0.5).setAlpha(0).setDepth(100);

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
