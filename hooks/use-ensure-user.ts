"use client";

import { useEffect, useState } from "react";
import { useConvexAuth, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

/**
 * Upserts the current Clerk user into the Convex `users` table whenever auth
 * becomes ready. Returns the user's Convex `_id`, or null until provisioned.
 */
export function useEnsureUser(): Id<"users"> | null {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const ensureUser = useMutation(api.users.ensureUser);
  const [userId, setUserId] = useState<Id<"users"> | null>(null);

  useEffect(() => {
    if (isLoading || !isAuthenticated) {
      setUserId(null);
      return;
    }
    let cancelled = false;
    ensureUser()
      .then((id) => {
        if (!cancelled) setUserId(id);
      })
      .catch((err) => {
        if (!cancelled) {
          console.error("ensureUser failed:", err);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isLoading, isAuthenticated, ensureUser]);

  return userId;
}
