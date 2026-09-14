import { Building2 } from "lucide-react";
import { Card } from "@/components/ui/card";

export default function ClubsPage() {
  return (
    <div className="hl-page py-16 text-center">
      <Building2 className="w-10 h-10 text-hl-gold mx-auto mb-4" />
      <h1 className="text-2xl font-black text-white mb-2">Clubs</h1>
      <Card className="bg-hl-panel border-hl-border p-8 mt-6">
        <p className="text-sm text-hl-muted">Coming soon.</p>
      </Card>
    </div>
  );
}
