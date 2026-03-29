"""Pydantic 模型 — constitution.yaml 的类型安全表示。"""

from pydantic import BaseModel, Field, model_validator


class TokenBudgetConfig(BaseModel):
    """Token 预算配置。"""

    max_per_task: int = Field(ge=1000, description="单个任务的最大 Token 预算")
    debate_budget: int = Field(ge=500, description="辩论阶段 Token 预算")
    execution_budget: int = Field(ge=500, description="执行阶段 Token 预算")
    review_budget: int = Field(ge=500, description="审查阶段 Token 预算")


class DebateConfig(BaseModel):
    """辩论规则配置。"""

    max_rounds: int = Field(ge=1, le=50, description="最大辩论轮次")
    conflict_threshold: int = Field(ge=0, le=100, description="分歧度触发控场的阈值")
    consensus_threshold: int = Field(ge=0, le=100, description="共识阈值（低于此值视为达成共识）")
    min_rounds: int = Field(ge=1, description="最少辩论轮次")

    @model_validator(mode="after")
    def _check_rounds_consistency(self) -> "DebateConfig":
        if self.min_rounds > self.max_rounds:
            msg = f"min_rounds ({self.min_rounds}) 不能大于 max_rounds ({self.max_rounds})"
            raise ValueError(msg)
        return self


class DeviationConfig(BaseModel):
    """产出偏离度配置。"""

    max_score: float = Field(ge=0.0, le=1.0, description="最大允许的偏离度评分")


class JudicialConfig(BaseModel):
    """司法审查配置。"""

    blacklist_commands: list[str] = Field(description="命令黑名单")
    token_budget: TokenBudgetConfig
    debate: DebateConfig
    deviation: DeviationConfig


class SecurityConfig(BaseModel):
    """安全沙箱配置。"""

    sandbox_enabled: bool = Field(default=True, description="是否启用安全沙箱")
    allowed_file_extensions: list[str] = Field(description="允许操作的文件扩展名")
    max_execution_time_seconds: int = Field(ge=1, description="最大执行时间（秒）")
    max_file_size_mb: int = Field(ge=1, description="最大文件大小（MB）")
    network_access: str = Field(default="restricted", description="网络访问策略")


class RBACConfig(BaseModel):
    """权限矩阵 (RBAC) 配置。"""

    permissions: list[str] = Field(description="系统定义的权限列表")
    role_permissions: dict[str, list[str]] = Field(description="角色 → 权限映射")


class ConstitutionConfig(BaseModel):
    """宪法全局配置 — constitution.yaml 的完整数据模型。"""

    version: str = Field(description="宪法版本号")
    judicial: JudicialConfig
    security: SecurityConfig
    rbac: RBACConfig
