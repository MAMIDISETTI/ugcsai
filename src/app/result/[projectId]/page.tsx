"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/config/axios";
import type { Project } from "@/types";
import toast from "react-hot-toast";

export default function ResultPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const projectId = params.projectId as string;
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [videoLoading, setVideoLoading] = useState(false);
  const [autoVideoTriggered, setAutoVideoTriggered] = useState(false);

  useEffect(() => {
    if (!user || !projectId) {
      setLoading(false);
      return;
    }
    const fetchProject = async () => {
      try {
        const { data } = await api.get<Project>(`/api/user/projects/${projectId}`);
        setProject(data);
        if (data.isGenerating && !data.generatedImage) {
          api.post(`/api/project/${projectId}/generate`).catch(() => {});
        }
      } catch {
        setProject(null);
      } finally {
        setLoading(false);
      }
    };
    fetchProject();
  }, [user, projectId]);

  useEffect(() => {
    if (!projectId || (!project?.isGenerating && !project?.isVideoGenerating)) return;
    const interval = setInterval(async () => {
      try {
        const { data } = await api.get<Project>(`/api/user/projects/${projectId}`);
        setProject(data);
        if (!data.isGenerating && !data.isVideoGenerating) clearInterval(interval);
      } catch {
        clearInterval(interval);
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [project?.isGenerating, project?.isVideoGenerating, projectId]);

  const autoVideo = searchParams.get("autoVideo") === "1";

  useEffect(() => {
    if (!autoVideo || autoVideoTriggered) return;
    if (!project || !user) return;
    if (!project.generatedImage || project.generatedVideo || project.isVideoGenerating) return;

    setAutoVideoTriggered(true);
    setVideoLoading(true);
    setProject((prev) =>
      prev ? { ...prev, isVideoGenerating: true } : prev
    );
    api
      .post<{ project: Project }>("/api/project/video", {
        projectId: project._id,
      })
      .then(({ data }) => {
        setProject(data.project);
        toast.success("Video generation started");
      })
      .catch((err: unknown) => {
        const msg =
          (err as { response?: { data?: { error?: string } } })?.response?.data
            ?.error ?? "Video generation failed";
        toast.error(msg);
        setProject((prev) =>
          prev ? { ...prev, isVideoGenerating: false } : prev
        );
      })
      .finally(() => {
        setVideoLoading(false);
      });
  }, [autoVideo, autoVideoTriggered, project, user]);

  const handleGenerateVideo = async () => {
    if (!project || !user) return;
    setVideoLoading(true);
    setProject((prev) =>
      prev ? { ...prev, isVideoGenerating: true } : prev
    );
    api
      .post<{ project: Project }>("/api/project/video", {
        projectId: project._id,
      })
      .then(({ data }) => {
        setProject(data.project);
        toast.success("Video generation started");
      })
      .catch((err: unknown) => {
        const msg =
          (err as { response?: { data?: { error?: string } } })?.response?.data
            ?.error ?? "Video generation failed";
        toast.error(msg);
        setProject((prev) =>
          prev ? { ...prev, isVideoGenerating: false } : prev
        );
      })
      .finally(() => {
        setVideoLoading(false);
      });
  };

  if (!user) {
    router.replace("/");
    return null;
  }

  if (loading) {
    return (
      <>
        <Navbar />
        <main className="flex min-h-screen items-center justify-center">
          <p className="text-zinc-400">Loading…</p>
        </main>
      </>
    );
  }

  if (!project) {
    return (
      <>
        <Navbar />
        <main className="flex min-h-screen flex-col items-center justify-center gap-4">
          <p className="text-zinc-400">Project not found.</p>
          <Link href="/my-generations" className="text-[var(--accent)] hover:underline">
            Back to My Videos
          </Link>
        </main>
      </>
    );
  }

  const mediaUrl = project.generatedVideo || project.generatedImage;
  const hasVideo = !!project.generatedVideo;

  return (
    <>
      <Navbar />
      <main className="min-h-screen px-4 pt-20 pb-12 sm:pt-24">
        <div className="mx-auto max-w-3xl">
          <Link
            href="/my-generations"
            className="text-sm text-zinc-400 hover:text-white"
          >
            ← My Videos
          </Link>
          <h1 className="mt-4 text-2xl font-bold text:white">{project.name}</h1>
          <p className="text-zinc-500">{project.productName}</p>
          {project.error && (
            <p className="mt-2 text-sm text-red-400">{project.error}</p>
          )}
          <div className="mt-6 overflow-hidden rounded-xl border border-white/10 bg-black">
            {project.isGenerating ? (
              <div className="flex aspect-video flex-col items-center justify-center gap-3 text-zinc-500">
                <span className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
                <span>Generating your ad image…</span>
                <span className="text-sm text-zinc-600">This usually takes 30–60 seconds</span>
              </div>
            ) : project.isVideoGenerating && !hasVideo ? (
              <div className="flex aspect-video flex-col items-center justify-center gap-3 text-zinc-500">
                <span className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
                <span>Generating your ad video…</span>
                <span className="text-sm text-zinc-600">This can take 1–2 minutes</span>
              </div>
            ) : mediaUrl ? (
              hasVideo ? (
                <video
                  src={project.generatedVideo}
                  controls
                  className="w-full"
                  playsInline
                />
              ) : (
                <img
                  src={project.generatedImage}
                  alt={project.name}
                  className="w-full object-contain"
                />
              )
            ) : null}
          </div>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            {project.generatedImage && !project.generatedVideo && (
              <button
                type="button"
                onClick={handleGenerateVideo}
                disabled={videoLoading || project.isVideoGenerating}
                className="min-h-[48px] rounded-xl bg-[var(--accent)] px-4 py-3 font-semibold text-white hover:bg-[var(--accent-hover)] disabled:opacity-50 sm:py-2"
              >
                {project.isVideoGenerating || videoLoading
                  ? "Generating video… (10 credits)"
                  : "Generate video (10 credits)"}
              </button>
            )}
            {project.generatedImage && (
              <a
                href={project.generatedImage}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-[48px] items-center justify-center rounded-xl border border-white/20 px-4 py-3 font-semibold text-white hover:bg-white/10 sm:py-2"
              >
                Download image
              </a>
            )}
            {project.generatedVideo && (
              <a
                href={project.generatedVideo}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-[48px] items-center justify-center rounded-xl border border-white/20 px-4 py-3 font-semibold text-white hover:bg:white/10 sm:py-2"
              >
                Download video
              </a>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
