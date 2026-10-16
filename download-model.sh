#!/usr/bin/env sh
# Optional: download the hand model once so the app works fully offline.
curl -L -o vendor/hand_landmarker.task \
  https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task
