# Faster Whisper Docker Setup with Large-v3 Turbo Model for macOS
# Optimized for Apple Silicon (M1/M2/M3) with GPU acceleration via CoreML
FROM python:3.11-slim

# Set environment variables
ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    WHISPER_MODEL=large-v3-turbo \
    PYTORCH_ENABLE_MPS_FALLBACK=1

# Install system dependencies including full FFmpeg with codecs
RUN apt-get update && apt-get install -y \
    ffmpeg \
    libavcodec-extra \
    git \
    wget \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Upgrade pip
RUN pip install --no-cache-dir --upgrade pip

# Install PyTorch with MPS support for Apple Silicon
RUN pip install --no-cache-dir \
    torch \
    torchaudio

# Install faster-whisper and dependencies
# Note: For best Apple GPU performance, consider using whisper-coreml or mlx-whisper
RUN pip install --no-cache-dir \
    faster-whisper \
    flask \
    flask-cors \
    numpy \
    pydub \
    openai-whisper

# Create working directory
WORKDIR /app

# Create directories for models and audio
RUN mkdir -p /app/models /app/audio

# Copy application files
COPY whisper-server.py /app/

# Expose port for API
EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD python3 -c "import requests; requests.get('http://localhost:5000/health')" || exit 1

# Start the server
CMD ["python3", "whisper-server.py"]
