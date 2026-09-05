#!/usr/bin/env python3
"""Edit a video with Gemini Omni Flash 1.1 on fal.ai and download the result."""
import argparse, json, os, pathlib, subprocess, sys, time, urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]

def load_env():
    p = ROOT / ".env"
    if p.exists():
        for line in p.read_text().splitlines():
            if "=" in line and not line.strip().startswith("#"):
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--output", required=True)
    ap.add_argument("--prompt-file", required=True)
    ap.add_argument("--resolution", default="1080p", choices=["360p", "720p", "1080p", "4k"])
    args = ap.parse_args()
    load_env()
    if not os.environ.get("FAL_KEY"):
        sys.exit("FAL_KEY missing (put it in .env)")
    import fal_client

    prompt = pathlib.Path(args.prompt_file).read_text().strip()
    t0 = time.time()
    print(f"[upload] {args.input}", flush=True)
    video_url = fal_client.upload_file(args.input)
    print(f"[upload] done in {time.time()-t0:.1f}s", flush=True)

    def on_update(u):
        if isinstance(u, fal_client.InProgress):
            for log in (u.logs or []):
                print("[fal]", log.get("message", ""), flush=True)

    print(f"[edit] resolution={args.resolution}", flush=True)
    result = fal_client.subscribe(
        "google/gemini-omni-flash/v1.1/edit",
        arguments={"video_url": video_url, "prompt": prompt, "resolution": args.resolution},
        with_logs=True,
        on_queue_update=on_update,
    )
    print(f"[edit] done in {time.time()-t0:.1f}s", flush=True)
    out = pathlib.Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.with_suffix(".json").write_text(json.dumps(result, indent=2))
    url = result["video"]["url"]
    print(f"[download] {url}", flush=True)
    urllib.request.urlretrieve(url, out)
    print(f"[saved] {out} ({out.stat().st_size/1e6:.1f} MB)", flush=True)
    subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=width,height",
                    "-of", "default=nw=1", str(out)])

if __name__ == "__main__":
    main()
