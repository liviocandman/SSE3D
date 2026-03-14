FROM python:3.12-slim

WORKDIR /app

# Instalar poetry
RUN pip install poetry==1.8.3
RUN poetry config virtualenvs.create false

# Dependências
COPY pyproject.toml poetry.lock ./
RUN poetry install --no-dev --no-interaction

# Código
COPY app/ ./app/
COPY alembic/ ./alembic/
COPY alembic.ini .

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
