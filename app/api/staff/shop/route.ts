import { NextResponse } from "next/server";
import { publicErrorMessage } from "@/lib/route-errors";
import { staffShopView } from "@/lib/staff-shop";
import { staffContext } from "@/lib/staff-session";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** The Shop tab: every cosmetic item, its price and how many own it (Administrators). */
export async function GET() {
  const ctx = await staffContext();
  if (ctx instanceof NextResponse) return ctx;
  if (!ctx.roles.admin) return NextResponse.json({ error: "Administrators only." }, { status: 403 });
  try {
    return NextResponse.json(await staffShopView());
  } catch (error) {
    return NextResponse.json({ error: publicErrorMessage(error, "Couldn't load the shop tab.") }, { status: 500 });
  }
}
