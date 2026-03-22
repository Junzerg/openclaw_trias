"""事件模型序列化单测。"""

import json
from datetime import datetime
from openclaw_republic.schemas.events import DebateEvent, EmotionType, EventAction

def test_event_serialization() -> None:
    dt = datetime(2026, 3, 20, 19, 0, 0)
    event = DebateEvent(
        timestamp=dt,
        source_agent="radical_mp",
        action=EventAction.BRAWL,
        emotion=EmotionType.ANGRY,
        intensity=0.8,
        payload={"keyword": "test"},
        task_id="task-123",
        round_number=1,
        conflict_score=80.5,
        statement="This is a test case."
    )

    # 验证 model_dump(mode="json") 行为
    dumped = event.model_dump(mode="json")

    assert dumped["timestamp"] == "2026-03-20T19:00:00"
    assert dumped["action"] == "brawl"
    assert dumped["emotion"] == "angry"
    assert dumped["task_id"] == "task-123"
    assert dumped["round_number"] == 1
    assert dumped["payload"] == {"keyword": "test"}
    
    # 验证完全可 JSON 序列化
    json_str = json.dumps(dumped)
    assert "brawl" in json_str
    assert "2026-03-20T19:00:00" in json_str
