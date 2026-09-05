"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Project { id: string; name: string; createdAt: string }

export function ProjectList() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const res = await fetch("/api/projects");
    if (res.ok) setProjects((await res.json()).projects);
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function create() {
    setBusy(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        setName("");
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl p-8">
      <h1 className="mb-1 text-xl font-semibold">Marble Hack</h1>
      <p className="mb-8 text-sm text-white/50">
        Photo → Nano Banana edit → Marble world → furnished 3D scene.
      </p>

      <div className="mb-8 flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && create()}
          placeholder="New project name"
          className="flex-1 rounded border border-white/15 bg-white/5 px-3 py-2 text-sm outline-none focus:border-white/40"
        />
        <button
          onClick={create}
          disabled={busy}
          className="rounded bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-40"
        >
          Create
        </button>
      </div>

      {projects === null ? (
        <p className="font-mono text-sm text-white/40">loading…</p>
      ) : projects.length === 0 ? (
        <p className="font-mono text-sm text-white/40">No projects yet.</p>
      ) : (
        <ul className="divide-y divide-white/10 rounded border border-white/10">
          {projects.map((p) => (
            <li key={p.id}>
              <Link href={`/projects/${p.id}`} className="block px-4 py-3 text-sm hover:bg-white/5">
                {p.name}
                <span className="ml-2 font-mono text-xs text-white/30">
                  {new Date(p.createdAt).toLocaleDateString()}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-8 font-mono text-xs text-white/30">
        Splat viewer: <Link href="/viewer" className="underline">/viewer</Link>
      </p>
    </div>
  );
}
