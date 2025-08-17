// app/login/page.tsx
"use client";

import React, { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const search = useSearchParams();
  const next = search.get("next") || "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErr(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();
      if (!res.ok) {
        setErr(data?.message || "Login failed");
        setSubmitting(false);
        return;
      }

      // Optional: save token for client-side usage (e.g., socket auth)
      if (data?.access_token) {
        localStorage.setItem("access_token", data.access_token);
      }

      // You could also stash minimal user info
      if (data?.user) localStorage.setItem("user", JSON.stringify(data.user));

      router.replace(next);
    } catch (e) {
      setErr("Network error");
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen grid place-items-center bg-slate-50">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm bg-white shadow rounded-2xl p-6 space-y-4"
      >
        <h1 className="text-xl font-semibold">Sign in</h1>

        {err && (
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
            {err}
          </div>
        )}

        <div className="space-y-1">
          <label className="text-sm text-slate-700">Email</label>
          <input
            className="w-full px-3 py-2 border rounded-lg"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm text-slate-700">Password</label>
          <input
            className="w-full px-3 py-2 border rounded-lg"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
        </div>

        <button
          className="w-full py-2 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-500 disabled:opacity-50"
          disabled={submitting}
        >
          {submitting ? "Signing in…" : "Sign in"}
        </button>

        <p className="text-xs text-slate-500">
          You’ll be redirected to: <span className="font-mono">{next}</span>
        </p>
      </form>
    </div>
  );
}
