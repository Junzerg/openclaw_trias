import type { WSEventPayload } from '../types/backend';
import { SceneManager } from './SceneManager';
import { ParliamentScene } from './scenes/ParliamentScene';
import { ExecutiveScene } from './scenes/ExecutiveScene';
import { JudicialScene } from './scenes/JudicialScene';

export class EventMapper {
  private sceneManager: SceneManager;
  private eventQueue: WSEventPayload[] = [];
  private isProcessing: boolean = false;

  constructor(sceneManager: SceneManager) {
    this.sceneManager = sceneManager;
  }

  public handleEvent(event: WSEventPayload) {
    this.eventQueue.push(event);
    if (!this.isProcessing) {
        this.processQueue();
    }
  }

  private async processQueue() {
    if (this.eventQueue.length === 0) {
        this.isProcessing = false;
        return;
    }

    this.isProcessing = true;
    const event = this.eventQueue.shift()!;
    
    const activeScene = this.sceneManager.getActiveScene();
    if (!activeScene) {
        // If no scene, skip but continue processing
        console.warn(`[EventMapper] No active scene. Skipping event ${event.action}.`);
        this.processQueue();
        return;
    }

    console.log(`[EventMapper] Routing ${event.action} to ${activeScene.scene.key}. Queue length: ${this.eventQueue.length}`);

    try {
        // Use a timeout race to prevent stuck animations from halting the queue permanently
        const timeoutPromise = new Promise<void>((_, reject) => setTimeout(() => reject(new Error('Animation Timeout')), 8000));
        
        let actionPromise: Promise<void> | void = undefined;

        if (event.action === 'state_change') {
            // Read state from either data.state or payload.state depending on backend shape
            const state = (event as Record<string, unknown>).state 
                || event.data?.state 
                || ((event as Record<string, unknown>).payload as Record<string, unknown> | undefined)?.state;
            if (state) {
                let targetScene = '';
                if (state === 'debating' || state === 'voted') targetScene = 'Parliament';
                else if (state === 'executing' || state === 'signed') targetScene = 'Executive';
                else if (state === 'reviewing' || state === 'constitutional' || state === 'unconstitutional') targetScene = 'Judicial';
                
                if (targetScene) {
                    this.sceneManager.switchTo(targetScene);
                    actionPromise = new Promise(r => setTimeout(r, 1000));
                }
            }
        }
        // ─── Parliament Scene events ───
        else if (event.action === 'propose' || event.action === 'debate' || event.action === 'brawl' || event.action === 'order' || event.action === 'vote_passed') {
            // Ensure we're on Parliament
            if (activeScene.scene.key !== 'ParliamentScene') {
                this.sceneManager.switchTo('Parliament');
                await new Promise(r => setTimeout(r, 800));
            }
            const scene = this.sceneManager.getActiveScene() as ParliamentScene;
            if (!scene) { this.processQueue(); return; }
            
            const anyEvent = event as Record<string, unknown>;
            if (event.action === 'brawl') {
                actionPromise = scene.triggerBrawl((anyEvent.intensity as number) || 5);
            } else if (event.action === 'propose') {
                const agent = (anyEvent.source_agent as string) || 'unknown';
                const text = (anyEvent.statement as string) || '';
                if (text.length > 0) {
                    actionPromise = scene.triggerPropose(agent, text);
                }
            } else if (event.action === 'debate') {
                const agent = (anyEvent.source_agent as string) || 'unknown';
                const text = (anyEvent.statement as string) || '';
                if (text.length > 0) {
                    actionPromise = scene.triggerDebate(agent, text);
                }
            } else if (event.action === 'order') {
                actionPromise = scene.triggerOrder();
            } else if (event.action === 'vote_passed') {
                actionPromise = scene.triggerVotePassed();
            }
        }
        // ─── Executive Scene events ───
        else if (event.action === 'sign_act' || event.action === 'sign' || event.action === 'tool_call' || event.action === 'veto' || event.action === 'error') {
            if (activeScene.scene.key !== 'ExecutiveScene') {
                this.sceneManager.switchTo('Executive');
                await new Promise(r => setTimeout(r, 800));
            }
            const scene = this.sceneManager.getActiveScene() as ExecutiveScene;
            if (!scene) { this.processQueue(); return; }
            
            if (event.action === 'sign_act' || event.action === 'sign') {
                actionPromise = scene.triggerSign(event.data?.act_name || 'Act');
            } else if (event.action === 'veto') {
                actionPromise = scene.triggerVeto();
            } else if (event.action === 'tool_call') {
                const anyEvent = event as Record<string, unknown>;
                const toolName = (anyEvent.tool_name as string) || 'Tool';
                const status = (anyEvent.status as string) || 'running';
                const logs = (anyEvent.output as string) || (anyEvent.error as string) || '';
                
                let logMessage = `[${toolName}] ${status.toUpperCase()}`;
                if (logs) {
                    logMessage += `\n${logs}`;
                } else if (status === 'running') {
                    logMessage = `Starting ${toolName}...`;
                }
                actionPromise = scene.triggerToolCall(logMessage);
            } else if (event.action === 'error') {
                actionPromise = scene.triggerError();
            }
        }
        // ─── Judicial Scene events ───
        else if (event.action === 'constitutional' || event.action === 'unconstitutional') {
            if (activeScene.scene.key !== 'JudicialScene') {
                this.sceneManager.switchTo('Judicial');
                await new Promise(r => setTimeout(r, 800));
            }
            const scene = this.sceneManager.getActiveScene() as JudicialScene;
            if (!scene) { this.processQueue(); return; }
            
            if (event.action === 'constitutional') {
                actionPromise = scene.triggerConstitutional();
            } else if (event.action === 'unconstitutional') {
                actionPromise = scene.triggerUnconstitutional();
            }
        }

        if (actionPromise instanceof Promise) {
            await Promise.race([actionPromise, timeoutPromise]).catch(e => {
                console.warn(`[EventMapper] Action ${event.action} failed or timed out:`, e);
            });
        }
    } catch (err) {
        console.error(`[EventMapper] Error processing event:`, err);
    }

    // Process the next event
    this.processQueue();
  }
}
