#!/usr/bin/env bash
# Join the untouched head of the original clip with an Omni-edited tail segment.
# usage: scripts/stitch.sh <original.mp4> <head_seconds> <edited_tail.mp4> <output.mp4>
set -euo pipefail
ORIG="$1"; HEAD="$2"; TAIL="$3"; OUT="$4"
W=$(ffprobe -v error -select_streams v:0 -show_entries stream=width -of csv=p=0 "$TAIL")
H=$(ffprobe -v error -select_streams v:0 -show_entries stream=height -of csv=p=0 "$TAIL")
FPS=$(ffprobe -v error -select_streams v:0 -show_entries stream=r_frame_rate -of csv=p=0 "$TAIL")
echo "tail is ${W}x${H} @ ${FPS}; head = first ${HEAD}s of $ORIG"
ffmpeg -v error -y -i "$ORIG" -i "$TAIL" -filter_complex \
  "[0:v]trim=0:${HEAD},setpts=PTS-STARTPTS,scale=${W}:${H}:flags=lanczos,fps=${FPS},format=yuv420p[v0]; \
   [0:a]atrim=0:${HEAD},asetpts=PTS-STARTPTS[a0]; \
   [1:v]fps=${FPS},format=yuv420p[v1]; \
   [1:a]asetpts=PTS-STARTPTS[a1]; \
   [v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]" \
  -map "[v]" -map "[a]" -c:v libx264 -preset medium -crf 18 -c:a aac -b:a 160k -movflags +faststart "$OUT"
ffprobe -v error -show_entries format=duration:stream=width,height,r_frame_rate -of default=nw=1 "$OUT"
