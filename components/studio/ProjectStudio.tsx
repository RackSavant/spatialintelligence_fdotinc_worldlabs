"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

interface Photo { id: string; url: string; contentType: string }
interface Edit { id: string; url: string; prompt: string; model: string; parentEditId: string | null }
interface World {
  id: string;
  status: string;
  model: string;
  sourceEditId: string | null;
  metricScaleFactor: number | null;
}
interface ProjectState {
  project: { id: string; name: string };
  photos: Photo[];
  edits: Edit[];
  worlds: World[];
}

const MODELS = [
  { id: "gemini-3-pro-image", label: "Nano Banana Pro — higher fidelity" },
  { id: "gemini-3.1-flash-image", label: "Nano Banana Flash — cheaper, faster" },
];

export function ProjectStudio({ projectId }: { projectId: string }) {
  const [state, setState] = useState<ProjectState | null>(null);
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState(MODELS[0].id);
  const [parentEditId, setParentEditId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [generating, setGenerating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}`);
    if (res.ok) setState(await res.json());
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const [worldStatus, setWorldStatus] = useState<{ status: string; progress: number | null } | null>(
    null,
  );

  useEffect(() => {
    if (!generating) return;
    let stop = false;
    const tick = async () => {
      const res = await fetch(`/api/worlds/${generating}`);
      if (!res.ok || stop) return;
      const { world, job } = await res.json();
      setWorldStatus({ status: world.status, progress: job?.progress ?? null });
      if (world.status === "succeeded" || world.status === "failed") {
        setGenerating(null);
        await refresh();
        return;
      }
      if (!stop) setTimeout(tick, 5000);
    };
    void tick();
    return () => {
      stop = true;
    };
  }, [generating, refresh]);

  async function upload(file: File) {
    setBusy("Uploading photo…");
    setError(null);
    try {
      const res = await fetch("/api/uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, fileName: file.name, contentType: file.type }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "upload init failed");
      const { upload } = await res.json();

      // Bytes go straight to storage, never through the API route.
      const put = await fetch(upload.url, {
        method: upload.method,
        headers: upload.headers,
        body: file,
      });
      if (!put.ok) throw new Error(`storage rejected the upload (${put.status})`);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function runEdit() {
    const photo = state?.photos[0];
    if (!photo || !prompt.trim()) return;
    setBusy("Editing with Nano Banana…");
    setError(null);
    try {
      const res = await fetch("/api/edits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, photoId: photo.id, parentEditId, prompt, model }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "edit failed");
      setPrompt("");
      setParentEditId(json.edit.id); // chain from the result by default
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function generateWorld() {
    const photo = state?.photos[0];
    if (!photo) return;
    setError(null);
    try {
      const res = await fetch("/api/worlds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          editId: parentEditId ?? undefined,
          photoId: parentEditId ? undefined : photo.id,
          model: "marble-1.1",
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "could not start generation");
      setGenerating(json.world.id);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (!state) return <p className="p-8 font-mono text-sm text-white/50">loading…</p>;

  const photo = state.photos[0];
  const source = parentEditId ? state.edits.find((e) => e.id === parentEditId) : null;

  return (
    <div className="mx-auto max-w-5xl p-8">
      <h1 className="mb-1 text-xl font-semibold">{state.project.name}</h1>
      <p className="mb-6 font-mono text-xs text-white/40">{projectId}</p>

      {error && (
        <p className="mb-4 rounded border border-red-500/40 bg-red-500/10 p-3 font-mono text-xs text-red-300">
          {error}
        </p>
      )}

      {!photo ? (
        <div className="rounded border border-dashed border-white/20 p-10 text-center">
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
          />
          <button
            onClick={() => fileRef.current?.click()}
            className="rounded bg-white px-4 py-2 text-sm font-medium text-black hover:bg-white/90"
          >
            Upload a room photo
          </button>
        </div>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-[1fr_2fr] gap-6">
            <div>
              <p className="mb-2 font-mono text-xs text-white/40">source</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={source?.url ?? photo.url}
                alt="edit source"
                className="w-full rounded border border-white/10"
              />
              {source && (
                <button
                  onClick={() => setParentEditId(null)}
                  className="mt-2 font-mono text-xs text-white/50 underline hover:text-white"
                >
                  reset to original photo
                </button>
              )}
            </div>

            <div className="flex flex-col gap-3">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe the change — e.g. remove the clutter, warm afternoon light, bare walls"
                rows={5}
                className="w-full resize-none rounded border border-white/15 bg-white/5 p-3 text-sm outline-none focus:border-white/40"
              />
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="rounded border border-white/15 bg-white/5 p-2 text-sm outline-none"
              >
                {MODELS.map((m) => (
                  <option key={m.id} value={m.id} className="bg-black">
                    {m.label}
                  </option>
                ))}
              </select>
              <button
                onClick={runEdit}
                disabled={!!busy || !prompt.trim()}
                className="rounded bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-40"
              >
                {busy ?? "Run edit"}
              </button>
            </div>
          </div>

          <div className="mb-6 flex items-center gap-3 rounded border border-white/10 p-4">
            <button
              onClick={generateWorld}
              disabled={!!generating}
              className="rounded bg-green-400 px-4 py-2 text-sm font-medium text-black disabled:opacity-40"
            >
              {generating ? "Generating 3D world…" : "Generate 3D world"}
            </button>
            <span className="font-mono text-xs text-white/40">
              {generating
                ? `${worldStatus?.status ?? "queued"}${
                    worldStatus?.progress != null ? ` · ${worldStatus.progress}%` : ""
                  } — takes several minutes`
                : `from ${source ? "the selected edit" : "the original photo"}`}
            </span>
          </div>

          {state.worlds.length > 0 && (
            <div className="mb-6">
              <p className="mb-2 font-mono text-xs text-white/40">worlds</p>
              <ul className="divide-y divide-white/10 rounded border border-white/10">
                {state.worlds.map((w) => (
                  <li key={w.id} className="flex items-center justify-between px-4 py-2 text-sm">
                    <span className="font-mono text-xs">
                      {w.model} · {w.status}
                      {w.metricScaleFactor != null && w.metricScaleFactor !== 1 && (
                        <span className="text-white/40"> · metric scale ok</span>
                      )}
                    </span>
                    {w.status === "succeeded" && (
                      <Link
                        href={`/viewer?world=${w.id}`}
                        className="rounded bg-white px-3 py-1 text-xs font-medium text-black"
                      >
                        Open in viewer
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {state.edits.length > 0 && (
            <>
              <p className="mb-2 font-mono text-xs text-white/40">
                history — click one to branch from it
              </p>
              <div className="grid grid-cols-4 gap-3">
                {state.edits.map((edit) => (
                  <button
                    key={edit.id}
                    onClick={() => setParentEditId(edit.id)}
                    className={`overflow-hidden rounded border text-left ${
                      parentEditId === edit.id ? "border-green-400" : "border-white/10"
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={edit.url} alt={edit.prompt} className="aspect-square w-full object-cover" />
                    <p className="line-clamp-2 p-2 font-mono text-[10px] text-white/60">{edit.prompt}</p>
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
