import Link from "next/link";

/**
 * Simple footer with HyperLeague branding and links.
 */
export function Footer() {
  return (
    <footer className="border-t border-hl-border bg-hl-base py-8 mt-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          {/* Branding */}
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gold-gradient flex items-center justify-center">
              <span className="text-xs font-black text-hl-base tracking-tighter">
                SF
              </span>
            </div>
            <span className="text-sm font-semibold text-hl-muted">
              SFHL &copy; {new Date().getFullYear()} — Counter-Strike League
            </span>
          </div>

          {/* Links */}
          <div className="flex items-center gap-6 text-xs text-hl-muted">
            <Link href="/" className="hover:text-white transition-colors">
              Home
            </Link>
            <Link href="/leaderboards" className="hover:text-white transition-colors">
              Leaderboards
            </Link>
            <Link href="/matches" className="hover:text-white transition-colors">
              Matches
            </Link>
            <Link href="/ranks" className="hover:text-white transition-colors">
              Ranks
            </Link>
            <Link href="/tournaments" className="hover:text-white transition-colors">
              Tournaments
            </Link>
            <span className="text-hl-border">|</span>
            <span>Terms</span>
            <span>Privacy</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
