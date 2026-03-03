"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { AuthModal } from "@/components/AuthModal";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/config/axios";
import toast from "react-hot-toast";

export default function GeneratePage() {
  const router = useRouter();
  const { user } = useAuth();
  const [authOpen, setAuthOpen] = useState(false);
  const [name, setName] = useState("");
  const [productName, setProductName] = useState("");
  const [productDescription, setProductDescription] = useState("");
  const [userPrompt, setUserPrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState("9:16");
  const [file, setFile] = useState<File | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [promptLengthAtFetch, setPromptLengthAtFetch] = useState<number | null>(null);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [loading, setLoading] = useState(false);

  const fetchSuggestions = useCallback(
    async (partial: string) => {
      if (partial.length < 10 || !productName) return;
      setSuggestionsLoading(true);
      try {
        const { data } = await api.post<{ suggestions: string[] }>(
          "/api/project/prompt-suggestions",
          {
            partialPrompt: partial,
            productName,
            productDescription,
          }
        );
        const list = data.suggestions ?? [];
        setSuggestions(list);
        setPromptLengthAtFetch(partial.length);
      } catch {
        setSuggestions([]);
        setPromptLengthAtFetch(null);
      } finally {
        setSuggestionsLoading(false);
      }
    },
    [productName, productDescription]
  );

  // Show first 10, then next 10 for every 10 chars typed after fetch
  const visibleCount =
    promptLengthAtFetch !== null && userPrompt.length >= promptLengthAtFetch
      ? Math.min(
          suggestions.length,
          Math.max(10, 10 + 10 * Math.floor((userPrompt.length - promptLengthAtFetch) / 10))
        )
      : suggestions.length;
  const visibleSuggestions = suggestions.slice(0, visibleCount);

  const handlePromptChange = (value: string) => {
    setUserPrompt(value);
    if (value.length < 10) {
      setSuggestions([]);
      setPromptLengthAtFetch(null);
      return;
    }
    if (suggestions.length === 0) fetchSuggestions(value);
  };

  const insertSuggestion = (s: string) => {
    setUserPrompt(s);
    setSuggestions([]);
  };

  const createProject = async (mode: "image" | "video") => {
    if (!user) {
      toast.error("Please sign in to create an ad");
      return;
    }
    if (!file) {
      toast.error("Please upload a product image");
      return;
    }
    setLoading(true);
    try {
      const formData = new FormData();
      formData.set("name", name);
      formData.set("productName", productName);
      formData.set("productDescription", productDescription);
      formData.set("userPrompt", userPrompt);
      formData.set("aspectRatio", aspectRatio);
      formData.set("images", file);
      const { data } = await api.post<{ projectId: string }>(
        "/api/project/create",
        formData,
        {
          headers: { "Content-Type": "multipart/form-data" },
        }
      );
      toast.success("Ad created! Redirecting…");
      const qs = mode === "video" ? "?autoVideo=1" : "";
      router.push(`/result/${data.projectId}${qs}`);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data
          ?.error ?? "Creation failed";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Navbar />
      <main className="min-h-screen px-4 pt-20 pb-12 sm:pt-24">
        <div className="mx-auto max-w-2xl">
          <h1 className="text-2xl font-bold text-white sm:text-3xl">
            Create a New AI UGC Ad
          </h1>
          <p className="mt-2 text-zinc-400">
            Upload a product image and we’ll generate an ad-style creative.
          </p>
          {!user && (
            <p className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-200">
              <button
                type="button"
                onClick={() => setAuthOpen(true)}
                className="font-medium underline"
              >
                Sign in
              </button>{" "}
              to create ads and use credits.
            </p>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void createProject("image");
            }}
            className="mt-8 space-y-6"
          >
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-400">
                Project name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full rounded-lg border border-white/10 bg-[var(--card)] px-3 py-2.5 text-base text-white placeholder-zinc-500 focus:border-[var(--accent)] focus:outline-none"
                placeholder="My summer campaign"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-400">
                Product image (required)
              </label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                required
                className="w-full rounded-lg border border-white/10 bg-[var(--card)] px-3 py-2.5 text-base text-white file:mr-2 file:rounded file:border-0 file:bg-[var(--accent)] file:min-h-[44px] file:px-4 file:py-2 file:text-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-400">
                Product name
              </label>
              <input
                type="text"
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                required
                className="w-full rounded-lg border border-white/10 bg-[var(--card)] px-3 py-2.5 text-base text-white placeholder-zinc-500 focus:border-[var(--accent)] focus:outline-none"
                placeholder="e.g. Organic Face Cream"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-400">
                Product description
              </label>
              <textarea
                value={productDescription}
                onChange={(e) => setProductDescription(e.target.value)}
                rows={2}
                className="w-full rounded-lg border border-white/10 bg-[var(--card)] px-3 py-2.5 text-base text-white placeholder-zinc-500 focus:border-[var(--accent)] focus:outline-none"
                placeholder="Brief description for the AI"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-400">
                Aspect ratio
              </label>
              <select
                value={aspectRatio}
                onChange={(e) => setAspectRatio(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-[var(--card)] px-3 py-2.5 text-base text-white focus:border-[var(--accent)] focus:outline-none"
              >
                <option value="9:16">9:16 (Reels / Stories)</option>
                <option value="16:9">16:9 (YouTube)</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-400">
                User prompt (optional) – type 10+ chars for AI suggestions
                {suggestionsLoading && (
                  <span className="ml-2 text-zinc-500">(loading…)</span>
                )}
              </label>
              <textarea
                value={userPrompt}
                onChange={(e) => handlePromptChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Tab" && visibleSuggestions[0]) {
                    e.preventDefault();
                    insertSuggestion(visibleSuggestions[0]);
                  }
                }}
                rows={3}
                className="w-full rounded-lg border border-white/10 bg-[var(--card)] px-3 py-2.5 text-base text-white placeholder-zinc-500 focus:border-[var(--accent)] focus:outline-none"
                placeholder="e.g. Bright, minimal, lifestyle shot..."
              />
              {visibleSuggestions.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {visibleSuggestions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => insertSuggestion(s)}
                      className="min-h-[44px] rounded-lg bg-white/10 px-3 py-2.5 text-sm text-zinc-300 hover:bg-white/20"
                    >
                      {s}
                    </button>
                  ))}
                  {visibleSuggestions.length < suggestions.length && (
                    <span className="text-xs text-zinc-500">
                      Type 10 more characters for next 10 suggestions
                    </span>
                  )}
                  <span className="text-xs text-zinc-500">Tab to insert first</span>
                </div>
              )}
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                disabled={loading || !user}
                onClick={() => void createProject("image")}
                className="min-h-[48px] flex-1 rounded-xl bg-[var(--accent)] py-3 font-semibold text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
              >
                {loading ? "Creating image… (5 credits)" : "Create Image"}
              </button>
              <button
                type="button"
                disabled={loading || !user}
                onClick={() => void createProject("video")}
                className="min-h-[48px] flex-1 rounded-xl border border-[var(--accent)] py-3 font-semibold text-[var(--accent)] hover:bg-[var(--accent)]/10 disabled:opacity-50"
              >
                {loading ? "Creating & starting video…" : "Generate Video"}
              </button>
            </div>
          </form>
        </div>
      </main>
      {authOpen && (
        <AuthModal
          onClose={() => setAuthOpen(false)}
          onSuccess={() => setAuthOpen(false)}
        />
      )}
    </>
  );
}
