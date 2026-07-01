import { readFile } from "fs/promises";
import path from "path";

/**
 * Serves the bot's Roblox avatar PNGs (stored in ../../avatars relative to the
 * site root) so the website can display them. Read-only, cached.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ file: string }> }
) {
  const { file } = await params;
  const decoded = decodeURIComponent(file);

  // Prevent path traversal — only allow a bare filename.
  if (decoded.includes("/") || decoded.includes("\\") || decoded.includes("..")) {
    return new Response("Invalid avatar", { status: 400 });
  }

  const avatarsDir =
    process.env.AVATARS_PATH ||
    path.resolve(process.cwd(), "..", "..", "avatars");
  const filePath = path.join(avatarsDir, decoded);

  try {
    const data = await readFile(filePath);
    const ext = path.extname(decoded).toLowerCase();
    const contentType =
      ext === ".jpg" || ext === ".jpeg"
        ? "image/jpeg"
        : ext === ".webp"
        ? "image/webp"
        : "image/png";
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400, immutable",
      },
    });
  } catch {
    return new Response("Avatar not found", { status: 404 });
  }
}
