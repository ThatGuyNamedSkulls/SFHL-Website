"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Rss } from "lucide-react";
import { DiscordContent } from "@/components/discord-content";
import type { MentionSegment } from "@/lib/discord-mentions";

interface Announcement {
  id: string;
  author: string;
  avatar: string | null;
  content: string;
  segments?: MentionSegment[];
  timestamp: string;
  attachments: string[];
}

export default function FeedPage() {
  const [posts, setPosts] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/discord/announcements")
      .then((r) => r.json())
      .then((d) => setPosts(Array.isArray(d.announcements) ? d.announcements : []))
      .catch(() => setPosts([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="hl-page">
      <div className="flex items-center gap-2 mb-6">
        <Rss className="w-5 h-5 text-hl-gold" />
        <h1 className="text-2xl font-black text-white">Feed</h1>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-10 h-10 rounded-full border-2 border-hl-border border-t-hl-gold animate-spin" />
        </div>
      ) : posts.length === 0 ? (
        <Card className="bg-hl-panel border-hl-border p-8 text-center text-sm text-hl-muted">
          No announcements to show right now.
        </Card>
      ) : (
        <div className="space-y-4">
          {posts.map((p) => (
            <Card key={p.id} className="bg-hl-panel border-hl-border p-5">
              <div className="flex gap-3">
                <Avatar className="w-10 h-10 border border-hl-border shrink-0">
                  {p.avatar ? <AvatarImage src={p.avatar} /> : null}
                  <AvatarFallback className="bg-hl-panel-light text-xs font-bold text-hl-gold">
                    {p.author.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-white">{p.author}</span>
                    <span className="text-[11px] text-hl-muted">
                      {new Date(p.timestamp).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-sm text-hl-muted mt-2 whitespace-pre-wrap">
                    <DiscordContent content={p.content} segments={p.segments} />
                  </p>
                  {p.attachments.map((url) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={url}
                      src={url}
                      alt=""
                      className="mt-3 rounded-lg max-h-80 max-w-full h-auto border border-hl-border"
                    />
                  ))}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
