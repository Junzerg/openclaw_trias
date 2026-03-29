import Phaser from 'phaser';
import { soundManager } from '../SoundManager';
import { streamChunkBus } from '../../hooks/useWebSocket';
import type { Subscription } from 'rxjs';

export class ParliamentScene extends Phaser.Scene {
    private activeBubbles: Map<string, Phaser.GameObjects.Container> = new Map();
    private positions: { [key: string]: { x: number, y: number } } = {};

    // Stream state
    private streamSub?: Subscription;
    private streamedTexts: Map<string, string> = new Map();
    private displayTexts: Map<string, string> = new Map();
    private typeWriterTimers: Map<string, Phaser.Time.TimerEvent> = new Map();
    private streamLastSoundTime: Map<string, number> = new Map();

    constructor() {
        super('ParliamentScene');
    }

    create() {
        this.cameras.main.fadeIn(600, 0, 0, 0);
        const { width, height } = this.scale;

        // 1. Background (stretched to fill)
        const bg = this.add.image(width / 2, height / 2, 'bg_parliament');
        bg.setDisplaySize(width, height);

        // 2. Define virtual positions for factions (no sprites anymore)
        this.positions = {
            speaker: { x: width * 0.5, y: height * 0.3 },
            radical: { x: width * 0.25, y: height * 0.75 },
            conservative: { x: width * 0.75, y: height * 0.75 }
        };

        // 3. Spacebar & Debug hotkeys trigger
        if (this.input?.keyboard) {
            this.input.keyboard.on('keydown-SPACE', () => {
                soundManager.play('gavel');
            });
            
            // Debug actions for new features
            this.input.keyboard.on('keydown-P', () => {
                this.triggerPropose('radical', '【提案测试】这是一项激进的提案。请注意卷轴是否从下方成功飞入！');
            });
            
            this.input.keyboard.on('keydown-D', () => {
                this.triggerDebate('conservative', '【辩论测试】这非常荒谬！请注意我的发言框应该呈现浅蓝色。');
            });
            
            this.input.keyboard.on('keydown-B', () => {
                this.triggerBrawl(8); // Test max intensity brawl
            });
        }

        // 4. Subscribe to stream chunks for MPs
        this.streamSub = streamChunkBus.subscribe((event) => {
            const lowerAgent = event.agent.toLowerCase();
            console.log(`[ParliamentScene] Stream chunk from ${event.agent}: ${event.chunk}`);
            if (lowerAgent.includes('radical') || lowerAgent.includes('conservative')) {
                this.handleStreamChunk(event.agent, event.chunk);
            }
        });

        this.events.on('shutdown', () => {
            this.streamSub?.unsubscribe();
            this.streamSub = undefined;
            for (const timer of this.typeWriterTimers.values()) {
                timer.remove();
            }
            this.typeWriterTimers.clear();
        });
    }

    // ──────────────────────────────────────────────
    //  Helper: get string key for faction
    // ──────────────────────────────────────────────
    private getFactionKey(faction?: string): string {
        if (!faction) return 'conservative';
        if (faction.toLowerCase().includes('radical')) return 'radical';
        if (faction.toLowerCase().includes('conservative')) return 'conservative';
        return 'conservative';
    }

    // ──────────────────────────────────────────────
    //  Bubble View Factory
    // ──────────────────────────────────────────────
    private createEmptyBubble(factionKey: string, type: 'propose' | 'debate'): Phaser.GameObjects.Container {
        const pos = this.positions[factionKey];
        const x = pos.x;
        const y = pos.y - 120; // Offset upwards since there's no sprite

        const boxWidth = 320;
        const boxHeight = 300;
        const padding = 10;
        const innerWidth = boxWidth - padding * 2;

        const container = this.add.container(x, y).setDepth(100);

        let bgColor = 0xffffff;
        if (type === 'debate') {
            if (factionKey === 'radical') {
                bgColor = 0xfff0f0; // Radical: light red
            } else if (factionKey === 'conservative') {
                bgColor = 0xf0f0ff; // Conservative: light blue
            }
        }
        
        const bgGraphics = this.add.graphics();
        bgGraphics.fillStyle(bgColor, 0.95);
        bgGraphics.lineStyle(1, 0x000000, 0.2);
        bgGraphics.fillRoundedRect(-boxWidth / 2, -boxHeight, boxWidth, boxHeight, 8);
        bgGraphics.strokeRoundedRect(-boxWidth / 2, -boxHeight, boxWidth, boxHeight, 8);
        container.add(bgGraphics);

        const maskGraphics = this.make.graphics({});
        maskGraphics.fillRect(x - boxWidth / 2, y - boxHeight, boxWidth, boxHeight);
        const geometryMask = maskGraphics.createGeometryMask();

        // Note: we place textObj at index 1 or we can name it
        const textObj = this.add.text(-boxWidth / 2 + padding, -boxHeight + padding, '', {
            fontSize: '16px',
            color: '#000000',
            wordWrap: { width: innerWidth, useAdvancedWrap: true }
        });
        textObj.setName('textObj');
        textObj.setMask(geometryMask);
        container.add(textObj);

        // Invisible interactive zone over the container area
        const zone = this.add.zone(0, -boxHeight / 2, boxWidth, boxHeight)
            .setInteractive({ useHandCursor: true });
        container.add(zone);

        this.activeBubbles.set(factionKey, container);

        let isDragging = false;
        let startY = 0;
        let startTextY = 0;

        const clampScroll = () => {
            const textHeight = textObj.height;
            const maxScroll = -boxHeight + padding;
            const minScroll = textHeight <= boxHeight - padding * 2 
                ? maxScroll 
                : -boxHeight + padding - (textHeight - (boxHeight - padding * 2));

            textObj.y = Math.max(minScroll, Math.min(textObj.y, maxScroll));
        };

        // Attach clampScroll to container so we can call it from stream handler
        (container as Phaser.GameObjects.Container & { clampScroll?: () => void }).clampScroll = clampScroll;

        zone.on('wheel', (_pointer: Phaser.Input.Pointer, _deltaX: number, deltaY: number) => {
            textObj.y -= deltaY * 0.5;
            clampScroll();
        });

        zone.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
            isDragging = true;
            startY = pointer.y;
            startTextY = textObj.y;
        });

        zone.on('pointerup', () => { isDragging = false; });
        zone.on('pointerout', () => { isDragging = false; });

        zone.on('pointermove', (pointer: Phaser.Input.Pointer) => {
            if (isDragging) {
                const delta = pointer.y - startY;
                textObj.y = startTextY + delta;
                clampScroll();
            }
        });

        return container;
    }

    // ──────────────────────────────────────────────
    //  Stream Chunk Handler
    // ──────────────────────────────────────────────
    private handleStreamChunk(agent: string, chunk: string): void {
        const factionKey = this.getFactionKey(agent);
        
        if (!this.activeBubbles.has(factionKey)) {
            // New stream started
            this.streamedTexts.set(factionKey, '');
            this.displayTexts.set(factionKey, '');
            // default to debate type coloring for streaming, it's fine
            this.createEmptyBubble(factionKey, 'debate');
        }

        const container = this.activeBubbles.get(factionKey);
        if (!container) return;

        const textObj = container.getByName('textObj') as Phaser.GameObjects.Text;
        if (!textObj) return;

        // Append to tracked text
        let targetText = this.streamedTexts.get(factionKey) || '';
        targetText += chunk;
        this.streamedTexts.set(factionKey, targetText);

        // Ensure a typewriter update loop is running for this stream
        if (!this.typeWriterTimers.has(factionKey)) {
            const timer = this.time.addEvent({
                delay: 25,
                repeat: -1,
                callback: () => {
                    const target = this.streamedTexts.get(factionKey) || '';
                    let current = this.displayTexts.get(factionKey) || '';

                    if (current.length >= target.length) {
                        return; // waiting for more chunks or stream to end
                    }

                    const gap = target.length - current.length;
                    // Cap charsPerTick to make the animation feel like a typewriter instead of instantaneous
                    const charsPerTick = gap > 100 ? 5 : (gap > 20 ? 3 : 1);
                    current = target.substring(0, current.length + charsPerTick);
                    this.displayTexts.set(factionKey, current);

                    const MAX_CHARS_ON_SCREEN = 1500;
                    if (current.length > MAX_CHARS_ON_SCREEN) {
                        textObj.text = current.slice(-MAX_CHARS_ON_SCREEN);
                    } else {
                        textObj.text = current;
                    }

                    // Auto-scroll to bottom as text arrives
                    const boxHeight = 250; // Approximated inner height from createEmptyBubble
                    const padding = 16;
                    if (textObj.height > boxHeight - padding * 2) {
                        textObj.y = -boxHeight + padding - (textObj.height - (boxHeight - padding * 2));
                    }

                    const clampScroll = (container as Phaser.GameObjects.Container & { clampScroll?: () => void }).clampScroll;
                    if (clampScroll) clampScroll();

                    // Throttle typewriter sound for stream chunks
                    const now = Date.now();
                    const lastSound = this.streamLastSoundTime.get(factionKey) || 0;
                    if (now - lastSound > 60) {
                        soundManager.play('typewriter', { volume: 0.8 });
                        this.streamLastSoundTime.set(factionKey, now);
                    }
                }
            });
            this.typeWriterTimers.set(factionKey, timer);
        }
    }

    // ──────────────────────────────────────────────
    //  Typewriter text bubble (Fallback/Legacy Event)
    // ──────────────────────────────────────────────
    private showTextBubble(
        faction: string,
        text: string,
        type: 'propose' | 'debate',
        charDelay: number = 25
    ): Promise<void> {
        return new Promise((resolve) => {
            const factionKey = this.getFactionKey(faction);

            // Task 4.15: If we already streamed this prefix (ignoring whitespace), skip typewriter delay completely
            const streamed = this.streamedTexts.get(factionKey);
            const trimStr = (s?: string) => (s || '').replace(/\s/g, '');
            if (streamed && (trimStr(text) === trimStr(streamed) || trimStr(text).startsWith(trimStr(streamed)))) {
                // The stream is identical to our final result! Let the existing typewriter timer naturally finish.
                // We just need to wait (up to 7 seconds) for it to type out completely.
                let waitTicks = 0;
                const checkInterval = setInterval(() => {
                    const currentDisplay = this.displayTexts.get(factionKey) || '';
                    waitTicks++;
                    if (currentDisplay.length >= text.length || waitTicks * 100 > 7000) {
                        clearInterval(checkInterval);
                        
                        // Force final sync
                        this.typeWriterTimers.get(factionKey)?.remove();
                        this.typeWriterTimers.delete(factionKey);
                        const container = this.activeBubbles.get(factionKey);
                        if (container) {
                            const textObj = container.getByName('textObj') as Phaser.GameObjects.Text;
                            if (textObj) {
                                textObj.text = text.length > 800 ? text.slice(-800) : text;
                                const clampScroll = (container as Phaser.GameObjects.Container & { clampScroll?: () => void }).clampScroll;
                                if (clampScroll) clampScroll();
                            }
                        }
                        
                        // Cleanup
                        this.streamedTexts.delete(factionKey);
                        this.displayTexts.delete(factionKey);
                        resolve();
                    }
                }, 100);
                return;
            }

            // Normal fallback path — cleanup any existing
            if (this.activeBubbles.has(factionKey)) {
                this.activeBubbles.get(factionKey)?.destroy();
                this.activeBubbles.delete(factionKey);
                this.streamedTexts.delete(factionKey);
                this.displayTexts.delete(factionKey);
                this.typeWriterTimers.get(factionKey)?.remove();
                this.typeWriterTimers.delete(factionKey);
            }

            const container = this.createEmptyBubble(factionKey, type);
            const textObj = container.getByName('textObj') as Phaser.GameObjects.Text;
            const clampScroll = (container as Phaser.GameObjects.Container & { clampScroll?: () => void }).clampScroll;

            const textLength = text.length;
            let currentLength = 0;
            const MAX_CHARS_ON_SCREEN = 800;

            const timer = this.time.addEvent({
                callback: () => {
                    const gap = textLength - currentLength;
                    if (gap <= 0) {
                        timer.remove();
                        return;
                    }
                    // Adaptive jump to match React details panel speed (up to 120chars/s)
                    const charsPerTick = gap > 100 ? 4 : (gap > 20 ? 2 : 1);
                    currentLength = Math.min(currentLength + charsPerTick, textLength);
                    
                    const currentText = text.substring(0, currentLength);
                    if (currentLength > MAX_CHARS_ON_SCREEN) {
                        textObj.text = currentText.slice(-MAX_CHARS_ON_SCREEN);
                    } else {
                        textObj.text = currentText;
                    }
                    
                    if (clampScroll) clampScroll();
                    
                    // Throttle sound play so it doesn't sound glitched out
                    if (currentLength % (charsPerTick * 2) < charsPerTick) {
                         soundManager.play('typewriter', { volume: 0.8 });
                    }
                },
                repeat: -1,
                delay: charDelay
            });

            // Calculate approximate total time to wait before resolving
            // If length is large (>100), mostly it jumps by 4.
            const estimatedTicks = textLength / 3; 
            this.time.delayedCall(estimatedTicks * charDelay + 200, resolve);
        });
    }

    // ──────────────────────────────────────────────
    //  Projectile system (shoe / coffee cup)
    // ──────────────────────────────────────────────
    private launchProjectile(fromFaction: string, toFaction: string) {
        const fromPos = this.positions[fromFaction];
        const toPos = this.positions[toFaction];

        // Pick random projectile type: frame 0 = shoe, frame 1 = coffee cup
        const frame = Phaser.Math.Between(0, 1);
        const projectile = this.physics.add.sprite(fromPos.x, fromPos.y - 30, 'prop_projectiles', frame);
        projectile.setScale(0.12);
        projectile.setDepth(90);

        // Calculate velocity for parabolic arc (gravity is y:300 from config)
        const dx = toPos.x - fromPos.x;
        const vx = dx * 1.2;  // horizontal speed
        const vy = -250;      // upward launch

        projectile.setVelocity(vx, vy);

        // Spin while flying
        this.tweens.add({
            targets: projectile,
            angle: 360 * (dx > 0 ? 1 : -1),
            duration: 800,
            repeat: -1
        });

        // Use invisible zone instead of sprite for overlap
        const targetZone = this.add.zone(toPos.x, toPos.y - 60, 100, 100);
        this.physics.add.existing(targetZone);

        // Overlap detection with target
        this.physics.add.overlap(projectile, targetZone, () => {
            // Guard: only trigger once
            if (!projectile.body) return;
            projectile.body.enable = false;

            soundManager.play('hit', { volume: 0.6 });

            // Destroy projectile with a quick pop
            this.tweens.add({
                targets: projectile,
                scale: 0,
                alpha: 0,
                duration: 150,
                onComplete: () => {
                    projectile.destroy();
                    targetZone.destroy();
                }
            });
        });

        // Auto-destroy if it falls off screen
        this.time.delayedCall(3000, () => {
            if (projectile.active) projectile.destroy();
            if (targetZone.active) targetZone.destroy();
        });
    }

    // ──────────────────────────────────────────────
    //  Public API: triggerPropose
    // ──────────────────────────────────────────────
    public async triggerPropose(faction: string, text: string): Promise<void> {
        console.log(`[ParliamentScene] Propose from ${faction}: ${text}`);
        const factionKey = this.getFactionKey(faction);
        const pos = this.positions[factionKey];
        
        // Scroll fly-in animation
        const scroll = this.add.sprite(this.scale.width / 2, this.scale.height + 50, 'prop_bill');
        scroll.setDepth(150);
        
        // Dynamically size the scroll so it's not gigantic
        const billSize = Math.max(120 * (this.scale.width / 800), 80);
        scroll.setDisplaySize(billSize, billSize);

        await new Promise<void>((resolve) => {
            this.tweens.add({
                targets: scroll,
                x: pos.x,
                y: pos.y - 20,
                duration: 600,
                ease: 'Power2',
                onComplete: () => {
                    scroll.destroy();
                    resolve();
                }
            });
        });

        await this.showTextBubble(faction, text, 'propose');
    }

    // ──────────────────────────────────────────────
    //  Public API: triggerDebate
    // ──────────────────────────────────────────────
    public async triggerDebate(faction: string, text: string): Promise<void> {
        console.log(`[ParliamentScene] Debate from ${faction}: ${text}`);
        await this.showTextBubble(faction, text, 'debate');
    }

    // ──────────────────────────────────────────────
    //  Public API: triggerBrawl with intensity grading
    // ──────────────────────────────────────────────
    public async triggerBrawl(intensity: number): Promise<void> {
        console.log(`[ParliamentScene] BRAWL! Intensity: ${intensity}`);

        if (intensity < 5) {
            // ── Mild conflict (Lv1): rapid overlapping dialogue ──
            await this.triggerMildConflict();
        } else {
            // ── Physical conflict (Lv2-3): projectiles + shake ──
            await this.triggerPhysicalConflict(intensity);
        }
    }

    private async triggerMildConflict(): Promise<void> {
        soundManager.play('murmur');
        // Rapid overlapping speech bubbles with faster typewriter
        const insults = ['不像话！', '荒谬！', '反对！', '胡说八道！'];
        const radicalInsults = ['守旧！', '阻碍进步！', '老古板！'];

        // Conservative fires rapid text
        const cText = insults[Phaser.Math.Between(0, insults.length - 1)];
        this.showTextBubble('conservative', cText, 'debate', 15);

        // Radical fires back after short delay
        this.time.delayedCall(300, () => {
            const rText = radicalInsults[Phaser.Math.Between(0, radicalInsults.length - 1)];
            this.showTextBubble('radical', rText, 'debate', 15);
        });

        // Mild shake
        this.cameras.main.shake(150, 0.003);

        await new Promise(res => this.time.delayedCall(2500, res));
    }

    private async triggerPhysicalConflict(intensity: number): Promise<void> {
        soundManager.play('murmur');

        if (intensity >= 8) {
            // Highest severity: Speaker slacks hammer 3 times with heavy shakes
            for (let i = 0; i < 3; i++) {
                this.time.delayedCall(i * 400, () => {
                    soundManager.play('gavel');
                    this.cameras.main.shake(200, 0.05); // High intensity shake
                });
            }
        }

        // Strong camera shake
        const shakeIntensity = Math.min(intensity * 0.005, 0.04);
        this.cameras.main.shake(500, shakeIntensity);

        // Launch 1-3 projectiles based on intensity
        const numProjectiles = Math.min(Math.ceil(intensity / 4), 3);
        for (let i = 0; i < numProjectiles; i++) {
            this.time.delayedCall(i * 400, () => {
                // Alternate direction
                if (i % 2 === 0) {
                    this.launchProjectile('radical', 'conservative');
                } else {
                    this.launchProjectile('conservative', 'radical');
                }
            });
        }

        await new Promise(resolve => this.time.delayedCall(2500, resolve));
    }

    // ──────────────────────────────────────────────
    //  Public API: triggerOrder (Speaker intervenes)
    // ──────────────────────────────────────────────
    public triggerOrder(): Promise<void> {
        return new Promise(resolve => {
            console.log(`[ParliamentScene] 肃静！`);
            
            soundManager.play('gavel');

            // Big camera shake
            this.cameras.main.shake(400, 0.025);

            // Giant "肃静！" text overlay
            const orderText = this.add.text(this.scale.width / 2, this.scale.height / 2, '肃静！', {
                fontSize: '72px',
                color: '#ff0000',
                fontStyle: 'bold',
                stroke: '#000000',
                strokeThickness: 8
            }).setOrigin(0.5).setDepth(200).setAlpha(0);

            this.tweens.add({
                targets: orderText,
                alpha: 1,
                scale: { from: 0.3, to: 1.5 },
                duration: 250,
                yoyo: true,
                hold: 1200,
                onComplete: () => orderText.destroy()
            });

            // Gavel impact flash effect
            const flash = this.add.rectangle(
                this.scale.width / 2, this.scale.height / 2,
                this.scale.width, this.scale.height,
                0xffffff, 0.4
            ).setDepth(199);

            this.tweens.add({
                targets: flash,
                alpha: 0,
                duration: 300,
                onComplete: () => flash.destroy()
            });
            
            this.time.delayedCall(1500, resolve);
        });
    }

    // ──────────────────────────────────────────────
    //  Public API: triggerVotePassed
    // ──────────────────────────────────────────────
    public triggerVotePassed(): Promise<void> {
        return new Promise(resolve => {
            console.log(`[ParliamentScene] 表决通过！`);
            
            soundManager.play('gavel');

            // Green overlay
            const overlay = this.add.rectangle(
                0, 0, this.scale.width, this.scale.height, 0x00ff00, 0.15
            ).setOrigin(0).setDepth(150);

            // "表决通过！" text
            const passedText = this.add.text(
                this.scale.width / 2, this.scale.height / 2 - 60, '表决通过！',
                {
                    fontSize: '56px',
                    color: '#00ff00',
                    fontStyle: 'bold',
                    stroke: '#000000',
                    strokeThickness: 6
                }
            ).setOrigin(0.5).setDepth(200).setScale(2).setAlpha(0);

            this.tweens.add({
                targets: passedText,
                alpha: 1,
                scale: 1,
                duration: 500,
                ease: 'Bounce'
            });

            // Stamp image (centered, bounce in) — frame 0=VETO, frame 1=APPROVED
            const stamp = this.add.sprite(
                this.scale.width / 2, this.scale.height / 2 + 60, 'ui_stamps', 1
            ).setScale(0).setDepth(201).setAlpha(0);

            this.time.delayedCall(800, () => {
                this.tweens.add({
                    targets: stamp,
                    scale: 0.2,
                    alpha: 1,
                    duration: 300,
                    ease: 'Back.easeOut'
                });
            });

            // Transition handling delegated to SceneManager over global events via web sockets
            this.time.delayedCall(2000, () => {
                this.tweens.add({
                    targets: [passedText, stamp, overlay],
                    alpha: 0,
                    duration: 500,
                    onComplete: () => {
                        overlay.destroy();
                        passedText.destroy();
                        stamp.destroy();
                    }
                });
                // Note: we don't start the scene here anymore, the orchestrator/ws-manager handles state flow
                resolve();
            });
        });
    }
}
