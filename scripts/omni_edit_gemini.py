#!/usr/bin/env python3
"""Fallback: edit a video with gemini-omni-1.1-flash directly via the Gemini API.
Requires GEMINI_API_KEY in .env and `pip install google-genai`. Untested until a key is available.
Follows the pattern in https://ai.google.dev/gemini-api/docs/omni (Interactions API)."""
import argparse, os, pathlib, sys, time

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
    args = ap.parse_args()
    load_env()
    if not os.environ.get("GEMINI_API_KEY"):
        sys.exit("GEMINI_API_KEY missing (put it in .env)")
    from google import genai

    client = genai.Client()
    prompt = pathlib.Path(args.prompt_file).read_text().strip()
    print("[upload]", args.input, flush=True)
    f = client.files.upload(file=args.input)
    while getattr(f.state, "name", str(f.state)) == "PROCESSING":
        time.sleep(3)
        f = client.files.get(name=f.name)
    print("[edit] gemini-omni-1.1-flash", flush=True)
    interaction = client.interactions.create(
        model="gemini-omni-1.1-flash",
        input=[{"type": "document", "uri": f.uri}, {"type": "text", "text": prompt}],
    )
    # Poll until the interaction finishes and a video output is present.
    while True:
        status = getattr(interaction, "status", None)
        outputs = getattr(interaction, "outputs", None) or []
        videos = [o for o in outputs if getattr(o, "type", "") == "video"]
        if videos or status in ("completed", "failed"):
            break
        time.sleep(5)
        interaction = client.interactions.get(interaction.id)
    if not videos:
        sys.exit(f"no video output; status={status}; raw={interaction}")
    out = pathlib.Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    data = videos[0]
    if getattr(data, "data", None):
        import base64
        out.write_bytes(base64.b64decode(data.data))
    else:
        client.files.download(file=data.uri, download_path=str(out))
    print("[saved]", out, flush=True)

if __name__ == "__main__":
    main()
