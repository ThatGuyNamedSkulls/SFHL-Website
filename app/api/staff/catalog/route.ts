import { NextResponse } from "next/server";
import { publicErrorMessage } from "@/lib/route-errors";
import { staffCatalog } from "@/lib/staff-players";
import { staffContext } from "@/lib/staff-session";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Pick lists for the staff forms: every cosmetic item, and badge names already in use. */
export async function GET() {
  const ctx = await staffContext();
  if (ctx instanceof NextResponse) return ctx;
  try {
    return NextResponse.json(await staffCatalog());
  } catch (error) {
    return NextResponse.json({ error: publicErrorMessage(error, "Couldn't load the item list.") }, { status: 500 });
  }
}
