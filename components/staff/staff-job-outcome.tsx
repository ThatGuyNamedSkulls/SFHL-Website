"use client";

/** What the bot answered for one staff action: its replies, shown like Discord's. */
import { Fragment, type ReactNode } from "react";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import type { StaffJob, StaffJobEmbed, StaffJobMessage } from "@/lib/staff-jobs";
import type { StaffJobState } from "@/components/staff/use-staff-job";

/** A Discord <t:unix:style> timestamp in the viewer's time zone ("R" = relative). */
function discordTime(unix: number, style: string): string {
  const d = new Date(unix * 1000);
  if (style === "R") {
    const mins = Math.round((d.getTime() - Date.now()) / 60_000);
    const abs = Math.abs(mins);
    const span = abs < 60 ? `${abs} min` : abs < 2880 ? `${Math.round(abs / 60)} h` : `${Math.round(abs / 1440)} days`;
    return mins >= 0 ? `in ${span}` : `${span} ago`;
  }
  return d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** **bold**, `code` and <t:…> times — the Discord markup the bot's replies use. */
function DiscordText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|<t:\d+(?::[a-zA-Z])?>)/g);
  return (
    <>
      {parts.map((part, i) => {
        const time = /^<t:(\d+)(?::([a-zA-Z]))?>$/.exec(part);
        if (time) return <Fragment key={i}>{discordTime(Number(time[1]), time[2] ?? "f")}</Fragment>;
        if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
          return <strong key={i} className="text-white">{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
          return (
            <code key={i} className="rounded bg-black/40 px-1 text-[0.8125rem]">
              {part.slice(1, -1)}
            </code>
          );
        }
        return <Fragment key={i}>{part}</Fragment>;
      })}
    </>
  );
}

function hex(color: number | undefined): string {
  return color == null ? "#4b4b4b" : `#${color.toString(16).padStart(6, "0")}`;
}

function Embed({ embed }: { embed: StaffJobEmbed }) {
  return (
    <div className="rounded-md border border-hl-border bg-hl-base/70 p-3" style={{ borderLeft: `4px solid ${hex(embed.color)}` }}>
      {embed.title ? <div className="text-sm font-bold text-white"><DiscordText text={embed.title} /></div> : null}
      {embed.description ? (
        <p className="mt-1 whitespace-pre-line text-sm text-[#d4d4d4]">
          <DiscordText text={embed.description} />
        </p>
      ) : null}
      {embed.fields?.length ? (
        <dl className="mt-2 grid gap-2 sm:grid-cols-2">
          {embed.fields.map((f, i) => (
            <div key={i}>
              <dt className="text-xs font-bold text-white"><DiscordText text={f.name} /></dt>
              <dd className="whitespace-pre-line text-xs text-[#d4d4d4]"><DiscordText text={f.value} /></dd>
            </div>
          ))}
        </dl>
      ) : null}
      {embed.footer ? <div className="mt-2 text-[0.6875rem] text-hl-muted">{embed.footer}</div> : null}
    </div>
  );
}

export function StaffMessages({ messages }: { messages: StaffJobMessage[] }) {
  if (!messages.length) return null;
  return (
    <div className="space-y-2">
      {messages.map((m, i) => (
        <div key={i} className="space-y-2">
          {m.content ? (
            <p className="whitespace-pre-line text-sm text-[#d4d4d4]">
              <DiscordText text={m.content} />
            </p>
          ) : null}
          {m.embeds.map((e, j) => (
            <Embed key={j} embed={e} />
          ))}
        </div>
      ))}
    </div>
  );
}

function Line({ icon, tone, children }: { icon: ReactNode; tone: string; children: ReactNode }) {
  return <div className={`flex items-center gap-2 text-sm ${tone}`}>{icon}{children}</div>;
}

const CANCELLED = "The bot didn't answer within 30 seconds, so nothing was done. Is the bot online?";

/** The finished job's headline: done, failed (with why), or cancelled. */
export function jobHeadline(job: StaffJob): { ok: boolean; text: string } {
  if (job.status === "done") return { ok: true, text: "Done." };
  if (job.status === "cancelled") return { ok: false, text: CANCELLED };
  return { ok: false, text: job.result?.error || "The bot said no — see its reply below." };
}

export function StaffJobOutcome({ state }: { state: StaffJobState }) {
  if (state.phase === "idle") return null;
  const spinner = <Loader2 className="h-4 w-4 animate-spin" />;
  if (state.phase === "sending") return <Line icon={spinner} tone="text-hl-muted">Sending…</Line>;
  if (state.phase === "waiting") {
    return (
      <Line icon={spinner} tone="text-hl-muted">
        {state.job.status === "running" ? "The bot is on it…" : "Waiting for the bot…"}
      </Line>
    );
  }
  if (state.phase === "error") {
    return <Line icon={<XCircle className="h-4 w-4" />} tone="text-hl-red">{state.message}</Line>;
  }
  const { job } = state;
  const head = jobHeadline(job);
  const showHead = !(job.status === "done" && job.result?.messages.length);
  return (
    <div className="space-y-2">
      {showHead ? (
        <Line
          icon={head.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
          tone={head.ok ? "text-hl-green" : "text-hl-red"}
        >
          {head.text}
        </Line>
      ) : null}
      <StaffMessages messages={job.result?.messages ?? []} />
    </div>
  );
}
