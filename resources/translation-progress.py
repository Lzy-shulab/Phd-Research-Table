"""Stream the installed PDF2zh engine's progress without modifying its environment."""

import asyncio
import json
import logging
import sys


def emit(stage, percent=None, current=None, total=None):
    print("@@WORKBENCH_PROGRESS@@" + json.dumps({
        "stage": stage, "percent": percent, "current": current, "total": total,
    }, ensure_ascii=False), flush=True)


async def main():
    emit("Preparing translation engine")
    from pdf2zh_next.config import ConfigManager
    from pdf2zh_next.high_level import do_translate_async_stream
    import babeldoc.assets.assets

    logging.basicConfig(level=logging.WARNING, stream=sys.stderr)
    settings = ConfigManager().initialize_config()
    # The desktop app supplies one PDF and a per-job configuration, as with the CLI.
    files = list(settings.basic.input_files)
    if len(files) != 1:
        raise RuntimeError("Exactly one source PDF is required")
    settings.basic.input_files = set()
    emit("Preparing translation resources")
    babeldoc.assets.assets.warmup()
    finished = False
    async for event in do_translate_async_stream(settings, files[0]):
        if event["type"] in ("progress_start", "progress_update", "progress_end"):
            emit(event.get("stage", "Translating"), event.get("overall_progress"),
                 event.get("stage_current"), event.get("stage_total"))
        elif event["type"] == "finish":
            finished = True
            emit("Verifying bilingual PDF", 100)
            break
        elif event["type"] == "error":
            raise RuntimeError(str(event.get("error", "Translation failed")))
    if not finished:
        raise RuntimeError("Translation ended without a completed PDF")


if __name__ == "__main__":
    # Required by the installed engine's Windows multiprocessing workers.
    import multiprocessing
    multiprocessing.freeze_support()
    try:
        asyncio.run(main())
    except Exception as error:
        print(f"Translation failed: {error}", file=sys.stderr, flush=True)
        sys.exit(1)
