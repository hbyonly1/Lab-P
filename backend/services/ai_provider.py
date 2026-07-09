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
AI_TASK_EXPERIMENT_IMAGE_AUTO_MATCH = "experiment_image_auto_match"
AI_TASK_IMAGE_RECOGNITION_RETRY = "image_recognition_retry"

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
DEFAULT_IMAGE_RECOGNITION_RETRY_ENABLED = False
DEFAULT_ANSWER_GENERATION_TEMPERATURE = 0.85
DEFAULT_CAPTCHA_TIMEOUT_SECONDS = 30
DEFAULT_CAPTCHA_TEMPERATURE = 0
DEFAULT_EXPERIMENT_IMAGE_AUTO_MATCH_OVERRIDE = {
    "enabled": False,
    "provider": "openai_compatible",
    "base_url": "http://localhost:59663/v1",
    "chat_completions_url": "http://localhost:59663/v1/chat/completions",
    "api_key": "",
    "model": "gpt-5.5",
    "temperature": 0,
    "timeout_seconds": 120,
    "batch_size": 1,
    "concurrency": 3,
    "max_retries": 2,
    "retry_delay_seconds": 30,
}
DEFAULT_IMAGE_RECOGNITION_RETRY_OVERRIDE = {
    **DEFAULT_EXPERIMENT_IMAGE_AUTO_MATCH_OVERRIDE,
    "enabled": False,
    "batch_size": 5,
}
DEFAULT_CAPTCHA_OVERRIDE = {
    **DEFAULT_EXPERIMENT_IMAGE_AUTO_MATCH_OVERRIDE,
    "enabled": False,
    "base_url": "http://10.26.91.86:59663/v1",
    "chat_completions_url": "http://10.26.91.86:59663/v1/chat/completions",
    "model": "gpt-5.5",
    "timeout_seconds": DEFAULT_CAPTCHA_TIMEOUT_SECONDS,
    "batch_size": 1,
    "concurrency": 1,
}


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
    concurrency: int = 1
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
        image_recognition_retry_enabled=DEFAULT_IMAGE_RECOGNITION_RETRY_ENABLED,
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
        task_overrides_json={
            AI_TASK_EXPERIMENT_IMAGE_AUTO_MATCH: dict(DEFAULT_EXPERIMENT_IMAGE_AUTO_MATCH_OVERRIDE),
            AI_TASK_IMAGE_RECOGNITION_RETRY: dict(DEFAULT_IMAGE_RECOGNITION_RETRY_OVERRIDE),
            AI_TASK_CAPTCHA: dict(DEFAULT_CAPTCHA_OVERRIDE),
        },
        updated_at=get_utc_now(),
    )


def ensure_ai_config(session: Session) -> AiConfig:
    config = session.get(AiConfig, 1)
    if config:
        if not isinstance(config.task_overrides_json, dict):
            config.task_overrides_json = {}
            config.updated_at = get_utc_now()
            session.add(config)
            session.flush()
        overrides_json = dict(config.task_overrides_json or {})
        changed = False
        for task_key, default_override in {
            AI_TASK_EXPERIMENT_IMAGE_AUTO_MATCH: DEFAULT_EXPERIMENT_IMAGE_AUTO_MATCH_OVERRIDE,
            AI_TASK_IMAGE_RECOGNITION_RETRY: DEFAULT_IMAGE_RECOGNITION_RETRY_OVERRIDE,
            AI_TASK_CAPTCHA: DEFAULT_CAPTCHA_OVERRIDE,
        }.items():
            if task_key not in overrides_json:
                overrides_json[task_key] = dict(default_override)
                changed = True
        normalized_image_model = normalize_image_recognition_model(config.image_recognition_model)
        if config.image_recognition_model != normalized_image_model:
            config.image_recognition_model = normalized_image_model
            config.updated_at = get_utc_now()
            session.add(config)
            session.flush()
        if changed:
            config.task_overrides_json = overrides_json
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

    def get_profile(self, task: str, *, recognition_attempt: int = 1) -> AiTaskProfile:
        config = ensure_ai_config(self.session)
        if config.provider != "openai_compatible":
            raise AiProviderConfigError(f"Unsupported AI provider: {config.provider}")

        requested_task = task
        if task == AI_TASK_EXPERIMENT_IMAGE_AUTO_MATCH:
            override_profile = self._task_override_profile(config, task)
            if override_profile:
                return override_profile
            task = AI_TASK_IMAGE_RECOGNITION

        api_key = _settings_value("AI_API_KEY")
        if not api_key:
            raise AiProviderConfigError("AI API key is not configured. Expected env: AI_API_KEY.")

        if task == AI_TASK_IMAGE_RECOGNITION:
            if bool(config.image_recognition_retry_enabled) and int(recognition_attempt or 1) > 1:
                override_profile = self._task_override_profile(config, AI_TASK_IMAGE_RECOGNITION_RETRY)
                if override_profile:
                    return override_profile
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
            override_profile = self._task_override_profile(config, AI_TASK_CAPTCHA)
            if override_profile:
                return AiTaskProfile(
                    task=override_profile.task,
                    provider=override_profile.provider,
                    api_key=override_profile.api_key,
                    base_url=override_profile.base_url,
                    model=override_profile.model,
                    timeout_seconds=override_profile.timeout_seconds,
                    temperature=override_profile.temperature,
                    max_images_per_task=1,
                    concurrency=1,
                    prompt=config.captcha_prompt,
                )
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
            concurrency=3 if requested_task == AI_TASK_EXPERIMENT_IMAGE_AUTO_MATCH else 1,
            prompt=prompt,
        )

    def _task_override_profile(self, config: AiConfig, task: str) -> Optional[AiTaskProfile]:
        overrides = config.task_overrides_json or {}
        override = overrides.get(task) if isinstance(overrides, dict) else None
        if not isinstance(override, dict) or override.get("enabled") is not True:
            return None
        provider = str(override.get("provider") or "openai_compatible").strip()
        if provider != "openai_compatible":
            raise AiProviderConfigError(f"Unsupported AI task override provider: {provider}")
        api_key = str(override.get("api_key") or "").strip()
        if not api_key:
            raise AiProviderConfigError(f"AI task override {task} is missing api_key.")
        base_url = str(override.get("base_url") or "").strip()
        chat_url = str(override.get("chat_completions_url") or "").strip()
        if not base_url:
            if chat_url.endswith("/chat/completions"):
                base_url = chat_url[: -len("/chat/completions")]
        if not base_url:
            raise AiProviderConfigError(f"AI task override {task} is missing base_url.")
        model = str(override.get("model") or "").strip()
        if not model:
            raise AiProviderConfigError(f"AI task override {task} is missing model.")
        timeout_seconds = int(override.get("timeout_seconds") or 120)
        temperature = float(override.get("temperature") if override.get("temperature") is not None else 0)
        max_images_per_task = int(
            override.get("batch_size")
            or override.get("max_images_per_task")
            or config.image_recognition_max_images_per_task
            or 5
        )
        concurrency = int(override.get("concurrency") or 3)
        return AiTaskProfile(
            task=task,
            provider=provider,
            api_key=api_key,
            base_url=base_url.rstrip("/"),
            model=model,
            timeout_seconds=timeout_seconds,
            temperature=temperature,
            max_images_per_task=max(1, max_images_per_task),
            concurrency=max(1, min(10, concurrency)),
            prompt=None,
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
        recognition_attempt: int = 1,
    ) -> Any:
        profile = self.get_profile(task, recognition_attempt=recognition_attempt)
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
