import re
from typing import Any, Dict

from sqlmodel import Session

from core.db import engine
from services.ai_provider import AI_TASK_CAPTCHA, get_ai_provider


def recognize_captcha_image_b64(image_b64: str, config: Dict[str, Any]) -> Dict[str, str]:
    with Session(engine) as session:
        provider = get_ai_provider(session)
        profile = provider.get_profile(AI_TASK_CAPTCHA)
        if not profile.prompt:
            raise ValueError("验证码识别 Prompt 未配置")

        import asyncio

        response = asyncio.run(provider.chat_completion(
            task=AI_TASK_CAPTCHA,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/png;base64,{image_b64}"},
                        },
                        {"type": "text", "text": profile.prompt},
                    ],
                }
            ],
            max_tokens=64,
        ))

    content = str(response.choices[0].message.content or "")
    cleaned = re.sub(r"[^0-9A-Za-z]", "", content).upper()
    return {
        "raw_text": content,
        "cleaned_text": cleaned,
    }
