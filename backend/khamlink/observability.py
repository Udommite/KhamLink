import json
import logging
import queue
import re
import threading
from collections import Counter, deque

from .db import TelemetryEvent, now

logger = logging.getLogger("khamlink")
PRODUCT_EVENTS = {
    "search_submitted",
    "search_result_viewed",
    "search_result_clicked",
    "word_card_viewed",
    "related_word_clicked",
    "word_compare_started",
    "word_compare_completed",
    "context_analysis_requested",
    "word_map_opened",
    "source_opened",
    "feedback_positive",
    "feedback_negative",
    "result_reported",
}
DIMENSIONS = {
    "status",
    "mode",
    "dependency",
    "degraded",
    "count",
    "length",
    "rank",
    "word_id",
    "definition_id",
    "source_id",
    "source_version",
    "dataset_id",
    "search_id",
    "from_id",
    "to_id",
    "relationship_type",
    "target_id",
    "target_type",
    "method",
    "route",
    "error_code",
    "http_status",
}
VALUE = re.compile(r"^[a-zA-Z0-9_./{}:-]{1,120}$")


def configure_logging():
    """Enable minimized JSON records without enabling third-party request logs."""
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(message)s"))
    logger.handlers[:] = [handler]
    logger.setLevel(logging.INFO)
    logger.propagate = False


class Telemetry:
    def __init__(self, settings, sessions):
        self.settings, self.sessions = settings, sessions
        self.counts, self.recent = Counter(), deque(maxlen=200)
        self.failures = 0
        self.lock = threading.Lock()
        self.drained = threading.Condition(self.lock)
        self.queue = queue.Queue(maxsize=1024)
        self.pending = 0
        self.closed = False
        self.worker = None

    def _start_worker(self):
        if self.worker is None or not self.worker.is_alive():
            self.worker = threading.Thread(target=self._run, name="khamlink-telemetry", daemon=True)
            self.worker.start()

    def start(self):
        with self.lock:
            self.closed = False
            self._start_worker()

    def _run(self):
        while True:
            try:
                record, product = self.queue.get(timeout=0.1)
            except queue.Empty:
                with self.lock:
                    if self.closed:
                        return
                continue
            try:
                if product:
                    with self.sessions.begin() as session:
                        session.add(TelemetryEvent(**record))
                else:
                    logger.info(json.dumps(record, ensure_ascii=False))
            except Exception:
                with self.lock:
                    self.failures += 1
            finally:
                self.queue.task_done()
                with self.drained:
                    self.pending -= 1
                    self.drained.notify_all()

    def flush(self, timeout=1.0):
        """Bounded drain for shutdown/tests only, never the request path."""
        with self.drained:
            return self.drained.wait_for(lambda: self.pending == 0, timeout=timeout)

    def close(self):
        with self.lock:
            self.closed = True
        if self.worker is not None:
            self.worker.join(timeout=1.0)

    def emit(self, name, correlation_id, dimensions, duration_ms=None, product=False):
        if product and (not self.settings.analytics_enabled or name not in PRODUCT_EVENTS):
            return
        safe = {
            key: value
            for key, value in dimensions.items()
            if key in DIMENSIONS
            and (
                (isinstance(value, (int, float, bool)) and not isinstance(value, complex))
                or (isinstance(value, str) and VALUE.fullmatch(value))
            )
        }
        record = {
            "occurred_at": now(),
            "environment": self.settings.environment,
            "name": name,
            "correlation_id": correlation_id,
            "dimensions": safe,
            "duration_ms": round(duration_ms, 2) if duration_ms is not None else None,
        }
        with self.lock:
            self.counts[name + ":" + str(safe.get("status", "ok"))] += 1
            self.recent.append(record)
            if self.closed:
                self.failures += 1
                return
            self._start_worker()
            try:
                self.queue.put_nowait((record, product))
                self.pending += 1
            except queue.Full:
                # A slow sink may lose noncritical telemetry, never dictionary access.
                self.failures += 1

    def snapshot(self):
        with self.lock:
            return {
                "counters": dict(self.counts),
                "recent": list(self.recent),
                "telemetry_failures": self.failures,
                "telemetry_pending": self.pending,
                "alerts": ["telemetry_unavailable"] if self.failures else [],
            }
