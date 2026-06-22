import { Stamp } from "lucide-react";
import type { ModuleManifest } from "../types";

/**
 * ⚠️ Phase-0 throwaway stub.
 *
 * This manifest exists ONLY to prove the module-toggle path end-to-end with
 * zero accounting code: install it from /settings/modules and a "Signatures"
 * tab appears on every customer header; uninstall it and the tab vanishes.
 *
 * Delete this file (its catalog entry in modules/catalog.ts, the registry
 * registration, and the placeholder route under
 * app/(app)/customers/[id]/notary/) when the real Accounting module lands in
 * Phase 1.
 */
export const notaryManifest: ModuleManifest = {
  id: "notary",
  name: "Notary",
  description: "Signature requests and notarial workflows.",
  industryTags: ["legal"],
  navigation: {
    customer: [
      { label: "Signatures", href: "notary/signatures", icon: Stamp },
    ],
  },
};
