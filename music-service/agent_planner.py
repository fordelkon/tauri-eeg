from __future__ import annotations

from typing import Any, Callable, Literal, TypedDict

from pydantic import BaseModel, Field, field_validator

from lm_studio_client import complete_json_with_lm_studio

AGENT_PLANNER_VERSION = "lm-video-music-stream-v2"
AGENT_PLANNER_CAPABILITIES = [
    "lm_video_selection",
    "lm_music_generation_prompt",
    "lm_planner_streaming",
]

try:
    from langgraph.graph import END, StateGraph
except Exception:  # pragma: no cover - exercised only when dependency is absent locally
    END = "__end__"
    StateGraph = None  # type: ignore[assignment]


class VideoSummary(BaseModel):
    id: str
    title: str
    tags: list[str]


class AvailableResources(BaseModel):
    videos: list[VideoSummary]
    musicGeneration: bool
    gameAvailable: bool


class PersonalizedAnswer(BaseModel):
    phase: str
    answer: str
    normalizedTags: list[str] = []
    createdAt: int | None = None


class TimelineEntry(BaseModel):
    at: int
    phase: str
    type: str
    text: str


class PersonalizedContext(BaseModel):
    answers: list[PersonalizedAnswer] = []
    timeline: list[TimelineEntry] = []


class AgentPlannerRequest(BaseModel):
    phase: Literal[
        "intro",
        "baseline",
        "video_regulation",
        "game_regulation",
        "music_regulation",
        "recovery",
        "finish",
    ]
    currentRoute: str
    userInput: str
    availableResources: AvailableResources
    personalizedContext: PersonalizedContext = Field(default_factory=PersonalizedContext)


class AgentPlannerResponse(BaseModel):
    status: Literal["available", "unavailable"] = "available"
    action: Literal[
        "play_video",
        "recommend_video",
        "recommend_music",
        "ask_personalized_question",
        "generate_summary",
        "skip_game",
        "go_next_page",
        "no_op",
    ]
    params: dict[str, str | int | bool | list[str]] = {}
    reason: str
    thinking: list[str] = []
    requiresConfirmation: bool = False


class PlannerState(TypedDict):
    request: AgentPlannerRequest
    response: AgentPlannerResponse | None


class LmPlannerOutput(BaseModel):
    action: Literal["ask_personalized_question", "no_op"]
    reason: str


class LmVideoPlannerOutput(BaseModel):
    videoId: str
    reason: str
    thinking: list[str] = []

    @field_validator("thinking", mode="before")
    @classmethod
    def normalize_thinking(cls, value: Any) -> list[str]:
        if isinstance(value, str):
            return [value]
        if value is None:
            return []
        return value


class LmMusicPlannerOutput(BaseModel):
    style: str
    details: str
    duration: int = Field(ge=5, le=120)
    prompt: str | None = None
    reason: str
    thinking: list[str] = []

    @field_validator("thinking", mode="before")
    @classmethod
    def normalize_thinking(cls, value: Any) -> list[str]:
        if isinstance(value, str):
            return [value]
        if value is None:
            return []
        return value




def _is_next_step_input(user_input: str) -> bool:
    normalized = user_input.strip().lower().replace(" ", "")
    return normalized in {"next", "\u4e0b\u4e00\u6b65", "\u7ee7\u7eed", "continue"}


def _recent_recommended_video_ids(request: AgentPlannerRequest) -> set[str]:
    ids: set[str] = set()
    for entry in request.personalizedContext.timeline:
        if entry.phase == "video_regulation" and entry.text.startswith("recommend_video:"):
            ids.add(entry.text.split(":", 1)[1])
    return ids


def _recent_music_signatures(request: AgentPlannerRequest) -> set[str]:
    signatures: set[str] = set()
    for entry in request.personalizedContext.timeline:
        if entry.phase == "music_regulation" and entry.text.startswith("recommend_music:"):
            signatures.add(entry.text.split(":", 1)[1])
    return signatures


def _personalized_music_tags(request: AgentPlannerRequest) -> list[str]:
    tags: list[str] = []
    seen: set[str] = set()
    for answer in request.personalizedContext.answers:
        for tag in answer.normalizedTags:
            normalized = tag.strip()
            if normalized and normalized not in seen:
                seen.add(normalized)
                tags.append(normalized)
    return tags


def _select_music_profile(request: AgentPlannerRequest) -> tuple[str, str]:
    tags = _personalized_music_tags(request)
    recent = _recent_music_signatures(request)
    profiles = [
        ("ambient instrumental", "slow tempo, warm tone, soft rhythm"),
        ("meditation music", "gentle dynamics, soft texture"),
    ]
    for style, texture in profiles:
        details = ", ".join([texture, *tags])
        if f"{style}|{details}" not in recent:
            return style, details
    style, texture = profiles[0]
    return style, ", ".join([texture, *tags])


def _select_video_for_request(request: AgentPlannerRequest) -> VideoSummary:
    videos = request.availableResources.videos
    requested_id = _requested_video_id(request)
    for video in videos:
        if video.id == requested_id:
            return video

    query = request.userInput.casefold()
    recent_ids = _recent_recommended_video_ids(request)

    def rank(video: VideoSummary) -> tuple[int, bool]:
        terms = [term.strip().casefold() for term in [video.title, *video.tags] if term.strip()]
        return sum(term in query for term in terms), video.id not in recent_ids

    return max(videos, key=rank)


def _format_video_catalog(request: AgentPlannerRequest) -> str:
    lines = []
    for video in request.availableResources.videos:
        lines.append(f"- {video.id}: {video.title}; tags={', '.join(video.tags)}")
    return "\n".join(lines)


def _requested_video_id(request: AgentPlannerRequest) -> str | None:
    prefix = "play_video:"
    user_input = request.userInput.strip()
    if user_input.startswith(prefix):
        return user_input[len(prefix):].strip() or None
    return None


def _select_video_with_lm_studio(
    request: AgentPlannerRequest,
    on_thinking_delta: Callable[[str], None] | None = None,
) -> AgentPlannerResponse | None:
    available_ids = {video.id: video for video in request.availableResources.videos}
    lm_result = complete_json_with_lm_studio(
        [
            {
                "role": "system",
                "content": (
                    "You are an experiment video regulation planner. "
                    "Choose exactly one videoId from the provided catalog. "
                    "Return JSON only with videoId, reason, and thinking. "
                    "Write the user-facing reason and brief selection notes in Simplified Chinese."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"User request: {request.userInput}\n"
                    f"Requested video id from frontend click: {_requested_video_id(request)}\n"
                    f"Recently recommended video ids: {sorted(_recent_recommended_video_ids(request))}\n"
                    f"Catalog:\n{_format_video_catalog(request)}"
                ),
            },
        ],
        LmVideoPlannerOutput,
        on_delta=on_thinking_delta,
    )
    if not lm_result.available or lm_result.value is None:
        return None

    video = available_ids.get(lm_result.value.videoId)
    if video is None:
        return None

    return AgentPlannerResponse(
        action="play_video",
        params={"videoId": video.id, "title": video.title},
        reason=lm_result.value.reason,
        thinking=lm_result.value.thinking,
        requiresConfirmation=True,
    )



def _select_music_with_lm_studio(
    request: AgentPlannerRequest,
    on_thinking_delta: Callable[[str], None] | None = None,
) -> AgentPlannerResponse | None:
    lm_result = complete_json_with_lm_studio(
        [
            {
                "role": "system",
                "content": (
                    "You are an experiment music regulation planner. "
                    "Use the user's existing normalized tags when useful, but keep the result safe for relaxation. "
                    "Return JSON only with style, details, duration, prompt, reason, and thinking. "
                    "Write the user-facing reason and brief selection notes in Simplified Chinese. "
                    "The prompt must describe instrumental music with no vocals, speech, or lyrics."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"User request: {request.userInput}\n"
                    f"Existing normalized music tags: {_personalized_music_tags(request)}\n"
                    f"Recently generated music signatures: {sorted(_recent_music_signatures(request))}\n"
                    "Generate one concrete music prompt for the music generation service."
                ),
            },
        ],
        LmMusicPlannerOutput,
        on_delta=on_thinking_delta,
    )
    if not lm_result.available or lm_result.value is None:
        return None

    value = lm_result.value
    prompt = value.prompt or f"{value.style}, {value.details}, instrumental, no vocals"
    return AgentPlannerResponse(
        action="recommend_music",
        params={
            "style": value.style,
            "details": value.details,
            "duration": value.duration,
            "prompt": prompt,
        },
        reason=value.reason,
        thinking=value.thinking,
        requiresConfirmation=False,
    )



def _thinking_steps(request: AgentPlannerRequest, decision: str) -> list[str]:
    phase = {
        "intro": "开始", "baseline": "准备", "video_regulation": "视频调控",
        "game_regulation": "VR 调控", "music_regulation": "音乐调控",
        "recovery": "恢复", "finish": "结束",
    }[request.phase]
    action = {
        "go_next_page": "继续下一步", "skip_game": "跳过 VR 调控",
        "recommend_video": "推荐视频", "play_video": "准备播放视频",
        "recommend_music": "推荐音乐", "generate_summary": "查看实验摘要",
        "ask_personalized_question": "询问操作偏好", "no_op": "保留当前页面",
    }[decision]
    return [
        f"当前阶段为{phase}。",
        f"本页可用视频 {len(request.availableResources.videos)} 个。",
        f"处理结果为{action}。",
    ]


def _plan_by_phase(
    state: PlannerState,
    on_thinking_delta: Callable[[str], None] | None = None,
) -> PlannerState:
    request = state["request"]
    user_input = request.userInput

    if _is_next_step_input(user_input):
        state["response"] = AgentPlannerResponse(
            action="go_next_page",
            reason="已收到下一步指令。",
            requiresConfirmation=False,
        )
        return state

    if request.phase == "game_regulation" and not request.availableResources.gameAvailable:
        state["response"] = AgentPlannerResponse(
            action="skip_game",
            reason="本次 VR 调控不可用，下一项是音乐调控。",
            requiresConfirmation=False,
        )
        return state

    if request.phase == "video_regulation" and request.availableResources.videos:
        state["response"] = _select_video_with_lm_studio(request, on_thinking_delta)
        if state["response"] is not None:
            return state

        video = _select_video_for_request(request)
        state["response"] = AgentPlannerResponse(
            action="play_video",
            params={"videoId": video.id, "title": video.title},
            reason=f"已从本地素材中选出《{video.title}》，确认后播放。",
            requiresConfirmation=True,
        )
        return state

    music_generation_terms = [
        "generate",
        "music",
        "\u751f\u6210",
        "\u97f3\u4e50",
    ]
    wants_music_generation = any(term in user_input.lower() for term in music_generation_terms)

    if request.phase == "music_regulation" and request.availableResources.musicGeneration and wants_music_generation:
        state["response"] = _select_music_with_lm_studio(request, on_thinking_delta)
        if state["response"] is not None:
            return state

        style, details = _select_music_profile(request)
        duration = 30
        state["response"] = AgentPlannerResponse(
            action="recommend_music",
            params={
                "style": style,
                "details": details,
                "duration": duration,
                "prompt": f"{style}, {details}, instrumental, no vocals",
            },
            reason=f"建议生成 {duration} 秒的 {style}。",
            requiresConfirmation=False,
        )
        return state

    if request.phase == "finish" or "summary" in user_input.lower():
        state["response"] = AgentPlannerResponse(
            action="generate_summary",
            params={"source": "scale_and_resource_history"},
            reason="可在效果评价的结果页查看本次量表和调控记录。",
            requiresConfirmation=False,
        )
        return state

    lowered_user_input = user_input.lower()
    if (
        "personalized" in lowered_user_input
        or "followup" in lowered_user_input
        or "\u4e2a\u6027\u5316" in user_input
        or "\u8ffd\u95ee" in user_input
    ):
        lm_result = complete_json_with_lm_studio(
            [
                {"role": "system", "content": "Return JSON with action and a Simplified Chinese reason only."},
                {"role": "user", "content": user_input},
            ],
            LmPlannerOutput,
            on_delta=on_thinking_delta,
        )
        if not lm_result.available or lm_result.value is None:
            state["response"] = AgentPlannerResponse(
                status="unavailable",
                action="no_op",
                reason="推荐服务暂不可用，可使用当前页面的快捷指令。",
                requiresConfirmation=False,
            )
            return state
        state["response"] = AgentPlannerResponse(
            action=lm_result.value.action,
            reason=lm_result.value.reason,
            requiresConfirmation=False,
        )
        return state

    state["response"] = AgentPlannerResponse(
        action="no_op",
        reason="没有找到对应的实验操作。请选择当前页面的快捷指令，或输入其中的指令名称。",
        requiresConfirmation=False,
    )
    return state


def build_agent_graph():
    if StateGraph is None:
        return None
    graph = StateGraph(PlannerState)
    graph.add_node("plan_by_phase", _plan_by_phase)
    graph.set_entry_point("plan_by_phase")
    graph.add_edge("plan_by_phase", END)
    return graph.compile()


def plan_agent_action(
    request: AgentPlannerRequest,
    on_thinking_delta: Callable[[str], None] | None = None,
) -> AgentPlannerResponse:
    graph = build_agent_graph()
    initial_state: PlannerState = {"request": request, "response": None}

    if graph is None or on_thinking_delta is not None:
        state = _plan_by_phase(initial_state, on_thinking_delta)
    else:
        state = graph.invoke(initial_state)

    response = state.get("response")
    if response is None:
        return AgentPlannerResponse(
            action="no_op",
            reason="当前阶段暂无可执行的推荐操作。",
            requiresConfirmation=False,
        )
    if not response.thinking:
        response.thinking = _thinking_steps(request, response.action)
    return response


def plan_agent_action_from_payload(payload: dict[str, Any]) -> AgentPlannerResponse:
    return plan_agent_action(AgentPlannerRequest.model_validate(payload))
