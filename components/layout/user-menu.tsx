"use client";

import { useUser, useClerk, Show } from "@clerk/nextjs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LogOut, User as UserIcon, Settings as SettingsIcon } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Computes the initials for a display name.
 *   "Oliver Oxenham"      → "OO"
 *   "Oliver"              → "O"
 *   "oliver@example.com"  → "O"
 *   ""                    → "?"
 */
function getInitials(name: string | null | undefined): string {
  if (!name) return "?";
  const cleaned = name.trim();
  if (!cleaned) return "?";

  // If it looks like an email, use the first letter only.
  if (cleaned.includes("@")) return cleaned[0].toUpperCase();

  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

type Size = "sm" | "md" | "lg";

const sizeClasses: Record<Size, string> = {
  sm: "h-7 w-7 text-[11px]",
  md: "h-8 w-8 text-xs",
  lg: "h-10 w-10 text-sm",
};

/**
 * A flat initials avatar — navy background, white text, no image.
 * Used by `UserMenu` (and reusable elsewhere via the export).
 */
export function InitialsAvatar({
  name,
  size = "md",
  className,
}: {
  name: string | null | undefined;
  size?: Size;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full bg-fmu-navy font-semibold text-white",
        sizeClasses[size],
        className,
      )}
      aria-hidden
    >
      {getInitials(name)}
    </span>
  );
}

/**
 * The user menu in the top bar — initials avatar + dropdown.
 * Replaces Clerk's default `<UserButton />` so we get full control over styling
 * (and keep the brand consistent across the app shell).
 */
export function UserMenu() {
  const { user } = useUser();
  const { signOut, openUserProfile } = useClerk();

  const displayName =
    user?.fullName ||
    user?.firstName ||
    user?.username ||
    user?.primaryEmailAddress?.emailAddress ||
    null;
  const email = user?.primaryEmailAddress?.emailAddress ?? null;

  return (
    <Show when="signed-in">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="rounded-full outline-none ring-offset-2 ring-offset-card focus-visible:ring-2 focus-visible:ring-fmu-navy"
            aria-label="User menu"
          >
            <InitialsAvatar name={displayName} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="space-y-0.5">
            <div className="text-sm font-medium text-ink">
              {displayName ?? "Account"}
            </div>
            {email && (
              <div className="text-xs font-normal text-ink-3">{email}</div>
            )}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => openUserProfile()}>
            <UserIcon className="h-4 w-4" />
            Account
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/settings" prefetch={false}>
              <SettingsIcon className="h-4 w-4" />
              Settings
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => void signOut({ redirectUrl: "/" })}
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </Show>
  );
}
