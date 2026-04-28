"""
AI Agent — Phase 5 BYOK mode.
Streams OpenAI (or compatible) responses back to the caller via Server-Sent Events.
The API key is supplied per-request by the frontend and NEVER persisted.
"""
import json
import logging
from typing import AsyncIterator

import httpx

logger = logging.getLogger(__name__)

OPENAI_BASE = "https://api.openai.com/v1"

# ── System prompts ─────────────────────────────────────────────────────────────

_CODING_SYSTEM = """\
You are an expert quantitative trading strategy developer specialising in Freqtrade IStrategy.
Help the user write, debug, and improve their Python strategy code.
Rules:
- Always respond in the same language the user writes in (Chinese or English).
- When showing code, wrap it in ```python ... ``` blocks.
- Keep explanations concise but accurate.
- Never hallucinate Freqtrade API methods — only use methods documented in Freqtrade 2024+.
"""

_REPORT_SYSTEM = """\
You are a professional quantitative analyst reviewing a Freqtrade backtest report.
Analyse the provided metrics and produce a structured risk/reward summary.
Rules:
- Always respond in Chinese.
- Structure your response with these sections:
  ## 策略摘要
  ## 盈利能力分析
  ## 风险评估
  ## 改进建议
- Be direct and critical — avoid hollow praise.
- Format numbers clearly (e.g. "+12.34%", "最大回撤 -8.12%").
"""

# ── Core streaming helpers ─────────────────────────────────────────────────────

async def stream_chat(
    api_key: str,
    messages: list[dict],
    model: str = "gpt-4o-mini",
    base_url: str = OPENAI_BASE,
) -> AsyncIterator[str]:
    """
    Yield text delta chunks from the OpenAI chat completions streaming API.
    Raises ValueError for auth errors, RuntimeError for other failures.
    """
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "messages": messages,
        "stream": True,
        "temperature": 0.3,
        "max_tokens": 2048,
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        async with client.stream(
            "POST",
            f"{base_url}/chat/completions",
            headers=headers,
            json=payload,
        ) as resp:
            if resp.status_code == 401:
                raise ValueError("API Key 无效或已过期")
            if resp.status_code == 429:
                raise RuntimeError("请求频率超限，请稍后再试")
            if not resp.is_success:
                body = await resp.aread()
                raise RuntimeError(f"OpenAI 返回错误 {resp.status_code}: {body.decode()[:200]}")

            async for raw_line in resp.aiter_lines():
                line = raw_line.strip()
                if not line or not line.startswith("data: "):
                    continue
                data = line[6:]
                if data == "[DONE]":
                    return
                try:
                    chunk = json.loads(data)
                    delta = chunk["choices"][0]["delta"].get("content", "")
                    if delta:
                        yield delta
                except (json.JSONDecodeError, KeyError, IndexError):
                    continue


async def analyze_backtest(
    api_key: str,
    metrics: dict,
    model: str = "gpt-4o-mini",
    base_url: str = OPENAI_BASE,
) -> AsyncIterator[str]:
    """
    Stream a structured backtest analysis report given a metrics dict.
    """
    metrics_text = "\n".join(
        f"- {k}: {v}" for k, v in metrics.items() if v is not None
    )
    user_msg = f"请分析以下 Freqtrade 回测结果并生成专业报告：\n\n{metrics_text}"

    messages = [
        {"role": "system", "content": _REPORT_SYSTEM},
        {"role": "user",   "content": user_msg},
    ]
    async for chunk in stream_chat(api_key, messages, model=model, base_url=base_url):
        yield chunk
