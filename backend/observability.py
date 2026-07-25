"""
Observability bootstrap — call setup_observability(app) inside lifespan
before yielding. Adds:
  - Prometheus /metrics endpoint (request latency, count, in-flight)
  - structlog JSON logging with request-id correlation
  - Global exception handler that logs tracebacks with context
"""

from __future__ import annotations

import time
import traceback
import uuid
from typing import Callable

import structlog
from fastapi import FastAPI, Request, Response
from prometheus_fastapi_instrumentator import Instrumentator
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse


# ── structlog configuration ───────────────────────────────────────────────────

def configure_logging(log_level: str = "INFO") -> None:
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.stdlib.add_log_level,
            structlog.stdlib.add_logger_name,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(
            structlog.stdlib._NAME_TO_LEVEL[log_level.lower()]
        ),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )


# ── Request-ID middleware ─────────────────────────────────────────────────────

class RequestIDMiddleware(BaseHTTPMiddleware):
    """
    Generates a unique request-id for every inbound request and binds it
    to structlog's context vars so all log lines in that request share it.
    Also injects X-Request-ID into the response header.
    """

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        request_id = request.headers.get("X-Request-ID", str(uuid.uuid4()))
        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(
            request_id=request_id,
            method=request.method,
            path=request.url.path,
        )

        start = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            structlog.get_logger().error(
                "Unhandled exception",
                traceback=traceback.format_exc(),
            )
            response = JSONResponse(
                status_code=500,
                content={"detail": "Internal server error."},
            )

        duration_ms = round((time.perf_counter() - start) * 1000, 2)
        structlog.get_logger().info(
            "Request completed",
            status_code=response.status_code,
            duration_ms=duration_ms,
        )

        response.headers["X-Request-ID"] = request_id
        return response


# ── Global exception handler ──────────────────────────────────────────────────

async def global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    structlog.get_logger(__name__).error(
        "Unhandled exception in route handler",
        exc_type=type(exc).__name__,
        traceback=traceback.format_exc(),
        path=request.url.path,
    )
    return JSONResponse(
        status_code=500,
        content={"detail": "An unexpected error occurred. Please try again."},
    )


# ── Prometheus setup ──────────────────────────────────────────────────────────

def setup_prometheus(app: FastAPI) -> None:
    Instrumentator(
        should_group_status_codes=True,
        should_ignore_untemplated=True,
        should_group_untemplated=True,
        excluded_handlers=["/api/health", "/metrics"],
    ).instrument(app).expose(app, endpoint="/metrics", include_in_schema=False)


# ── One-shot bootstrap ────────────────────────────────────────────────────────

def setup_observability(app: FastAPI, log_level: str = "INFO") -> None:
    configure_logging(log_level)
    app.add_middleware(RequestIDMiddleware)
    app.add_exception_handler(Exception, global_exception_handler)
    setup_prometheus(app)
