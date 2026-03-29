"""全事件流集成测试 — 验证 Pipeline 运行期间产生完整的 9 种基础事件。"""

import pytest
from typing import Any

from openclaw_republic.government import CyberGovernment
from openclaw_republic.schemas.events import BaseEvent, EventAction


@pytest.fixture
def test_config_dir() -> Any:
    """使用真实的宪法配置。"""
    return "config"


@pytest.mark.asyncio
async def test_full_event_stream_to_constitutional(test_config_dir: Any, monkeypatch: Any) -> None:
    """模拟 Pipeline 到 constitutional 交付的过程，并收集所有事件。"""
    gov = CyberGovernment(config_dir=test_config_dir)

    collected_actions: list[EventAction] = []
    
    async def mock_event_listener(event: BaseEvent) -> None:
        collected_actions.append(event.action)

    gov.bus.subscribe("legislation", mock_event_listener)
    gov.bus.subscribe("execution", mock_event_listener)
    gov.bus.subscribe("judiciary", mock_event_listener)
    gov.bus.subscribe("lifecycle", mock_event_listener)

    # 模拟 debate_publisher 会被传递到 run_debate 里
    # 我们拦截 DebateEngine.run_debate 来触发 BRAWL 和 ORDER 
    original_run_debate = gov.speaker.moderate_debate
    
    async def mock_moderate_debate(*args: Any, **kwargs: Any) -> Any:
        event_pub = kwargs.get("event_publisher")
        if event_pub:
            # 模拟激进提案和高冲突分歧
            await event_pub(EventAction.PROPOSE, agent="radical_mp", text="proposal")
            await event_pub(EventAction.BRAWL, intensity=0.95)
            await event_pub(EventAction.ORDER, intensity=0.95)
        # 用原调用来拿到标准的 DebateResult 但避免真实LLM
        # 所以我们需要替换 LLM 调用
        return await original_run_debate(*args, **kwargs)

    monkeypatch.setattr(gov.speaker, "moderate_debate", mock_moderate_debate)

    async def mock_call_llm(*args: Any, **kwargs: Any) -> str:
        return "Agree"
    
    monkeypatch.setattr("openclaw_republic.agents.legislative.speaker.Speaker._call_llm", mock_call_llm)
    monkeypatch.setattr("openclaw_republic.agents.legislative.radical_mp.RadicalMP._call_llm", mock_call_llm)
    monkeypatch.setattr("openclaw_republic.agents.legislative.conservative_mp.ConservativeMP._call_llm", mock_call_llm)

    # 强制让投票通过
    original_call_vote = gov.speaker.call_vote
    async def mock_call_vote(*args: Any, **kwargs: Any) -> Any:
        res = await original_call_vote(*args, **kwargs)
        res.passed = True
        res.ayes = 2
        res.nays = 0
        return res
    monkeypatch.setattr(gov.speaker, "call_vote", mock_call_vote)

    # 总统直接通过
    async def mock_review_act(act: Any) -> None:
        return None
    monkeypatch.setattr(gov.president, "review_act", mock_review_act)

    from openclaw_republic.schemas.verdict import Verdict, ResultReviewResult, DeviationResult
    async def mock_review_result(petition: Any, report: Any) -> Any:
        return Verdict(
            verdict_id="v2", act_id="a2", constitutional=True, ruling="Constitutional", 
            result_review=ResultReviewResult(
                passed=True, 
                deviation=DeviationResult(score=0.1, passed=True, explanation="ok"), 
            )
        )
    monkeypatch.setattr(gov.chief_justice, "review_result", mock_review_result)

    # 由于 ExecutionEngine 没有实际的工具，如果遇到 CodeExecution 可能会因为环境找不到返回失败。
    # 我们确保 execution event 能被触发：
    async def mock_execute_act(act: Any, event_publisher: Any = None) -> Any:
        if event_publisher:
            await event_publisher("running", "CodeExecution", 0)
            await event_publisher("success", "CodeExecution", 0)
        from openclaw_republic.schemas.act import ExecutionReport
        return ExecutionReport(
            act_id=act.act_id, overall_status="completed", task_results=[], total_tokens_consumed=0, execution_time_seconds=0
        )
    monkeypatch.setattr(gov.execution_engine, "execute_act", mock_execute_act)

    await gov.inaugurate()
    try:
        await gov.receive_petition("Make AI great", max_retries=1)
    finally:
        await gov.shutdown()

    # 检查所有期望的事件被发布
    assert EventAction.PROPOSE in collected_actions
    assert EventAction.BRAWL in collected_actions
    assert EventAction.ORDER in collected_actions
    assert EventAction.VOTE_PASSED in collected_actions
    assert EventAction.SIGN_ACT in collected_actions
    assert EventAction.TOOL_CALL in collected_actions
    assert EventAction.CONSTITUTIONAL in collected_actions
    assert EventAction.STATE_CHANGE in collected_actions


@pytest.mark.asyncio
async def test_full_event_stream_veto_and_unconstitutional(test_config_dir: Any, monkeypatch: Any) -> None:
    """验证否决和违宪判决也会正常产生。我们直接 mock _run_pipeline 的内部结构来模拟这两次回路。"""
    gov = CyberGovernment(config_dir=test_config_dir)

    collected_actions: list[EventAction] = []
    
    async def mock_event_listener(event: BaseEvent) -> None:
        if event.action in (EventAction.VETO, EventAction.UNCONSTITUTIONAL):
            collected_actions.append(event.action)

    gov.bus.subscribe("legislation", mock_event_listener)
    gov.bus.subscribe("judiciary", mock_event_listener)

    # Mock Speaker 到生成 Act
    async def mock_moderate_debate(*args: Any, **kwargs: Any) -> Any:
        from openclaw_republic.agents.legislative.debate import DebateResult
        return DebateResult(petition="", rounds=[], final_proposal="", consensus_reached=True, final_conflict_score=0.0)
    monkeypatch.setattr(gov.speaker, "moderate_debate", mock_moderate_debate)

    async def mock_call_vote(*args: Any, **kwargs: Any) -> Any:
        from openclaw_republic.agents.legislative.debate import VoteResult
        return VoteResult(proposal="", records=[], ayes=2, nays=0, passed=True)
    monkeypatch.setattr(gov.speaker, "call_vote", mock_call_vote)

    async def mock_generate_act(*args: Any, **kwargs: Any) -> Any:
        from openclaw_republic.schemas.act import Act, ActVoteRecord, DebateRecord, ActStep
        step1 = ActStep(index=0, description="d", required_skill="CodeExecution", tool_parameters={}, estimated_tokens=10, acceptance_criteria="c")
        return Act(act_id="a", title="t", summary="s", petition_origin="p", steps=[step1], 
                   total_estimated_tokens=0, debate_record=DebateRecord(total_rounds=1, final_conflict_score=0, consensus_points=[], remaining_concerns=[]), 
                   vote_record=ActVoteRecord(ayes=2, nays=0, result="passed", voter_positions={}))
    monkeypatch.setattr(gov.speaker, "generate_act", mock_generate_act)

    # 第一次跑总统否决，第二次执行但违宪
    attempt = {"count": 1}

    from openclaw_republic.schemas.act import VetoNotice
    async def mock_review_act(act: Any) -> Any:
        if attempt["count"] == 1:
            return VetoNotice(act_id=act.act_id, reason="Veto 1", specific_issues=["issue1"])
        return None
    monkeypatch.setattr(gov.president, "review_act", mock_review_act)

    async def mock_execute_act(act: Any, event_publisher: Any = None) -> Any:
        from openclaw_republic.schemas.act import ExecutionReport
        return ExecutionReport(
            act_id=act.act_id, overall_status="completed", task_results=[], total_tokens_consumed=0, execution_time_seconds=0
        )
    monkeypatch.setattr(gov.execution_engine, "execute_act", mock_execute_act)

    from openclaw_republic.schemas.verdict import Verdict, ResultReviewResult, DeviationResult, ViolationType
    async def mock_review_result(petition: Any, report: Any) -> Any:
        return Verdict(
            verdict_id="v2", act_id="a2", constitutional=False, ruling="Unconstitutional pass 2", 
            violation_type=ViolationType.DEVIATION_EXCEEDED, evidence=[], 
            result_review=ResultReviewResult(
                passed=False, 
                deviation=DeviationResult(score=1.0, passed=False, explanation="ok"), 
            ),
            remediation="no"
        )
    monkeypatch.setattr(gov.chief_justice, "review_result", mock_review_result)

    # mock _run_pipeline entry increment
    original_run_pipeline = gov._run_pipeline
    async def mock_run_pipeline(petition: str, lifecycle: Any, bill_id: str) -> Any:
        res = await original_run_pipeline(petition, lifecycle, bill_id)
        attempt["count"] += 1
        return res
    monkeypatch.setattr(gov, "_run_pipeline", mock_run_pipeline)

    await gov.inaugurate()
    try:
        await gov.receive_petition("Make AI great", max_retries=2)
    finally:
        await gov.shutdown()

    assert EventAction.VETO in collected_actions
    assert EventAction.UNCONSTITUTIONAL in collected_actions
