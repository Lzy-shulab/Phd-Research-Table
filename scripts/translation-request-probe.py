"""Verify the installed engine's real API payload without network or cache writes."""
import json
import sys
from importlib.metadata import version
from pathlib import Path
from types import SimpleNamespace

config_path = Path(sys.argv[1]).resolve()
source_path = Path(sys.argv[2]).resolve()
sys.argv = [sys.argv[0], str(source_path), "--config-file", str(config_path), "--no-mono"]

from pdf2zh_next.config import ConfigManager
from pdf2zh_next.translator.base_rate_limiter import BaseRateLimiter
from pdf2zh_next.translator import base_translator
from pdf2zh_next.translator.translator_impl import siliconflow


class MemoryCache:
    def __init__(self, *args, **kwargs):
        pass

    def add_params(self, *args):
        pass


requests = []


def capture(**kwargs):
    requests.append(kwargs)
    return SimpleNamespace(usage=None, choices=[SimpleNamespace(message=SimpleNamespace(content="测试译文"))])


# No production cache, credentials, or API calls are involved in this probe.
base_translator.TranslationCache = MemoryCache
siliconflow.openai.OpenAI = lambda **kwargs: SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=capture)))
manager = ConfigManager()
manager._default_config_file_path = config_path
settings = manager.initialize_config()
assert settings.translation.qps == 20
assert settings.translation.pool_max_workers == 100
assert settings.translation.no_auto_extract_glossary is True
assert settings.translation.ignore_cache is False
translator = siliconflow.SiliconFlowTranslator(settings, BaseRateLimiter())
translator.do_translate("An academic paragraph.")
translator.do_llm_translate("A rich text paragraph.")
assert len(requests) == 2
assert all(request["extra_body"].get("enable_thinking") is False for request in requests)
assert all(request["model"] == "Qwen/Qwen3-8B" for request in requests)
print(json.dumps({"engine": version("pdf2zh_next"), "bodyRequests": len(requests), "enable_thinking": False,
                  "qps": settings.translation.qps, "workers": settings.translation.pool_max_workers,
                  "autoGlossary": not settings.translation.no_auto_extract_glossary, "cacheEnabled": not settings.translation.ignore_cache}))
