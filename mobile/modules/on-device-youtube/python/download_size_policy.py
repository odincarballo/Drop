# Generated from download-size-policy.json. Do not edit manually.
STANDARD_VIDEO_MAX_BYTES = 1024 * 1024 * 1024
PHASE_ONE_1080_MAX_BYTES = 50 * 1024 * 1024
MAX_AUDIO_BYTES = 250 * 1024 * 1024
QUALITY_TOLERANCE = 16

def video_max_bytes(height):
    if height is not None and (abs(height - 360) <= QUALITY_TOLERANCE or abs(height - 720) <= QUALITY_TOLERANCE):
        return STANDARD_VIDEO_MAX_BYTES
    return PHASE_ONE_1080_MAX_BYTES
