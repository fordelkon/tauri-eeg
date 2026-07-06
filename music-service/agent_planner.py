from __future__ import annotations

from typing import Any, Callable, Literal, TypedDict

from pydantic import BaseModel, Field, field_validator

from lm_studio_client import complete_json_with_lm_studio

AGENT_PLANNER_VERSION = "lm-video-music-stream-v1"
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


class ScaleDimension(BaseModel):
    key: str
    label: str
    description: str
    value: int = Field(ge=0, le=100)


class ScaleStatus(BaseModel):
    dimensions: list[ScaleDimension]
    lastScaleTitle: str
    updatedAt: int | None


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
    scaleStatus: ScaleStatus
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




def _dimension_value(request: AgentPlannerRequest, key: str) -> int:
    for dimension in request.scaleStatus.dimensions:
        if dimension.key == key:
            return dimension.value
    return 50


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


def _select_music_profile(request: AgentPlannerRequest) -> tuple[str, str, int, str]:
    anxiety = _dimension_value(request, "anxiety")
    worry = _dimension_value(request, "worry")
    mood = _dimension_value(request, "mood")
    energy = _dimension_value(request, "energy")
    recent = _recent_music_signatures(request)
    profiles: list[tuple[str, str, int, str, int]] = []

    if anxiety >= 70 or worry >= 65:
        profiles.extend([
            ("ambient instrumental", "slow tempo, warm tone, soft rhythm", 30, "high anxiety and worry", 6),
            ("meditation music", "breath-paced phrases, light reverb, minimal percussion", 30, "high anxiety and worry", 5),
        ])

    if mood <= 40:
        profiles.extend([
            ("classical instrumental", "gentle dynamics, bright melody, warm strings", 30, "low mood", 5),
            ("cinematic instrumental", "hopeful progression, soft piano, gradual lift", 30, "low mood", 4),
        ])

    if energy <= 35:
        profiles.extend([
            ("lo-fi instrumental", "low tempo groove, soft texture, steady pulse", 30, "low energy", 5),
            ("meditation music", "open pads, sparse melody, calm therapeutic texture", 30, "low energy", 4),
        ])

    if not profiles:
        profiles.extend([
            ("jazz instrumental", "gentle dynamics, light swing, warm tone", 30, "balanced state", 3),
            ("ambient instrumental", "calm texture, light reverb, soft rhythm", 30, "balanced state", 2),
        ])

    ranked = []
    for index, (style, details, duration, reason_key, score) in enumerate(profiles):
        signature = f"{style}|{details}"
        repeat_penalty = 10 if signature in recent else 0
        ranked.append((score - repeat_penalty, -index, style, details, duration, reason_key))

    ranked.sort(reverse=True)
    _, _, style, details, duration, reason_key = ranked[0]
    return style, details, duration, reason_key


def _video_score(request: AgentPlannerRequest, video: VideoSummary) -> int:
    anxiety = _dimension_value(request, "anxiety")
    mood = _dimension_value(request, "mood")
    energy = _dimension_value(request, "energy")
    terms = " ".join([video.title, *video.tags]).lower()
    score = 0

    if anxiety >= 60:
        score += sum(token in terms for token in ["calm", "quiet", "soft", "green", "forest", "nature", "peaceful", "clear"])
        score -= sum(token in terms for token in ["storm", "rain", "dark", "intense", "wind", "thunder"])

    if mood <= 45:
        score += sum(token in terms for token in ["warm", "dusk", "sun", "sunset", "golden", "gentle"])

    if energy <= 45:
        score += sum(token in terms for token in ["open", "coast", "sky", "sea", "valley", "horizon"])

    return score


def _select_video_for_state(request: AgentPlannerRequest) -> VideoSummary:
    recent_ids = _recent_recommended_video_ids(request)
    scored = []
    for index, video in enumerate(request.availableResources.videos):
        repeat_penalty = 100 if video.id in recent_ids else 0
        scored.append((_video_score(request, video) - repeat_penalty, -index, video))

    scored.sort(key=lambda item: (item[0], item[1]), reverse=True)
    return scored[0][2]


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
                    "Return JSON only with videoId, reason, and thinking."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"User request: {request.userInput}\n"
                    f"Requested video id from frontend click: {_requested_video_id(request)}\n"
                    f"Scale status: {request.scaleStatus.model_dump_json()}\n"
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
                    "The prompt must describe instrumental music with no vocals, speech, or lyrics."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"User request: {request.userInput}\n"
                    f"Scale status: {request.scaleStatus.model_dump_json()}\n"
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
    return [
        f"Phase: {request.phase}; route: {request.currentRoute}",
        "Read scale status and available resources.",
        f"Decision: {decision}",
    ]


def _plan_by_phase(
    state: PlannerState,
    on_thinking_delta: Callable[[str], None] | None = None,
) -> PlannerState:
    request = state["request"]
    user_input = request.userInput
    anxiety = _dimension_value(request, "anxiety")
    mood = _dimension_value(request, "mood")

    if _is_next_step_input(user_input):
        state["response"] = AgentPlannerResponse(
            action="go_next_page",
            reason="Received next-step instruction; continue to the next experiment phase.",
            requiresConfirmation=False,
        )
        return state

    if request.phase == "game_regulation" and not request.availableResources.gameAvailable:
        state["response"] = AgentPlannerResponse(
            action="skip_game",
            reason="Game regulation is unavailable; skip this phase and continue to music regulation.",
            requiresConfirmation=False,
        )
        return state

    if request.phase == "video_regulation" and request.availableResources.videos:
        state["response"] = _select_video_with_lm_studio(request, on_thinking_delta)
        if state["response"] is not None:
            return state

        video = _select_video_for_state(request)
        state["response"] = AgentPlannerResponse(
            action="play_video",
            params={"videoId": video.id, "title": video.title},
            reason=f"LM Studio did not return a valid video selection; local fallback selected low-stimulation video: {video.title}.",
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

        style, details, duration, reason_key = _select_music_profile(request)
        state["response"] = AgentPlannerResponse(
            action="recommend_music",
            params={
                "style": style,
                "details": details,
                "duration": duration,
                "prompt": f"{style}, {details}, instrumental, no vocals",
            },
            reason=f"Local fallback music profile selected for {reason_key}: {style} with {details}.",
            requiresConfirmation=False,
        )
        return state

    if request.phase == "finish" or "summary" in user_input.lower():
        state["response"] = AgentPlannerResponse(
            action="generate_summary",
            params={"source": "scale_and_resource_history"},
            reason="Generate an experiment summary from scale status and regulation choices; biosignal analysis is not included in this version.",
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
                {"role": "system", "content": "Return JSON with action and reason only."},
                {"role": "user", "content": user_input},
            ],
            LmPlannerOutput,
            on_delta=on_thinking_delta,
        )
        if not lm_result.available or lm_result.value is None:
            state["response"] = AgentPlannerResponse(
                status="unavailable",
                action="no_op",
                reason="The intelligent assistant is unavailable; please use manual page controls.",
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
        action="go_next_page",
        reason="No extra recommendation is needed in the current phase; continue to the next step.",
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
            reason="No executable recommendation is available for the current phase.",
            requiresConfirmation=False,
        )
    if not response.thinking:
        response.thinking = _thinking_steps(request, response.action)
    return response


def plan_agent_action_from_payload(payload: dict[str, Any]) -> AgentPlannerResponse:
    return plan_agent_action(AgentPlannerRequest.model_validate(payload))
