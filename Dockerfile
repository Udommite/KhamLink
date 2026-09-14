FROM node:24-bookworm-slim AS frontend
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PYTHONIOENCODING=utf-8 KHAMLINK_PROJECT_ROOT=/app
WORKDIR /app
COPY requirements.lock pyproject.toml alembic.ini ./
RUN pip install --no-cache-dir -r requirements.lock
COPY backend/ backend/
COPY migrations/ migrations/
COPY sources/ sources/
COPY THIRD_PARTY_NOTICES.md ./
RUN pip install --no-cache-dir --no-deps . && useradd --uid 10001 --create-home khamlink && mkdir -p /app/data && chown 10001:10001 /app/data
COPY --from=frontend /build/frontend/dist frontend/dist/
USER 10001:10001
EXPOSE 8000
CMD ["python", "-m", "khamlink.cli", "demo", "--host", "0.0.0.0"]
