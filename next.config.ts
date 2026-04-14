import type { NextConfig } from "next";

/** @type {import('next').NextConfig} */
const nextConfig: NextConfig = {
  serverExternalPackages: ["mongoose", "bcryptjs", "jsonwebtoken","@ffmpeg-installer/ffmpeg"],
};

export default nextConfig;

