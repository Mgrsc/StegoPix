FROM python:3.14-slim

COPY --from=oven/bun:latest /usr/local/bin/bun /usr/local/bin/bun

RUN apt-get update && \
    apt-get install -y tini libgl1 libglib2.0-0 && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY frontend/package.json .
RUN bun install

COPY . .

RUN echo '#!/bin/sh' > start.sh && \
    echo 'python backend/main.py &' >> start.sh && \
    echo 'cd frontend && bun run dev --host' >> start.sh && \
    chmod +x start.sh

EXPOSE 8000 5173

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["./start.sh"]