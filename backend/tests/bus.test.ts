import { describe, it, expect, vi } from 'vitest';
import { BillState, BillLifecycle, InvalidTransitionError } from '../src/bus/state-machine';
import { MessageBus, Topic } from '../src/bus/message-bus';
import { EventLogger } from '../src/bus/event-log';
import { BaseEvent, EventAction, EmotionType } from '../src/schemas/events';

describe('BillLifecycle State Machine', () => {
  it('should successfully complete a legal lifecycle', () => {
    const lifecycle = new BillLifecycle('bill-001');
    expect(lifecycle.current_state).toBe(BillState.PETITION);
    
    lifecycle.transition(BillState.DRAFTING);
    lifecycle.transition(BillState.DEBATING);
    lifecycle.transition(BillState.VOTED);
    lifecycle.transition(BillState.SIGNED);
    lifecycle.transition(BillState.EXECUTING);
    lifecycle.transition(BillState.REVIEWING);
    lifecycle.transition(BillState.CONSTITUTIONAL);
    lifecycle.transition(BillState.DELIVERED);

    expect(lifecycle.is_terminal).toBe(true);
    expect(lifecycle.history.length).toBe(8);
  });

  it('should support legal loop transitions (VETOED -> DRAFTING)', () => {
    const lifecycle = new BillLifecycle('bill-002');
    lifecycle.transition(BillState.DRAFTING);
    lifecycle.transition(BillState.DEBATING);
    lifecycle.transition(BillState.VOTED);
    lifecycle.transition(BillState.VETOED);
    
    // back to drafting
    lifecycle.transition(BillState.DRAFTING);
    expect(lifecycle.current_state).toBe(BillState.DRAFTING);
  });

  it('should support legal loop transitions (UNCONSTITUTIONAL -> DRAFTING)', () => {
    const lifecycle = new BillLifecycle('bill-003');
    lifecycle.transition(BillState.DRAFTING);
    lifecycle.transition(BillState.DEBATING);
    lifecycle.transition(BillState.VOTED);
    lifecycle.transition(BillState.SIGNED);
    lifecycle.transition(BillState.EXECUTING);
    lifecycle.transition(BillState.REVIEWING);
    lifecycle.transition(BillState.UNCONSTITUTIONAL);
    
    // back to drafting
    lifecycle.transition(BillState.DRAFTING);
    expect(lifecycle.current_state).toBe(BillState.DRAFTING);
  });

  it('should throw InvalidTransitionError for illegal transitions', () => {
    const lifecycle = new BillLifecycle('bill-004');
    expect(() => {
      lifecycle.transition(BillState.SIGNED); // Cannot jump PETITION -> SIGNED
    }).toThrowError(InvalidTransitionError);
    
    expect(() => {
      lifecycle.transition(BillState.SIGNED);
    }).toThrow(/非法状态转换/);
  });
});

describe('MessageBus', () => {
  it('should successfully publish and trigger subscribers', async () => {
    const bus = new MessageBus();
    const handler = vi.fn();
    
    bus.subscribe('legislation', handler);
    expect(bus.get_subscriber_count('legislation')).toBe(1);

    const event: BaseEvent = {
        timestamp: new Date(),
        source_agent: 'Speaker',
        action: EventAction.STATE_CHANGE,
        emotion: EmotionType.NEUTRAL,
        intensity: 0.5,
        payload: {}
    };

    await bus.publish('legislation', event);
    
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(event);
    expect(bus.event_log.length).toBe(1);
    expect(bus.event_log[0]).toBe(event);
  });

  it('should support unsubscribing', () => {
    const bus = new MessageBus();
    const handler = vi.fn();
    
    bus.subscribe('execution', handler);
    bus.unsubscribe('execution', handler);
    expect(bus.get_subscriber_count('execution')).toBe(0);
    
    expect(() => bus.unsubscribe('execution', handler)).toThrow(/处理器未注册/);
  });

  it('should throw error on invalid topic', async () => {
    const bus = new MessageBus();
    // Use type casting to test invalid strings
    expect(() => bus.subscribe('invalid' as Topic, vi.fn())).toThrow(/无效主题/);
    await expect(bus.publish('invalid' as Topic, {} as BaseEvent)).rejects.toThrow(/无效主题/);
  });

  it('should prevent one failing handler from crushing the others', async () => {
    const bus = new MessageBus();
    
    // suppressing console.error in tests
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    
    const failingHandler = vi.fn().mockRejectedValue(new Error('Handler Error'));
    const successHandler = vi.fn();

    bus.subscribe('judiciary', failingHandler);
    bus.subscribe('judiciary', successHandler);

    const event: BaseEvent = {
        timestamp: new Date(),
        source_agent: 'ChiefJustice',
        action: EventAction.CONSTITUTIONAL,
        emotion: EmotionType.NEUTRAL,
        intensity: 0.5,
        payload: {}
    };

    await bus.publish('judiciary', event);
    
    expect(failingHandler).toHaveBeenCalledTimes(1);
    expect(successHandler).toHaveBeenCalledTimes(1);
    
    spy.mockRestore();
  });
});

describe('EventLogger', () => {
  it('should log and filter events correctly', () => {
    const logger = new EventLogger();
    const now = new Date();
    
    const event1: BaseEvent = {
        timestamp: new Date(now.getTime() - 10000), // 10s ago
        source_agent: 'RadicalMP',
        action: EventAction.BRAWL,
        emotion: EmotionType.ANGRY,
        intensity: 0.9,
        payload: {}
    };
    
    const event2: BaseEvent = {
        timestamp: now,
        source_agent: 'Speaker',
        action: EventAction.ORDER,
        emotion: EmotionType.STERN,
        intensity: 0.8,
        payload: {}
    };

    logger.log(event1);
    logger.log(event2);

    expect(logger.count).toBe(2);

    const filteredByAgent = logger.get_events({ source_agent: 'Speaker' });
    expect(filteredByAgent.length).toBe(1);
    expect(filteredByAgent[0].action).toBe(EventAction.ORDER);

    const filteredByAction = logger.get_events({ action: EventAction.BRAWL });
    expect(filteredByAction.length).toBe(1);
    expect(filteredByAction[0].source_agent).toBe('RadicalMP');

    const filteredByTime = logger.get_events({ since: new Date(now.getTime() - 5000) });
    expect(filteredByTime.length).toBe(1);
    expect(filteredByTime[0].source_agent).toBe('Speaker');
    
    const elements = logger.export_for_websocket();
    expect(elements).toBeInstanceOf(Array);
    expect(elements.length).toBe(2);
    // JS dates convert to ISODate strings in JSON.parse(JSON.stringify())
    expect(typeof elements[0].timestamp).toBe('string');
  });
});
