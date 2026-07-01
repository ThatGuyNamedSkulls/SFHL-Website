import { cn } from "@/lib/utils";

/** Simple shimmer placeholder block used while data loads. */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-hl-panel-light/70", className)}
      {...props}
    />
  );
}

export { Skeleton };
