#!/usr/bin/env python3
"""
Faster Whisper API Server with GPU Support for macOS
Optimized for Apple Silicon (M1/M2/M3)
"""

import os
import sys
import time
import logging
import subprocess
from pathlib import Path
from flask import Flask, request, jsonify
from flask_cors import CORS
from faster_whisper import WhisperModel
import torch
from pydub import AudioSegment

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

# Configuration
WHISPER_MODEL = os.getenv('WHISPER_MODEL', 'large-v3-turbo')
AUDIO_DIR = Path('/app/audio')
AUDIO_DIR.mkdir(exist_ok=True)

# Global model variable
model = None

def get_device():
    """Detect best available device for inference"""
    if torch.cuda.is_available():
        logger.info("CUDA GPU detected")
        return "cuda", "float16"
    elif hasattr(torch.backends, 'mps') and torch.backends.mps.is_available():
        logger.info("Apple Metal GPU detected")
        return "cpu", "int8"  # faster-whisper doesn't support MPS directly
    else:
        logger.info("Using CPU")
        return "cpu", "int8"

def load_model():
    """Load Whisper model with optimal settings"""
    global model

    try:
        device, compute_type = get_device()
        logger.info(f"Loading {WHISPER_MODEL} model on {device} with {compute_type}")

        # Get number of CPU threads from environment
        cpu_threads = int(os.getenv('OMP_NUM_THREADS', '8'))
        
        # Set additional threading environment variables for CTranslate2
        os.environ['CT2_VERBOSE'] = '1'
        
        model = WhisperModel(
            WHISPER_MODEL,
            device=device,
            compute_type=compute_type,
            download_root="/app/models",
            cpu_threads=cpu_threads,      # Threads for model inference
            num_workers=cpu_threads // 2  # Workers for parallel processing
        )

        logger.info(f"Model {WHISPER_MODEL} loaded with {cpu_threads} CPU threads")
        return True
    except Exception as e:
        logger.error(f"Failed to load model: {e}")
        return False

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    if model is None:
        return jsonify({'status': 'unhealthy', 'message': 'Model not loaded'}), 503
    return jsonify({'status': 'healthy', 'model': WHISPER_MODEL}), 200

@app.route('/transcribe', methods=['POST'])
def transcribe():
    """Transcribe audio file"""
    if model is None:
        return jsonify({'error': 'Model not loaded'}), 503

    try:
        # Check if file is present
        if 'audio' not in request.files:
            return jsonify({'error': 'No audio file provided'}), 400

        audio_file = request.files['audio']
        if audio_file.filename == '':
            return jsonify({'error': 'Empty filename'}), 400

        # Get optional parameters
        language = request.form.get('language', None)
        task = request.form.get('task', 'transcribe')  # transcribe or translate

        # Save audio file temporarily
        timestamp = int(time.time() * 1000)
        original_path = AUDIO_DIR / f"{timestamp}_{audio_file.filename}"
        audio_file.save(original_path)
        
        # Convert to WAV for better compatibility (WebM/Opus from browsers can be problematic)
        audio_path = AUDIO_DIR / f"{timestamp}_converted.wav"
        conversion_success = False
        
        # Try FFmpeg first
        try:
            result = subprocess.run([
                'ffmpeg', '-y', '-i', str(original_path),
                '-ar', '16000',  # 16kHz sample rate (optimal for Whisper)
                '-ac', '1',      # Mono
                '-c:a', 'pcm_s16le',  # 16-bit PCM
                str(audio_path)
            ], capture_output=True, text=True, timeout=30)
            
            if result.returncode == 0 and audio_path.exists() and audio_path.stat().st_size > 0:
                conversion_success = True
                original_path.unlink(missing_ok=True)
                logger.info(f"FFmpeg conversion successful: {audio_path}")
            else:
                logger.warning(f"FFmpeg conversion failed: {result.stderr}")
        except Exception as ffmpeg_error:
            logger.warning(f"FFmpeg conversion error: {ffmpeg_error}")
        
        # If FFmpeg failed, try pydub
        if not conversion_success:
            try:
                logger.info("Trying pydub for audio conversion...")
                audio = AudioSegment.from_file(str(original_path), format="webm")
                audio = audio.set_frame_rate(16000).set_channels(1)
                audio.export(str(audio_path), format="wav")
                conversion_success = True
                original_path.unlink(missing_ok=True)
                logger.info(f"Pydub conversion successful: {audio_path}")
            except Exception as pydub_error:
                logger.warning(f"Pydub conversion also failed: {pydub_error}")
        
        # If all conversions failed, try using original file
        if not conversion_success:
            logger.warning("All conversions failed, attempting to use original file")
            audio_path = original_path

        logger.info(f"Transcribing {audio_path}")

        # Transcribe with optimized settings for speed
        start_time = time.time()
        segments, info = model.transcribe(
            str(audio_path),
            language=language,
            task=task,
            beam_size=1,  # Reduced from 5 for faster processing
            best_of=1,    # Faster decoding
            vad_filter=True,
            vad_parameters=dict(min_silence_duration_ms=300)
        )

        # Collect results
        transcription = []
        full_text = []

        for segment in segments:
            transcription.append({
                'start': segment.start,
                'end': segment.end,
                'text': segment.text.strip(),
                'confidence': segment.avg_logprob
            })
            full_text.append(segment.text.strip())

        elapsed_time = time.time() - start_time

        # Clean up audio files
        audio_path.unlink(missing_ok=True)
        original_path.unlink(missing_ok=True)

        logger.info(f"Transcription completed in {elapsed_time:.2f}s")

        return jsonify({
            'success': True,
            'language': info.language,
            'language_probability': info.language_probability,
            'duration': info.duration,
            'transcription_time': elapsed_time,
            'text': ' '.join(full_text),
            'segments': transcription
        }), 200

    except Exception as e:
        logger.error(f"Transcription error: {e}")
        # Clean up any remaining files
        try:
            if 'audio_path' in locals():
                audio_path.unlink(missing_ok=True)
            if 'original_path' in locals():
                original_path.unlink(missing_ok=True)
        except:
            pass
        return jsonify({'error': str(e)}), 500

@app.route('/transcribe_url', methods=['POST'])
def transcribe_url():
    """Transcribe audio from URL"""
    if model is None:
        return jsonify({'error': 'Model not loaded'}), 503

    try:
        data = request.get_json()
        if not data or 'url' not in data:
            return jsonify({'error': 'No URL provided'}), 400

        url = data['url']
        language = data.get('language', None)
        task = data.get('task', 'transcribe')

        logger.info(f"Transcribing from URL: {url}")

        # Transcribe
        start_time = time.time()
        segments, info = model.transcribe(
            url,
            language=language,
            task=task,
            beam_size=5,
            vad_filter=True,
            vad_parameters=dict(min_silence_duration_ms=500)
        )

        # Collect results
        transcription = []
        full_text = []

        for segment in segments:
            transcription.append({
                'start': segment.start,
                'end': segment.end,
                'text': segment.text.strip(),
                'confidence': segment.avg_logprob
            })
            full_text.append(segment.text.strip())

        elapsed_time = time.time() - start_time

        logger.info(f"Transcription completed in {elapsed_time:.2f}s")

        return jsonify({
            'success': True,
            'language': info.language,
            'language_probability': info.language_probability,
            'duration': info.duration,
            'transcription_time': elapsed_time,
            'text': ' '.join(full_text),
            'segments': transcription
        }), 200

    except Exception as e:
        logger.error(f"Transcription error: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/info', methods=['GET'])
def get_info():
    """Get model information"""
    device, compute_type = get_device()
    return jsonify({
        'model': WHISPER_MODEL,
        'device': device,
        'compute_type': compute_type,
        'torch_version': torch.__version__,
        'cuda_available': torch.cuda.is_available(),
        'mps_available': hasattr(torch.backends, 'mps') and torch.backends.mps.is_available()
    }), 200

if __name__ == '__main__':
    logger.info("Starting Faster Whisper Server")

    # Load model at startup
    if not load_model():
        logger.error("Failed to load model. Exiting.")
        sys.exit(1)

    # Start Flask server
    app.run(host='0.0.0.0', port=5000, debug=False)
