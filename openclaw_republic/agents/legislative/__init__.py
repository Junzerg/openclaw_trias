"""立法分支 (Legislative Branch) — 议会辩论与法案起草。"""

from openclaw_republic.agents.legislative.conservative_mp import ConservativeMP
from openclaw_republic.agents.legislative.debate import (
    DebateEngine,
    DebateResult,
    DebateRound,
    Voter,
    VoteRecord,
    VoteResult,
    VotingMachine,
)
from openclaw_republic.agents.legislative.radical_mp import RadicalMP
from openclaw_republic.agents.legislative.speaker import Speaker

__all__ = [
    "ConservativeMP",
    "DebateEngine",
    "DebateResult",
    "DebateRound",
    "RadicalMP",
    "Speaker",
    "Voter",
    "VoteRecord",
    "VoteResult",
    "VotingMachine",
]
