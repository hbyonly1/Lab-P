from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any, Dict, Optional

from sqlmodel import Session

from core.config import settings
from models.core import AiConfig, get_utc_now


AI_TASK_IMAGE_RECOGNITION = "image_recognition"
AI_TASK_ANSWER_GENERATION = "answer_generation"
AI_TASK_CAPTCHA = "captcha"

DEFAULT_AI_BASE_URL = "https://api.openai.com/v1"
DEFAULT_AI_MODEL = "gpt-4o"
DEFAULT_IMAGE_RECOGNITION_MODEL = "zai-org/GLM-4.5V"
LEGACY_IMAGE_RECOGNITION_MODELS = {"deepseek-ai/DeepSeek-OCR"}
DEFAULT_CAPTCHA_PROMPT = "OCR this captcha. Return exactly one token: the 4-character uppercase code."
DEFAULT_TIMEOUT_SECONDS = 60
DEFAULT_TEMPERATURE = 0.7
DEFAULT_MAX_IMAGES_PER_TASK = 8
DEFAULT_AUTO_RECOGNIZE = False
DEFAULT_IMAGE_RECOGNITION_TEMPERATURE = 0
DEFAULT_ANSWER_GENERATION_TEMPERATURE = 0.85
DEFAULT_CAPTCHA_TIMEOUT_SECONDS = 30
DEFAULT_CAPTCHA_TEMPERATURE = 0


class AiProviderConfigError(ValueError):
    pass


def normalize_image_recognition_model(model: Optional[str]) -> str:
    selected = str(model or "").strip() or DEFAULT_IMAGE_RECOGNITION_MODEL
    if selected in LEGACY_IMAGE_RECOGNITION_MODELS:
        return DEFAULT_IMAGE_RECOGNITION_MODEL
    return selected


def model_supports_json_mode(model: str) -> bool:
    model_name = str(model or "").lower()
    no_json_mode_markers = [
        "glm-4.5v",
    ]
    return not any(marker in model_name for marker in no_json_mode_markers)


@dataclass(frozen=True)
class AiTaskProfile:
    task: str
    provider: str
    api_key: str
    base_url: str
    model: str
    timeout_seconds: int
    temperature: float
    max_images_per_task: int
    prompt: Optional[str] = None


def _settings_value(name: str, default: Any = None) -> Any:
    value = os.getenv(name)
    if value not in [None, ""]:
        return value
    return getattr(settings, name, default)


def ai_config_from_settings() -> AiConfig:
    default_model = settings.AI_DEFAULT_MODEL or DEFAULT_AI_MODEL
    return AiConfig(
        id=1,
        provider=settings.AI_PROVIDER,
        base_url=settings.AI_BASE_URL or DEFAULT_AI_BASE_URL,
        default_model=default_model,
        default_timeout_seconds=DEFAULT_TIMEOUT_SECONDS,
        default_temperature=DEFAULT_TEMPERATURE,
        default_max_images_per_task=DEFAULT_MAX_IMAGES_PER_TASK,
        auto_recognize=DEFAULT_AUTO_RECOGNIZE,
        image_recognition_model=normalize_image_recognition_model(settings.AI_IMAGE_RECOGNITION_MODEL),
        image_recognition_timeout_seconds=DEFAULT_TIMEOUT_SECONDS,
        image_recognition_temperature=DEFAULT_IMAGE_RECOGNITION_TEMPERATURE,
        image_recognition_max_images_per_task=DEFAULT_MAX_IMAGES_PER_TASK,
        answer_generation_model=settings.AI_ANSWER_GENERATION_MODEL or default_model,
        answer_generation_timeout_seconds=DEFAULT_TIMEOUT_SECONDS,
        answer_generation_temperature=DEFAULT_ANSWER_GENERATION_TEMPERATURE,
        captcha_model=settings.AI_CAPTCHA_MODEL or default_model,
        captcha_timeout_seconds=DEFAULT_CAPTCHA_TIMEOUT_SECONDS,
        captcha_temperature=DEFAULT_CAPTCHA_TEMPERATURE,
        captcha_prompt=DEFAULT_CAPTCHA_PROMPT,
        updated_at=get_utc_now(),
    )


def ensure_ai_config(session: Session) -> AiConfig:
    config = session.get(AiConfig, 1)
    if config:
        normalized_image_model = normalize_image_recognition_model(config.image_recognition_model)
        if config.image_recognition_model != normalized_image_model:
            config.image_recognition_model = normalized_image_model
            config.updated_at = get_utc_now()
            session.add(config)
            session.flush()
        return config
    config = ai_config_from_settings()
    session.add(config)
    session.flush()
    return config


class AiProvider:
    """Single AI runtime boundary for all OpenAI-compatible tasks."""

    def __init__(self, session: Session):
        self.session = session

    def get_profile(self, task: str) -> AiTaskProfile:
        config = ensure_ai_config(self.session)
        if config.provider != "openai_compatible":
            raise AiProviderConfigError(f"Unsupported AI provider: {config.provider}")

        api_key = _settings_value("AI_API_KEY")
        if not api_key:
            raise AiProviderConfigError("AI API key is not configured. Expected env: AI_API_KEY.")

        if task == AI_TASK_IMAGE_RECOGNITION:
            model = config.image_recognition_model
            timeout_seconds = config.image_recognition_timeout_seconds
            temperature = config.image_recognition_temperature
            max_images_per_task = config.image_recognition_max_images_per_task
            prompt = None
        elif task == AI_TASK_ANSWER_GENERATION:
            model = config.answer_generation_model
            timeout_seconds = config.answer_generation_timeout_seconds
            temperature = config.answer_generation_temperature
            max_images_per_task = config.default_max_images_per_task
            prompt = None
        elif task == AI_TASK_CAPTCHA:
            model = config.captcha_model
            timeout_seconds = config.captcha_timeout_seconds
            temperature = config.captcha_temperature
            max_images_per_task = 1
            prompt = config.captcha_prompt
        else:
            model = config.default_model
            timeout_seconds = config.default_timeout_seconds
            temperature = config.default_temperature
            max_images_per_task = config.default_max_images_per_task
            prompt = None

        return AiTaskProfile(
            task=task,
            provider=config.provider,
            api_key=str(api_key),
            base_url=config.base_url,
            model=str(model),
            timeout_seconds=int(timeout_seconds),
            temperature=float(temperature),
            max_images_per_task=int(max_images_per_task),
            prompt=prompt,
        )

    def _client(self, profile: AiTaskProfile):
        import openai

        return openai.AsyncOpenAI(
            api_key=profile.api_key,
            base_url=profile.base_url,
            timeout=profile.timeout_seconds,
        )

    async def chat_completion(
        self,
        *,
        task: str,
        messages: list[dict],
        response_format: Optional[Dict[str, Any]] = None,
        max_tokens: Optional[int] = None,
    ) -> Any:
        profile = self.get_profile(task)
        payload: Dict[str, Any] = {
            "model": profile.model,
            "messages": messages,
            "temperature": profile.temperature,
        }
        if response_format and model_supports_json_mode(profile.model):
            payload["response_format"] = response_format
        if max_tokens is not None:
            payload["max_tokens"] = max_tokens
        return await self._client(profile).chat.completions.create(**payload)


def get_ai_provider(session: Session) -> AiProvider:
    return AiProvider(session)
