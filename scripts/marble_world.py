#!/usr/bin/env python3
"""Generate a Marble (World Labs) world from a video and download its assets.

  scripts/marble_world.py --video out/dragon_full_720p.mp4 --name dragon-hall --text-prompt "..."
  scripts/marble_world.py --world-id <id> --name dragon-hall     # download an existing world
  scripts/marble_world.py --check                                 # verify key / credits

Needs WORLDLABS_API_KEY in .env (platform.worldlabs.ai, redeem code WORLD-MODEL-HACK-API).
"""
import argparse, json, mimetypes, os, pathlib, sys, time, urllib.parse, urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
BASE = "https://api.worldlabs.ai/marble/v1"

def load_env():
    p = ROOT / ".env"
    if p.exists():
        for line in p.read_text().splitlines():
            if "=" in line and not line.strip().startswith("#"):
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

def api(method, path, body=None, key=None, raw_url=None, headers=None, data=None):
    url = raw_url or (BASE + path)
    h = {"WLT-Api-Key": key} if key else {}
    if headers: h.update(headers)
    if body is not None:
        data = json.dumps(body).encode(); h["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=900) as r:
            txt = r.read()
            return json.loads(txt) if txt and "json" in (r.headers.get_content_type() or "") else txt
    except urllib.error.HTTPError as e:
        sys.exit(f"HTTP {e.code} {method} {url}\n{e.read().decode(errors='replace')[:2000]}")

def upload_video(path, key):
    p = pathlib.Path(path)
    prep = api("POST", "/media-assets:prepare_upload", key=key,
               body={"file_name": p.name, "extension": p.suffix.lstrip(".").lower(), "kind": "video"})
    asset_id = prep["media_asset"]["media_asset_id"]
    info = prep["upload_info"]
    hdrs = dict(info.get("required_headers") or {})
    hdrs.setdefault("Content-Type", mimetypes.guess_type(p.name)[0] or "video/mp4")
    print(f"[upload] {p.name} ({p.stat().st_size/1e6:.1f} MB) -> media_asset {asset_id}", flush=True)
    api("PUT", None, raw_url=info["upload_url"], headers=hdrs, data=p.read_bytes())
    return asset_id

def poll(op_id, key, every=15, max_minutes=40):
    t0 = time.time(); last = None
    while time.time() - t0 < max_minutes * 60:
        op = api("GET", f"/operations/{op_id}", key=key)
        msg = json.dumps(op.get("metadata") or {})[:140]
        if msg != last:
            print(f"[poll] {int(time.time()-t0)}s done={op.get('done')} {msg}", flush=True); last = msg
        if op.get("done"):
            if op.get("error"):
                sys.exit(f"[error] {json.dumps(op['error'], indent=2)}")
            return op
        time.sleep(every)
    sys.exit("timed out waiting for operation")

def walk_urls(obj, prefix=""):
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield from walk_urls(v, f"{prefix}.{k}" if prefix else k)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            yield from walk_urls(v, f"{prefix}[{i}]")
    elif isinstance(obj, str) and obj.startswith("http"):
        yield prefix, obj

def download_assets(world, out_dir):
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "world.json").write_text(json.dumps(world, indent=2))
    assets = world.get("assets") or {}
    for path, url in walk_urls(assets):
        ext = pathlib.Path(urllib.parse.urlparse(url).path).suffix or ""
        name = path.replace(".", "_").replace("[", "_").replace("]", "") + ext
        dest = out_dir / name
        try:
            urllib.request.urlretrieve(url, dest)
            print(f"[saved] {dest} ({dest.stat().st_size/1e6:.1f} MB)", flush=True)
        except Exception as e:
            print(f"[skip] {name}: {e}", flush=True)
    sem = None
    if isinstance(assets.get("splats"), dict):
        sem = assets["splats"].get("semantics_metadata")
    if sem: print(f"[semantics] {json.dumps(sem)}")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video"); ap.add_argument("--world-id"); ap.add_argument("--check", action="store_true")
    ap.add_argument("--name", default="world"); ap.add_argument("--model", default="marble-1.1")
    ap.add_argument("--text-prompt", default=None); ap.add_argument("--out-dir", default=None)
    ap.add_argument("--no-download", action="store_true")
    a = ap.parse_args()
    load_env(); key = os.environ.get("WORLDLABS_API_KEY")
    if not key: sys.exit("WORLDLABS_API_KEY missing in .env")
    if a.check:
        print(json.dumps(api("GET", "/credits", key=key), indent=2)); return
    out_dir = pathlib.Path(a.out_dir or ROOT / "out" / "marble" / a.name)
    if a.world_id:
        world = api("GET", f"/worlds/{a.world_id}", key=key)
    else:
        if not a.video: sys.exit("--video or --world-id required")
        asset_id = upload_video(a.video, key)
        body = {"display_name": a.name[:64], "model": a.model,
                "world_prompt": {"type": "video",
                                 "video_prompt": {"source": "media_asset", "media_asset_id": asset_id}}}
        if a.text_prompt: body["world_prompt"]["text_prompt"] = a.text_prompt
        gen = api("POST", "/worlds:generate", key=key, body=body)
        op_id = gen["operation_id"]
        print(f"[generate] operation {op_id} model={a.model}", flush=True)
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / "operation.json").write_text(json.dumps(gen, indent=2))
        op = poll(op_id, key)
        world = op["response"]
        if op.get("cost"): print(f"[cost] {json.dumps(op['cost'])}")
    print(f"[world] {world.get('world_id')}  {world.get('world_marble_url')}", flush=True)
    if not a.no_download: download_assets(world, out_dir)

if __name__ == "__main__":
    main()
