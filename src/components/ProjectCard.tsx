"use client";

import Link from "next/link";
import { useState } from "react";
import type { Project } from "@/types";
import { api } from "@/config/axios";
import toast from "react-hot-toast";

interface ProjectCardProps {
  project: Project;
  onDelete?: (id: string) => void;
  showPublish?: boolean;
  onPublishToggle?: (id: string) => void;
}

export function ProjectCard({
  project,
  onDelete,
  showPublish = false,
  onPublishToggle,
}: ProjectCardProps) {
  const [deleting, setDeleting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const mediaUrl = project.generatedVideo || project.generatedImage || project.uploadedImages?.[0];
  const hasVideo = !!project.generatedVideo;

  const handleDelete = async () => {
    if (!confirm("Delete this project?")) return;
    setDeleting(true);
    try {
      await api.delete(`/api/project/${project._id}`);
      onDelete?.(project._id);
      toast.success("Project deleted");
    } catch {
      toast.error("Failed to delete");
    } finally {
      setDeleting(false);
      setMenuOpen(false);
    }
  };

  const handleDownloadVideo = () => {
    if (!project.generatedVideo) {
      toast.error("No video to download");
      return;
    }
    try {
      if (typeof window !== "undefined") {
        const link = document.createElement("a");
        link.href = project.generatedVideo;
        link.download = "";
        link.target = "_blank";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    } catch {
      if (typeof window !== "undefined") {
        window.open(project.generatedVideo, "_blank");
      }
    }
    setMenuOpen(false);
  };

  const handleShare = (platform: "youtube" | "instagram" | "copy") => {
    const url =
      typeof window !== "undefined"
        ? window.location.origin + "/result/" + project._id
        : "";
    if (platform === "copy") {
      navigator.clipboard
        .writeText(url)
        .then(() => toast.success("Link copied"))
        .catch(() => toast.error("Failed to copy link"));
      return;
    }
    const urls: Record<string, string> = {
      youtube: "https://www.youtube.com/upload",
      instagram: "https://www.instagram.com/",
    };
    if (typeof window !== "undefined") {
      window.open(urls[platform], "_blank");
      toast.success(`Open ${platform} to share`);
    }
  };

  return (
    <div className="relative overflow-hidden rounded-xl border border-white/10 bg-[var(--card)] transition hover:border-white/20">
      <Link href={`/result/${project._id}`} className="block aspect-video w-full overflow-hidden bg-black">
        {mediaUrl ? (
          hasVideo && project.generatedVideo ? (
            <video
              src={project.generatedVideo}
              className="h-full w-full object-cover"
              muted
              playsInline
              preload="metadata"
            />
          ) : (
            <img
              src={project.generatedImage || project.uploadedImages?.[0]}
              alt={project.name}
              className="h-full w-full object-cover"
            />
          )
        ) : (
          <div className="flex h-full items-center justify-center text-zinc-500">
            {project.isGenerating ? "Generating…" : "No media"}
          </div>
        )}
      </Link>

      {hasVideo && (
        <div className="absolute right-2 top-2 z-10">
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
            aria-label="More actions"
          >
            ⋮
          </button>
          {menuOpen && (
            <div className="mt-2 w-40 rounded-lg border border-white/10 bg-[var(--card)] p-1 text-sm text-zinc-200 shadow-lg">
              <button
                type="button"
                onClick={handleDownloadVideo}
                className="flex w-full items-center justify-start rounded-md px-3 py-2 text-left hover:bg-white/10"
              >
                Download Video
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="mt-1 flex w-full items-center justify-start rounded-md px-3 py-2 text-left text-red-400 hover:bg-red-500/20 disabled:opacity-50"
              >
                Delete Video
              </button>
            </div>
          )}
        </div>
      )}

      <div className="p-4">
        <h3 className="truncate font-semibold text-white">{project.name}</h3>
        <p className="truncate text-sm text-zinc-500">{project.productName}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Link
            href={`/result/${project._id}`}
            className="min-h-[36px] rounded-lg bg-white/10 px-3 py-2 text-sm font-medium text-white hover:bg-white/20"
          >
            View Details
          </Link>
          <button
            type="button"
            onClick={() => handleShare("youtube")}
            className="min-h-[36px] rounded-lg bg-white/5 px-3 py-2 text-xs font-medium text-white hover:bg-white/15"
          >
            YouTube
          </button>
          <button
            type="button"
            onClick={() => handleShare("instagram")}
            className="min-h-[36px] rounded-lg bg-white/5 px-3 py-2 text-xs font-medium text-white hover:bg-white/15"
          >
            Instagram
          </button>
          <button
            type="button"
            onClick={() => handleShare("copy")}
            className="min-h-[36px] rounded-lg bg-white/5 px-3 py-2 text-xs font-medium text-white hover:bg-white/15"
          >
            Copy link
          </button>
          {showPublish && onPublishToggle && !hasVideo && (
            <button
              type="button"
              onClick={() => onPublishToggle(project._id)}
              className="min-h-[36px] rounded-lg bg-[var(--accent)]/20 px-3 py-2 text-sm font-medium text-[var(--accent)] hover:bg-[var(--accent)]/30"
            >
              {project.isPublished ? "Unpublish" : "Publish"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
