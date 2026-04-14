"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { EditProjectModal } from "@/components/EditProjectModal";
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
  const [imageDeleting, setImageDeleting] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [autoVideoTriggered, setAutoVideoTriggered] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const autoVideo = searchParams.get("autoVideo") === "1";

  const isGeneratingVideo = project?.isVideoGenerating || videoLoading;

  useEffect(() => {
    if (!user || !projectId) {
      setLoading(false);
      return;
    }
    const fetchProject = async () => {
      try {
        const { data } = await api.get<Project>(`/api/user/projects/${projectId}`);
        setProject(data);
        // Only trigger image generation when not in video-only flow (autoVideo=1 means video directly)
        if (data.isGenerating && !data.generatedImage && !autoVideo) {
          api.post(`/api/project/${projectId}/generate`).catch(() => {});
        }
      } catch {
        setProject(null);
      } finally {
        setLoading(false);
      }
    };
    fetchProject();
  }, [user, projectId, autoVideo]);

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

  // Timer for video generation
  useEffect(() => {
    if (!isGeneratingVideo) {
      setElapsedSeconds(0);
      return;
    }
    setElapsedSeconds(0);
    const interval = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [isGeneratingVideo]);

  useEffect(() => {
    if (!autoVideo || autoVideoTriggered) return;
    if (!project || !user) return;
    const hasImage = project.generatedImage || project.uploadedImages?.[0];
    if (!hasImage || project.generatedVideo || project.isVideoGenerating) return;

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

  const handleDeleteImage = async () => {
    if (!project || !user) return;
    const isGenerated = !!project.generatedImage;
    const isUploaded = !!project.uploadedImages?.[0];
    if (!isGenerated && !isUploaded) return;
    const msg = isGenerated
      ? "Delete the generated image? The video (if any) will remain."
      : "Delete the uploaded image?";
    if (!confirm(msg)) return;
    setImageDeleting(true);
    try {
      const url = isGenerated
        ? `/api/project/${project._id}/image`
        : `/api/project/${project._id}/image?type=uploaded`;
      const { data } = await api.delete<{ project: Project }>(url);
      const hasMedia =
        !!data.project.generatedVideo ||
        !!data.project.generatedImage ||
        (data.project.uploadedImages && data.project.uploadedImages.length > 0);
      if (!hasMedia) {
        toast.success("Image deleted");
        router.push("/my-generations");
      } else {
        setProject(data.project);
        toast.success("Image deleted");
      }
    } catch {
      toast.error("Failed to delete image");
    } finally {
      setImageDeleting(false);
    }
  };

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

  const mediaUrl = project.generatedVideo || project.generatedImage || project.uploadedImages?.[0];
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
            ) : isGeneratingVideo && !hasVideo ? (
              <div className="flex aspect-video flex-col items-center justify-center gap-3 text-zinc-500">
                <span className="inline-block h-10 w-10 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
                <span className="font-medium">Generating your ad video…</span>
                <span className="text-2xl font-mono tabular-nums text-white">
                  {Math.floor(elapsedSeconds / 60)}:{(elapsedSeconds % 60).toString().padStart(2, "0")}
                </span>
                <span className="text-sm text-zinc-600">This can take 2–5 minutes</span>
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
                  src={project.generatedImage || project.uploadedImages?.[0]}
                  alt={project.name}
                  className="w-full object-contain"
                />
              )
            ) : null}
          </div>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            {!project.isGenerating &&
              (project.generatedImage || project.uploadedImages?.[0]) &&
              !project.generatedVideo &&
              !isGeneratingVideo && (
              <button
                type="button"
                onClick={handleGenerateVideo}
                className="min-h-[48px] rounded-xl bg-[var(--accent)] px-4 py-3 font-semibold text-white hover:bg-[var(--accent-hover)] sm:py-2"
              >
                Generate video (10 credits)
              </button>
            )}
            {!project.isGenerating &&
              (project.generatedImage || project.uploadedImages?.[0]) &&
              !project.generatedVideo &&
              !isGeneratingVideo && (
              <>
                {project.uploadedImages?.length ? (
                  <button
                    type="button"
                    onClick={() => setEditOpen(true)}
                    className="flex min-h-[48px] items-center justify-center rounded-xl border border-white/20 px-4 py-3 font-semibold text-white hover:bg-white/10 sm:py-2"
                  >
                    Edit
                  </button>
                ) : null}
                <a
                  href={project.generatedImage || project.uploadedImages?.[0]}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-h-[48px] items-center justify-center rounded-xl border border-white/20 px-4 py-3 font-semibold text-white hover:bg-white/10 sm:py-2"
                >
                  Download image
                </a>
                <button
                  type="button"
                  onClick={handleDeleteImage}
                  disabled={imageDeleting}
                  className="flex min-h-[48px] items-center justify-center rounded-xl border border-red-500/30 px-4 py-3 font-semibold text-red-400 hover:bg-red-500/10 disabled:opacity-50 sm:py-2"
                >
                  {imageDeleting ? "Deleting…" : "Delete image"}
                </button>
              </>
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
      {editOpen && project && (
        <EditProjectModal
          project={project}
          onClose={() => setEditOpen(false)}
          onSuccess={(updated) => {
            setProject(updated);
            setEditOpen(false);
          }}
        />
      )}
    </>
  );
}
