"use client";

import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { useEffect, Suspense } from "react";
import { Card } from "@/components/ui/card";
import { Gamepad2, ArrowLeft } from "lucide-react";
import { SiDiscord } from "react-icons/si";

function LoginContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");
  const router = useRouter();

  // Redirect if already logged in
  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => res.json())
      .then((data) => {
        if (data.user) {
          router.push("/profile");
        }
      });
  }, [router]);

  let errorMessage = "";
  if (error === "no_code") errorMessage = "Authentication failed: No code provided.";
  else if (error === "token_failed") errorMessage = "Authentication failed: Could not exchange token.";
  else if (error === "server_error") errorMessage = "An error occurred during authentication.";

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-hl-base py-12 px-4 sm:px-6 lg:px-8">
      <div className="absolute inset-0 bg-hero-radial opacity-30 pointer-events-none" />
      <div className="absolute right-0 top-0 w-[500px] h-[500px] bg-hl-gold/5 blur-3xl rounded-full translate-x-1/2 -translate-y-1/2 pointer-events-none" />
      <div className="absolute left-0 bottom-0 w-[500px] h-[500px] bg-hl-panel-light/30 blur-3xl rounded-full -translate-x-1/2 translate-y-1/2 pointer-events-none" />

      <div className="relative z-10 w-full max-w-md">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-hl-muted hover:text-hl-gold transition-colors mb-8"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Home
        </Link>

        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gold-gradient shadow-[0_0_30px_rgba(255,183,83,0.3)] mb-6">
            <Gamepad2 className="w-8 h-8 text-hl-base" />
          </div>
          <h1 className="text-3xl font-black text-white tracking-tight mb-2">
            Welcome to SFHL
          </h1>
          <p className="text-hl-muted">
            Sign in with Discord to access the queue, view your profile, and join tournaments.
          </p>
        </div>

        <Card className="bg-hl-panel border-hl-border p-6 md:p-8 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-gold-gradient" />

          {errorMessage && (
            <div className="mb-6 p-3 rounded bg-hl-red/10 border border-hl-red/20 text-hl-red text-sm text-center">
              {errorMessage}
            </div>
          )}

          <div className="space-y-6">
            <Link
              href="/api/auth/discord"
              className="w-full flex items-center justify-center gap-3 py-3 px-4 rounded-xl font-medium transition-colors bg-[#5865F2] hover:bg-[#4752C4] text-white"
            >
              <SiDiscord className="w-5 h-5" />
              Sign in with Discord
            </Link>

            <div className="text-center text-xs text-hl-muted mt-6">
              <p>
                By signing in, you agree to the SFHL{" "}
                <Link href="#" className="text-hl-gold hover:underline">
                  Terms of Service
                </Link>{" "}
                and{" "}
                <Link href="#" className="text-hl-gold hover:underline">
                  Privacy Policy
                </Link>
                .
              </p>
              <p className="mt-2">
                You must be a member of the SFHL Discord server to log in.
              </p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-hl-base" />}>
      <LoginContent />
    </Suspense>
  );
}
