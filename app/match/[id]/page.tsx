"use client";

import { use, useState, useEffect } from "react";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { MatchRoomResult } from "@/components/match-room-result";
import { MatchDetail } from "@/types";
import { ArrowLeft } from "lucide-react";

export default function MatchDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const [match, setMatch] = useState<MatchDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/matches/${id}`)
      .then((r) => {
        if (!r.ok) throw new Error("Match not found");
        return r.json();
      })
      .then((data) => {
        setMatch(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setError("Match not found");
        setLoading(false);
      });
  }, [id]);

  if (loading) {
    return (
      <div className="hl-page-wide">
        <Skeleton className="h-8 w-40 mb-6" />
        <Skeleton className="h-48 w-full mb-6 rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (error || !match) {
    return (
      <div className="hl-page-wide py-16 text-center">
        <h1 className="text-2xl font-bold text-white mb-4">Match Not Found</h1>
        <p className="text-hl-muted mb-6">
          Detailed scoreboard data is not available for this match.
        </p>
        <Link
          href="/matches"
          className="inline-flex items-center gap-2 text-hl-gold hover:underline"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Matches
        </Link>
      </div>
    );
  }

  return (
    <div className="hl-page-wide">
      <Link
        href="/matches"
        className="inline-flex items-center gap-2 text-sm text-hl-muted hover:text-hl-gold transition-colors mb-5"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Matches
      </Link>
      <MatchRoomResult match={match} />
    </div>
  );
}
